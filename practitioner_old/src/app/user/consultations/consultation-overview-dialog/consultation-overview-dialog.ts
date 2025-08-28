import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConsultationService, Consultation } from '../../../core/services/consultation.service';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { Router } from '@angular/router';

@Component({
  selector: 'app-consultation-overview-dialog',
  templateUrl: './consultation-overview-dialog.html',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatDividerModule
  ],
  styleUrl: './consultation-overview-dialog.scss'
})
export class ConsultationOverviewDialogComponent {
  consultation: Consultation;

  constructor(
    public dialogRef: MatDialogRef<ConsultationOverviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { consultation: Consultation },
    private consultationService: ConsultationService,
    private router: Router
  ) {
    this.consultation = data.consultation;
  }

  getStatusText(): string {
    return this.consultation.closed_at ? 'Closed' : 'Active';
  }

  getStatusClass(): string {
    return this.consultation.closed_at ? 'status-closed' : 'status-active';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  joinConsultation(): void {
    console.log('Joining consultation:', this.consultation);
    
    // Close dialog and navigate to consultation room
    this.dialogRef.close();
    this.router.navigate(['/user/consultation', this.consultation.id]);
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}