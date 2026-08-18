import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { DevicePosition } from './geolocation.service';
import { SharedApi } from './shared-api';
import { TrackingMode } from './attendance-tracking.service';

export interface OperatingArea {
  lat: number;
  lng: number;
  radiusMeters: number;
}

const OPERATING_AREA_STORAGE_KEY = 'zeohrm_operating_area';

@Injectable({
  providedIn: 'root',
})
export class GeofenceService {
  private readonly officeLat = environment.officeLatitude;
  private readonly officeLng = environment.officeLongitude;
  private readonly radiusMeters = environment.geofenceRadius;

  constructor(private sharedApiService: SharedApi) {}

  isWithinGeofence(position: DevicePosition): boolean {
    return this.isWithinArea(position, this.getOfficeArea());
  }

  isWithinArea(position: DevicePosition, area: OperatingArea): boolean {
    const distance = this.calculateDistance(
      position.latitude,
      position.longitude,
      area.lat,
      area.lng
    );
    return distance <= area.radiusMeters;
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

  getOfficeArea(): OperatingArea {
    return { lat: this.officeLat, lng: this.officeLng, radiusMeters: this.radiusMeters };
  }

  getRadiusMeters(): number {
    return this.radiusMeters;
  }

  /**
   * The active area for `mode` — static office coordinates for 'office', or the
   * (currently shared/dummy) Field Duty/Remote area fetched once and cached in
   * localStorage, same treatment as the cached beacon UUID (cleared on logout —
   * see AuthService.logout()). Returns null if the remote fetch fails, rather than
   * silently falling back to the office area, since that could wrongly gate check-in.
   */
  async getOperatingArea(mode: TrackingMode): Promise<OperatingArea | null> {
    if (mode === 'office') {
      return this.getOfficeArea();
    }

    const cached = localStorage.getItem(OPERATING_AREA_STORAGE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // corrupt cache — fall through to a fresh fetch
      }
    }

    const remote = await this.sharedApiService.fetchOperatingArea();
    if (!remote) {
      return null;
    }
    const area: OperatingArea = { lat: remote.latitude, lng: remote.longitude, radiusMeters: remote.radiusMeters };
    localStorage.setItem(OPERATING_AREA_STORAGE_KEY, JSON.stringify(area));
    return area;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
