import { Input, Output, Component, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ModalComponent } from '../modal/modal.component';
import { Svg } from '../../ui-components/svg/svg';
import { Button } from '../../ui-components/button/button';
import { ButtonStyleEnum, ButtonSizeEnum } from '../../constants/button';
import { TranslatePipe } from '@ngx-translate/core';

export type ElementType = 'appointment' | 'reminder';

@Component({
  selector: 'app-element-type-modal',
  templateUrl: './element-type-modal.html',
  styleUrl: './element-type-modal.scss',
  imports: [CommonModule, ModalComponent, Svg, Button, TranslatePipe],
})
export class ElementTypeModal {
  @Input() isOpen = false;

  @Output() closed = new EventEmitter<void>();
  @Output() typeSelected = new EventEmitter<ElementType>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  onClose(): void {
    this.closed.emit();
  }

  select(type: ElementType): void {
    this.typeSelected.emit(type);
  }
}
