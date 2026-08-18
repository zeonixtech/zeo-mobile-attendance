import json
import sqlite3
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "beacons.db"
ENV_PATH = BASE_DIR / ".env"

# TESTING: 1-minute window. Set back to 60 for hourly production runs.
WINDOW_MINUTES = 1


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
        "SELECT DISTINCT mac FROM beacon_sightings WHERE timestamp < ?", (end_iso,)
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


def main():
    env = load_env(ENV_PATH)
    api_url = env.get("API_URL")
    api_key = env.get("API_KEY")
    if not api_url or not api_key:
        raise SystemExit("API_URL and API_KEY must be set in .env")

    period_start, period_end = get_period()
    conn = sqlite3.connect(DB_PATH)
    try:
        payload = build_summary(conn, period_start, period_end)
    finally:
        conn.close()

    print(json.dumps(payload, indent=2))

    try:
        status, body = post_summary(api_url, api_key, payload)
        print(f"# POST {api_url} -> {status}")
    except urllib.error.URLError as e:
        print(f"# Failed to POST summary: {e}")
        raise


if __name__ == "__main__":
    main()