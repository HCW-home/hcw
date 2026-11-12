# Variables d'environnement

Toute la configuration du backend qui doit etre connue **avant** le demarrage de Django (base de donnees, Redis, secrets, stockage) passe par des variables d'environnement. Le reste — nom du site, rappels, regles de visibilite, activation de l'enregistrement, SSO — se configure a chaud depuis l'interface d'administration, voir [Options avancees](../admin/advanced-options.md).

## Ou les definir

| Deploiement | Emplacement |
|-------------|-------------|
| **Paquets Debian** | `/etc/hcw/backend.conf`, charge par systemd (`EnvironmentFile=`) pour les services `hcw`, `hcw-celery` et `hcw-scheduler` |
| **Docker Compose** | Le bloc `environment:` de chaque service dans `docker-compose.yml` |
| **Developpement** | `backend/.env`, charge automatiquement au demarrage. Copiez `backend/.env-dist` pour partir d'un modele |

Le backend charge `backend/.env` s'il existe, puis se rabat sur l'environnement du processus. Les variables definies dans l'environnement reel fonctionnent toujours, meme sans fichier `.env`.

!!! warning "Redemarrage necessaire"
    Les variables d'environnement sont lues une seule fois au demarrage du processus. Apres toute modification, redemarrez l'API, le worker Celery **et** le scheduler : ils tournent chacun dans leur propre processus et doivent partager la meme configuration.

## Django

| Variable | Defaut | Description |
|----------|--------|-------------|
| `DJANGOSECRET_KEY` | *(aucun)* | **Obligatoire.** Cle secrete utilisee pour signer les sessions, les jetons et les liens de reinitialisation de mot de passe. Generez-la avec `echo -n "votre phrase secrete" \| sha256sum`. La modifier invalide toutes les sessions actives. |
| `DEBUG` | `False` | Mettre exactement `True` pour activer le mode debug. Il bascule aussi le cache de Redis vers la memoire locale et accepte toutes les origines CORS. A ne jamais activer en production. |
| `ALLOWED_HOST` | *(aucun)* | Nom d'hote principal pour lequel le backend accepte de repondre. |
| `ALLOWED_HOSTS` | *(vide)* | Liste de noms d'hotes supplementaires separes par des virgules, ajoutes a `ALLOWED_HOST`. Utilisez `*` pour tout accepter (developpement uniquement). |
| `CSRF_TRUSTED_ORIGINS` | *(vide)* | Liste d'origines separees par des virgules, **schema inclus** (ex. `https://admin.example.com`). Necessaire pour l'administration Django derriere HTTPS. |
| `CORS_ALLOWED_ORIGINS` | *(vide)* | Liste d'origines navigateur supplementaires autorisees a appeler l'API, separees par des virgules. Les origines Capacitor des applications mobiles sont toujours autorisees. |
| `DEFAULT_TIME_ZONE` | `UTC` | Fuseau horaire applique par defaut aux nouveaux utilisateurs, ex. `Europe/Zurich`. |
| `STATIC_ROOT` | `statics` | Repertoire ou `collectstatic` ecrit les fichiers statiques. Le paquet Debian utilise `/usr/share/hcw/backend/statics/`. |
| `MEDIA_ROOT` | `upload` | Repertoire de stockage des fichiers envoyes lorsque S3 n'est pas configure. Utilisez toujours un chemin absolu : l'API et le worker Celery ne sont pas lances depuis le meme repertoire de travail. |

## Mode maintenance

Le mode maintenance fait repondre `503` a toutes les requetes HTTP sans toucher a la base de donnees ni a Redis, ce qui le rend utilisable meme si la base est indisponible.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `MAINTENANCE` | `False` | Mettre `True` pour activer le mode maintenance. |
| `MAINTENANCE_MESSAGE` | `The service is temporarily unavailable for maintenance. Please try again later.` | Message renvoye aux clients. |
| `MAINTENANCE_RETRY_AFTER` | `300` | Valeur de l'en-tete `Retry-After`, en secondes. |

## Base de donnees

