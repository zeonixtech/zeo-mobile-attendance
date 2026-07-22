import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, NgZone } from '@angular/core';
import { AlertController, ToastController, MenuController, ViewWillEnter } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { GeolocationService, DevicePosition } from '../services/geolocation.service';
import { DeviceInfoService, DeviceInfo } from '../services/device-info.service';
import { GeofenceService } from '../services/geofence.service';
import { AttendanceApiService } from '../services/attendance-api.service';
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
  lastCheckInTime: string | null = null;

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
  }

  async ngOnInit() {
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

    this.selectedPerimeter = (localStorage.getItem('selected_perimeter') as any) || 'office';

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

    await this.deviceInfoService.loadDeviceInfo();
    this.deviceInfo = this.deviceInfoService.getDeviceInfo();

    this.locationPermissionGranted = this.geolocationService.isPermissionGranted();

    this.geolocationService.getCurrentPosition().subscribe((position) => {
      this.currentPosition = position;
      if (position) {
        this.isWithinGeofence = this.geofenceService.isWithinGeofence(position);
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

    const officeCoords = this.geofenceService.getOfficeCoordinates();
    const googleMaps = this.google.maps;

    this.map = new googleMaps.Map(this.mapContainer.nativeElement, {
      center: officeCoords,
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
      position: officeCoords,
      map: this.map,
      title: 'Office Location',
      content: officeMarkerContent,
      zIndex: 1,
    });

    const officeInfoWindow = new googleMaps.InfoWindow({
      content: `
        <div style="padding: 8px 12px; font-family: 'Roboto', sans-serif; max-width: 220px;">
          <div style="font-weight: 700; color: #4285F4; font-size: 14px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            Office Location
          </div>
          <div style="font-size: 12px; color: #5f6368; line-height: 1.4; margin-top: 4px;" id="office-address-container">
            S.C.O. No. 11, Top Floor, Sector 17-E, Chandigarh - 160017, India
          </div>
        </div>
      `
    });

    try {
      const geocoder = new googleMaps.Geocoder();
      geocoder.geocode({ location: officeCoords }, (results: any, status: any) => {
        if (status === 'OK' && results && results[0]) {
          const addressContainer = document.getElementById('office-address-container');
          if (addressContainer) {
            addressContainer.textContent = results[0].formatted_address;
          } else {
            officeInfoWindow.setContent(`
              <div style="padding: 8px 12px; font-family: 'Roboto', sans-serif; max-width: 220px;">
                <div style="font-weight: 700; color: #4285F4; font-size: 14px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  Office Location
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
      console.error('Error reverse geocoding office coordinates:', e);
    }

    this.officeMarker.addListener('gmp-click', () => {
      officeInfoWindow.open(this.map, this.officeMarker);
    });

    this.geofenceCircle = new googleMaps.Circle({
      map: this.map,
      center: officeCoords,
      radius: this.geofenceService.getRadiusMeters(),
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
      position: officeCoords,
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
    const status = this.isWithinGeofence ? 'Inside Office Range' : 'Outside Office Range';
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

  getDistance(): string {
    if (!this.currentPosition) return '0.00';
    const officeCoords = this.geofenceService.getOfficeCoordinates();
    const distance = this.geofenceService.calculateDistance(
      this.currentPosition.latitude,
      this.currentPosition.longitude,
      officeCoords.lat,
      officeCoords.lng
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
    if ((this.selectedPerimeter === 'office' || !this.selectedPerimeter) && !this.isWithinGeofence) {
      const radius = this.geofenceService.getRadiusMeters();
      await this.showToast(`You must be within ${radius} meters of the office to check in.`, 'danger');
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
