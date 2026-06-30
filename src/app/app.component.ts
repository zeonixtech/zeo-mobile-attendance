import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  showSplash = true;
  isFading = false;

  constructor() {}

  ngOnInit() {
    setTimeout(() => {
      this.isFading = true;
      setTimeout(() => {
        this.showSplash = false;
      }, 500);
    }, 2500);
  }
}
