import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';

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

    const requiredTermId = user.main_organisation?.default_term;
    if (requiredTermId == null) {
      return true;
    }

    if (user.accepted_term === requiredTermId) {
      return true;
    }

    this.navCtrl.navigateRoot('/cgu');
    return false;
  }
}
