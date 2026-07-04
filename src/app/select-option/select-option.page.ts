import { Component, OnInit, NgZone } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { AuthService } from '../services/auth';
import { GeolocationService } from '../services/geolocation.service';

@Component({
  selector: 'app-select-option',
  templateUrl: './select-option.page.html',
  styleUrls: ['./select-option.page.scss'],
  standalone: false,
})
export class SelectOptionPage implements OnInit {
  selectedMode: 'office' | 'field_duty' | 'remote' | null = null;
  username = 'Employee';
  isLoading = false;
  isSwitching = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private zone: NgZone,
    private alertController: AlertController,
    private geolocationService: GeolocationService
  ) {}

  ngOnInit() {
    const claims = this.authService.getIdentityClaims();
    if (claims) {
      this.username = (claims as any).name || (claims as any).preferred_username || (claims as any).sub || 'Employee';
    }

    this.route.queryParams.subscribe(params => {
      this.isSwitching = params['switching'] === 'true';
    });

    const selected = localStorage.getItem('selected_perimeter');
    if (selected) {
      this.selectedMode = selected as any;
    }
  }

  selectMode(mode: 'office' | 'field_duty' | 'remote') {
    this.selectedMode = mode;
  }

  goBack() {
    this.zone.run(() => {
      this.router.navigate(['/home']);
    });
  }

  async confirmSelection() {
    if (!this.selectedMode) return;
    this.isLoading = true;

    // Check/request location permission
    const hasPermission = await this.geolocationService.checkAndRequestPermission();
    if (!hasPermission) {
      this.isLoading = false;
      const alert = await this.alertController.create({
        header: 'Location Permission Required',
        message: 'ZeoHRM needs location access to verify attendance. Please click Allow to accept permission.',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Allow',
            handler: () => {
              this.confirmSelection();
            }
          }
        ]
      });
      await alert.present();
      return;
    }

    localStorage.setItem('selected_perimeter', this.selectedMode);
    
    // Simulate a brief loading transition for premium experience
    setTimeout(() => {
      this.isLoading = false;
      this.zone.run(() => {
        this.router.navigate(['/home']);
      });
    }, 800);
  }
}
