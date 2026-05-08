import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EncryptionStorageService } from './encryption-storage.service';

interface UserKeyMaterialResponse {
  pk: number;
  encrypted_private_key: string | null;
  public_key: string | null;
  public_key_fingerprint: string | null;
}

interface ForgotPassphraseResponse {
  passphrase: string;
  public_key_fingerprint: string;
  detail: string;
}

interface EncryptedAttachmentMetadata {
  file_name: string;
  mime_type: string;
  wrapped_key?: string;
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

  // -- High-level envelope encryption ------------------------------------

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

  // -- Message encryption (envelope per message under consultation pubkey)

  async encryptString(plaintext: string, publicKeyPem: string): Promise<string> {
    return this.rsaEnvelopeEncrypt(
      new TextEncoder().encode(plaintext),
      publicKeyPem,
    );
  }

  async decryptString(blob: string, privateKey: CryptoKey): Promise<string> {
    const buffer = await this.rsaEnvelopeDecrypt(blob, privateKey);
    return new TextDecoder().decode(buffer);
  }

  async encryptBlob(
    blob: Blob,
    publicKeyPem: string,
  ): Promise<{ blob: Blob; wrappedKey: string }> {
    // Hybrid encryption for arbitrary-size attachments: fresh CEK +
    // AES-GCM(blob, CEK, iv) with iv prefixed in the encrypted blob, then
    // RSA-OAEP-wrap the CEK under the consultation pubkey. The wrapped CEK
    // is returned separately so callers can stash it in the (encrypted)
    // attachment metadata.
    const pubKey = await this.importPublicKey(publicKeyPem);
    const cekRaw = crypto.getRandomValues(new Uint8Array(32));
    const cek = await crypto.subtle.importKey(
      'raw',
      cekRaw,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const buffer = await blob.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cek,
      buffer,
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      pubKey,
      cekRaw,
    );
    return {
      blob: new Blob([combined], { type: 'application/octet-stream' }),
      wrappedKey: this.bufferToBase64(wrappedKey),
    };
  }

  async decryptBlob(
    encryptedBlob: Blob,
    privateKey: CryptoKey,
    metadata: EncryptedAttachmentMetadata,
  ): Promise<DecryptedAttachment> {
    if (!metadata.wrapped_key) {
      throw new Error('Attachment metadata is missing wrapped_key');
    }
    const wrappedKey = this.base64ToBuffer(metadata.wrapped_key);
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
    const buffer = await encryptedBlob.arrayBuffer();
    const combined = new Uint8Array(buffer);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cek,
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
    publicKeyPem: string,
  ): Promise<string> {
    return this.encryptString(JSON.stringify(metadata), publicKeyPem);
  }

  async decryptAttachmentMetadata(
    encrypted: string,
    privateKey: CryptoKey,
  ): Promise<EncryptedAttachmentMetadata> {
    const json = await this.decryptString(encrypted, privateKey);
    return JSON.parse(json) as EncryptedAttachmentMetadata;
  }

  // -- Passphrase-protected private key (PBKDF2 + AES-GCM, client-side) ---
  // Format on the wire (in User.encrypted_private_key, JSON string):
  //   { salt: <base64>, iv: <base64>, ciphertext: <base64> }
  // Derivation: PBKDF2-SHA256 with PBKDF2_ITERATIONS rounds, 32-byte key.
  // Cipher: AES-GCM with the 12-byte iv. The plaintext is the user's RSA
  // private key in PKCS8 PEM form. The passphrase is NEVER sent to the
  // server — the server only stores and serves the encrypted blob.
  private static readonly PBKDF2_ITERATIONS = 600_000;
  private static readonly PBKDF2_SALT_BYTES = 16;
  private static readonly AES_NONCE_BYTES = 12;

  private async deriveKekFromPassphrase(
    passphrase: string,
    salt: ArrayBuffer,
  ): Promise<CryptoKey> {
    const passphraseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: EncryptionService.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      passphraseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async decryptPrivateKeyBlob(
    blob: string,
    passphrase: string,
  ): Promise<ArrayBuffer> {
    const data = JSON.parse(blob) as {
      salt: string;
      iv: string;
      ciphertext: string;
    };
    const salt = this.base64ToBuffer(data.salt);
    const iv = this.base64ToBuffer(data.iv);
    const ciphertext = this.base64ToBuffer(data.ciphertext);
    const kek = await this.deriveKekFromPassphrase(passphrase, salt);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ciphertext);
  }

  async encryptPrivateKeyBlob(
    privatePem: ArrayBuffer | Uint8Array,
    passphrase: string,
  ): Promise<string> {
    const salt = crypto.getRandomValues(
      new Uint8Array(EncryptionService.PBKDF2_SALT_BYTES),
    );
    const iv = crypto.getRandomValues(
      new Uint8Array(EncryptionService.AES_NONCE_BYTES),
    );
    const kek = await this.deriveKekFromPassphrase(passphrase, salt.buffer);
    const data = privatePem instanceof Uint8Array
      ? privatePem
      : new Uint8Array(privatePem);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      kek,
      data,
    );
    return JSON.stringify({
      salt: this.bufferToBase64(salt.buffer),
      iv: this.bufferToBase64(iv.buffer),
      ciphertext: this.bufferToBase64(ciphertext),
    });
  }

  // -- Server interactions -------------------------------------------------

  private async fetchOwnKeyMaterial(): Promise<UserKeyMaterialResponse> {
    return firstValueFrom(
      this.http.get<UserKeyMaterialResponse>(`${environment.apiUrl}/auth/user/`),
    );
  }

  async activatePassphrase(
    userId: number,
    passphrase: string,
  ): Promise<void> {
    const user = await this.fetchOwnKeyMaterial();
    if (!user.encrypted_private_key || !user.public_key) {
      throw new Error('No encryption keypair provisioned for this user.');
    }
    const privatePemBytes = await this.decryptPrivateKeyBlob(
      user.encrypted_private_key,
      passphrase,
    );
    const privatePem = new TextDecoder().decode(privatePemBytes);
    // Import as non-extractable CryptoKey objects before persisting. Once
    // they hit IndexedDB we will never have access to the raw bytes again.
    const privateKey = await this.importPrivateKey(privatePem);
    const publicKey = await this.importPublicKey(user.public_key);
    await this.storage.setUserKeys(
      userId,
      privateKey,
      publicKey,
      user.public_key_fingerprint || '',
    );
    // Tell the server the user has successfully unlocked their keypair so
    // the "passphrase pending" UX flag can be cleared. No sensitive data.
    await firstValueFrom(
      this.http.post(
        `${environment.apiUrl}/auth/encryption/mark-activated/`,
        {},
      ),
    );
  }

  async changePassphrase(
    oldPassphrase: string,
    newPassphrase: string,
  ): Promise<void> {
    const user = await this.fetchOwnKeyMaterial();
    if (!user.encrypted_private_key) {
      throw new Error('No encryption keypair provisioned for this user.');
    }
    const privatePemBytes = await this.decryptPrivateKeyBlob(
      user.encrypted_private_key,
      oldPassphrase,
    );
    const newBlob = await this.encryptPrivateKeyBlob(
      privatePemBytes,
      newPassphrase,
    );
    await firstValueFrom(
      this.http.post(
        `${environment.apiUrl}/auth/encryption/update-encrypted-private-key/`,
        { encrypted_private_key: newBlob },
      ),
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
