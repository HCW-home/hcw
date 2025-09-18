import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonText,
  IonLabel,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonList,
  IonItemSliding,
  IonItem,
  IonIcon,
  IonItemOptions,
  IonItemOption,
  NavController
} from '@ionic/angular/standalone';

interface Notification {
  id: number;
  title: string;
  message: string;
  icon: string;
  color: string;
  time: string;
  isRead: boolean;
  type: 'appointment' | 'message' | 'health' | 'system';
}

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonText,
    IonLabel,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonList,
    IonItemSliding,
    IonItem,
    IonIcon,
    IonItemOptions,
    IonItemOption
  ]
})
export class NotificationsPage implements OnInit {
  notifications: Notification[] = [
    {
      id: 1,
      title: 'Appointment Reminder',
      message: 'Your appointment with Dr. Smith is scheduled for tomorrow at 10:00 AM',
      icon: 'calendar',
      color: 'primary',
      time: '2 hours ago',
      isRead: false,
      type: 'appointment'
    },
    {
      id: 2,
      title: 'Test Results Available',
      message: 'Your recent blood test results have been reviewed by your doctor',
      icon: 'document-text',
      color: 'success',
      time: '5 hours ago',
      isRead: false,
      type: 'health'
    },
    {
      id: 3,
      title: 'New Message',
      message: 'Dr. Johnson has sent you a message regarding your treatment plan',
      icon: 'mail',
      color: 'secondary',
      time: '1 day ago',
      isRead: true,
      type: 'message'
    },
    {
      id: 4,
      title: 'Prescription Ready',
      message: 'Your prescription is ready for pickup at the pharmacy',
      icon: 'medkit',
      color: 'tertiary',
      time: '2 days ago',
      isRead: true,
      type: 'health'
    },
    {
      id: 5,
      title: 'Health Tip',
      message: 'Remember to take your medication as prescribed',
      icon: 'information-circle',
      color: 'warning',
      time: '3 days ago',
      isRead: true,
      type: 'system'
    }
  ];

  constructor(private navCtrl: NavController) { }

  ngOnInit() {
    this.loadNotifications();
  }

  ionViewWillEnter() {
  }

  loadNotifications() {
  }

  openNotificationSettings() {
    this.navCtrl.navigateForward('/notification-settings');
  }

  markAllAsRead() {
    setTimeout(() => {
      this.notifications.forEach(n => n.isRead = true);
    }, 2000);
  }

  deleteNotification(notification: Notification) {
    const index = this.notifications.indexOf(notification);
    if (index > -1) {
      this.notifications.splice(index, 1);
    }
  }

  refreshNotifications(event: any) {
    setTimeout(() => {
      this.loadNotifications();
      event.target.complete();
    }, 1000);
  }
}
