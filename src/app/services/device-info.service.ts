import { Injectable } from '@angular/core';

declare const device: any;

export interface DeviceInfo {
  imei: string;
  ipAddress: string;
  model: string;
  platform: string;
}

@Injectable({
  providedIn: 'root',
})
export class DeviceInfoService {
  private deviceInfo: DeviceInfo = {
    imei: 'Unknown',
    ipAddress: 'Unknown',
    model: 'Unknown',
    platform: 'Unknown',
  };

  async loadDeviceInfo(): Promise<DeviceInfo> {
    try {
      if (typeof device !== 'undefined') {
        this.deviceInfo.model = device.model || 'Unknown';
        this.deviceInfo.platform = device.platform || 'Unknown';
        this.deviceInfo.imei = device.uuid || 'Unknown';
      } else {
        this.deviceInfo.model = 'Browser';
        this.deviceInfo.platform = 'Web';
        this.deviceInfo.imei = 'N/A (Browser)';
      }

      this.deviceInfo.ipAddress = await this.fetchIpAddress();
    } catch (error) {
      console.error('Error loading device info:', error);
    }
    return this.deviceInfo;
  }

  getDeviceInfo(): DeviceInfo {
    return this.deviceInfo;
  }

  private async fetchIpAddress(): Promise<string> {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }
}
