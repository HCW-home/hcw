import { Routes } from '@angular/router';
import { RoutePaths } from './core/constants/routes';
import {
  redirectIfAuthenticated,
  redirectIfUnauthenticated,
} from './core/services/auth.guard';

export const routes: Routes = [
  {
    path: RoutePaths.VERIFY_INVITE,
    loadComponent: () =>
      import('./pages/verify-invite/verify-invite').then(c => c.VerifyInvite),
  },
  {
    path: RoutePaths.CONFIRM_PRESENCE,
    loadComponent: () =>
      import('./pages/confirm-presence/confirm-presence').then(c => c.ConfirmPresence),
  },
  {
    path: RoutePaths.AUTH,
    loadChildren: () =>
      import('./modules/auth/auth-module').then(c => c.AuthModule),
    canMatch: [redirectIfAuthenticated],
  },
  {
    path: RoutePaths.USER,
    loadChildren: () =>
      import('./modules/user/user-module').then(c => c.UserModule),
    canMatch: [redirectIfUnauthenticated],
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: RoutePaths.AUTH,
  },
  {
    path: '**',
    redirectTo: RoutePaths.AUTH,
  },
];
