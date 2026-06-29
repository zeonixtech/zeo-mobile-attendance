import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

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

  constructor(private zone: NgZone) {}

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
    if (typeof cordova === 'undefined') {
      this.permissionGranted = true;
      return true;
    }

    return new Promise<boolean>((resolve) => {
      try {
        cordova.plugins.permissions.checkPermission(
          FINE_LOCATION,
          (status: any) => {
            if (status.hasPermission) {
              this.permissionGranted = true;
              resolve(true);
            } else {
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
          },
          () => {
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

  async requestHighAccuracy(): Promise<void> {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.locationAccuracy) {
      return;
    }

    return new Promise<void>((resolve) => {
      cordova.plugins.locationAccuracy.request(
        () => resolve(),
        () => resolve()
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
