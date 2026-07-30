import { Injectable, inject } from '@angular/core';
import { EncryptionService } from './encryption.service';
import {
  Consultation,
  ConsultationKeyEnvelope,
  ConsultationKeyInput,
  ConsultationMessage,
  Participant,
} from '../models/consultation';

interface AttachmentDecryptResult {
  attachment: ConsultationMessage['attachment'];
  attachmentDecrypt?: (encryptedBlob: Blob) => Promise<Blob>;
}

/**
 * Centralizes the consultation-key navigation tree: take a Consultation
 * payload + the current user's already-unlocked private key, and produce
 * the consultation's private RSA key (non-extractable CryptoKey) that
 * decrypts every message body and attachment in the chat.
 *
 * Used by both `consultation-detail` (chat embedded in the consultation
 * page) and `pip-wrapper` (chat overlay shown during a video call).
 */
@Injectable({ providedIn: 'root' })
export class ConsultationCryptoService {
  private encryptionService = inject(EncryptionService);

  // Per-consultation cache of the unwrapped private key, keyed by
  // consultation id. Memoised across components so the costly RSA
  // unwrapping happens once per consultation per session.
  private cache = new Map<number, CryptoKey>();

  // Same key material as `cache`, kept in PEM form because provisioning new
  // participants requires re-wrapping it with their public key (a
  // non-extractable CryptoKey cannot be exported).
  private pemCache = new Map<number, string>();

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
    const consultPrivPem = await this.loadConsultationPrivatePem(
      consultation,
      userId,
    );
    if (!consultPrivPem) {
      return null;
    }
    const consultPrivKey =
      await this.encryptionService.importPrivateKey(consultPrivPem);
    this.cache.set(consultation.id, consultPrivKey);
    return consultPrivKey;
  }

  /**
   * Unwrap the consultation private key and return it as PEM, memoised per
   * consultation. The PEM never leaves the browser: it is only used to build
   * the wrapped envelopes sent to `sync-consultation-keys`.
   */
  async loadConsultationPrivatePem(
    consultation: Consultation,
    userId: number,
  ): Promise<string | null> {
    if (!consultation?.is_encrypted) {
      return null;
    }
    const cached = this.pemCache.get(consultation.id);
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
    this.pemCache.set(consultation.id, consultPrivPem);
    return consultPrivPem;
  }

  /**
   * Wrap the consultation private key for every participant who can access
   * the chat but has no ConsultationKey row yet. Returns the envelopes to
   * POST to `sync-consultation-keys`; participants without a published
   * public key are skipped (they get their envelope once they have one).
   */
  async buildParticipantEnvelopes(
    participants: Participant[],
    consultationPrivatePem: string,
  ): Promise<ConsultationKeyInput[]> {
    const privateKeyBytes = new TextEncoder().encode(consultationPrivatePem);
    const seenUserIds = new Set<number>();
    const envelopes: ConsultationKeyInput[] = [];

    for (const participant of participants) {
      const userId = participant.user?.id;
      const pubkey = participant.user?.public_key;
      if (
        !userId
        || !pubkey
        || !participant.is_active
        || !participant.is_consultation_visible
        || participant.has_consultation_key
        || seenUserIds.has(userId)
      ) {
        continue;
      }
      seenUserIds.add(userId);
      try {
        const encryptedPrivate = await this.encryptionService.rsaEnvelopeEncrypt(
          privateKeyBytes,
          pubkey,
        );
        const fingerprint = participant.user?.public_key_fingerprint
          ?? await this.encryptionService.fingerprintPublicKey(pubkey);
        envelopes.push({
          user_id: userId,
          encrypted_private_key: encryptedPrivate,
          pubkey_fingerprint: fingerprint,
        });
      } catch (err) {
        console.warn(
          '[encryption] failed to wrap consultation key for participant',
          participant.id,
          err,
        );
      }
    }
    return envelopes;
  }

  forget(consultationId: number): void {
    this.cache.delete(consultationId);
    this.pemCache.delete(consultationId);
  }

  clear(): void {
    this.cache.clear();
    this.pemCache.clear();
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
        },
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
