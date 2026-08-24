import asyncio
import json
import sqlite3
from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from datetime import datetime

COMPANY_ID = 0xFFFF
# Every employee advertises companyPrefix + their public.user.user_id as the primary
# service UUID (see crm-apis GET /mobileapi/attendance/beacon-identity) — that's the
# only thing that reliably survives iOS backgrounding, so identity is matched on it,
# not on manufacturer data (0xFFFF is a Bluetooth SIG *test* ID lots of unrelated
# devices use too — checking only for its presence used to let noise into this table).
OFFICE_BEACON_UUID_PREFIX = "41555343-414e-4000-8000-"
DB_PATH = "beacons.db"
seen = {}

# This file and send_beacon_summary.py both hold their own connection to the same
# beacons.db, running as two independent long-lived processes — this one inserting
# continuously as sightings arrive, the other periodically SELECTing + DELETEing on
# its report cycle. Default SQLite locking (rollback-journal mode) lets a writer or
# a reader hold the whole file exclusively, so the two processes contending for it
# is a real, recurring risk, not a hypothetical one. WAL mode lets a writer and
# readers proceed concurrently (only writer-vs-writer still has to wait its turn),
# and busy_timeout makes that wait patient instead of raising immediately. Set here
# in code rather than relying on it already being set on the file, since a fresh or
# recreated beacons.db would otherwise silently revert to the default and reintroduce
# the exact contention this exists to prevent.
db = sqlite3.connect(DB_PATH)
db.execute("PRAGMA journal_mode=WAL;")
db.execute("PRAGMA busy_timeout=10000;")
db.execute("""
    CREATE TABLE IF NOT EXISTS beacon_sightings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        mac         TEXT NOT NULL,
        beacon_id   TEXT,
        device_name TEXT,
        rssi        INTEGER,
        uuids       TEXT,
        timestamp   TEXT NOT NULL
    )
""")
try:
    db.execute("ALTER TABLE beacon_sightings ADD COLUMN device_name TEXT")
except sqlite3.OperationalError:
    pass  # already present on a beacons.db created before this change
db.commit()

def on_device(device: BLEDevice, adv: AdvertisementData):
    mac  = device.address
    rssi = adv.rssi or 0

    uuids = [u.lower() for u in (adv.service_uuids or [])]
    beacon_id = next((u for u in uuids if u.startswith(OFFICE_BEACON_UUID_PREFIX)), None)
    if beacon_id is None:
        return

    # Best-effort only — Android puts the display name here, iOS never does, and
    # it isn't validated against anything, so it's never the authoritative identity.
    device_name = None
    if adv.manufacturer_data and COMPANY_ID in adv.manufacturer_data:
        device_name = adv.manufacturer_data[COMPANY_ID].decode("utf-8", errors="ignore")

    payload = {
        "mac":         mac,
        "beacon_id":   beacon_id,
        "device_name": device_name,
        "rssi":        rssi,
        "uuids":       uuids,
        "timestamp":   datetime.now().isoformat()
    }

    print(json.dumps(payload, indent=2))
    # This callback runs synchronously inside bleak's BLE stack — an uncaught
    # exception here (e.g. SQLITE_BUSY surviving the busy_timeout, however unlikely)
    # would propagate up through the scanner's event loop and crash the whole
    # process, not just drop this one sighting. Caught and logged instead: losing
    # one insert is fine, losing the scanner until systemd notices and restarts it
    # (RestartSec=5, plus everything scanned in that gap) is not.
    try:
        db.execute(
            "INSERT INTO beacon_sightings (mac, beacon_id, device_name, rssi, uuids, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (mac, beacon_id, device_name, rssi, json.dumps(uuids), payload["timestamp"])
        )
        db.commit()
    except sqlite3.Error as e:
        print(f"# DB error inserting sighting for {mac}: {e}")
        return

    seen[mac] = {"beacon_id": beacon_id, "rssi": rssi}

async def main():
    print("# Office Beacon Scanner — JSON output")
    print("# Press Ctrl+C to stop\n")

    scanner = BleakScanner(detection_callback=on_device, scanning_mode="active")
    await scanner.start()

    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print(f"\n# Stopped. {len(seen)} beacon(s) found.")
    finally:
        await scanner.stop()
        db.close()

asyncio.run(main())