import { Component, OnInit, NgZone } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Platform, ViewWillEnter } from '@ionic/angular';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { AuthService } from '../../services/auth';

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
        if (url.includes('zeohrmapp://auth') && (url.includes('code=') || url.includes('error=') || url.includes('state='))) {
          // Process the code extraction if it bypassed the InAppBrowser context
          const urlObj = new URL(url);
          const customHashFragment = urlObj.search ? urlObj.search.replace('?', '#') : '';
          this.authService.tryLoginCodeFlow({ customHashFragment }).then(() => {
            this.authService.closeBrowser();
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
    this.platform.ready().then(() => {
      console.log('AuthSigninComponent: Platform ready resolved');
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

  /**
   * Generates the WSO2 SSO authorization URL and opens it.
   */
  initiateLogin() {
    const ssoBaseUrl =
      environment?.SAML_PARAMS?.URL +
      'authorize?response_type=' +
      environment?.SAML_PARAMS?.RESPONSE_TYPE +
      '&client_id=' +
      environment?.SAML_PARAMS?.CLIENT_ID +
      '&redirect_uri=' +
      encodeURIComponent(environment?.SAML_PARAMS?.REDIRECT_URL || '') +
      '&referrer=' +
      encodeURIComponent(environment?.SAML_PARAMS?.REFERRER || '') +
      '&scope=' +
      encodeURIComponent(environment?.SAML_PARAMS?.SCOPE || '');

    if (environment?.production === false) {
      // In development/web browser, redirect the current window location
      window.location.href = ssoBaseUrl;
    } else {
      // In mobile app (Cordova), open in InAppBrowser
      const browser = this.iab.create(ssoBaseUrl, '_blank', 'location=no,clearcache=yes,clearsessioncache=yes');

      browser.on('loadstart').subscribe((event) => {
        // Intercept redirect URL containing authorization code
        if (event.url.includes('code=')) {
          const match = event.url.match(/[?&]code=([^&#]+)/);
          if (match) {
            const code = match[1];
            browser.close();
            this.handleAuthorizationCode(code);
          }
        }
      });
    }
  }

  /**
   * Exchanges the authorization code for access, refresh, and ID tokens from WSO2.
   */
  handleAuthorizationCode(code: string) {
    this.isLoading = true;
    const tokenUrl = environment?.SAML_PARAMS?.URL + 'token';

    const body = new HttpParams()
      .set('grant_type', 'authorization_code')
      .set('code', code)
      .set('redirect_uri', environment?.SAML_PARAMS?.REDIRECT_URL || '')
      .set('client_id', environment?.SAML_PARAMS?.CLIENT_ID || '')
      .set('client_secret', environment?.SAML_PARAMS?.CLIENT_SECRTE || ''); // Using CLIENT_SECRTE as spelled in environment config

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded'
    });

    this.http.post<any>(tokenUrl, body.toString(), { headers }).subscribe({
      next: (tokens) => {
        if (tokens?.access_token) {
          this.setCookie('access_token', tokens.access_token, 7);
        }
        if (tokens?.refresh_token) {
          this.setCookie('refresh_token', tokens.refresh_token, 7);
        }
        if (tokens?.id_token) {
          this.setCookie('id_token', tokens.id_token, 7);
        }

        this.isLoading = false;
        this.zone.run(() => {
          this.router.navigate(['/home']);
        });
      },
      error: (error) => {
        this.isLoading = false;
        console.error('WSO2 token exchange failed:', error);
        // Fallback: Retry login if token exchange failed
        this.initiateLogin();
      }
    });
  }

  /**
   * Helper to set a cookie.
   */
  private setCookie(name: string, value: string, days?: number) {
    let expires = '';
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Lax';
  }

  /**
   * Helper to get a cookie value by name.
   */
  private getCookie(name: string): string | null {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') {
        c = c.substring(1, c.length);
      }
      if (c.indexOf(nameEQ) === 0) {
        return c.substring(nameEQ.length, c.length);
      }
    }
    return null;
  }
}
