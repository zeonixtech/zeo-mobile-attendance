import { Component, OnInit, Input, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  standalone: false,
})
export class HeaderComponent implements OnInit {
  @Input() contentId: string = 'home-content';

  username = 'Employee';
  companyName = 'Zeonix Technologies';
  userImage = 'https://ionicframework.com/docs/img/demos/avatar.svg';

  constructor(
    private authService: AuthService,
    private router: Router,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    const claims = this.authService.getIdentityClaims();
    if (claims) {
      this.username = (claims as any).name || (claims as any).preferred_username || (claims as any).sub || 'Employee';
      this.companyName = (claims as any).company || (claims as any).organization || 'Zeonix Technologies';
      if ((claims as any).picture) {
        this.userImage = (claims as any).picture;
      }
    }
  }

  async logout() {
    console.log('HeaderComponent: logout clicked');
    try {
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
