import { Component, input } from '@angular/core';
import { Typography } from '../typography/typography';
import { Svg } from '../svg/svg';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-label-value',
  imports: [Typography, Svg],
  templateUrl: './label-value.html',
  styleUrl: './label-value.scss',
})
export class LabelValue {
  label = input.required<string>();
  value = input.required<string>();
  icon = input<string>('');
  image = input<string>('');

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
