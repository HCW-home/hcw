import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel,
  IonBadge
} from '@ionic/angular/standalone';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonTabs,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    IonBadge
  ]
})
export class TabsPage implements OnInit {
  notificationCount = 2;

  constructor() { }

  ngOnInit() {
    this.loadNotificationCount();
  }

  loadNotificationCount() {
    this.notificationCount = 2;
  }
}
