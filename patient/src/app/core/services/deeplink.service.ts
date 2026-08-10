import { Injectable, inject } from '@angular/core';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { NavController } from '@ionic/angular/standalone';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import * as ed from '@noble/ed25519';
import { IABSIS_PUBLIC_KEY_B64 } from '../security/iabsis-keys';

export const API_ORIGIN_KEY = 'hcw_api_origin';
const KNOWN_INSTANCES_KEY = 'hcw_known_instances';

interface IdentityPayload {
  product?: string;
  product_name?: string;
  instance_name?: string | null;
  signature?: string | null;
}

interface SignatureBlob {
  host: string;
  exp: number;
  sig: string;
}

export interface KnownInstance {
  host: string;
  name: string | null;
  lastUsedAt: number;
}

export type UntrustedReason =
  | 'no-signature'
  | 'malformed-signature'
  | 'host-mismatch'
  | 'expired'
  | 'invalid-signature'
  | 'identity-probe-failed'
  | 'not-hcw-backend';

@Injectable({ providedIn: 'root' })
export class DeeplinkService {
  private navCtrl = inject(NavController);
  // Bypass interceptors: the JWT/auth interceptor might attach a stale token
  // tied to a different tenant when probing a brand new instance.
  private rawHttp = new HttpClient(inject(HttpBackend));

  initialize(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      this.handleUrl(event.url).catch((err) => console.error('[Deeplink]', err));
    });
    // App started from the launcher (no deeplink): if we don't have an active
    // instance, send the user to the picker.
    if (!DeeplinkService.getStoredApiOrigin()) {
      this.navCtrl.navigateRoot(['/instance-picker']);
    }
  }

  static getStoredApiOrigin(): string | null {
    return localStorage.getItem(API_ORIGIN_KEY);
  }

  hasActiveInstance(): boolean {
    return !!DeeplinkService.getStoredApiOrigin();
  }

  /**
   * Host of the active instance, without scheme (for display purposes).
   */
  getActiveHost(): string | null {
    const origin = DeeplinkService.getStoredApiOrigin();
    return origin ? origin.replace(/^https?:\/\//, '') : null;
  }

  /**
   * Open the picker on top of the current page, so the user can go back if
   * they change their mind.
   */
  openPicker(): void {
    this.navCtrl.navigateForward(['/instance-picker']);
  }

  /**
   * Returns the list of instances the user has connected to before,
   * sorted by most-recent first.
   */
  getKnownInstances(): KnownInstance[] {
    return this.loadKnownInstances().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  /**
   * Activate an already-known instance.
   */
  selectInstance(host: string): boolean {
    if (!this.loadKnownInstances().some((i) => i.host === host)) {
      return false;
    }
    this.activate(host);
    return true;
  }

  /**
   * Make an instance the active one and restart the app on it.
   *
   * A full WebView reload is intentional: config, branding, websocket and user
   * state held in memory all belong to the previous instance, and the
   * APP_INITIALIZER config fetch has to be replayed against the new origin
   * (on a fresh install it ran before any origin existed and cached a failure).
   */
  private activate(host: string): void {
    const known = this.loadKnownInstances();
    const match = known.find((i) => i.host === host);
    if (match) {
      match.lastUsedAt = Date.now();
      this.saveKnownInstances(known);
    }
    localStorage.setItem(API_ORIGIN_KEY, `https://${host}`);
    window.location.href = '/';
  }

  removeInstance(host: string): void {
    const known = this.loadKnownInstances().filter((i) => i.host !== host);
    this.saveKnownInstances(known);
    if (localStorage.getItem(API_ORIGIN_KEY) === `https://${host}`) {
      localStorage.removeItem(API_ORIGIN_KEY);
    }
  }

  /**
   * Validate and register a new instance from a user-typed host, then activate
   * it. Returns true on success, the failure reason otherwise.
   */
  async addInstanceManually(rawHost: string): Promise<true | UntrustedReason> {
    const host = rawHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) {
      return 'identity-probe-failed';
    }
    const origin = `https://${host}`;
    const result = await this.validateHost(host, origin);
    if (result !== true) {
      return result;
    }
    this.activate(host);
    return true;
  }

  private async handleUrl(rawUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      console.warn('[Deeplink] not a valid URL:', rawUrl);
      return;
    }

    if (url.protocol !== 'hcw:') {
      return;
    }

    const host = url.host;
    if (!host) {
      console.warn('[Deeplink] missing host in URL:', rawUrl);
      return;
    }

    const origin = `https://${host}`;
    const trustResult = await this.validateHost(host, origin);
    if (trustResult !== true) {
      this.navCtrl.navigateRoot(['/untrusted-instance'], {
        queryParams: { host, reason: trustResult },
      });
      return;
    }

    localStorage.setItem(API_ORIGIN_KEY, origin);

    const path = url.pathname || '/';
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
    this.navCtrl.navigateRoot([path], { queryParams });
  }

  private async validateHost(
    host: string,
    origin: string,
  ): Promise<true | UntrustedReason> {
    let identity: IdentityPayload;
    try {
      identity = await firstValueFrom(
        this.rawHttp.get<IdentityPayload>(`${origin}/api/identity/`),
      );
    } catch (err) {
      console.warn('[Deeplink] identity probe error for', host, err);
      return 'identity-probe-failed';
    }

    if (identity?.product !== 'hcw') {
      return 'not-hcw-backend';
    }

    if (!identity.signature) {
      return 'no-signature';
    }

    let blob: SignatureBlob;
    try {
      blob = JSON.parse(identity.signature);
    } catch {
      return 'malformed-signature';
    }

    if (!blob.host || !blob.sig || typeof blob.exp !== 'number') {
      return 'malformed-signature';
    }

    if (blob.host.toLowerCase() !== host.toLowerCase()) {
      return 'host-mismatch';
    }

    if (Date.now() / 1000 >= blob.exp) {
      return 'expired';
    }

    const ok = await this.verifySignature(blob);
    if (!ok) {
      return 'invalid-signature';
    }

    this.recordInstance(host, identity.instance_name ?? null);
    return true;
  }

  private async verifySignature(blob: SignatureBlob): Promise<boolean> {
    if (!IABSIS_PUBLIC_KEY_B64) {
      console.error('[Deeplink] IABSIS_PUBLIC_KEY_B64 is empty; refusing to trust.');
      return false;
    }
    try {
      const pubKey = base64ToBytes(IABSIS_PUBLIC_KEY_B64);
      const signature = base64ToBytes(blob.sig);
      const message = new TextEncoder().encode(`${blob.host}\n${blob.exp}`);
      return await ed.verifyAsync(signature, message, pubKey);
    } catch (err) {
      console.warn('[Deeplink] signature verification error', err);
      return false;
    }
  }

  private recordInstance(host: string, name: string | null): void {
    const known = this.loadKnownInstances();
    const existing = known.find((i) => i.host === host);
    if (existing) {
      existing.name = name ?? existing.name;
      existing.lastUsedAt = Date.now();
    } else {
      known.push({ host, name, lastUsedAt: Date.now() });
    }
    this.saveKnownInstances(known);
  }

  private loadKnownInstances(): KnownInstance[] {
    try {
      const raw = localStorage.getItem(KNOWN_INSTANCES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveKnownInstances(instances: KnownInstance[]): void {
    localStorage.setItem(KNOWN_INSTANCES_KEY, JSON.stringify(instances));
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
