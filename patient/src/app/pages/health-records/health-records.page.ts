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
  NavController,
  ToastController
} from '@ionic/angular/standalone';

interface MedicalRecord {
  id: number;
  type: 'lab' | 'prescription' | 'report' | 'vaccination';
  title: string;
  doctor: string;
  date: string;
  status?: 'normal' | 'abnormal' | 'critical';
  icon: string;
  color: string;
}

interface Prescription {
  id: number;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  doctor: string;
  date: string;
  active: boolean;
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
    IonBadge
  ]
})
export class HealthRecordsPage implements OnInit {
  selectedSegment = 'medical-history';
  isLoading = false;

  medicalRecords: MedicalRecord[] = [
    {
      id: 1,
      type: 'lab',
      title: 'Complete Blood Count',
      doctor: 'Dr. John Smith',
      date: '2024-01-15',
      status: 'normal',
      icon: 'flask-outline',
      color: 'success'
    },
    {
      id: 2,
      type: 'report',
      title: 'Chest X-Ray',
      doctor: 'Dr. Sarah Johnson',
      date: '2024-01-10',
      status: 'normal',
      icon: 'body-outline',
      color: 'primary'
    },
    {
      id: 3,
      type: 'lab',
      title: 'Lipid Profile',
      doctor: 'Dr. John Smith',
      date: '2023-12-20',
      status: 'abnormal',
      icon: 'flask-outline',
      color: 'warning'
    },
    {
      id: 4,
      type: 'vaccination',
      title: 'COVID-19 Booster',
      doctor: 'Dr. Emily Davis',
      date: '2023-11-15',
      icon: 'medical-outline',
      color: 'tertiary'
    }
  ];

  prescriptions: Prescription[] = [
    {
      id: 1,
      medication: 'Metformin',
      dosage: '500mg',
      frequency: 'Twice daily',
      duration: '30 days',
      doctor: 'Dr. John Smith',
      date: '2024-01-15',
      active: true
    },
    {
      id: 2,
      medication: 'Lisinopril',
      dosage: '10mg',
      frequency: 'Once daily',
      duration: '90 days',
      doctor: 'Dr. John Smith',
      date: '2024-01-15',
      active: true
    },
    {
      id: 3,
      medication: 'Amoxicillin',
      dosage: '250mg',
      frequency: 'Three times daily',
      duration: '7 days',
      doctor: 'Dr. Sarah Johnson',
      date: '2023-12-01',
      active: false
    }
  ];

  testResults = [
    {
      category: 'Blood Tests',
      tests: [
        { name: 'Hemoglobin', value: '14.5', unit: 'g/dL', range: '13.5-17.5', status: 'normal' },
        { name: 'White Blood Cells', value: '7.2', unit: 'K/uL', range: '4.5-11', status: 'normal' },
        { name: 'Platelets', value: '250', unit: 'K/uL', range: '150-400', status: 'normal' }
      ]
    },
    {
      category: 'Lipid Profile',
      tests: [
        { name: 'Total Cholesterol', value: '210', unit: 'mg/dL', range: '<200', status: 'high' },
        { name: 'LDL Cholesterol', value: '140', unit: 'mg/dL', range: '<100', status: 'high' },
        { name: 'HDL Cholesterol', value: '45', unit: 'mg/dL', range: '>40', status: 'normal' },
        { name: 'Triglycerides', value: '160', unit: 'mg/dL', range: '<150', status: 'high' }
      ]
    }
  ];

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadHealthRecords();
  }

  segmentChanged(event: any) {
    this.selectedSegment = event.detail.value;
  }

  loadHealthRecords() {
    this.isLoading = true;
    setTimeout(() => {
      this.isLoading = false;
    }, 1000);
  }

  viewRecord(record: MedicalRecord) {
    this.showToast(`Viewing ${record.title}`);
  }

  downloadRecord(record: MedicalRecord, event: Event) {
    event.stopPropagation();
    this.showToast(`Downloading ${record.title}`);
  }

  shareRecord(record: MedicalRecord, event: Event) {
    event.stopPropagation();
    this.showToast(`Share options for ${record.title}`);
  }

  refillPrescription(prescription: Prescription) {
    this.showToast(`Refill request sent for ${prescription.medication}`);
  }

  uploadDocument() {
    this.showToast('Document upload feature coming soon');
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'normal': return 'success';
      case 'high': return 'warning';
      case 'abnormal': return 'warning';
      case 'critical': return 'danger';
      default: return 'medium';
    }
  }

  getRecordIcon(type: string): string {
    switch (type) {
      case 'lab': return 'flask-outline';
      case 'prescription': return 'medical-outline';
      case 'report': return 'document-text-outline';
      case 'vaccination': return 'medkit-outline';
      default: return 'document-outline';
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

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'primary'
    });
    toast.present();
  }
}