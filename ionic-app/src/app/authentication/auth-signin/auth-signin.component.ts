import { Component, OnInit, NgZone } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Platform, ViewWillEnter } from '@ionic/angular';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { commonMobileAppVariable } from 'src/app/auth-config';

import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-auth-signin',
  templateUrl: './auth-signin.component.html',
  styleUrls: ['./auth-signin.component.scss'],
  standalone: false,
})
export class AuthSigninComponent implements OnInit, ViewWillEnter {
  isLoading = false;

  constructor(
    private iab: InAppBrowser,
    private platform: Platform,
    private router: Router,
    private route: ActivatedRoute,
    private http: HttpClient,
    private zone: NgZone,
    private authService: AuthService
  ) {
    this.initializeApp();
  }


  initializeApp() {
    this.platform.ready().then(() => {
      // Handle background/resume intents from Custom URL scheme
      (window as any).handleOpenURL = (url: string) => {
        // Only handle login auth callbacks that contain a code, error, or state to avoid disrupting logout redirects
        if (url.includes(commonMobileAppVariable.MOBILE_APP_NAME + '://auth') && (url.includes('code=') || url.includes('error=') || url.includes('state='))) {
          // Process the code extraction if it bypassed the InAppBrowser context
          const urlObj = new URL(url);
          const customHashFragment = urlObj.search ? urlObj.search.replace('?', '#') : '';
          this.authService.tryLoginCodeFlow({ customHashFragment }).then(() => {
            this.authService.closeBrowser();
            this.authService.setupAutomaticSilentRefresh();
            this.zone.run(() => {
              this.router.navigate(['/home']);
            });
          }).catch(err => {
            console.error('Error logging in via Custom URL scheme:', err);
          });
        }
      };
    });
  }

  ngOnInit() {
    console.log('AuthSigninComponent: ngOnInit starting');
  }

  ionViewWillEnter() {
    console.log('AuthSigninComponent: ionViewWillEnter starting');
    // Wait for AuthService's own oauthService.configure() to have run — a separate
    // platform.ready() wait here can resolve before (or after) AuthService's, and calling
    // login() against an unconfigured OAuthService silently breaks the redirect.
    this.authService.whenConfigured().then(() => {
      console.log('AuthSigninComponent: AuthService configured');
      // Prevent triggering a new login flow if the URL contains an auth code (callback phase)
      const hasCode = typeof window !== 'undefined' &&
        (window.location.search.includes('code=') || window.location.hash.includes('code='));

      console.log('AuthSigninComponent: hasCode =', hasCode);
      if (hasCode) {
        console.log('Detected authorization code in URL, waiting for token exchange...');
        return;
      }

      if (this.authService.isAuthenticated()) {
        console.log('AuthSigninComponent: User is authenticated, navigating to /home');
        this.zone.run(() => {
          this.router.navigate(['/home']);
        });
      } else {
        console.log('AuthSigninComponent: User is NOT authenticated, calling login()');
        this.authService.login();
      }
    });
  }


}
