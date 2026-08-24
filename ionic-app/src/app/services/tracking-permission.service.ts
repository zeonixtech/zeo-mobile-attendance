import { Injectable } from '@angular/core';

declare const cordova: any;

export type PermissionCheckResult = 'granted' | 'denied' | 'permanently-denied';

export type TrackingMode = 'office' | 'field_duty' | 'remote';

const BLUETOOTH_PERMISSIONS = [
  'android.permission.BLUETOOTH_ADVERTISE',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
];

const FOREGROUND_LOCATION_PERMISSIONS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
];

const BACKGROUND_LOCATION_PERMISSION = 'android.permission.ACCESS_BACKGROUND_LOCATION';
const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';

/** Android stops showing its own permission dialog after this many denied requests. */
const MAX_PROMPT_ATTEMPTS = 2;
const ATTEMPT_STORAGE_PREFIX = 'zeohrm_permission_attempts_';

@Injectable({ providedIn: 'root' })
export class TrackingPermissionService {

  permissionsFor(mode: TrackingMode): string[] {
    // Office check-in runs BLE advertising AND GPS tracking side by side
    // (see AttendanceTrackingService.startForMode), so it needs the same
    // location permissions the GPS-only modes need, plus Bluetooth.
    if (mode === 'office') {
      return [...BLUETOOTH_PERMISSIONS, ...FOREGROUND_LOCATION_PERMISSIONS, BACKGROUND_LOCATION_PERMISSION, NOTIFICATION_PERMISSION];
    }
    return [...FOREGROUND_LOCATION_PERMISSIONS, BACKGROUND_LOCATION_PERMISSION, NOTIFICATION_PERMISSION];
  }

  private get permissionsPlugin(): any {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.permissions) {
      return null;
    }
    return cordova.plugins.permissions;
  }

  async hasRequiredPermissions(mode: TrackingMode): Promise<boolean> {
    const plugin = this.permissionsPlugin;
    if (!plugin) return true; // browser/dev fallback — nothing to check

    const results = await Promise.all(this.permissionsFor(mode).map(p => this.checkOne(plugin, p)));
    return results.every(granted => granted);
  }

  /**
   * Requests every permission required for `mode`; the caller loops on 'denied'.
   * Foreground location must be granted before background location can even be
   * requested (Android 11+ rule), so GPS modes request in two passes.
   */
  async requestPermissions(mode: TrackingMode): Promise<PermissionCheckResult> {
    const plugin = this.permissionsPlugin;
    if (!plugin) return 'granted'; // browser/dev fallback

    // Android 11+ rejects requesting background location alongside foreground
    // permissions in the same call, so every mode requests foreground (+ Bluetooth
    // for office) first, then background location as a separate second pass.
    const firstPassPermissions = mode === 'office'
      ? [...BLUETOOTH_PERMISSIONS, ...FOREGROUND_LOCATION_PERMISSIONS, NOTIFICATION_PERMISSION]
      : [...FOREGROUND_LOCATION_PERMISSIONS, NOTIFICATION_PERMISSION];

    const firstPass = await this.requestAndEvaluate(mode, plugin, firstPassPermissions);
    if (firstPass !== 'granted') {
      return firstPass;
    }
    return this.requestAndEvaluate(mode, plugin, [BACKGROUND_LOCATION_PERMISSION]);
  }

  /** Deep-links into the app's system Settings page (native action added to cordova-plugin-background-location). */
  openAppSettings(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.BackgroundLocation) {
        resolve();
        return;
      }
      cordova.plugins.BackgroundLocation.openAppSettings(() => resolve(), () => resolve());
    });
  }

  /** Clears the denial counter — call once permissions are confirmed granted (e.g. after returning from Settings). */
  resetAttempts(mode: TrackingMode): void {
    localStorage.removeItem(ATTEMPT_STORAGE_PREFIX + mode);
  }

  /** Fails open (true) if the plugin is unavailable — matches this service's checkPermission fallbacks. */
  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.BackgroundLocation) return true;
    try {
      const result = await cordova.plugins.BackgroundLocation.isIgnoringBatteryOptimizations();
      return result?.ignoring === true;
    } catch (e) {
      return true;
    }
  }

  /** Launches Android's system dialog; there's no callback for the user's actual choice, only for the dialog opening. */
  async requestIgnoreBatteryOptimizations(): Promise<void> {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.BackgroundLocation) return;
    try {
      await cordova.plugins.BackgroundLocation.requestIgnoreBatteryOptimizations();
    } catch (e) {
      // user declined the exemption or the dialog couldn't be shown — nothing more to do
    }
  }

  private checkOne(plugin: any, permission: string): Promise<boolean> {
    return new Promise((resolve) => {
      plugin.checkPermission(permission, (status: any) => resolve(!!status?.hasPermission), () => resolve(false));
    });
  }

  private async requestAndEvaluate(mode: TrackingMode, plugin: any, permissions: string[]): Promise<PermissionCheckResult> {
    await new Promise<void>((resolve) => {
      plugin.requestPermissions(permissions, () => resolve(), () => resolve());
    });

    const results = await Promise.all(permissions.map(p => this.checkOne(plugin, p)));
    if (results.every(g => g)) {
      this.resetAttempts(mode);
      return 'granted';
    }

    const attempts = this.bumpAttempts(mode);
    return attempts >= MAX_PROMPT_ATTEMPTS ? 'permanently-denied' : 'denied';
  }

  private bumpAttempts(mode: TrackingMode): number {
    const key = ATTEMPT_STORAGE_PREFIX + mode;
    const next = (parseInt(localStorage.getItem(key) || '0', 10) || 0) + 1;
    localStorage.setItem(key, String(next));
    return next;
  }
}
