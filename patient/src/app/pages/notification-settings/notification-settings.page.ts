import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonList,
  IonListHeader,
  IonItem,
  IonLabel,
  IonToggle,
  IonIcon,
  IonText,
  IonCard,
  IonCardContent,
  IonButton,
  IonDatetime,
  IonModal,
  IonSpinner,
  ToastController,
  AlertController
} from '@ionic/angular/standalone';
import { Storage } from '@ionic/storage-angular';
import { PushNotificationService } from '../../core/services/push-notification.service';

interface NotificationSetting {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  icon: string;
  category: 'appointments' | 'health' | 'messages' | 'promotions';
}

@Component({
  selector: 'app-notification-settings',
  templateUrl: './notification-settings.page.html',
  styleUrls: ['./notification-settings.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonToggle,
    IonIcon,
    IonText,
    IonCard,
    IonCardContent,
    IonButton,
    IonDatetime,
    IonModal,
    IonSpinner
  ],
  providers: [Storage]
})
export class NotificationSettingsPage implements OnInit {
  pushNotificationsEnabled = false;
  pushPermissionChecking = true;
  masterNotifications = true;
  quietHoursEnabled = false;
  quietHoursStart = '22:00';
  quietHoursEnd = '08:00';
  showTimePicker = false;
  timePickerMode: 'start' | 'end' = 'start';

  notificationSettings: NotificationSetting[] = [
    {
      id: 'appointment_reminder',
      title: 'Appointment Reminders',
      description: 'Get reminded about upcoming appointments',
      enabled: true,
      icon: 'calendar-outline',
      category: 'appointments'
    },
    {
      id: 'appointment_confirmation',
      title: 'Appointment Confirmations',
      description: 'Receive confirmation when appointments are booked',
      enabled: true,
      icon: 'checkmark-circle-outline',
      category: 'appointments'
    },
    {
      id: 'medication_reminder',
      title: 'Medication Reminders',
      description: 'Never miss your medication schedule',
      enabled: true,
      icon: 'medical-outline',
      category: 'health'
    },
    {
      id: 'test_results',
      title: 'Test Results',
      description: 'Get notified when test results are available',
      enabled: true,
      icon: 'flask-outline',
      category: 'health'
    },
    {
      id: 'doctor_messages',
      title: 'Doctor Messages',
      description: 'Receive messages from your healthcare providers',
      enabled: true,
      icon: 'chatbubble-outline',
      category: 'messages'
    },
    {
      id: 'health_tips',
      title: 'Health Tips',
      description: 'Receive helpful health and wellness tips',
      enabled: false,
      icon: 'bulb-outline',
      category: 'promotions'
    },
    {
      id: 'promotional',
      title: 'Promotional Offers',
      description: 'Special offers and discounts on health services',
      enabled: false,
      icon: 'pricetag-outline',
      category: 'promotions'
    }
  ];

  reminderOptions = [
    { value: 0, label: 'At time of appointment' },
    { value: 15, label: '15 minutes before' },
    { value: 30, label: '30 minutes before' },
    { value: 60, label: '1 hour before' },
    { value: 1440, label: '1 day before' }
  ];

  selectedReminderTime = 60;

  constructor(
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private storage: Storage,
    private pushService: PushNotificationService
  ) {}

  async ngOnInit() {
    await this.storage.create();
    await this.loadSettings();
    await this.checkPushPermission();
  }

  async checkPushPermission(): Promise<void> {
    this.pushPermissionChecking = true;
    this.pushNotificationsEnabled = await this.pushService.checkPermission();
    this.pushPermissionChecking = false;
  }

  async togglePushNotifications(): Promise<void> {
    if (!this.pushNotificationsEnabled) {
      const granted = await this.pushService.requestPermission();

      if (!granted) {
        const alert = await this.alertCtrl.create({
          header: 'Permission Required',
          message: 'Please enable notifications in your device settings to receive push notifications.',
          buttons: ['OK']
        });
        await alert.present();
        this.pushNotificationsEnabled = false;
      } else {
        this.pushNotificationsEnabled = true;
        this.showToast('Push notifications enabled');
      }
    } else {
      const alert = await this.alertCtrl.create({
        header: 'Disable Push Notifications',
        message: 'To disable push notifications, please go to your device settings.',
        buttons: ['OK']
      });
      await alert.present();
      this.pushNotificationsEnabled = true;
    }
  }

  async loadSettings(): Promise<void> {
    const settings = await this.storage.get('notificationSettings');
    if (settings) {
      this.notificationSettings = settings.notificationSettings || this.notificationSettings;
      this.masterNotifications = settings.masterNotifications ?? true;
      this.quietHoursEnabled = settings.quietHoursEnabled ?? false;
      this.quietHoursStart = settings.quietHoursStart || '22:00';
      this.quietHoursEnd = settings.quietHoursEnd || '08:00';
      this.selectedReminderTime = settings.selectedReminderTime || 60;
    }
  }

  async saveSettings(): Promise<void> {
    const settings = {
      notificationSettings: this.notificationSettings,
      masterNotifications: this.masterNotifications,
      quietHoursEnabled: this.quietHoursEnabled,
      quietHoursStart: this.quietHoursStart,
      quietHoursEnd: this.quietHoursEnd,
      selectedReminderTime: this.selectedReminderTime
    };

    await this.storage.set('notificationSettings', settings);
    this.showToast('Settings saved');
  }

  toggleMasterNotifications(): void {
    if (!this.masterNotifications) {
      this.notificationSettings.forEach(setting => {
        setting.enabled = false;
      });
    }
    this.saveSettings();
  }

  toggleNotification(setting: NotificationSetting): void {
    if (setting.enabled && !this.masterNotifications) {
      this.masterNotifications = true;
    }
    this.saveSettings();
  }

  toggleQuietHours(): void {
    this.saveSettings();
  }

  openTimePicker(mode: 'start' | 'end'): void {
    this.timePickerMode = mode;
    this.showTimePicker = true;
  }

  onTimeChange(event: CustomEvent): void {
    const time = new Date(event.detail.value);
    const formattedTime = time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    if (this.timePickerMode === 'start') {
      this.quietHoursStart = formattedTime;
    } else {
      this.quietHoursEnd = formattedTime;
    }

    this.showTimePicker = false;
    this.saveSettings();
  }

  getNotificationsByCategory(category: string): NotificationSetting[] {
    return this.notificationSettings.filter(s => s.category === category);
  }

  async testPushNotification(): Promise<void> {
    await this.pushService.showLocalNotification(
      'Test Notification',
      'This is a test notification from the app.'
    );
    this.showToast('Test notification sent');
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'success'
    });
    toast.present();
  }
}
