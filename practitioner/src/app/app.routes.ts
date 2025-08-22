import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/auth', pathMatch: 'full' },
  {
    path: 'auth',
    loadChildren: () => import('./auth/auth-module').then(m => m.AuthModule)
  },
  {
    path: 'user',
    loadChildren: () => import('./user/user-module').then(m => m.UserModule)
  }
];
