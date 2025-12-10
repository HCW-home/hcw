import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, PaginatedResponse } from './api.service';

export interface HealthMetric {
  id: number;
  user: number;
  created_by: number;
  metric_type: string;
  value: string;
  unit?: string;
  notes?: string;
  measured_at: string;
  created_at: string;
}

export interface HealthMetricFilters {
  page?: number;
  limit?: number;
  metric_type?: string;
  start_date?: string;
  end_date?: string;
}

@Injectable({
  providedIn: 'root'
})
export class HealthService {
  constructor(private api: ApiService) {}

  getHealthMetrics(filters?: HealthMetricFilters): Observable<PaginatedResponse<HealthMetric>> {
    return this.api.get<PaginatedResponse<HealthMetric>>('/user/healthmetrics/', filters);
  }

  getLatestMetrics(): Observable<HealthMetric[]> {
    return this.api.get<HealthMetric[]>('/user/healthmetrics/', { limit: 10, ordering: '-measured_at' });
  }
}
