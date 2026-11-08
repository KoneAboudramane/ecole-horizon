# Déploiement en production

Pile : PostgreSQL 16 · Django (gunicorn) · Caddy (HTTPS automatique + application Angular) · sauvegarde quotidienne.

## 1. Prérequis
- Un serveur Linux (2 Go de RAM minimum) avec Docker et le plugin Compose.
- Un nom de domaine dont l'enregistrement DNS `A` pointe vers l'IP du serveur.
- Les ports 80 et 443 ouverts (Caddy obtient le certificat tout seul).

## 2. Installation
```bash
# copier ecole-backend, ecole-horizon et ecole-deploy côte à côte sur le serveur
cd ecole-deploy
cp .env.example .env
nano .env        # DOMAIN, POSTGRES_PASSWORD, SECRET_KEY, ADMIN_URL, MOBILE_MONEY_WEBHOOK_SECRET
docker compose up -d --build
```
Générer les secrets : `python3 -c "import secrets;print(secrets.token_urlsafe(60))"`.
Choisissez un `ADMIN_URL` non devinable, par exemple `gestion-k7x2/`.

## 3. Première configuration
```bash
docker compose exec web python manage.py init_school \
  --school "Nom de l'école" --director "Nom du directeur" \
  --founder "Nom du fondateur" --secretary "Nom du secrétariat"
```
Les identifiants provisoires s'affichent **une seule fois** : notez-les. Chaque compte devra changer son mot de passe à la première connexion. La commande refuse de s'exécuter si des comptes existent déjà. Ensuite, le logo, les classes, les matières et les enseignants se saisissent depuis l'interface.

## 3 bis. Plusieurs écoles sur la même plateforme
Une seule installation peut héberger plusieurs écoles, chacune avec ses propres élèves, comptes, notes, paiements, matricules (préfixe propre) et réglages. Rien n'est partagé entre écoles.

1. Créez l'administrateur de la plateforme (il gère les écoles, il ne voit aucune donnée d'école) :
```bash
docker compose exec web python manage.py create_platform_admin --username root --name "Votre nom"
```
2. Ouvrez `https://VOTRE-DOMAINE/plateforme.html`, connectez-vous (identifiant et mot de passe ci-dessus), puis « Ajouter une école » : nom, code de connexion (ex. `horizon`), préfixe des matricules, nom du directeur. Les accès provisoires de la direction s'affichent une seule fois. Équivalent en ligne de commande : `init_school --ecole horizon --school "Nom" --director "Nom" --prefix HZ`.
3. Chaque utilisateur saisit le **code de l'établissement** sur l'écran de connexion (ou ouvre `https://VOTRE-DOMAINE/?ecole=horizon`). Avec une seule école active, le champ n'apparaît pas.
4. Pour un lien dédié sans saisie du code, définissez `ECOLE_CODE=horizon` dans `.env` d'un déploiement donné : le champ disparaît.
5. Suspendre une école (bouton sur `plateforme.html`) bloque immédiatement toutes les connexions de cette école, sans effacer ses données.

