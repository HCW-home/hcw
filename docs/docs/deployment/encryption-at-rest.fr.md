# Chiffrement au repos

HCW@Home peut chiffrer les pieces jointes des messages la ou elles sont stockees, sur le volume des uploads ou sur S3 : un disque vole, une sauvegarde qui fuit ou une copie du bucket ne les exposent plus.

!!! note "Ce n'est pas du chiffrement de bout en bout"
    Ce reglage protege les fichiers sur leur support. Le backend detient la cle et lit les fichiers comme avant, c'est pourquoi rien ne change pour les utilisateurs. Pour cacher le contenu au serveur lui-meme, voir [Chiffrement de bout en bout](../admin/encryption.md). Les deux se combinent.

## Ce qui est chiffre

| Element stocke | Au repos |
|----------------|----------|
| Pieces jointes des messages, y compris celles des messages supprimes | **Chiffrees** |
| Logos des organisations, icones des specialites, photos de profil | En clair : les frontends et les emails y renvoient directement |
| Enregistrements des appels | En clair : le serveur media les ecrit lui-meme sur S3. Comptez sur le chiffrement cote serveur du bucket |
| Contenu de la base (messages, suivis, utilisateurs) | Non couvert : chiffrez le volume de la base et ses sauvegardes |

Chaque fichier est chiffre en AES-256-GCM par blocs de 64 Kio, sous sa propre cle derivee de `BLOB_ENCRYPTION_KEY`. Les pieces jointes sont toujours telechargees a travers le backend, qui les dechiffre a la volee : aucune requete en plus, pas de ralentissement mesurable.

Sur S3, ce chiffrement complete celui du bucket (SSE-S3, SSE-KMS) plutot qu'il ne le remplace : le chiffrement cote serveur protege les disques du fournisseur, alors que la cle utilisee ici ne quitte jamais HCW@Home. Une cle d'acces qui fuit ou un bucket ouvert par erreur n'exposent donc rien non plus.

## Configuration

| Variable | Defaut | Description |
|----------|--------|-------------|
| `BLOB_ENCRYPTION` | `False` | `True` met en place le stockage chiffrant : les pieces jointes chiffrees sont dechiffrees a la lecture. |
| `BLOB_ENCRYPT_WRITES` | valeur de `BLOB_ENCRYPTION` | `False` continue d'ecrire les nouvelles pieces jointes en clair tout en lisant les chiffrees : l'etape intermediaire qui permet d'activer ou de desactiver le chiffrement sans interruption. |
| `BLOB_ENCRYPTION_KEY` | *(aucun)* | Obligatoire avec `BLOB_ENCRYPTION=True`. Au moins 32 caracteres, et differente de `DJANGOSECRET_KEY`. |
| `BLOB_ENCRYPTION_OLD_KEY` | *(aucun)* | La cle precedente, encore acceptee en lecture pendant une rotation. |

L'API, le worker Celery et le scheduler doivent tous recevoir les memes valeurs. Pour generer une cle :

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

!!! danger "Conservez la cle"
    Il n'existe aucun moyen de recuperation : les pieces jointes chiffrees avec une cle perdue sont perdues. Conservez la cle avec vos sauvegardes, mais **pas au meme endroit** que la sauvegarde des uploads, sinon une sauvegarde volee emporte sa propre cle.

## Activation

Les pieces jointes deja stockees restent en clair jusqu'a ce que `encrypt_blobs` les convertisse. La commande reecrit chaque fichier sur place, de facon atomique, et ne touche jamais a la base : elle peut etre interrompue et relancee a tout moment, les fichiers deja traites sont ignores.

1. Definissez `BLOB_ENCRYPTION=True`, `BLOB_ENCRYPT_WRITES=False` et `BLOB_ENCRYPTION_KEY`, puis redemarrez tous les processus du backend. Rien n'est encore chiffre, mais chaque processus sait deja lire un fichier chiffre.
2. Chiffrez les pieces jointes deja stockees :
    ```bash
    python manage.py encrypt_blobs
    ```
