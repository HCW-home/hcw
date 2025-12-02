import {ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZoneChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideHttpClient, withFetch, withInterceptors} from '@angular/common/http';

import {TranslateModule} from '@ngx-translate/core';
import {TranslateHttpLoader, provideTranslateHttpLoader} from '@ngx-translate/http-loader';

import {routes} from './app.routes';
import {provideEnvironmentNgxMask} from 'ngx-mask';
import {provideAngularSvgIcon} from 'angular-svg-icon';
import {authInterceptor} from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideEnvironmentNgxMask(),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideAngularSvgIcon(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideTranslateHttpLoader({
      prefix: './i18n/',
      suffix: '.json',
    }),
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateHttpLoader,
          useClass: TranslateHttpLoader,
        },
        defaultLanguage: 'en',
      })
    ),
  ]
};
