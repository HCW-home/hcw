import { Injectable, OnDestroy } from '@angular/core';

/**
 * Announces state changes to screen readers.
 *
 * The app has no visually-hidden live regions of its own, so events that are
 * conveyed purely by a visual change — the practitioner joining, the
 * connection dropping, a new chat message — go completely unnoticed by
 * assistive technology. This service maintains two off-screen live regions and
 * pushes text into them.
 *
 * Written by hand rather than pulling in @angular/cdk's LiveAnnouncer: the CDK
 * is not a dependency of this project and this is the only piece of it needed.
 *
 * The regions are created on the document rather than in a component template
 * so announcements also work from callbacks that run outside Angular, such as
 * LiveKit room events.
 */
@Injectable({ providedIn: 'root' })
export class LiveAnnouncerService implements OnDestroy {
  private polite: HTMLElement | null = null;
  private assertive: HTMLElement | null = null;
  private pending?: ReturnType<typeof setTimeout>;

  /**
   * @param message  Text to read out. Must already be translated.
   * @param urgency  'polite' waits for the reader to finish its current
   *                 sentence; 'assertive' interrupts. Reserve assertive for
   *                 things the patient must act on, such as a dropped call.
   */
  announce(message: string, urgency: 'polite' | 'assertive' = 'polite'): void {
    if (!message) return;
    const region = urgency === 'assertive' ? this.getAssertive() : this.getPolite();

    /* Clearing first, then setting on a later tick, is what makes a repeated
     * message announce twice. Writing the same textContent again is not a DOM
     * mutation, so screen readers would stay silent — and "connection lost"
     * twice in a row is exactly the case that matters. */
    region.textContent = '';
    clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      region.textContent = message;
    }, 100);
  }

  /** Empties both regions, e.g. when leaving a consultation. */
  clear(): void {
    clearTimeout(this.pending);
    if (this.polite) this.polite.textContent = '';
    if (this.assertive) this.assertive.textContent = '';
  }

  private getPolite(): HTMLElement {
    if (!this.polite) {
      this.polite = this.createRegion('polite', 'status');
    }
    return this.polite;
  }

  private getAssertive(): HTMLElement {
    if (!this.assertive) {
      this.assertive = this.createRegion('assertive', 'alert');
    }
    return this.assertive;
  }

  private createRegion(politeness: 'polite' | 'assertive', role: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', role);
    el.classList.add('sr-only');
    document.body.appendChild(el);
    return el;
  }

  ngOnDestroy(): void {
    clearTimeout(this.pending);
    this.polite?.remove();
    this.assertive?.remove();
  }
}
