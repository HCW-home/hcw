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
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonList,
  IonItem,
  IonIcon,
  IonText,
  IonButton,
  IonFab,
  IonFabButton,
  IonSpinner,
  IonBadge,
  IonRefresher,
  IonRefresherContent,
  NavController,
  ToastController,
  AlertController
} from '@ionic/angular/standalone';
import { HealthService, HealthMetric } from '../../core/services/health.service';
import { ConsultationService } from '../../core/services/consultation.service';
import { Prescription } from '../../core/models/consultation.model';

interface GroupedMetrics {
  category: string;
  metrics: {
    name: string;
    value: string;
    unit: string;
    date: string;
    status: 'normal' | 'high' | 'low';
  }[];
}

@Component({
  selector: 'app-health-records',
  templateUrl: './health-records.page.html',
  styleUrls: ['./health-records.page.scss'],
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
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonList,
    IonItem,
    IonIcon,
    IonText,
    IonButton,
    IonFab,
    IonFabButton,
    IonSpinner,
    IonBadge,
    IonRefresher,
    IonRefresherContent
  ]
})
export class HealthRecordsPage implements OnInit {
  selectedSegment = 'metrics';
  isLoading = false;
  isLoadingPrescriptions = false;

  healthMetrics: HealthMetric[] = [];
  groupedMetrics: GroupedMetrics[] = [];
  prescriptions: Prescription[] = [];

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private healthService: HealthService,
    private consultationService: ConsultationService
  ) {}

  ngOnInit() {
    this.loadHealthMetrics();
  }

  segmentChanged(event: CustomEvent): void {
    this.selectedSegment = event.detail.value;
    if (this.selectedSegment === 'prescriptions' && this.prescriptions.length === 0) {
      this.loadPrescriptions();
    }
  }

  loadHealthMetrics(event?: { target: { complete: () => void } }): void {
    this.isLoading = !event;
    this.healthService.getHealthMetrics().subscribe({
      next: (response) => {
        this.healthMetrics = response.results;
        this.groupMetrics();
        this.isLoading = false;
        event?.target.complete();
      },
      error: () => {
        this.healthMetrics = [];
        this.groupedMetrics = [];
        this.isLoading = false;
        event?.target.complete();
      }
    });
  }

  private groupMetrics(): void {
    const groups: Map<string, GroupedMetrics['metrics']> = new Map();

    this.healthMetrics.forEach(metric => {
      const category = this.getCategoryForMetric(metric.metric_type);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)?.push({
        name: this.formatMetricName(metric.metric_type),
        value: metric.value,
        unit: metric.unit || '',
        date: metric.measured_at,
        status: this.getMetricStatus(metric)
      });
    });

    this.groupedMetrics = Array.from(groups.entries()).map(([category, metrics]) => ({
      category,
      metrics
    }));
  }

  private getCategoryForMetric(type: string): string {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('blood') || lowerType.includes('hemoglobin') || lowerType.includes('platelet')) {
      return 'Blood Tests';
    }
    if (lowerType.includes('cholesterol') || lowerType.includes('lipid') || lowerType.includes('triglyceride')) {
      return 'Lipid Profile';
    }
    if (lowerType.includes('glucose') || lowerType.includes('sugar') || lowerType.includes('hba1c')) {
      return 'Blood Sugar';
    }
    if (lowerType.includes('pressure') || lowerType.includes('heart') || lowerType.includes('pulse')) {
      return 'Vitals';
    }
    return 'Other';
  }

  private formatMetricName(type: string): string {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  private getMetricStatus(metric: HealthMetric): 'normal' | 'high' | 'low' {
    return 'normal';
  }

  loadPrescriptions(): void {
    this.isLoadingPrescriptions = true;
    this.consultationService.getMyConsultations().subscribe({
      next: (response) => {
        this.prescriptions = [];
        response.results.forEach(consultation => {
          if (consultation.prescriptions) {
            this.prescriptions.push(...consultation.prescriptions);
          }
        });
        this.isLoadingPrescriptions = false;
      },
      error: () => {
        this.prescriptions = [];
        this.isLoadingPrescriptions = false;
      }
    });
  }

  async addHealthMetric(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Add Health Metric',
      inputs: [
        {
          name: 'metric_type',
          type: 'text',
          placeholder: 'Metric Type (e.g., Blood Pressure)'
        },
        {
          name: 'value',
          type: 'text',
          placeholder: 'Value (e.g., 120/80)'
        },
        {
          name: 'unit',
          type: 'text',
          placeholder: 'Unit (e.g., mmHg)'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: (data) => {
            if (data.metric_type && data.value) {
              this.saveHealthMetric(data);
            }
          }
        }
      ]
    });

    await alert.present();
  }

  private saveHealthMetric(data: { metric_type: string; value: string; unit?: string }): void {
    this.healthService.createHealthMetric({
      metric_type: data.metric_type,
      value: data.value,
      unit: data.unit
    }).subscribe({
      next: () => {
        this.showToast('Health metric saved successfully');
        this.loadHealthMetrics();
      },
      error: () => {
        this.showToast('Failed to save health metric');
      }
    });
  }

  async deleteMetric(metric: HealthMetric): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete Metric',
      message: 'Are you sure you want to delete this metric?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: () => {
            this.healthService.deleteHealthMetric(metric.id).subscribe({
              next: () => {
                this.showToast('Metric deleted');
                this.loadHealthMetrics();
              },
              error: () => {
                this.showToast('Failed to delete metric');
              }
            });
          }
        }
      ]
    });

    await alert.present();
  }

  refillPrescription(prescription: Prescription): void {
    this.showToast(`Refill request sent for ${prescription.medication_name}`);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'normal': return 'success';
      case 'high': return 'warning';
      case 'low': return 'warning';
      default: return 'medium';
    }
  }

  getPrescriptionStatusColor(status: string): string {
    switch (status) {
      case 'PRESCRIBED': return 'primary';
      case 'DISPENSED': return 'success';
      case 'CANCELLED': return 'danger';
      default: return 'medium';
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  handleRefresh(event: { target: { complete: () => void } }): void {
    if (this.selectedSegment === 'metrics') {
      this.loadHealthMetrics(event);
    } else {
      this.loadPrescriptions();
      event.target.complete();
    }
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'primary'
    });
    toast.present();
  }
}
