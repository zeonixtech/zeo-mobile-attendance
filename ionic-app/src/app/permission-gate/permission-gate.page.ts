import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TrackingPermissionService, PermissionCheckResult, TrackingMode } from '../services/tracking-permission.service';

@Component({
  selector: 'app-permission-gate',
  templateUrl: './permission-gate.page.html',
  styleUrls: ['./permission-gate.page.scss'],
  standalone: false,
})
export class PermissionGatePage implements OnInit, OnDestroy {
  mode: TrackingMode = 'office';
  state: 'checking' | 'denied' | 'permanently-denied' | 'granting' = 'checking';

  constructor(
    private trackingPermissionService: TrackingPermissionService,
    private router: Router,
    private zone: NgZone
  ) {}

  async ngOnInit() {
    this.mode = (localStorage.getItem('selected_perimeter') as TrackingMode) || 'office';
    document.addEventListener('resume', this.onResume, false);
    await this.checkAndProceed();
  }

  ngOnDestroy() {
    document.removeEventListener('resume', this.onResume);
  }

  get modeDescription(): string {
    if (this.mode === 'office') {
      return 'ZeoHRM needs Bluetooth and notification permissions to confirm your presence at the office while the app is closed or your phone is locked.';
    }
    return 'ZeoHRM needs location and notification permissions to verify your attendance while the app is closed or your phone is locked.';
  }

  async requestPermission() {
    this.state = 'granting';
    const result = await this.trackingPermissionService.requestPermissions(this.mode);
    await this.handleResult(result);
  }

  async openSettings() {
    await this.trackingPermissionService.openAppSettings();
    // Re-checked automatically when the app resumes after returning from Settings.
  }

  private onResume = () => {
    this.zone.run(() => this.checkAndProceed());
  };

  private async checkAndProceed() {
    const granted = await this.trackingPermissionService.hasRequiredPermissions(this.mode);
    if (granted) {
      await this.proceedToHome();
      return;
    }
    if (this.state === 'checking') {
      this.state = 'denied';
    }
  }

  private async handleResult(result: PermissionCheckResult) {
    if (result === 'granted') {
      await this.proceedToHome();
      return;
    }
    this.state = result;
  }

  private async proceedToHome() {
    // Background tracking (BLE beacon / GPS) no longer starts here — it's gated to
    // the Check In / Check Out buttons on HomePage now, so a mode switch or a fresh
    // permission grant alone doesn't start broadcasting until the user actually checks in.
    this.trackingPermissionService.resetAttempts(this.mode);
    await this.maybePromptBatteryExemption();
    this.zone.run(() => {
      this.router.navigate(['/home'], { replaceUrl: true });
    });
  }

  /**
   * One-time, regardless of mode — GPS tracking runs in every mode, not just Office,
   * so this isn't gated to a specific one. Without this exemption, a long-running
   * foreground service left idle (e.g. overnight) is a real risk of being killed by
   * OS/OEM battery management with nothing in the app noticing (see
   * AttendanceTrackingService.ensureTrackingRunning() for the self-healing half of
   * this fix). Flagged in localStorage before prompting so a decline doesn't re-nag
   * on every subsequent app open or mode switch.
   */
  private async maybePromptBatteryExemption() {
    const PROMPTED_KEY = 'zeohrm_battery_exemption_prompted';
    if (localStorage.getItem(PROMPTED_KEY)) return;
    localStorage.setItem(PROMPTED_KEY, 'true');

    const alreadyExempt = await this.trackingPermissionService.isIgnoringBatteryOptimizations();
    if (!alreadyExempt) {
      await this.trackingPermissionService.requestIgnoreBatteryOptimizations();
    }
  }
}
