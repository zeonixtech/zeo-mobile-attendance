import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Platform, MenuController } from '@ionic/angular';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  showSplash = true;
  isFading = false;

  constructor(
    private platform: Platform,
    private router: Router,
    private menuController: MenuController
  ) {}

  ngOnInit() {
    setTimeout(() => {
      this.isFading = true;
      setTimeout(() => {
        this.showSplash = false;
      }, 500);
    }, 2500);

    this.setupHardwareBackButton();
  }

  private setupHardwareBackButton() {
    this.platform.backButton.subscribeWithPriority(10, async () => {
      // 1. If side menu is open, close it
      const isMenuOpen = await this.menuController.isOpen();
      if (isMenuOpen) {
        await this.menuController.close();
        return;
      }

      // 2. Determine action based on current route
      const currentUrl = this.router.url;
      const hasPerimeterSet = !!localStorage.getItem('selected_perimeter');

      if (currentUrl.startsWith('/permission-required')) {
        // Non-dismissible — required permissions haven't been granted yet.
        this.exitApp();
      } else if (currentUrl.startsWith('/select-option')) {
        // If they already have a perimeter (i.e. switching mode), go back to home
        if (hasPerimeterSet) {
          this.router.navigate(['/home']);
        } else {
          this.exitApp();
        }
      } else if (currentUrl === '/home' || currentUrl.startsWith('/auth') || currentUrl === '/') {
        this.exitApp();
      } else {
        // Default to going to Home page for sub-pages
        this.router.navigate(['/home']);
      }
    });
  }

  private exitApp() {
    const nav = navigator as any;
    if (nav && nav.app && nav.app.exitApp) {
      nav.app.exitApp();
    }
  }
}
