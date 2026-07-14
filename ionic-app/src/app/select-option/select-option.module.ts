import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SelectOptionPage } from './select-option.page';
import { SelectOptionRoutingModule } from './select-option-routing.module';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SelectOptionRoutingModule,
    SharedModule
  ],
  declarations: [SelectOptionPage]
})
export class SelectOptionModule {}
