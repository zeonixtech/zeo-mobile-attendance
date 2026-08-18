import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { TrackingPermissionService, TrackingMode } from '../services/tracking-permission.service';

@Injectable({
  providedIn: 'root'
})
export class PerimeterGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router,
    private trackingPermissionService: TrackingPermissionService
  ) {}

  async canActivate(): Promise<boolean | UrlTree> {
    if (!this.authService.isAuthenticated()) {
      return this.router.parseUrl('/auth/login');
    }

    const selected = localStorage.getItem('selected_perimeter') as TrackingMode | null;
    if (!selected) {
      return this.router.parseUrl('/select-option');
    }

    // Catches the case where the user revoked the permission from system Settings
    // after already reaching /home — background tracking must stay enforced.
    const hasPermissions = await this.trackingPermissionService.hasRequiredPermissions(selected);
    if (!hasPermissions) {
      return this.router.parseUrl('/permission-required');
    }

    return true;
  }
}
