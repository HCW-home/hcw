import { Component, inject, OnDestroy, OnInit, Output, EventEmitter } from '@angular/core';
import { Svg } from '../../../shared/ui-components/svg/svg';
import { MenuItems } from '../../constants/sidebar';
import { Typography } from '../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../shared/constants/typography';
import { Button } from '../../../shared/ui-components/button/button';
import {
  ButtonSizeEnum,
  ButtonStateEnum,
  ButtonStyleEnum,
} from '../../../shared/constants/button';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { RoutePaths } from '../../constants/routes';
import { IUser } from '../../../modules/user/models/user';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  imports: [Svg, Typography, Button, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar implements OnInit, OnDestroy {
  public router = inject(Router);

  menuItems = MenuItems;
  currentUserSubscription!: Subscription;
  currentUser!: IUser;
  isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

  ngOnInit() {
    const savedState = localStorage.getItem('sidebar-collapsed');
    if (savedState !== null) {
      this.isCollapsed = JSON.parse(savedState);
      this.collapsedChange.emit(this.isCollapsed);
    }
  }

  toggleSidebar() {
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem('sidebar-collapsed', JSON.stringify(this.isCollapsed));
    this.collapsedChange.emit(this.isCollapsed);
  }

  onLogOut() {
    localStorage.clear();
    this.router.navigate([`${RoutePaths.AUTH}`]);
  }

  ngOnDestroy() {
    this.currentUserSubscription?.unsubscribe();
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly RoutePaths = RoutePaths;
}
