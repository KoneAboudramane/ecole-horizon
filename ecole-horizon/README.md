# École Horizon : interface Angular

Deux modes, un seul code :

- **Prototype simulé** (défaut, c'est la version publiée) : données fictives en mémoire, comptes de démonstration (mot de passe `demo`).
- **Mode serveur** : l'interface parle à l'API Django (`ecole-backend`). On l'active avec `?api=http://127.0.0.1:8000` dans l'adresse (mémorisé pour l'onglet), ou en définissant `window.ECOLE_API` avant le démarrage.

## Lancer en mode serveur

```bash
# Terminal 1 : l'API (dans ecole-backend)
copy .env.local.example .env
python manage.py migrate && python manage.py seed_demo   # crée aussi l'année, les matières et les classes
python manage.py runserver 127.0.0.1:8000

# Terminal 2 : l'interface
npm install && npx ng serve        # puis ouvrir http://localhost:4200/?api=http://127.0.0.1:8000
# Sous Windows, les scripts demarrer-*.bat à la racine du dossier font tout cela
```

Comptes : `secretariat`, `directeur`, `fondateur`, `enseignant`, `educateur`, `comptable`, `parent`, `eleve` (mot de passe `demo`).

## Plusieurs écoles
Quand le serveur héberge plusieurs écoles, l'écran de connexion affiche « Code de l'établissement » (mémorisé sur l'appareil, ou `?ecole=code` dans l'adresse, ou `window.ECOLE_CODE` dans `public/config.js`). `public/plateforme.html` est la page d'administration des écoles (création, suspension).

## Ce qui est relié au serveur (étapes 7 à 19)

Connexion / déconnexion (jetons gardés en mémoire uniquement : un rechargement redemande le mot de passe), profil (infos, photo, mot de passe), élèves (liste, inscription avec identifiants provisoires, import CSV, modification), classes, matières, coefficients, affectations des enseignants, comptes du personnel, paramètres de l'école ; **notes** (saisie, publication, verrouillage du trimestre), **appréciations** et avis du conseil, **bulletins**, **décisions de fin d'année**. Moyennes et rangs sont calculés par le serveur (`GET /overview/?term=T1`) : un parent ne voit que ses enfants, mais son rang est calculé sur toute la classe. **Présences** (appel, justificatifs, assiduité réelle dans les bulletins et les décisions), **discipline** (incidents, validation par la direction) et **notifications** (la cloche, rafraîchie toutes les minutes).

**Finances** : paiements (encaissement, annulation motivée, reçus numérotés), impayés et relances (notification aux familles), tarifs et échéances, rapprochement du relevé mobile money (import CSV `ref;date;mode;montant;telephone`, rattachement, alignement) et paiement en ligne par le parent. Les soldes sont calculés avec les mêmes règles que le serveur (remise fratrie comprise) et vérifiés contre `finance/students/{id}/account/`. Seul le retour signé de l’opérateur confirme un paiement ; en développement (`MOBILE_MONEY_SANDBOX=1`) le serveur peut simuler l’opérateur (un numéro finissant par 00 simule un refus).

**Tableaux de bord et statistiques** de chaque profil (direction, fondateur, secrétariat, éducateur, enseignant, comptable, famille, élève), calculés à partir des données du serveur, et **journal d’activité** tenu par le serveur (les 500 dernières entrées).

**Annonces** (publication par la direction et le secrétariat, notification des rôles visés) et **messagerie** (conversations, réponses, non lus ; un parent n’écrit qu’aux enseignants de ses enfants, à la direction et à la vie scolaire ; un message à plusieurs parents crée une conversation par famille ; rafraîchie chaque minute).

**Emploi du temps** (consultation par classe ou par enseignant, modification d’un créneau avec détection des doubles réservations d’enseignant et de salle, régénération automatique) et **cahier de textes** (séances et travail à faire saisis par l’enseignant affecté ; les familles sont prévenues).

**Examens blancs** (BEPC et BAC blancs : création, coefficients, saisie des notes par matière, résultats et rangs calculés par le serveur, publication aux familles ; une famille ne voit que la ligne de son enfant).

Toutes les pages de la plateforme sont désormais reliées au serveur. Le logo de l’école est enregistré sur le serveur (PNG, JPEG ou WebP, 400 Ko max) et affiché dès la page de connexion. Le déploiement est décrit dans `ecole-deploy/DEPLOIEMENT.md`.

Fichiers clés : `src/app/api.ts` (client HTTP, jetons, pagination, rafraîchissement), `src/app/api-map.ts` (conversion API → modèles de l'interface), `src/app/store.ts` (méthodes `…Async`).

---

# EcoleHorizon

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.24.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.


## Exports
Les reçus et les bulletins (un élève ou toute une classe, avec QR code de vérification) sont des PDF générés par le serveur. Les autres exports (CSV) passent par le téléchargement normal du navigateur ; dans le prototype hébergé, ils utilisent la capacité de téléchargement de l'hôte.

## Relance WhatsApp (gratuite, manuelle)
Boutons « WhatsApp » dans Impayés et sur la fiche élève : ouvrent `wa.me` avec un message pré-rempli (numéros ivoiriens à 10 chiffres → indicatif 225). L'agent clique sur « Envoyer » : aucune API payante. L'envoi automatique nécessitera l'API officielle WhatsApp Business (facturée au message).
