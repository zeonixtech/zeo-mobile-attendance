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

  logout() {
    this.authService.logout();
    this.ngZone.run(() => {
      this.router.navigate(['/auth/login']);
    });
  }
}
