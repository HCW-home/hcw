import { Component, inject, OnDestroy, OnInit, Output, EventEmitter } from '@angular/core';
import { Svg } from '../../../shared/ui-components/svg/svg';
import { MenuItems } from '../../constants/sidebar';
import { Typography } from '../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../shared/constants/typography';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { RoutePaths } from '../../constants/routes';
import { IUser } from '../../../modules/user/models/user';
import { Subscription } from 'rxjs';
import { UserService } from '../../services/user.service';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-sidebar',
  imports: [Svg, Typography, RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar implements OnInit, OnDestroy {
  public router = inject(Router);
  private userService = inject(UserService);

  menuItems = MenuItems;
  currentUserSubscription!: Subscription;
  currentUser: IUser | null = null;
  isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

  ngOnInit(): void {
    const savedState = localStorage.getItem('sidebar-collapsed');
    if (savedState !== null) {
      this.isCollapsed = JSON.parse(savedState);
      this.collapsedChange.emit(this.isCollapsed);
    }

    this.currentUserSubscription = this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
  }

  toggleSidebar(): void {
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem('sidebar-collapsed', JSON.stringify(this.isCollapsed));
    this.collapsedChange.emit(this.isCollapsed);
  }

  onLogOut(): void {
    localStorage.clear();
    this.router.navigate([`${RoutePaths.AUTH}`]);
  }

  getUserDisplayName(): string {
    if (!this.currentUser) return '';
    const fullName = `${this.currentUser.first_name} ${this.currentUser.last_name}`.trim();
    return fullName || this.currentUser.email;
  }

  ngOnDestroy(): void {
    this.currentUserSubscription?.unsubscribe();
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly RoutePaths = RoutePaths;
}
