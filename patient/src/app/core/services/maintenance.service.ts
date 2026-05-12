import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MaintenanceService {
  private maintenanceSubject = new BehaviorSubject<boolean>(false);
  private messageSubject = new BehaviorSubject<string>('');
  private retryAfterSubject = new BehaviorSubject<number>(0);

  public isMaintenance$: Observable<boolean> = this.maintenanceSubject.asObservable();
  public message$: Observable<string> = this.messageSubject.asObservable();
  public retryAfter$: Observable<number> = this.retryAfterSubject.asObservable();

  setMaintenance(message?: string, retryAfter?: number): void {
    if (message) {
      this.messageSubject.next(message);
    }
    if (retryAfter && retryAfter > 0) {
      this.retryAfterSubject.next(retryAfter);
    }
    if (!this.maintenanceSubject.value) {
      this.maintenanceSubject.next(true);
    }
  }

  clearMaintenance(): void {
    if (this.maintenanceSubject.value) {
      this.maintenanceSubject.next(false);
      this.messageSubject.next('');
      this.retryAfterSubject.next(0);
    }
  }

  isMaintenance(): boolean {
    return this.maintenanceSubject.value;
  }
}
