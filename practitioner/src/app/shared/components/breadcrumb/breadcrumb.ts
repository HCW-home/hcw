import { Component, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IBreadcrumb } from '../../models/breadcrumb';
import { Typography } from '../../ui-components/typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-breadcrumb',
  imports: [NgClass, RouterLink, Typography],
  templateUrl: './breadcrumb.html',
  styleUrl: './breadcrumb.scss',
})
export class Breadcrumb {
  breadcrumbs = input<IBreadcrumb[]>([]);
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
