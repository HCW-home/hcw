import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private navCtrl: NavController
  ) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean | UrlTree> {
    await this.authService.authReady;

    const isAuthenticated = this.authService.isAuthenticatedValue;
    if (isAuthenticated) {
      return true;
    }

    // Preserve query params (email, action, id, model) so the login page can
    // pre-fill the email field and route the user after authentication.
    this.navCtrl.navigateRoot('/login', { queryParams: route.queryParams });
    return false;
  }
}