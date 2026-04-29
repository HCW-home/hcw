# Chiffrement E2E des chats avec arbre de clés (master / queue / user)

## Context

L'attempt précédent (clé organisation unique partagée) a été abandonné parce que les users HCW peuvent appartenir à plusieurs organisations et qu'une clé orga partagée donne un accès trop large et impossible à révoquer.

Le nouveau modèle est un **arbre de clés à trois niveaux** :

```
Consultation.sym_key  (AES-GCM, par suivi)
  ├─ chiffrée pour Queue (via Queue.public_key)
  ├─ chiffrée pour owned_by (User.public_key direct)
  ├─ chiffrée pour created_by (User.public_key direct)
  ├─ chiffrée pour beneficiary (User.public_key direct)
  └─ chiffrée pour Master (recovery, Master.public_key)

Queue.private_key
  └─ chiffrée pour chaque membre via QueueMembership.encrypted_queue_private_key
  └─ chiffrée pour Master.public_key via Queue.encrypted_queue_private_key_master

User.private_key
  └─ stockée chiffrée par AES-GCM(KEK = PBKDF2(passphrase))

Master.private_key
  └─ téléchargée par l'admin Django, stockée par lui (.pem) puis importée en IndexedDB
     dans son navigateur Django admin
```

Le chiffrement est **optionnel par plateforme** (toggle constance global). S'il n'est pas activé : comportement actuel inchangé. S'il est activé : tous les nouveaux suivis sont chiffrés ; un job Celery rétroactif provisionne les clés pour tous les users et toutes les queues existantes.

## Architecture cryptographique

### Primitives
- **Asymétrique** : RSA-OAEP 4096 (WebCrypto natif, pas de dépendance JS).
- **Symétrique** : AES-GCM 256 bits.
- **KDF** (passphrase → KEK) : PBKDF2-SHA256 avec 600 000 itérations + sel aléatoire 16 bytes.
- **Fingerprint** : SHA-256 d'une clé publique PEM (32 bytes, encodé hex).

### Trois types de clés

| Clé | Génération | Stockage privé | Stockage public |
|---|---|---|---|
| **Master** | Côté admin Django (page custom dédiée) | `.pem` téléchargé + IndexedDB du navigateur de l'admin | `constance.master_public_key` (TextField global) |
| **User** | **Côté serveur** (lors du provisioning ou activation) | DB : `User.encrypted_private_key` (chiffrée par KEK dérivée de la passphrase) ; navigateur : IndexedDB après déchiffrement | `User.public_key` |
| **Queue** | **Côté serveur** (lors d'un job Celery global ou à la création d'une queue) | DB : `Queue.encrypted_queue_private_key_master` (chiffrée par master pubkey) + `QueueMembership.encrypted_queue_private_key` (chiffrée par chaque user pubkey) | `Queue.public_key` |
| **Consultation sym_key** | Côté navigateur du créateur, à la création du suivi | Jamais stockée en clair | 5 enveloppes sur `Consultation` (queue, owned_by, created_by, beneficiary, master) |

### Modèle "le serveur voit temporairement"

C'est un compromis assumé pour rester pragmatique. Trois moments où le serveur voit du clair :

1. **Provisioning d'un user** : le serveur génère la paire user, génère une passphrase aléatoire, dérive la KEK via PBKDF2, chiffre la privée, stocke. La passphrase est retournée **une seule fois** dans la réponse HTTP (à afficher à l'admin / envoyer par email au user). Jamais stockée.
2. **Provisioning d'une queue** : le serveur génère la paire queue, chiffre la privée pour la master pubkey + pour chaque user membre. La privée queue est purgée de la RAM après.
3. **Reset de passphrase** : si un user oublie sa passphrase, le serveur regénère sa paire user (la nouvelle privée chiffrée par une nouvelle passphrase). Conséquence : le user perd l'accès aux suivis chiffrés tant qu'un membre actif (practitioner ou admin via master) ne re-chiffre pas leurs sym_keys pour sa nouvelle pubkey.

Après ces trois moments, le serveur ne voit jamais plus de matière clair.

### Granularité d'accès via les enveloppes

Une `Consultation` est lisible par :
- Tout user dans la **queue** (via son enveloppe `QueueMembership.encrypted_queue_private_key` → `Queue.private_key` → `Consultation.encrypted_key_for_queue` → `sym_key`).
- Le `owned_by` (si défini), via son enveloppe directe.
- Le `created_by`, via son enveloppe directe (préservée même si `owned_by` ou `group` change).
- Le `beneficiary` (patient), via son enveloppe directe.
- L'admin (recovery), via la master key et l'enveloppe master.

