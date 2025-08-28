import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Auth } from './pages/auth/auth';
import { Login } from './components/login/login';
import { ForgotPassword } from './components/forgot-password/forgot-password';
import { ResetPassword } from './components/reset-password/reset-password';

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
        path: 'set-password/:code',
        pathMatch: 'full',
        component: ResetPassword,
      },
      {
        path: 'reset-password/:code',
        pathMatch: 'full',
        component: ResetPassword,
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
