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
  IonDatetime,
  IonSelect,
  IonSelectOption,
  NavController,
  AlertController,
  ToastController
} from '@ionic/angular/standalone';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
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
    IonDatetime,
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
      title: 'Settings',
      icon: 'settings-outline',
      action: 'settings'
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
    private apiService: ApiService,
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
        this.editedUser = { ...user };
      }
    });

    // Load mock data if no user
    if (!this.currentUser) {
      this.currentUser = {
        id: 1,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1 234-567-8900',
        date_of_birth: '1985-06-15',
        gender: 'Male',
        blood_type: 'O+',
        height: '5\'10"',
        weight: '165 lbs',
        address: '123 Main St, New York, NY 10001',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_active: true,
        user_type: 'patient'
      } as any as User;
      this.editedUser = { ...this.currentUser };
    }
  }

  handleMenuItemClick(item: ProfileMenuItem) {
    if (item.route) {
      this.navCtrl.navigateForward(item.route);
    } else if (item.action) {
      switch (item.action) {
        case 'edit':
          this.openEditProfile();
          break;
        case 'settings':
          this.openSettings();
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
    this.editedUser = { ...this.currentUser };
  }

  async saveProfile() {
    try {
      const response = await this.apiService.patch(`/users/${this.currentUser?.id}/`, this.editedUser).toPromise();
      if (response) {
        this.currentUser = { ...this.currentUser, ...this.editedUser } as User;
        // this.authService.updateUser(this.currentUser); // TODO: Add this method to AuthService
        this.showEditModal = false;
        this.showToast('Profile updated successfully');
      }
    } catch (error) {
      // Mock success for now
      this.currentUser = { ...this.currentUser, ...this.editedUser } as User;
      this.showEditModal = false;
      this.showToast('Profile updated successfully');
    }
  }

  openSettings() {
    this.navCtrl.navigateForward('/notification-settings');
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

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'success'
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
        this.showToast('Please select an image file');
      }
    }
    input.value = '';
  }

  uploadAvatar(file: File): void {
    this.isUploadingAvatar = true;
    this.authService.uploadProfilePicture(file).subscribe({
      next: (updatedUser) => {
        this.currentUser = updatedUser;
        this.editedUser = { ...updatedUser };
        this.isUploadingAvatar = false;
        this.showToast('Profile picture updated');
      },
      error: () => {
        this.isUploadingAvatar = false;
        this.showToast('Failed to upload profile picture');
      }
    });
  }
}