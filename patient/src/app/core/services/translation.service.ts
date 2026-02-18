import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

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
}
