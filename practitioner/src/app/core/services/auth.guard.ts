import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

export const redirectIfAuthenticated: CanMatchFn = () => {
  const token = localStorage.getItem('token');
  const router = inject(Router);

  if (token) {
    router.navigate(['/admin']);
    return false;
  }

  return true;
};

export const redirectIfUnauthenticated: CanMatchFn = () => {
  const token = localStorage.getItem('token');
  const router = inject(Router);

  if (!token) {
    router.navigate(['/admin-login']);
    return false;
  }

  return true;
};
