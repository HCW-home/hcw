import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { NavController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class PublicAccessGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private navCtrl: NavController
  ) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean | UrlTree> {
    const config = await firstValueFrom(this.authService.getConfig());

    if (config?.public_organisations) {
      return true;
    }

    await this.authService.authReady;
    if (this.authService.isAuthenticatedValue) {
      return true;
    }

    const target = route.queryParams['auth'] ? '/verify-invite' : '/login';
    this.navCtrl.navigateRoot(target, { queryParams: route.queryParams });
    return false;
  }
}