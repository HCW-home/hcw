import { Component, input, output } from '@angular/core';
import { backdropAnimation } from '../../animations/modal';
import { Typography } from '../../ui-components/typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';
import { Button } from '../../ui-components/button/button';
import { ButtonSizeEnum, ButtonStateEnum, ButtonStyleEnum } from '../../constants/button';

@Component({
  selector: 'app-overlay',
  imports: [Typography, Button],
  templateUrl: './overlay.html',
  styleUrl: './overlay.scss',
  animations: [backdropAnimation],
})
export class Overlay {
  title = input<string>('');
  closeOverlay = output();

  close() {
    this.closeOverlay.emit();
  }

  onClose(e: MouseEvent) {
    e.stopPropagation();
    this.close();
  }

  handleOutsideClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.close();
    }
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
}
