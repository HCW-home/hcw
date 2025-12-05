import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../../../../core/components/sidebar/sidebar';
import { Header } from '../../../../core/components/header/header';
import { Footer } from '../../../../core/components/footer/footer';
import { UserService } from '../../../../core/services/user.service';

@Component({
  selector: 'app-user',
  imports: [RouterOutlet, Sidebar, Header, Footer],
  templateUrl: './user.html',
  styleUrl: './user.scss',
})
export class User implements OnInit {
  private userService = inject(UserService);
  isCollapsed = false;

  ngOnInit(): void {
    const savedState = localStorage.getItem('sidebar-collapsed');
    if (savedState !== null) {
      this.isCollapsed = JSON.parse(savedState);
    }

    this.userService.getCurrentUser().subscribe();
  }

  onSidebarToggle(collapsed: boolean): void {
    this.isCollapsed = collapsed;
  }
}
