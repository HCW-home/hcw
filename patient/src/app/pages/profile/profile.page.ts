import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular/standalone';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
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
  IonButtons,
  IonBackButton,
  IonModal,
  IonSelect,
  IonSelectOption,
  NavController,
  AlertController,
  ToastController
} from '@ionic/angular/standalone';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../core/models/user.model';

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
    IonHeader,
    IonToolbar,
    IonTitle,
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
    IonButtons,
    IonBackButton,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonSpinner
  ]
})
export class ProfilePage implements OnInit {
  @ViewChild('avatarFileInput') avatarFileInput!: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  showEditModal = false;
  editedUser: Partial<User> = {};
  isUploadingAvatar = false;
  isSaving = false;

  timezones: string[] = [
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Zurich',
    'Europe/Rome',
    'Europe/Madrid',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Dubai',
    'Australia/Sydney'
  ];

  profileMenuItems: ProfileMenuItem[] = [
    {
      title: 'Personal Information',
      icon: 'person-outline',
      action: 'edit'
    },
    {
      title: 'Notifications',
      icon: 'notifications-outline',
      route: '/notifications'
    },
    {
      title: 'Logout',
      icon: 'log-out-outline',
      action: 'logout',
      color: 'danger'
    }
  ];

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadUserProfile();
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
      }
    });
  }

  handleMenuItemClick(item: ProfileMenuItem) {
    if (item.route) {
      this.navCtrl.navigateForward(item.route);
    } else if (item.action) {
      switch (item.action) {
        case 'edit':
          this.openEditProfile();
          break;
        case 'logout':
          this.confirmLogout();
          break;
      }
    }
  }

  openEditProfile() {
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    if (this.currentUser) {
      this.editedUser = {
        mobile_phone_number: this.currentUser.mobile_phone_number,
        communication_method: this.currentUser.communication_method,
        preferred_language: this.currentUser.preferred_language,
        timezone: this.currentUser.timezone
      };
    }
  }

  saveProfile() {
    this.isSaving = true;
    this.authService.updateProfile(this.editedUser).subscribe({
      next: (updatedUser) => {
        this.currentUser = updatedUser;
        this.isSaving = false;
        this.showEditModal = false;
        this.showToast('Profile updated successfully', 'success');
      },
      error: () => {
        this.isSaving = false;
        this.showToast('Failed to update profile', 'danger');
      }
    });
  }

  async confirmLogout() {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to logout?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Logout',
          handler: () => {
            this.logout();
          }
        }
      ]
    });
    await alert.present();
  }

  async logout() {
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
        this.showToast('Please select an image file', 'warning');
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
        this.showToast('Profile picture updated', 'success');
      },
      error: () => {
        this.isUploadingAvatar = false;
        this.showToast('Failed to upload profile picture', 'danger');
      }
    });
  }
}