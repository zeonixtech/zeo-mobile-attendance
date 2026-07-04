import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from '../services/auth';

@Injectable({
  providedIn: 'root'
})
export class SelectOptionGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    if (!this.authService.isAuthenticated()) {
      return this.router.parseUrl('/auth/login');
    }
    
    const switching = route.queryParams['switching'] === 'true';
    const selected = localStorage.getItem('selected_perimeter');
    if (selected && !switching) {
      return this.router.parseUrl('/home');
    }
    
    return true;
  }
}
