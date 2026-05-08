// Auto-wraps the queue private key for new QueueMembership rows on submit.
//
// Flow:
//   1. Reads encrypted_queue_private_key_master from the page (the queue's
//      master-wrapped private key, an envelope-encrypted blob).
//   2. Reads the master private CryptoKey from IndexedDB (`hcw-master-key`),
//      seeded by the Encryption admin's "Generate master key" page.
//   3. For each inline row that has a user selected but no envelope yet,
//      fetches the user's pubkey, rewraps the queue private key for them,
//      and fills the hidden envelope field. Then submits the form.
//
// Server never sees the queue private key.

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const form = document.querySelector('#queue_form');
    if (!form) return;

    function readMasterEnvelope() {
      // The field is in readonly_fields so Django/Unfold may render it as
      // a textarea, an input, a <div class="readonly">, a <pre>, or wrap
      // it in their own component. We search by name, id, class, and as a
      // last resort scan textContent for the JSON envelope shape.
      const fieldName = 'encrypted_queue_private_key_master';
      const candidates = [
        ...form.querySelectorAll('[name="' + fieldName + '"]'),
        ...form.querySelectorAll('[id$="' + fieldName + '"]'),
        ...form.querySelectorAll('.field-' + fieldName + ' .readonly'),
        ...form.querySelectorAll('.field-' + fieldName + ' textarea'),
        ...form.querySelectorAll('.field-' + fieldName + ' input'),
        ...form.querySelectorAll('.field-' + fieldName),
      ];
      for (const el of candidates) {
        const value = ('value' in el && el.value) ? el.value : el.textContent;
        if (value && value.trim().startsWith('{')) {
          return value.trim();
        }
      }
      // Last-resort fallback: scan the form for any element whose text
      // matches the envelope JSON shape ({"wrapped_key":"..."}).
      const all = form.querySelectorAll('textarea, pre, code, div, span, input');
      for (const el of all) {
        const value = ('value' in el && el.value) ? el.value : el.textContent;
        if (value && /^\s*\{\s*"wrapped_key"\s*:/.test(value)) {
          return value.trim();
        }
      }
      return null;
    }

    function bufferToBase64(buf) {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    function base64ToBuffer(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    function pemToDer(pem, label) {
      const stripped = pem
        .replace('-----BEGIN ' + label + '-----', '')
        .replace('-----END ' + label + '-----', '')
        .replace(/\s+/g, '');
      return base64ToBuffer(stripped);
    }

    async function openMasterDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('hcw-master-key', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function getMasterEntry(key) {
      const db = await openMasterDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('keys', 'readonly');
        const req = tx.objectStore('keys').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
      });
    }

    async function getMasterPrivateKey() {
      return getMasterEntry('master-private');
    }

    async function getMasterFingerprint() {
      return getMasterEntry('master-fingerprint');
    }

    function adminUrlPrefix() {
      const m = window.location.pathname.match(/^(\/[a-z]{2}(?:-[a-z]{2})?)?\/admin\//i);
      return m ? (m[1] || '') : '';
    }

    async function fetchServerMasterFingerprint() {
      const url = adminUrlPrefix() + '/admin/encryption_admin/encryptionsettings/master-fingerprint/';
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('Master fingerprint fetch failed: HTTP ' + resp.status);
      const data = await resp.json();
      return data;
    }

    async function step(label, fn) {
      try {
        return await fn();
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const wrapped = new Error('[' + label + '] ' + msg);
        wrapped.cause = err;
        throw wrapped;
      }
    }

    async function rsaEnvelopeDecrypt(blob, privateKey) {
      const data = JSON.parse(blob);
      const wrappedKey = base64ToBuffer(data.wrapped_key);
      const iv = base64ToBuffer(data.iv);
      const ciphertext = base64ToBuffer(data.ciphertext);
      const cekRaw = await step('decrypt master envelope CEK (RSA-OAEP)', () =>
        crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, wrappedKey),
      );
      const cek = await step('import master envelope CEK (AES-GCM)', () =>
        crypto.subtle.importKey('raw', cekRaw, { name: 'AES-GCM' }, false, ['decrypt']),
      );
      return step('decrypt master envelope payload (AES-GCM)', () =>
        crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cek, ciphertext),
      );
    }

    async function rsaEnvelopeEncryptForPubkey(plaintext, publicPem) {
      const der = pemToDer(publicPem, 'PUBLIC KEY');
      const pub = await step('import user pubkey (RSA-OAEP)', () =>
        crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']),
      );
      const cekRaw = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cek = await step('import per-membership CEK (AES-GCM)', () =>
        crypto.subtle.importKey('raw', cekRaw, { name: 'AES-GCM' }, false, ['encrypt']),
      );
      const ciphertext = await step('encrypt queue PEM (AES-GCM)', () =>
        crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cek, plaintext),
      );
      const wrappedKey = await step('wrap CEK for user pubkey (RSA-OAEP)', () =>
        crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, cekRaw),
      );
      return JSON.stringify({
        wrapped_key: bufferToBase64(wrappedKey),
        iv: bufferToBase64(iv.buffer),
        ciphertext: bufferToBase64(ciphertext),
      });
    }

    async function fetchUserPubkey(userId) {
      const url = adminUrlPrefix() + '/admin/encryption_admin/encryptionsettings/user-pubkey/' + userId + '/';
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('User pubkey fetch failed: HTTP ' + resp.status);
      const data = await resp.json();
      return data.public_key;
    }

    function findRowsToWrap() {
      // Pick rows where a user is selected but encrypted_queue_private_key
      // is empty. Skip empty/template rows.
      const out = [];
      const inputs = form.querySelectorAll(
        'textarea[name$="-encrypted_queue_private_key"], input[name$="-encrypted_queue_private_key"]',
      );
      inputs.forEach(envelopeInput => {
        const row = envelopeInput.closest('tr, .form-row, .inline-related');
        if (!row) return;
        if (row.classList.contains('empty-form') || /__prefix__/.test(envelopeInput.name)) return;
        const userSelect = row.querySelector('select[name$="-user"]');
        if (!userSelect || !userSelect.value) return;
        if (envelopeInput.value && envelopeInput.value.trim()) return;
        out.push({ userId: userSelect.value, envelopeInput });
      });
      return out;
    }

    let isResubmitting = false;
    form.addEventListener('submit', async function (e) {
      if (isResubmitting) return;
      const rows = findRowsToWrap();
      if (rows.length === 0) return;

      e.preventDefault();
      try {
        console.info('[encryption] queue_membership_wrap.js v2 starting');
        const masterEnvelope = readMasterEnvelope();
        if (!masterEnvelope) {
          alert(
            'Could not read the queue master envelope from the page. ' +
            'Make sure the queue has been saved and provisioning has run.',
          );
          return;
        }
        const privateKey = await getMasterPrivateKey();
        if (!privateKey) {
          alert(
            'Master private key not found in this browser. Re-generate ' +
            'the master key from /admin/encryption/.',
          );
          return;
        }

        // Fingerprint sanity check: the master pubkey on the server must
        // match the master we have in IndexedDB. Mismatch == this queue
        // was provisioned under a different master key, and decrypting
        // its master envelope is mathematically impossible from here.
        let serverFp = '';
        let browserFp = '';
        try {
          const server = await fetchServerMasterFingerprint();
          serverFp = (server && server.fingerprint) || '';
        } catch (fpErr) {
          console.warn('[encryption] could not fetch server master fingerprint', fpErr);
        }
        try {
          browserFp = (await getMasterFingerprint()) || '';
        } catch (fpErr) {
          console.warn('[encryption] could not read browser master fingerprint', fpErr);
        }
        console.info(
          '[encryption] master fingerprints — server=%s browser=%s match=%s',
          serverFp || '(unknown)',
          browserFp || '(unknown)',
          serverFp && browserFp ? serverFp === browserFp : '(cannot compare)',
        );
        if (serverFp && browserFp && serverFp !== browserFp) {
          alert(
            'Master key mismatch.\n\n' +
            'Server master fingerprint: ' + serverFp + '\n' +
            'This browser master fingerprint: ' + browserFp + '\n\n' +
            'The master keypair was regenerated since this queue was ' +
            'provisioned (or you are on a different browser/profile). ' +
            'Either restore the matching master private key in this ' +
            'browser, or re-run provisioning so the queue master ' +
            'envelope is rewrapped under the current master.',
          );
          return;
        }
        console.info('[encryption] master envelope (first 80 chars):', masterEnvelope.slice(0, 80));

        const queuePemBuffer = await rsaEnvelopeDecrypt(masterEnvelope, privateKey);
        for (const { userId, envelopeInput } of rows) {
          const userPubkey = await fetchUserPubkey(userId);
          if (!userPubkey) {
            alert('User #' + userId + ' has no public key yet (not provisioned).');
            return;
          }
          envelopeInput.value = await rsaEnvelopeEncryptForPubkey(queuePemBuffer, userPubkey);
        }
        isResubmitting = true;
        form.submit();
      } catch (err) {
        console.error('[encryption] wrap failed', err, err && err.cause);
        const msg = err && err.message ? err.message : String(err);
        const cause = err && err.cause ? '\n\nUnderlying error: ' + (err.cause.name || '') + ' — ' + (err.cause.message || err.cause) : '';
        const isMasterDecrypt = /decrypt master envelope CEK/.test(msg);
        const hint = isMasterDecrypt
          ? '\n\nLikely cause: this queue was provisioned with an OLDER ' +
            'master keypair than the one currently in use. The browser ' +
            'and server fingerprints match each other, but the queue\'s ' +
            'master envelope was wrapped with a previous master pubkey ' +
            '(no longer recoverable).\n\n' +
            'Fix: regenerate this queue\'s encryption keypair from the ' +
            'queue admin (Reset queue encryption action). Note that any ' +
            'consultations that were encrypted via this queue will lose ' +
            'their queue-based access path.'
          : '';
        alert('Wrap failed: ' + msg + cause + hint);
      }
    }, true);
  });
})();
