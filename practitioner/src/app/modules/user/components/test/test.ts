import { Component } from '@angular/core';
import { Breadcrumb } from '../../../../shared/components/breadcrumb/breadcrumb';
import { Page } from '../../../../core/components/page/page';

@Component({
  selector: 'app-test',
  imports: [Breadcrumb, Page],
  templateUrl: './test.html',
  styleUrl: './test.scss',
})
export class Test {
  breadcrumbs = [{ label: 'Test' }];
}
