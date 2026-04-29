import { Component, OnInit, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular/standalone';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonAvatar,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonText,
  IonButton,
  IonInput,
  IonSelect,
  IonSelectOption,
  NavController,
  AlertController,
  ToastController
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { EncryptionService } from '../../core/services/encryption.service';
import { UserWebSocketService } from '../../core/services/user-websocket.service';
import { NotificationService } from '../../core/services/notification.service';
import { TranslationService } from '../../core/services/translation.service';
import { User } from '../../core/models/user.model';
import { TIMEZONES } from '../../core/constants/timezone';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';

interface ProfileMenuItem {
  title: string;
  icon: string;
  route?: string;
  action?: string;
  color?: string;
  badge?: string;
}

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonAvatar,
    IonList,
    IonItem,
    IonLabel,
    IonIcon,
    IonText,
    IonButton,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    TranslatePipe,
    AppHeaderComponent,
    AppFooterComponent,
  ]
})
export class ProfilePage implements OnInit {
  private t = inject(TranslationService);
  @ViewChild('avatarFileInput') avatarFileInput!: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  showEditModal = false;
  editedUser: Partial<User> = {};
  isUploadingAvatar = false;
  isSaving = false;
  fieldErrors: { [key: string]: string[] } = {};

  timezones: string[] = TIMEZONES;
  availableLanguages = this.t.availableLanguages;
  communicationMethods: string[] = [];

  encryptionEnabled = false;
  encryptionKeyLoaded = false;

