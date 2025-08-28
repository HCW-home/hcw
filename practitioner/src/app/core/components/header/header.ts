import { Component } from '@angular/core';
import { Svg } from '../../../shared/ui-components/svg/svg';
import { Button } from '../../../shared/ui-components/button/button';
import { ButtonStateEnum, ButtonStyleEnum } from '../../../shared/constants/button';

@Component({
  selector: 'app-header',
  imports: [Svg, Button],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
}
