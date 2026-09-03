import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/**
 * Anything smaller than this is browser chrome sliding in and out (URL bar,
 * tab strip), not a keyboard.
 */
const MIN_KEYBOARD_HEIGHT = 120;

/**
 * Publishes the band of the layout viewport hidden by the on-screen keyboard,
 * both as the `--app-keyboard-height` CSS variable and as a signal.
 *
 * The height is always measured from `visualViewport` rather than read off the
 * Capacitor event: when the platform already resized the web view (Android
 * `adjustResize`, iOS native resize) the overlap measures 0 and no extra offset
 * must be applied, while on platforms that only overlay the keyboard — Android
 * 15 edge-to-edge, mobile browsers, PWAs — it reports exactly the hidden band.
 * The native events only act as extra triggers, since the viewport can settle
 * later than the keyboard animation.
 *
 * `global.scss` turns the variable into bottom padding on every `.ion-page`, so
 * pages shrink above the keyboard exactly like a natively resized web view.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  /** Height in pixels of the area covered by the keyboard, 0 when closed. */
  readonly height = signal(0);

  private initialized = false;
  private measureTimer: ReturnType<typeof setTimeout> | null = null;

  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', this.measure);
      viewport.addEventListener('scroll', this.measure);
    }
    window.addEventListener('orientationchange', this.scheduleMeasure);

    if (Capacitor.isNativePlatform()) {
      for (const event of ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide']) {
        Keyboard.addListener(event as any, () => this.scheduleMeasure());
      }
    }

    this.measure();
  }

  private scheduleMeasure = (): void => {
    // The viewport is only up to date once the keyboard animation has run.
    if (this.measureTimer) {
      clearTimeout(this.measureTimer);
    }
    this.measureTimer = setTimeout(() => {
      this.measureTimer = null;
      this.measure();
    }, 100);
  };

  private measure = (): void => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    // Part of the layout viewport the visual viewport no longer covers. When
    // the browser pans to reveal the focused field, `offsetTop` is that pan and
    // must not be counted as hidden.
    const overlap = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);

    // A keyboard is only ever up while something editable holds the focus; this
    // rules out the URL bar producing the same signal.
    const height = overlap >= MIN_KEYBOARD_HEIGHT && this.isEditableFocused() ? overlap : 0;

    if (height === this.height()) {
      return;
    }
    this.height.set(height);
    document.documentElement.style.setProperty('--app-keyboard-height', `${height}px`);
  };

  private isEditableFocused(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
      return false;
    }
    const tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'ION-INPUT' || tag === 'ION-TEXTAREA' || active.isContentEditable;
  }
}