PostgreSQL est obligatoire : le multi-tenancy repose sur les schemas PostgreSQL.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `DATABASE_NAME` | *(aucun)* | Nom de la base. |
| `DATABASE_USER` | *(aucun)* | Utilisateur de la base. Il doit etre proprietaire de la base pour pouvoir creer les schemas des tenants. |
| `DATABASE_PASSWORD` | *(aucun)* | Mot de passe de l'utilisateur. |
| `DATABASE_HOST` | *(aucun)* | Nom d'hote ou adresse IP du serveur. |
| `DATABASE_PORT` | *(aucun)* | Port du serveur, generalement `5432`. |

## Redis

Redis sert de broker Celery, de cache et de couche de canaux pour les WebSockets.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `REDIS_HOST` | `127.0.0.1` | Nom d'hote Redis. |
| `REDIS_PORT` | `6379` | Port Redis. |

## Messagerie

| Variable | Defaut | Description |
|----------|--------|-------------|
| `EMAIL_HOST` | *(aucun)* | Nom d'hote du serveur SMTP. |
| `EMAIL_PORT` | `25` | Port SMTP. |
| `EMAIL_HOST_USER` | *(aucun)* | Identifiant SMTP, si l'authentification est requise. |
| `EMAIL_HOST_PASSWORD` | *(aucun)* | Mot de passe SMTP. |
| `EMAIL_USE_TLS` | *(desactive)* | Active STARTTLS, typiquement sur le port 587. |
| `EMAIL_USE_SSL` | *(desactive)* | Active TLS implicite, typiquement sur le port 465. Exclusif avec `EMAIL_USE_TLS`. |
| `DEFAULT_FROM_EMAIL` | *(aucun)* | Adresse expediteur utilisee pour tous les emails sortants. |

!!! warning "Options TLS/SSL"
    `EMAIL_USE_TLS` et `EMAIL_USE_SSL` sont actives par **n'importe quelle** valeur non vide, y compris `False` ou `0`. Pour les desactiver, retirez completement la variable de la configuration.

## Authentification

| Variable | Defaut | Description |
|----------|--------|-------------|
| `ACCESS_TOKEN_LIFETIME` | `3600` | Duree de vie du jeton JWT d'acces **en minutes** (le defaut represente donc 60 heures). Mettez `60` pour une duree de vie d'une heure. |
| `REFRESH_TOKEN_LIFETIME_DAYS` | `1` | Duree de vie du jeton de rafraichissement, en jours. Ces jetons sont renouveles a chaque utilisation. |

!!! note "SSO et connexion par mot de passe"
    Les fournisseurs OpenID Connect et l'option « SSO uniquement » ne se configurent plus par variables d'environnement. Definissez-les depuis l'interface d'administration, voir [Single Sign-On](../admin/sso.md) et [Options avancees](../admin/advanced-options.md).

## Stockage des fichiers (S3)

Lorsque S3 est configure, les fichiers envoyes (pieces jointes, logos, enregistrements) sont stockes sur un service compatible S3 plutot que sur le disque local.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `S3_BUCKET_NAME` | *(aucun)* | Nom du bucket. |
| `S3_ENDPOINT_URL` | *(aucun)* | Endpoint du service, ex. `https://s3.example.com` pour MinIO ou Ceph. |
| `S3_ACCESS_KEY` | *(aucun)* | Cle d'acces. |
| `S3_SECRET_KEY` | *(aucun)* | Cle secrete. |
| `S3_REGION` | `us-east-1` | Region. |
| `S3_VERIFY` | *(active)* | Mettre exactement `false` pour ne pas verifier le certificat TLS (certificats auto-signes). |
| `S3_ADDRESSING_STYLE` | `auto` | Style d'adressage : `auto`, `path` ou `virtual`. Les deploiements MinIO et Ceph dont le bucket n'est pas un sous-domaine DNS necessitent `path`. |

