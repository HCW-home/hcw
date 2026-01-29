import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Speciality } from '../models/doctor.model';
import { Reason } from '../models/consultation.model';

@Injectable({
  providedIn: 'root'
})
export class SpecialityService {
  constructor(private api: ApiService) {}

  getSpecialities(): Observable<Speciality[]> {
    return this.api.get<Speciality[]>('/specialities/');
  }

  getReasonsBySpeciality(specialityId: number): Observable<Reason[]> {
    return this.api.get<Reason[]>(`/specialities/${specialityId}/reasons/`);
  }
}