### Administration de la plateforme (`plateforme.html`)
- **Tableau de bord** : écoles actives/suspendues, élèves, comptes, écoles dont la direction ne s'est pas connectée depuis 30 jours, écoles récentes.
- **Écoles** : recherche, filtre, export CSV, fiche par école (effectifs, comptes de direction, dernière connexion). Depuis la fiche : nouveau mot de passe provisoire d'un compte de direction (affiché une seule fois, sessions coupées), correction de son e-mail, désactivation/réactivation.
- **Administrateurs** : liste et ajout (e-mail obligatoire, mot de passe provisoire à changer à la première connexion). **Aucune suppression ni modification d'un administrateur depuis ce portail**, ni suppression d'école ou de compte (le serveur refuse aussi).
- **Statistiques** (uniquement ce que fait l'administration de la plateforme) : actions par jour et par type, écoles gérées (cumul sur 12 mois), comptes de direction à suivre (jamais connectés, sans e-mail, verrouillés, désactivés), sécurité de l'accès (connexions refusées ou bloquées). Aucune donnée scolaire ; chaque graphique a une vue « tableau ».
- **Journal** : connexions, créations, réinitialisations, suspensions, avec l'adresse IP.
- **Mot de passe oublié** : lien par e-mail (code « plateforme »), valable une heure, usage unique.

### Administration Django (`/admin/`, propriétaire de la plateforme)
Le **tout premier** administrateur se crée par la commande `create_platform_admin`. Ensuite, dans `/admin/` : *Administrateurs de la plateforme* (ajout, désactivation, suppression : jamais soi-même ni le dernier administrateur actif), *Établissements* (création d'une école avec son directeur : les accès provisoires s'affichent une fois), *Journal de la plateforme* (lecture seule). Changez `ADMIN_URL` en production.

Les sauvegardes couvrent toutes les écoles à la fois (une seule base). Pour restaurer une seule école, restaurez la sauvegarde dans une base temporaire et exportez ses données : à faire par un technicien.

## 4. Sauvegardes
Le service `backup` sauvegarde chaque jour à `BACKUP_HOUR` : base (`pg_dump -Fc`) et fichiers (photos), conservés `BACKUP_KEEP_DAYS` jours dans le volume `backups`.
```bash
docker compose exec backup sh /scripts/backup.sh         # sauvegarde immédiate
docker compose exec backup ls /backups                   # lister
docker compose exec backup sh /scripts/restore.sh /backups/ecole-AAAAMMJJ-HHMMSS.dump  # restaurer (remplace les données)
```
**Important** : les sauvegardes sont sur le même serveur. Copiez-les chaque semaine hors du serveur (autre machine, stockage objet, disque externe) : un serveur perdu emporte aussi ses sauvegardes. Testez une restauration au moins une fois avant l'ouverture.

## 5. Mise à jour et retour arrière
```bash
docker compose exec backup sh /scripts/backup.sh
# remplacer les dossiers par la nouvelle version, puis :
docker compose up -d --build  # les migrations s'appliquent au démarrage
```
En cas de problème : remettre l'ancienne version du code, `docker compose up -d --build`, puis la restauration si la base a été modifiée par une migration.

## 6. Paiements mobile money
Seul un webhook signé avec `MOBILE_MONEY_WEBHOOK_SECRET` confirme un paiement. Communiquez ce secret et l'URL `https://VOTRE_DOMAINE/api/v1/…/webhook/` à l'opérateur. Le mode bac à sable est interdit en production : le serveur refuse de démarrer s'il est actif.

## 6 bis. E-mail et « mot de passe oublié »

Le personnel (direction, secrétariat, enseignants, éducateurs, comptable, informatique, fondateur) peut réinitialiser seul son mot de passe : lien « Mot de passe oublié ? » sur l'écran de connexion, lien envoyé à l'adresse e-mail enregistrée par l'administration (valable 1 heure, utilisable une fois). Les parents et élèves n'ont pas ce lien : le secrétariat ou le service informatique réinitialise leur mot de passe.

1. Renseignez `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` et `DEFAULT_FROM_EMAIL` dans `.env`, puis `docker compose up -d`.
2. **Testez** avec un vrai compte : « Mot de passe oublié ? » → le message doit arriver (vérifiez les courriers indésirables).
3. L'adresse e-mail d'un membre du personnel est obligatoire à la création du compte et ne peut être modifiée que par le secrétariat ou le service informatique (pas par la personne elle-même).
4. Si l'envoi échoue, l'utilisateur voit le même message, mais le journal d'activité affiche « E-mail non envoyé ».

## 7. Liste de contrôle avant ouverture
- [ ] `SECRET_KEY` et `POSTGRES_PASSWORD` uniques et longs ; `.env` jamais publié
- [ ] `ADMIN_URL` personnalisé
- [ ] Le site s'ouvre en HTTPS, cadenas valide
- [ ] Comptes de `init_school` : mots de passe changés
- [ ] Une sauvegarde faite **et** restaurée en test
- [ ] Copie hors serveur des sauvegardes organisée
- [ ] Pare-feu : seuls 22, 80 et 443 ouverts ; connexion SSH par clé
- [ ] Mises à jour du système du serveur activées

## 8. Limites connues
- Docker/Caddy et l'obtention du certificat n'ont pas pu être testés dans l'environnement de développement : prévoir un premier essai sur un sous-domaine.
- Les photos sont servies par Caddy avec un nom aléatoire non devinable, mais sans contrôle d'accès par utilisateur.
- Le jeton de renouvellement est gardé le temps de l’onglet (sessionStorage) : recharger la page ne déconnecte pas, fermer l’onglet ou se déconnecter l’efface. Le jeton d’accès reste en mémoire.
- Le verrouillage après tentatives de connexion échouées est configuré mais n'a pas subi de test de charge.

## Page d’accueil publique

L’adresse du site (`https://votre-domaine/`) affiche d’abord une page de présentation (rôles, fonctions, mode d’emploi), intégrée à l’application. Le bouton « Se connecter » ouvre l’écran de connexion (adresse directe : `/#connexion`). Elle reprend le nom, le logo et la couleur de l’école. Cette page est commune à toutes les écoles : son nom, son logo et ses photos (6 au plus, diaporama en fond du haut de page) se règlent dans le portail de la plateforme, onglet « Page d’accueil ». Les photos sont enregistrées dans le volume `media`. `window.ECOLE_PHOTOS = ["/media/vitrine/facade.jpg"]` dans `config.js` reste possible en secours, quand l’école n’en a ajouté aucune.

## Abonnement unique

Une seule formule pour toutes les écoles (pas de forfaits). Réglages dans `plateforme.html` → Écoles → **Abonnement** (ou Django admin → Réglages de la plateforme) :

- **Montant** (FCFA) et **durée** en mois (`0` = paiement unique, sans échéance) ;
- **Délai de grâce** (7 jours par défaut) : l'accès est maintenu après l'échéance ;
- **Rappel** (30 jours par défaut) : la direction voit un bandeau dans l'application avant l'échéance et pendant la grâce.

Chaque école a sa date d'échéance. Les écoles existantes n'en ont pas (aucun blocage soudain). Dans la fiche d'une école : **Enregistrer un paiement** (renouvelle depuis l'ancienne échéance si elle n'est pas dépassée, sinon depuis aujourd'hui), **Modifier l'échéance** pour une correction. Les paiements sont conservés et ne se modifient ni ne se suppriment.

