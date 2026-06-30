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

    // Preserve query params (email/auth, action, id, model) so the target page
    // can pre-fill the email field / consume the magic-link token and route the
    // user after authentication. A magic-link token must go to verify-invite,
    // which is the only page that knows how to log in with it; the login page
    // only handles the email flow.
    const target = route.queryParams['auth'] ? '/verify-invite' : '/login';
    this.navCtrl.navigateRoot(target, { queryParams: route.queryParams });
    return false;
  }
}