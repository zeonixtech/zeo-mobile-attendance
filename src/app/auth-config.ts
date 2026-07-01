import { AuthConfig } from 'angular-oauth2-oidc';

const isMobile = typeof window !== 'undefined' && ((window as any).cordova !== undefined || (window as any).Capacitor !== undefined);


console.log("isMobile++++++++++++++++++++++++++++++++++", isMobile)
export const authCodeFlowConfig: AuthConfig = {
    // Url of the Identity Provider
    issuer: 'https://auth.localhost.com/oauth2/token',

    // URL of the SPA to redirect the user after login
    // This matches what you registered in WSO2
    redirectUri: isMobile ? 'zeohrmapp://auth/login' : (typeof window !== 'undefined' ? window.location.origin + '/auth/login' : 'http://localhost:8100/auth/login'),
    // redirectUri: 'http://localhost:4200/auth/login',

    // The SPA's id. The SPA is registerd with this id at the auth-server
    clientId: 'aVmW5ZAiMwljuKBfZmdJE98lby8a',

    // Just "openid" or "openid profile email" depending on your claims
    scope: 'openid profile',

    responseType: 'code',

    // WSO2 endpoint overrides if discovery document isn't fully utilized
    loginUrl: 'https://auth.localhost.com/oauth2/authorize',
    tokenEndpoint: 'https://auth.localhost.com/oauth2/token',
    userinfoEndpoint: 'https://auth.localhost.com/oauth2/userinfo',

    oidc: true,

    // Required for public clients like Cordova
    useSilentRefresh: true,
    skipIssuerCheck: false,
    strictDiscoveryDocumentValidation: false,
    customQueryParams: {
        prompt: 'login'
    }
};