import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { MobileAppService } from '../../core/services/mobile-app.service';

/**
 * Shown on the web when the tenant enables `force_mobile_app`: the web app is
 * blocked and the user is prompted to open or install the native app.
 */
@Component({
  selector: 'app-app-required',
  templateUrl: './app-required.page.html',
  styleUrls: ['./app-required.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon, TranslatePipe],
})
export class AppRequiredPage {
  private mobileApp = inject(MobileAppService);

  openInApp(): void {
    this.mobileApp.openInApp();
  }
}