Quand `Consultation.group` est null : `encrypted_key_for_queue` est null. Idem pour `owned_by` et `beneficiary` quand absents.

### Détection de désynchronisation (fingerprints)

À chaque chiffrement d'enveloppe, on stocke le fingerprint SHA-256 de la pubkey utilisée :
- `Consultation.beneficiary_pubkey_fingerprint`
- `Consultation.owned_by_pubkey_fingerprint`
- `Consultation.created_by_pubkey_fingerprint`
- `Consultation.queue_pubkey_fingerprint`

Si le fingerprint courant du destinataire diffère (perte de passphrase, rotation), un bouton "Corriger" apparaît côté frontend. Le frontend déchiffre la `sym_key` avec sa propre enveloppe, re-chiffre pour la nouvelle pubkey, met à jour l'enveloppe + le fingerprint. La master enveloppe sert de fallback : si plus aucun user actif n'a accès, l'admin Django avec la master key peut intervenir.

## Backend — modèles

### Constance — fieldset "Encryption"
Fichier : `backend/core/settings.py:761-849`. Ajout d'un fieldset `Encryption` avec :
- `encryption_enabled` (Boolean, default False) : toggle global.
- `master_public_key` (Text, default "") : PEM de la clé master, mise à jour depuis la page admin.
- `master_public_key_fingerprint` (Text, default "") : fingerprint pour affichage admin.

### `User` (`backend/users/models.py`)
Ajouts :
- `public_key` (TextField, blank/null) — PEM SPKI.
- `public_key_fingerprint` (CharField 64, blank/null) — SHA-256 hex.
- `encrypted_private_key` (TextField, blank/null) — JSON `{salt, iv, ciphertext}` (PBKDF2 + AES-GCM enveloppant la PKCS8 PEM).
- `encryption_passphrase_pending` (Boolean, default False) — marqueur "le user doit saisir sa passphrase au prochain login pour activer son IndexedDB".
- `encryption_key_lost` (Boolean, default False) — drapeau "user a oublié sa passphrase, attente de re-chiffrement par un practitioner / admin".

Migration créée. Le champ `encrypted` (déjà existant ligne 183, mais inutilisé) est renommé/réutilisé ? Non, on le laisse — il sert à autre chose. On ajoute `encryption_*` propres.

### `Queue` (`backend/consultations/models.py`)
Ajouts sur `Queue` :
- `public_key` (TextField, blank/null).
- `public_key_fingerprint` (CharField 64, blank/null).
- `encrypted_queue_private_key_master` (TextField, blank/null) — privée queue chiffrée RSA-OAEP avec la master pubkey.

**Conversion du M2M `Queue.users` en M2M explicite** avec un modèle through `QueueMembership` :
- `queue` (FK Queue, on_delete=CASCADE)
- `user` (FK User, on_delete=CASCADE)
- `encrypted_queue_private_key` (TextField, blank/null) — privée queue chiffrée RSA-OAEP avec la pubkey du user.
- `created_at` (auto_now_add)
- `unique_together` : `(queue, user)`

**Migration** : la conversion d'un M2M auto vers un M2M `through=` se fait avec `SeparateDatabaseAndState` pour préserver la table existante (la table auto s'appelle `consultations_queue_users`, on la renomme en `consultations_queuemembership` et ajoute la nouvelle colonne).

### `Consultation` (`backend/consultations/models.py`)
Ajouts :
- `is_encrypted` (Boolean, default False) — vrai pour les suivis créés après activation du chiffrement.
- `encrypted_key_for_queue` (TextField, blank/null)
- `queue_pubkey_fingerprint` (CharField 64, blank/null)
- `encrypted_key_for_owned_by` (TextField, blank/null)
- `owned_by_pubkey_fingerprint` (CharField 64, blank/null)
- `encrypted_key_for_created_by` (TextField, blank/null)
- `created_by_pubkey_fingerprint` (CharField 64, blank/null)
- `encrypted_key_for_beneficiary` (TextField, blank/null)
- `beneficiary_pubkey_fingerprint` (CharField 64, blank/null)
- `encrypted_key_for_master` (TextField, blank/null) — toujours présent quand `is_encrypted=True`, recovery.

