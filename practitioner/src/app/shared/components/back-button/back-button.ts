import { Component, Inject, input, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser, Location } from '@angular/common';

import { TranslatePipe } from '@ngx-translate/core';
import { Button } from '../../ui-components/button/button';
import { ButtonSizeEnum, ButtonStateEnum, ButtonStyleEnum } from '../../constants/button';

@Component({
  selector: 'app-back-button',
  imports: [Button, TranslatePipe],
  templateUrl: './back-button.html',
  styleUrl: './back-button.scss',
})
export class BackButton {
   stopNavigate = input(false);

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private location: Location,
    private router: Router,
  ) {
  }

  onBack() {
    if (isPlatformBrowser(this.platformId) && !this.stopNavigate()) {
      if (window.history.length > 1) {
        this.location.back();
      } else {
        this.router.navigate(['/']);
      }
    }
  }

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
}
