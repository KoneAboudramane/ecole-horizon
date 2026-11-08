# Héberger la plateforme sur O2switch

O2switch est un hébergement mutualisé (cPanel) : pas de Docker. Ce dossier remplace `docker-compose.yml`, le `Caddyfile`
et le conteneur de sauvegarde. Les autres chapitres de `../DEPLOIEMENT.md` (plusieurs écoles, abonnement, double
authentification, imports…) restent valables : remplacez `docker compose exec web python manage.py …` par
`python manage.py …` lancé par SSH (voir « Commandes Django » plus bas).

**Deux adresses** : le site (ex. `ecole.mondomaine.ci`) et l'API (`api.ecole.mondomaine.ci`, obligatoirement
`api.` + l'adresse du site ; sinon, modifiez `config.js` dans le dossier du site).

Durée : environ 30 minutes.

---

## Étape 1 : sur votre PC, préparer l'envoi

Double-cliquez sur **`preparer-o2switch.bat`** (à la racine du projet). Il compile l'interface et crée
`livraison-o2switch/` :

| Archive | Destination sur O2switch |
|---|---|
| `site.zip` | dossier du site (ex. `~/ecole.mondomaine.ci`) |
| `ecole-backend.zip` | `~` (crée `~/ecole-backend`) |
| `ecole-deploy.zip` | `~` (crée `~/ecole-deploy`) |

Aucune donnée de votre PC n'est incluse (ni `.env`, ni base de test, ni photos).

## Étape 2 : dans cPanel

1. **Domaines** : créez `ecole.mondomaine.ci` et `api.ecole.mondomaine.ci` (cPanel propose les dossiers
   `~/ecole.mondomaine.ci` et `~/api.ecole.mondomaine.ci` : gardez-les). Domaine acheté ailleurs : ses DNS doivent pointer vers O2switch.
2. **SSL/TLS Status** : lancez AutoSSL pour les deux adresses (cadenas vert).
3. **Bases de données PostgreSQL** : créez la base `ecole`, l'utilisateur `ecole` (cPanel ajoute votre identifiant
   devant : `identifiant_ecole`), puis donnez **tous les droits** à l'utilisateur sur la base. Notez le mot de passe.
4. **Comptes de messagerie** : créez `ne-pas-repondre@mondomaine.ci` (liens « mot de passe oublié »).
   Son mot de passe ne doit pas commencer par `$` ni contenir d'apostrophe.
5. **Gestionnaire de fichiers** : envoyez `ecole-backend.zip` et `ecole-deploy.zip` dans le dossier personnel, et
   `site.zip` dans `~/ecole.mondomaine.ci`. Faites « Extraire » sur chacun, puis supprimez les .zip.
6. **Setup Python App** → *Create Application* :
   - Python version : **3.12** (ou la plus récente entre 3.10 et 3.13) ;
   - Application root : `ecole-backend` ;
   - Application URL : `api.ecole.mondomaine.ci` ;
   - Application startup file : `passenger_wsgi.py` ; Application Entry point : `application`.

   Après la création, si cPanel a remplacé `~/ecole-backend/passenger_wsgi.py` par le sien, ré-extrayez ce fichier depuis
   `ecole-backend.zip`.
7. **Autorisation SSH** (outil d'O2switch) : ajoutez votre adresse IP. Vous pouvez aussi utiliser le **Terminal** de cPanel.

## Étape 3 : installation (SSH ou Terminal)

```bash
sh ~/ecole-deploy/o2switch/installer.sh
```
Le script demande l'adresse du site, la base et l'e-mail, puis il :
- écrit `~/ecole-backend/.env`, avec la clé secrète et l'adresse d'administration générées, et le protège (`chmod 600`) ;
- vérifie la connexion à PostgreSQL ;
- installe les dépendances, crée les tables (et le cache partagé), copie les fichiers statiques, vérifie la configuration ;
- génère les clés des alertes sur téléphone ;
- prépare le dossier des photos et son lien, et complète le `.htaccess` de l'API ;
- crée l'administrateur de la plateforme (son mot de passe provisoire s'affiche **une seule fois**).

À la fin, il affiche l'adresse secrète de l'administration Django : **notez-la**.

## Étape 4 : vérifier

