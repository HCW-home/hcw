import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Typography } from '../../ui-components/typography/typography';
import { LabelValue } from '../../ui-components/label-value/label-value';
import { Badge } from '../badge/badge';
import { TypographyTypeEnum } from '../../constants/typography';
import { BadgeTypeEnum } from '../../constants/badge';
import { BadgeType } from '../../models/badge';
import { Consultation } from '../../../core/models/consultation';

@Component({
  selector: 'app-consultation-row-item',
  imports: [DatePipe, Typography, LabelValue, Badge],
  templateUrl: './consultation-row-item.html',
  styleUrl: './consultation-row-item.scss',
})
export class ConsultationRowItem {
  consultation = input.required<Consultation>();
  showClosedDate = input<boolean>(false);
  statusBadgeType = input<BadgeType>(BadgeTypeEnum.green);
  statusLabel = input<string>('Active');

  rowClick = output<Consultation>();

  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  onClick(): void {
    this.rowClick.emit(this.consultation());
  }

  getBeneficiaryName(): string {
    const beneficiary = this.consultation().beneficiary;
    if (!beneficiary) return '-';
    return this.formatUserName(beneficiary) || '-';
  }

  getOwnerName(): string {
    const owner = this.consultation().owned_by;
    if (!owner) return '-';
    return this.formatUserName(owner) || '-';
  }

  getCreatedByName(): string {
    const creator = this.consultation().created_by;
    if (!creator) return '-';
    return this.formatUserName(creator) || '-';
  }

  private formatUserName(user: { first_name: string; last_name: string; email: string }): string {
    const fullName = `${user.first_name?.trim() || ''} ${user.last_name?.trim() || ''}`.trim();
    return fullName || user.email || '';
  }
}
