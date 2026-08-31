import { Injectable } from '@angular/core';

export interface IPendingAction {
  action: string;
  id: string | null;
  email: string | null;
}

interface IStoredPendingAction extends IPendingAction {
  savedAt: number;
}

const STORAGE_KEY = 'pending_action';

/** A remembered action is only worth replaying for the length of a login. */
const TTL_MS = 30 * 60 * 1000;

/**
 * Remember the action of a deep link that could not be run yet.
 *
 * A link such as `?action=join&id=42` reaches the application before the user
 * is signed in, and the query string only travels as far as the page it was
 * handed to: the register page keeps the action but not its id, and the terms,
 * onboarding and encryption pages each restart from a bare route. Storing the
 * action lets whichever page finally lets the user in replay it.
 */
@Injectable({
  providedIn: 'root',
})
export class PendingActionService {
  save(pending: IPendingAction): void {
    if (!pending.action) {
      return;
    }
    const stored: IStoredPendingAction = { ...pending, savedAt: Date.now() };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      /* storage unavailable: the link simply loses its action */
    }
  }

  /** The stored action, or null when there is none left to replay. */
  peek(): IPendingAction | null {
    let stored: IStoredPendingAction | null = null;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as IStoredPendingAction) : null;
    } catch {
      stored = null;
    }

    if (!stored?.action) {
      this.clear();
      return null;
    }
    if (!stored.savedAt || Date.now() - stored.savedAt > TTL_MS) {
      this.clear();
      return null;
    }

    return {
      action: stored.action,
      id: stored.id ?? null,
      email: stored.email ?? null,
    };
  }

  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }
}
