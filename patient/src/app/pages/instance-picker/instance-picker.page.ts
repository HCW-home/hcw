import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonInput,
  IonButton,
  IonIcon,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DeeplinkService, KnownInstance } from '../../core/services/deeplink.service';

@Component({
  selector: 'app-instance-picker',
  templateUrl: './instance-picker.page.html',
  styleUrls: ['./instance-picker.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonItem,
    IonLabel,
    IonList,
    IonInput,
    IonButton,
    IonIcon,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    TranslatePipe,
  ],
})
export class InstancePickerPage implements OnInit {
  private deeplinkService = inject(DeeplinkService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private translate = inject(TranslateService);

  instances: KnownInstance[] = [];
  newHost = '';
  adding = false;

  ngOnInit(): void {
    this.instances = this.deeplinkService.getKnownInstances();
  }

  select(host: string): void {
    this.deeplinkService.selectInstance(host);
  }

  async remove(host: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('instancePicker.confirmRemoveTitle'),
      message: this.translate.instant('instancePicker.confirmRemoveMessage', { host }),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.remove'),
          role: 'destructive',
          handler: () => {
            this.deeplinkService.removeInstance(host);
            this.instances = this.deeplinkService.getKnownInstances();
          },
        },
      ],
    });
    await alert.present();
  }

  async addInstance(): Promise<void> {
    if (!this.newHost.trim() || this.adding) {
      return;
    }
    this.adding = true;
    const result = await this.deeplinkService.addInstanceManually(this.newHost);
    this.adding = false;

    if (result === true) {
      this.instances = this.deeplinkService.getKnownInstances();
      this.newHost = '';
      this.deeplinkService.selectInstance(this.instances[0].host);
    } else {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant(`untrustedInstance.reason.${result}`),
        duration: 4000,
        color: 'danger',
      });
      await toast.present();
    }
  }
}
