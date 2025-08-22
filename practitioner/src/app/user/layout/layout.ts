import { Component, OnInit } from '@angular/core';
import {Router, RouterOutlet} from '@angular/router';
import { AuthService, User } from '../../core/services/auth.service';
import { Observable } from 'rxjs';
import {MatSidenav, MatSidenavContainer, MatSidenavContent} from '@angular/material/sidenav';
import {MatList, MatListItem, MatNavList} from '@angular/material/list';
import {MatToolbar} from '@angular/material/toolbar';
import {MatMenu, MatMenuItem, MatMenuTrigger} from '@angular/material/menu';
import {MatButton} from '@angular/material/button';
import {AsyncPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';


@Component({
  selector: 'app-layout',
  templateUrl: './layout.html',
  imports: [
    RouterOutlet,
    MatSidenavContainer,
    MatSidenav,
    MatNavList,
    MatListItem,
    MatIconModule,
    MatList,
    MatSidenavContent,
    MatToolbar,
    MatMenuTrigger,
    MatMenu,
    MatButton,
    MatMenuItem,
    AsyncPipe,
    MatInputModule
  ],
  styleUrl: './layout.scss'
})
export class LayoutComponent implements OnInit {
  currentUser$: Observable<User | null>;
  sidenavOpened = true;

  menuItems = [
    { icon: 'medical_services', label: 'Consultations', route: '/user/consultations' },
  ];

  constructor(
    private authService: AuthService,
    public router: Router
  ) {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {}

  toggleSidenav(): void {
    this.sidenavOpened = !this.sidenavOpened;
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.router.navigate(['/auth']);
      },
      error: (error) => {
        console.error('Logout error:', error);
        // Even if logout fails, redirect to auth
        this.router.navigate(['/auth']);
      }
    });
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }
}
