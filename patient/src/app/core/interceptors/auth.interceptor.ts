import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, from } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private authService: AuthService,
    private navCtrl: NavController
  ) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return from(this.authService.getToken()).pipe(
      switchMap(token => {
        if (token) {
          request = this.addToken(request, token);
        }
        return next.handle(request).pipe(
          catchError(error => {
            if (error instanceof HttpErrorResponse && error.status === 401) {
              if (error.error?.code === 'token_not_valid') {
                this.forceLogout();
              }
            }
            return throwError(() => error);
          })
        );
      })
    );
  }

  private addToken(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private forceLogout(): void {
    this.authService.logout().then(() => {
      this.navCtrl.navigateRoot('/login');
    });
  }
}
