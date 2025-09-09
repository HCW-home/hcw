import {Component, OnInit} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {Sidebar} from '../../../../core/components/sidebar/sidebar';
import {Header} from '../../../../core/components/header/header';
import {Footer} from '../../../../core/components/footer/footer';

@Component({
  selector: 'app-user',
  imports: [RouterOutlet, Sidebar, Header, Footer],
  templateUrl: './user.html',
  styleUrl: './user.scss',
})
export class User implements OnInit {
  isCollapsed = false;

  ngOnInit() {
    const savedState = localStorage.getItem('sidebar-collapsed');
    if (savedState !== null) {
      this.isCollapsed = JSON.parse(savedState);
    }
  }

  onSidebarToggle(collapsed: boolean) {
    this.isCollapsed = collapsed;
  }
}
