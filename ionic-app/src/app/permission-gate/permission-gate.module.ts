import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { PermissionGatePage } from './permission-gate.page';
import { PermissionGateRoutingModule } from './permission-gate-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PermissionGateRoutingModule
  ],
  declarations: [PermissionGatePage]
})
export class PermissionGateModule {}
