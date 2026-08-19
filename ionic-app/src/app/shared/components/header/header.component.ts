import { Component, OnInit, Input, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth';
import { SharedApi } from 'src/app/services/shared-api';
import { environment } from 'src/environments/environment';
import { AlertController } from '@ionic/angular';
import { AttendanceTrackingService } from 'src/app/services/attendance-tracking.service';

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
  checkedIn = false;

  constructor(
    private authService: AuthService,
    private SharedApiService: SharedApi,
    private router: Router,
    private ngZone: NgZone,
    private alertController: AlertController,
    private attendanceTrackingService: AttendanceTrackingService
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

    const history = await this.SharedApiService.fetchAttendanceHistory();
    const checkEvents = history
      .filter((e) => e.type === 'check-in' || e.type === 'check-out')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    this.checkedIn = checkEvents.length > 0 && checkEvents[0].type === 'check-in';
  }

  get selectedPerimeterName(): string {
    const selected = localStorage.getItem('selected_perimeter');
    if (selected === 'office') return 'Office';
    if (selected === 'field_duty') return 'Field Duty';
    if (selected === 'remote') return 'Remote Work';
    return '';
  }

  switchMode() {
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
