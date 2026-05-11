# Plan : Intégration mediasoup en parallèle de LiveKit

## Contexte

Le backend HCW expose une abstraction `BaseMediaserver` (`backend/mediaserver/manager/__init__.py`) qui permet de brancher plusieurs SFU. Aujourd'hui seul `livekit.py` existe. Le champ `Server.type` charge dynamiquement le module via `importlib`, donc l'ajout d'un nouveau provider ne requiert **aucune modification du modèle `Server`**.

L'objectif est d'ajouter mediasoup comme **second provider** (sélectionnable par instance `Server` en base) en s'inspirant du fonctionnement hcw-v5 (POST `/session` sur le mediasoup-server avec Basic Auth, récupération d'un token, connexion WSS).

**Pré-requis bloquant** : la logique de sélection actuelle (`Server.get_server()`) est cassée dès qu'on a > 1 serveur actif (split-brain entre participants d'une même room, recording sur le mauvais serveur). Le plan attaque donc d'abord ce fix avant l'intégration mediasoup elle-même.

## Décisions de design

1. **Cohabitation, pas remplacement** — `Server.type` détermine quel manager est utilisé. LiveKit et mediasoup peuvent coexister.
2. **Pinning par room via cache** — Le serveur choisi pour une room est mis en cache (clé `mediaserver:room:{schema}:{room_uuid}`), TTL longue (24h par défaut). Pas de migration de schéma. Cache.add() pour éviter les races sur le premier join.
3. **Signalisation** — Inchangée. Django Channels gère l'invitation d'appel. Seul le transport média change.
4. **Format de réponse uniforme** — Les managers retournent un `dict` avec `provider`, `url`, `token`, `room`. Le frontend dispatche selon `provider`.
5. **Recording mediasoup** — Hors scope v1. `supports_recording()` retourne `False` côté mediasoup ; les endpoints `start_recording`/`stop_recording` renvoient 400 si le serveur ne le supporte pas.
6. **Multi-tenant** — Identité utilisateur préfixée par le schema tenant (déjà fait côté LiveKit, à répliquer côté mediasoup).
7. **Lazy loading côté frontend** — `livekit-client` et `mediasoup-client` sont chargés dynamiquement, jamais dans le bundle initial. Prefetch idle basé sur le `primary_video_provider` du tenant.

---

## Phase 0 — Fix pré-requis : pinning serveur via cache

### 0.1 — Helper de sélection scoppé par room

**`backend/mediaserver/models.py`** — refactor de `Server.get_server` :

- Garder `get_server()` (sans argument) pour les usages "self-test" / non liés à une room (`users/views.py`), mais :
  - Scoper l'index round-robin par tenant : `cache_key = f"mediaserver:rr_index:{schema}"`.
  - Retour explicite et exception `NoMediaServerAvailable` au lieu du `None` silencieux.
  - Lire `test_connection()` mais limiter à un timeout court (3s) pour ne pas plomber le path chaud.
- Ajouter `Server.get_or_pin_for_room(room_uuid: str | UUID) -> Server` :
  1. Lire `cache.get(f"mediaserver:room:{schema}:{room_uuid}")` ; si présent et serveur toujours actif + joignable → retour.
  2. Si serveur épinglé indisponible → `cache.delete` et continuer.
  3. Sinon `_round_robin_pick()` (logique interne, ne touche pas au cache pinned).
  4. `cache.add(key, candidate.pk, timeout=settings.ROOM_SERVER_PIN_TTL)` — atomique.
  5. Si `cache.add` renvoie `False` (race), relire la clé et utiliser le serveur gagnant.
- Constante `ROOM_SERVER_PIN_TTL = 24 * 3600` dans `core/settings.py` (configurable via Constance plus tard si besoin).
- Exception `NoMediaServerAvailable(Exception)` dans `backend/mediaserver/exceptions.py` (nouveau).

### 0.2 — Substituer les call sites

**`backend/consultations/views.py`** :
- L362 `Consultation.join` : `server = Server.get_or_pin_for_room(consultation.room_uuid)`.
- L426 `Consultation.call` : idem.
- L635 `Appointment.join` : `server = Server.get_or_pin_for_room(appointment.room_uuid)`.
- L789 `start_recording` : idem avec `appointment.room_uuid`. Garantit que le serveur de la room est utilisé.
- L834 `stop_recording` : idem. Le `egress_id` reste valide car le serveur est inchangé.
- Pour les 5 sites : remplacer le bloc `if not server` actuel par un `try / except NoMediaServerAvailable → 503`.

