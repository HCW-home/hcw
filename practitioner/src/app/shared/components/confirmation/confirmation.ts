import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmationService } from '../../../core/services/confirmation.service';
import { Typography } from '../../ui-components/typography/typography';
import { Button } from '../../ui-components/button/button';
import { Svg } from '../../ui-components/svg/svg';
import { TypographyTypeEnum } from '../../constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum, ButtonStateEnum } from '../../constants/button';

@Component({
  selector: 'app-confirmation',
  imports: [CommonModule, Typography, Button, Svg],
  templateUrl: './confirmation.html',
  styleUrl: './confirmation.scss',
})
export class Confirmation {
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  confirmationService = inject(ConfirmationService);

  get isOpen(): boolean {
    return this.confirmationService.isOpen();
  }

  get title(): string {
    return this.confirmationService.config()?.title || 'Confirm';
  }

  get message(): string {
    return this.confirmationService.config()?.message || '';
  }

  get confirmText(): string {
    return this.confirmationService.config()?.confirmText || 'Confirm';
  }

  get cancelText(): string {
    return this.confirmationService.config()?.cancelText || 'Cancel';
  }

  get isDanger(): boolean {
    return this.confirmationService.config()?.confirmStyle === 'danger';
  }

  onConfirm(): void {
    this.confirmationService.handleConfirm();
  }

  onCancel(): void {
    this.confirmationService.handleCancel();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('confirmation-backdrop')) {
      this.onCancel();
    }
  }
}
