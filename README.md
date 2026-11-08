# Plateforme de gestion scolaire : École Horizon

Un seul dossier, trois parties :

```
ecole-plateforme/
├── ecole-backend/   Le serveur (Python, Django) : données, calculs, PDF, sécurité
├── ecole-horizon/   L'interface (Angular) : ce que voient les utilisateurs
├── ecole-deploy/    La mise en ligne (Docker, HTTPS, sauvegardes) : pour le serveur de l'école
├── demarrer-tout.bat, demarrer-serveur.bat, demarrer-interface.bat
└── README.md
```

## Tester sur votre ordinateur (Windows)

À installer une seule fois : **Python 3.12 ou plus** (cochez « Add python.exe to PATH ») et **Node.js 22 ou plus**.

1. Double-cliquez sur **`demarrer-tout.bat`**. Deux fenêtres s'ouvrent : le serveur et l'interface.
   (Vous pouvez aussi lancer `demarrer-serveur.bat` puis `demarrer-interface.bat` séparément.)
2. La première fois, l'installation prend quelques minutes. Attendez que le navigateur s'ouvre sur
   **http://localhost:4200/?api=http://127.0.0.1:8000**
3. Connectez-vous avec un compte, mot de passe **demo** : `directeur`, `secretariat`, `fondateur`, `enseignant`, `educateur`, `comptable`, `informatique`, `parent`, `eleve`.
4. **Laissez les deux fenêtres ouvertes** pendant vos tests. Pour arrêter : fermez-les.

Remarques :
- Utilisez bien `localhost:4200` dans l'adresse, et gardez le `?api=...` : c'est lui qui relie l'interface au serveur. Sans lui, vous êtes dans le prototype simulé.
- Un rechargement de page déconnecte (c'est voulu).
- Au départ il n'y a aucun élève : inscrivez-en avec `secretariat` (page Élèves), puis affectez l'enseignant à une classe (page Classes) pour tester notes et bulletins.
- Les données de test sont dans `ecole-backend\db.sqlite3`. Pour repartir de zéro, fermez le serveur et supprimez ce fichier.
- Le paiement en ligne est simulé en local (un numéro de téléphone finissant par 00 simule un refus).
- **Thème** : clair par défaut partout (application, portail plateforme, administration Django). Chaque utilisateur peut choisir Automatique, Sombre ou Nuit dans l’application.
- **Accès par e-mail** : à la création d'un compte ayant un e-mail (école, personnel, administrateur de la plateforme) et à chaque nouveau mot de passe provisoire, un message envoie l'adresse de connexion, le code de l'école, l'identifiant et le mot de passe provisoire (à changer à la première connexion). Il faut un serveur d'e-mail (`EMAIL_HOST`…, `PUBLIC_BASE_URL`) ; sinon la fiche d'accès reste la solution de secours.
- **Aide intégrée** : le bouton **?** (ou la touche `?`) en haut de chaque page explique la page, le rôle et les questions fréquentes, avec une recherche et des liens « Voir aussi ». Une visite guidée s'affiche à la première connexion de chaque utilisateur sur cet ordinateur (relançable depuis l'aide). Les textes sont dans `ecole-horizon/src/app/help-content.ts` ; l'aide du portail plateforme est dans `plateforme.html`.

## Plusieurs écoles

La plateforme peut héberger plusieurs écoles dans une seule installation : chacune a ses élèves, comptes, notes, paiements, matricules et réglages, totalement cloisonnés.

En local, essayez :
```powershell
cd ecole-backend
.venv\Scripts\python manage.py create_platform_admin --username root --name "Moi" --password MotDePasse123
.venv\Scripts\python manage.py init_school --ecole beta --school "Lycée Beta" --director "Mme Beta" --prefix BE
```
Dès qu'il y a deux écoles, l'écran de connexion demande le **code de l'établissement** (`principal` pour l'école de démonstration, `beta` pour la nouvelle). La page **http://localhost:4200/plateforme.html?api=http://127.0.0.1:8000** (code ci-dessus) permet de gérer les écoles (création, suspension, comptes de direction, abonnement), les administrateurs, les statistiques et le journal. Chaque administrateur a un espace **Mon profil** (photo, informations, mot de passe). L'administrateur principal (le premier créé, ou `create_platform_admin --principal`) valide les administrateurs invités par ses collègues et gère leurs comptes. Le formulaire « Ajouter une école » demande : école, coordonnées (e-mail de l'école obligatoire), direction (e-mail obligatoire) et, en option, fondateur, secrétariat et responsable informatique. Voir `ecole-deploy/DEPLOIEMENT.md` pour la mise en ligne.

## Recette avec l'école

Pour préparer les tests avec l'école (sur un serveur de test uniquement) :
```powershell
cd ecole-backend
.venv\Scripts\python manage.py init_school --ecole recette --school "École de recette" --director "Direction" --prefix RC
.venv\Scripts\python manage.py seed_recette --ecole recette --password UnMotDePasseDeTest --confirme-test
```
La seconde commande charge environ 80 élèves, 4 enseignants, des notes, absences et paiements fictifs, et écrit `recette-comptes.csv` (un identifiant par profil, mot de passe commun). Le guide de recette (scénarios par profil et fiche de retour) est le fichier `Guide_de_recette_v3.7.docx` (et `.pdf`).

