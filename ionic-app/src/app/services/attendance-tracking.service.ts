import { Injectable } from '@angular/core';
import { AuthService } from './auth';
import { SharedApi } from './shared-api';
import { environment } from 'src/environments/environment';

declare const cordova: any;

export type TrackingMode = 'office' | 'field_duty' | 'remote';

/** Cached per-employee BLE service UUID from GET /attendance/beacon-identity — see startBeacon(). */
const BEACON_UUID_STORAGE_KEY = 'zeohrm_beacon_service_uuid';

// TEMP FOR TESTING: field_duty/remote dropped to 1 minute to make the interval fix easy
// to observe live — revert both back to 30 minutes before shipping.
// Office is left at 1 minute (working fine as-is). Field Duty/Remote have no BLE beacon
// backstop for timing, but a 30-minute GPS interval is still enough to place them for
// attendance purposes without the battery/data cost of polling every minute all day.
const LOCATION_UPDATE_INTERVAL_MS: Record<TrackingMode, number> = {
  office: 1 * 60 * 1000,
  field_duty: 1 * 60 * 1000, // TEMP — was 30 * 60 * 1000
  remote: 1 * 60 * 1000, // TEMP — was 30 * 60 * 1000
};

/**
 * Orchestrates the two native background-tracking plugins (GPS foreground
 * service for Field Duty/Remote, BLE beacon advertising for Office). Runs
 * silently — no UI of its own; the existing check-in/out UI is unaffected.
 */
