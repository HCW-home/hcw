import { Injectable } from '@angular/core';

import { VideoProvider } from './video-call.types';

@Injectable({ providedIn: 'root' })
export class VideoCallPrefetchService {
  private done = false;

  prefetch(provider: VideoProvider | null | undefined): void {
    if (this.done || !provider || typeof window === 'undefined') {
      return;
    }
    this.done = true;
    const run = (): void => this.loadChunk(provider);
    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof idle === 'function') {
      idle(run, { timeout: 5000 });
    } else {
      setTimeout(run, 2000);
    }
  }

  private loadChunk(provider: VideoProvider): void {
    if (provider === 'livekit') {
      import('./livekit-adapter').catch(() => {
        /* prefetch failures are non-fatal */
      });
    } else if (provider === 'mediasoup') {
      import('./mediasoup.service').catch(() => {
        /* prefetch failures are non-fatal */
      });
    }
  }
}