## Lancer à la main (sans les scripts)

```powershell
# Fenêtre 1
cd ecole-backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.local.example .env
python manage.py migrate
python manage.py seed_demo --complet      # --complet : école bien remplie pour une présentation
python manage.py runserver 127.0.0.1:8000

# Fenêtre 2
cd ecole-horizon
npm install
npx ng serve
```

## Tests automatiques

```powershell
cd ecole-backend ; python -m pytest            # 385 tests du serveur
cd ecole-horizon ; npx ng test --watch=false   # 90 tests de l'interface
```

## Mise en ligne

Voir `ecole-deploy\DEPLOIEMENT.md` (serveur Linux avec Docker, nom de domaine, HTTPS automatique, sauvegardes quotidiennes).
`ecole-deploy` construit le serveur et l'interface à partir des deux autres dossiers : gardez-les côte à côte.

## Utiliser Git

```powershell
git init
git add .
git commit -m "Plateforme école Horizon"
```
Le fichier `.gitignore` exclut les secrets (`.env`), les bibliothèques installées et les données de test.

## Contrôle qualité

```powershell
cd ecole-backend
.venv\Scripts\python -m pytest -q          # tests du serveur
.venv\Scripts\python -m ruff check apps config   # imports inutiles, erreurs courantes (pip install ruff)
cd ..\ecole-horizon
npm test -- --watch=false                  # tests de l'interface
npx ng build                               # compilation de production
```

## Ce qui est propre à chaque école (v2.7)

- **Matières** : aucune liste prédéfinie. Menu « Matières et coefficients » : « Ajouter une matière » ou « Importer » (fichier Excel, modèle téléchargeable). Une matière qui a des notes ou des cours ne peut plus être supprimée.
- **Horaires de cours** : Paramètres > « Horaires de cours » (heures des créneaux, pauses, jours ouverts et nombre de créneaux par jour). Si des cours déjà placés sont touchés, la plateforme demande confirmation avant de les retirer.
- **Examens** : en plus du BEPC et du BAC, le type « Autre examen » permet un nom, des classes et des coefficients libres.
- **Périodes d'évaluation** (v2.8) : Paramètres > « Périodes d'évaluation » : trimestres, semestres ou autre découpage (1 à 6 périodes, nom et dates libres). Une période qui a déjà des évaluations ne peut pas être retirée.
- **Tranches de scolarité** (v2.8) : Finances > « Tarifs et échéances » > « Tranches de scolarité » : nombre, noms et parts relatives (1, 1, 1 = trois tranches égales ; 50, 30, 20 = la moitié à la rentrée). Les paiements déjà reçus restent comptés.
- **Passage à l'année suivante** (v2.9) : Paramètres > « Passage en classe supérieure » fixe les moyennes d'admission, de redoublement et d'exclusion de l'école. La page « Nouvelle année » (direction) propose le sort de chaque élève, permet de corriger, puis crée l'année suivante (périodes et échéances reprises, ancienne année verrouillée, solde impayé reporté). Chaque niveau peut avoir ses propres moyennes (exceptions par niveau). Le passage s’annule tant que la nouvelle année est vide. « Anciens élèves et exclus » permet de réintégrer un élève.
- **Années précédentes** (v2.9) : la page « Années précédentes » (direction, secrétariat, parents, élèves) retrouve les moyennes, décisions et bulletins PDF des années passées, avec l'effectif de l'époque. Le compte d'un élève exclu ou parti est bloqué jusqu'à sa réintégration. Sans décision déjà prise, l'assistant « Nouvelle année » propose le sort de chaque élève d'après sa moyenne.
- **Session conservée au rechargement** (v2.9) : recharger la page ne déconnecte plus et ramène à la même page ; fermer l'onglet, se déconnecter ou 20 minutes d'inactivité ferment la session.
- **Salles, répartition des enseignants, appel par cours** (v3.0) : Paramètres > « Salles » (salle principale de chaque classe, laboratoire, terrain) ; la salle se choisit en plaçant un cours, avec avertissement si elle est trop petite. La page « Répartition des enseignants » partage les classes entre plusieurs enseignants d’une même matière (charge équilibrée, maximum d’heures). L’appel suit l’emploi du temps de la classe (« Mes cours du jour »), l’emploi du temps d’un enseignant se déduit de ceux des classes, la direction organise des remplacements, et le cahier de textes propose les cours du jour et la séance précédente à reprendre.
- **Examens programmés par l’école** (v3.0) : « Notes et publication > Programmer un examen » crée une évaluation par classe et matière, confiée à l’enseignant affecté qui est prévenu et saisit les notes.
- **Coefficient d’une évaluation** (v3.1) : à la création (« Saisie des notes > Nouvelle évaluation »), l’enseignant choisit la classe, la matière et le coefficient (0,5 à 10, 1 par défaut) ; la grille de saisie s’ouvre aussitôt avec les noms des élèves. Le coefficient pondère la moyenne de la matière (serveur `grades/calc.py` et interface `engine.ts`).
- **Éducateurs et conduite** (v3.2) : la direction ou le secrétariat confie des classes à chaque éducateur (« Éducateurs et leurs classes »), qui ne gère alors que celles-ci (appel, justificatifs, discipline, conduite). Présences filtrables par classe, justificatifs « à traiter » / « traités ». La note de conduite part du maximum de l’école ; l’éducateur retire des points (règle « 3 demi-journées d’absence non justifiée = −1 » appliquée en un clic, sanctions à son appréciation) ; elle entre par défaut dans la moyenne générale (réglable dans Paramètres > Conduite) et se publie aux familles comme les notes.
- **Finance : reçus détaillés, historique, caisse** (v3.3) : avant d’encaisser, le comptable filtre les élèves par niveau, classe et situation (reste à payer, en retard, soldé). Chaque reçu indique, pour chaque échéance définie par l’école, ce qui est dû, déjà payé, réglé par ce paiement et ce qui reste, avec la prochaine échéance ; ces chiffres sont figés au moment du paiement. Un montant au-delà du solde demande confirmation et le surplus est gardé en avance, reporté sur l’année suivante avec le solde dû. Le menu « Année » de la page Paiements relit les années passées (lecture seule) ; « Relevé » donne tous les paiements d’un élève. Un reçu réimprimé porte « Duplicata » (tracé au journal). Nouvelle page « Caisse du jour » : encaissements par moyen, annulations, espèces comptées et écart expliqué. Les impayés se filtrent par classe et par échéance, avec un message WhatsApp prêt à envoyer.
- **Accès des familles et des élèves** (v3.4) : à l’inscription, le parent (identifiant : son téléphone) et l’élève (identifiant : son matricule) reçoivent un code provisoire de 6 chiffres tiré au hasard, à remettre sur la « Fiche d’accès » imprimable ; le mot de passe personnel est exigé dès la première connexion. Un accès oublié se réinitialise depuis la fiche de l’élève (« Accès à l’application »). Un mot de passe par défaut égal à l’identifiant a été écarté : il se devine.
- **Ce que voit l'élève** : emploi du temps, notes, absences. Le cahier de textes est fermé par défaut, chaque école peut l'ouvrir (Paramètres > « Ce que voit l'élève »), contrôlé aussi côté serveur.
- **Devoirs et épreuves en ligne** (v3.5) : fermé par défaut, ouvert par l'école (Paramètres). L'enseignant envoie à une classe qu'il enseigne un devoir à rendre en fichier ou une épreuve QCM / vrai-faux ; l'élève rend sa copie ou passe l'épreuve avec un chronomètre tenu par le serveur (reprise après coupure, rendu automatique, correction automatique, sorties de la page comptées : copie rendue d'office au-delà du seuil fixé par l'enseignant) ; l'enseignant voit les copies, note, reporte dans le carnet de notes ; le parent suit en lecture seule. Nécessite le serveur (absent de la démonstration).
- **Supports de cours et cours en direct** (v3.6) : même réglage de l'école que les devoirs (« Devoirs, supports de cours et épreuves en ligne »). L'enseignant publie pour une classe qu'il enseigne des liens https (5 au plus, nom du site affiché) et/ou un fichier de 5 Mo, ou programme un cours en direct (lien Meet, Zoom, Teams, WhatsApp avec début et fin). Le lien d'un cours en direct n'est transmis par le serveur aux élèves de la classe que de 15 minutes avant le début jusqu'à la fin, jamais aux parents ni aux autres classes. Nécessite le serveur.
- **Rôles et accès gérés par l'école** (v3.7) : les droits sont en base de données, par école. À la création, les rôles habituels existent ; la direction (ou la personne à qui le fondateur a confié le droit « Gérer les rôles et les droits », par exemple l'informatique) peut les renommer, changer leurs droits, en supprimer ou en créer (modèles : surveillant général, économe, censeur, secrétaire). Garde-fous : parent et élève verrouillés, pas d'escalade de droits (on n'accorde que ce qu'on possède), au moins un gestionnaire actif, journal de chaque changement. Le menu de chaque compte suit les droits de son rôle.
- **Modèle de bulletin imposé** : le modèle (classique, moderne, compact) est réglé dans les Paramètres de l'école ; parents et élèves le reçoivent toujours (le choix n'est pas proposé et le paramètre `template` est ignoré pour eux côté serveur). Seul le personnel peut essayer un autre modèle.
- **Démonstration complète** : `demarrer-serveur.bat` charge une école bien remplie (≈ 80 élèves en 4 classes, notes publiées, absences, paiements, emploi du temps, cahier de textes, devoirs et quiz, annonces, messagerie, BEPC blanc). Les comptes habituels (directeur, secretariat, fondateur, enseignant, educateur, comptable, informatique, parent, eleve ; mot de passe `demo`) sont reliés à ces données : `parent` a deux enfants, `eleve` est en 3e A. Le chargement ne se fait que si l'école n'a encore aucun élève ; pour repartir de zéro, supprimer `ecole-backend/db.sqlite3` puis relancer le script.
