# Plateforme scolaire : backend (Django)

API du collège-lycée. **Étape 1 : socle, comptes, connexion sécurisée, matrice des permissions, journal d'activité.**
Le prototype Angular (`ecole-horizon`) servira d'interface : il parlera à cette API à la place des données simulées.

## Démarrer en 5 commandes (Windows : utilisez `py` au lieu de `python3`, et `.venv\Scripts\activate`)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # puis ajustez si besoin
python manage.py migrate && python manage.py seed_demo   # comptes de démonstration + année 2026-2027, matières, coefficients, 14 classes
python manage.py runserver
```

- Documentation interactive de l'API : http://localhost:8000/api/docs/
- Administration Django : http://localhost:8000/admin/ (créez l'administrateur de la plateforme : `python manage.py create_platform_admin --username root --name Vous`)
- Comptes de démonstration (mot de passe `demo`) : `fondateur`, `directeur`, `secretariat`, `enseignant`, `educateur`, `comptable`, `informatique`, `parent`, `eleve`
- Tests : `python -m pytest` (155 tests)
- Avec Docker (PostgreSQL inclus) : `docker compose up --build`

## Ce qui est en place

| Domaine | Détail |
|---|---|
| Connexion | `POST /api/v1/auth/login/` renvoie `access` (20 min), `refresh` (1 jour, à usage unique) et le profil avec ses permissions. Message identique pour identifiant inconnu ou mauvais mot de passe. Verrouillage 15 min après 5 échecs. Limitation à 20 tentatives par minute et par adresse. |
| Session | `auth/refresh/` fait tourner le jeton, `auth/logout/` l'invalide. Un compte désactivé perd l'accès immédiatement. |
| Profil | `GET/PATCH me/` (nom, téléphone, e-mail, langue ; jamais le rôle), `me/photo/` (JPG/PNG/WebP, 2 Mo, contenu vérifié), `me/password/` (6 caractères minimum ; un mot de passe provisoire se remplace sans l'ancien). |
| Comptes (secrétariat) | `users/` liste filtrable et création du personnel (mot de passe provisoire montré une seule fois), `users/{id}/` modification, `reset-password/`, `toggle-active/`. Impossible de se désactiver ou de changer son propre rôle. |
| Permissions | `apps/core/permissions.py` : même matrice que l'interface (vérifiée par `scripts/check_perms_sync.py`). Chaque vue déclare la permission requise, le serveur ne se fie jamais à l'interface. |
| Journal | Connexions, échecs, changements de mot de passe, création et désactivation de comptes : `GET journal/` (direction, fondateur, secrétariat). Non modifiable, même depuis l'administration. |
| Organisation (`academics`) | `classes/` (groupe et cycle déduits du niveau et de la série, capacité, effectif), `subjects/`, `coefficients/` (PUT ; 0 retire la matière du groupe), `teachers/` (fiche créée automatiquement avec tout compte « enseignant »), `assignments/` (PUT : remplace ou retire, refusé si la matière n'a pas de coefficient pour ce groupe), `calendar/`, `terms/{id}/lock/` (direction). Suppression d'une classe ou d'une matière refusée tant qu'elle est utilisée. |
| Élèves et parents (`students`) | `POST students/` inscrit en **une transaction** : matricule `HZ26-0001` (compteur verrouillé), compte élève (identifiant = matricule), compte parent réutilisé par téléphone (fratrie), refus si classe complète ou doublon. Les identifiants provisoires ne sont renvoyés qu'une fois. `PATCH students/{id}/` (changement de classe avec historique d'inscription, désactivation du compte), `parents/`. |
| Périmètre de lecture | Élève : lui seul. Parent : ses enfants. Enseignant : les classes qui lui sont affectées. Secrétariat, direction, éducateur, comptable : tous. Appliqué dans `visible_students()`, jamais côté interface. |
| Import / export CSV | `POST students/import/` (colonnes `nom;prenoms;sexe;naissance;lieu;classe;parent;telephone`) : sans `?commit=1`, simple vérification avec les erreurs ligne par ligne ; avec, inscrit les lignes valides. `GET students/export/` (secrétariat, direction). |
| Notes et bulletins (`grades`) | `evaluations/` (création par l'enseignant affecté ou la direction), `evaluations/{id}/grades/` (saisie groupée, 0 à 20, `null` efface), `evaluations/publish/` (direction : tant qu'une évaluation n'est pas publiée, parents et élèves ne voient rien), `overview/?term=T1` (tout un trimestre en un appel, filtré selon le rôle : famille = ses enfants et le publié, enseignant = ses matières sans moyenne générale, direction = tout ; c'est ce qu'utilise l'interface), `results/?class=&term=`, `students/{id}/bulletin/` et `students/{id}/grades/`, `appreciations/`, `council/`, `decisions/` (avec moyenne annuelle et proposition automatique), `settings/` (poids de la composition, seuils des mentions, remise fratrie). **Moyennes, rangs et mentions sont calculés uniquement par le serveur** (`apps/grades/calc.py`, mêmes règles que le prototype). Trimestre verrouillé : seule la direction modifie, et c'est journalisé. |
| Présences (`attendance`) | `attendance/appel/`, `attendance/sessions/` (appels effectués, pour calculer l’assiduité), (GET état, PUT enregistre : l'enseignant ne fait l'appel que de ses classes, l'éducateur de toutes, jamais un jour à venir ; une correction conserve le justificatif déjà déposé), `absences/` (filtres), `absences/{id}/justify/` (famille, absences seulement, redépôt possible après refus), `absences/{id}/decide/` (éducateur, direction), `students/{id}/attendance/` (bilan). La famille est prévenue à chaque nouvelle absence. |
| Finance (`finance`) | `finance/tarifs/`, `finance/dates/`, `finance/payments/` (+ `cancel/`, `receipt/`), `finance/students/{id}/account/`, `finance/overview/`, `finance/overdue/`, `finance/reminders/` (POST `{students:[ids]}` : notifie les familles ayant un échu), `finance/statement/` (+ `import/`, `{id}/match/`, `{id}/fix/`), `finance/pay/initiate/`, `finance/pay/{ref}/` (état), `finance/pay/{ref}/sandbox-confirm/` (dev uniquement, `?fail=1` = refus), `webhooks/mobile-money/` (signé). |
| Discipline (`discipline`) | `incidents/` : éducateur et direction. Une sanction **grave** ou une **exclusion temporaire** reste « à valider » jusqu'à la décision de la direction (`incidents/{id}/decide/`) ; la famille n'est prévenue et ne voit une mesure qu'une fois validée. Le parent voit les mesures de ses enfants, l'élève non. |
| Notifications (`notifications`) | `notifications/` (les siennes seulement), `unread-count/`, `read/`. Créées par le serveur : nouvelles notes publiées, absences, justificatifs, sanctions. |
| Finance (`finance`) | Tarifs par niveau et échéances (`finance/tarifs/`, `dates/` : fondateur et comptable), échéancier d'un élève avec remise fratrie (2e enfant et suivants d'un parent, scolarité seulement) : `students/{id}/account/`. `payments/` : encaissement par le **comptable seul** (refus si le montant dépasse le solde, si la référence est déjà encaissée, ou sans référence pour virement, chèque et mobile money), annulation avec motif obligatoire, numéros de reçu `REC-2026-00001` sans trou ni doublon, données de reçu. `overview/` et `overdue/` : chiffres et impayés (comptable, direction, fondateur, en lecture seule pour les deux derniers). Un parent ne voit que les finances de ses enfants ; l'élève n'y a pas accès. |
| Rapprochement | `statement/import/` (CSV `ref;date;mode;montant;telephone`, rejouable sans doublon, rattachement automatique par référence), `statement/` (`?issues=1`), `match/` (crée le paiement) et `fix/` (le relevé de l'opérateur fait foi). |
| Mobile money | Le parent lance `finance/pay/initiate/` : **rien n'est encaissé**. Seul le retour de l'opérateur, `POST webhooks/mobile-money/`, confirme. Il doit porter `X-Timestamp` et `X-Signature: sha256=` + HMAC-SHA256 de `horodatage.corps` avec `MOBILE_MONEY_WEBHOOK_SECRET` : signature invalide ou horodatage de plus de 5 min → 401, corps modifié → 401, secret absent → 503. Rejouer le même retour ne crée jamais un second paiement. Montant différent ou solde déjà réglé → intention « à vérifier », aucun paiement, le comptable est prévenu. `MOBILE_MONEY_SANDBOX=1` (développement seulement) simule l'opérateur. |
| Annonces et messagerie (`communication`) | `announcements/` (publication : direction et secrétariat ; chacun ne voit que les annonces de son rôle). `messages/` : un parent écrit aux enseignants de ses enfants, à la direction et à la vie scolaire ; le personnel écrit à tout le personnel et aux parents des classes suivies (un enseignant : ses classes seulement) ; l'élève ne peut pas écrire. Quand un destinataire est un parent, **chaque famille reçoit sa propre conversation** (les familles ne se voient pas). Une conversation n'est visible que de ses participants ; lire ne la marque pas comme lue (`read/`). |
| Emploi du temps (`schedule`) | `timetable/` (lecture : la classe des enfants pour les familles, tout pour le personnel ; écriture : direction et secrétariat). Un cours est refusé si l'enseignant est déjà en cours ailleurs, si la salle est prise, si le créneau n'existe pas (mercredi après-midi, samedi après-midi) ou si la matière n'est pas enseignée à la classe. `timetable/generate/` régénère tout (déterministe, heures = coefficients, sans aucun conflit). |
| Cahier de textes | `textbook/` : seul l'enseignant affecté à la classe et à la matière écrit, une séance par jour, jamais une séance à venir ; un devoir exige sa date de remise ; les parents sont prévenus à la création ou au changement du devoir. |
| Examens blancs (`mockexams`) | `mock-exams/` : BEPC (3e) et BAC (Tle, coefficients par série). Moyenne calculée seulement quand **toutes** les matières sont notées, arrondie au centième, admissible dès 10, ex æquo au même rang. Notes saisies par l'enseignant de la matière (ou la direction/le secrétariat), verrouillées une fois les résultats publiés. Une famille voit uniquement la ligne de son enfant, après publication. |
| Santé | `GET health/` pour Docker et la supervision. |

Vérifier l'alignement avec l'interface : `python scripts/check_perms_sync.py ../ecole-horizon/src/app/models.ts`.

## Organisation du code

```
config/            réglages (variables d'environnement), urls
apps/core/         permissions, journal d'activité, erreurs homogènes, santé
apps/accounts/     compte utilisateur (9 rôles), connexion, profil, gestion des comptes
```

Les prochaines applications s'ajoutent à côté : `academics` (classes, matières, coefficients), `students` et `enrollment`,
`grades` (notes, calcul des moyennes et rangs, publication, verrouillage), `attendance`, `finance` (paiements, mobile money
par webhook signé), `discipline`, `communication`, `timetable`, `mockexams`.

## Règles à respecter pour la suite

1. Toute vue déclare `permission_classes = [perm_required("...")]`. Pas de vue publique sans raison écrite.
2. Les listes sont **filtrées par le serveur** selon le rôle (un parent ne voit que ses enfants, un enseignant que ses classes).
3. Les calculs (moyennes, rangs, soldes) se font côté serveur ; l'interface affiche, elle ne décide pas.
4. Un paiement mobile money n'est confirmé que par le webhook signé de l'agrégateur, jamais par l'interface.
5. Chaque action sensible écrit dans le journal (`apps.core.log.record`).

## Mise en production (liste de contrôle)

- `DEBUG=False`, `SECRET_KEY` longue et secrète, `ALLOWED_HOSTS` et `CORS_ALLOWED_ORIGINS` à l'adresse réelle de l'interface.
- PostgreSQL via `DATABASE_URL`, sauvegardes quotidiennes testées.
- HTTPS obligatoire (Nginx ou le proxy de l'hébergeur devant `web`) ; cookies et HSTS sont déjà activés hors mode debug.
- Ne **jamais** lancer `seed_demo` en production.
- Production : `MOBILE_MONEY_SANDBOX=0`, `MOBILE_MONEY_WEBHOOK_SECRET` long et aléatoire, webhook en HTTPS uniquement.

## Mise en production
Le dossier `../ecole-deploy` contient la pile complète (PostgreSQL, gunicorn, Caddy en HTTPS, sauvegardes quotidiennes) et le guide `DEPLOIEMENT.md`.
Plusieurs écoles : `create_platform_admin`, `init_school --ecole <code>`, page `/plateforme.html` (voir `ecole-deploy/DEPLOIEMENT.md`, section « Plusieurs écoles »). Toutes les données portent un établissement ; le gestionnaire `objects` ne renvoie que l'école de la requête (`apps/core/tenancy.py`), `all_objects` est réservé à la plateforme. Les tests d'isolation sont dans `apps/core/test_tenancy.py`.

Première installation : `python manage.py init_school --school "Nom" --director "Nom du directeur"` crée les comptes de direction avec un mot de passe provisoire affiché une seule fois. `seed_demo` est refusé quand `DEBUG=False`.

## Reçu de paiement (PDF)
`GET /api/v1/finance/payments/{id}/receipt.pdf` renvoie le reçu en PDF (reportlab, aucune dépendance système) : numéro, élève, mode, montant en chiffres et en lettres, solde restant, logo de l'école, filigrane « ANNULÉ » si le paiement est annulé. Mêmes droits que `receipt/` : comptabilité, direction, ou parent concerné.

## Bulletins PDF et vérification par QR code
- `GET /api/v1/students/{id}/bulletin.pdf?term=T1&template=classique|moderne|compact` : bulletin d'un élève. Famille : notes publiées seulement. Direction et secrétariat : ajoutez `&published=1` pour la version définitive ; sans cela le bulletin est marqué « PROVISOIRE » et n'a pas de QR code.
- `GET /api/v1/classes/{id}/bulletins.pdf?term=T1` : tous les bulletins d'une classe dans un PDF (direction et secrétariat).
- `GET /api/v1/public/verify/{jeton}/` : page publique ouverte par le QR code. Le jeton est signé (clé secrète du serveur) et contient la moyenne et le rang : si les notes publiées changent, la page signale que le document ne correspond plus. Elle affiche le nom, la classe, la période, la moyenne et le rang.
- En production, définissez `PUBLIC_BASE_URL` (le fichier de déploiement le fait avec `https://DOMAINE`) pour que le QR code pointe vers l'adresse publique.
