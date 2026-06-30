import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { AuthenticationRoutingModule } from './authentication-routing-module';
import { AuthSigninComponent } from './auth-signin/auth-signin.component';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';

@NgModule({
  declarations: [AuthSigninComponent],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AuthenticationRoutingModule
  ],
  providers: [InAppBrowser]
})
export class AuthenticationModule { }
