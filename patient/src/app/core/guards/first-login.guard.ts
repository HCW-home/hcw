import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { NavController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root',
})
export class FirstLoginGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private navCtrl: NavController,
  ) {}

  async canActivate(
    _route: ActivatedRouteSnapshot,
    _state: RouterStateSnapshot,
  ): Promise<boolean | UrlTree> {
    await this.authService.authReady;

    const user = this.authService.currentUserValue;
    if (!user) {
      return true;
    }

    // Temporary users never go through onboarding: their language and
    // communication method are already set by the practitioner who created
    // them, and the account is short-lived.
    if (user.temporary) {
      return true;
    }

    if (user.is_first_login) {
      this.navCtrl.navigateRoot('/onboarding');
      return false;
    }

    return true;
  }
}
