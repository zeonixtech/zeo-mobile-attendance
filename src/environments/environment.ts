// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.
const COMMON_VARIABLES = {
  AUTH_BASE_URL: 'https://auth.localhost.com/',
  REDIRECT_URL: 'http://localhost:4200'
};

export const environment = {
  baseUrl: COMMON_VARIABLES.AUTH_BASE_URL,
  JWT_REFRESH_TOKEN_TIME_DURATION: 600,
  production: false,
  officeLatitude: 30.740416,
  officeLongitude: 76.780692,
  geofenceRadius: 500,
  apiBaseUrl: 'https://your-api-endpoint.com/api',
  googleMapsApiKey: 'AIzaSyDIedV7A4bRZnITIsYpU1IZDqMfA9zVNyM',

  SAML_PARAMS: {
    URL: COMMON_VARIABLES.AUTH_BASE_URL + 'oauth2/',
    RESPONSE_TYPE: 'code',
    CLIENT_ID: 'udDgoi8KAHIVdAyVptDlTbdjlV0a',
    CLIENT_SECRTE: 'o0OKZjhl8fzIojrs_paJtrf_MmQJ3Gxa1rSAMO8zygoa',
    REDIRECT_URL: COMMON_VARIABLES.REDIRECT_URL + '/auth',
    REDIRECT_LOGOUT_URL: COMMON_VARIABLES.REDIRECT_URL + '/auth/logout',
    REFERRER: COMMON_VARIABLES.REDIRECT_URL + '&',
    SCOPE: 'openid profile email roles groups'
  },
  CRM_API: 'https://api.localhost.com/api/v1/',
  GRAPHQL_API: 'https://gql.localhost.com/graphql'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
