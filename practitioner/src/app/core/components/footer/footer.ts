import { Component } from '@angular/core';
import { Typography } from '../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../shared/constants/typography';

@Component({
  selector: 'app-footer',
  imports: [Typography],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer {
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
