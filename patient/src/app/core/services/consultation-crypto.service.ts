import { Injectable, inject } from '@angular/core';
import { EncryptionService } from './encryption.service';
import {
  Consultation,
  ConsultationKeyEnvelope,
  ConsultationMessage,
} from '../models/consultation.model';

interface AttachmentDecryptResult {
  attachment: ConsultationMessage['attachment'];
  attachmentDecrypt?: (encryptedBlob: Blob) => Promise<Blob>;
}

/**
 * Centralizes the consultation-key navigation tree on the patient side:
 * take a Consultation payload + the current user's already-unlocked
 * private key, and produce the consultation's private RSA key
 * (non-extractable CryptoKey) that decrypts every message body and
 * attachment in the chat.
 *
 * Used by both `home.page` (inline chat in the consultation list) and
 * `video-consultation.page` (chat overlay shown during a video call).
 */
@Injectable({ providedIn: 'root' })
export class ConsultationCryptoService {
  private encryptionService = inject(EncryptionService);

  // Per-consultation cache of the unwrapped private key, keyed by
  // consultation id. Memoised across pages so the costly RSA unwrap
  // happens once per consultation per session.
  private cache = new Map<number, CryptoKey>();

  async loadConsultationKey(
    consultation: Consultation,
    userId: number,
  ): Promise<CryptoKey | null> {
    if (!consultation?.is_encrypted) {
      return null;
    }
    const cached = this.cache.get(consultation.id);
    if (cached) {
      return cached;
    }
    const userPrivate = await this.encryptionService.getLocalPrivateKey(userId);
    if (!userPrivate) {
      return null;
    }
    const consultPrivPem = await this.resolveConsultationPrivatePem(
      consultation.keys || [],
      userId,
      userPrivate,
    );
    if (!consultPrivPem) {
      return null;
    }
    const consultPrivKey =
      await this.encryptionService.importPrivateKey(consultPrivPem);
    this.cache.set(consultation.id, consultPrivKey);
    return consultPrivKey;
  }

  forget(consultationId: number): void {
    this.cache.delete(consultationId);
  }

  clear(): void {
    this.cache.clear();
  }

  private async resolveConsultationPrivatePem(
    keys: ConsultationKeyEnvelope[],
    userId: number,
    userPrivate: CryptoKey,
  ): Promise<string | null> {
    for (const key of keys) {
      try {
        if (key.user_id === userId) {
          const buf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.encrypted_private_key,
            userPrivate,
          );
          return new TextDecoder().decode(buf);
        }
        if (key.queue_id && key.queue_membership_envelope) {
          const queuePemBuf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.queue_membership_envelope,
            userPrivate,
          );
          const queuePem = new TextDecoder().decode(queuePemBuf);
          const queuePrivateKey =
            await this.encryptionService.importPrivateKey(queuePem);
          const consultPrivBuf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.encrypted_private_key,
            queuePrivateKey,
          );
          return new TextDecoder().decode(consultPrivBuf);
        }
      } catch (err) {
        console.warn('Consultation key unwrap failed for entry', err);
      }
    }
    return null;
  }

  async decryptMessageContent(
    rawContent: string | null,
    isEncrypted: boolean | undefined,
    privateKey: CryptoKey | null,
  ): Promise<string> {
    if (!isEncrypted || !rawContent || !privateKey) {
      return rawContent || '';
    }
    try {
      return await this.encryptionService.decryptString(rawContent, privateKey);
    } catch {
      return '[decryption failed]';
    }
  }

  async buildAttachmentDecryptor(
    msg: ConsultationMessage,
    privateKey: CryptoKey | null,
  ): Promise<AttachmentDecryptResult> {
    if (
      !msg.is_encrypted
      || !msg.attachment
      || !msg.encrypted_attachment_metadata
      || !privateKey
    ) {
      return { attachment: msg.attachment };
    }
    try {
      const metadata = await this.encryptionService.decryptAttachmentMetadata(
        msg.encrypted_attachment_metadata,
        privateKey,
      );
      const encryptionService = this.encryptionService;
      return {
        attachment: {
          file_name: metadata.file_name,
          mime_type: metadata.mime_type,
        } as ConsultationMessage['attachment'],
        attachmentDecrypt: async (encryptedBlob: Blob): Promise<Blob> => {
          const decrypted = await encryptionService.decryptBlob(
            encryptedBlob,
            privateKey,
            metadata,
          );
          return decrypted.blob;
        },
      };
    } catch (err) {
      console.warn('Failed to decrypt attachment metadata', err);
      return { attachment: msg.attachment };
    }
  }
}
