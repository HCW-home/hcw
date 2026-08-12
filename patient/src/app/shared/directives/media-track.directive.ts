import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';

import { AttachableTrack } from '../../core/services/video-call.types';

/**
 * Binds an AttachableTrack to the media element it sits on.
 *
 * Why a directive rather than attaching imperatively from the page component:
 * Angular destroys and recreates the <video> nodes inside @for/@if whenever the
 * grid reorders or a placeholder toggles. Caching those nodes in a Map leaves
 * stale, detached elements behind — the recreated element never receives the
 * track and renders a black box. A directive is tied to the element's own
 * lifecycle, so a recreated element always re-attaches.
 *
 * Using the provider's attach() (rather than assigning srcObject) is what keeps
 * LiveKit's adaptiveStream working: it tracks which elements a track is
 * attached to in order to decide whether to send video at all.
 */
@Directive({
  selector: '[appMediaTrack]',
  standalone: true,
})
export class MediaTrackDirective implements OnChanges, OnDestroy {
  @Input('appMediaTrack') track: AttachableTrack | null = null;

  /** Mirrors the element's muted state; used for the speaker on/off toggle. */
  @Input() trackMuted = false;

  private readonly elementRef = inject<ElementRef<HTMLMediaElement>>(ElementRef);
  private attached: AttachableTrack | null = null;

  ngOnChanges(): void {
    const element = this.elementRef.nativeElement;
    element.muted = this.trackMuted;

    if (this.track === this.attached) return;

    this.detach();

    if (this.track) {
      this.track.attach(element);
      this.attached = this.track;
    }
  }

  ngOnDestroy(): void {
    this.detach();
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached.detach(this.elementRef.nativeElement);
    this.attached = null;
  }
}