### `Message` (`backend/consultations/models.py`)
Ajouts :
- `is_encrypted` (Boolean, default False) — par message (les messages "event" système restent en clair).
- `encrypted_attachment_metadata` (TextField, blank/null) — `file_name` + `mime_type` chiffrés ensemble par la sym_key du suivi.

Le champ `content` continue d'accepter du texte (qui sera du base64 ciphertext quand `is_encrypted=True`). L'attachement est stocké tel quel (le blob chiffré contient son IV en préfixe).

## Backend — vues, endpoints, tâches

### Page admin Django dédiée

Fichier : nouveau `backend/admin_dashboard/admin.py` (ou intégré à `users/admin.py`) — un `ModelAdmin` virtuel ou un `AdminSite.get_urls()` qui ajoute une URL custom.

Approche retenue (basée sur le pattern existant `backend/translations/admin.py`) :

1. **Nouvel app léger `encryption_admin`** ou ajout dans `users/admin.py` d'une classe `EncryptionAdminEntry(ModelAdmin)` virtuelle (sans modèle, juste pour exposer `get_urls()`).
2. La sidebar Unfold (`backend/core/settings.py` ligne ~447) ajoute :
   ```python
   {
     "title": _("Encryption"),
     "icon": "key",
     "link": reverse_lazy("admin:encryption_settings"),
     "permission": lambda request: request.user.is_superuser,
   }
   ```
3. URLs admin custom :
   - `GET /admin/encryption/` → `encryption_settings_view` : page principale (statut master, fingerprint, toggle global, statut du job de provisioning).
   - `GET /admin/encryption/generate-master/` → template avec JS qui génère RSA 4096 dans le navigateur, télécharge `master-private-key.pem`, POST la pubkey.
   - `POST /admin/encryption/generate-master/` → reçoit la pubkey, met à jour `constance.master_public_key` + `master_public_key_fingerprint`. **Si une master key précédente existait** : avertissement explicite, anciennes consultations chiffrées deviennent irrécupérables côté master (mais lisibles via les enveloppes user/queue). En pratique, on bloque le remplacement tant que `encryption_enabled=True` ET il existe des consultations chiffrées, sauf override manuel.
   - `POST /admin/encryption/enable/` → met `constance.encryption_enabled=True`, déclenche `provision_encryption_for_all` Celery task.
   - `POST /admin/encryption/disable/` → met `constance.encryption_enabled=False`. Les consultations existantes restent chiffrées et lisibles ; les nouvelles sont en clair.
4. Template : `backend/encryption_admin/templates/admin/encryption/settings.html` qui `extends "admin/base_site.html"` + `{% load i18n unfold %}`. Utilise `{% component "unfold/components/card.html" %}` pour la mise en page, ce qui garantit la sidebar et le style Unfold.
5. La vue rend avec `TemplateResponse(request, "...", {**self.admin_site.each_context(request), ...})` pour injecter le contexte Unfold (sidebar, breadcrumbs, branding).

### Nouveaux endpoints DRF

Fichier : `backend/users/views.py` (existant) + `backend/users/urls.py`.

