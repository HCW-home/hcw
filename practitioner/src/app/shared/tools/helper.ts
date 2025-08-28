import { HttpParams } from '@angular/common/http';

export function toHttpParams(obj: Record<string, any>): HttpParams {
  let params = new HttpParams();

  const appendParam = (key: string, value: any) => {
    const stringValue =
      value instanceof Date ? value.toISOString() : String(value);
    params = params.append(key, stringValue);
  };

  for (const [key, value] of Object.entries(obj)) {
    if (
      value == null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach(v => appendParam(`${key}[]`, v));
    } else {
      appendParam(key, value);
    }
  }

  return params;
}

export function toFormData<T extends object>(data: Partial<T>): FormData {
  const formData = new FormData();

  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined) return;

    if (key === 'files' && Array.isArray(value) && value[0] instanceof File) {
      value.forEach(file => formData.append(key, file));
    } else if (Array.isArray(value)) {
      value.forEach(v => {
        if (v !== null && v !== undefined) {
          formData.append(`${key}[]`, v as any);
        }
      });
    } else if (typeof value === 'boolean') {
      formData.append(key, value.toString());
    } else {
      formData.append(key, value as any);
    }
  });

  return formData;
}
