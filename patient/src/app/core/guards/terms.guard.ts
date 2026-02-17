import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TermsGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private navCtrl: NavController
  ) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean | UrlTree> {
    await this.authService.authReady;

    const user = this.authService.currentUserValue;
    if (!user) {
      return true;
    }

    let requiredTermId = user.main_organisation?.default_term;

    // Fallback to main organization from app config
    if (requiredTermId == null) {
      try {
        const config = await firstValueFrom(this.authService.getConfig());
        requiredTermId = config?.main_organization?.default_term;
      } catch {
        // Ignore config fetch errors
      }
    }

    if (requiredTermId == null) {
      return true;
    }

    if (user.accepted_term === requiredTermId) {
      return true;
    }

    this.navCtrl.navigateRoot('/terms');
    return false;
  }
}
