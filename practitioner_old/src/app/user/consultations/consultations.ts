import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConsultationService, Consultation } from '../../core/services/consultation.service';
import { ConsultationOverviewDialogComponent } from './consultation-overview-dialog/consultation-overview-dialog';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatCardModule} from '@angular/material/card';
import {MatButtonModule} from '@angular/material/button';
import {MatTableModule} from '@angular/material/table';
import {MatChipsModule} from '@angular/material/chips';
import {MatIconModule} from '@angular/material/icon';

@Component({
  selector: 'app-consultations',
  templateUrl: './consultations.html',
  imports: [
    MatCardModule,
    MatChipsModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  styleUrl: './consultations.scss'
})
export class ConsultationsComponent implements OnInit {
  consultations: Consultation[] = [];
  loading = true;
  displayedColumns: string[] = ['id', 'created_at', 'beneficiary', 'status', 'group', 'actions'];

  constructor(
    private consultationService: ConsultationService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadConsultations();
  }

  loadConsultations(): void {
    this.loading = true;
    this.consultationService.getConsultations().subscribe({
      next: (consultations) => {
        this.consultations = consultations;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading consultations:', error);
        this.loading = false;
      }
    });
  }

  getStatusText(consultation: Consultation): string {
    return consultation.closed_at ? 'Closed' : 'Active';
  }

  getStatusClass(consultation: Consultation): string {
    return consultation.closed_at ? 'status-closed' : 'status-active';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }

  openConsultationOverlay(consultation: Consultation): void {
    const dialogRef = this.dialog.open(ConsultationOverviewDialogComponent, {
      data: { consultation },
      width: '500px',
      maxWidth: '90vw'
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('Dialog closed');
    });
  }

  joinConsultation(consultation: Consultation): void {
    console.log('Joining consultation:', consultation);
    this.consultationService.connectToConsultation(consultation.id);

    // TODO: Navigate to consultation room/video call interface
    // For now, just log the connection status
    this.consultationService.connectionStatus$.subscribe(status => {
      console.log('Connection status:', status);
    });
  }
}
