import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ITerm, User } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class TermsService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getTerms(): Observable<ITerm[]> {
    return this.http.get<ITerm[]>(`${this.apiUrl}/terms/`);
  }

  getTerm(id: number): Observable<ITerm> {
    return this.http.get<ITerm>(`${this.apiUrl}/terms/${id}/`);
  }

  getPatientTerm(): Observable<ITerm | undefined> {
    return this.getTerms().pipe(
      map(terms => terms.find(t => t.use_for_patient))
    );
  }

  acceptTerm(termId: number): Observable<User> {
    return this.http.patch<User>(`${this.apiUrl}/auth/user/`, {
      accepted_term: termId,
    });
  }
}