  get profileMenuItems(): ProfileMenuItem[] {
    const items: ProfileMenuItem[] = [];
    if (this.encryptionEnabled) {
      if (this.encryptionKeyLoaded) {
        items.push({
          title: this.t.instant('profile.encryptionPurgeKey'),
          icon: 'key-outline',
          action: 'encryption-purge',
        });
        items.push({
          title: this.t.instant('profile.encryptionChangePassphrase'),
          icon: 'key-outline',
          action: 'encryption-change',
        });
      } else {
        items.push({
          title: this.t.instant('profile.encryptionLoadKey'),
          icon: 'key-outline',
          action: 'encryption-load',
        });
      }
    }
    items.push({
      title: this.t.instant('profile.logout'),
      icon: 'log-out-outline',
      action: 'logout',
      color: 'danger',
    });
    return items;
  }

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private encryptionService: EncryptionService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadUserProfile();
    this.loadConfig();
  }

  ionViewWillEnter() {
    this.loadUserProfile();
  }

  loadUserProfile() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.editedUser = {
          mobile_phone_number: user.mobile_phone_number,
          communication_method: user.communication_method,
          preferred_language: user.preferred_language,
          timezone: user.timezone
        };
        this.refreshEncryptionStatus();
      }
    });
  }

  loadConfig() {
    this.authService.getConfig().subscribe({
      next: (config: any) => {
        if (config.communication_methods) {
          this.communicationMethods = config.communication_methods;
        }
        this.encryptionEnabled = !!config.encryption_enabled;
        this.refreshEncryptionStatus();
      },
      error: () => {
        // Fallback to default methods if config fails
        this.communicationMethods = ['email', 'sms', 'whatsapp'];
      }
    });
  }

  async refreshEncryptionStatus() {
    if (!this.currentUser) {
      return;
    }
    this.encryptionKeyLoaded = await this.encryptionService.hasLocalKey(
      this.currentUser.pk,
    );
  }

  handleMenuItemClick(item: ProfileMenuItem) {
    if (item.route) {
      this.navCtrl.navigateForward(item.route);
    } else if (item.action) {
      switch (item.action) {
        case 'logout':
          this.confirmLogout();
          break;
        case 'encryption-load':
          this.promptEncryptionLoad();
          break;
        case 'encryption-purge':
          this.confirmEncryptionPurge();
          break;
        case 'encryption-change':
          this.promptEncryptionChange();
          break;
      }
    }
  }

  async promptEncryptionLoad() {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('profile.encryptionLoadKey'),
      message: this.t.instant('profile.encryptionLoadKeyMessage'),
      inputs: [
        {
          name: 'passphrase',
          type: 'password',
          placeholder: this.t.instant('profile.encryptionPassphrase'),
        },
      ],
      buttons: [
        { text: this.t.instant('common.cancel'), role: 'cancel' },
        {
          text: this.t.instant('profile.encryptionConfirm'),
          handler: async (data: { passphrase: string }) => {
            if (!this.currentUser || !data.passphrase) return;
            try {
              await this.encryptionService.activatePassphrase(
                this.currentUser.pk,
                data.passphrase,
              );
              this.encryptionKeyLoaded = true;
              this.showToast(
                this.t.instant('profile.encryptionKeyLoaded'),
                'success',
              );
            } catch {
              this.showToast(
                this.t.instant('profile.encryptionInvalidPassphrase'),
                'danger',
              );
            }
          },
        },
        {
          text: this.t.instant('profile.encryptionForgotPassphrase'),
          handler: () => {
            this.handleForgotPassphrase();
            return false;
          },
        },
      ],
    });
    await alert.present();
  }

  async handleForgotPassphrase() {
    try {
      const response = await this.encryptionService.forgotPassphrase();
      const alert = await this.alertCtrl.create({
        header: this.t.instant('profile.encryptionNewPassphraseTitle'),
        message: `${this.t.instant('profile.encryptionNewPassphraseMessage')}\n\n${response.passphrase}`,
        buttons: [{ text: this.t.instant('common.ok') }],
      });
      await alert.present();
    } catch {
      this.showToast(this.t.instant('common.error'), 'danger');
    }
  }

  async confirmEncryptionPurge() {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('profile.encryptionPurgeKey'),
      message: this.t.instant('profile.encryptionPurgeConfirm'),
      buttons: [
        { text: this.t.instant('common.cancel'), role: 'cancel' },
        {
          text: this.t.instant('profile.encryptionConfirm'),
          handler: async () => {
            await this.encryptionService.purgeLocalKey();
            this.encryptionKeyLoaded = false;
            this.showToast(
              this.t.instant('profile.encryptionPurged'),
              'success',
            );
          },
        },
      ],
    });
    await alert.present();
  }

  async promptEncryptionChange() {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('profile.encryptionChangePassphrase'),
      inputs: [
        {
          name: 'oldPassphrase',
          type: 'password',
          placeholder: this.t.instant('profile.encryptionOldPassphrase'),
        },
        {
          name: 'newPassphrase',
          type: 'password',
          placeholder: this.t.instant('profile.encryptionNewPassphrase'),
        },
      ],
      buttons: [
        { text: this.t.instant('common.cancel'), role: 'cancel' },
        {
          text: this.t.instant('profile.encryptionConfirm'),
          handler: async (data: { oldPassphrase: string; newPassphrase: string }) => {
            if (!data.oldPassphrase || !data.newPassphrase) return;
            try {
              await this.encryptionService.changePassphrase(
                data.oldPassphrase,
                data.newPassphrase,
              );
              this.showToast(
                this.t.instant('profile.encryptionPassphraseChanged'),
                'success',
              );
            } catch {
              this.showToast(
                this.t.instant('profile.encryptionInvalidOldPassphrase'),
                'danger',
              );
            }
          },
        },
      ],
    });
    await alert.present();
  }

  saveProfile() {
    this.isSaving = true;
    this.fieldErrors = {};
    const payload = {
      ...this.editedUser,
      mobile_phone_number: this.editedUser.mobile_phone_number || '',
    };
    this.authService.updateProfile(payload).subscribe({
      next: (updatedUser) => {
        this.currentUser = updatedUser;
        this.isSaving = false;
        if (updatedUser.preferred_language) {
          this.t.setLanguage(updatedUser.preferred_language);
        }
        this.showToast(this.t.instant('profile.profileUpdated'), 'success');
      },
      error: (error) => {
        this.isSaving = false;
        if (error.error && typeof error.error === 'object') {
          this.fieldErrors = error.error;
        } else {
          this.showToast(this.t.instant('profile.profileUpdateFailed'), 'danger');
        }
      }
    });
  }

  getFieldError(fieldName: string): string | null {
    const errors = this.fieldErrors[fieldName];
    return errors && errors.length > 0 ? errors[0] : null;
  }

  async confirmLogout() {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('profile.confirmLogout'),
      message: this.t.instant('profile.confirmLogoutMessage'),
      buttons: [
        {
          text: this.t.instant('common.cancel'),
          role: 'cancel'
        },
        {
          text: this.t.instant('profile.logout'),
          handler: () => {
            this.logout();
          }
        }
      ]
    });
    await alert.present();
  }

  private userWsService = inject(UserWebSocketService);
  private notificationService = inject(NotificationService);

  async logout() {
    this.userWsService.disconnect();
    this.notificationService.resetOnLogout();
    await this.authService.logout();
    this.navCtrl.navigateRoot('/login');
  }

  async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color
    });
    toast.present();
  }

  getInitials(): string {
    if (!this.currentUser) return 'U';
    return `${this.currentUser.first_name?.charAt(0) || ''}${this.currentUser.last_name?.charAt(0) || ''}`.toUpperCase();
  }

  openAvatarFilePicker(): void {
    this.avatarFileInput.nativeElement.click();
  }

  onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file.type.startsWith('image/')) {
        this.uploadAvatar(file);
      } else {
        this.showToast(this.t.instant('profile.selectImageFile'), 'warning');
      }
    }
    input.value = '';
  }

  uploadAvatar(file: File): void {
    this.isUploadingAvatar = true;
    this.authService.uploadProfilePicture(file).subscribe({
      next: (updatedUser) => {
        this.currentUser = updatedUser;
        this.isUploadingAvatar = false;
        this.showToast(this.t.instant('profile.pictureUpdated'), 'success');
      },
      error: () => {
        this.isUploadingAvatar = false;
        this.showToast(this.t.instant('profile.pictureUploadFailed'), 'danger');
      }
    });
  }
}