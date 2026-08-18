import { Injectable } from '@angular/core';
import { Utility } from './utility';
import { environment } from 'src/environments/environment';


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
}
