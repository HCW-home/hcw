import { HttpErrorResponse } from '@angular/common/http';

export function getErrorMessage(error: HttpErrorResponse): string {
  if (error.error?.detail) {
    return error.error.detail;
  }

  if (error.error && typeof error.error === 'object') {
    const fieldErrors = Object.entries(error.error)
      .filter(([key]) => key !== 'detail' && key !== 'code')
      .map(([, msgs]) => (Array.isArray(msgs) ? msgs[0] : msgs))
      .filter(Boolean);
    if (fieldErrors.length) return fieldErrors.join(', ');
  }

  if (error.status === 0) return 'Network error';
  if (error.status === 404) return 'Not found';
  if (error.status === 500) return 'Server error';

  return 'An error occurred';
}
