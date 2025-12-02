import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next) => {
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const token = localStorage.getItem('token');

  if (token) {
    const authReq = req.clone({
      headers: req.headers.set('Authorization', `Bearer ${token}`)
    });

    return next(authReq);
  }

  return next(req);
};
