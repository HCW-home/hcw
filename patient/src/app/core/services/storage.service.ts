import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private _storage: Storage | null = null;
  private _initPromise: Promise<Storage> | null = null;

  constructor(private storage: Storage) {
    this._initPromise = this.init();
  }

  async init(): Promise<Storage> {
    const storage = await this.storage.create();
    this._storage = storage;
    return storage;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this._storage && this._initPromise) {
      await this._initPromise;
    }
  }

  public async set(key: string, value: any): Promise<any> {
    await this.ensureInitialized();
    return await this._storage?.set(key, value);
  }

  public async get(key: string): Promise<any> {
    await this.ensureInitialized();
    return await this._storage?.get(key);
  }

  public async remove(key: string): Promise<any> {
    await this.ensureInitialized();
    return await this._storage?.remove(key);
  }

  public async clear(): Promise<void> {
    return await this._storage?.clear();
  }

  public async keys(): Promise<string[]> {
    return await this._storage?.keys() || [];
  }
}