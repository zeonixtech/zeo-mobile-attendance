import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { PerimeterGuard } from './guards/perimeter.guard';
import { SelectOptionGuard } from './guards/select-option.guard';

const routes: Routes = [
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then(m => m.HomePageModule),
    canActivate: [PerimeterGuard]
  },
  {
    path: 'attendance',
    loadChildren: () => import('./attendance/attendance.module').then(m => m.AttendanceModule),
    canActivate: [PerimeterGuard]
  },
  {
    path: 'auth',
    loadChildren: () => import('./authentication/authentication-module').then(m => m.AuthenticationModule)
  },
  {
    path: 'select-option',
    loadChildren: () => import('./select-option/select-option.module').then(m => m.SelectOptionModule),
    canActivate: [SelectOptionGuard]
  },
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full'
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