| Méthode + Route | Description | Permission |
|---|---|---|
| `POST /api/auth/encryption/activate-passphrase/` | Le user envoie `{passphrase}`. Le serveur dérive la KEK, déchiffre `encrypted_private_key`, **renvoie le PEM PKCS8 dans la réponse** pour que le navigateur le stocke en IndexedDB. (La passphrase n'est jamais stockée.) | Authentifié |
| `POST /api/auth/encryption/change-passphrase/` | `{old_passphrase, new_passphrase}` → re-chiffre `encrypted_private_key` côté serveur. | Authentifié |
| `POST /api/auth/encryption/forgot-passphrase/` | Le user déclare avoir oublié. Le serveur regénère sa paire, génère une nouvelle passphrase, met `encryption_key_lost=True`, **retourne la nouvelle passphrase une fois**. La pubkey change → fingerprints des consultations deviennent désynchronisés → bouton "Corriger" apparaît côté practitioner. | Authentifié |
| `POST /api/auth/encryption/purge-local/` | Pas un endpoint serveur — purement frontend (juste pour la symétrie d'API : peut être un no-op qui logue). En réalité, géré côté navigateur en effaçant l'IndexedDB. | Authentifié |
| `POST /api/users/{id}/regenerate-encryption-key/` | L'admin (ou un practitioner pour son patient) demande à regénérer la paire d'un user (perte hors-flow normal). Retourne la nouvelle passphrase. | `IsAdminUser` ou `IsPractitioner` |
| `PATCH /api/consultations/{id}/` | Étendu pour accepter les 5 enveloppes + leurs fingerprints. Validation : tout changement de `beneficiary`, `owned_by` ou `group` sur un suivi `is_encrypted=True` doit fournir les enveloppes correspondantes. | `IsPractitioner` |
| `PATCH /api/queues/{id}/members/` | Lors d'un ajout de membre, le client (admin Django via JS, ou un practitioner avec accès queue) doit fournir `encrypted_queue_private_key` pour le nouveau membre. Lors d'une suppression, on supprime juste l'enveloppe (l'ex-membre garde l'accès aux suivis existants jusqu'à rotation). | `IsAdminUser` |

### Tâche Celery — provisioning rétroactif

Fichier : nouveau `backend/users/tasks.py` (extension) ou `backend/encryption_admin/tasks.py`.

```python
@app.task
def provision_encryption_for_all(master_public_key_pem: str):
    """
    Job lancé une fois quand l'admin active le chiffrement.
    Ordre :
    1. Pour chaque user actif sans public_key : génère une paire, génère une
       passphrase aléatoire, dérive la KEK, chiffre la privée, sauvegarde.
       Met `encryption_passphrase_pending=True`.
       Envoie par email au user sa passphrase ET un message "votre passphrase
       est X, ne la perdez pas, vous en aurez besoin au prochain login".
    2. Pour chaque queue : génère une paire queue, chiffre la privée pour
       master_public_key (→ Queue.encrypted_queue_private_key_master), puis
       pour chaque membre via la pubkey du membre (→ QueueMembership.
       encrypted_queue_private_key). Purge la privée queue de la RAM.
    3. Marque les vieux suivis comme `is_encrypted=False` (ils restent en clair).
       On ne migre PAS l'historique automatiquement — le practitioner peut
       déclencher un "encrypt history" plus tard si besoin (out of scope v1).
    """
```

L'envoi de passphrase par email utilise le pattern `messaging.Message` existant (cf. `backend/api/views.py:185` pour `template_system_name="your_authentication_code"`). Nouveau template `encryption_passphrase` à ajouter dans `backend/messaging/template.py`.

### Helpers crypto serveur

Fichier nouveau : `backend/core/encryption.py`.

```python
def generate_rsa_keypair() -> tuple[bytes, bytes]:
    """Retourne (private_pkcs8_pem, public_spki_pem)."""

def derive_kek(passphrase: str, salt: bytes) -> bytes:
    """PBKDF2-SHA256 600k iterations → 32 bytes."""

def encrypt_private_key_with_passphrase(private_pem: bytes, passphrase: str) -> str:
    """Retourne JSON {salt, iv, ciphertext} en base64."""

def decrypt_private_key_with_passphrase(blob: str, passphrase: str) -> bytes:
    """Réciproque."""

def fingerprint_public_key(pem: str) -> str:
    """SHA-256 hex de la pubkey PEM."""

def rsa_encrypt(plaintext: bytes, public_pem: str) -> str:
    """RSA-OAEP encrypt → base64."""

def generate_passphrase(words: int = 6) -> str:
    """Diceware-like ou alphanumeric 24 chars."""
```

Dépendance : `cryptography` (déjà dans `requirements.txt`).

## Frontend — admin Django (vanilla JS)

Templates dans `backend/encryption_admin/templates/admin/encryption/` :

- `settings.html` : page principale, affiche le statut master + toggle global. Si pas de master, bouton "Générer la clé master".
- `generate_master.html` : embed JS qui génère RSA-4096 via WebCrypto, télécharge automatiquement `master-private-key.pem`, POST la pubkey vers l'endpoint, affiche un avertissement.
- `import_master.html` : champ fichier `.pem`, JS qui lit le fichier, l'importe via WebCrypto avec `extractable=false`, le stocke dans IndexedDB du navigateur de l'admin (DB séparée `hcw-master-key`). Le serveur ne reçoit rien.
- `manage_queue_membership.html` (optionnel v2) : ajout/suppression de membre dans une queue avec re-chiffrement de la queue private key côté navigateur.

Pour la v1 stricte, on commence par : génération + activation depuis l'admin Django, et la gestion des memberships passe par le job Celery initial. Les ajouts/suppressions ultérieurs de membres se font dans l'admin Django (page custom à venir), avec import de la master key pour pouvoir déchiffrer la queue private key.

## Frontend — practitioner (Angular)

### Nouveaux services

- `EncryptionService` (`practitioner/src/app/core/services/encryption.service.ts`) : 
  - WebCrypto helpers (génération, wrap/unwrap, AES encrypt/decrypt, PBKDF2).
  - Méthodes haut niveau : `loadUserPrivateKeyFromPassphrase`, `unwrapConsultationKey`, `encryptMessage`, `decryptMessage`, `encryptAttachment`, `decryptAttachment`, `recomputeFingerprint`, `wrapForUser`, `wrapForQueue`.
- `EncryptionStorageService` (idem) : wrapper IndexedDB (DB `hcw-encryption`, store `keys`) avec `extractable=false` quand possible.

### Onboarding / first login

Fichier : `practitioner/src/app/pages/onboarding/onboarding.ts` (existant, ligne 167+ pour la finalisation).

Étape additionnelle dans l'onboarding **uniquement si** `user.encryption_passphrase_pending=true` :
- Champ "Saisissez votre passphrase de chiffrement" (avec lien "Pas reçu de passphrase ?" → contact admin).
- Submit → POST `/api/auth/encryption/activate-passphrase/` → réponse contient le PEM clair → `EncryptionService.importPrivateKeyFromPem(pem)` → IndexedDB.
- Met `encryption_passphrase_pending=false` côté serveur.
- Si la passphrase est mauvaise : message d'erreur, possibilité de réessayer ou de cliquer "J'ai oublié ma passphrase" → POST `/api/auth/encryption/forgot-passphrase/` → nouvelle passphrase affichée → l'utilisateur la saisit immédiatement pour valider le déchiffrement.

### Page profile

Fichier : `practitioner/src/app/modules/user/components/user-profile/user-profile.ts`.

Nouvelle section "Chiffrement" (sous "Calendar sync") :
- Statut "Clé chargée" (vert) si IndexedDB contient la privée du user, "Non chargée" sinon.
- Bouton "Charger ma clé" (ouvre une modale avec champ passphrase) si la clé n'est pas en local.
- Bouton "Purger ma clé locale" → confirmation → efface IndexedDB → l'utilisateur devra ressaisir sa passphrase au prochain login.
- Bouton "Changer ma passphrase" → modale `{old, new, confirm}` → POST `/api/auth/encryption/change-passphrase/`.

### Création/édition de suivi

Fichier : `practitioner/src/app/modules/user/components/consultation-form/consultation-form.ts`.

À la création d'un suivi quand `constance.encryption_enabled=true` :
1. Génère une `sym_key` AES-GCM 256 dans le navigateur.
2. Récupère les pubkeys nécessaires (queue, owned_by, beneficiary, created_by=self) via les serializers.
3. Récupère la master pubkey (exposée par `app_config`).
4. Wrap × 5 → POST `PATCH /api/consultations/{id}/` avec les 5 enveloppes + 4 fingerprints (master n'a pas besoin de fingerprint puisque jamais comparé côté frontend).
5. Si une pubkey est manquante (user sans clé) : avertissement "ce destinataire n'a pas encore activé son chiffrement, le suivi ne sera pas accessible pour lui jusqu'à activation". Le practitioner peut continuer.

À l'édition (changement de beneficiary, owned_by, group) sur un suivi `is_encrypted=true` :
1. Charge la `sym_key` actuelle via une enveloppe lisible (typiquement queue ou created_by).
2. Re-chiffre pour le nouveau destinataire (et seulement lui).
3. PATCH avec la nouvelle enveloppe + fingerprint.

### Ouverture / lecture d'un suivi

Fichier : `practitioner/src/app/modules/user/components/consultation-detail/consultation-detail.ts`.

À l'ouverture :
1. Charge la consultation (5 enveloppes + 4 fingerprints + queue pubkey + beneficiary pubkey + etc.).
2. Détermine quelle enveloppe peut être déchiffrée par le user actuel (priorité : queue si membre, owned_by, created_by).
3. Compare les fingerprints actuels (extraits des objets liés à la consultation) avec les `_pubkey_fingerprint` stockés sur la consultation. Pour chaque mismatch (typiquement beneficiary), le frontend affiche un bandeau "Le patient a une nouvelle clé. Cliquer pour resynchroniser."
4. Bouton "Corriger" → déchiffre `sym_key` avec son enveloppe propre, re-chiffre pour la nouvelle pubkey du patient, PATCH la nouvelle enveloppe + fingerprint.
5. Déchiffre les messages au fur et à mesure (loadMessages + WebSocket).

## Frontend — patient (Ionic Angular)

### Onboarding / first login

Fichier : `patient/src/app/pages/onboarding/onboarding.page.ts` (à créer si absent, sinon ajouter une étape).

Quand `user.encryption_passphrase_pending=true` :
- Champ passphrase + submit → POST `/api/auth/encryption/activate-passphrase/` → IndexedDB.
- Bouton "J'ai oublié ma passphrase" → confirmation → POST `/api/auth/encryption/forgot-passphrase/` → nouvelle passphrase affichée + saisie immédiate.

### Profile

Fichier : `patient/src/app/pages/profile/profile.page.ts`.

Ajout dans `profileMenuItems` (lignes 84–88) :
- "Chiffrement : clé chargée / non chargée" (statut visuel).
- "Charger ma clé" (modale passphrase).
- "Purger ma clé locale".
- "Changer ma passphrase".

### Chat patient (`home.page.ts`)

À l'ouverture d'un chat avec `consultation.is_encrypted=true` :
1. Unwrap `encrypted_key_for_beneficiary` avec la privée user en IndexedDB → `sym_key`.
2. Décrypte les messages au fur et à mesure.
3. À l'envoi : encrypt content + attachment + metadata.

Si la privée user n'est pas en IndexedDB (purgée ou jamais activée) → le chat affiche "Pour lire vos messages, chargez votre clé de chiffrement" + lien vers le profil.

## Fichiers critiques à modifier ou créer

### Backend
- `backend/core/encryption.py` — **nouveau** (helpers crypto serveur)
- `backend/core/settings.py:761-849` — ajout fieldset `Encryption` dans `CONSTANCE_CONFIG_FIELDSETS`
- `backend/core/settings.py:447` — ajout entrée `Encryption` dans `UNFOLD["SIDEBAR"]["navigation"]` (visible aux superusers)
- `backend/users/models.py:161` — ajouts `User.public_key`, `encrypted_private_key`, `encryption_passphrase_pending`, `encryption_key_lost`
- `backend/consultations/models.py:25-32` — ajouts `Queue.public_key`, `encrypted_queue_private_key_master`, conversion M2M en `through=QueueMembership`
- `backend/consultations/models.py` — nouveau modèle `QueueMembership`
- `backend/consultations/models.py:64-115` — ajouts sur `Consultation` (5 enveloppes + 4 fingerprints + `is_encrypted`)
- `backend/consultations/models.py:296+` — ajouts sur `Message` (`is_encrypted`, `encrypted_attachment_metadata`)
- `backend/users/views.py` — ajout `EncryptionActivatePassphraseView`, `EncryptionChangePassphraseView`, `EncryptionForgotPassphraseView`, `RegenerateUserKeyView`
- `backend/users/urls.py` — routage des 4 endpoints
- `backend/users/serializers.py` — exposer `public_key`, `public_key_fingerprint`, `encryption_passphrase_pending`, `encryption_key_lost` sur `UserDetailsSerializer`
- `backend/consultations/serializers.py` — exposer les enveloppes + fingerprints sur `ConsultationSerializer` ; exposer `public_key`, `public_key_fingerprint` sur `ConsultationUserSerializer` ; exposer `is_encrypted`, `encrypted_attachment_metadata` sur `ConsultationMessageSerializer` ; valider que les enveloppes nécessaires sont fournies lors d'un changement de beneficiary/owned_by/group
- `backend/encryption_admin/` — **nouvelle app Django** :
  - `apps.py`, `__init__.py`
  - `admin.py` — `ModelAdmin` virtuel exposant `get_urls()`
  - `views.py` — vues custom `encryption_settings_view`, `generate_master_view`, `enable_view`, `disable_view`
  - `tasks.py` — `provision_encryption_for_all` Celery task
  - `templates/admin/encryption/settings.html` — extends `admin/base_site.html`, sidebar Unfold, cards
  - `templates/admin/encryption/generate_master.html` — JS génération RSA + download + POST pubkey
- `backend/messaging/template.py` — nouveau template système `encryption_passphrase` pour l'envoi par email
- Migration Django pour : `users`, `consultations` (User, Queue + QueueMembership, Consultation, Message), `tenants`/`shared` selon le scope du toggle constance

### Frontend praticien
- `practitioner/src/app/core/services/encryption.service.ts` — **nouveau**
- `practitioner/src/app/core/services/encryption-storage.service.ts` — **nouveau**
- `practitioner/src/app/pages/onboarding/onboarding.ts` — ajout étape passphrase si `encryption_passphrase_pending`
- `practitioner/src/app/modules/user/components/user-profile/user-profile.ts` + `.html` — section "Chiffrement"
- `practitioner/src/app/modules/user/components/consultation-form/consultation-form.ts` — wrapping des 5 enveloppes à la création + re-wrapping au changement de beneficiary/owned_by/group
- `practitioner/src/app/modules/user/components/consultation-detail/consultation-detail.ts` — chargement de la sym_key, déchiffrement des messages, bandeau "Corriger" sur fingerprint mismatch
- `practitioner/src/app/core/services/consultation.service.ts` — extension de `sendConsultationMessage` avec `is_encrypted` + `encrypted_attachment_metadata`
- `practitioner/src/app/core/models/consultation.ts` — ajout des enveloppes + fingerprints + `is_encrypted` sur `Consultation` et `ConsultationMessage` ; ajout de `public_key`, `public_key_fingerprint` sur `User`

### Frontend patient
- `patient/src/app/core/services/encryption.service.ts` — **nouveau** (miroir simplifié, pas de génération de pair patient ni de wrap pour autrui)
- `patient/src/app/core/services/encryption-storage.service.ts` — **nouveau**
- `patient/src/app/pages/onboarding/onboarding.page.ts` — étape passphrase (à créer ou enrichir)
- `patient/src/app/pages/profile/profile.page.ts` + `.html` — menu chiffrement
- `patient/src/app/pages/home/home.page.ts` — déchiffrement des messages, encryption à l'envoi
- `patient/src/app/core/models/consultation.model.ts` — ajout des enveloppes + fingerprints
- `patient/src/app/core/models/user.model.ts` — ajout `public_key_fingerprint`, `encryption_passphrase_pending`, `encryption_key_lost`

## Points de réutilisation

- **Pattern admin Django custom view** : `backend/translations/admin.py` (lignes 17+) montre exactement comment ajouter une URL custom à un `ModelAdmin` avec `self.admin_site.admin_view()` et template Unfold.
- **Pattern celery task** : `backend/users/tasks.py` (lignes 20+) et `backend/consultations/tasks.py` pour `@app.task` avec retry.
- **Pattern messaging email** : `backend/api/views.py:185` pour `template_system_name`, `backend/messaging/template.py` pour ajouter un template système.
- **Pattern WebCrypto** : `practitioner/src/app/core/services/auth.ts:159` (`crypto.getRandomValues`) — déjà utilisé, pas de dépendance JS supplémentaire.
- **Pattern constance toggle** : `backend/core/settings.py:761` — fieldset existants pour ajouter `Encryption`.
- **Pattern unfold sidebar** : `backend/core/settings.py:447` — `UNFOLD["SIDEBAR"]["navigation"]` avec `permission` lambda.
- **Pattern serializers conditionnels** : `ConsultationUserSerializer` (`backend/consultations/serializers.py:120`) — déjà utilisé pour exposer un sous-ensemble user dans le contexte consultation.

## Vérification end-to-end

### Tests manuels (golden path)

1. **Activation par admin Django** :
   - Connecté en superuser, ouvrir `/admin/encryption/`. Statut "non configuré".
   - Cliquer "Générer la clé master" → fichier `.pem` téléchargé, navigateur affiche le fingerprint.
   - Recharger la page → fingerprint visible, statut "configuré". `constance.master_public_key` non vide en DB.
   - Cliquer "Activer le chiffrement" → toggle passe à on, job Celery lancé.

2. **Job Celery rétroactif** :
   - Vérifier en logs que chaque user actif a reçu une paire (`User.public_key` non null, `encrypted_private_key` non null, `encryption_passphrase_pending=True`).
   - Vérifier que chaque queue a une `Queue.public_key` et un `encrypted_queue_private_key_master`.
   - Vérifier que chaque `QueueMembership` a un `encrypted_queue_private_key`.
   - Vérifier qu'un email est arrivé à chaque user avec la passphrase.

3. **Activation côté practitioner** :
   - Practitioner se connecte, voit l'étape onboarding "Saisissez votre passphrase".
   - Saisit la passphrase reçue par email → IndexedDB peuplée → `encryption_passphrase_pending=False`.

4. **Création de suivi chiffré** :
   - Practitioner crée un suivi avec patient + queue + owned_by.
   - DB : `Consultation.is_encrypted=True`, 5 enveloppes non null, 4 fingerprints stockés.
   - Réseau : aucune `sym_key` claire transitée.

5. **Activation patient** :
   - Patient ouvre l'app, étape onboarding apparaît, saisit sa passphrase.
   - Patient ouvre le suivi → messages déchiffrés à la volée.

6. **Échange chiffré dans les deux sens** : DB confirme `Message.is_encrypted=True`, `content` est du base64 illisible, attachement chiffré sur disque.

7. **Changement de patient** :
   - Practitioner change `beneficiary_id` sur un suivi chiffré.
   - Frontend re-wrap automatique pour le nouveau patient.
   - Ancien patient n'a plus accès aux nouveaux messages (mais à l'historique pré-change si jamais déjà chargé en local).

8. **Perte de passphrase patient** :
   - Patient clique "J'ai oublié ma passphrase" → nouvelle passphrase affichée.
   - Côté practitioner, suivi affiche "Le patient a une nouvelle clé. Cliquer pour resynchroniser."
   - Click → re-wrap automatique → patient retrouve l'accès.

9. **Recovery via master** :
   - Tous les users perdent leur passphrase en même temps.
   - Admin importe sa master `.pem` dans le navigateur de l'admin Django.
   - (V2) Action "exporter la sym_key d'un suivi" pour donner à un practitioner de remplacement. V1 : le master sert de filet de sécurité documenté, l'action concrète peut être ajoutée plus tard.

### Tests automatisés
- Backend : tests unitaires des helpers `core.encryption` (round-trip wrap/unwrap, KDF déterministe avec sel fixe, fingerprint stable).
- Backend : tests d'intégration des endpoints `activate-passphrase`, `change-passphrase`, `forgot-passphrase`.
- Backend : test du job Celery `provision_encryption_for_all` (idempotence : relancer ne casse pas, ne re-génère pas les clés existantes).
- Backend : test de la validation serializer `ConsultationSerializer` (changement de beneficiary sur suivi chiffré exige nouveau `encrypted_key_for_beneficiary`).
- Frontend : test rond-trip `EncryptionService.encryptMessage` ↔ `decryptMessage`, `wrapForUser` ↔ `unwrapConsultationKey`.

### Vérifications de sécurité
- Inspecter requêtes réseau : la passphrase n'apparaît jamais dans les requêtes après l'activation initiale (sauf au moment précis de `activate-passphrase` et `change-passphrase`, où elle est dans le body POST sur HTTPS — compromis assumé).
- Inspecter requêtes : `master_private_key` ne quitte JAMAIS le navigateur de l'admin Django (uniquement download local).
- Vérifier qu'on ne peut pas requêter `GET /api/messages/{id}/attachment/` et obtenir du contenu en clair pour un message chiffré.
- WebCrypto : utiliser `extractable=false` partout où possible pour les clés stockées en IndexedDB (ne jamais exposer la privée user après `importKey`).
- Tests d'autorisation : un user qui n'a aucune enveloppe ne peut pas requêter le contenu d'une consultation (le serveur sert le ciphertext, mais on s'assure aussi que `get_queryset` ne lui rend pas visible la consultation).

## Limitations / hors-scope v1

- **Migration de l'historique** (chiffrer les vieux messages des suivis pré-activation) : pas dans v1. Les anciens messages restent en clair dans les suivis créés avant activation.
- **Gestion fine des memberships** depuis l'admin Django (ajouter/supprimer un user d'une queue post-provisioning) : v1 minimale. Les changements de membership après le job initial nécessiteront une page dédiée (peut être ajoutée en v2).
- **Rotation périodique de la queue key** : pas dans v1. La queue key reste valide tant qu'un admin ne décide pas explicitement de la régénérer (action manuelle, à scripter en v2).
- **Validation cryptographique des fingerprints côté serveur** : non. Le serveur fait confiance au client pour fournir des fingerprints corrects. Un client malveillant pourrait stocker des fingerprints faux pour confondre les autres clients — mais ça ne casse pas la confidentialité, juste l'UX.
