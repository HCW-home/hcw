import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonSelect, IonSelectOption, IonIcon } from '@ionic/angular/standalone';
import { TranslationService, AppLanguage } from '../../../core/services/translation.service';

@Component({
  selector: 'app-language-selector',
  templateUrl: './language-selector.component.html',
  styleUrls: ['./language-selector.component.scss'],
  standalone: true,
  imports: [CommonModule, IonSelect, IonSelectOption, IonIcon]
})
export class LanguageSelectorComponent {
  private translationService = inject(TranslationService);

  get currentLanguageCode(): string {
    return this.translationService.currentLanguage();
  }

  get availableLanguages(): AppLanguage[] {
    return this.translationService.availableLanguages();
  }

  onLanguageChange(event: CustomEvent): void {
    this.translationService.setLanguage(event.detail.value);
  }
}
