import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonSpinner, IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/services/api.service';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';

interface PublicCustomField {
  field: number;
  field_name: string;
  field_type: string;
  value: string | null;
  options: any;
}

interface Organisation {
  id: number;
  name: string;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  logo_color: string | null;
}

interface PublicPractitioner {
  pk: number;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile_phone_number: string | null;
  picture: string | null;
  job_title: string | null;
  specialities: { id: number; name: string }[];
  main_organisation: Organisation | null;
  location: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  public_custom_fields: PublicCustomField[];
}

@Component({
  selector: 'app-practitioner-profile',
  templateUrl: './practitioner-profile.page.html',
  styleUrls: ['./practitioner-profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonSpinner,
    IonIcon,
    AppHeaderComponent,
    TranslatePipe,
  ],
})
export class PractitionerProfilePage implements OnInit {
  practitioner = signal<PublicPractitioner | null>(null);
  isLoading = signal(true);
  notFound = signal(false);

  constructor(
    private route: ActivatedRoute,
    private apiService: ApiService,
  ) {}

  ngOnInit(): void {
    const pk = this.route.snapshot.paramMap.get('pk');
    if (!pk) {
      this.notFound.set(true);
      this.isLoading.set(false);
      return;
    }
    this.apiService.get<PublicPractitioner>(`/practitioners/${pk}/public/`).subscribe({
      next: (data) => {
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
    const parts = [p.street, p.postal_code, p.city, p.country].filter(Boolean);
    return parts.join(', ');
  }

  formatSpecialities(specialities: { id: number; name: string }[]): string {
    return specialities.map(s => s.name).join(', ');
  }

  hasPublicCustomFields(p: PublicPractitioner): boolean {
    return p.public_custom_fields.some(f => f.value);
  }
}