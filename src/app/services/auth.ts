import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { authCodeFlowConfig, commonMobileAppVariable } from '../auth-config';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';
import { Platform } from '@ionic/angular';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private browser: any;

  constructor(
    private oauthService: OAuthService,
    private iab: InAppBrowser,
    private router: Router,
    private zone: NgZone,
    private platform: Platform
  ) {
    this.configure();
  }

  private configure() {
    const isMobile = this.platform.is('cordova') || this.platform.is('capacitor');
    authCodeFlowConfig.redirectUri = isMobile
      ? commonMobileAppVariable.MOBILE_APP_NAME + '://auth/login'
      : (typeof window !== 'undefined' ? window.location.origin + '/auth/login' : environment.baseUrl + 'auth/login');

    console.log('AuthService dynamic redirectUri set:', authCodeFlowConfig.redirectUri);

    this.oauthService.configure(authCodeFlowConfig);
    this.oauthService.loadDiscoveryDocumentAndTryLogin({ disableNonceCheck: true }).then(() => {
      if (this.isAuthenticated()) {
        this.oauthService.setupAutomaticSilentRefresh();
        this.zone.run(() => {
          this.router.navigate(['/home']);
        });
      }
    });
  }

  public closeBrowser() {
    if (this.browser) {
      try {
        this.browser.close();
      } catch (err) {
        console.error('Error closing InAppBrowser:', err);
      }
      this.browser = null;
    }
  }

  public async login() {
    const isMobile = this.platform.is('cordova') || this.platform.is('capacitor');
    console.log('AuthService: login called, isMobile =', isMobile);

    if (isMobile) {
      try {
        // 1. Generate Login URL with state and PKCE Challenge
        // Cast to 'any' to bypass TS compiler warning for protected method
        console.log('AuthService: Calling createLoginUrl');
        const loginUrl = await (this.oauthService as any).createLoginUrl();

        console.log("loginUrl__________________", loginUrl)

        // 2. Open login page in the secure InAppBrowser system context
        console.log('AuthService: Opening login InAppBrowser');
        this.browser = this.iab.create(loginUrl, '_blank', 'location=no,clearsessioncache=yes,cleardata=yes');

        // 3. Listen to loadstart and loaderror events to catch the custom scheme redirect loop
        const handleRedirect = (event: any) => {
          console.log('AuthService login redirect event:', event.url);
          if (authCodeFlowConfig.redirectUri && event.url.indexOf(authCodeFlowConfig.redirectUri) === 0) {
            this.closeBrowser();

            // Extract the code and state from the redirect URL
            const urlObj = new URL(event.url);
            const customHashFragment = urlObj.search ? urlObj.search.replace('?', '#') : '';

            // 4. Feed the code back into the library to finish the token exchange
            console.log('AuthService: tryLoginCodeFlow starting');
            this.oauthService.tryLoginCodeFlow({ customHashFragment, disableNonceCheck: true }).then(() => {
              console.log('Login successful');
              this.oauthService.setupAutomaticSilentRefresh();
              this.zone.run(() => {
                this.router.navigate(['/home']);
              });
            }).catch((err) => {
              console.error('Error in login code flow: ', err);
            });
          }
        };

        this.browser.on('loadstart').subscribe(handleRedirect);
        this.browser.on('loaderror').subscribe(handleRedirect);
        this.browser.on('customscheme').subscribe(handleRedirect);
      } catch (err) {
        console.error('Error in login initiation:', err);
      }
    } else {
      console.log('AuthService: login starting on web');
      // In web browser, use standard redirect flow
      this.oauthService.initLoginFlow();
    }
  }

  public tryLoginCodeFlow(options?: any) {
    return this.oauthService.tryLoginCodeFlow({ disableNonceCheck: true, ...options });
  }

  public logout(): Promise<void> {
    localStorage.removeItem('selected_perimeter');
    const isMobile = this.platform.is('cordova') || this.platform.is('capacitor');
    console.log('AuthService: logout called, isMobile =', isMobile);

    if (isMobile) {
      return new Promise<void>((resolve) => {
        const idToken = this.oauthService.getIdToken() || '';
        this.oauthService.logOut(true);

        const logoutUrl = commonMobileAppVariable.WSO2_URL + 'oidc/logout' +
          '?id_token_hint=' + encodeURIComponent(idToken) +
          '&post_logout_redirect_uri=' + encodeURIComponent(commonMobileAppVariable.MOBILE_APP_NAME + '://auth/login');

        console.log('Mobile logoutUrl:', logoutUrl);

        // Open logout URL in a hidden InAppBrowser to clear session on the server
        const browser = this.iab.create(logoutUrl, '_blank', 'location=no,hidden=yes,clearsessioncache=yes,cleardata=yes');

        let resolved = false;
        const doResolve = (source: string) => {
          console.log('AuthService logout doResolve called from:', source);
          if (!resolved) {
            resolved = true;
            try {
              browser.close();
            } catch (e) {
              console.error('Error closing logout browser:', e);
            }
            // Add a short delay to let native InAppBrowser fully close before resolving
            setTimeout(() => {
              console.log('AuthService logout resolving Promise');
              resolve();
            }, 800);
          }
        };

        browser.on('loadstart').subscribe((event) => {
          console.log('AuthService logout loadstart:', event.url);
          if (event.url.indexOf(commonMobileAppVariable.MOBILE_APP_NAME + '://auth') === 0) {
            doResolve('loadstart');
          }
        });

        browser.on('customscheme').subscribe((event) => {
          console.log('AuthService logout customscheme:', event.url);
          if (event.url.indexOf(commonMobileAppVariable.MOBILE_APP_NAME + '://auth') === 0) {
            doResolve('customscheme');
          }
        });

        browser.on('loaderror').subscribe((event) => {
          console.log('AuthService logout loaderror:', event.url);
          if (event.url.indexOf(commonMobileAppVariable.MOBILE_APP_NAME + '://auth') === 0) {
            doResolve('loaderror');
          }
        });

        browser.on('loadstop').subscribe((event) => {
          console.log('AuthService logout loadstop:', event.url);
          // If the page loads successfully (e.g. no redirect or slow redirect),
          // resolve after 1.5 seconds so user has feedback and session is cleared
          setTimeout(() => {
            doResolve('loadstop');
          }, 1500);
        });

        browser.on('exit').subscribe(() => {
          console.log('AuthService logout exit');
          doResolve('exit');
        });
      });
    } else {
      console.log('AuthService: Web logout starting');
      this.oauthService.logOut();
      return Promise.resolve();
    }
  }

  public getIdentityClaims() {
    return this.oauthService.getIdentityClaims();
  }

  public getAccessToken() {
    return this.oauthService.getAccessToken();
  }

  public setupAutomaticSilentRefresh() {
    this.oauthService.setupAutomaticSilentRefresh();
  }

  public isAuthenticated(): boolean {
    return this.oauthService.hasValidAccessToken();
  }
}
