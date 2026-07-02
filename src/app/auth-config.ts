import { AuthConfig } from 'angular-oauth2-oidc';
import { environment } from 'src/environments/environment';

export const commonMobileAppVariable = {
    MOBILE_APP_NAME: environment.MOBILE_APP_NAME,
    WSO2_URL: environment.WSO2_PARAMS.URL,
    WSO2_CLIENT_ID: environment.WSO2_PARAMS.CLIENT_ID,
    WSO2_RESPONSE_TYPE: environment.WSO2_PARAMS.RESPONSE_TYPE,
    WSO2_SCOPE: environment.WSO2_PARAMS.SCOPE,
}
export const authCodeFlowConfig: AuthConfig = {
    // Url of the Identity Provider
    issuer: environment.WSO2_PARAMS.URL + 'oauth2/token', //'https://stgauth.zeocrm.com/oauth2/token',

    // URL of the SPA to redirect the user after login
    // This matches what you registered in WSO2, and is set dynamically in AuthService
    redirectUri: typeof window !== 'undefined' ? window.location.origin + '/auth/login' : environment.baseUrl + 'auth/login',

    // The SPA's id. The SPA is registerd with this id at the auth-server
    clientId: environment.WSO2_PARAMS.CLIENT_ID, //'WnFiieo2oJTq_Le0MHgaqemcbWsa'

    // Just "openid" or "openid profile email" depending on your claims
    // scope: 'openid profile',
    scope: environment.WSO2_PARAMS.SCOPE,

    responseType: environment.WSO2_PARAMS.RESPONSE_TYPE, //'code',

    // WSO2 endpoint overrides if discovery document isn't fully utilized
    loginUrl: environment.WSO2_PARAMS.URL + 'oauth2/authorize', //'https://stgauth.zeocrm.com/oauth2/authorize',
    tokenEndpoint: environment.WSO2_PARAMS.URL + 'oauth2/token', //'https://stgauth.zeocrm.com/oauth2/token',
    userinfoEndpoint: environment.WSO2_PARAMS.URL + 'oauth2/userinfo', //'https://stgauth.zeocrm.com/oauth2/userinfo',
    oidc: true,

    // Required for public clients like Cordova
    useSilentRefresh: true,
    skipIssuerCheck: false,
    strictDiscoveryDocumentValidation: false,
    customQueryParams: {
        prompt: 'login'
    }
};