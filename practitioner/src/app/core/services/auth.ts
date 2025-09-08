import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SuccessResponse } from '../models/succesResponse';
import { environment } from '../../../environments/environment';
import {
  IBodyLogin,
  IResponseLogin,
  IBodySetPassword,
  IBodyForgotPassword,
} from '../models/admin-auth';

@Injectable({
  providedIn: 'root'
})
export class Auth {
  httpClient: HttpClient = inject(HttpClient);

  isLoggedIn() {
    return !!localStorage.getItem("token");
  }

  login(body: IBodyLogin) {
    return this.httpClient.post<IResponseLogin>(`${environment.apiUrl}/auth/login/`, body);
  }

  forgotPassword(body: IBodyForgotPassword) {
    return this.httpClient.post<SuccessResponse>(`${environment.apiUrl}/auth/password/reset/`, body);
  }

  setPassword(params: IBodySetPassword) {
    return this.httpClient.post<SuccessResponse>(`${environment.apiUrl}/password/recover/confirm`, params);
  }
}
