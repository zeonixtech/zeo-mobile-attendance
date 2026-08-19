import { Injectable } from '@angular/core';
import { Utility } from './utility';
import { environment } from 'src/environments/environment';
import { DeviceInfo } from './device-info.service';
import { HistoryEntry } from '../attendance/attendance.page';


@Injectable({
  providedIn: 'root',
})
export class SharedApi {

  constructor(
    private utilityService: Utility
  ) {

  }
  /**
   * Function to fetch login details of user and company
   */
  async fetchLoginDetails() {
    const response: any = await this.utilityService.crmApiReq('get', environment.CRM_API + "sso/get-user-profile");
    if (response.statusCode == 200) {
      let salutation: any = response.response;
      return salutation;
    } else {
      let salutation: any = "";
      return salutation;
    }

    // this.utilityService.apiReq('get', `${environment.CRM_API}sso/get-user-profile`).subscribe({
    //   next: (response) => {
    //     if (response?.statusCode === 200) {
    //       this.userInfo = response.response;
    //       this.userFormData = {
    //         salutation: this.sharedService.stripHtmlTags(this.userInfo.user_salutation || ''),
    //         firstName: this.sharedService.stripHtmlTags(this.userInfo.given_name || ''),
    //         lastName: this.sharedService.stripHtmlTags(this.userInfo.family_name || ''),
    //         email: this.sharedService.stripHtmlTags(this.userInfo.email || ''),
    //         mobile: this.sharedService.stripHtmlTags(this.userInfo.mobile_number || ''),
    //         timezone: this.sharedService.stripHtmlTags(this.userInfo.timezone || ''),
    //         profilePhoto: this.sharedService.stripHtmlTags(this.userInfo.profile_photo || ''),
    //       };
    //     } else {
    //       console.error('Failed to fetch user login details. Invalid response:', response);
    //     }
    //   },
    //   error: (error) => {
    //     // Handle API errors
    //     console.error('Error fetching user login details:', error);
    //   }
    // });
  }

  /**
   * Resolves the caller's own per-employee BLE service UUID (used for Office-mode
   * beacon advertising instead of one shared UUID for everyone). Returns null on
   * any failure so callers can decide whether to retry or skip advertising.
   */
  async fetchBeaconIdentity(): Promise<string | null> {
    const response: any = await this.utilityService.crmApiReq('get', environment.CRM_API + 'mobileapi/attendance/beacon-identity');
    if (response?.statusCode === 200 && response?.response?.beaconUuid) {
      return response.response.beaconUuid;
    }
    console.error('Error fetching beacon identity:', response);
    return null;
  }

  /**
   * The current Field Duty/Remote designated operating area (a shared dummy value
   * until onboarding collects a real per-employee area — see crm-apis constants.js).
   */
  async fetchOperatingArea(): Promise<{ latitude: number; longitude: number; radiusMeters: number } | null> {
    const response: any = await this.utilityService.crmApiReq('get', environment.CRM_API + 'mobileapi/attendance/operating-area');
    if (response?.statusCode === 200 && response?.response) {
      return response.response;
    }
    console.error('Error fetching operating area:', response);
    return null;
  }

  /**
   * Records a single check-in/check-out tap. Session-authenticated like beacon-identity/
   * operating-area above — this runs from the foreground WebView, not the native background
   * service, so it carries the logged-in session rather than the location-ping API key.
   */
  async postCheckEvent(
    type: 'check-in' | 'check-out',
    mode: string,
    latitude: number,
    longitude: number,
    isMock: boolean,
    deviceInfo?: DeviceInfo | null
  ): Promise<boolean> {
    const response: any = await this.utilityService.crmApiReq('post', environment.CRM_API + 'mobileapi/attendance/event', {
      type,
      mode,
      latitude,
      longitude,
      isMock,
      timestamp: Date.now(),
      deviceId: deviceInfo?.imei,
      deviceModel: deviceInfo?.model,
      platform: deviceInfo?.platform
    });
    if (response?.statusCode === 201) {
      return true;
    }
    console.error('Error posting check event:', response);
    return false;
  }

  /**
   * The caller's own check-in/check-out history plus overlapping company holidays. Omit
   * start/end to get the endpoint's default (last 24 months) — used as-is by the Home page
   * to derive current check-in state, and with explicit range by the History tab's filters.
   */
  async fetchAttendanceHistory(start?: string, end?: string): Promise<HistoryEntry[]> {
    let url = environment.CRM_API + 'mobileapi/attendance/history';
    const params: string[] = [];
    if (start) params.push(`start=${start}`);
    if (end) params.push(`end=${end}`);
    if (params.length) url += '?' + params.join('&');

    const response: any = await this.utilityService.crmApiReq('get', url);
    if (response?.statusCode === 200 && response?.response?.events) {
      return response.response.events;
    }
    console.error('Error fetching attendance history:', response);
    return [];
  }
}
