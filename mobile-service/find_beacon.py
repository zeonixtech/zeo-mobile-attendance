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

db = sqlite3.connect(DB_PATH)
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
    db.execute(
        "INSERT INTO beacon_sightings (mac, beacon_id, device_name, rssi, uuids, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (mac, beacon_id, device_name, rssi, json.dumps(uuids), payload["timestamp"])
    )
    db.commit()

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