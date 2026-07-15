import { Injectable, Injector, NgZone } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse,
  HttpResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { AuthService } from './auth';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isAlertShowing = false;

  constructor(
    private injector: Injector,
    private router: Router,
    private alertController: AlertController,
    private ngZone: NgZone
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      tap((event: HttpEvent<any>) => {
        if (event instanceof HttpResponse) {
          if (this.isSessionExpiredError(event.status, event.body)) {
            this.handleSessionExpired();
          }
        }
      }),
      catchError((error: any) => {
        if (error instanceof HttpErrorResponse) {
          if (this.isSessionExpiredError(error.status, error.error)) {
            this.handleSessionExpired();
          }
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Helper to check if the error status and response body match the session expired condition.
   * Status must not be 200 or 201, and the response must contain errorCode "AUTH_401".
   */
  private isSessionExpiredError(status: number, body: any): boolean {
    if (status === 200 || status === 201) {
      return false;
    }
    if (!body) {
      return false;
    }
    if (typeof body === 'object') {
      return body.errorCode === 'AUTH_401';
    }
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return parsed.errorCode === 'AUTH_401';
      } catch {
        return body.includes('AUTH_401');
      }
    }
    return false;
  }

  /**
   * Triggers the "Session Expired" alert popup and executes the logout flow.
   */
  private async handleSessionExpired() {
    if (this.isAlertShowing) {
      return;
    }
    this.isAlertShowing = true;

    const authService = this.injector.get(AuthService);

    const alert = await this.alertController.create({
      header: 'Session Expired',
      message: 'Your session has expired. Please log in again.',
      backdropDismiss: false,
      buttons: [
        {
          text: 'Logout',
          handler: async () => {
            this.isAlertShowing = false;
            try {
              await authService.logout();
              this.ngZone.run(() => {
                this.router.navigate(['/auth/login']);
              });
            } catch (e) {
              console.error('Interceptor logout error:', e);
              this.ngZone.run(() => {
                this.router.navigate(['/auth/login']);
              });
            }
          }
        }
      ]
    });

    await alert.present();
  }
}