!!! warning "Tout ou rien"
    `S3_BUCKET_NAME`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY` et `S3_SECRET_KEY` doivent etre definies ensemble. Une configuration partielle interrompt le demarrage avec une erreur `ImproperlyConfigured` plutot que de basculer silencieusement sur le stockage local, ce qui rendrait illisibles par un processus les fichiers ecrits par un autre.

## Enregistrement des appels

Les enregistrements sont deposes sur S3 par le serveur media. Par defaut ils reutilisent les reglages `S3_*` ci-dessus ; ne definissez les variables `LIVEKIT_S3_*` que pour les stocker sur un bucket ou un serveur different.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `LIVEKIT_S3_BUCKET_NAME` | valeur de `S3_BUCKET_NAME` | Bucket dedie aux enregistrements. |
| `LIVEKIT_S3_ENDPOINT_URL` | valeur de `S3_ENDPOINT_URL` | Endpoint dedie aux enregistrements. |
| `LIVEKIT_S3_ACCESS_KEY` | valeur de `S3_ACCESS_KEY` | Cle d'acces. |
| `LIVEKIT_S3_SECRET_KEY` | valeur de `S3_SECRET_KEY` | Cle secrete. |
| `LIVEKIT_S3_REGION` | valeur de `S3_REGION` | Region. |
| `RECORDING_CHECK_INITIAL_DELAY` | `120` | Secondes d'attente apres la fin de l'appel avant de chercher le fichier sur S3. |
| `RECORDING_CHECK_MAX_RETRIES` | `4` | Nombre de nouvelles tentatives apres la premiere verification. |
| `RECORDING_CHECK_RETRY_DELAY` | `30` | Secondes entre deux tentatives. |

L'enregistrement lui-meme s'active par tenant depuis l'interface d'administration (`ENABLE_VIDEO_RECORDING`).

## Serveurs media

| Variable | Defaut | Description |
|----------|--------|-------------|
| `ROOM_SERVER_PIN_TTL` | `86400` | Duree, en secondes, pendant laquelle l'association salle / serveur media reste en cache. Doit depasser la duree du plus long appel possible, enregistrement compris. |

Les serveurs media eux-memes se declarent depuis l'interface d'administration, voir [Serveurs media](../admin/media-servers.md).

## Transcription en direct

| Variable | Defaut | Description |
|----------|--------|-------------|
| `WHISPER_LIVE_URL` | `ws://127.0.0.1:9090` | URL WebSocket du serveur whisper-live. |
| `WHISPER_LIVE_API_KEY` | *(vide)* | Doit correspondre au `--api_key` passe au serveur whisper-live. Laisser vide pour desactiver l'authentification. |

La transcription s'active par tenant depuis l'interface d'administration (`ENABLE_LIVE_TRANSCRIPTION`).

## Notifications push

| Variable | Defaut | Description |
|----------|--------|-------------|
| `WEBPUSH_VAPID_PUBLIC_KEY` | *(aucun)* | Cle publique VAPID pour le web push navigateur. |
| `WEBPUSH_VAPID_PRIVATE_KEY` | *(aucun)* | Cle privee VAPID correspondante. |
| `WEBPUSH_VAPID_CLAIMS_EMAIL` | `mailto:admin@hcw-at-home.com` | Adresse de contact transmise au service de push, sous forme `mailto:`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | *(aucun)* | Chemin du fichier JSON de compte de service Firebase, lu par le SDK Firebase. Necessaire aux notifications des applications mobiles natives (FCM). |

## Antivirus (ClamAV)

Les fichiers envoyes ne sont analyses que si l'une de ces variables est definie. `CLAMD_SOCKET` a la priorite sur les variables TCP.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `CLAMD_SOCKET` | *(aucun)* | Chemin de la socket Unix de clamd, ex. `/var/run/clamav/clamd.ctl`. |
| `CLAMD_TCP_ADDR` | `127.0.0.1` | Nom d'hote de clamd, en connexion TCP. |
| `CLAMD_TCP_SOCKET` | `3310` | Port TCP de clamd. |

## Serveur FHIR

