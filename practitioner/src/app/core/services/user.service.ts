import {Injectable, inject} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable, BehaviorSubject, tap} from 'rxjs';
import {
  IUser,
  ILanguage,
  ISpeciality,
  IUserUpdateRequest,
} from '../../modules/user/models/user';
import {environment} from '../../../environments/environment';
import {PaginatedResponse} from '../models/global';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private apiUrl = environment.apiUrl;
  http = inject(HttpClient);

  private currentUserSubject = new BehaviorSubject<IUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  getCurrentUser(): Observable<IUser> {
    return this.http.get<IUser>(`${this.apiUrl}/auth/user/`).pipe(
      tap(user => this.currentUserSubject.next(user))
    );
  }

  updateCurrentUser(data: IUserUpdateRequest): Observable<IUser> {
    return this.http.patch<IUser>(`${this.apiUrl}/auth/user/`, data).pipe(
      tap(user => this.currentUserSubject.next(user))
    );
  }

  searchUsers(query: string, page?: number, pageSize?: number): Observable<PaginatedResponse<IUser>> {
    let params: any = {search: query};
    if (page) params.page = page;
    if (pageSize) params.page_size = pageSize;

    return this.http.get<any>(`${this.apiUrl}/user/`, {params});
  }

  getLanguages(): Observable<ILanguage[]> {
    return this.http.get<ILanguage[]>(`${this.apiUrl}/languages/`);
  }

  getSpecialities(): Observable<ISpeciality[]> {
    return this.http.get<ISpeciality[]>(`${this.apiUrl}/specialities/`, {});
  }

}
