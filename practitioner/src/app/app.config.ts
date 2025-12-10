import {ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZoneChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideHttpClient, withFetch, withInterceptors} from '@angular/common/http';

import {TranslateModule} from '@ngx-translate/core';
import {TranslateHttpLoader, provideTranslateHttpLoader} from '@ngx-translate/http-loader';

import {routes} from './app.routes';
import {provideEnvironmentNgxMask} from 'ngx-mask';
import {provideIcons} from '@ng-icons/core';
import {
  heroCalendar,
  heroUser,
  heroUsers,
  heroVideoCamera,
  heroCamera,
  heroMicrophone,
  heroPhone,
  heroEye,
  heroEyeSlash,
  heroCheck,
  heroXMark,
  heroPlus,
  heroMagnifyingGlass,
  heroPencil,
  heroTrash,
  heroGlobeAlt,
  heroChevronDown,
  heroChevronLeft,
  heroChevronRight,
  heroArrowLeft,
  heroArrowRight,
  heroArrowDown,
  heroArrowRightOnRectangle,
  heroSquares2x2,
  heroDocumentText,
  heroClock,
  heroCheckCircle,
  heroXCircle,
  heroExclamationCircle,
  heroEnvelope,
  heroUserCircle,
  heroPause,
  heroSpeakerWave,
  heroSpeakerXMark,
  heroUserPlus,
  heroCalendarDays,
  heroInformationCircle,
  heroBars3,
  heroPaperAirplane,
} from '@ng-icons/heroicons/outline';
import {
  lucideVideoOff,
  lucideMicOff,
  lucidePhoneOff,
  lucideCameraOff,
} from '@ng-icons/lucide';
import {authInterceptor} from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideEnvironmentNgxMask(),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideIcons({
      heroCalendar,
      heroUser,
      heroUsers,
      heroVideoCamera,
      heroCamera,
      heroMicrophone,
      heroPhone,
      heroEye,
      heroEyeSlash,
      heroCheck,
      heroXMark,
      heroPlus,
      heroMagnifyingGlass,
      heroPencil,
      heroTrash,
      heroGlobeAlt,
      heroChevronDown,
      heroChevronLeft,
      heroChevronRight,
      heroArrowLeft,
      heroArrowRight,
      heroArrowDown,
      heroArrowRightOnRectangle,
      heroSquares2x2,
      heroDocumentText,
      heroClock,
      heroCheckCircle,
      heroXCircle,
      heroExclamationCircle,
      heroEnvelope,
      heroUserCircle,
      heroPause,
      heroSpeakerWave,
      heroSpeakerXMark,
      heroUserPlus,
      heroCalendarDays,
      heroInformationCircle,
      heroBars3,
      heroPaperAirplane,
      lucideVideoOff,
      lucideMicOff,
      lucidePhoneOff,
      lucideCameraOff,
    }),
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
