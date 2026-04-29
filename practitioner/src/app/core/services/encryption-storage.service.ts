import { Injectable } from '@angular/core';

const DB_NAME = 'hcw-encryption';
const STORE_NAME = 'keys';
const DB_VERSION = 2;

const PRIVATE_KEY_KEY = 'user-private-key';
const PUBLIC_KEY_KEY = 'user-public-key';
const FINGERPRINT_KEY = 'user-public-key-fingerprint';
const USER_ID_KEY = 'user-id';

@Injectable({ providedIn: 'root' })
export class EncryptionStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (): void => {
        const db = request.result;
        // Drop and recreate to ensure the store has the expected keyPath even
        // if a previous version of the app left it in a different shape.
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
      request.onblocked = (): void =>
        reject(new Error('IndexedDB upgrade blocked — close other HCW tabs and retry'));
    });
    return this.dbPromise;
  }

  private async resetDb(): Promise<void> {
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        db.close();
      } catch {
        // ignore
      }
    }
    this.dbPromise = null;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = (): void => resolve();
      req.onerror = (): void => reject(req.error);
      req.onblocked = (): void =>
        reject(new Error('IndexedDB delete blocked — close other HCW tabs and retry'));
    });
  }

  private async get<T>(key: string): Promise<T | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = (): void => {
        const result = request.result as { value: T } | undefined;
        resolve(result ? result.value : null);
      };
      request.onerror = (): void => reject(request.error);
    });
  }

  private async deleteEntry(key: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
  }

  private async writeKeysOnce(
    db: IDBDatabase,
    userId: number,
    privateKey: CryptoKey,
    publicKey: CryptoKey,
    fingerprint: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let failed = false;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const safePut = (key: string, value: unknown): void => {
        try {
          store.put({ key, value });
        } catch (err) {
          failed = true;
          reject(err);
        }
      };
      // CryptoKey objects are first-class citizens in IndexedDB's structured
      // clone algorithm, so we store them directly. Non-extractable keys
      // remain non-extractable when read back.
      safePut(USER_ID_KEY, userId);
      if (failed) return;
      safePut(PRIVATE_KEY_KEY, privateKey);
      if (failed) return;
      safePut(PUBLIC_KEY_KEY, publicKey);
      if (failed) return;
      safePut(FINGERPRINT_KEY, fingerprint);
      if (failed) return;
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
      tx.onabort = (): void => reject(tx.error);
    });
  }

  async setUserKeys(
    userId: number,
    privateKey: CryptoKey,
    publicKey: CryptoKey,
    fingerprint: string,
  ): Promise<void> {
    let db = await this.openDb();
    try {
      await this.writeKeysOnce(db, userId, privateKey, publicKey, fingerprint);
      return;
    } catch (err) {
      console.warn(
        'IndexedDB write failed; resetting hcw-encryption DB and retrying',
        err,
      );
      await this.resetDb();
      db = await this.openDb();
      await this.writeKeysOnce(db, userId, privateKey, publicKey, fingerprint);
    }
  }

  async getStoredUserId(): Promise<number | null> {
    return (await this.get<number>(USER_ID_KEY)) ?? null;
  }

  async getPrivateKey(userId: number): Promise<CryptoKey | null> {
    const storedUserId = await this.getStoredUserId();
    if (storedUserId !== userId) {
      return null;
    }
    return this.get<CryptoKey>(PRIVATE_KEY_KEY);
  }

  async getPublicKey(userId: number): Promise<CryptoKey | null> {
    const storedUserId = await this.getStoredUserId();
    if (storedUserId !== userId) {
      return null;
    }
    return this.get<CryptoKey>(PUBLIC_KEY_KEY);
  }

  async getFingerprint(userId: number): Promise<string | null> {
    const storedUserId = await this.getStoredUserId();
    if (storedUserId !== userId) {
      return null;
    }
    return this.get<string>(FINGERPRINT_KEY);
  }

  async hasPrivateKey(userId: number): Promise<boolean> {
    return (await this.getPrivateKey(userId)) !== null;
  }

  async clear(): Promise<void> {
    await this.deleteEntry(USER_ID_KEY);
    await this.deleteEntry(PRIVATE_KEY_KEY);
    await this.deleteEntry(PUBLIC_KEY_KEY);
    await this.deleteEntry(FINGERPRINT_KEY);
  }
}
