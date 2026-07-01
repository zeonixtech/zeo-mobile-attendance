import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { authCodeFlowConfig } from '../auth-config';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';
import { Platform } from '@ionic/angular';

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
      ? 'zeohrmapp://auth/login'
      : (typeof window !== 'undefined' ? window.location.origin + '/auth/login' : 'http://localhost:8100/auth/login');

    console.log('AuthService dynamic redirectUri set:', authCodeFlowConfig.redirectUri);

    this.oauthService.configure(authCodeFlowConfig);
    this.oauthService.setupAutomaticSilentRefresh();
    this.oauthService.loadDiscoveryDocumentAndTryLogin({ disableNonceCheck: true }).then(() => {
      if (this.isAuthenticated()) {
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

    if (isMobile) {
      // 1. Generate Login URL with state and PKCE Challenge
      // Cast to 'any' to bypass TS compiler warning for protected method
      const loginUrl = await (this.oauthService as any).createLoginUrl();

      console.log("loginUrl__________________", loginUrl)

      // 2. Open login page in the secure InAppBrowser system context
      this.browser = this.iab.create(loginUrl, '_blank', 'location=no,clearsessioncache=yes,cleardata=yes');

      // 3. Listen to loadstart and loaderror events to catch the custom scheme redirect loop
      const handleRedirect = (event: any) => {
        if (authCodeFlowConfig.redirectUri && event.url.indexOf(authCodeFlowConfig.redirectUri) === 0) {
          this.closeBrowser();

          // Extract the code and state from the redirect URL
          const urlObj = new URL(event.url);
          const customHashFragment = urlObj.search ? urlObj.search.replace('?', '#') : '';

          // 4. Feed the code back into the library to finish the token exchange
          this.oauthService.tryLoginCodeFlow({ customHashFragment, disableNonceCheck: true }).then(() => {
            console.log('Login successful');
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
    } else {
      // In web browser, use standard redirect flow
      this.oauthService.initLoginFlow();
    }
  }

  public tryLoginCodeFlow(options?: any) {
    return this.oauthService.tryLoginCodeFlow({ disableNonceCheck: true, ...options });
  }

  public logout() {
    this.oauthService.logOut();
  }

  public getIdentityClaims() {
    return this.oauthService.getIdentityClaims();
  }

  public getAccessToken() {
    return this.oauthService.getAccessToken();
  }

  public isAuthenticated(): boolean {
    return this.oauthService.hasValidAccessToken();
  }
}
