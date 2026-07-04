import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';

@Injectable({
  providedIn: 'root'
})
export class PerimeterGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): boolean | UrlTree {
    if (!this.authService.isAuthenticated()) {
      return this.router.parseUrl('/auth/login');
    }
    
    const selected = localStorage.getItem('selected_perimeter');
    if (!selected) {
      return this.router.parseUrl('/select-option');
    }
    
    return true;
  }
}