1. `https://api.ecole.mondomaine.ci/api/v1/health/` répond.
2. `https://ecole.mondomaine.ci/` affiche la page d'accueil, `http://` redirige vers `https://`.
3. `https://ecole.mondomaine.ci/plateforme.html` : connectez-vous, changez le mot de passe, ajoutez la première école.
4. E-mail : `python manage.py test_email votre.adresse@exemple.com` (voir « Commandes Django »).
5. Dans le journal de la plateforme, l'adresse IP de votre connexion doit être **la vôtre**. Si une adresse d'O2switch
   apparaît partout, signalez-le avant de changer quoi que ce soit.

## Étape 5 : sauvegardes

cPanel → **Tâches Cron** → une fois par jour (ex. 2 h 00) :
```
sh $HOME/ecole-deploy/o2switch/sauvegarde.sh >> $HOME/sauvegardes-ecole/sauvegarde.log 2>&1
```
Essai immédiat : `sh ~/ecole-deploy/o2switch/sauvegarde.sh` → « Sauvegarde OK ». Les sauvegardes (base + photos,
30 jours) sont dans `~/sauvegardes-ecole/`. Les informations de la base sont lues dans `.env` : rien d'autre à configurer.

Restauration (**remplace** les données actuelles) :
```bash
sh ~/ecole-deploy/o2switch/restaurer.sh ~/sauvegardes-ecole/ecole-AAAAMMJJ-HHMMSS.dump
```
O2switch garde aussi des copies quotidiennes (JetBackup). Téléchargez quand même une sauvegarde **hors d'O2switch**
chaque semaine, et essayez une restauration avant l'ouverture.

---

## Mettre à jour

1. Sur le PC : `preparer-o2switch.bat`.
2. **API** : envoyez `ecole-backend.zip`, extrayez-le en écrasant les fichiers. `.env` et `media` ne sont pas dans l'archive,
   ils sont donc conservés. Puis :
   ```bash
   sh ~/ecole-deploy/o2switch/mise-a-jour.sh
   ```
   (sauvegarde d'abord, puis dépendances, migrations, statiques, vérification et redémarrage.)
3. **Site** : videz `~/ecole.mondomaine.ci` (sauf `.well-known`), envoyez `site.zip` et extrayez-le.
   `config.js` et `.htaccess` sont déjà inclus.

## Commandes Django

```bash
source ~/virtualenv/ecole-backend/3.12/bin/activate   # chemin exact affiché dans « Setup Python App »
cd ~/ecole-backend
python manage.py test_email votre.adresse@exemple.com
python manage.py create_platform_admin --username autre --name "Nom"
python manage.py reset_2fa <identifiant>
```
Après une modification de `.env` : bouton **Restart** dans « Setup Python App » (ou `touch ~/ecole-backend/tmp/restart.txt`).
Erreurs : `~/ecole-backend/stderr.log`.

## Bon à savoir

- **Mobile money** : remplissez `MOBILE_MONEY_WEBHOOK_SECRET` dans `.env` quand l'opérateur est prêt, puis Restart.
- **Cache partagé** en base (table `ecole_cache`) : captcha à usage unique et limites de débit communs à tous les processus.
- **Adresse IP** : `NUM_PROXIES=0`, car Apache sert directement l'application. L'en-tête X-Forwarded-For est ignoré.
- **Envois en arrière-plan** (alertes push) : Passenger peut arrêter un processus inactif, et un envoi peut rarement se perdre.
  Les notifications restent visibles dans l'application.
- **Fichiers déposés** (photos, devoirs) : servis par Apache sous des noms aléatoires, sans contrôle d'accès par
  utilisateur (comme avec Docker) ; aucun script ne peut s'y exécuter.
- **E-mail** : port 587 + TLS (le 465 n'est pas géré).
- **Capacité** : l'offre mutualisée convient à quelques écoles. Pour une forte charge, utilisez le déploiement Docker sur
  un VPS (`../DEPLOIEMENT.md`).

## Liste de contrôle avant ouverture

- [ ] Cadenas HTTPS sur les deux adresses ; `http://` redirige vers `https://`
- [ ] `https://ecole.mondomaine.ci/.htaccess` et `https://api.ecole.mondomaine.ci/media/` → refusés (403)
- [ ] Adresse de l'administration Django notée (elle n'est pas `/admin/`)
- [ ] `test_email` réussi ; « mot de passe oublié » reçu
- [ ] IP correcte dans le journal
- [ ] Tâche cron de sauvegarde active, une restauration essayée, une copie hors d'O2switch
- [ ] Mots de passe provisoires changés
