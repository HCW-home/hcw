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
    // extractable=true is required by crypto.subtle.wrapKey at creation
    // time. Once wrapped and stored on the server, recipients receive the
    // sym_key via crypto.subtle.unwrapKey with extractable=false (see
    // unwrapSymKeyWithConsultationKey) so the raw bytes never reach JS.
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  async generateConsultationKeypair(): Promise<{
    publicKeyPem: string;
    privateKeyPem: string;
    publicKeyFingerprint: string;
  }> {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const pubDer = await crypto.subtle.exportKey('spki', pair.publicKey);
    const privDer = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const publicKeyPem = this.derToPem(pubDer, 'PUBLIC KEY');
    const privateKeyPem = this.derToPem(privDer, 'PRIVATE KEY');
    const publicKeyFingerprint = await this.fingerprintPublicKey(publicKeyPem);
    return { publicKeyPem, privateKeyPem, publicKeyFingerprint };
  }

  private derToPem(der: ArrayBuffer, label: string): string {
    const b64 = this.bufferToBase64(der);
    const lines = b64.match(/.{1,64}/g) || [b64];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
  }

  // -- High-level wrap/unwrap ---------------------------------------------

  async wrapSymKeyWithPublicKey(
    symKey: CryptoKey,
    publicKeyPem: string,
  ): Promise<string> {
    // Uses crypto.subtle.wrapKey so the raw sym_key bytes never leave the
    // WebCrypto sandbox in JS memory.
    const pubKey = await this.importPublicKey(publicKeyPem);
    const wrapped = await crypto.subtle.wrapKey(
      'raw',
      symKey,
      pubKey,
      { name: 'RSA-OAEP' },
    );
    return this.bufferToBase64(wrapped);
  }

  async unwrapSymKeyWithConsultationKey(
    wrappedB64: string,
    consultationPrivateKey: CryptoKey,
  ): Promise<CryptoKey> {
    // Returns a non-extractable AES-GCM key. The raw bytes never appear in
    // JS — once unwrapped the key can only be used via crypto.subtle.encrypt
    // / decrypt within the WebCrypto sandbox.
    const wrapped = this.base64ToBuffer(wrappedB64);
    return crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      consultationPrivateKey,
      { name: 'RSA-OAEP' },
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async rsaEnvelopeEncrypt(
    plaintext: ArrayBuffer | Uint8Array,
    publicKeyPem: string,
  ): Promise<string> {
    // Mirrors backend's core.encryption.rsa_envelope_encrypt:
    // {wrapped_key (base64), iv (base64), ciphertext (base64)}
    // Used to wrap payloads (e.g. RSA private keys) too large to fit in a
    // single RSA-OAEP block: encrypt with a fresh AES-GCM CEK, then RSA-wrap
    // the CEK for the recipient.
    const pubKey = await this.importPublicKey(publicKeyPem);
    const cekRaw = crypto.getRandomValues(new Uint8Array(32));
    const cek = await crypto.subtle.importKey(
      'raw',
      cekRaw,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cek,
      data,
    );
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      pubKey,
      cekRaw,
    );
    return JSON.stringify({
      wrapped_key: this.bufferToBase64(wrappedKey),
      iv: this.bufferToBase64(iv.buffer),
      ciphertext: this.bufferToBase64(ciphertext),
    });
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
