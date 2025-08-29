import {Component, inject} from '@angular/core';
import {Svg} from '../../../shared/ui-components/svg/svg';
import {Button} from '../../../shared/ui-components/button/button';
import {ButtonStateEnum, ButtonStyleEnum} from '../../../shared/constants/button';
import {Router} from '@angular/router';
import {RoutePaths} from '../../constants/routes';

@Component({
  selector: 'app-header',
  imports: [Svg, Button],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  private router = inject(Router);

  openProfile() {
    this.router.navigate([RoutePaths.USER, RoutePaths.PROFILE]);
  }

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
}