| Variable | Defaut | Description |
|----------|--------|-------------|
| `FHIR_SYSTEM_SCHEME` | `https` | Schema utilise dans les URL `Identifier.system` derivees. |
| `FHIR_SYSTEM_PATH` | *(vide)* | Chemin optionnel ajoute apres le domaine du tenant, ex. `/fhir`. Doit commencer par `/`. |
| `FHIR_SYSTEM_BASE_URL` | *(aucun)* | Force une URL de base canonique unique pour tous les tenants, en contournant la derivation par tenant. |
| `FHIR_DEFAULT_COUNT` | `20` | Nombre de ressources par page de Bundle par defaut. |
| `FHIR_MAX_COUNT` | `100` | Borne superieure du parametre de recherche `_count`. |
| `FHIR_STRICT_SEARCH` | `False` | Mettre `True` pour rejeter les parametres de recherche inconnus au lieu de les ignorer. |
| `FHIR_INCLUDE_NARRATIVE` | `True` | Inclut la narration lisible `text` dans les ressources renvoyees. |
| `FHIR_BUNDLE_TOTAL_MODE` | `accurate` | `accurate` renvoie le `total` exact dans les Bundles, `none` l'omet (moins couteux sur de gros volumes). |

Voir [Integration FHIR R4](../admin/fhir.md) pour le detail de la derivation des URL.

## Applications mobiles

| Variable | Defaut | Description |
|----------|--------|-------------|
| `MOBILE_ANDROID_PACKAGE` | `com.healthcare.patient` | Nom du paquet Android utilise pour le lien profond vers l'application native. |
| `MOBILE_ANDROID_STORE_URL` | URL Google Play du paquet par defaut | Lien vers le store propose lorsque l'application n'est pas installee. |
| `MOBILE_IOS_STORE_URL` | *(vide)* | Lien App Store. Laisser vide pour masquer la banniere iOS. |
| `IABSIS_PUBLIC_KEY_B64` | *(cle Iabsis)* | Cle publique Ed25519 en base64 servant a verifier la signature de l'instance. A ne modifier que si vous signez vos instances avec votre propre cle et distribuez une application native correspondante. |

Chaque tenant peut surcharger les valeurs `MOBILE_*` depuis l'interface d'administration.

## Conteneurs frontend

Les images patient, praticien et administration sont des conteneurs Nginx qui relaient `/api` et `/ws` vers le backend.

| Variable | Concerne | Description |
|----------|----------|-------------|
| `BACKEND_URL` | `patient`, `practitioner`, `admin` | URL interne de l'API, ex. `http://api:8000`. Substituee dans la configuration Nginx au demarrage du conteneur. |
| `TAG` | `docker compose` | Tag des images a recuperer, ex. `TAG=0.10.0 docker compose pull`. Vaut `latest` par defaut. |

## Variables obsoletes

`backend/.env-dist` liste encore quelques variables qui ne sont plus lues par le code. Elles ne sont conservees que pour la compatibilite avec les anciens fichiers de configuration et peuvent etre supprimees.

| Variable | Remplacement |
|----------|--------------|
| `USERS_VISIBILITY` | Option `USERS_VISIBILITY` dans [Options avancees](../admin/advanced-options.md) |
| `OPENID_NAME`, `OPENID_CLIENT_ID`, `OPENID_SECRET`, `OPENID_CONFIGURATION_URL` | Configuration [Single Sign-On](../admin/sso.md) dans l'interface d'administration |
| `DISABLE_PASSWORD_LOGIN` | Option `DISABLE_PASSWORD_LOGIN` dans [Options avancees](../admin/advanced-options.md) |
| `ENABLE_REGISTRATION` | Option `ENABLE_REGISTRATION` dans [Options avancees](../admin/advanced-options.md) |
| `ENCRYPTION_KEY` | Plus utilisee. Les cles de chiffrement de bout en bout sont gerees par utilisateur, voir [Chiffrement de bout en bout](../admin/encryption.md) |

## Exemple minimal

```ini
# Django
DJANGOSECRET_KEY=change-me
DEBUG=False
ALLOWED_HOST=hcw.example.com
ALLOWED_HOSTS=patient.example.com,admin.example.com
CSRF_TRUSTED_ORIGINS=https://admin.example.com
STATIC_ROOT=/usr/share/hcw/backend/statics/
MEDIA_ROOT=/var/lib/hcw/uploads
DEFAULT_TIME_ZONE=Europe/Zurich

# Base de donnees
DATABASE_NAME=hcw
DATABASE_USER=hcw
DATABASE_PASSWORD=change-me
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Messagerie
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USE_TLS=1
EMAIL_HOST_USER=hcw@example.com
EMAIL_HOST_PASSWORD=change-me
DEFAULT_FROM_EMAIL=no-reply@example.com
```
