import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RoutePaths } from '../../../core/constants/routes';
import { Auth } from '../../../core/services/auth';

export const redirectIfPatientManagementDisabled: CanActivateFn = async () => {
  const authService = inject(Auth);
  const router = inject(Router);

  try {
    const config = await firstValueFrom(authService.getOpenIDConfig());
    if (config?.force_temporary_patients) {
      return router.createUrlTree([`/${RoutePaths.USER}/${RoutePaths.DASHBOARD}`]);
    }
  } catch {
    return true;
  }

  return true;
};
