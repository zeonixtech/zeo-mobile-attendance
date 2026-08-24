import json
import sqlite3
import time
import traceback
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "beacons.db"
ENV_PATH = BASE_DIR / ".env"

# TESTING: 1-minute window. Set back to 60 (minutes) for hourly production runs.
WINDOW_MINUTES = 1  

# How many report cycles a mac keeps being reported "silent" (and its last-seen row
# kept around) after its last real sighting, before being pruned for good. Expressed
# in cycles rather than a fixed minute count so it scales sensibly whether
# WINDOW_MINUTES is 0.5 (testing) or 60 (production hourly runs).
#
# NOTE: because the "silent" window and the "active" window overlap by one cycle
# (build_summary()'s all_macs lookback vs. active_rows both end at period_end), a mac
# is actually reported "silent" for (SILENT_GRACE_PERIODS - 1) cycles, not
# SILENT_GRACE_PERIODS itself. 2 here means exactly one silent report per departure —
# enough to signal the active->silent transition once, without repeating it.
SILENT_GRACE_PERIODS = 2


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def get_period():
    if WINDOW_MINUTES >= 60 and WINDOW_MINUTES % 60 == 0:
        now = datetime.now().replace(minute=0, second=0, microsecond=0)
    else:
        now = datetime.now().replace(second=0, microsecond=0)
    period_end = now
    period_start = now - timedelta(minutes=WINDOW_MINUTES)
    return period_start, period_end


def build_summary(conn, period_start, period_end):
    start_iso = period_start.isoformat()
    end_iso = period_end.isoformat()
    # Only macs seen within this window are still worth reporting as "silent" — beyond
    # it, delete_sent_entries() will have already pruned them (see there for why).
    grace_cutoff_iso = (period_end - timedelta(minutes=WINDOW_MINUTES * SILENT_GRACE_PERIODS)).isoformat()

    active_rows = conn.execute(
        """
        SELECT mac, beacon_id, device_name, rssi, uuids, timestamp
        FROM beacon_sightings
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp ASC
        """,
        (start_iso, end_iso),
    ).fetchall()

    active = {}
    for mac, beacon_id, device_name, rssi, uuids_json, timestamp in active_rows:
        entry = active.setdefault(mac, {
            "mac": mac,
            "beacon_id": beacon_id,
            "device_name": device_name,
            "status": "active",
            "sightings": 0,
            "first_seen": timestamp,
            "last_seen": timestamp,
            "_rssi_sum": 0,
            "uuids": set(),
        })
        entry["sightings"] += 1
        entry["_rssi_sum"] += rssi
        entry["last_seen"] = timestamp
        entry["beacon_id"] = beacon_id
        entry["device_name"] = device_name
        entry["uuids"].update(json.loads(uuids_json or "[]"))

    devices = []
    for entry in active.values():
        entry["rssi_avg"] = round(entry.pop("_rssi_sum") / entry["sightings"], 1)
        entry["uuids"] = sorted(entry["uuids"])
        devices.append(entry)

    all_macs = {row[0] for row in conn.execute(
        "SELECT DISTINCT mac FROM beacon_sightings WHERE timestamp < ? AND timestamp >= ?",
        (end_iso, grace_cutoff_iso),
    ).fetchall()}
    silent_macs = all_macs - set(active.keys())

    for mac in silent_macs:
        row = conn.execute(
            """
            SELECT beacon_id, device_name, uuids, timestamp
            FROM beacon_sightings
            WHERE mac = ? AND timestamp < ?
            ORDER BY timestamp DESC
            LIMIT 1
            """,
            (mac, end_iso),
        ).fetchone()
        beacon_id, device_name, uuids_json, last_seen = row
        devices.append({
            "mac": mac,
            "beacon_id": beacon_id,
            "device_name": device_name,
            "status": "silent",
            "sightings": 0,
            "first_seen": None,
            "last_seen": last_seen,
            "rssi_avg": None,
            "uuids": sorted(json.loads(uuids_json or "[]")),
        })

    devices.sort(key=lambda d: d["mac"])

    return {
        "source": "raspberry-pi-office-scanner",
        "period_start": start_iso,
        "period_end": end_iso,
        "generated_at": datetime.now().isoformat(),
        "device_count": len(devices),
        "devices": devices,
    }


def post_summary(api_url: str, api_key: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status, resp.read().decode("utf-8", errors="ignore")


def delete_sent_entries(conn, period_end):
    # Prunes rows once they've fallen outside the silent-reporting grace window used by
    # build_summary() above, rather than deleting everything the instant it's first
    # reported. An earlier version deleted a mac's row right after its one and only
    # "silent" report — which stopped permanent ghost entries (a rotated-away BLE MAC
    # being reported forever) but broke real active->silent transitions too: with the
    # row gone immediately, an employee who'd actually left never got a second silent
    # report, so the server had no further signal to distinguish "still out" from
    # "no data yet", and the frontend kept showing them as "Still in" indefinitely.
    # Keeping recently-silent rows around for SILENT_GRACE_PERIODS cycles gives that
    # transition several report cycles to be reliably observed, while a mac that's
    # genuinely gone for good still eventually falls out of the window and gets pruned.
    cutoff_iso = (period_end - timedelta(minutes=WINDOW_MINUTES * SILENT_GRACE_PERIODS)).isoformat()
    conn.execute(
        "DELETE FROM beacon_sightings WHERE timestamp < ?",
        (cutoff_iso,),
    )
    conn.commit()


def run_once(api_url: str, api_key: str):
    period_start, period_end = get_period()
    conn = sqlite3.connect(DB_PATH)
    # Matches find_beacon.py's connection setup — this script and the scanner both
    # hold independent connections to the same beacons.db concurrently (this one
    # SELECTing + DELETEing on its report cycle while the scanner inserts
    # continuously). WAL lets the two proceed without blocking each other for a
    # plain read/write mix; busy_timeout covers the residual writer-vs-writer case
    # (this script's DELETE landing at the same instant as an INSERT) by waiting
    # instead of raising immediately. Set here rather than trusted to already be on
    # the file, since a fresh/recreated beacons.db would silently revert to the
    # default and reintroduce the exact contention this exists to prevent.
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=10000;")
    try:
        payload = build_summary(conn, period_start, period_end)

        print(json.dumps(payload, indent=2))

        status, body = post_summary(api_url, api_key, payload)
        print(f"# POST {api_url} -> {status}")

        delete_sent_entries(conn, period_end)
    finally:
        conn.close()


def main():
    env = load_env(ENV_PATH)
    api_url = env.get("API_URL")
    api_key = env.get("API_KEY")
    if not api_url or not api_key:
        raise SystemExit("API_URL and API_KEY must be set in .env")

    # Runs forever under the systemd service, POSTing one summary per
    # WINDOW_MINUTES; a bad run is logged and retried shortly after
    # instead of going silent for a full window (e.g. boot-time DNS
    # not being up yet), without taking the whole service down.
    RETRY_SECONDS = 60
    while True:
        try:
            run_once(api_url, api_key)
        except Exception:
            traceback.print_exc()
            time.sleep(RETRY_SECONDS)
            continue
        time.sleep(WINDOW_MINUTES * 60)


if __name__ == "__main__":
    main()
