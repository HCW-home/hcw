# Deploiement avec paquets Debian

Cette methode installe HCW@Home directement sur un serveur Debian/Ubuntu via des paquets `.deb`. Les services sont geres par systemd. C'est l'approche recommandee pour les deployements en production sur infrastructure dediee.

## Prerequis

- Debian 13 (Trixie) ou compatible
- PostgreSQL 15+
- Redis 7+
- Nginx
- 2 Go de RAM minimum

## Paquets disponibles

La solution est distribuee en trois paquets independants :

| Paquet | Contenu |
|--------|---------|
| `hcw-backend` | API Django, administration, worker Celery, scheduler |
| `hcw-practitioner` | Interface web praticien (Angular) |
| `hcw-patient` | Interface web/mobile patient (Ionic) |

## Installation

### 1. Installer les dependances systeme

```bash
apt install postgresql redis-server nginx
```

### 2. Creer la base de donnees

```bash
su postgres
createuser -P hcw
# Mettre hcw comme mot de passe
createdb -O hcw hcw
```

### 3. Installer les paquets HCW

```bash
apt install hcw-backend hcw-practitioner hcw-patient
```

L'installation cree automatiquement :

- Un utilisateur systeme `hcw`
- Le repertoire `/var/lib/hcw/` pour les uploads
- Les services systemd

### 4. Configurer le backend

Editer le fichier de configuration :

```bash
nano /etc/hcw/backend.conf
```

!!! warning "Securite"
    Generez une cle de chiffrement avec : `echo -n "votre phrase secrete" | sha256sum`

Pour la liste complete des variables, consultez la page [Docker Compose](docker-compose.md#variables-denvironnement).

### 5. Creer un tenant

HCW@Home utilise le multi-tenancy avec isolation par schema PostgreSQL. Chaque tenant possede ses propres donnees, utilisateurs et configuration. Les tenants sont crees via le shell Django.

```bash
cd /usr/share/hcw/backend
. ./venv/bin/activate
set -a ; source /etc/hcw/backend.conf
```

```bash
python manage.py create_tenant
```

* **schema name** : localhost
* **name** : localhost
* **domain** : 127.0.0.1

```bash
python manage.py tenant_command createsuperuser -s localhost
```

## Configuration Nginx

Le paquet `hcw-backend` fournit un fichier de configuration Nginx de reference. Copiez-le et adaptez-le :

```bash
cp /usr/share/hcw/nginx /etc/nginx/sites-available/hcw
ln -s /etc/nginx/sites-available/hcw /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

La configuration par defaut definit deux blocs serveur :

!!! tip "HTTPS"
    En production, ajoutez un certificat TLS. Avec Let's Encrypt : `certbot --nginx -d votre-domaine.com -d patient.votre-domaine.com`

## Mise a jour

```bash
apt update
apt install hcw-backend hcw-practitioner hcw-patient
```

Les migrations sont appliquees automatiquement au redemarrage du service `hcw`.

## Charger les donnees de test (optionnel)

```bash
cd /usr/share/hcw/backend
sudo -u hcw venv/bin/python manage.py loaddata initial/TestData.json
```
