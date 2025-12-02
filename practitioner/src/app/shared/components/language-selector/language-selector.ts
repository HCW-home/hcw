import { Component, inject, signal, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { TranslationService, AppLanguage } from '../../../core/services/translation.service';
import { Svg } from '../../ui-components/svg/svg';

@Component({
  selector: 'app-language-selector',
  imports: [CommonModule, TranslateModule, Svg],
  templateUrl: './language-selector.html',
  styleUrl: './language-selector.scss',
})
export class LanguageSelector {
  private translationService = inject(TranslationService);
  private elementRef = inject(ElementRef);

  isOpen = signal(false);

  get currentLanguage(): AppLanguage | undefined {
    return this.translationService.getCurrentLanguage();
  }

  get availableLanguages(): AppLanguage[] {
    return this.translationService.availableLanguages;
  }

  toggleDropdown(): void {
    this.isOpen.update(v => !v);
  }

  selectLanguage(lang: AppLanguage): void {
    this.translationService.setLanguage(lang.code);
    this.isOpen.set(false);
  }

  isSelected(lang: AppLanguage): boolean {
    return this.currentLanguage?.code === lang.code;
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.isOpen.set(false);
    }
  }
}
