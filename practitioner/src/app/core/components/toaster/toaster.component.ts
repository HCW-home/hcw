import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IToast } from '../../models/toast';
import { Svg } from '../../../shared/ui-components/svg/svg';
import { Button } from '../../../shared/ui-components/button/button';
import { ButtonStyleEnum, ButtonSizeEnum } from '../../../shared/constants/button';

@Component({
  selector: 'app-toaster',
  imports: [Svg, Button],
  templateUrl: './toaster.component.html',
  styleUrl: './toaster.component.scss',
})
export class ToasterComponent {
  @Input() toast!: IToast;
  @Output() close = new EventEmitter<string>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  traceExpanded = false;

  onClose(): void {
    this.close.emit(this.toast.id);
  }
}
