import { Component, input } from '@angular/core';
import { Svg } from '../../ui-components/svg/svg';
import { Typography } from '../../ui-components/typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-error-message',
  imports: [Svg, Typography],
  templateUrl: './error-message.html',
  styleUrl: './error-message.scss',
})
export class ErrorMessage {
   message = input('Required Field')
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
