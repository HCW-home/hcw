import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
    IonModal,
    IonDatetime,
    IonSelect,
    IonSelectOption
  ]
})
export class ProfilePage implements OnInit {
  currentUser: User | null = null;
  showEditModal = false;
  editedUser: Partial<User> = {};

  profileMenuItems: ProfileMenuItem[] = [
    {
      title: 'Personal Information',
      icon: 'person-outline',
      action: 'edit'
    },
    {
      title: 'Medical History',
      icon: 'medical-outline',
      route: '/health-records'
    },
    {
      title: 'Emergency Contacts',
      icon: 'call-outline',
      action: 'emergency'
    },
    {
      title: 'Insurance Information',
      icon: 'card-outline',
      action: 'insurance'
    },
    {
      title: 'Settings',
      icon: 'settings-outline',
      action: 'settings'
    },
    {
      title: 'Privacy & Security',
      icon: 'lock-closed-outline',
      action: 'privacy'
    },
    {
      title: 'Help & Support',
      icon: 'help-circle-outline',
      action: 'help'
    },
    {
      title: 'About',
      icon: 'information-circle-outline',
      action: 'about'
    },
    {
      title: 'Logout',
      icon: 'log-out-outline',
      action: 'logout',
      color: 'danger'
    }
  ];

  emergencyContacts = [
    {
      name: 'John Doe',
      relationship: 'Spouse',
      phone: '+1 234-567-8900'
    },
    {
      name: 'Jane Smith',
      relationship: 'Sister',
      phone: '+1 234-567-8901'
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
        case 'emergency':
          this.showEmergencyContacts();
          break;
        case 'insurance':
          this.showInsuranceInfo();
          break;
        case 'settings':
          this.openSettings();
          break;
        case 'privacy':
          this.openPrivacySettings();
          break;
        case 'help':
          this.openHelp();
          break;
        case 'about':
          this.showAbout();
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

  async showEmergencyContacts() {
    const alert = await this.alertCtrl.create({
      header: 'Emergency Contacts',
      message: this.emergencyContacts.map(c =>
        `<strong>${c.name}</strong> (${c.relationship})<br>${c.phone}`
      ).join('<br><br>'),
      buttons: [
        {
          text: 'Edit',
          handler: () => {
            this.showToast('Edit emergency contacts coming soon');
          }
        },
        {
          text: 'Close',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }

  async showInsuranceInfo() {
    const alert = await this.alertCtrl.create({
      header: 'Insurance Information',
      message: `
        <strong>Provider:</strong> Blue Cross Blue Shield<br>
        <strong>Policy Number:</strong> BC123456789<br>
        <strong>Group Number:</strong> GRP001<br>
        <strong>Valid Until:</strong> 12/31/2024
      `,
      buttons: [
        {
          text: 'Update',
          handler: () => {
            this.showToast('Update insurance coming soon');
          }
        },
        {
          text: 'Close',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }

  openSettings() {
    this.navCtrl.navigateForward('/notification-settings');
  }

  openPrivacySettings() {
    this.showToast('Privacy settings coming soon');
  }

  openHelp() {
    this.showToast('Help & Support coming soon');
  }

  async showAbout() {
    const alert = await this.alertCtrl.create({
      header: 'About',
      message: `
        <strong>HealthCare App</strong><br>
        Version 1.0.0<br><br>
        Your health companion for managing appointments, medical records, and connecting with healthcare providers.
      `,
      buttons: ['OK']
    });
    await alert.present();
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
}