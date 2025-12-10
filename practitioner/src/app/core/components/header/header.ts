import {Component, inject, signal, OnInit, OnDestroy} from '@angular/core';
import {Router, NavigationEnd} from '@angular/router';
import {RoutePaths} from '../../constants/routes';
import {LanguageSelector} from '../../../shared/components/language-selector/language-selector';
import {Typography} from '../../../shared/ui-components/typography/typography';
import {TypographyTypeEnum} from '../../../shared/constants/typography';
import {Svg} from '../../../shared/ui-components/svg/svg';
import {filter, Subscription} from 'rxjs';
import {NgClass} from '@angular/common';
import {UserService} from '../../services/user.service';
import {IUser} from '../../../modules/user/models/user';

@Component({
  selector: 'app-header',
  imports: [LanguageSelector, Typography, Svg, NgClass],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header implements OnInit, OnDestroy {
  private router = inject(Router);
  private userService = inject(UserService);
  private userSubscription!: Subscription;

  showProfileMenu = signal(false);
  showNewConsultationButton = signal(false);
  pageTitle = signal('Dashboard');
  pageSubtitle = signal('Welcome back');
  currentUser: IUser | null = null;

  ngOnInit() {
    this.userSubscription = this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.updatePageInfo();
    });
    this.updatePageInfo();
  }

  ngOnDestroy() {
    this.userSubscription?.unsubscribe();
  }

  private updatePageInfo() {
    const url = this.router.url;
    this.showNewConsultationButton.set(false);

    if (url.includes('/dashboard')) {
      this.pageTitle.set('Dashboard');
      this.pageSubtitle.set('Welcome back! Here\'s an overview of your consultations.');
      this.showNewConsultationButton.set(true);
    } else if (url.includes('/consultations/new')) {
      this.pageTitle.set('New Consultation');
      this.pageSubtitle.set('Create a new consultation');
    } else if (url.includes('/consultations/')) {
      this.pageTitle.set('Consultation Details');
      this.pageSubtitle.set('View and manage consultation');
    } else if (url.includes('/consultations')) {
      this.pageTitle.set('Consultations');
      this.pageSubtitle.set('Manage all your consultations');
      this.showNewConsultationButton.set(true);
    } else if (url.includes('/availability')) {
      this.pageTitle.set('Availability');
      this.pageSubtitle.set('Manage your schedule and booking slots');
    } else if (url.includes('/profile')) {
      this.pageTitle.set('Profile');
      this.pageSubtitle.set('Manage your account settings');
    } else if (url.includes('/test')) {
      this.pageTitle.set('System Test');
      this.pageSubtitle.set('Test your audio and video equipment');
    }
  }

  navigateToNewConsultation() {
    this.router.navigate([RoutePaths.USER, 'consultations', 'new']);
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
  }

  closeProfileMenu() {
    this.showProfileMenu.set(false);
  }

  openProfile() {
    this.closeProfileMenu();
    this.router.navigate([RoutePaths.USER, RoutePaths.PROFILE]);
  }

  onLogout() {
    this.closeProfileMenu();
    localStorage.clear();
    this.router.navigate([RoutePaths.AUTH]);
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