3. Passez `BLOB_ENCRYPT_WRITES=True` (ou supprimez-la), redemarrez, puis relancez `python manage.py encrypt_blobs` pour les pieces jointes envoyees entre-temps.

L'etape intermediaire compte parce que les processus redemarrent l'un apres l'autre : un processus pas encore redemarre ne saurait pas lire un fichier chiffre, donc rien n'est chiffre avant qu'ils le sachent tous.

Ou lancer la commande :

=== "Docker Compose"

    ```bash
    docker compose run --rm api python manage.py encrypt_blobs
    ```

=== "Debian"

    ```bash
    cd /usr/share/hcw/backend
    sudo -u hcw sh -c 'set -a; . /etc/hcw/backend.conf; ./venv/bin/python manage.py encrypt_blobs'
    ```

| Option | Effet |
|--------|-------|
| `--dry-run` | Liste les fichiers qui seraient convertis, sans rien modifier. |
| `--schema <nom>` | Uniquement les pieces jointes d'un tenant. |
| `--limit <n>` | S'arrete apres `n` fichiers convertis. |
| `--old-key <cle>` | Accepte aussi cette ancienne cle, pour cette execution seulement. |
| `--decrypt` | Dechiffre au contraire, pour desactiver le chiffrement. |

Un fichier que la commande ne sait pas dechiffrer (cle inconnue, fichier endommage) est signale, laisse intact, et fait terminer la commande en erreur.

## Rotation de la cle

1. Placez la cle actuelle dans `BLOB_ENCRYPTION_OLD_KEY`, une nouvelle dans `BLOB_ENCRYPTION_KEY`, redemarrez. Les nouvelles pieces jointes utilisent la nouvelle cle, les deux cles sont acceptees en lecture.
2. Lancez `python manage.py encrypt_blobs` : elle rechiffre les pieces jointes encore sous l'ancienne cle. Chaque fichier indique quelle cle l'a chiffre, une execution interrompue reprend donc la ou elle s'etait arretee.
3. Supprimez `BLOB_ENCRYPTION_OLD_KEY` et redemarrez.

## Desactivation

1. Passez `BLOB_ENCRYPT_WRITES=False`, redemarrez.
2. Dechiffrez tout :
    ```bash
    python manage.py encrypt_blobs --decrypt
    ```
3. Passez `BLOB_ENCRYPTION=False`, redemarrez.

!!! warning "Demarrer sans la cle"
    Des qu'un stockage contient un fichier chiffre, un fichier `.blob-encryption` est ecrit a sa racine. Tant qu'il existe, `manage.py migrate` et `manage.py check --database default` echouent si `BLOB_ENCRYPTION` est desactive, puisque les pieces jointes seraient alors servies chiffrees. `encrypt_blobs --decrypt` le supprime une fois tous les fichiers dechiffres.

    Avec une mauvaise `BLOB_ENCRYPTION_KEY`, les pieces jointes chiffrees sous une autre cle repondent 404 et le backend journalise `Cannot decrypt stored file ... unknown key`.

## Limites

- Convertir les fichiers deja stockes n'efface pas leurs copies anterieures : les sauvegardes et snapshots pris avant, les versions precedentes des objets sur un bucket S3 versionne, et les blocs disque qu'occupaient les fichiers en clair gardent le contenu en clair jusqu'a leur purge ou leur reecriture.
- Les noms de fichiers ne sont pas chiffres : le nom donne a l'envoi (ex. `bilan-sanguin.pdf`) reste lisible dans le chemin de stockage, de meme que la taille approximative de chaque fichier.
- Les logos, icones de specialites et photos de profil restent en clair, voir plus haut.
- Les enregistrements d'appels, la base de donnees, Redis et les journaux ne sont pas couverts par ce reglage.
