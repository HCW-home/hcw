import {
  HttpInterceptorFn,
  HttpRequest,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Auth } from '../services/auth';
import { TranslationService } from '../services/translation.service';
import { ToasterService } from '../services/toaster.service';
import { getErrorMessage } from '../utils/error-helper';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next
) => {
  const router = inject(Router);
  const auth = inject(Auth);
  const translationService = inject(TranslationService);
  const toasterService = inject(ToasterService);

  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const token = localStorage.getItem('token');
  const lang = translationService.currentLanguage();
  let authReq = req.clone({
    headers: req.headers.set('Accept-Language', lang),
  });

  if (token) {
    authReq = authReq.clone({
      headers: authReq.headers.set('Authorization', `Bearer ${token}`),
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && error.error?.code === 'token_not_valid') {
        auth.removeToken();
        router.navigate(['/auth/login']);
      } else if (error.status === 0) {
        toasterService.show(
          'error',
          'Network error',
          'Unable to reach the server. Please check your connection.'
        );
      } else if (error.status >= 400) {
        const message = getErrorMessage(error);
        toasterService.show('error', `Error ${error.status}`, message);
      }
      return throwError(() => error);
    })
  );
};
