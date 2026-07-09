import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, NgZone } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
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
export class HomePage implements OnInit, OnDestroy, AfterViewInit {
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
  selectedPerimeter: 'office' | 'field_duty' | 'remote' | null = null;

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
    private SharedApiService: SharedApi
  ) { }

  async ngOnInit() {
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

    await this.geolocationService.startWatching();
    this.locationPermissionGranted = this.geolocationService.isPermissionGranted();
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
      this.initMap();
      return;
    }

    try {
      this.google = await (window as any).__mapLoadPromise;
      this.initMap();
    } catch (error) {
      console.error('Error loading Google Maps:', error);
      this.mapError = true;
      await this.showToast('Failed to load Google Maps. Check API key.', 'danger');
    }
  }

  private initMap() {
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
      styles: [
        {
          featureType: 'poi',
          stylers: [{ visibility: 'off' }],
        },
      ],
    });

    this.officeMarker = new googleMaps.Marker({
      position: officeCoords,
      map: this.map,
      title: 'Office Location',
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#4285F4',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
      zIndex: 1,
    });

    const officeInfoWindow = new googleMaps.InfoWindow({
      content: '<div style="padding:4px 8px;font-size:13px;font-weight:600;color:#4285F4;">Office</div>',
    });
    this.officeMarker.addListener('click', () => {
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

    this.deviceMarker = new googleMaps.Marker({
      position: officeCoords,
      map: this.map,
      title: 'Your Location',
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: '#1B7A2B',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 4,
      },
      zIndex: 10,
    });

    this.deviceInfoWindow = new googleMaps.InfoWindow({
      content: '',
    });

    this.deviceMarker.addListener('click', () => {
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
      this.deviceMarker.setPosition(devicePos);
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
    if ((this.selectedPerimeter === 'office' || !this.selectedPerimeter) && !this.isWithinGeofence) {
      const radius = this.geofenceService.getRadiusMeters();
      await this.showToast(`You must be within ${radius} meters of the office to check out.`, 'danger');
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
}
