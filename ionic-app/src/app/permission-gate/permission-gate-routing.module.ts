import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PermissionGatePage } from './permission-gate.page';

const routes: Routes = [
  {
    path: '',
    component: PermissionGatePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PermissionGateRoutingModule {}
