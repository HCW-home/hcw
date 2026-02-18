import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpBackend } from '@angular/common/http';
import { TranslateService, TranslationObject } from '@ngx-translate/core';
import { catchError, EMPTY } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AppLanguage {
  code: string;
  name: string;
  nativeName: string;
}

const AVAILABLE_LANGUAGES: AppLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'fr', name: 'French', nativeName: 'Francais' },
];

const STORAGE_KEY = 'app_language';
const DEFAULT_LANGUAGE = 'en';

@Injectable({
  providedIn: 'root',
})
export class TranslationService {
  private currentLanguageSignal = signal<string>(DEFAULT_LANGUAGE);
  private http = new HttpClient(inject(HttpBackend));

  readonly currentLanguage = this.currentLanguageSignal.asReadonly();
  readonly availableLanguages = AVAILABLE_LANGUAGES;

  constructor(private translate: TranslateService) {
    this.initializeLanguage();
  }

  private initializeLanguage(): void {
    this.translate.addLangs(AVAILABLE_LANGUAGES.map(lang => lang.code));
    this.translate.setDefaultLang(DEFAULT_LANGUAGE);

    const savedLanguage = localStorage.getItem(STORAGE_KEY);
    const browserLang = this.translate.getBrowserLang();
    const langToUse = savedLanguage ||
      (browserLang && AVAILABLE_LANGUAGES.some(l => l.code === browserLang)
        ? browserLang
        : DEFAULT_LANGUAGE);

    this.setLanguage(langToUse);
  }

  setLanguage(langCode: string): void {
    if (!AVAILABLE_LANGUAGES.some(l => l.code === langCode)) {
      langCode = DEFAULT_LANGUAGE;
    }

    this.translate.use(langCode);
    this.fetchAndApplyOverrides(langCode);
    this.currentLanguageSignal.set(langCode);
    localStorage.setItem(STORAGE_KEY, langCode);
    document.documentElement.lang = langCode;
  }

  getCurrentLanguage(): AppLanguage | undefined {
    return AVAILABLE_LANGUAGES.find(l => l.code === this.currentLanguageSignal());
  }

  instant(key: string, params?: Record<string, string>): string {
    return this.translate.instant(key, params);
  }

  private fetchAndApplyOverrides(langCode: string): void {
    this.http.get<Record<string, string>>(`${environment.apiUrl}/translations/patient/${langCode}/`)
      .pipe(catchError(() => EMPTY))
      .subscribe(overrides => {
        if (overrides && Object.keys(overrides).length > 0) {
          const nested = this.expandDotNotation(overrides);
          this.translate.setTranslation(langCode, nested, true);
        }
      });
  }

  private expandDotNotation(flat: Record<string, string>): TranslationObject {
    const result: TranslationObject = {};
    for (const key of Object.keys(flat)) {
      const parts = key.split('.');
      let current: TranslationObject = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
          current[parts[i]] = {};
        }
        current = current[parts[i]] as TranslationObject;
      }
      current[parts[parts.length - 1]] = flat[key];
    }
    return result;
  }
}
