import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { DeviceInfo } from './device-info.service';
import { DevicePosition } from './geolocation.service';

export interface AttendancePayload {
  latitude: number;
  longitude: number;
  imei: string;
  ipAddress: string;
  type: 'check-in' | 'check-out';
  timestamp: string;
  deviceModel: string;
  platform: string;
}

export interface AttendanceResponse {
  success: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class AttendanceApiService {
  private apiUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  postAttendance(
    type: 'check-in' | 'check-out',
    position: DevicePosition,
    deviceInfo: DeviceInfo
  ): Observable<AttendanceResponse> {
    const payload: AttendancePayload = {
      latitude: position.latitude,
      longitude: position.longitude,
      imei: deviceInfo.imei,
      ipAddress: deviceInfo.ipAddress,
      type,
      timestamp: new Date().toISOString(),
      deviceModel: deviceInfo.model,
      platform: deviceInfo.platform,
    };

    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });

    return this.http.post<AttendanceResponse>(
      `${this.apiUrl}/attendance`,
      payload,
      { headers }
    );
  }
}
