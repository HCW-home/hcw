import { Component, input, output } from '@angular/core';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { Typography } from '../../ui-components/typography/typography';
import { Svg } from '../../ui-components/svg/svg';
import { Badge } from '../badge/badge';
import { Button } from '../../ui-components/button/button';
import { IConsultation } from '../../../modules/user/models/consultation';
import { TypographyTypeEnum } from '../../constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';
import { BadgeType } from '../../models/badge';
import { BadgeTypeEnum } from '../../constants/badge';

@Component({
  selector: 'app-consultation-card',
  imports: [DatePipe, NgClass, TitleCasePipe, Typography, Svg, Badge, Button],
  templateUrl: './consultation-card.html',
  styleUrl: './consultation-card.scss',
})
export class ConsultationCard {
  consultation = input.required<IConsultation>();
  type = input<'active' | 'past'>('active');

  viewDetails = output<IConsultation>();
  scheduleFollowUp = output<IConsultation>();

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  getStatusBadgeType(status: string): BadgeType {
    switch (status) {
      case 'scheduled':
        return BadgeTypeEnum.orange;
      case 'active':
        return BadgeTypeEnum.green;
      case 'completed':
        return BadgeTypeEnum.blue;
      case 'cancelled':
        return BadgeTypeEnum.red;
      default:
        return BadgeTypeEnum.gray;
    }
  }

  getConsultationTypeIcon(type: string): string {
    switch (type) {
      case 'video':
        return 'camera';
      case 'audio':
        return 'phone';
      case 'chat':
        return 'message';
      default:
        return 'consultation';
    }
  }

  onViewDetails() {
    this.viewDetails.emit(this.consultation());
  }

  onScheduleFollowUp() {
    this.scheduleFollowUp.emit(this.consultation());
  }
}
