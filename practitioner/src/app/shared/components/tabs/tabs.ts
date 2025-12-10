import { Component, input, output } from '@angular/core';
import { NgClass } from '@angular/common';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

@Component({
  selector: 'app-tabs',
  imports: [NgClass],
  templateUrl: './tabs.html',
  styleUrl: './tabs.scss',
})
export class Tabs {
  tabs = input.required<TabItem[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();

  onTabClick(tabId: string) {
    this.tabChange.emit(tabId);
  }
}