**`backend/users/views.py`** (L518, 943, 1650) : vérifier si ce sont des self-tests / appels non liés à une room. Si oui → garder `Server.get_server()` (round-robin pur, pas de pinning nécessaire). Si l'un d'eux a une notion de room → utiliser le helper pinned.

### 0.3 — Cleanup opportuniste du pin

Ajouter aux endroits naturels de "fin de présence" :

**`backend/consultations/views.py`** :
- `Appointment.leave` (L687) : après `is_active=False`, si `appointment.participant_set.filter(is_active=True).exists() is False` → `cache.delete(f"mediaserver:room:{schema}:{appointment.room_uuid}")`.
- Sur fermeture de consultation (là où `closed_at` est set) : `cache.delete` pour `consultation.room_uuid`.

Pas d'autre cleanup obligatoire ; la TTL fait le filet de sécurité.

### 0.4 — Tests Phase 0

**`backend/mediaserver/tests.py`** (créer si absent) :
- Pinning : 2 servers actifs, 2 appels successifs à `get_or_pin_for_room(same_uuid)` → même serveur.
- Race : monkey-patch `cache.add` pour simuler `False`, vérifier qu'on retombe sur le serveur déjà gagné.
- Cache miss + serveur down : pinned PK existe mais `test_connection` lève → `cache.delete` + re-pick.
- Round-robin scoping : 2 schemas, indices indépendants.

**`backend/consultations/tests.py`** :
- 2 users joinant le même `Appointment` consécutivement → même `url` dans la réponse.
- `start_recording` puis `stop_recording` consécutifs → même serveur utilisé (assertion sur mock).

---

## Phase 1 — Backend : manager mediasoup

### 1.1 — Réponse uniformisée pour tous les managers

**`backend/mediaserver/manager/__init__.py`** :
- Changer la signature des trois méthodes abstraites pour retourner `dict` au lieu de `str` :
  ```python
  @abstractmethod
  def appointment_participant_info(self, appointment, user) -> dict:
      """Return {provider, url, token, room, ...} for participant join."""
  ```
- Ajouter méthode `supports_recording(self) -> bool` avec implémentation par défaut `return True`.

**`backend/mediaserver/manager/livekit.py`** :
- Les 3 méthodes retournent désormais :
  ```python
  return {
      "provider": "livekit",
      "url": self.server.url,
      "token": at.to_jwt(),
      "room": str(room_uuid),
  }
  ```
- `supports_recording` n'est pas surchargée (héritage `True`).

**`backend/consultations/views.py`** : les vues `join` / `call` reçoivent ce dict, **ne reconstruisent plus** `{"url": server.url, "token": ..., "room": ...}` à la main. Elles renvoient le dict tel quel (avec `provider` propagé).

### 1.2 — Nouveau manager mediasoup

**`backend/mediaserver/manager/mediasoup.py`** (nouveau) :

```python
import requests
from requests.auth import HTTPBasicAuth
import uuid
from django.db import connection
from . import BaseMediaserver

class Main(BaseMediaserver):
    name = "mediasoup"
    display_name = "MediaSoup"
    
    @staticmethod
    def _build_identity(user) -> str:
        schema = getattr(getattr(connection, "tenant", None), "schema_name", None)
        return f"{schema}:{user.pk}" if schema else str(user.pk)
    
    def _request_session(self, room_id: str, peer_id: str) -> str:
        resp = requests.post(
            f"{self.server.url.rstrip('/')}/session",
            json={"roomId": room_id, "peerId": peer_id},
            auth=HTTPBasicAuth(self.server.api_token, self.server.api_secret),
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()["token"]
    
    def _build_join_response(self, room_uuid, user) -> dict:
        room_id = str(room_uuid)
        peer_id = self._build_identity(user)
        token = self._request_session(room_id, peer_id)
        ws_url = self.server.url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")
        return {
            "provider": "mediasoup",
            "url": f"{ws_url}/?token={token}",
            "token": token,
            "room": room_id,
            "identity": peer_id,
            "displayName": user.name or user.email,
        }
    
    def test_connection(self):
        resp = requests.get(
            f"{self.server.url.rstrip('/')}/rooms-count",
            auth=HTTPBasicAuth(self.server.api_token, self.server.api_secret),
            timeout=3,
        )
        resp.raise_for_status()
        return True, resp.json()
    
    def appointment_participant_info(self, appointment, user):
        return self._build_join_response(appointment.room_uuid, user)
    
    def consultation_user_info(self, consultation, user):
        return self._build_join_response(consultation.room_uuid, user)
    
    def user_test_info(self, user):
        return self._build_join_response(uuid.uuid4(), user)
    
    def supports_recording(self):
        return False
```

