import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * When the tenant enables `force_mobile_app`, the patient WEB app is blocked and
 * users are sent to the /app-required page prompting them to open or install the
 * native app. Inside the native app itself the guard is a no-op, otherwise the
 * app would lock itself out.
 */
export const mobileAppRequiredGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const authService = inject(AuthService);

  // Never block the native app.
  if (Capacitor.isNativePlatform()) {
    return true;
  }

  let forced = false;
  try {
    const config = await firstValueFrom(authService.getConfig());
    forced = !!config?.force_mobile_app;
  } catch {
    // If config can't be fetched, don't lock the user out.
    return true;
  }

  if (!forced) {
    return true;
  }

  return router.createUrlTree(['/app-required']);
};
