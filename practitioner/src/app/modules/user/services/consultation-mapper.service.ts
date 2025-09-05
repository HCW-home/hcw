import { Injectable } from '@angular/core';
import { Consultation } from '../../../core/models/consultation';
import { IConsultation } from '../models/consultation';

@Injectable({
  providedIn: 'root'
})
export class ConsultationMapperService {

  mapToUIConsultation(apiConsultation: Consultation): IConsultation {
    // Determine status based on consultation state
    const status = this.determineStatus(apiConsultation);
    
    // Build patient name from beneficiary data
    const patientName = this.buildPatientName(apiConsultation);
    
    // Map to UI consultation model
    return {
      id: apiConsultation.id.toString(),
      patient_name: patientName,
      consultation_type: 'video', // Default type, could be enhanced later
      date: new Date(apiConsultation.created_at),
      duration: 30, // Default duration, could be enhanced from appointments
      status: status,
      follow_up_required: false, // Default, could be enhanced with business logic
      patient_age: undefined, // Not available in current API model
      symptoms: [], // Not available in current API model
      notes: apiConsultation.description || undefined,
      patient_email: apiConsultation.beneficiary?.email || undefined,
      patient_phone: undefined, // Not available in current API model
      prescription: undefined, // Not available in current API model
    };
  }

  mapToUIConsultations(apiConsultations: Consultation[]): IConsultation[] {
    return apiConsultations.map(consultation => this.mapToUIConsultation(consultation));
  }

  private determineStatus(consultation: Consultation): 'scheduled' | 'active' | 'completed' | 'cancelled' {
    if (consultation.closed_at) {
      return 'completed';
    }
    
    // For now, consider all open consultations as scheduled
    // This could be enhanced with appointment data or other business logic
    return 'scheduled';
  }

  private buildPatientName(consultation: Consultation): string {
    if (consultation.beneficiary) {
      const firstName = consultation.beneficiary.first_name?.trim() || '';
      const lastName = consultation.beneficiary.last_name?.trim() || '';
      
      // Filter out test data like "string"
      const validFirstName = (firstName && firstName !== 'string') ? firstName : '';
      const validLastName = (lastName && lastName !== 'string') ? lastName : '';
      
      const fullName = `${validFirstName} ${validLastName}`.trim();
      return fullName || consultation.beneficiary.email || 'Unknown Patient';
    }
    return 'Unknown Patient';
  }
}