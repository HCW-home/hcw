import { Component } from '@angular/core';
import { Breadcrumb } from '../../../../shared/components/breadcrumb/breadcrumb';
import { Page } from '../../../../core/components/page/page';

@Component({
  selector: 'app-availability',
  imports: [Breadcrumb, Page],
  templateUrl: './availability.html',
  styleUrl: './availability.scss',
})
export class Availability {
  breadcrumbs = [{ label: 'Availability' }];
}
