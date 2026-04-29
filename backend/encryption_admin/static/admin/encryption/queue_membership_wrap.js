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

    async function getMasterPrivateKey() {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('hcw-master-key', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise((resolve, reject) => {
        const tx = db.transaction('keys', 'readonly');
        const req = tx.objectStore('keys').get('master-private');
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
      });
    }

    async function rsaEnvelopeDecrypt(blob, privateKey) {
      const data = JSON.parse(blob);
      const wrappedKey = base64ToBuffer(data.wrapped_key);
      const iv = base64ToBuffer(data.iv);
      const ciphertext = base64ToBuffer(data.ciphertext);
      const cekRaw = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' }, privateKey, wrappedKey,
      );
      const cek = await crypto.subtle.importKey(
        'raw', cekRaw, { name: 'AES-GCM' }, false, ['decrypt'],
      );
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cek, ciphertext);
    }

    async function rsaEnvelopeEncryptForPubkey(plaintext, publicPem) {
      const der = pemToDer(publicPem, 'PUBLIC KEY');
      const pub = await crypto.subtle.importKey(
        'spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
      );
      const cekRaw = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cek = await crypto.subtle.importKey(
        'raw', cekRaw, { name: 'AES-GCM' }, false, ['encrypt'],
      );
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, cek, plaintext,
      );
      const wrappedKey = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' }, pub, cekRaw,
      );
      return JSON.stringify({
        wrapped_key: bufferToBase64(wrappedKey),
        iv: bufferToBase64(iv.buffer),
        ciphertext: bufferToBase64(ciphertext),
      });
    }

    async function fetchUserPubkey(userId) {
      // Preserve the i18n language prefix (e.g. /fr/) from the current URL
      // so we hit the same locale's admin and don't get redirected.
      const m = window.location.pathname.match(/^(\/[a-z]{2}(?:-[a-z]{2})?)?\/admin\//i);
      const prefix = m ? (m[1] || '') : '';
      const url = prefix + '/admin/encryption_admin/encryptionsettings/user-pubkey/' + userId + '/';
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
        console.error('[encryption] wrap failed', err);
        alert('Wrap failed: ' + err.message);
      }
    }, true);
  });
})();
