import Foundation
import CoreBluetooth

/**
 * iOS implementation of the BleBeacon Cordova plugin.
 *
 * CoreBluetooth's CBPeripheralManager handles background BLE advertising
 * automatically once the app has the `bluetooth-peripheral` background mode
 * set in Info.plist. iOS restores the peripheral manager (and resumes
 * advertising) whenever it wakes the app for a Bluetooth event — even after
 * the app was killed — as long as the plugin is instantiated at launch
 * (see the `onload="true"` feature flag in plugin.xml).
 */
@objc(BleBeaconPlugin)
class BleBeaconPlugin: CDVPlugin, CBPeripheralManagerDelegate {

    private static let RESTORATION_KEY = "com.zeohrm.blebeacon.peripheral"
    private static let DEFAULTS_USER_UUID = "ble_beacon_user_uuid"
    private static let DEFAULTS_COMPANY_UUID = "ble_beacon_company_uuid"
    private static let DEFAULTS_WAS_ADVERTISING = "ble_beacon_was_advertising"

    private var peripheralManager: CBPeripheralManager?
    private var pendingUserUuid: String?
    private var pendingCompanyUuid: String?
    private var isAdvertising = false

    // ── Cordova plugin methods ───────────────────────────────────────────────

    @objc(startAdvertising:)
    func startAdvertising(command: CDVInvokedUrlCommand) {
        guard let options = command.argument(at: 0) as? [String: Any],
              let userUuid = options["userUuid"] as? String,
              let companyUuid = options["companyServiceUuid"] as? String else {
            let result = CDVPluginResult(status: CDVCommandStatus_ERROR,
                                          messageAs: "userUuid and companyServiceUuid are required")
            self.commandDelegate.send(result, callbackId: command.callbackId)
            return
        }

        pendingUserUuid = userUuid
        pendingCompanyUuid = companyUuid

        let defaults = UserDefaults.standard
        defaults.set(userUuid, forKey: BleBeaconPlugin.DEFAULTS_USER_UUID)
        defaults.set(companyUuid, forKey: BleBeaconPlugin.DEFAULTS_COMPANY_UUID)
        defaults.set(true, forKey: BleBeaconPlugin.DEFAULTS_WAS_ADVERTISING)

        // Initialise with state restoration so iOS can resume after a background kill
        if peripheralManager == nil {
            let options: [String: Any] = [
                CBPeripheralManagerOptionRestoreIdentifierKey: BleBeaconPlugin.RESTORATION_KEY
            ]
            peripheralManager = CBPeripheralManager(delegate: self, queue: nil, options: options)
        } else {
            startAdvertisingIfReady()
        }

        let result = CDVPluginResult(status: CDVCommandStatus_OK)
        self.commandDelegate.send(result, callbackId: command.callbackId)
    }

    @objc(stopAdvertising:)
    func stopAdvertising(command: CDVInvokedUrlCommand) {
        peripheralManager?.stopAdvertising()
        isAdvertising = false
        UserDefaults.standard.set(false, forKey: BleBeaconPlugin.DEFAULTS_WAS_ADVERTISING)

        let result = CDVPluginResult(status: CDVCommandStatus_OK)
        self.commandDelegate.send(result, callbackId: command.callbackId)
    }

    @objc(getStatus:)
    func getStatus(command: CDVInvokedUrlCommand) {
        let result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: ["isRunning": isAdvertising])
        self.commandDelegate.send(result, callbackId: command.callbackId)
    }

    // ── CBPeripheralManagerDelegate ──────────────────────────────────────────

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            startAdvertisingIfReady()
        } else {
            isAdvertising = false
        }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            print("[BleBeaconPlugin] Advertising failed: \(error.localizedDescription)")
            isAdvertising = false
        } else {
            print("[BleBeaconPlugin] Advertising started")
            isAdvertising = true
        }
    }

    /// Called by iOS to restore peripheral state after a background termination.
    func peripheralManager(_ peripheral: CBPeripheralManager,
                            willRestoreState dict: [String: Any]) {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: BleBeaconPlugin.DEFAULTS_WAS_ADVERTISING) else { return }

        pendingUserUuid = defaults.string(forKey: BleBeaconPlugin.DEFAULTS_USER_UUID)
        pendingCompanyUuid = defaults.string(forKey: BleBeaconPlugin.DEFAULTS_COMPANY_UUID)
        print("[BleBeaconPlugin] State restored — will resume advertising")
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private func startAdvertisingIfReady() {
        guard let companyUuidStr = pendingCompanyUuid,
              let manager = peripheralManager,
              manager.state == .poweredOn else { return }

        guard let companyUuid = UUID(uuidString: companyUuidStr) else {
            print("[BleBeaconPlugin] Invalid company UUID: \(companyUuidStr)")
            return
        }

        let advertisementData: [String: Any] = [
            // The CBUUID the scanner filters on
            CBAdvertisementDataServiceUUIDsKey: [CBUUID(nsuuid: companyUuid)],
            CBAdvertisementDataLocalNameKey: "ZeoBeacon",
        ]

        manager.startAdvertising(advertisementData)
    }
}
