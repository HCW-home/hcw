import {Component, inject, signal, OnInit, OnDestroy} from '@angular/core';
import {Router, NavigationEnd, RouterLink, RouterLinkActive} from '@angular/router';
import {Location} from '@angular/common';
import {RoutePaths} from '../../constants/routes';
import {MenuItems} from '../../constants/sidebar';
import {LanguageSelector} from '../../../shared/components/language-selector/language-selector';
import {Typography} from '../../../shared/ui-components/typography/typography';
import {TypographyTypeEnum} from '../../../shared/constants/typography';
import {Svg} from '../../../shared/ui-components/svg/svg';
import {filter, Subscription} from 'rxjs';
import {NgClass} from '@angular/common';
import {UserService} from '../../services/user.service';
import {NotificationService} from '../../services/notification.service';
import {IUser} from '../../../modules/user/models/user';
import {INotification, NotificationStatus} from '../../models/notification';
import { Button } from '../../../shared/ui-components/button/button';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../shared/constants/button';

@Component({
  selector: 'app-header',
  imports: [LanguageSelector, Typography, Svg, NgClass, Button, RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header implements OnInit, OnDestroy {
  protected router = inject(Router);
  private location = inject(Location);
  private userService = inject(UserService);
  protected notificationService = inject(NotificationService);
  private userSubscription!: Subscription;

  showProfileMenu = signal(false);
  showNotifications = signal(false);
  showMobileMenu = signal(false);
  showNewConsultationButton = signal(false);
  showBackButton = signal(false);
  pageTitle = signal('Dashboard');
  pageSubtitle = signal('Welcome back');
  currentUser: IUser | null = null;
  menuItems = MenuItems;
  protected readonly RoutePaths = RoutePaths;

  protected readonly NotificationStatus = NotificationStatus;

  ngOnInit() {
    this.userSubscription = this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.updatePageInfo();
      });
    this.updatePageInfo();
    this.notificationService.loadNotifications();
  }

  ngOnDestroy() {
    this.userSubscription?.unsubscribe();
  }

  private updatePageInfo() {
    const url = this.router.url;
    this.showNewConsultationButton.set(false);
    this.showBackButton.set(false);

    if (url.includes('/dashboard')) {
      this.pageTitle.set('Dashboard');
      this.pageSubtitle.set(
        `Welcome back, ${this.getUserDisplayName() || 'Doctor'}`
      );
      this.showNewConsultationButton.set(true);
    } else if (url.includes('/consultations/new')) {
      this.pageTitle.set('New Consultation');
      this.pageSubtitle.set('Create a new consultation with a patient');
      this.showBackButton.set(true);
    } else if (url.includes('/consultations/')) {
      this.pageTitle.set('Consultation Details');
      this.pageSubtitle.set('View and manage consultation');
      this.showBackButton.set(true);
    } else if (url.includes('/consultations')) {
      this.pageTitle.set('Consultations');
      this.pageSubtitle.set('Manage and review all your consultations');
      this.showNewConsultationButton.set(true);
    } else if (url.includes('/patients')) {
      this.pageTitle.set('Patients');
      this.pageSubtitle.set('View and manage your patients');
    } else if (url.includes('/appointments')) {
      this.pageTitle.set('Appointments');
      this.pageSubtitle.set('Schedule and manage appointments');
    } else if (url.includes('/configuration')) {
      this.pageTitle.set('Configuration');
      this.pageSubtitle.set('Manage your system settings and availability');
    } else if (url.includes('/availability')) {
      this.pageTitle.set('Availability');
      this.pageSubtitle.set('Manage your schedule and booking slots');
    } else if (url.includes('/profile')) {
      this.pageTitle.set('Profile');
      this.pageSubtitle.set('Manage your account settings');
      this.showBackButton.set(true);
    } else if (url.includes('/test')) {
      this.pageTitle.set('System Test');
      this.pageSubtitle.set('Test your audio and video equipment');
    }
  }

  navigateToNewConsultation() {
    this.closeMobileMenu();
    this.router.navigate([RoutePaths.USER, 'consultations', 'new']);
  }

  goBack() {
    this.location.back();
  }

  getUserDisplayName(): string {
    if (!this.currentUser) return '';
    if (this.currentUser.first_name || this.currentUser.last_name) {
      return `${this.currentUser.first_name || ''} ${this.currentUser.last_name || ''}`.trim();
    }
    return this.currentUser.email?.split('@')[0] || '';
  }

  getUserInitials(): string {
    if (!this.currentUser) return '';
    if (this.currentUser.first_name && this.currentUser.last_name) {
      return `${this.currentUser.first_name[0]}${this.currentUser.last_name[0]}`.toUpperCase();
    }
    return this.currentUser.email?.substring(0, 2).toUpperCase() || '';
  }

  toggleProfileMenu() {
    this.showProfileMenu.update(v => !v);
    if (this.showProfileMenu()) {
      this.showMobileMenu.set(false);
    }
  }

  closeProfileMenu() {
    this.showProfileMenu.set(false);
  }

  toggleMobileMenu() {
    this.showMobileMenu.update(v => !v);
    if (this.showMobileMenu()) {
      this.showProfileMenu.set(false);
      this.showNotifications.set(false);
    }
  }

  closeMobileMenu() {
    this.showMobileMenu.set(false);
  }

  openProfile() {
    this.closeProfileMenu();
    this.closeMobileMenu();
    this.router.navigate([RoutePaths.USER, RoutePaths.PROFILE]);
  }

  onLogout() {
    this.closeProfileMenu();
    this.closeMobileMenu();
    localStorage.clear();
    this.router.navigate([RoutePaths.AUTH]);
  }

  toggleNotifications() {
    this.showNotifications.update(v => !v);
    if (this.showNotifications()) {
      this.showProfileMenu.set(false);
    }
  }

  closeNotifications() {
    this.showNotifications.set(false);
  }

  markAllNotificationsRead() {
    this.notificationService.markAllAsRead();
  }

  onNotificationClick(notification: INotification) {
    if (notification.status !== NotificationStatus.READ) {
      this.notificationService.markAsRead(notification.id).subscribe();
    }
    this.closeNotifications();
  }

  isNotificationUnread(notification: INotification): boolean {
    return (
      notification.status !== NotificationStatus.READ &&
      notification.read_at === null
    );
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
}
