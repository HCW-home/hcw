import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, PaginatedResponse } from './api.service';
import { User } from '../models/user.model';

export interface UserSearchParams {
  search?: string;
  page?: number;
  page_size?: number;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  constructor(private api: ApiService) {}

  searchUsers(params?: UserSearchParams): Observable<PaginatedResponse<User>> {
    return this.api.get<PaginatedResponse<User>>('/users/', params);
  }
}
