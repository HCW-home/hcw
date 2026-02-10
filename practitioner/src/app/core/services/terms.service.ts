import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ITerm, IUser } from '../../modules/user/models/user';

@Injectable({
  providedIn: 'root',
})
export class TermsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  getTerms(): Observable<ITerm[]> {
    return this.http.get<ITerm[]>(`${this.apiUrl}/terms/`);
  }

  getTerm(id: number): Observable<ITerm> {
    return this.http.get<ITerm>(`${this.apiUrl}/terms/${id}/`);
  }

  acceptTerm(termId: number): Observable<IUser> {
    return this.http.patch<IUser>(`${this.apiUrl}/auth/user/`, {
      accepted_term: termId,
    });
  }
}
