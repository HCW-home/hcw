import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Deep-links into the native app, falling back to the app store when it isn't
 * installed. Store URLs / Android package come from the backend /config
 * (env default, per-instance Constance override); the URL scheme is a build
 * constant matching the native manifests.
 */
@Injectable({ providedIn: 'root' })
export class MobileAppService {
  private authService = inject(AuthService);

  /**
   * Open the current instance in the native app. There is no reliable web API
   * to detect whether an app is installed, so:
   *  - Android: an `intent://` URL opens the app or (via
   *    S.browser_fallback_url) redirects to the Play Store.
   *  - iOS: fire the deeplink and, if an App Store URL is configured, schedule
   *    a fallback redirect cancelled when the app takes focus.
   *  - Other platforms: just fire the deeplink.
   */
  async openInApp(): Promise<void> {
    const host = window.location.host;
    const scheme = environment.mobileAppScheme;
    const deeplink = `${scheme}://${host}/home`;
    const ua = navigator.userAgent;

    let androidPackage = '';
    let androidStoreUrl = '';
    let iosStoreUrl = '';
    try {
      const config = await firstValueFrom(this.authService.getConfig());
      androidPackage = config?.mobile_android_package || '';
      androidStoreUrl = config?.mobile_android_store_url || '';
      iosStoreUrl = config?.mobile_ios_store_url || '';
    } catch {
      // Fall back to a plain deeplink below.
    }

    if (/android/i.test(ua) && androidPackage) {
      const fallback = androidStoreUrl
        ? `S.browser_fallback_url=${encodeURIComponent(androidStoreUrl)};`
        : '';
      // intent://<host>/home#Intent;scheme=<scheme>;package=<pkg>;S.browser_fallback_url=<store>;end
      window.location.href =
        `intent://${host}/home#Intent;scheme=${scheme};package=${androidPackage};` +
        `${fallback}end`;
      return;
    }

    if (/iphone|ipad|ipod/i.test(ua) && iosStoreUrl) {
      const fallbackTimer = setTimeout(() => {
        window.location.href = iosStoreUrl;
      }, 1500);
      // If the app opens, the page is backgrounded — cancel the store redirect.
      const cancel = () => clearTimeout(fallbackTimer);
      window.addEventListener('pagehide', cancel, { once: true });
      window.addEventListener('blur', cancel, { once: true });
      window.location.href = deeplink;
      return;
    }

    window.location.href = deeplink;
  }
}
