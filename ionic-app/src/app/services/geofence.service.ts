import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { DevicePosition } from './geolocation.service';

@Injectable({
  providedIn: 'root',
})
export class GeofenceService {
  private readonly officeLat = environment.officeLatitude;
  private readonly officeLng = environment.officeLongitude;
  private readonly radiusMeters = environment.geofenceRadius;

  isWithinGeofence(position: DevicePosition): boolean {
    const distance = this.calculateDistance(
      position.latitude,
      position.longitude,
      this.officeLat,
      this.officeLng
    );
    return distance <= this.radiusMeters;
  }

  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  getOfficeCoordinates(): { lat: number; lng: number } {
    return { lat: this.officeLat, lng: this.officeLng };
  }

  getRadiusMeters(): number {
    return this.radiusMeters;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
