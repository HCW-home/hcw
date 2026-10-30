import { HttpErrorResponse } from '@angular/common/http';

/**
 * How long "resend code" stays unavailable after a code was sent.
 *
 * Mirrors VERIFICATION_CODE_RESEND_DELAY in backend/users/verification.py: the
 * server sends nothing when asked again sooner, so a shorter wait here would
 * only let people press a button that does nothing.
 */
export const RESEND_DELAY_SECONDS = 30;

/** Seconds to wait before asking again, read from a 429 response if it says. */
export function retryAfterSeconds(error: HttpErrorResponse): number {
  const value = Number(error.headers?.get('Retry-After'));
  return Number.isFinite(value) && value > 0 ? value : RESEND_DELAY_SECONDS;
}

/**
 * Countdown behind a "resend code" button.
 *
 * Counts against a deadline rather than decrementing on every tick: browsers
 * slow timers down in background tabs, and the person usually is in another
 * tab, reading the code.
 */
export class ResendCountdown {
  remaining = 0;

  private timer: ReturnType<typeof setInterval> | null = null;

  get running(): boolean {
    return this.remaining > 0;
  }

  start(seconds: number = RESEND_DELAY_SECONDS): void {
    this.stop();
    const deadline: number = Date.now() + seconds * 1000;
    const tick = (): void => {
      this.remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (!this.remaining) {
        this.stop();
      }
    };
    tick();
    if (this.remaining) {
      this.timer = setInterval(tick, 1000);
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.remaining = 0;
  }
}
