import { Component, OnInit, Input, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth';
import { SharedApi } from 'src/app/services/shared-api';
import { environment } from 'src/environments/environment';
import { AlertController } from '@ionic/angular';
import { AttendanceTrackingService } from 'src/app/services/attendance-tracking.service';
import { GeolocationService } from 'src/app/services/geolocation.service';
import { DeviceInfoService } from 'src/app/services/device-info.service';
import { HistoryEntry } from '../../../attendance/attendance.page';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  standalone: false,
})
export class HeaderComponent implements OnInit {
  @Input() contentId: string = 'home-content';
  @Input() showBackButton: boolean = false;

  username = 'Employee';
  companyName = 'Zeonix Technologies';
  userImage: string = 'https://ionicframework.com/docs/img/demos/avatar.svg';

  constructor(
    private authService: AuthService,
    private SharedApiService: SharedApi,
    private router: Router,
    private ngZone: NgZone,
    private alertController: AlertController,
    private attendanceTrackingService: AttendanceTrackingService,
    private geolocationService: GeolocationService,
    private deviceInfoService: DeviceInfoService
  ) { }

  async ngOnInit() {
    const claims = await this.authService.getIdentityClaims();
    if ((claims as any).given_name) {

      let givenName: any = (claims as any).given_name ? (claims as any).given_name : "";
      let familyName = (claims as any).family_name ? (claims as any).family_name : "";
      this.username = `${givenName} ${familyName}`.trim();

      let loginUserDetails: any = await this.SharedApiService.fetchLoginDetails();
      if (loginUserDetails?.profile_photo) {
        let token: string = await this.authService.getAccessToken();
        this.userImage = environment.CRM_API + 'viewdocument/' + loginUserDetails?.profile_photo + '?token=' + token;
      }

      if (loginUserDetails?.company?.name) {
        this.companyName = loginUserDetails?.company?.name;
      }

    }
  }

  get selectedPerimeterName(): string {
    const selected = localStorage.getItem('selected_perimeter');
    if (selected === 'office') return 'Office';
    if (selected === 'field_duty') return 'Field Duty';
    if (selected === 'remote') return 'Remote Work';
    return '';
  }

  /**
   * Checks live state at the moment of the call rather than a cached flag — this
   * component doesn't hook ionViewWillEnter, so a cached "checked in" boolean set
   * once in ngOnInit would go stale for the rest of the session the moment the
   * user actually checks in.
   */
  private async getLatestCheckEvent(): Promise<HistoryEntry | null> {
    const history = await this.SharedApiService.fetchAttendanceHistory();
    const checkEvents = history
      .filter((e) => e.type === 'check-in' || e.type === 'check-out')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return checkEvents[0] || null;
  }

  async switchMode() {
    const checkedIn = (await this.getLatestCheckEvent())?.type === 'check-in';

    if (checkedIn) {
      const alert = await this.alertController.create({
        header: 'Check Out First',
        message: 'You are currently checked in. Please check out before switching your attendance mode.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    this.ngZone.run(() => {
      this.router.navigate(['/select-option'], { queryParams: { switching: 'true' } });
    });
  }

  async logout() {
    console.log('HeaderComponent: logout clicked');
    const alert = await this.alertController.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to logout?',
      backdropDismiss: false,
      buttons: [
        {
          text: 'No',
          role: 'cancel',
          handler: () => {
            console.log('Logout cancelled');
          }
        },
        {
          text: 'Yes',
          handler: async () => {
            try {
              // If still checked in, record a checkout before tearing anything down —
              // otherwise attendanceTrackingService.stop() below silences the device
              // but the backend still shows the last event as check-in indefinitely,
              // since nothing else ever posts the matching checkout.
              const latest = await this.getLatestCheckEvent();
              if (latest?.type === 'check-in') {
                const position = this.geolocationService.getCurrentPositionValue();
                if (position) {
                  await this.SharedApiService.postCheckEvent(
                    'check-out',
                    this.selectedPerimeterName || 'Office',
                    position.latitude,
                    position.longitude,
                    false,
                    this.deviceInfoService.getDeviceInfo()
                  );
                } else {
                  console.warn('HeaderComponent: logging out while checked in but no cached position available — skipping auto checkout');
                }
              }

              await this.attendanceTrackingService.stop();
              await this.authService.logout();
              console.log('HeaderComponent: authService.logout completed');
              this.ngZone.run(() => {
                console.log('HeaderComponent: Navigating to /auth/login');
                this.router.navigate(['/auth/login']).then(nav => {
                  console.log('HeaderComponent: Navigation outcome:', nav);
                }).catch(err => {
                  console.error('HeaderComponent: Navigation error:', err);
                });
              });
            } catch (e) {
              console.error('HeaderComponent: logout error', e);
            }
          }
        }
      ]
    });

    await alert.present();
  }

  goBack() {
    this.router.navigate(['/home']);
  }
}
