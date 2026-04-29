import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NavController } from '@ionic/angular';

import { AuthService } from '../services/auth.service';
import { EncryptionService } from '../services/encryption.service';

@Injectable({ providedIn: 'root' })
export class EncryptionGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private encryptionService: EncryptionService,
    private navCtrl: NavController,
  ) {}

  async canActivate(
    _route: ActivatedRouteSnapshot,
    _state: RouterStateSnapshot,
  ): Promise<boolean | UrlTree> {
    await this.authService.authReady;
    if (!this.authService.isAuthenticatedValue) {
      return true;
    }

    try {
      this.authService.invalidateConfigCache();
      const config = await firstValueFrom(this.authService.getConfig());
      if (!config?.encryption_enabled) {
        return true;
      }
      const user = this.authService.currentUserValue;
      if (!user) {
        return true;
      }
      if (!user.public_key) {
        // Not yet provisioned server-side; nothing to unlock locally.
        return true;
      }
      const hasLocal = await this.encryptionService.hasLocalKey(user.pk);
      if (!hasLocal) {
        this.navCtrl.navigateRoot('/activate-encryption');
        return false;
      }
    } catch {
      return true;
    }
    return true;
  }
}
