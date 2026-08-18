import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, NgZone } from '@angular/core';
import { AlertController, ToastController, MenuController, ViewWillEnter } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { GeolocationService, DevicePosition } from '../services/geolocation.service';
import { DeviceInfoService, DeviceInfo } from '../services/device-info.service';
import { GeofenceService, OperatingArea } from '../services/geofence.service';
import { AttendanceApiService } from '../services/attendance-api.service';
import { AttendanceTrackingService } from '../services/attendance-tracking.service';
import { AuthService } from '../services/auth';
import { environment } from '../../environments/environment';
import { SharedApi } from '../services/shared-api';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy, AfterViewInit, ViewWillEnter {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef;

  username = 'Employee';
  isWithinGeofence = false;
  currentPosition: DevicePosition | null = null;
  deviceInfo: DeviceInfo | null = null;
  isLoading = false;
  lastAction: 'check-in' | 'check-out' | null = null;
  mapLoaded = false;
  mapError = false;
  locationPermissionGranted = false;
  isCheckingPermission = true;
  selectedPerimeter: 'office' | 'field_duty' | 'remote' | null = null;
  activeArea: OperatingArea | null = null;
  private activeAreaPromise: Promise<OperatingArea | null> | null = null;
  lastCheckInTime: string | null = null;
  todayLogs: any[] = [];
  showTodayLogs = false;

  private positionSub!: Subscription;
  private map: any;
  private officeMarker: any;
  private geofenceCircle: any;
  private deviceMarker: any;
  private deviceInfoWindow: any;
  private devicePulseOverlay: any;
  private google: any;
  userImage: string = 'https://ionicframework.com/docs/img/demos/avatar.svg';

  constructor(
    private geolocationService: GeolocationService,
    private deviceInfoService: DeviceInfoService,
    private geofenceService: GeofenceService,
    private attendanceApiService: AttendanceApiService,
    private attendanceTrackingService: AttendanceTrackingService,
    private alertController: AlertController,
    private toastController: ToastController,
    private ngZone: NgZone,
    private authService: AuthService,
    private router: Router,
    private SharedApiService: SharedApi,
    private menuController: MenuController
  ) { }

  async ionViewWillEnter() {
    await this.menuController.enable(true, 'home-content-menu');
    await this.menuController.enable(false, 'attendance-content-menu');
    await this.menuController.close('home-content-menu');

    await this.refreshForCurrentMode();
  }

  /**
   * Re-reads the persisted attendance mode every time this page becomes active,
   * not just on first load. HomePage is a reused component instance across Ionic
   * navigation, so ngOnInit() (which only ever runs once) can't pick up a mode
   * switch made via the Switch Attendance Mode flow — without this, the MODE
   * badge, geofence check, and map silently kept showing whatever mode was active
   * the first time this page was ever entered.
   */
  private async refreshForCurrentMode() {
    const newPerimeter = (localStorage.getItem('selected_perimeter') as any) || 'office';
    const perimeterChanged = newPerimeter !== this.selectedPerimeter;

    if (perimeterChanged) {
      this.selectedPerimeter = newPerimeter;
      this.activeAreaPromise = null; // memoized per-mode — drop the stale promise
    }

    this.activeArea = await this.getActiveArea();

    if (this.currentPosition && this.activeArea) {
      this.isWithinGeofence = this.geofenceService.isWithinArea(this.currentPosition, this.activeArea);
    }

    if (perimeterChanged && this.map && this.activeArea) {
      this.applyAreaToMap(this.activeArea);
    }
  }

  /** Re-centers the already-built map on a newly-active area instead of rebuilding it. */
  private applyAreaToMap(area: OperatingArea) {
    const areaCoords = { lat: area.lat, lng: area.lng };
    const isOffice = this.selectedPerimeter === 'office';
    const areaLabel = isOffice ? 'Office Location' : 'Designated Area';

    this.map.setCenter(areaCoords);
    if (this.officeMarker) {
      this.officeMarker.position = areaCoords;
      this.officeMarker.title = areaLabel;
    }
    if (this.geofenceCircle) {
      this.geofenceCircle.setCenter(areaCoords);
      this.geofenceCircle.setRadius(area.radiusMeters);
    }
    this.updateMapPosition();
  }

  async ngOnInit() {
    // Resolved first, synchronously, so it's available to ngAfterViewInit's map
    // init regardless of how the rest of this async chain interleaves with it.
    this.selectedPerimeter = (localStorage.getItem('selected_perimeter') as any) || 'office';

    this.isCheckingPermission = true;
    // const token = this.authService.getTokenFromCookie();
    const claims = await this.authService.getIdentityClaims();
    if ((claims as any).given_name) {
      let givenName: any = (claims as any).given_name ? (claims as any).given_name : "";
      let familyName = (claims as any).family_name ? (claims as any).family_name : "";
      this.username = `${givenName} ${familyName}`.trim();


      let loginUserDetails: any = await this.SharedApiService.fetchLoginDetails();
      if (loginUserDetails?.profile_photo) {
        let token: string = await this.authService.getAccessToken();
        this.userImage = environment.CRM_API + 'viewdocument/' + loginUserDetails?.profile_photo + '?token=' + token;
      }

      // if (loginUserDetails?.company?.name) {
      //   this.companyName = loginUserDetails?.company?.name;
      // }


    }

    this.activeArea = await this.getActiveArea();

    // Load last action state from history
    const storedHistory = localStorage.getItem('attendance_history');
    if (storedHistory) {
      try {
        const history = JSON.parse(storedHistory);
        if (history.length > 0) {
          history.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          this.lastAction = history[0].type;

          if (this.lastAction === 'check-in') {
            const lastCheckIn = history
              .filter((a: any) => a.type === 'check-in')
              .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
            if (lastCheckIn) {
              this.lastCheckInTime = lastCheckIn.timestamp;
            }
          }
        }
      } catch (e) {
        console.error('Error loading last action from history:', e);
      }
    }
    this.loadTodayLogs();

    await this.deviceInfoService.loadDeviceInfo();
    this.deviceInfo = this.deviceInfoService.getDeviceInfo();

    this.locationPermissionGranted = this.geolocationService.isPermissionGranted();

    this.geolocationService.getCurrentPosition().subscribe((position) => {
      this.currentPosition = position;
      if (position) {
        this.isWithinGeofence = this.activeArea ? this.geofenceService.isWithinArea(position, this.activeArea) : false;
        this.updateMapPosition();
      }
    });

    try {
      await this.geolocationService.startWatching();
    } catch (e) {
      console.error('Error starting location watch:', e);
    } finally {
      this.locationPermissionGranted = this.geolocationService.isPermissionGranted();
      this.isCheckingPermission = false;
    }
  }

  ngAfterViewInit() {
    this.loadGoogleMaps();
  }

  ngOnDestroy() {
    this.geolocationService.stopWatching();
  }

  /** Memoized so ngOnInit and initMap — whichever runs first — share one fetch. */
  private getActiveArea(): Promise<OperatingArea | null> {
    if (!this.activeAreaPromise) {
      this.activeAreaPromise = this.geofenceService.getOperatingArea(this.selectedPerimeter || 'office');
    }
    return this.activeAreaPromise;
  }

  private async loadGoogleMaps() {
    if ((window as any).google && (window as any).google.maps) {
      this.google = (window as any).google;
      await this.initMap();
      return;
    }

    try {
      this.google = await (window as any).__mapLoadPromise;
      await this.initMap();
    } catch (error) {
      console.error('Error loading Google Maps:', error);
      this.mapError = true;
      await this.showToast('Failed to load Google Maps. Check API key.', 'danger');
    }
  }

  private async initMap() {
    if (!this.mapContainer || !this.google) return;

    const area = await this.getActiveArea();
    if (!area) {
      console.error('HomePage: could not resolve an operating area — not initializing map');
      return;
    }
    const areaCoords = { lat: area.lat, lng: area.lng };
    const isOffice = this.selectedPerimeter === 'office';
    const areaLabel = isOffice ? 'Office Location' : 'Designated Area';
    const googleMaps = this.google.maps;

    this.map = new googleMaps.Map(this.mapContainer.nativeElement, {
      center: areaCoords,
      zoom: 18,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
      mapId: 'DEMO_MAP_ID',
      // styles: [
      //   {
      //     featureType: 'poi',
      //     stylers: [{ visibility: 'off' }],
      //   },
      // ],
    });

    let AdvancedMarkerElement = googleMaps.marker?.AdvancedMarkerElement;
    if (!AdvancedMarkerElement) {
      try {
        const markerLib = await googleMaps.importLibrary('marker');
        AdvancedMarkerElement = markerLib.AdvancedMarkerElement;
      } catch (e) {
        console.error('Failed to import marker library:', e);
      }
    }

    if (!AdvancedMarkerElement) {
      console.error('AdvancedMarkerElement is not available');
      return;
    }

    const officeMarkerContent = document.createElement('div');
    officeMarkerContent.style.width = '24px';
    officeMarkerContent.style.height = '24px';
    officeMarkerContent.style.backgroundColor = '#4285F4';
    officeMarkerContent.style.borderRadius = '50%';
    officeMarkerContent.style.border = '3px solid #ffffff';
    officeMarkerContent.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    officeMarkerContent.style.boxSizing = 'border-box';

    this.officeMarker = new AdvancedMarkerElement({
      position: areaCoords,
      map: this.map,
      title: areaLabel,
      content: officeMarkerContent,
      zIndex: 1,
    });

    const officeInfoWindow = new googleMaps.InfoWindow({
      content: `
        <div style="padding: 8px 12px; font-family: 'Roboto', sans-serif; max-width: 220px;">
          <div style="font-weight: 700; color: #4285F4; font-size: 14px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            ${areaLabel}
          </div>
          <div style="font-size: 12px; color: #5f6368; line-height: 1.4; margin-top: 4px;" id="office-address-container">
            ${isOffice ? 'S.C.O. No. 11, Top Floor, Sector 17-E, Chandigarh - 160017, India' : 'Loading address&hellip;'}
          </div>
        </div>
      `
    });

    try {
      const geocoder = new googleMaps.Geocoder();
      geocoder.geocode({ location: areaCoords }, (results: any, status: any) => {
        if (status === 'OK' && results && results[0]) {
          const addressContainer = document.getElementById('office-address-container');
          if (addressContainer) {
            addressContainer.textContent = results[0].formatted_address;
          } else {
            officeInfoWindow.setContent(`
              <div style="padding: 8px 12px; font-family: 'Roboto', sans-serif; max-width: 220px;">
                <div style="font-weight: 700; color: #4285F4; font-size: 14px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  ${areaLabel}
                </div>
                <div style="font-size: 12px; color: #5f6368; line-height: 1.4; margin-top: 4px;">
                  ${results[0].formatted_address}
                </div>
              </div>
            `);
          }
        }
      });
    } catch (e) {
      console.error('Error reverse geocoding area coordinates:', e);
    }

    this.officeMarker.addListener('gmp-click', () => {
      officeInfoWindow.open(this.map, this.officeMarker);
    });

    this.geofenceCircle = new googleMaps.Circle({
      map: this.map,
      center: areaCoords,
      radius: area.radiusMeters,
      fillColor: '#FF0000',
      fillOpacity: 0.2,
      strokeColor: '#FF0000',
      strokeOpacity: 0.8,
      strokeWeight: 2,
    });

    const deviceMarkerContent = document.createElement('div');
    deviceMarkerContent.style.width = '28px';
    deviceMarkerContent.style.height = '28px';
    deviceMarkerContent.style.backgroundColor = '#1B7A2B';
    deviceMarkerContent.style.borderRadius = '50%';
    deviceMarkerContent.style.border = '4px solid #ffffff';
    deviceMarkerContent.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    deviceMarkerContent.style.boxSizing = 'border-box';

    this.deviceMarker = new AdvancedMarkerElement({
      position: areaCoords,
      map: this.map,
      title: 'Your Location',
      content: deviceMarkerContent,
      zIndex: 10,
    });

    this.deviceInfoWindow = new googleMaps.InfoWindow({
      content: '',
    });

    this.deviceMarker.addListener('gmp-click', () => {
      this.updateDeviceInfoWindow();
      this.deviceInfoWindow.open(this.map, this.deviceMarker);
    });

    this.mapLoaded = true;

    if (this.currentPosition) {
      this.updateMapPosition();
    }
  }

  private updateMapPosition() {
    if (!this.map || !this.currentPosition || !this.google) return;

    const devicePos = {
      lat: this.currentPosition.latitude,
      lng: this.currentPosition.longitude,
    };

    this.ngZone.run(() => {
      this.deviceMarker.position = devicePos;
      this.map.panTo(devicePos);

      this.updateDeviceInfoWindow();

      const circleColor = this.isWithinGeofence ? '#00FF00' : '#FF0000';
      const strokeColor = this.isWithinGeofence ? '#00CC00' : '#CC0000';

      this.geofenceCircle.setOptions({
        fillColor: circleColor,
        fillOpacity: 0.25,
        strokeColor: strokeColor,
        strokeOpacity: 0.9,
        strokeWeight: 3,
      });
    });
  }

  private updateDeviceInfoWindow() {
    if (!this.deviceInfoWindow || !this.currentPosition) return;
    const lat = this.currentPosition.latitude.toFixed(6);
    const lng = this.currentPosition.longitude.toFixed(6);
    const rangeLabel = this.selectedPerimeter === 'office' ? 'Office Range' : 'Designated Area';
    const status = this.isWithinGeofence ? `Inside ${rangeLabel}` : `Outside ${rangeLabel}`;
    const statusColor = this.isWithinGeofence ? '#2dd36f' : '#eb445a';
    this.deviceInfoWindow.setContent(
      '<div style="padding:6px 10px;font-size:13px;line-height:1.5;">' +
      '<div style="font-weight:700;color:#1a1a2e;margin-bottom:4px;">Your Location</div>' +
      '<div style="color:#666;">Lat: <b>' + lat + '</b></div>' +
      '<div style="color:#666;">Lng: <b>' + lng + '</b></div>' +
      '<div style="margin-top:4px;color:' + statusColor + ';font-weight:600;">' + status + '</div>' +
      '</div>'
    );
  }

  getRangeLabel(): string {
    const rangeLabel = this.selectedPerimeter === 'office' ? 'Office Range' : 'Designated Area';
    return this.isWithinGeofence ? `Within ${rangeLabel}` : `Outside ${rangeLabel}`;
  }

  getDistance(): string {
    if (!this.currentPosition || !this.activeArea) return '0.00';
    const distance = this.geofenceService.calculateDistance(
      this.currentPosition.latitude,
      this.currentPosition.longitude,
      this.activeArea.lat,
      this.activeArea.lng
    );
    return distance.toFixed(2);
  }

  getFormattedMode(): string {
    if (this.selectedPerimeter === 'office') return 'Office';
    if (this.selectedPerimeter === 'field_duty') return 'Field Duty';
    if (this.selectedPerimeter === 'remote') return 'Remote Work';
    return 'Office';
  }

  async onCheckIn() {
    if (!this.currentPosition || !this.deviceInfo) {
      await this.showToast('Unable to get your location. Please try again.', 'danger');
      return;
    }
    if (!this.activeArea) {
      await this.showToast('Unable to resolve your operating area. Please try again.', 'danger');
      return;
    }
    if (!this.isWithinGeofence) {
      const areaLabel = this.selectedPerimeter === 'office' ? 'the office' : 'your designated area';
      await this.showToast(`You must be within ${this.activeArea.radiusMeters} meters of ${areaLabel} to check in.`, 'danger');
      return;
    }
    await this.submitAttendance('check-in');
  }

  async onCheckOut() {
    if (!this.currentPosition || !this.deviceInfo) {
      await this.showToast('Unable to get your location. Please try again.', 'danger');
      return;
    }
    await this.submitAttendance('check-out');
  }

  private async submitAttendance(type: 'check-in' | 'check-out') {
    const modeStr = this.getFormattedMode();
    const alert = await this.alertController.create({
      header: `Confirm ${type === 'check-in' ? 'Check In' : 'Check Out'} (${modeStr})`,
      message: `Are you sure you want to ${type === 'check-in' ? 'check in' : 'check out'} for ${modeStr}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            // Background tracking (BLE beacon advertising / GPS posting) is gated to
            // check-in/check-out rather than starting the moment a mode is selected —
            // it runs as a native foreground service, so it keeps going even after the
            // app is closed, right up until checkout stops it (or logout, as a safety net).
            if (type === 'check-in') {
              await this.attendanceTrackingService.startForMode(this.selectedPerimeter || 'office');
            } else {
              await this.attendanceTrackingService.stop();
            }

            /*************************************************************************************************************** */
            //Comment below code to stop real API calling
            this.isLoading = true;
            this.isLoading = false;
            this.lastAction = type;
            this.saveToHistory(type, modeStr);

            if (type === 'check-in') {
              this.lastCheckInTime = new Date().toISOString();
            } else {
              this.lastCheckInTime = null;
            }

            this.loadTodayLogs();
            let response: any = await this.attendanceApiService.postAttendance(type, this.currentPosition!, this.deviceInfo!, modeStr)

            const msg = response.message || `${type === 'check-in' ? 'Check In' : 'Check Out'} successful!`;
            await this.showToast(msg, 'success');
            //Comment above code to stop real API calling

            /*************************************************************************************************************** */

            //Uncomment below code to call real API
            /*
            this.isLoading = true;
            this.attendanceApiService
              .postAttendance(type, this.currentPosition!, this.deviceInfo!, modeStr)
              .subscribe({
                next: async (response) => {
                  this.isLoading = false;
                  this.lastAction = type;
                  this.saveToHistory(type, modeStr);

                  if (type === 'check-in') {
                    this.lastCheckInTime = new Date().toISOString();
                  } else {
                    this.lastCheckInTime = null;
                  }

                  this.loadTodayLogs();

                  const msg = response.message || `${type === 'check-in' ? 'Check In' : 'Check Out'} successful!`;
                  await this.showToast(msg, 'success');
                },
                error: async (error) => {
                  this.isLoading = false;
                  console.error('API Error:', error);
                  await this.showToast(
                    `Failed to ${type}. Please try again.`,
                    'danger'
                  );
                },
              });

              */
            //Uncomment bbove code to call real API
          },
        },
      ],
    });
    await alert.present();
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'bottom',
    });
    await toast.present();
  }

  goToHome() {
    // Already on Home page
  }

  goToHistory() {
    this.router.navigate(['/attendance']);
  }

  private saveToHistory(type: 'check-in' | 'check-out', mode: string) {
    if (!this.currentPosition) return;
    const stored = localStorage.getItem('attendance_history') || '[]';
    try {
      const history = JSON.parse(stored);
      history.push({
        type,
        timestamp: new Date().toISOString(),
        latitude: this.currentPosition.latitude,
        longitude: this.currentPosition.longitude,
        mode
      });
      localStorage.setItem('attendance_history', JSON.stringify(history));
    } catch (e) {
      console.error('Error saving history to localStorage:', e);
    }
  }

  loadTodayLogs() {
    this.todayLogs = [];
    const storedHistory = localStorage.getItem('attendance_history');
    if (storedHistory) {
      try {
        const history = JSON.parse(storedHistory);
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayKey = `${year}-${month}-${day}`;

        this.todayLogs = history
          .filter((entry: any) => {
            if (entry.type !== 'check-in' && entry.type !== 'check-out') return false;
            const entryDateObj = new Date(entry.timestamp);
            const entryYear = entryDateObj.getFullYear();
            const entryMonth = String(entryDateObj.getMonth() + 1).padStart(2, '0');
            const entryDay = String(entryDateObj.getDate()).padStart(2, '0');
            const entryKey = `${entryYear}-${entryMonth}-${entryDay}`;
            return entryKey === todayKey;
          })
          .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } catch (e) {
        console.error('Error loading today logs:', e);
      }
    }
  }

  formatCheckInTime(isoString: string): string {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  formatCheckInDate(isoString: string): string {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
