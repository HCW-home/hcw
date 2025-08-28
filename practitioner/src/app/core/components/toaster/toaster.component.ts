import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Toast } from '../../models/toast';
import { Typography } from '../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../shared/constants/typography';

@Component({
  selector: 'app-toaster',
  imports: [Typography],
  templateUrl: './toaster.component.html',
  styleUrl: './toaster.component.scss',
})
export class ToasterComponent {
  @Input() toast!: Toast;
  @Input() i!: number;

  @Output() remove = new EventEmitter<number>();
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
