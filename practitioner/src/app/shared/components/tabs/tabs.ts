import { Component, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { Typography } from '../../ui-components/typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

@Component({
  selector: 'app-tabs',
  imports: [NgClass, Typography],
  templateUrl: './tabs.html',
  styleUrl: './tabs.scss',
})
export class Tabs {
  tabs = input.required<TabItem[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();

  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  onTabClick(tabId: string) {
    this.tabChange.emit(tabId);
  }
}