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
import { ApiService, PaginatedResponse } from '../../core/services/api.service';
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
  specialities: Speciality[] = [
    { id: 1, name: 'All', icon: 'medical-outline' },
    { id: 2, name: 'Cardiology', icon: 'heart-outline' },
    { id: 3, name: 'Dermatology', icon: 'body-outline' },
    { id: 4, name: 'Pediatrics', icon: 'people-outline' },
    { id: 5, name: 'Neurology', icon: 'pulse-outline' },
    { id: 6, name: 'Orthopedics', icon: 'fitness-outline' }
  ];
  selectedSpeciality = 'All';
  searchTerm = '';
  isLoading = true;
  currentPage = 1;
  totalPages = 1;

  constructor(
    private navCtrl: NavController,
    private apiService: ApiService,
  ) {}

  ngOnInit() {
    this.loadDoctors();
  }

  async loadDoctors(event?: any) {
    try {
      if (!event) {
        this.isLoading = true;
      }

      const response = await this.apiService.get<PaginatedResponse<Doctor>>('/practitioners/', {
        page: this.currentPage,
        limit: 20
      }).toPromise();

      if (response) {
        if (event?.target?.ionInfinite) {
          this.doctors = [...this.doctors, ...response.results];
        } else {
          this.doctors = response.results;
        }
        this.totalPages = Math.ceil(response.count / 20);
        this.applyFilters();
      }
    } catch (error) {
      console.error('Error loading doctors:', error);
      this.loadMockData();
    } finally {
      this.isLoading = false;
      if (event?.target) {
        event.target.complete();
        if (this.currentPage >= this.totalPages) {
          event.target.disabled = true;
        }
      }
    }
  }

  loadMockData() {
    this.doctors = [
      {
        id: 1,
        first_name: 'John',
        last_name: 'Smith',
        email: 'john.smith@clinic.com',
        specialities: [{ id: 2, name: 'Cardiology' }],
        is_online: true,
        rating: 4.8,
        reviews_count: 127,
        experience_years: 15,
        consultation_fee: 150,
        about: 'Experienced cardiologist with over 15 years of practice'
      },
      {
        id: 2,
        first_name: 'Sarah',
        last_name: 'Johnson',
        email: 'sarah.j@clinic.com',
        specialities: [{ id: 3, name: 'Dermatology' }],
        is_online: false,
        rating: 4.9,
        reviews_count: 89,
        experience_years: 12,
        consultation_fee: 120,
        about: 'Specialist in skin conditions and cosmetic dermatology'
      },
      {
        id: 3,
        first_name: 'Michael',
        last_name: 'Chen',
        email: 'mchen@clinic.com',
        specialities: [{ id: 4, name: 'Pediatrics' }],
        is_online: true,
        rating: 4.7,
        reviews_count: 156,
        experience_years: 10,
        consultation_fee: 100,
        about: 'Caring pediatrician focused on child wellness'
      },
      {
        id: 4,
        first_name: 'Emily',
        last_name: 'Davis',
        email: 'emily.davis@clinic.com',
        specialities: [{ id: 5, name: 'Neurology' }],
        is_online: false,
        rating: 4.9,
        reviews_count: 93,
        experience_years: 18,
        consultation_fee: 200,
        about: 'Expert in neurological disorders and brain health'
      }
    ] as Doctor[];
    this.filteredDoctors = [...this.doctors];
  }

  handleRefresh(event: any) {
    this.currentPage = 1;
    this.doctors = [];
    this.loadDoctors(event);
  }

  loadMore(event: any) {
    this.currentPage++;
    this.loadDoctors(event);
  }

  searchDoctors(event: any) {
    this.searchTerm = event.target.value.toLowerCase();
    this.applyFilters();
  }

  filterBySpeciality(speciality: string) {
    this.selectedSpeciality = speciality;
    this.applyFilters();
  }

  applyFilters() {
    this.filteredDoctors = this.doctors.filter(doctor => {
      const matchesSearch = !this.searchTerm ||
        doctor.first_name.toLowerCase().includes(this.searchTerm) ||
        doctor.last_name.toLowerCase().includes(this.searchTerm) ||
        doctor.specialities?.some(s => s.name.toLowerCase().includes(this.searchTerm));

      const matchesSpeciality = this.selectedSpeciality === 'All' ||
        doctor.specialities?.some(s => s.name === this.selectedSpeciality);

      return matchesSearch && matchesSpeciality;
    });
  }

  viewDoctorDetails(doctor: Doctor) {
    this.navCtrl.navigateForward(`/doctor/${doctor.id}`);
  }

  bookAppointment(doctor: Doctor) {
    this.navCtrl.navigateForward(`/book-appointment?doctorId=${doctor.id}`);
  }
}
