import { Component } from '@angular/core';
import { Breadcrumb } from '../../../../shared/components/breadcrumb/breadcrumb';
import { Page } from '../../../../core/components/page/page';

@Component({
  selector: 'app-dashboard',
  imports: [Breadcrumb, Page],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  breadcrumbs = [{ label: 'Dashboard' }];
}
