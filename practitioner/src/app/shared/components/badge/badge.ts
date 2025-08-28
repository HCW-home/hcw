import { Component, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { BadgeType } from '../../models/badge';
import { BadgeTypeEnum } from '../../constants/badge';

@Component({
  selector: 'app-badge',
  imports: [NgClass],
  templateUrl: './badge.html',
  styleUrl: './badge.scss',
})
export class Badge {
  type = input<BadgeType>(BadgeTypeEnum.gray);
}
