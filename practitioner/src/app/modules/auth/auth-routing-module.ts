import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Auth } from './pages/auth/auth';
import { Login } from './components/login/login';
import { ForgotPassword } from './components/forgot-password/forgot-password';
import { ResetPassword } from './components/reset-password/reset-password';
import { OpenIdCallback } from './components/openid-callback/openid-callback';

const routes: Routes = [
  {
    path: '',
    component: Auth,
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: Login,
      },
      {
        path: 'forgot-password',
        pathMatch: 'full',
        component: ForgotPassword,
      },
      {
        path: 'set-password/:uid/:token',
        pathMatch: 'full',
        component: ResetPassword,
      },
      {
        path: 'reset/:uid/:token',
        pathMatch: 'full',
        component: ResetPassword,
      },
      {
        path: 'callback',
        pathMatch: 'full',
        component: OpenIdCallback,
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AuthRoutingModule { }
