import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { IUser } from '../../modules/user/models/user';

import { BehaviorSubject, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AdminService {
  currentUserSubject = new BehaviorSubject<IUser | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {}

  // getAdmins(params: IParamsGetAdmins) {
  //   const httpParams = toHttpParams(params);
  //   return this.http.get<PaginatedResponse<IAdminUser>>(
  //     `${environment.apiUrl}/list`,
  //     { params: httpParams }
  //   );
  // }
  //
  // addAdmin(body: IBodyAddEditAdmin) {
  //   return this.http.post<IAdminUser>(`${environment.apiUrl}`, body);
  // }
  //
  // editAdmin(id: number, body: IBodyAddEditAdmin) {
  //   return this.http.put<IAdminUser>(`${environment.apiUrl}/${id}`, body);
  // }
  //
  // getAdmin(id: number) {
  //   return this.http.get<IAdminUser>(`${environment.apiUrl}/${id}`, {});
  // }
  //
  getCurrentUser() {
    return this.http
      .get<IUser>(`${environment.apiUrl}/auth/user/`, {})
      .pipe(tap(user => this.currentUserSubject.next(user)));
  }
  //
  // deleteAdmin(id: number) {
  //   return this.http.delete<IAdminUser>(`${environment.apiUrl}/${id}`, {});
  // }
  //
  // changeAdminStatus(id: number, body: IBodyUpdateAdminStatus) {
  //   return this.http.put<IAdminUser>(
  //     `${environment.apiUrl}/${id}/deactivate`,
  //     body
  //   );
  // }
  //
  // resendInvite(id: number) {
  //   return this.http.get<IAdminUser>(
  //     `${environment.apiUrl}/resend/invite/${id}`
  //   );
  // }
}
