import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { MaintenanceService } from '../services/maintenance.service';
import { TranslationService } from '../services/translation.service';

@Component({
  selector: 'app-maintenance-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (maintenanceService.isMaintenance$ | async) {
      <div class="maintenance-overlay" role="alert" aria-live="assertive">
        <div class="maintenance-box">
          <img src="svg/logo.svg" alt="HCW@Home" class="maintenance-logo" />
          <h1>{{ translationService.instant('maintenance.title') }}</h1>
          <p>
            {{ (maintenanceService.message$ | async) || translationService.instant('maintenance.defaultMessage') }}
          </p>
          @if (countdown > 0) {
            <p class="maintenance-countdown">
              {{ translationService.instant('maintenance.autoRefresh', { seconds: countdownText }) }}
            </p>
          }
          <button type="button" class="maintenance-retry" (click)="retry()">
            {{ translationService.instant('maintenance.retry') }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .maintenance-overlay {
      position: fixed;
      inset: 0;
      background: linear-gradient(135deg, var(--primary-50, #ecfeff) 0%, #ffffff 60%, var(--primary-50, #ecfeff) 100%);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .maintenance-box {
      max-width: 480px;
      text-align: center;
      color: #1f2937;
      background: white;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      box-shadow: 0 10px 30px rgba(8, 145, 178, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
      border: 1px solid var(--primary-100, #cffafe);
    }
    .maintenance-logo {
      height: 3rem;
      width: auto;
      margin: 0 auto 2rem;
      display: block;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 0.75rem;
      color: var(--primary-700, #0e7490);
    }
    p {
      font-size: 1rem;
      line-height: 1.5;
      color: #4b5563;
      margin: 0 0 1rem;
    }
    .maintenance-countdown {
      font-size: 0.875rem;
      color: #6b7280;
      margin-bottom: 1.5rem;
    }
    .maintenance-retry {
      padding: 0.65rem 1.75rem;
      border: 0;
      border-radius: 8px;
      background: var(--primary-500, #06b6d4);
      color: white;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .maintenance-retry:hover {
      background: var(--primary-600, #0891b2);
    }
  `],
})
export class MaintenanceOverlayComponent implements OnInit, OnDestroy {
  maintenanceService = inject(MaintenanceService);
  translationService = inject(TranslationService);

  countdown = 0;

  get countdownText(): string {
    return String(this.countdown);
  }

  private destroy$ = new Subject<void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    combineLatest([
      this.maintenanceService.isMaintenance$,
      this.maintenanceService.retryAfter$,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([isMaintenance, retryAfter]) => {
        if (isMaintenance && retryAfter > 0) {
          this.startCountdown(retryAfter);
        } else {
          this.stopCountdown();
        }
      });
  }

  retry(): void {
    window.location.reload();
  }

  private startCountdown(seconds: number): void {
    this.stopCountdown();
    this.countdown = seconds;
    this.timer = setInterval(() => {
      this.countdown -= 1;
      if (this.countdown <= 0) {
        this.stopCountdown();
        window.location.reload();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.countdown = 0;
  }

  ngOnDestroy(): void {
    this.stopCountdown();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
