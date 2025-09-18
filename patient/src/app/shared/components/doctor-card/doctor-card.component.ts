import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonCard,
  IonCardContent,
  IonAvatar,
  IonText,
  IonIcon,
  IonButton
} from '@ionic/angular/standalone';
import { Doctor } from '../../../core/models/doctor.model';

@Component({
  selector: 'app-doctor-card',
  templateUrl: './doctor-card.component.html',
  styleUrls: ['./doctor-card.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonCard,
    IonCardContent,
    IonAvatar,
    IonText,
    IonIcon,
    IonButton
  ]
})
export class DoctorCardComponent {
  @Input() doctor!: Doctor;
  @Input() showBookButton: boolean = true;
  @Output() doctorClick = new EventEmitter<Doctor>();
  @Output() bookClick = new EventEmitter<Doctor>();

  onDoctorClick() {
    this.doctorClick.emit(this.doctor);
  }

  onBookClick(event: Event) {
    event.stopPropagation();
    this.bookClick.emit(this.doctor);
  }

  getSpecialties(): string {
    return this.doctor.specialities?.map(s => s.name).join(', ') || 'General Practitioner';
  }
}