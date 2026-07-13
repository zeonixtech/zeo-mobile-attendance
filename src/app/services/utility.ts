import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, lastValueFrom, Observable } from 'rxjs';
import { AuthService } from './auth';

@Injectable({
  providedIn: 'root',
})
export class Utility {

  constructor(
    private authService: AuthService,
    private httpClient: HttpClient
  ) { }

  /**
 * Function to call CRM API's
 * @param API_URL
 * @param payload
 * @param options
 * @returns
 */
  async crmApiReq(method: any, API_URL: string, payload: any = '', options: any = '') {
    let token: any = '';
    token = await this.authService.getAccessToken();

    if (token) {
      // token = await JSON.parse(this.sharedService.decrypt(token)); //JSON.parse(token);
      token = 'Bearer ' + token;
    }
    if (token != null) {
      options = {
        headers: new HttpHeaders({
          'Content-Type': 'application/json',
          Authorization: token
        })
      };
    } else {
      options = {
        headers: new HttpHeaders({
          'Content-Type': 'application/json'
        })
      };
    }
    // let API_URL: string = endPoint;  //+'&r='+window.location.href;
    switch (method) {
      case 'get':
        try {
          const response = await lastValueFrom(
            this.httpClient.get<any>(API_URL, options).pipe(
              catchError(async (error) => {
                return await error;
              })
            )
          );
          return await response;
        } catch (errorResponse: any) {
          let error: any = {
            status: 400,
            statusCode: errorResponse?.statusCode ? errorResponse?.statusCode : 400,
            message: errorResponse.message,
            error: {
              error: errorResponse.message
            }
          };
          return error;
        }
      case 'post':
        try {
          const response = await lastValueFrom(
            this.httpClient.post<any>(API_URL, payload, options).pipe(
              catchError(async (error) => {
                return await error;
              })
            )
          );
          return await response;
        } catch (errorResponse: any) {
          let error: any = {
            status: 400,
            message: errorResponse.message,
            error: {
              error: errorResponse.message
            }
          };
          return error;
        }
      case 'put':
        return this.httpClient.put(API_URL, payload);
      case 'patch':
        return this.httpClient.patch(API_URL, payload);
      case 'delete':
        return this.httpClient.delete(API_URL, payload);
      default:
        let na: any = [];
        return na;
    }
  }

  /**
   * Function to call grapgQl APIs
   * @param method
   * @param endPoint
   * @param payload
   * @param options
   * @returns
   */
  // apiReq(method: string, endPoint: string, payload?: any, logintoken: string = ''): Observable<any> {
  //   let token: any = logintoken;
  // if (this.cookieService.getItem('token')) {
  //   token = this.cookieService.getItem('token');
  //   token = JSON.parse(this.sharedService.decrypt(token)); //JSON.parse(token)
  //   token = "Bearer " + token?.access_token;
  // }
  // let headerOptions: any = {
  //   headers: new HttpHeaders({
  //     // eslint-disable-next-line @typescript-eslint/naming-convention
  //     'Content-Type': 'application/json',
  //     Authorization: token
  //   })
  // };
  // var API_URL = endPoint; //+'?r='+window.location.href;
  // switch (method) {
  //   case 'get':
  //     return this.httpClient.get(API_URL, headerOptions);
  //   case 'post':
  //     return this.httpClient.post(API_URL, payload, headerOptions);
  //   case 'put':
  //     return this.httpClient.put(API_URL, payload, headerOptions);
  //   case 'patch':
  //     return this.httpClient.patch(API_URL, payload);
  //   case 'delete':
  //     return this.httpClient.delete(API_URL, payload);
  //   default:
  //     let na: any = [];
  //     return na;
  // }
  // }
}
