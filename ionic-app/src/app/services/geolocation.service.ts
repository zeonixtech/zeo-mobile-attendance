import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AlertController } from '@ionic/angular';

declare const navigator: any;
declare const cordova: any;

const COARSE_LOCATION = 'android.permission.ACCESS_COARSE_LOCATION';
const FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION';

export interface DevicePosition {
  latitude: number;
  longitude: number;
}

@Injectable({
  providedIn: 'root',
})
export class GeolocationService {
  private currentPosition$ = new BehaviorSubject<DevicePosition | null>(null);
  private watchId: number | null = null;
  private permissionGranted = false;

  constructor(
    private zone: NgZone,
    private alertController: AlertController
  ) {}

  getCurrentPosition(): Observable<DevicePosition | null> {
    return this.currentPosition$.asObservable();
  }

  getCurrentPositionValue(): DevicePosition | null {
    return this.currentPosition$.getValue();
  }

  isPermissionGranted(): boolean {
    return this.permissionGranted;
  }

  async checkAndRequestPermission(): Promise<boolean> {
    if (this.permissionGranted) {
      return true;
    }

    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.permissions) {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' as any });
          if (result.state === 'granted') {
            this.permissionGranted = true;
            return true;
          } else if (result.state === 'prompt') {
            return new Promise<boolean>((resolve) => {
              navigator.geolocation.getCurrentPosition(
                () => {
                  this.permissionGranted = true;
                  resolve(true);
                },
                (error: any) => {
                  if (error.code === 1) { // PERMISSION_DENIED
                    this.permissionGranted = false;
                    resolve(false);
                  } else {
                    // POSITION_UNAVAILABLE (2) or TIMEOUT (3) means permission was allowed but coordinates couldn't be resolved.
                    this.permissionGranted = true;
                    resolve(false); // Resolve false so we don't proceed without coordinates
                  }
                },
                { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
              );
            });
          } else {
            this.permissionGranted = false;
            return false;
          }
        } catch (e) {
          // Fallback
        }
      }

      return new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => {
            this.permissionGranted = true;
            resolve(true);
          },
          (error: any) => {
            if (error.code === 1) { // PERMISSION_DENIED
              this.permissionGranted = false;
              resolve(false);
            } else {
              this.permissionGranted = true;
              resolve(false); // Resolve false so we don't proceed without coordinates
            }
          },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
        );
      });
    }

    return new Promise<boolean>((resolve) => {
      try {
        cordova.plugins.permissions.checkPermission(
          FINE_LOCATION,
          async (status: any) => {
            if (status.hasPermission) {
              this.permissionGranted = true;
              resolve(true);
            } else {
              // Show explaining popup before triggering native permissions dialog
              const alert = await this.alertController.create({
                header: 'Precise GPS Required',
                message: 'ZeoHRM needs precise location permission to verify your office check-in. Please select "Precise" location and click Allow on the next screen.',
                backdropDismiss: false,
                buttons: [
                  {
                    text: 'Cancel',
                    role: 'cancel',
                    handler: () => {
                      this.permissionGranted = false;
                      resolve(false);
                    }
                  },
                  {
                    text: 'Continue',
                    handler: () => {
                      cordova.plugins.permissions.requestPermissions(
                        [FINE_LOCATION, COARSE_LOCATION],
                        (granted: any) => {
                          this.permissionGranted = granted.hasPermission;
                          resolve(granted.hasPermission);
                        },
                        () => {
                          this.permissionGranted = false;
                          resolve(false);
                        }
                      );
                    }
                  }
                ]
              });
              await alert.present();
            }
          },
          async () => {
            cordova.plugins.permissions.requestPermissions(
              [FINE_LOCATION, COARSE_LOCATION],
              (granted: any) => {
                this.permissionGranted = granted.hasPermission || granted.results?.[0] === 0;
                resolve(this.permissionGranted);
              },
              () => {
                this.permissionGranted = false;
                resolve(false);
              }
            );
          }
        );
      } catch (e) {
        console.warn('Permission check failed, proceeding anyway:', e);
        this.permissionGranted = true;
        resolve(true);
      }
    });
  }

  async requestHighAccuracy(): Promise<boolean> {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.locationAccuracy) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      cordova.plugins.locationAccuracy.request(
        () => resolve(true),
        async (error: any) => {
          console.warn('Location accuracy request failed:', error);
          const alert = await this.alertController.create({
            header: 'GPS Location Disabled',
            message: 'High accuracy GPS is required for attendance tracking. Please enable Location/GPS services on your device.',
            buttons: ['OK']
          });
          await alert.present();
          resolve(false);
        },
        3 // REQUEST_PRIORITY_HIGH_ACCURACY
      );
    });
  }

  async startWatching(): Promise<void> {
    const granted = await this.checkAndRequestPermission();
    if (!granted) {
      console.warn('Location permission not granted');
    }

    await this.requestHighAccuracy();

    return new Promise<void>((resolve) => {
      const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      };

      navigator.geolocation.getCurrentPosition(
        (position: any) => {
          this.updatePosition(position);
          resolve();
        },
        (error: any) => {
          console.error('Error getting initial location:', error);
          resolve();
        },
        options
      );

      this.watchId = navigator.geolocation.watchPosition(
        (position: any) => {
          this.zone.run(() => {
            this.updatePosition(position);
          });
        },
        (error: any) => {
          console.error('Watch position error:', error);
        },
        options
      );
    });
  }

  stopWatching(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private updatePosition(position: any): void {
    this.currentPosition$.next({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
  }
}
