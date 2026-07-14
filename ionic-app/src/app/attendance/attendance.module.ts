import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AttendancePage } from './attendance.page';
import { AttendanceRoutingModule } from './attendance-routing.module';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AttendanceRoutingModule,
    SharedModule
  ],
  declarations: [AttendancePage]
})
export class AttendanceModule {}
