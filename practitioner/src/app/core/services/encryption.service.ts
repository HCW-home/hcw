import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EncryptionStorageService } from './encryption-storage.service';

interface ActivatePassphraseResponse {
  private_key_pem: string;
  public_key_pem: string;
  public_key_fingerprint: string;
}

interface ForgotPassphraseResponse {
  passphrase: string;
  public_key_fingerprint: string;
  detail: string;
}

interface EncryptedAttachmentMetadata {
  file_name: string;
  mime_type: string;
}

interface DecryptedAttachment {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

@Injectable({ providedIn: 'root' })
export class EncryptionService {
  private http: HttpClient = inject(HttpClient);
  private storage: EncryptionStorageService = inject(EncryptionStorageService);

  // -- WebCrypto helpers ---------------------------------------------------

  private bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private pemToDer(pem: string, label: string): ArrayBuffer {
    const stripped = pem
      .replace(`-----BEGIN ${label}-----`, '')
      .replace(`-----END ${label}-----`, '')
      .replace(/\s+/g, '');
    return this.base64ToBuffer(stripped);
  }

  async fingerprintPublicKey(publicKeyPem: string): Promise<string> {
    const data = new TextEncoder().encode(publicKeyPem.trim());
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async importPublicKey(publicKeyPem: string): Promise<CryptoKey> {
    const der = this.pemToDer(publicKeyPem, 'PUBLIC KEY');
    return crypto.subtle.importKey(
      'spki',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
  }

  async importPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
    // extractable=false so that once stored in IndexedDB the raw private key
    // material can never be read back as bytes, even by our own code.
    const der = this.pemToDer(privateKeyPem, 'PRIVATE KEY');
    return crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
  }

  async generateSymKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  async exportSymKeyRaw(key: CryptoKey): Promise<ArrayBuffer> {
    return crypto.subtle.exportKey('raw', key);
  }

  async importSymKeyRaw(raw: ArrayBuffer): Promise<CryptoKey> {
    // extractable=true so we can re-wrap this sym_key for new recipients
    // when the practitioner changes beneficiary/owned_by/group on an
    // already-encrypted consultation. The underlying RSA private key (used
    // to unwrap) stays extractable=false.
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ]);
  }

  // -- High-level wrap/unwrap ---------------------------------------------

  async wrapSymKeyForPublicKey(
    symKey: CryptoKey,
    publicKeyPem: string,
  ): Promise<string> {
    const pubKey = await this.importPublicKey(publicKeyPem);
    const raw = await this.exportSymKeyRaw(symKey);
    const wrapped = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      pubKey,
      raw,
    );
    return this.bufferToBase64(wrapped);
  }

  async unwrapSymKeyWithPrivateKey(
    wrappedB64: string,
    privateKey: CryptoKey,
  ): Promise<CryptoKey> {
    const wrapped = this.base64ToBuffer(wrappedB64);
    const raw = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      wrapped,
    );
    return this.importSymKeyRaw(raw);
  }

  async rsaEnvelopeDecrypt(
    blob: string,
    privateKey: CryptoKey,
  ): Promise<ArrayBuffer> {
    // Reverses backend's core.encryption.rsa_envelope_encrypt:
    // {wrapped_key (base64), iv (base64), ciphertext (base64)}
    // 1. RSA-OAEP-decrypt wrapped_key with privateKey -> CEK (32 bytes)
    // 2. AES-GCM-decrypt ciphertext with CEK + iv -> plaintext
    const data = JSON.parse(blob) as {
      wrapped_key: string;
      iv: string;
      ciphertext: string;
    };
    const wrappedKey = this.base64ToBuffer(data.wrapped_key);
    const iv = this.base64ToBuffer(data.iv);
    const ciphertext = this.base64ToBuffer(data.ciphertext);
    const cekRaw = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      wrappedKey,
    );
    const cek = await crypto.subtle.importKey(
      'raw',
      cekRaw,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cek, ciphertext);
  }

  // -- Message encryption (AES-GCM, IV prefixed) --------------------------

  async encryptString(plaintext: string, symKey: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      symKey,
      new TextEncoder().encode(plaintext),
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return this.bufferToBase64(combined.buffer);
  }

  async decryptString(ciphertextB64: string, symKey: CryptoKey): Promise<string> {
    const combined = new Uint8Array(this.base64ToBuffer(ciphertextB64));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      symKey,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  }

  async encryptBlob(blob: Blob, symKey: CryptoKey): Promise<Blob> {
    const buffer = await blob.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      symKey,
      buffer,
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return new Blob([combined], { type: 'application/octet-stream' });
  }

  async decryptBlob(
    encryptedBlob: Blob,
    symKey: CryptoKey,
    metadata: EncryptedAttachmentMetadata,
  ): Promise<DecryptedAttachment> {
    const buffer = await encryptedBlob.arrayBuffer();
    const combined = new Uint8Array(buffer);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      symKey,
      ciphertext,
    );
    return {
      blob: new Blob([plain], { type: metadata.mime_type }),
      fileName: metadata.file_name,
      mimeType: metadata.mime_type,
    };
  }

  async encryptAttachmentMetadata(
    metadata: EncryptedAttachmentMetadata,
    symKey: CryptoKey,
  ): Promise<string> {
    return this.encryptString(JSON.stringify(metadata), symKey);
  }

  async decryptAttachmentMetadata(
    encrypted: string,
    symKey: CryptoKey,
  ): Promise<EncryptedAttachmentMetadata> {
    const json = await this.decryptString(encrypted, symKey);
    return JSON.parse(json) as EncryptedAttachmentMetadata;
  }

  // -- Server interactions -------------------------------------------------

  async activatePassphrase(
    userId: number,
    passphrase: string,
  ): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<ActivatePassphraseResponse>(
        `${environment.apiUrl}/auth/encryption/activate-passphrase/`,
        { passphrase },
      ),
    );
    // Import as non-extractable CryptoKey objects before persisting. Once
    // they hit IndexedDB we will never have access to the raw bytes again.
    const privateKey = await this.importPrivateKey(response.private_key_pem);
    const publicKey = await this.importPublicKey(response.public_key_pem);
    await this.storage.setUserKeys(
      userId,
      privateKey,
      publicKey,
      response.public_key_fingerprint,
    );
  }

  async changePassphrase(
    oldPassphrase: string,
    newPassphrase: string,
  ): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/encryption/change-passphrase/`, {
        old_passphrase: oldPassphrase,
        new_passphrase: newPassphrase,
      }),
    );
  }

  async forgotPassphrase(): Promise<ForgotPassphraseResponse> {
    return firstValueFrom(
      this.http.post<ForgotPassphraseResponse>(
        `${environment.apiUrl}/auth/encryption/forgot-passphrase/`,
        {},
      ),
    );
  }

  async purgeLocalKey(): Promise<void> {
    await this.storage.clear();
  }

  async hasLocalKey(userId: number): Promise<boolean> {
    return this.storage.hasPrivateKey(userId);
  }

  async getLocalPrivateKey(userId: number): Promise<CryptoKey | null> {
    return this.storage.getPrivateKey(userId);
  }
}
