import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthSigninComponent } from './auth-signin/auth-signin.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'sign-in',
    pathMatch: 'full'
  },
  {
    path: 'sign-in',
    component: AuthSigninComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AuthenticationRoutingModule { }
