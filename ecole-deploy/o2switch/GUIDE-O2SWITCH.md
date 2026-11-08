# Héberger la plateforme sur O2switch (depuis GitHub)

Le code est sur GitHub : **https://github.com/KoneAboudramane/ecole-horizon**. O2switch le récupère directement,
sans fichier à envoyer à la main.

| Branche GitHub | Contenu | Sur O2switch |
|---|---|---|
| `main` | API Django + scripts d'installation | `~/ecole-horizon` |
| `site-o2switch` | site compilé (créé par `publier-site.bat`) | `~/ecole-site` = dossier du site |

**Deux adresses** : le site (ex. `ecole.mondomaine.ci`) et l'API, qui doit être `api.` suivi de l'adresse du site
(`api.ecole.mondomaine.ci`).

Les autres chapitres de `../DEPLOIEMENT.md` (plusieurs écoles, abonnement, double authentification, imports…) restent
valables : remplacez `docker compose exec web python manage.py …` par `python manage.py …` (voir « Commandes Django »).

Durée : environ 30 minutes.

---

## Étape 1 : sur votre PC, publier le site

Double-cliquez sur **`publier-site.bat`** (à la racine du projet). Il compile l'interface et l'envoie sur la branche
`site-o2switch` de GitHub. À refaire chaque fois que l'interface change.

## Étape 2 : dans cPanel

1. **Bases de données PostgreSQL** : créez la base `ecole` et l'utilisateur `ecole` (cPanel ajoute votre identifiant
   devant : `identifiant_ecole`), puis **ajoutez l'utilisateur à la base avec tous les droits**. Notez le mot de passe.
2. **Comptes de messagerie** : créez `ne-pas-repondre@mondomaine.ci`. Son mot de passe ne doit pas commencer par `$`
   ni contenir d'apostrophe.
3. **Autorisation SSH** (outil d'O2switch) : ajoutez votre adresse IP. Ou utilisez le **Terminal** de cPanel.

## Étape 3 : le script de gestion (Terminal ou SSH)

Tout se fait avec **un seul script à menu**, `gerer.sh`. Pour le récupérer, une seule fois :
```bash
curl -fsSL https://raw.githubusercontent.com/KoneAboudramane/ecole-horizon/main/ecole-deploy/o2switch/gerer.sh -o ~/gerer.sh
```
Ensuite, à chaque fois : `sh ~/gerer.sh`. Menu : installer, mettre à jour, sauvegarder, restaurer, état, erreurs,
redémarrer, sauvegarde automatique, test e-mail, administrateurs. L'option **1. Installer** récupère le code
(`~/ecole-horizon`) et le site (`~/ecole-site`) depuis GitHub, même si cPanel a déjà créé le dossier, puis lance
l'installation (étape 6).

## Étape 4 : les deux adresses (cPanel → Domaines)

1. **Créer un domaine** `ecole.mondomaine.ci` → racine du document : **`ecole-site`**
   (décochez « partager la racine » si cPanel le propose).
2. **Créer un domaine** `api.ecole.mondomaine.ci` → racine du document : **`api.ecole.mondomaine.ci`** (valeur proposée).
3. **SSL/TLS Status** : lancez AutoSSL pour les deux adresses (cadenas vert).

Domaine acheté ailleurs qu'O2switch : ses DNS doivent pointer vers O2switch.

## Étape 5 : l'application Python (cPanel → Setup Python App → Create Application)

- Python version : **3.12** (ou la plus récente entre 3.10 et 3.13) ;
- Application root : **`ecole-horizon`** (`ecole-horizon/ecole-backend` fonctionne aussi) ;
- Application URL : **`api.ecole.mondomaine.ci`** ;
- Application startup file : **`passenger_wsgi.py`** ; Application Entry point : **`application`**.

Cliquez **Create**. Si cPanel réécrit `passenger_wsgi.py`, l'installateur le remet automatiquement.

## Étape 6 : installation (Terminal ou SSH)

`sh ~/gerer.sh` → **1. Installer**. Le script demande l'adresse du site, la base et l'e-mail, puis il :
- écrit `ecole-backend/.env`, avec la clé secrète et l'adresse d'administration générées, et le protège ;
- vérifie la connexion à PostgreSQL ;
- installe les dépendances, crée les tables (et le cache partagé), copie les fichiers statiques et vérifie la configuration ;
- génère les clés des alertes sur téléphone ;
- prépare le dossier des photos et complète le `.htaccess` de l'API ;
- crée l'administrateur de la plateforme (son mot de passe provisoire s'affiche **une seule fois**).

À la fin, il affiche l'adresse secrète de l'administration Django : **notez-la**.

## Étape 7 : vérifier

1. `https://api.ecole.mondomaine.ci/api/v1/health/` répond.
2. `https://ecole.mondomaine.ci/` affiche la page d'accueil, et `http://` redirige vers `https://`.
3. `https://ecole.mondomaine.ci/plateforme.html` : connectez-vous, changez le mot de passe, ajoutez la première école.
4. E-mail : `python manage.py test_email votre.adresse@exemple.com` (voir « Commandes Django »).
5. Dans le journal de la plateforme, l'adresse IP de votre connexion doit être **la vôtre**. Si une adresse d'O2switch
   apparaît partout, signalez-le avant de changer quoi que ce soit.

## Étape 8 : sauvegardes

cPanel → **Tâches Cron** → une fois par jour (ex. 2 h 00), commande :
```
sh $HOME/ecole-horizon/ecole-deploy/o2switch/sauvegarde.sh >> $HOME/sauvegardes-ecole/sauvegarde.log 2>&1
```
Essai immédiat : `sh ~/ecole-horizon/ecole-deploy/o2switch/sauvegarde.sh` → « Sauvegarde OK ».
Les sauvegardes (base + photos, 30 jours) sont dans `~/sauvegardes-ecole/`, hors de GitHub et hors du site.

Restauration (**remplace** les données actuelles) :
```bash
sh ~/ecole-horizon/ecole-deploy/o2switch/restaurer.sh ~/sauvegardes-ecole/ecole-AAAAMMJJ-HHMMSS.dump
```
O2switch garde aussi des copies quotidiennes (JetBackup). Téléchargez quand même une sauvegarde **hors d'O2switch**
chaque semaine, et essayez une restauration avant l'ouverture.

---

## Mettre à jour

1. Sur le PC : les modifications sont envoyées sur GitHub (branche `main`). Si l'interface a changé, lancez aussi
   **`publier-site.bat`**.
2. Sur O2switch :
   ```bash
   sh ~/ecole-horizon/ecole-deploy/o2switch/mise-a-jour.sh
   ```
   Le script récupère le code et le site depuis GitHub, fait une sauvegarde, met à jour les dépendances et la base, puis
   redémarre l'application. `.env`, les photos et les sauvegardes ne sont jamais dans GitHub : ils ne sont pas touchés.

## Commandes Django

```bash
source ~/virtualenv/ecole-horizon/ecole-backend/3.12/bin/activate   # chemin exact affiché dans « Setup Python App »
cd ~/ecole-horizon/ecole-backend
python manage.py test_email votre.adresse@exemple.com
python manage.py create_platform_admin --username autre --name "Nom"
python manage.py reset_2fa <identifiant>
```
Après une modification de `.env` : bouton **Restart** dans « Setup Python App ».
Erreurs : `~/ecole-horizon/ecole-backend/stderr.log`.

## Bon à savoir

- **Le dépôt est public** : n'y mettez jamais `.env`, de mot de passe ni de données d'élèves (le `.gitignore` les exclut).
- **Mobile money** : remplissez `MOBILE_MONEY_WEBHOOK_SECRET` dans `.env` quand l'opérateur est prêt, puis Restart.
- **Cache partagé** en base (table `ecole_cache`) : captcha à usage unique et limites de débit communs à tous les processus.
- **Adresse IP** : `NUM_PROXIES=0`, car Apache sert directement l'application. L'en-tête X-Forwarded-For est ignoré.
- **Envois en arrière-plan** (alertes push) : Passenger peut arrêter un processus inactif, et un envoi peut rarement se perdre.
- **Fichiers déposés** (photos, devoirs) : servis par Apache sous des noms aléatoires, sans contrôle d'accès par
  utilisateur ; aucun script ne peut s'y exécuter.
- **E-mail** : port 587 + TLS (le 465 n'est pas géré).
- **Capacité** : l'offre mutualisée convient à quelques écoles. Pour une forte charge, utilisez Docker sur un VPS
  (`../DEPLOIEMENT.md`).
- **Sans GitHub** : `preparer-o2switch.bat` produit des archives zip à envoyer à la main (`~/ecole-backend`,
  `~/ecole-deploy`, dossier du site) ; les mêmes scripts fonctionnent.

## Liste de contrôle avant ouverture

- [ ] Cadenas HTTPS sur les deux adresses ; `http://` redirige vers `https://`
- [ ] `https://ecole.mondomaine.ci/.git/config` et `https://api.ecole.mondomaine.ci/media/` → refusés (403)
- [ ] Adresse de l'administration Django notée (elle n'est pas `/admin/`)
- [ ] `test_email` réussi ; « mot de passe oublié » reçu
- [ ] IP correcte dans le journal
- [ ] Tâche cron de sauvegarde active, une restauration essayée, une copie hors d'O2switch
- [ ] Mots de passe provisoires changés
