import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonSearchbar,
  IonLabel,
  IonChip,
  IonIcon,
  IonGrid,
  IonRow,
  IonCol,
  IonSpinner,
  IonText,
  IonRefresher,
  IonRefresherContent,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  NavController,
} from '@ionic/angular/standalone';
import { DoctorService } from '../../core/services/doctor.service';
import { SpecialityService } from '../../core/services/speciality.service';
import { Doctor, Speciality } from '../../core/models/doctor.model';
import { DoctorCardComponent } from '../../shared/components/doctor-card/doctor-card.component';

@Component({
  selector: 'app-doctors',
  templateUrl: './doctors.page.html',
  styleUrls: ['./doctors.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonSearchbar,
    IonLabel,
    IonChip,
    IonIcon,
    IonGrid,
    IonRow,
    IonCol,
    IonSpinner,
    IonText,
    IonRefresher,
    IonRefresherContent,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    DoctorCardComponent
  ]
})
export class DoctorsPage implements OnInit {
  doctors: Doctor[] = [];
  filteredDoctors: Doctor[] = [];
  specialities: (Speciality & { icon?: string })[] = [];
  selectedSpeciality = 'All';
  selectedSpecialityId: number | null = null;
  searchTerm = '';
  isLoading = true;
  isLoadingSpecialities = true;
  currentPage = 1;
  totalPages = 1;

  private specialityIcons: Record<string, string> = {
    'cardiology': 'heart-outline',
    'dermatology': 'body-outline',
    'pediatrics': 'people-outline',
    'neurology': 'pulse-outline',
    'orthopedics': 'fitness-outline',
    'general': 'medical-outline',
    'default': 'medical-outline'
  };

  constructor(
    private navCtrl: NavController,
    private doctorService: DoctorService,
    private specialityService: SpecialityService,
  ) {}

  ngOnInit() {
    this.loadSpecialities();
    this.loadDoctors();
  }

  loadSpecialities(): void {
    this.isLoadingSpecialities = true;
    this.specialityService.getSpecialities().subscribe({
      next: (specialities) => {
        this.specialities = [
          { id: 0, name: 'All', icon: 'medical-outline' },
          ...specialities.map(s => ({
            ...s,
            icon: this.getIconForSpeciality(s.name)
          }))
        ];
        this.isLoadingSpecialities = false;
      },
      error: () => {
        this.specialities = [{ id: 0, name: 'All', icon: 'medical-outline' }];
        this.isLoadingSpecialities = false;
      }
    });
  }

  private getIconForSpeciality(name: string): string {
    const key = name.toLowerCase();
    return this.specialityIcons[key] || this.specialityIcons['default'];
  }

  async loadDoctors(event?: { target: { complete: () => void; disabled?: boolean } }): Promise<void> {
    if (!event) {
      this.isLoading = true;
    }

    const filters: Record<string, number | string | undefined> = {
      page: this.currentPage,
      limit: 20
    };

    if (this.selectedSpecialityId) {
      filters['speciality'] = this.selectedSpecialityId;
    }

    this.doctorService.getDoctors(filters).subscribe({
      next: (response) => {
        if (event?.target) {
          this.doctors = [...this.doctors, ...response.results];
        } else {
          this.doctors = response.results;
        }
        this.totalPages = Math.ceil(response.count / 20);
        this.applyFilters();
        this.isLoading = false;
        if (event?.target) {
          event.target.complete();
          if (this.currentPage >= this.totalPages) {
            event.target.disabled = true;
          }
        }
      },
      error: () => {
        this.isLoading = false;
        if (event?.target) {
          event.target.complete();
        }
      }
    });
  }

  handleRefresh(event: { target: { complete: () => void } }): void {
    this.currentPage = 1;
    this.doctors = [];
    this.loadDoctors(event);
  }

  loadMore(event: { target: { complete: () => void; disabled?: boolean } }): void {
    this.currentPage++;
    this.loadDoctors(event);
  }

  searchDoctors(event: CustomEvent): void {
    this.searchTerm = ((event.detail?.value as string) || '').toLowerCase();
    this.applyFilters();
  }

  filterBySpeciality(speciality: Speciality & { icon?: string }): void {
    this.selectedSpeciality = speciality.name;
    this.selectedSpecialityId = speciality.id === 0 ? null : speciality.id;

    this.currentPage = 1;
    this.doctors = [];
    this.loadDoctors();
  }

  applyFilters(): void {
    this.filteredDoctors = this.doctors.filter(doctor => {
      const matchesSearch = !this.searchTerm ||
        doctor.first_name.toLowerCase().includes(this.searchTerm) ||
        doctor.last_name.toLowerCase().includes(this.searchTerm) ||
        doctor.specialities?.some(s => s.name.toLowerCase().includes(this.searchTerm));

      return matchesSearch;
    });
  }

  viewDoctorDetails(doctor: Doctor): void {
    this.navCtrl.navigateForward(`/doctor/${doctor.id}`);
  }

  bookAppointment(doctor: Doctor): void {
    this.navCtrl.navigateForward(`/book-appointment?doctorId=${doctor.id}`);
  }
}
