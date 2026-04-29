import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonInput,
  IonButton,
  IonText,
  NavController,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../../core/services/auth.service';
import { EncryptionService } from '../../core/services/encryption.service';
import { TranslationService } from '../../core/services/translation.service';

@Component({
  selector: 'app-activate-encryption',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonInput,
    IonButton,
    IonText,
    TranslatePipe,
  ],
  templateUrl: './activate-encryption.page.html',
  styleUrls: ['./activate-encryption.page.scss'],
})
export class ActivateEncryptionPage implements OnInit {
  private authService = inject(AuthService);
  private encryptionService = inject(EncryptionService);
  private navCtrl = inject(NavController);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private t = inject(TranslationService);

  passphrase = '';
  saving = signal(false);
  newPassphraseShown = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.authService.authReady;
  }

  async submit(): Promise<void> {
    if (!this.passphrase || this.saving()) {
      return;
    }
    const user = this.authService.currentUserValue;
    if (!user) {
      this.navCtrl.navigateRoot('/login');
      return;
    }
    this.saving.set(true);
    try {
      await this.encryptionService.activatePassphrase(user.pk, this.passphrase);
      this.navCtrl.navigateRoot('/home');
    } catch (err) {
      console.error('activate-encryption submit failed', err);
      this.saving.set(false);
      const toast = await this.toastCtrl.create({
        message: this.t.instant('activateEncryption.invalidPassphrase'),
        duration: 3000,
        color: 'danger',
      });
      await toast.present();
    }
  }

  async forgotPassphrase(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('activateEncryption.forgotTitle'),
      message: this.t.instant('activateEncryption.forgotConfirm'),
      buttons: [
        { text: this.t.instant('common.cancel'), role: 'cancel' },
        {
          text: this.t.instant('common.ok'),
          handler: async () => {
            try {
              const response = await this.encryptionService.forgotPassphrase();
              this.newPassphraseShown.set(response.passphrase);
              this.passphrase = response.passphrase;
            } catch {
              const toast = await this.toastCtrl.create({
                message: this.t.instant('activateEncryption.forgotFailed'),
                duration: 3000,
                color: 'danger',
              });
              await toast.present();
            }
          },
        },
      ],
    });
    await alert.present();
  }
}
