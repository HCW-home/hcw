import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import {RoutePaths} from '../constants/routes';

export const redirectIfAuthenticated: CanMatchFn = () => {
  const token = localStorage.getItem('token');
  const router = inject(Router);

  if (token) {
    router.navigate([`/${RoutePaths.USER}`]);
    return false;
  }

  return true;
};

export const redirectIfUnauthenticated: CanMatchFn = () => {
  const token = localStorage.getItem('token');
  const router = inject(Router);

  if (!token) {
    router.navigate([`/${RoutePaths.AUTH}`]);
    return false;
  }

  return true;
};