### 1.3 — Recording désactivé pour mediasoup

**`backend/consultations/views.py`** dans `start_recording` (L751) et `stop_recording` (L808), avant tout traitement :

```python
if not server.instance.supports_recording():
    return Response(
        {"detail": _("Recording is not supported by the configured media server.")},
        status=status.HTTP_400_BAD_REQUEST,
    )
```

### 1.4 — Exposer le primary provider du tenant

Pour permettre le prefetch côté frontend.

**`backend/core/settings.py`** : ajouter une Constance setting `primary_video_provider` avec choix `('livekit', 'LiveKit')`, `('mediasoup', 'MediaSoup')`, défaut `livekit`.

**`backend/users/serializers.py`** (ou le serializer de `/api/me/`) : ajouter au payload :
```python
"primary_video_provider": config.primary_video_provider,
```

Optionnel mais recommandé : exposer aussi la liste des providers actifs (`Server.objects.filter(is_active=True).values_list('type', flat=True).distinct()`) pour permettre au frontend de désactiver des features (ex. bouton recording) si le primary est mediasoup.

### 1.5 — Admin

**`backend/mediaserver/admin.py`** : aucune modification. Le `type` est déjà géré par `manager.MAIN_DISPLAY_NAMES`. Vérifier que `manager/__init__.py` découvre `mediasoup.py` automatiquement (s'il fait un scan du dossier) ou ajouter manuellement à `MAIN_DISPLAY_NAMES`.

### 1.6 — Tests Phase 1

**`backend/mediaserver/tests.py`** :
- `MediasoupManagerTests` avec `responses` (lib) ou `requests-mock` pour mocker `/session` et `/rooms-count`.
- Vérifier la forme du dict retourné par `consultation_user_info`.
- Vérifier `supports_recording() is False`.
- Vérifier que `test_connection()` lève proprement en cas d'auth invalide.

**`backend/consultations/tests.py`** :
- Test paramétré : `Server` type=mediasoup mocké, `Consultation.join` → réponse contient `provider: "mediasoup"`.
- `start_recording` sur appointment dont le serveur épinglé est type=mediasoup → 400 avec message clair.

---

## Phase 2 — Frontend : lazy loading + dispatch par provider

### 2.1 — Stratégie de lazy loading

- **Imports `type-only`** des libs dans les services (`import type { Room } from 'livekit-client'`) → supprimés au build, aucun import runtime depuis le bundle principal.
- **Imports dynamiques** (`await import('livekit-client')`) à l'intérieur des méthodes `connect()` → webpack crée un chunk séparé chargé à la demande.
- **Façade `VideoCallService`** qui charge le bon service (`LivekitService` ou `MediasoupService`) via `await import()` selon le `provider` reçu du backend → ni le service ni la lib correspondante ne sont chargés tant qu'un appel n'est pas initié.
- **Prefetch idle** du provider primaire du tenant via `requestIdleCallback` après bootstrap.

### 2.2 — Practitioner

**`practitioner/package.json`** : ajouter `"mediasoup-client": "^3.7.0"`.

**`practitioner/src/app/core/services/livekit.service.ts`** : refactor pour lazy import :
- Remplacer `import { Room, RoomEvent, Track, ... } from 'livekit-client'` par `import type { ... }`.
- Dans `connect()` (~L66) : `const { Room, RoomEvent, Track } = await import('livekit-client');`.
- Vérifier que tous les types exposés publiquement (`participants$`, `localVideoTrack$`, …) ne forcent pas un import non-type. Si oui → introduire des types locaux/façade dans un fichier neutre.

**`practitioner/src/app/core/services/mediasoup.service.ts`** (nouveau) :
- Même surface API publique que `LivekitService` : `connect(config)`, `disconnect()`, `enableCamera(bool)`, `enableMicrophone(bool)`, `startScreenShare()`, `stopScreenShare()`, `participants$`, `connectionStatus$`, etc.
- Flow de connexion :
  1. Lazy import `mediasoup-client` : `const { Device } = await import('mediasoup-client');`.
  2. Ouverture WebSocket sur `config.url` (le SFU directement).
  3. RPC `getRouterRtpCapabilities` → `device.load({routerRtpCapabilities})`.
  4. RPC `createWebRtcTransport` (send + recv) → `device.createSendTransport()` / `createRecvTransport()`.
  5. Brancher `transport.on('connect')` et `transport.on('produce')` aux RPC.
  6. Pour chaque `newProducer` → `recvTransport.consume()` → exposer dans `participants$`.
- Le protocole RPC précis (méthodes, format des messages WS) sera aligné sur le mediasoup-server utilisé en hcw-v5. À documenter quand on aura les specs du serveur cible.

**`practitioner/src/app/core/services/video-call.service.ts`** (nouveau) :
- Façade injectée à la place de `LivekitService` dans les composants.
- Méthode `connect(config: VideoCallConfig)` qui regarde `config.provider` :
  ```typescript
  async connect(config: VideoCallConfig): Promise<void> {
    if (config.provider === 'livekit') {
      const { LivekitService } = await import('./livekit.service');
      this.impl = new LivekitService(/* deps */);
    } else if (config.provider === 'mediasoup') {
      const { MediasoupService } = await import('./mediasoup.service');
      this.impl = new MediasoupService(/* deps */);
    }
    return this.impl.connect(config);
  }
  ```
- Tous les observables (`participants$`, etc.) sont relayés depuis `this.impl`.
- Types `Participant`, `Track` exposés par la façade : normalisés (interface locale `{ identity, displayName, videoTrack?: MediaStreamTrack, audioTrack?: MediaStreamTrack, … }`) pour ne pas tirer `livekit-client` dans le bundle des composants.

**`practitioner/src/app/core/services/video-call-prefetch.service.ts`** (nouveau, ou intégré au `AppComponent`) :
- Au démarrage, après chargement du `/api/me/`, lit `primary_video_provider` et fait :
  ```typescript
  requestIdleCallback(() => {
    if (provider === 'livekit') {
      import('livekit-client');
    } else if (provider === 'mediasoup') {
      import('mediasoup-client');
    }
  });
  ```
- Pas de prefetch si l'utilisateur n'a aucune chance d'appeler (ex. rôle admin pur) — à raffiner selon les rôles si besoin.

**`practitioner/src/app/modules/user/components/video-consultation/video-consultation.ts`** :
- Substituer l'injection de `LivekitService` par `VideoCallService`.
- `getCallConfig()` (~L362) renvoie déjà `{url, token, room}` — ajouter `provider` au type côté frontend.
- `onJoinFromLobby` (~L379) reste identique (la façade absorbe la différence).
- `attachRemoteMedia` (~L437) : utiliser les `MediaStreamTrack` normalisés exposés par la façade au lieu de `RemoteTrack.attach()` de livekit. Si l'attache directe est trop différente, la façade peut exposer `attachVideo(identity, htmlElement)` qui fait le bon `.attach()` ou `htmlElement.srcObject = new MediaStream([track])`.

### 2.3 — Patient

Identique au practitioner :
- `patient/package.json` : ajouter `mediasoup-client`.
- `patient/src/app/core/services/mediasoup.service.ts` : même service.
- `patient/src/app/core/services/video-call.service.ts` : même façade.
- `patient/src/app/core/services/video-call-prefetch.service.ts` : même prefetch.
- Identifier le(s) composant(s) qui consomment `LivekitService` côté patient et substituer.

### 2.4 — Vérifications bundle

Après build :
- `ng build --stats-json` + `webpack-bundle-analyzer` → vérifier que `livekit-client` et `mediasoup-client` sont dans des chunks séparés et **pas** dans `main.js`.
- Vérifier la taille du `main.js` avant/après le refactor (objectif : aucun grossissement, idéalement réduction si LiveKit était déjà inclus).

### 2.5 — Tests Phase 2

- Tests unitaires Jasmine/Jest sur `VideoCallService` : dispatch vers le bon impl selon `provider`.
- Test e2e (Cypress/Playwright si présent) : appel LiveKit fonctionne comme avant. Idéalement aussi appel mediasoup.
- Vérification manuelle :
  1. Charger l'app à froid (cache vidé), DevTools onglet Network → confirmer qu'aucun chunk `livekit-client` ou `mediasoup-client` n'est téléchargé tant qu'on n'initie pas d'appel.
  2. Cliquer "Appeler" → le bon chunk est téléchargé.
  3. Avec `primary_video_provider=livekit` → après bootstrap, idle prefetch télécharge `livekit-client` (visible Network ~quelques secondes après load).

---

## Phase 3 — Documentation & déploiement

### 3.1 — Documentation

**`docs/docs/deployment/`** ou `backend/mediaserver/README.md` :
- Procédure de provisionnement d'un `Server` mediasoup (URL, api_token=user, api_secret=password).
- Prérequis SFU : endpoints `/session`, `/rooms-count`, signalisation WSS compatible.
- Choix du `primary_video_provider` via Constance.
- Limites connues : recording non supporté côté mediasoup en v1.

### 3.2 — Migration / déploiement

Pas de migration Django à proprement parler (aucun changement de schéma).

Ordre de déploiement recommandé :
1. Déployer le backend avec Phase 0 + Phase 1 (le pinning protège les déploiements existants 1-LiveKit comme N-LiveKit).
2. Déployer les frontends avec Phase 2 (provider exposé, façade en place, lazy loading actif).
3. Provisionner un `Server` mediasoup côté admin Django.
4. Tester un appel mediasoup en environnement de staging.
5. Désactiver progressivement les `Server` LiveKit si bascule globale souhaitée, sinon laisser cohabiter avec `primary_video_provider` indiquant le défaut.

---

## Points d'attention / risques

- **Protocole RPC mediasoup-client ↔ SFU** : à confirmer. Le code de hcw-v5 montre la connexion (WSS avec token en query string) mais pas le détail du protocole de signalisation côté frontend. On suppose un protocole compatible avec le mediasoup-server v5 ; à valider avec les specs de l'image Docker mediasoup déployée.
- **Types côté façade** : normaliser proprement les types `Participant`/`Track` est crucial pour que le lazy loading tienne — sinon un import `type-only` de `livekit-client` peut réintroduire la lib via le compilateur TS dans certains configs.
- **TURN servers** : `IceServersSerializer.get_ice_servers_config()` continue de servir. Les passer à `device.createSendTransport({iceServers})` côté `MediasoupService`.
- **Éviction Redis mid-call** : si le cache flush en cours d'appel, les joiners suivants peuvent être routés vers un autre serveur. Mitigé par TTL longue + persistance Redis (AOF) recommandée en prod.
- **Cache `cache.add()`** : vérifier que le backend cache configuré (Redis, Memcached) supporte bien l'opération atomique `add`. LocMem en dev oui ; Redis via django-redis oui ; DatabaseCache moins fiable sous forte charge.
- **Recording transcript** : aujourd'hui produit via egress LiveKit puis transcrit (`check_recording_ready`). Avec mediasoup, ce flow est désactivé. Documenter pour les utilisateurs métier.
- **Compat livekit-client** : si la lib expose des classes/enums utilisés dans des `@HostBinding` ou des templates Angular, le passage en `import type` peut casser certaines évaluations runtime. Vérifier au refactor.

---

## Étapes recommandées (ordre d'exécution)

1. **Phase 0** d'abord, complète et testée — débloque le multi-serveur même sans mediasoup.
2. **Phase 1.1 + 1.2** (réponse dict + manager mediasoup + adaptation views) ensemble — non-régression LiveKit à vérifier.
3. **Phase 1.3 + 1.4** (recording disable + primary provider) — petit incrément.
4. **Phase 2.2** (practitioner refactor) — gros morceau ; faire en premier sur practitioner pour valider l'architecture façade + lazy.
5. **Phase 2.3** (patient refactor) — duplique le pattern validé.
6. **Phase 3** documentation + déploiement staging.

## Vérification finale

1. 1 LiveKit actif → tous les flows existants fonctionnent (non-régression).
2. 2 LiveKit actifs → 2 users dans la même room sont sur le même serveur, recording fonctionne.
3. 1 LiveKit + 1 mediasoup actifs, `primary_video_provider=livekit` → appel sur consultation routée mediasoup fonctionne (lazy load déclenché à la connexion), appel routé LiveKit utilise le chunk déjà préfetché.
4. Bundle initial practitioner et patient : aucun import de `livekit-client` ni `mediasoup-client` (vérification via analyzer).
5. `start_recording` sur appel mediasoup → 400 + message clair.
6. Switch via admin (désactiver LiveKit, ne garder que mediasoup) → prochain appel utilise mediasoup sans redémarrage.
