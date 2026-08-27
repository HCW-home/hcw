import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
} from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { ApiService } from '../../../core/services/api.service';

export interface PublicCustomField {
  field: number;
  field_name: string;
  field_type: string;
  value: string | null;
  options: any;
}

export interface PublicOrganisation {
  id: number;
  name: string;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  logo_color: string | null;
}

export interface PublicPractitioner {
  pk: number;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile_phone_number: string | null;
  picture: string | null;
  job_title: string | null;
  specialities: { id: number; name: string }[];
  main_organisation: PublicOrganisation | null;
  location: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  public_custom_fields: PublicCustomField[];
}

/**
 * The public details of a practitioner, loaded from its primary key.
 *
 * Meant to be projected into the expanded result card, which already shows the
 * identity and the agenda: this only adds what the card does not carry.
 */
@Component({
  selector: 'app-practitioner-details',
  templateUrl: './practitioner-details.component.html',
  styleUrls: ['./practitioner-details.component.scss'],
  standalone: true,
  imports: [
    IonIcon,
    IonSpinner,
    TranslatePipe,
  ],
})
export class PractitionerDetailsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) pk!: number;

  private destroy$ = new Subject<void>();
  // Cuts the request of the previous practitioner off when pk changes.
  private reload$ = new Subject<void>();

  practitioner = signal<PublicPractitioner | null>(null);
  isLoading = signal(true);
  notFound = signal(false);

  constructor(private apiService: ApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pk']) {
      this.load();
    }
  }

  ngOnDestroy(): void {
    this.reload$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private load(): void {
    this.reload$.next();
    this.practitioner.set(null);
    this.notFound.set(false);

    if (!this.pk) {
      this.isLoading.set(false);
      this.notFound.set(true);
      return;
    }

    this.isLoading.set(true);
    this.apiService.get<PublicPractitioner>(`/practitioners/${this.pk}/public/`)
      .pipe(takeUntil(this.reload$), takeUntil(this.destroy$))
      .subscribe({
        next: data => {
          this.practitioner.set(data);
          this.isLoading.set(false);
        },
        error: () => {
          this.notFound.set(true);
          this.isLoading.set(false);
        },
      });
  }

  formatAddress(p: PublicPractitioner): string {
    return [p.street, p.postal_code, p.city, p.country].filter(Boolean).join(', ');
  }

  hasPublicCustomFields(p: PublicPractitioner): boolean {
    return p.public_custom_fields.some(f => f.value);
  }
}