Après l'échéance + délai de grâce, connexions et requêtes de l'école sont refusées (« abonnement échu ») ; les données sont conservées et tout revient dès le paiement enregistré. Le paiement lui-même n'est pas en ligne : l'administration l'enregistre à la main.

## Double authentification (administrateurs de la plateforme)

Chaque administrateur peut l'activer lui-même : `plateforme.html` → **Sécurité** → Activer. Il ajoute la clé dans une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…), saisit le code, et reçoit 8 codes de secours à usage unique. Une fois active, le code est exigé à chaque connexion au portail **et** à l'administration Django (`/admin/`).

- Désactivation : depuis Sécurité, avec le mot de passe et un code.
- Téléphone et codes de secours perdus : un autre administrateur utilise l'action « Retirer la double authentification » (Django admin → Administrateurs de la plateforme), ou, en dernier recours, sur le serveur : `docker compose exec backend python manage.py reset_2fa <identifiant>`.
- Les comptes d'école (direction, enseignants…) ne sont pas concernés. Un code TOTP ne sert qu'une fois ; trop d'essais verrouillent le compte comme pour un mauvais mot de passe.

## Contrôle « je ne suis pas un robot »

Un petit calcul (ex. « Combien font 7 × 4 ? ») est demandé sur la connexion des écoles, la connexion du portail plateforme et « mot de passe oublié ». Il est fourni et vérifié par votre serveur : aucune clé, aucun service externe, il fonctionne hors ligne. Chaque défi est signé, expire au bout de 10 minutes, ne sert qu'une fois, et une réponse donnée en moins de 1,5 seconde est refusée.

- Actif par défaut en production ; désactivable avec `CAPTCHA_ENABLED=false` (déjà éteint en mode développement).
- Il s'ajoute au verrouillage après essais et aux limites de débit ; il ne remplace pas un service comme Cloudflare Turnstile, plus robuste face à des robots évolués.

## Vérifier l'envoi d'e-mails

Après avoir renseigné `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` (et `DEFAULT_FROM_EMAIL`) dans le fichier d'environnement :

    docker compose exec backend python manage.py test_email votre.adresse@exemple.com

La commande affiche la vraie cause en cas d'échec (mot de passe refusé, port bloqué, TLS). Les messages de « mot de passe oublié » utilisent exactement la même configuration. Pensez à regarder les courriers indésirables à la première réception.

## Import d'élèves par fichier

Page Élèves → **Importer** (secrétariat et direction) : l'école télécharge le **modèle Excel** (liste déroulante des classes de l'école), le remplit, puis choisit le fichier (.xlsx ou .csv). Le site vérifie d'abord le fichier et affiche les erreurs ligne par ligne (numéro de ligne du fichier) ; rien n'est enregistré avant la confirmation. Les lignes valides sont inscrites, les autres ignorées, les doublons jamais écrasés. Les identifiants provisoires sont affichés une seule fois (téléchargeables).

Garde-fous : 2 Mo et 2000 lignes au maximum, formules et macros jamais exécutées, classeurs piégés (« bombes ») refusés, ancien format .xls refusé avec explication, téléphone Excel sans 0 initial rétabli, import tracé dans le journal (nom du fichier, nombre de lignes). Nécessite `openpyxl` (déjà dans `requirements.txt`).

## Import de classes et de personnel par fichier

Même principe que l'import d'élèves (modèle Excel à télécharger, vérification ligne par ligne, confirmation) :

- **Classes** (page Classes → Importer) : nom, niveau, série (lycée), effectif maximum. Les classes existantes ne sont jamais modifiées.
- **Personnel** (page Comptes → Importer) : enseignants, comptable, éducateurs, secrétariat ; e-mail obligatoire et unique, identifiant généré (`prenom.nom`) s'il est vide, matières des enseignants séparées par « / ». Chacun reçoit un mot de passe provisoire affiché une seule fois. La direction, le fondateur et le service informatique ne s'importent pas : ils se créent à la main.

## Reprise des paiements déjà encaissés

Page Paiements → **Importer** (comptable) : pour qu'une école qui rejoint la plateforme en cours d'année retrouve ses soldes exacts. Colonnes : matricule, montant, date, mode, référence, note. Le fichier est contrôlé ligne par ligne, dans l'ordre des dates : matricule connu, montant entier, date passée, mode reconnu, référence jamais encaissée (la première ligne du fichier la garde) et **jamais au-delà du solde dû** par l'élève.

Chaque paiement importé reçoit un numéro de reçu, est tracé dans le journal (nom du fichier, nombre, total en FCFA) et **ne notifie personne**. Il se corrige comme les autres, en l'annulant avec motif. Réservé à la fonction « encaisser » (le secrétariat seul ne le peut pas). À faire une seule fois, au démarrage : ré-importer le même fichier est refusé (soldes et références déjà pris).
