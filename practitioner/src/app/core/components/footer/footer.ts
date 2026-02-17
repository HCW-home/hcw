import { Component } from '@angular/core';
import { Typography } from '../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../shared/constants/typography';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-footer',
  imports: [Typography, TranslatePipe],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer {
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