@Injectable({ providedIn: 'root' })
export class AttendanceTrackingService {

  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private authService: AuthService,
    private sharedApiService: SharedApi
  ) {}

  /**
   * Stops both native services (idempotent no-ops if not running — safe to call
   * unconditionally, since a fresh JS session after an app restart has no way to
   * know which one, if either, is currently alive natively) then starts the one(s)
   * for `mode`. Office runs both BLE and GPS concurrently — beacon proximity is
   * binary (seen or not), GPS is what lets the dashboard draw an actual trail.
   *
   * Chained onto `inFlight` rather than run directly: two overlapping calls (e.g. a
   * stray double-tap on "Confirm & Proceed") would otherwise interleave their native
   * stop/start intents to the same Android service, which has caused
   * ForegroundServiceDidNotStartInTimeException crashes in testing.
   */
  async startForMode(mode: TrackingMode): Promise<void> {
    const run = this.inFlight.then(async () => {
      await this.stop();

      // Fails open (logs and continues) rather than letting a rejected native
      // call propagate — the confirm handler in home.page.ts awaits this, and an
      // uncaught rejection here would silently abort the check-in with no
      // feedback to the user. A tracking hiccup shouldn't block the check-in
      // event itself from being recorded.
      try {
        if (mode === 'office') {
          await this.startBeacon();
          await this.startGps(mode);
        } else {
          await this.startGps(mode);
        }
      } catch (e) {
        console.error('AttendanceTrackingService: error starting tracking for mode', mode, e);
      }
    });
    this.inFlight = run.catch(() => {});
    return run;
  }

  async stop(): Promise<void> {
    await Promise.all([this.stopBeacon(), this.stopGps()]);

    // The plugin's stop calls resolve as soon as the STOP intent is *dispatched*,
    // not once the native service has actually torn itself down (stopForeground()
    // + stopSelf()). Without this gap, a same-mode restart's startForegroundService()
    // call can reach the OS before the prior stop's teardown finishes, and Android's
    // stopSelf() can then tear down the service instance the new call was targeting —
    // abandoning its startForeground() obligation and crashing the app with
    // ForegroundServiceDidNotStartInTimeException. Confirmed via on-device testing.
    await new Promise((resolve) => setTimeout(resolve, 300));

    await this.verifyStopped();
  }

  /**
   * getBlePlugin()/getGpsPlugin() can transiently return null (e.g. the WebView's
   * Cordova plugin bridge re-initializing after a memory-pressure reload) — if that
   * happens to land during stopBeacon()/stopGps(), the native stop call is silently
   * skipped with no error, checkout still records fine, and the already-running
   * native service just keeps advertising/tracking with nothing left to tell it to
   * stop. getStatus() reads a flag the native side only clears *inside* its own stop
   * handler, so it still correctly reports "running" in that case — this re-checks
   * shortly after, and if the plugin has since become available again, retries the
   * stop for real instead of trusting an unverified no-op as success.
   */
  private async verifyStopped(): Promise<void> {
    const blePlugin = this.getBlePlugin();
    if (blePlugin) {
      try {
        const status = await blePlugin.getStatus();
        if (status?.isRunning) {
          console.warn('AttendanceTrackingService: BLE advertising still reports running after stop — retrying');
          await blePlugin.stopAdvertising();
        }
      } catch (e) {
        console.error('AttendanceTrackingService: error verifying BLE advertising stopped:', e);
      }
    }

    const gpsPlugin = this.getGpsPlugin();
    if (gpsPlugin) {
      try {
        const status = await gpsPlugin.getStatus();
        if (status?.isRunning) {
          console.warn('AttendanceTrackingService: GPS tracking still reports running after stop — retrying');
          await gpsPlugin.stopTracking();
        }
      } catch (e) {
        console.error('AttendanceTrackingService: error verifying GPS tracking stopped:', e);
      }
    }
  }

  private async startBeacon(): Promise<void> {
    const plugin = this.getBlePlugin();
    if (!plugin) return;

    const companyServiceUuid = await this.getBeaconServiceUuid();
    if (!companyServiceUuid) {
      console.error('AttendanceTrackingService: could not resolve a beacon identity — not starting BLE advertising');
      return;
    }

    const userUuid = this.authService.getUserId();
    const userName = this.authService.getUserDisplayName() || this.authService.getUserEmail() || 'ZeoHRM User';

    await plugin.startAdvertising({
      userUuid,
      companyServiceUuid,
      userName,
    });
  }

  /**
   * Every employee advertises their own service UUID (companyPrefix + their
   * public.user.user_id) instead of one shared UUID — the Pi scanner can otherwise
   * never tell which employee a sighting belongs to, and on iOS the manufacturer-data
   * name never survives backgrounding at all, only the service UUID does. Cached
   * locally since it never changes for a given account.
   */
  private async getBeaconServiceUuid(): Promise<string | null> {
    const cached = localStorage.getItem(BEACON_UUID_STORAGE_KEY);
    if (cached) return cached;

    try {
      const beaconUuid = await this.sharedApiService.fetchBeaconIdentity();
      if (beaconUuid) {
        localStorage.setItem(BEACON_UUID_STORAGE_KEY, beaconUuid);
      }
      return beaconUuid;
    } catch (e) {
      console.error('AttendanceTrackingService: error fetching beacon identity:', e);
      return null;
    }
  }

  private async stopBeacon(): Promise<void> {
    const plugin = this.getBlePlugin();
    if (!plugin) {
      console.warn('AttendanceTrackingService: BleBeacon plugin unavailable — cannot stop advertising directly (verifyStopped() will retry once it is)');
      return;
    }
    try {
      await plugin.stopAdvertising();
    } catch (e) {
      console.error('AttendanceTrackingService: error stopping BLE advertising:', e);
    }
  }

  private async startGps(mode: TrackingMode): Promise<void> {
    const plugin = this.getGpsPlugin();
    if (!plugin) return;

    await plugin.startTracking({
      userId: this.authService.getUserId(),
      email: this.authService.getUserEmail(),
      apiUrl: environment.ATTENDANCE_LOCATION_API_URL,
      apiKey: environment.ATTENDANCE_LOCATION_API_KEY,
      interval: LOCATION_UPDATE_INTERVAL_MS[mode],
      mode,
      notificationTitle: 'ZeoHRM Location Tracking',
      notificationText: 'Tracking your location for attendance',
      notificationIcon: 'ic_notification',
    });
  }

  private async stopGps(): Promise<void> {
    const plugin = this.getGpsPlugin();
    if (!plugin) {
      console.warn('AttendanceTrackingService: BackgroundLocation plugin unavailable — cannot stop tracking directly (verifyStopped() will retry once it is)');
      return;
    }
    try {
      await plugin.stopTracking();
    } catch (e) {
      console.error('AttendanceTrackingService: error stopping GPS tracking:', e);
    }
  }

  /**
   * Fresh one-shot native location fix with mock-provider detection, for gating
   * Check In/Check Out at the moment of confirming. Returns null if the plugin isn't
   * available (e.g. running in a browser during development) or the native call fails —
   * callers should fail open in that case, since this is a best-effort deterrent against
   * fake-GPS apps, not a hard security boundary tied to app/plugin integrity.
   */
  async checkMockLocation(): Promise<{ latitude: number; longitude: number; accuracy: number; isMock: boolean } | null> {
    const plugin = this.getGpsPlugin();
    if (!plugin) return null;
    try {
      return await plugin.checkMockLocation();
    } catch (e) {
      console.error('AttendanceTrackingService: error checking mock location:', e);
      return null;
    }
  }

  /**
   * Live device check, not a permission check — Office check-in starts BLE
   * advertising, which silently no-ops natively if Bluetooth is off (see
   * BleAdvertiserService.java). Fails open (returns true) if the plugin is
   * unavailable, matching checkMockLocation()'s precedent: this is a best-effort
   * gate, not a hard security boundary.
   */
  async isBluetoothEnabled(): Promise<boolean> {
    const plugin = this.getBlePlugin();
    if (!plugin) return true;
    try {
      const result = await plugin.isBluetoothEnabled();
      return result?.enabled === true;
    } catch (e) {
      console.error('AttendanceTrackingService: error checking Bluetooth state:', e);
      return true;
    }
  }

  /**
   * Quiet Location-Services-on/off check via the GPS plugin — unlike
   * GeolocationService.requestHighAccuracy(), this never triggers a native
   * resolve dialog, so it's safe to poll repeatedly during an active session.
   */
  async isLocationServiceEnabled(): Promise<boolean> {
    const plugin = this.getGpsPlugin();
    if (!plugin) return true;
    try {
      const result = await plugin.isLocationServiceEnabled();
      return result?.enabled === true;
    } catch (e) {
      console.error('AttendanceTrackingService: error checking Location service state:', e);
      return true;
    }
  }

  /**
   * Self-healing check: the server-side check-in state (attendence_check_event_log)
   * and the native services' actual running state can drift apart — a force-stop,
   * an OS/OEM battery-optimization kill of a long-running foreground service, or a
   * reboot where BootReceiver didn't fire all leave the UI showing "Active
   * Attendance Session" while nothing is actually being broadcast/tracked, with no
   * error anywhere to say so. Callers should invoke this whenever the app resumes
   * or launches while already checked in, not just after a fresh check-in.
   */
  async ensureTrackingRunning(mode: TrackingMode): Promise<void> {
    const needsBle = mode === 'office';
    const [bleOk, gpsOk] = await Promise.all([
      needsBle ? this.isServiceRunning(this.getBlePlugin()) : Promise.resolve(true),
      this.isServiceRunning(this.getGpsPlugin()),
    ]);
    if (!bleOk || !gpsOk) {
      console.warn(`AttendanceTrackingService: tracking was expected to be running for ${mode} but wasn't (ble=${bleOk}, gps=${gpsOk}) — restarting`);
      await this.startForMode(mode);
    }
  }

  private async isServiceRunning(plugin: any): Promise<boolean> {
    if (!plugin) return true; // fail open — matches isBluetoothEnabled()/isLocationServiceEnabled() precedent
    try {
      const status = await plugin.getStatus();
      return status?.isRunning === true;
    } catch (e) {
      return true; // fail open — don't force an unnecessary restart on a transient error
    }
  }

  private getBlePlugin(): any {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.BleBeacon) {
      return null;
    }
    return cordova.plugins.BleBeacon;
  }

  private getGpsPlugin(): any {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.BackgroundLocation) {
      return null;
    }
    return cordova.plugins.BackgroundLocation;
  }
}
