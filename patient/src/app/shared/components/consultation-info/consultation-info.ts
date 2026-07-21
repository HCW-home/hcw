import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

import { Consultation } from '../../../core/models/consultation.model';

/**
 * Collapsible "Discuter avec le praticien" section of a consultation card
 * (design 3a). The summary button toggles the inline chat, which is projected
 * from the parent via <ng-content> so the parent keeps full control of the
 * (functional) chat state.
 */
@Component({
  selector: 'app-consultation-info',
  templateUrl: './consultation-info.html',
  styleUrls: ['./consultation-info.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    TranslatePipe,
  ]
})
export class ConsultationInfoComponent {
  @Input({ required: true }) consultation!: Consultation;
  @Input() unreadCount = 0;
  @Input() expanded = false;
  @Output() toggle = new EventEmitter<Consultation>();

  get title(): string {
    return this.consultation.title || '';
  }

  get doctorName(): string {
    if (this.consultation.owned_by) {
      return `${this.consultation.owned_by.first_name} ${this.consultation.owned_by.last_name}`;
    }
    return '';
  }

  getFormattedId(): string {
    return `#${String(this.consultation.id).padStart(6, '0')}`;
  }

  onToggle(event: Event): void {
    event.stopPropagation();
    this.toggle.emit(this.consultation);
  }
}
