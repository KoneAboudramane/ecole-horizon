import { PageId, Role } from './models';

/**
 * Contenu de l’aide intégrée. Un seul fichier, en français : c’est ici qu’on corrige ou complète les textes.
 * Le test help-content.spec.ts vérifie que chaque page proposée à chaque rôle possède une aide.
 */

export interface HelpPage {
  /** À quoi sert la page, en une ou deux phrases. */
  but: string;
  /** Les actions principales, pas à pas. */
  etapes: string[];
  /** Erreurs ou blocages fréquents, avec la solution. */
  erreurs?: string[];
  /** Un conseil pratique. */
  astuce?: string;
}

export interface HelpEntry extends HelpPage {
  /** Variantes selon le rôle : seuls les champs fournis remplacent ceux de la page. */
  roles?: Partial<Record<Role, Partial<HelpPage>>>;
}

export interface RoleGuide {
  resume: string;
  peut: string[];
  nePeutPas: string[];
  parcours: { titre: string; etapes: string[] }[];
  contact: string;
}

export interface TourStep { titre: string; texte: string; }

export interface Faq { q: string; r: string; roles?: Role[]; }

/** Pages voisines : proposées en bas de l’aide d’une page (seulement celles que le rôle peut ouvrir). */
export const SEE_ALSO: Partial<Record<PageId, PageId[]>> = {
  dashboard: ['messages', 'annonces', 'profil'],
  eleves: ['classes', 'comptes', 'bulletins'], classes: ['eleves', 'matieres', 'edt'], matieres: ['classes', 'notes'],
  comptes: ['roles', 'journal', 'eleves'], roles: ['comptes', 'journal'], parametres: ['annee', 'tarifs', 'journal'], journal: ['comptes', 'roles'],
  notes: ['bulletins', 'examens', 'decisions'], bulletins: ['notes', 'decisions', 'conduite'], examens: ['notes', 'devoirs'],
  appel: ['presences', 'discipline'], presences: ['appel', 'discipline'], discipline: ['presences', 'conduite', 'decisions'], conduite: ['discipline', 'bulletins'],
  paiements: ['caisse', 'impayes', 'rapprochement'], caisse: ['paiements', 'impayes'], impayes: ['paiements', 'tarifs'], tarifs: ['paiements', 'parametres'], rapprochement: ['paiements', 'caisse'], payer: ['bulletins', 'messages'],
  edt: ['cahier', 'devoirs'], cahier: ['edt', 'devoirs', 'cours'], devoirs: ['cahier', 'cours', 'examens'], cours: ['devoirs', 'cahier'],
  annee: ['decisions', 'archives', 'anciens'], decisions: ['bulletins', 'annee'], archives: ['annee', 'anciens'], anciens: ['archives', 'eleves'],
  messages: ['annonces', 'dashboard'], annonces: ['messages'], profil: ['dashboard'], stats: ['paiements', 'presences', 'notes'],
};

export function seeAlso(page: PageId, allowed: readonly PageId[]): PageId[] {
  return (SEE_ALSO[page] ?? []).filter((p) => allowed.includes(p));
}

export const SECRETARIAT = 'le secrétariat de l’école';

/* ------------------------------------------------------------------ pages */

export const PAGES: Record<PageId, HelpEntry> = {
  dashboard: {
    but: 'Votre page d’accueil : l’essentiel de ce qui vous concerne aujourd’hui, avec des raccourcis vers les actions courantes.',
    etapes: [
      'Regardez les chiffres et les alertes en haut de page.',
      'Utilisez les boutons de raccourci pour aller directement à l’action voulue.',
      'Ouvrez la cloche en haut à droite pour lire vos notifications.',
    ],
    astuce: 'Le menu à gauche (ou le bouton ☰ sur téléphone) donne accès à toutes vos pages.',
    roles: {
      fondateur: {
        but: 'Vue d’ensemble de l’école : effectifs, encaissements, résultats et assiduité.',
        etapes: ['Lisez les chiffres clés (effectifs, encaissements, impayés).', 'Ouvrez « Statistiques » pour le détail et l’évolution.', 'Ouvrez « Finances » ou « Impayés » pour voir qui doit quoi.'],
      },
      directeur: {
        but: 'Vue de la direction : ce qui attend votre décision (notes à publier, sanctions à valider) et l’état de l’école.',
        etapes: ['Regardez le bloc « À valider » : sanctions et notes en attente.', 'Cliquez sur une ligne pour traiter l’élément concerné.', 'Consultez les résultats par classe et les élèves les plus absents.'],
      },
      admin: {
        but: 'Votre tableau de bord du secrétariat : inscriptions, comptes et suivi des familles.',
        etapes: ['Utilisez « Inscrire un élève » pour une nouvelle inscription.', 'Utilisez « Gérer les comptes » pour créer ou réinitialiser un accès.', 'Consultez les annonces et l’activité récente.'],
      },
      enseignant: {
        but: 'Votre accueil d’enseignant : vos classes, vos matières et les actions de la journée.',
        etapes: ['Cliquez sur « Faire l’appel » en début de cours.', 'Cliquez sur « Saisir des notes » après une évaluation.', 'Consultez les annonces de l’école.'],
      },
      educateur: {
        but: 'Votre accueil d’éducateur : absences du jour, justificatifs et incidents.',
        etapes: ['Faites l’appel ou vérifiez celui des enseignants.', 'Traitez les justificatifs d’absence reçus.', 'Utilisez « Signaler un incident » si nécessaire.'],
      },
      comptable: {
        but: 'Votre tableau de bord financier : encaissements, impayés et moyens de paiement.',
        etapes: ['Utilisez « Enregistrer un paiement » à chaque versement reçu.', 'Ouvrez « Impayés » pour relancer les familles.', 'Consultez les encaissements par mois et par moyen de paiement.'],
      },
      informatique: {
        but: 'Votre accueil technique : comptes, journal d’activité et identité de l’école.',
        etapes: ['Utilisez « Gérer les comptes » pour créer ou réinitialiser un accès.', 'Consultez le journal pour comprendre qui a fait quoi.', 'Mettez à jour l’identité de l’école (nom, logo, couleur).'],
      },
      parent: {
        but: 'Le suivi de votre enfant : notes, absences, bulletins et scolarité, au même endroit.',
        etapes: ['Si vous avez plusieurs enfants, choisissez l’enfant en haut de page.', 'Consultez les dernières notes et absences.', 'Utilisez « Scolarité et paiement » pour régler les frais.'],
      },
      eleve: {
        but: 'Votre espace d’élève : vos notes publiées, vos absences et votre emploi du temps.',
        etapes: ['Regardez vos dernières notes.', 'Consultez votre emploi du temps et le cahier de textes.', 'Lisez les annonces de l’école.'],
      },
    },
  },

  eleves: {
    but: 'La liste de tous les élèves de l’école, avec recherche et accès à chaque dossier.',
    etapes: [
      'Cherchez un élève par son nom ou filtrez par classe.',
      'Cliquez sur un élève pour ouvrir sa fiche complète.',
      'Pour inscrire un élève : bouton « Inscrire un élève », remplissez l’identité, la classe et le parent, puis « Inscrire l’élève ».',
      'Après l’inscription, remettez à la famille la fiche d’accès (« Fiche d’accès à imprimer ») : identifiant (téléphone du parent, matricule de l’élève) et code provisoire de 6 chiffres, à changer à la première connexion.',
      'Pour inscrire plusieurs élèves d’un coup : bouton d’import par fichier (Excel ou CSV), puis « Vérifier le fichier » avant de valider.',
    ],
    erreurs: [
      'Le fichier d’import est refusé : utilisez le modèle téléchargeable, un seul onglet, moins de 2000 lignes, format .xlsx ou .csv (pas .xls).',
      'Un élève est signalé en doublon : vérifiez qu’il n’est pas déjà inscrit avant de recommencer.',
    ],
    astuce: 'Après un import, l’écran affiche les identifiants à remettre aux familles : imprimez-les ou notez-les tout de suite, ils ne sont montrés qu’une fois.',
    roles: {
      educateur: { but: 'La liste des élèves, pour retrouver un dossier et consulter l’assiduité et la discipline.', etapes: ['Cherchez l’élève par nom ou par classe.', 'Ouvrez sa fiche pour voir absences, retards et incidents.', 'Utilisez le bouton WhatsApp pour joindre le parent.'] },
      directeur: { but: 'La liste des élèves de l’école et leurs dossiers.', etapes: ['Cherchez l’élève par nom ou par classe.', 'Ouvrez sa fiche : résultats, absences, discipline, paiements.', 'Les inscriptions sont faites par le secrétariat.'], erreurs: [] },
      fondateur: { but: 'La liste des élèves de l’école et leurs dossiers, en consultation.', etapes: ['Cherchez l’élève par nom ou par classe.', 'Ouvrez sa fiche pour voir ses résultats et son échéancier.'], erreurs: [], astuce: 'Les inscriptions et modifications sont faites par le secrétariat.' },
    },
  },

  eleve: {
    but: 'La fiche complète d’un élève : identité, parent, résultats, échéancier, absences, discipline et paiements.',
    etapes: [
      'Parcourez les blocs de la fiche de haut en bas.',
      '« Voir le bulletin » ouvre le bulletin de l’élève.',
      '« Modifier le dossier » (secrétariat) permet de corriger l’identité ou le parent.',
      'Le bouton WhatsApp parent ouvre une conversation avec le responsable.',
      'Un mot de passe oublié : « Accès à l’application » (secrétariat) permet de « Réinitialiser » l’accès de l’élève ou du parent ; un nouveau code provisoire est affiché une seule fois, avec une fiche à imprimer.',
    ],
    erreurs: ['Le bouton WhatsApp est absent : le numéro du parent n’est pas renseigné, ajoutez-le via « Modifier le dossier ».'],
  },

  classes: {
    but: 'Les classes de l’école, leurs effectifs et leur professeur principal.',
    etapes: [
      'Cliquez sur une classe pour voir ses élèves.',
      'Pour créer ou modifier une classe : utilisez les boutons de la page (secrétariat).',
      'Pour créer plusieurs classes d’un coup : import par fichier, avec le modèle proposé.',
      'Pour désigner le professeur principal : ouvrez la classe et choisissez-le dans la liste (direction et secrétariat).',
    ],
    erreurs: ['Une classe n’apparaît pas : vérifiez qu’elle a bien été enregistrée pour l’année scolaire en cours.'],
    roles: { educateur: { etapes: ['Cliquez sur une classe pour voir ses élèves.', 'Ouvrez un élève pour consulter sa fiche.'], erreurs: [] }, directeur: { etapes: ['Cliquez sur une classe pour voir ses élèves et ses résultats.', 'Les classes sont créées par le secrétariat.'], erreurs: [] }, fondateur: { etapes: ['Cliquez sur une classe pour voir ses élèves et son effectif.'], erreurs: [] } },
  },

  matieres: {
    but: 'Les matières enseignées et leurs coefficients, qui servent au calcul des moyennes.',
    etapes: [
      'Au début, la liste est vide : chaque école saisit ses propres matières. Cliquez sur « Ajouter une matière », ou sur « Importer » pour en charger plusieurs depuis un fichier Excel.',
      'Fixez le coefficient de chaque matière pour chaque groupe de classes (0 : matière non enseignée).',
      '« Modifier » change le nom ou l’abréviation d’une matière.',
      'Onglet « Affectations des enseignants » : indiquez qui enseigne quoi dans chaque classe.',
    ],
    erreurs: ['Les moyennes ont changé : un coefficient a été modifié, c’est normal. Vérifiez avant la publication des bulletins.', 'Une matière ne peut pas être supprimée si elle a déjà des notes ou des cours : mettez son coefficient à 0.'],
    astuce: 'Réglez les coefficients en début d’année, avant la première évaluation.',
  },

  comptes: {
    but: 'Tous les accès à la plateforme : personnel, parents et élèves.',
    etapes: [
      'Pour un nouveau membre du personnel : « Créer le compte », choisissez son rôle (ceux de l’école, y compris ceux qu’elle a créés) et indiquez son e-mail si possible. Ses accès lui sont alors envoyés par e-mail ; sinon, remettez-lui l’identifiant et le mot de passe provisoire affichés.',
      'Pour changer la fonction de quelqu’un : bouton « Rôle ». Ses droits changent aussitôt.',
      'Pour un mot de passe perdu : « Réinitialiser » crée un nouveau mot de passe provisoire (envoyé par e-mail s’il y a une adresse, à remettre sinon).',
      'Pour créer plusieurs comptes de personnel ou enseignants : import par fichier, avec le modèle.',
      'Pour couper l’accès de quelqu’un qui part : désactivez son compte.',
    ],
    erreurs: [
      'Le mot de passe provisoire est perdu : il n’est affiché qu’une fois, réinitialisez le compte pour en obtenir un nouveau.',
      'Une personne ne reçoit pas ses accès par e-mail : vérifiez l’adresse dans son compte et ses courriers indésirables ; à défaut, remettez-lui le mot de passe provisoire affiché.',
      'Impossible de changer le rôle ou de désactiver un compte : il doit toujours rester au moins une personne active qui gère les rôles.',
    ],
    astuce: 'À la première connexion, chaque utilisateur doit choisir son propre mot de passe.',
  },

  parametres: {
    but: 'Les réglages de l’école : identité, apparence, bulletins et règles de calcul.',
    etapes: [
      'Identité : nom, adresse, téléphone, logo. Cliquez sur « Enregistrer l’identité ».',
      'Couleur de la plateforme : choisissez la teinte de l’école.',
      'Modèle de bulletin par défaut : choisissez la présentation des bulletins. Ce modèle s’impose à tous : les parents et les élèves voient toujours le bulletin dans le modèle choisi par l’école.',
      'Périodes d’évaluation : choisissez trimestres, semestres ou votre propre découpage (nom et dates de chaque période), puis « Enregistrer les périodes ». Une période qui a déjà des évaluations ne peut pas être retirée.',
      'Horaires de cours : saisissez les heures de chaque créneau, les pauses, et le nombre de créneaux ouverts chaque jour (0 : jour fermé, dimanche compris). Cliquez sur « Enregistrer les horaires ».',
      'Règles de calcul et remise fratrie : ajustez-les avec la direction.',
    ],
    erreurs: ['Le logo est refusé : choisissez une image plus légère.'],
    roles: { informatique: { but: 'L’identité de l’école : nom, adresse, logo et couleur affichés partout.', etapes: ['Renseignez le nom, l’adresse et le téléphone.', 'Choisissez le logo avec « Choisir un logo ».', 'Cliquez sur « Enregistrer l’identité ».'] } },
  },

  annonces: {
    but: 'Les communications officielles de l’école, visibles par les personnes concernées.',
    etapes: ['Lisez les annonces, les plus récentes en premier.'],
    roles: {
      directeur: { etapes: ['Rédigez un titre et un message.', 'Choisissez à qui s’adresse l’annonce (parents, élèves, personnel).', 'Cliquez sur « Publier ».'] },
      admin: { etapes: ['Rédigez un titre et un message.', 'Choisissez à qui s’adresse l’annonce (parents, élèves, personnel).', 'Cliquez sur « Publier ».'] },
    },
  },

  journal: {
    but: 'L’historique des actions faites sur la plateforme : qui a fait quoi, et quand.',
    etapes: ['Parcourez la liste, la plus récente en haut.', 'Repérez une action sensible (paiement annulé, note modifiée, compte créé).', 'Utilisez-le pour comprendre une erreur ou répondre à une question d’un parent.'],
    astuce: 'Le journal ne se modifie pas : il sert de preuve et de mémoire.',
  },

  notes: {
    but: 'Les notes des élèves, par évaluation.',
    etapes: ['Choisissez la classe et la matière.', 'Consultez les notes publiées et la moyenne.'],
    roles: {
      enseignant: {
        but: 'Saisie de vos notes : créez une évaluation, saisissez les notes de la classe.',
        etapes: [
          'Choisissez la classe et la matière.',
          'Cliquez sur « Nouvelle évaluation », choisissez la classe et la matière, le type (interrogation, devoir ou composition), la note maximale (sur 10, 20, 30 ou « Autre » à préciser), le titre, la date et le coefficient, puis « Créer et saisir les notes » : les noms des élèves et les champs de note s’affichent aussitôt.',
          'Saisissez la note de chaque élève, sur le barème choisi à la création (sur 10, 20, 30 ou autre).',
          'Cliquez sur « Enregistrer ». La direction publiera ensuite les notes aux familles.',
        ],
        erreurs: [
          'Impossible de modifier : la période est verrouillée par la direction. Demandez-lui de la déverrouiller.',
          'La note est déjà publiée : toute modification est immédiatement visible des familles. Corrigez avec soin.',
        ],
        astuce: 'Notes sur le barème de l’évaluation (ramenées sur 20 dans les moyennes), virgule acceptée. Laissez vide si l’élève n’a pas composé : ne mettez pas 0.',
      },
      directeur: {
        but: 'Contrôle des notes saisies, publication aux familles et verrouillage de la période.',
        etapes: [
          'Vérifiez les « Résultats provisoires » de chaque classe.',
          'Cliquez sur « Publier tout ce qui est saisi » ou publiez évaluation par évaluation.',
          'Une fois la période terminée, verrouillez-la pour empêcher toute modification.',
        ],
        erreurs: ['Une erreur est repérée après publication : « Retirer » la publication, faites corriger la note, puis republiez.'],
      },
      admin: { but: 'Contrôle des notes saisies par les enseignants, en lecture.', etapes: ['Choisissez la classe et la matière.', 'Repérez les évaluations manquantes ou incomplètes.', 'Relancez l’enseignant concerné si besoin.'], astuce: 'La publication et le verrouillage sont réservés à la direction.' },
      fondateur: { but: 'Les résultats de l’école, par classe.', etapes: ['Choisissez la classe.', 'Consultez les moyennes et les rangs.'] },
      parent: { but: 'Les notes publiées de votre enfant, matière par matière.', etapes: ['Choisissez l’enfant si vous en avez plusieurs.', 'Choisissez la période en haut de page.', 'Comparez la note de votre enfant à la moyenne de la classe.'], erreurs: ['Une note manque : elle n’est visible qu’après publication par la direction.'], astuce: 'Le classement et les moyennes de classe vous aident à situer votre enfant.' },
      eleve: { but: 'Vos notes publiées, matière par matière.', etapes: ['Choisissez la période en haut de page.', 'Regardez vos notes et la moyenne de la classe.'], erreurs: ['Une note manque : elle n’est visible qu’après publication par la direction.'] },
    },
  },

  bulletins: {
    but: 'Les bulletins de notes par période.',
    etapes: ['Choisissez la classe et l’élève.', 'Ouvrez le bulletin.'],
    roles: {
      enseignant: { but: 'Vos appréciations par matière pour chaque élève.', etapes: ['Choisissez la classe et la période.', 'Écrivez une appréciation courte et utile pour chaque élève.', 'Elle s’enregistre quand vous quittez le champ.'], erreurs: ['Le champ est grisé : la période est verrouillée ou la saisie n’est pas ouverte.'] },
      directeur: { but: 'Appréciation du conseil de classe, signature et génération des bulletins.', etapes: ['Choisissez la classe et la période.', 'Écrivez l’appréciation du conseil de classe pour chaque élève.', 'Générez le bulletin d’un élève ou de toute la classe.'], erreurs: ['Le bulletin est vide : les notes ne sont pas encore publiées.'], astuce: 'Le fichier généré s’ouvre dans le navigateur ; utilisez « Imprimer ».' },
      admin: { but: 'Génération et impression des bulletins.', etapes: ['Choisissez la classe et la période.', 'Générez le bulletin d’un élève ou de toute la classe.', 'Ouvrez le fichier et utilisez « Imprimer ».'], erreurs: ['Le bulletin est incomplet : les notes ou appréciations ne sont pas encore saisies.'] },
      fondateur: { etapes: ['Choisissez la classe et l’élève.', 'Ouvrez le bulletin pour le consulter.'] },
      parent: { but: 'Les bulletins de votre enfant, à consulter et à imprimer.', etapes: ['Choisissez l’enfant et la période.', 'Ouvrez le bulletin.', 'Utilisez « Imprimer » pour l’enregistrer en PDF ou l’imprimer.'], erreurs: ['Pas de bulletin : il apparaît quand l’école le publie à la fin de la période.'] },
      eleve: { but: 'Vos bulletins de notes.', etapes: ['Choisissez la période.', 'Ouvrez le bulletin.', 'Utilisez « Imprimer » si besoin.'], erreurs: ['Pas de bulletin : il apparaît quand l’école le publie.'] },
    },
  },

  appel: {
    but: 'Faire l’appel de la classe : présents, absents et retards.',
    etapes: [
      'Choisissez la classe, la date et la séance.',
      'Cliquez sur « Tout le monde présent », puis marquez seulement les absents et les retards.',
      'Cliquez sur « Enregistrer l’appel ».',
    ],
    erreurs: ['L’appel n’a pas été enregistré : vérifiez le message de confirmation avant de quitter la page.'],
    astuce: 'Faites l’appel en début de séance : les parents sont informés rapidement des absences.',
  },

  presences: {
    but: 'Le suivi des absences, des retards et des justificatifs.',
    etapes: ['Choisissez la classe ou la période.', 'Consultez les absences et retards.', 'Traitez les justificatifs à valider.'],
    roles: {
      educateur: { but: 'Suivi des absences et retards, et traitement des justificatifs.', etapes: ['Ouvrez « Justificatifs à traiter ».', 'Cliquez sur « Accepter » ou « Refuser » pour chaque justificatif.', 'Justificatif apporté au bureau : onglet « Non justifiées », « Saisir un justificatif » (possible même après le délai).', 'Suivi des appels : choisissez la période, cochez « Non faits seulement » pour repérer les appels oubliés, cliquez sur une ligne pour ouvrir l’appel.', 'Consultez le « Rapport par classe » pour repérer les élèves les plus absents.'] },
      directeur: { but: 'Suivi de l’assiduité de l’école.', etapes: ['Consultez le rapport par classe.', 'Traitez les justificatifs si besoin.', 'Repérez les élèves très absents.'] },
      fondateur: { but: 'L’assiduité de l’école, en consultation.', etapes: ['Choisissez la classe.', 'Consultez les absences et retards.'] },
      parent: {
        but: 'Les absences, retards et mesures disciplinaires de votre enfant.',
        etapes: ['Choisissez l’enfant si vous en avez plusieurs.', 'Consultez les absences non justifiées.', 'Cliquez sur « Justifier », écrivez le motif, puis « Envoyer le justificatif ».'],
        erreurs: ['Le justificatif est refusé : lisez le motif du refus et contactez l’éducateur.', 'Le bouton « Justifier » a disparu : le délai fixé par l’école est dépassé ou la période est verrouillée. Apportez le justificatif à l’école.'],
        astuce: 'Justifiez rapidement : plus le justificatif arrive tôt, plus il est facile à traiter.',
      },
      eleve: { but: 'Vos absences et retards.', etapes: ['Consultez la liste de vos absences.', 'Informez vos parents si une absence n’est pas justifiée : c’est eux qui envoient le justificatif.'] },
    },
  },

  paiements: {
    but: 'Les paiements de scolarité encaissés par l’école.',
    etapes: [
      'Pour un nouveau versement : « Enregistrer un paiement ». Filtrez d’abord les élèves (classe, niveau, situation : reste à payer, en retard, soldé) ou tapez un nom, puis choisissez l’élève, le moyen (espèces, virement, chèque) et le montant.',
      'Le reçu indique, pour chaque échéance de l’école, ce qui est dû, déjà payé, réglé par ce paiement et ce qui reste, avec la prochaine échéance. Téléchargez-le pour la famille ; une réimpression porte la mention « Duplicata ».',
      'Si le montant dépasse le solde, l’application vous demande de confirmer : le surplus est gardé en avance et déduit de l’année suivante.',
      'Le menu « Année » en haut de la liste permet de relire, sans rien modifier, les paiements des années passées, avec les soldes reportés. « Relevé » donne tous les paiements d’un élève, à imprimer pour les parents.',
      'Pour reprendre les paiements déjà encaissés avant l’arrivée de la plateforme : import par fichier, avec le modèle.',
    ],
    erreurs: ['Une erreur de saisie : utilisez « Annuler le paiement » (un motif est demandé). L’annulation est enregistrée dans le journal.'],
    astuce: 'Ne supprimez jamais un paiement : annulez-le, pour garder une trace propre.',
    roles: {
      directeur: { but: 'Le suivi des encaissements, en consultation.', etapes: ['Consultez les paiements récents.', 'Filtrez par classe, élève ou moyen de paiement.', 'Ouvrez « Impayés » pour voir les retards.'], erreurs: [], astuce: 'Les encaissements sont faits par le comptable.' },
      fondateur: { but: 'Le suivi des encaissements, en consultation.', etapes: ['Consultez les paiements récents.', 'Filtrez par classe, élève ou moyen de paiement.', 'Ouvrez « Impayés » pour voir les retards.'], erreurs: [], astuce: 'Les encaissements sont faits par le comptable.' },
    },
  },

  caisse: {
    but: 'La clôture de la caisse à la fin de la journée.',
    etapes: [
      'Choisissez le jour : vous voyez les encaissements par moyen de paiement et les annulations.',
      'Comptez les espèces réellement présentes dans la caisse et saisissez le montant.',
      'S’il y a un écart avec les reçus, expliquez-le en une phrase, puis « Clôturer la caisse ».',
    ],
    erreurs: ['Une journée ne se clôture qu’une fois : vérifiez le montant compté avant de valider.'],
    astuce: 'Clôturez chaque soir : un écart est facile à retrouver le jour même, beaucoup moins une semaine plus tard.',
    roles: {
      directeur: { but: 'Le suivi des clôtures de caisse, en consultation.', etapes: ['Choisissez un jour pour voir les encaissements et la clôture du comptable.'], erreurs: [] },
      fondateur: { but: 'Le suivi des clôtures de caisse, en consultation.', etapes: ['Choisissez un jour pour voir les encaissements et la clôture du comptable.'], erreurs: [] },
    },
  },

  impayes: {
    but: 'Les familles qui ont un solde à régler.',
    etapes: [
      'Consultez la liste des élèves avec un reste à payer ; filtrez par classe ou par échéance en retard.',
      'Cliquez sur « Relancer » pour enregistrer la relance d’une famille (elle passe alors en « Relancée »), ou sur le bouton WhatsApp : le message est déjà écrit, avec l’échéance concernée et le montant.',
      '« Relancer toutes les familles » le fait en une seule fois.',
    ],
    erreurs: ['Une famille dit avoir payé : cherchez son paiement dans « Paiements » ou dans « Rapprochement » avant de relancer.'],
  },

  tarifs: {
    but: 'Les frais de scolarité et leurs dates d’échéance.',
    etapes: ['Renseignez les frais d’inscription et de scolarité.', 'Choisissez vos tranches de scolarité (nombre, noms, parts) puis réglez leurs dates d’échéance.', 'Enregistrez : les échéanciers des familles sont mis à jour.'],
    erreurs: ['Un échéancier a changé : un tarif ou une date a été modifié. Prévenez les familles concernées.'],
    astuce: 'Modifiez les tarifs avant les inscriptions, pas en cours d’année.',
    roles: { fondateur: { etapes: ['Consultez les frais et les dates d’échéance.', 'Demandez au comptable de modifier si nécessaire.'], erreurs: [] } },
  },

  rapprochement: {
    but: 'Vérifier que les paiements mobile money enregistrés correspondent au relevé de l’opérateur.',
    etapes: [
      'Cliquez sur « Importer le relevé (CSV) » et choisissez le fichier de l’opérateur.',
      'Les lignes sans correspondance sont signalées : « Rattacher à un élève » pour les associer.',
      'Si un montant diffère, « Aligner sur le relevé » corrige l’écart.',
    ],
    erreurs: ['Le relevé est refusé : exportez-le en CSV depuis l’espace de l’opérateur et vérifiez les colonnes.'],
  },

  payer: {
    but: 'La scolarité de votre enfant : ce qui est dû, ce qui est payé et le paiement en ligne.',
    etapes: [
      'Consultez l’échéancier : chaque tranche, son montant et sa date.',
      'Cliquez sur « Payer par mobile money », choisissez Orange Money, MTN Money, Moov Money ou Wave, puis suivez les indications à l’écran.',
      'Validez le paiement sur votre téléphone, puis cliquez sur « J’ai validé sur mon téléphone ».',
      'Récupérez votre reçu avec « Télécharger le reçu ».',
    ],
    erreurs: [
      'Le paiement n’est pas confirmé : attendez un instant, puis « Réessayer ». Si le montant est débité, contactez la comptabilité avec votre numéro de transaction.',
      'Le reçu manque : il apparaît dès que le paiement est confirmé.',
    ],
    astuce: 'Gardez le message de confirmation de l’opérateur jusqu’à la réception du reçu.',
  },

  discipline: {
    but: 'Les incidents et les sanctions des élèves.',
    etapes: ['Consultez la liste des incidents.', 'Filtrez par élève, classe ou gravité.'],
    roles: {
      educateur: { but: 'Signaler et suivre les incidents.', etapes: ['Cliquez sur « Signaler un incident ».', 'Choisissez l’élève, le type, la gravité et la sanction proposée.', 'Décrivez les faits, puis « Enregistrer ».', 'Les cas graves et les exclusions temporaires attendent la validation de la direction.'], erreurs: ['L’incident reste « à valider » : c’est normal pour un cas grave, la direction doit le valider.'] },
      enseignant: { etapes: ['Cliquez sur « Signaler un incident ».', 'Décrivez les faits, puis « Enregistrer ».'] },
      directeur: { but: 'Valider les sanctions et suivre la discipline.', etapes: ['Ouvrez « Sanctions en attente de validation ».', 'Lisez les faits, puis « Valider » ou « Refuser » (un commentaire est possible).', 'Signalez vous-même un incident au besoin.'], erreurs: [] },
    },
  },

  decisions: {
    but: 'Le bilan de fin d’année de chaque classe : admis, conseil à réunir, redoublants et exclus.',
    etapes: ['La « Synthèse par classe » donne les chiffres de toutes les classes ; cliquez sur une classe pour la détailler.', 'Les élèves sont regroupés : admis, conseil à réunir, redoublent, exclus, en attente de notes.', 'Direction : ajustez la décision de chacun si besoin, ou « Valider les propositions de la classe ».'],
    erreurs: ['Une moyenne manque : il manque des notes publiées pour une période.', '« A déjà redoublé la 5e » : un élève qui devrait redoubler un niveau déjà redoublé est proposé à l’exclusion. La direction peut confirmer le renvoi ou accorder un redoublement, avec un motif.'],
    astuce: 'La proposition automatique n’est qu’une aide : la décision finale appartient à la direction. Un redoublement fait avant la plateforme se coche dans le dossier de l’élève.',
    roles: { directeur: { etapes: ['Choisissez la classe.', 'Vérifiez la proposition pour chaque élève.', 'Modifiez les cas particuliers, puis validez la classe.'] } },
  },

  annee: {
    but: 'Clore l’année et ouvrir la suivante, en trois étapes : bilan, passage, répartition dans les classes.',
    etapes: ['Étape 1, Bilan : pour chaque classe, confirmez admis, redoublants et exclus (un élève qui redoublerait un niveau déjà redoublé est proposé à l’exclusion ; vous pouvez lui accorder un redoublement).', 'Étape 2, Passage : vérifiez ce que devient chaque élève, puis « Vérifier et appliquer ». La nouvelle année s’ouvre ; ceux qui restent sont inscrits à leur nouveau niveau, « à placer ».', 'Étape 3, Réinscriptions : le comptable encaisse et remet le reçu ; le secrétariat vérifie le paiement (le n° de reçu s’ouvre d’un clic) et « Valider ». Sans paiement (boursier…), « Valider sans paiement » avec un motif. Après la date limite, « marquer comme partis » ceux qui n’ont rien payé.', 'Étape 4, Effectifs : pour chaque niveau, élèves validés face aux places des classes ; « Créer une classe » s’il en manque.', 'Étape 5, Répartition : niveau par niveau, « Répartir équitablement » (même nombre par classe, filles et garçons mélangés), ajustez à la main, puis « Enregistrer ». Les familles sont prévenues de la classe.'],
    erreurs: ['« Sans décision » à l’étape 2 : réglez ces élèves au bilan (étape 1) ou choisissez leur destination.', 'Un élève reste « à placer » : il n’y a plus de place dans les classes de son niveau ; créez une classe ou augmentez la capacité.', 'Aucune classe d’un niveau : créez-la dans « Classes », puis revenez à la répartition.'],
    astuce: 'Tant qu’aucun nouvel élève, paiement ou note n’a été enregistré dans la nouvelle année, « Annuler ce passage » remet tout comme avant. Un élève à placer n’apparaît ni à l’appel ni dans les notes tant qu’il n’a pas de classe.',
    roles: { directeur: { etapes: ['Vérifiez les moyennes de l’école dans les Paramètres.', 'Étape 1 : faites le bilan de chaque classe.', 'Étape 2 : appliquez le passage (l’ancienne année est verrouillée, les soldes impayés sont reportés).', 'Étape 3 : répartissez les élèves de chaque niveau dans les classes.'] } },
  },

  archives: {
    but: 'Consulter les résultats et les bulletins des années passées.',
    etapes: ['Choisissez l’année.', 'Repérez l’élève (la classe affichée est celle de l’époque).', 'Cliquez sur la période pour télécharger le bulletin en PDF.'],
    erreurs: ['Aucune année n’apparaît : la page se remplit après le premier passage à l’année suivante.', 'Le bulletin est vide : les notes de cette période n’avaient pas été publiées.'],
    astuce: 'Un élève exclu ou parti depuis reste visible dans l’année où il était inscrit.',
    roles: { parent: { but: 'Les bulletins des années passées de vos enfants.', etapes: ['Choisissez l’année.', 'Cliquez sur la période pour télécharger le bulletin.'] }, eleve: { but: 'Vos bulletins des années passées.', etapes: ['Choisissez l’année.', 'Cliquez sur la période pour télécharger le bulletin.'] } },
  },

  repartition: {
    but: 'Répartir les enseignants d’une même matière entre les classes (par exemple plusieurs professeurs de maths).',
    etapes: ['Vérifiez dans « Comptes » que chaque enseignant a ses matières.', 'Cliquez sur « Proposer pour toutes les matières » (ou « Répartir » sur une matière) : la charge est équilibrée entre les enseignants.', 'Relisez la proposition, puis « Appliquer cette répartition ».', 'Ajustez une classe à la main avec la liste « Enseignant » si besoin.'],
    erreurs: ['« Aucun enseignant ne donne cette matière » : ajoutez la matière à un enseignant.', '« Maximum d’heures atteint » : relevez le maximum d’un enseignant ou ajoutez-en un.'],
    astuce: 'Fixez un maximum d’heures par enseignant : la répartition ne le dépasse jamais. L’emploi du temps d’un enseignant se déduit de ceux de ses classes.',
    roles: {},
  },

  conduite: {
    but: 'La note de conduite de chaque élève : maximum de l’école moins les points retirés pendant la période.',
    etapes: ['Choisissez la classe et la période.', 'Cliquez sur « Appliquer aux absences non justifiées » : la règle de l’école (par exemple 3 demi-journées d’absence non justifiée = −1 point) retire les points dus. Vous pouvez relancer à tout moment.', 'Pour une sanction ou un autre motif, cliquez sur « Retirer des points », choisissez une suggestion ou saisissez vous-même le nombre de points et le motif.', 'Ouvrez « Détail » pour voir ou annuler un retrait.', 'La direction publie ensuite les notes de conduite aux familles.'],
    erreurs: ['« Cette classe ne fait pas partie de vos classes » : la direction décide des classes confiées à chaque éducateur.', 'Période verrouillée : seule la direction peut modifier la conduite.', 'Un retrait lié à une sanction grave ne compte qu’une fois la sanction validée par la direction.'],
    astuce: 'La conduite entre dans la moyenne générale avec le coefficient choisi par l’école (Paramètres > Conduite). Plusieurs cours manqués la même demi-journée comptent pour une seule absence.',
    roles: {},
  },

  educateurs: {
    but: 'Confier des classes à chaque éducateur.',
    etapes: ['Repérez l’éducateur dans la liste.', 'Cliquez sur les classes à lui confier.', 'Cliquez sur « Enregistrer » : il est prévenu.'],
    erreurs: ['Aucun compte éducateur : créez-le d’abord dans « Comptes ».'],
    astuce: 'Un éducateur sans classe attribuée voit toute l’école. Dès qu’une classe lui est confiée, il ne voit et ne gère plus que celles-ci.',
    roles: {},
  },

  anciens: {
    but: 'Retrouver les élèves exclus, partis ou devenus anciens élèves, et les réintégrer si besoin.',
    etapes: ['Recherchez l’élève par son nom ou son matricule.', 'Choisissez la classe d’accueil.', 'Cliquez sur « Réintégrer » : il revient dans l’effectif avec son dossier.'],
    erreurs: ['« Choisissez la classe d’accueil » : sélectionnez d’abord une classe.'],
    astuce: 'Le solde laissé par l’élève est reporté sur sa scolarité quand il revient.',
    roles: {},
  },

  edt: {
    but: 'L’emploi du temps hebdomadaire.',
    etapes: ['Choisissez la classe ou l’enseignant.', 'Lisez les cours jour par jour.'],
    roles: {
      admin: { but: 'Construire et ajuster l’emploi du temps.', etapes: ['Choisissez la classe.', 'Modifiez un créneau pour y placer une matière et un enseignant ; « Vider le créneau » le libère.', '« Régénérer l’emploi du temps » refait la grille automatiquement : relisez-la ensuite.', 'Les jours et les heures viennent des horaires de l’école (Paramètres > Horaires de cours).', 'Avant la rentrée, fixez une date limite dans « Disponibilités des enseignants » et relancez ceux qui n’ont pas rempli : la génération évite leurs créneaux indisponibles.'], astuce: '« Charge horaire des enseignants » aide à équilibrer les heures.' },
      directeur: { but: 'Valider et ajuster l’emploi du temps.', etapes: ['Choisissez la classe.', 'Modifiez un créneau si nécessaire.', 'Consultez la charge horaire des enseignants.'] },
      enseignant: { but: 'Votre emploi du temps de la semaine.', etapes: ['Repérez vos cours par jour.', 'Cliquez sur un cours pour ouvrir le cahier de textes si besoin.', 'Indiquez vos indisponibilités dans « Mes disponibilités » : un clic sur un créneau le passe à « plutôt pas », un deuxième à « indisponible ». Cliquez sur un jour pour le bloquer en entier.'] },
      parent: { but: 'L’emploi du temps de la classe de votre enfant.', etapes: ['Choisissez l’enfant si vous en avez plusieurs.', 'Lisez les cours jour par jour.'] },
      eleve: { but: 'Votre emploi du temps de la semaine.', etapes: ['Lisez les cours jour par jour.'] },
    },
  },

  maclasse: {
    but: 'Votre classe de professeur principal : résultats, notes de toutes les matières, assiduité, discipline et avis du conseil.',
    etapes: [
      '« Résultats » : moyenne, rang et mention de chaque élève, avec ses absences et incidents. Cliquez sur un élève pour voir le détail de ses notes.',
      '« Notes par matière » : toutes les évaluations de chaque matière, publiées ou en brouillon (lecture seule).',
      '« Assiduité » et « Discipline » : les absences, retards et incidents de la période.',
      '« Avis du conseil » : rédigez l’avis de chaque élève, puis « Enregistrer ». Il apparaît sur le bulletin.',
    ],
    erreurs: ['Vous ne pouvez pas modifier une note : elle appartient à l’enseignant de la matière. Signalez-lui l’erreur.', 'Période verrouillée : les avis ne se modifient plus.'],
    astuce: 'Changez de période avec le sélecteur en haut de l’écran.',
  },

  cahier: {
    but: 'Le cahier de textes : ce qui a été fait en cours et le travail à faire.',
    etapes: ['Choisissez la classe.', 'Lisez les séances de cours et le travail à faire.'],
    roles: {
      enseignant: { but: 'Votre propre cahier de textes : chaque séance de vos matières, dans vos classes, et le travail donné. Les cahiers de vos collègues ne s’affichent pas.', etapes: ['Cliquez sur « Nouvelle séance ».', 'Indiquez la date, le contenu du cours et le travail à faire.', 'Cliquez sur « Enregistrer ». « Modifier » ou « Supprimer » corrige une séance.'], astuce: 'Les élèves et les parents voient « À faire pour les prochains jours ».' },
      parent: { but: 'Ce qui a été vu en classe et le travail à faire par votre enfant.', etapes: ['Consultez « À faire pour les prochains jours ».', 'Lisez les séances passées pour aider à réviser.'] },
      eleve: { but: 'Ce qui a été vu en classe et ton travail à faire.', etapes: ['Consulte « À faire pour les prochains jours ».', 'Relis les séances passées pour réviser.'] },
    },
  },

  cours: {
    but: 'Les liens et fichiers de cours donnés par les enseignants, et les cours en direct.',
    etapes: ['Ouvrez un lien ou téléchargez un fichier.', 'Rejoignez un cours en direct quand le bouton apparaît.'],
    roles: {
      enseignant: { but: 'Partager des liens et des fichiers avec vos classes, ou programmer un cours en direct.', etapes: ['Cliquez sur « Nouveau support » : choisissez la classe et la matière, collez un ou plusieurs liens (https) et/ou joignez un fichier de 5 Mo au plus.', 'Pour un cours en ligne, cliquez sur « Programmer un cours en direct » : collez le lien de la salle (Meet, Zoom, Teams, WhatsApp) et indiquez le début et la fin.', 'Les élèves et leurs parents sont prévenus. Vous pouvez modifier ou supprimer vos publications.'], erreurs: ['Seules les adresses en https sont acceptées.'], astuce: 'Le lien d’un cours en direct n’apparaît chez les élèves que 15 minutes avant le début. Les parents ne le voient pas. Toute personne qui reçoit ce lien d’un élève peut toutefois entrer : activez la salle d’attente de votre outil si besoin.' },
      directeur: { but: 'Voir les supports et les cours en direct publiés par les enseignants (lecture seule).', etapes: ['Filtrez par classe.', 'Consultez les liens et les dates des cours en direct.'] },
      parent: { but: 'Voir les supports de cours de votre enfant.', etapes: ['Choisissez l’enfant si vous en avez plusieurs.', 'Ouvrez les liens ou téléchargez les fichiers par matière.'], astuce: 'Les liens des cours en direct sont réservés aux élèves.' },
      eleve: { but: 'Retrouver les liens et fichiers de tes cours, et rejoindre les cours en direct.', etapes: ['Les supports sont classés par matière : clique sur un lien ou télécharge le fichier.', 'Un cours en direct : le bouton « Rejoindre » apparaît 15 minutes avant le début.'], erreurs: ['Le lien n’apparaît pas ? Il est affiché seulement de 15 minutes avant le début jusqu’à la fin du cours.'], astuce: 'Les liens ouvrent des sites extérieurs : regarde le nom du site avant de cliquer.' },
    },
  },
  roles: {
    but: 'Choisir ce que chaque rôle de l’école peut faire, créer des rôles propres à l’école et confier à une personne le soin de les gérer.',
    etapes: [
      'Ouvrez un rôle pour voir ses droits, regroupés par domaine. À côté de chaque droit, « ouvre : … » indique les pages du menu qu’il active.',
      'Cochez ou décochez les droits, puis enregistrez. Les personnes concernées voient leur menu changer à leur prochaine page.',
      '« Nouveau rôle » : donnez un nom (secrétaire, surveillant général, économe…), partez d’un modèle si vous le souhaitez, cochez les droits et choisissez la portée : toute l’école, seulement les classes d’enseignement, ou seulement les classes confiées par la direction.',
      'Ensuite, dans « Comptes », donnez ce rôle aux personnes concernées (bouton « Rôle »).',
      'Pour déléguer la gestion des droits, donnez le droit « Gérer les rôles et les droits » au rôle d’une personne de confiance (par exemple l’informatique).',
    ],
    erreurs: [
      'Vous ne pouvez accorder que des droits que vous possédez vous-même.',
      'Un rôle utilisé par des comptes ne peut pas être supprimé : changez d’abord le rôle de ces comptes.',
      'On ne peut pas retirer le droit de gérer les rôles à la dernière personne qui le possède : il doit toujours rester au moins un compte actif qui le détient.',
      'Une page reste fermée malgré le bon droit : certaines pages sont liées à un type de rôle (par exemple la saisie des notes de l’enseignant).',
    ],
    astuce: 'Les rôles parent et élève ne changent pas : ils protègent les données des enfants. Chaque changement est écrit dans le journal d’activité.',
  },
  devoirs: {
    but: 'Les devoirs à rendre et les épreuves en ligne envoyés par les enseignants.',
    etapes: ['Ouvrez un devoir pour lire la consigne.', 'Suivez la note et la correction.'],
    roles: {
      enseignant: { but: 'Envoyer un devoir ou une épreuve à l’une de vos classes et corriger les copies.', etapes: ['Cliquez sur « Nouveau devoir » : choisissez la classe, la matière et le type (fichier à rendre, ou épreuve en ligne).', 'Pour une épreuve, saisissez les questions (QCM ou vrai/faux), les bonnes réponses, les points et la durée.', 'Cliquez sur « Envoyer à la classe » : les élèves et leurs parents sont prévenus.', 'Dans « Copies et résultats », ouvrez les copies, saisissez les notes, puis « Reporter dans le carnet de notes » si la note doit compter.'], erreurs: ['« Vous n’enseignez pas cette matière dans cette classe » : seules vos classes sont proposées.', 'Une épreuve commencée par un élève ne peut plus être modifiée.'], astuce: 'Un élève qui rend sur papier : saisissez sa note directement dans le tableau.' },
      directeur: { but: 'Suivre les devoirs envoyés par les enseignants (lecture seule).', etapes: ['Choisissez un devoir dans la liste.', 'Consultez qui a rendu, les notes et les résultats par question.'] },
      parent: { but: 'Suivre les devoirs et les épreuves de votre enfant.', etapes: ['Choisissez l’enfant si vous en avez plusieurs.', 'Repérez les devoirs « À faire », « Rendu » ou « Corrigé » et consultez la note.'], astuce: 'Seul votre enfant peut rendre sa copie ou passer l’épreuve.' },
      eleve: { but: 'Rendre tes devoirs et passer tes épreuves en ligne.', etapes: ['Ouvre un devoir : lis la consigne et télécharge le sujet.', 'Devoir en fichier : choisis ta copie (PDF ou photo) et clique sur « Rendre ma copie ».', 'Épreuve : clique sur « Démarrer ». Le chronomètre part et ne s’arrête plus ; coche tes réponses, puis « Terminer ».'], erreurs: ['Si ta connexion coupe pendant une épreuve, reconnecte-toi et clique sur « Reprendre » : le temps a continué de s’écouler.'], astuce: 'Quand le temps est écoulé, ta copie est rendue automatiquement avec les réponses déjà cochées.' },
    },
  },

  examens: {
    but: 'Les examens blancs : sessions d’entraînement avant les examens officiels.',
    etapes: ['Choisissez la session.', 'Consultez les résultats.'],
    roles: {
      admin: { but: 'Organiser les sessions d’examens blancs.', etapes: ['Onglet « Types d’examen » : saisissez les examens de votre pays (BEPC, BAC, DEF, CEP…) avec leurs niveaux et leurs coefficients (une liste, ou une par série). Modifiez, masquez ou retirez-les à tout moment.', 'Créez une session avec « Créer la session ». Choisissez l’un de vos examens ou « Autre examen » : dans ce dernier cas, donnez-lui le nom voulu et choisissez librement les classes et les coefficients.', 'Les notes sont saisies, puis les résultats sont publiés aux familles quand tout est prêt.', 'Une session publiée peut être remise en brouillon pour corriger.'] },
      directeur: { but: 'Suivre les sessions d’examens blancs.', etapes: ['Choisissez la session.', 'Consultez les résultats par classe.', 'Publiez ou repassez en brouillon si besoin.'] },
      enseignant: { but: 'Saisir les notes de vos élèves à l’examen blanc.', etapes: ['Choisissez la session et la matière.', 'Saisissez les notes.', 'Cliquez sur « Enregistrer les notes ».'] },
      parent: { but: 'Les résultats de votre enfant aux examens blancs.', etapes: ['Choisissez l’enfant.', 'Consultez ses résultats par matière.'] },
      eleve: { but: 'Tes résultats aux examens blancs.', etapes: ['Consulte tes notes par matière.', 'Repère les matières à retravailler.'] },
    },
  },

  messages: {
    but: 'La messagerie interne entre l’école, le personnel et les familles.',
    etapes: [
      'Ouvrez une conversation pour la lire et « Répondre ».',
      'Pour écrire un nouveau message : choisissez les destinataires, écrivez, puis « Envoyer ».',
      '« Ajouter tous les parents affichés » écrit à toute une classe ; « Tout désélectionner » remet à zéro.',
    ],
    erreurs: ['Le destinataire n’apparaît pas : vous n’avez pas le droit de lui écrire avec votre rôle.'],
    astuce: 'Pour une urgence, appelez directement ou utilisez le bouton WhatsApp des fiches.',
  },

  profil: {
    but: 'Votre photo, vos informations personnelles et votre mot de passe.',
    etapes: [
      'Cliquez sur l’appareil photo pour ajouter ou changer votre photo (JPG, PNG ou WebP, 2 Mo au plus) ; « Retirer » la supprime.',
      'Mettez à jour votre téléphone et votre e-mail, puis « Enregistrer les modifications ».',
      'Pour changer votre mot de passe : saisissez l’ancien, puis le nouveau deux fois, et « Changer le mot de passe ».',
      'Choisissez votre langue et votre thème (clair, sombre, nuit ou automatique) avec les sélecteurs en haut de page.',
    ],
    erreurs: ['Le mot de passe est refusé : il doit faire au moins 6 caractères et être différent de l’actuel.', 'La photo est refusée : vérifiez le format et le poids (2 Mo au plus).'],
    astuce: 'Une adresse e-mail à jour permet de recevoir vos accès et de réinitialiser seul votre mot de passe.',
  },

  stats: {
    but: 'Des graphiques et des chiffres pour comprendre l’école : résultats, assiduité, discipline, finances.',
    etapes: ['Choisissez la période et, si proposé, la classe ou la matière.', 'Lisez les graphiques : survolez-les pour voir les valeurs.', 'Repérez les écarts : classes en difficulté, mois creux, absences.'],
    astuce: 'Les statistiques se limitent à ce que votre rôle a le droit de voir.',
    roles: {
      parent: { but: 'La progression de votre enfant au fil des périodes.', etapes: ['Choisissez l’enfant.', 'Regardez l’évolution de la moyenne et sa place dans la classe.'], astuce: '' },
      eleve: { but: 'Ta progression au fil des périodes.', etapes: ['Regarde l’évolution de ta moyenne.', 'Repère les matières où tu progresses ou où tu baisses.'], astuce: '' },
      enseignant: { but: 'Les résultats de vos matières et de vos classes.', etapes: ['Choisissez la matière.', 'Comparez les moyennes par classe.'] },
      comptable: { but: 'Les statistiques financières : encaissements, impayés et moyens de paiement.', etapes: ['Lisez les encaissements par mois.', 'Comparez le cumul encaissé au montant attendu.', 'Repérez les classes qui ont le plus d’impayés.'] },
    },
  },
};

/* ------------------------------------------------------------ guides par rôle */

export const GUIDES: Record<Role, RoleGuide> = {
  fondateur: {
    resume: 'Vous suivez la santé de l’école : effectifs, finances, résultats, assiduité et discipline. Votre espace est surtout en consultation.',
    peut: ['Voir le tableau de bord et les statistiques de toute l’école', 'Consulter les élèves, les classes et les résultats', 'Suivre les paiements, les impayés et les tarifs', 'Lire le journal d’activité', 'Envoyer des messages'],
    nePeutPas: ['Saisir des notes ou publier des bulletins (direction et enseignants)', 'Inscrire des élèves (secrétariat)', 'Encaisser un paiement (comptable)'],
    parcours: [
      { titre: 'Chaque semaine', etapes: ['Ouvrez le tableau de bord.', 'Regardez les encaissements et les impayés.', 'Consultez les statistiques d’assiduité.'] },
      { titre: 'Fin de période', etapes: ['Consultez les résultats par classe.', 'Vérifiez le journal d’activité.', 'Échangez avec la direction.'] },
    ],
    contact: 'la direction de l’école',
  },
  directeur: {
    resume: 'Vous pilotez la pédagogie et la discipline : vous publiez les notes, validez les sanctions, signez les bulletins et prenez les décisions de fin d’année.',
    peut: ['Publier les notes et verrouiller une période', 'Rédiger l’appréciation du conseil de classe et générer les bulletins', 'Valider ou refuser les sanctions graves', 'Prendre les décisions de fin d’année', 'Publier des annonces', 'Consulter les finances et le journal'],
    nePeutPas: ['Créer des comptes (secrétariat ou informatique)', 'Encaisser des paiements (comptable)', 'Inscrire des élèves (secrétariat)'],
    parcours: [
      { titre: 'Chaque semaine', etapes: ['Traitez « À valider » sur le tableau de bord.', 'Validez les sanctions en attente.', 'Consultez les élèves les plus absents.'] },
      { titre: 'Fin de période', etapes: ['Vérifiez les résultats provisoires.', 'Publiez les notes.', 'Rédigez les appréciations du conseil de classe.', 'Générez les bulletins.', 'Verrouillez la période.'] },
      { titre: 'Fin d’année', etapes: ['Ouvrez « Décisions de fin d’année ».', 'Validez classe par classe.'] },
    ],
    contact: 'le fondateur ou l’informaticien de l’école',
  },
  admin: {
    resume: 'Vous gérez l’administration : inscriptions, classes, matières, comptes et réglages. Vous êtes le premier contact des familles.',
    peut: ['Inscrire et modifier des élèves, par saisie ou par fichier', 'Créer les classes et les matières', 'Créer les comptes et réinitialiser les mots de passe', 'Régler l’identité de l’école', 'Construire l’emploi du temps et les examens blancs', 'Générer les bulletins', 'Publier des annonces'],
    nePeutPas: ['Publier les notes (direction)', 'Encaisser des paiements (comptable)', 'Valider les sanctions (direction)'],
    parcours: [
      { titre: 'Rentrée', etapes: ['Réglez l’identité de l’école.', 'Créez les classes et les matières.', 'Importez les élèves et leurs parents.', 'Créez les comptes du personnel.', 'Remettez les identifiants aux familles.'] },
      { titre: 'Au quotidien', etapes: ['Inscrivez les nouveaux élèves.', 'Réinitialisez les mots de passe perdus.', 'Corrigez les dossiers.'] },
      { titre: 'Fin de période', etapes: ['Contrôlez les notes saisies.', 'Générez et imprimez les bulletins.'] },
    ],
    contact: 'la direction de l’école',
  },
  enseignant: {
    resume: 'Vous faites l’appel, saisissez les notes de vos matières, rédigez vos appréciations et remplissez le cahier de textes.',
    peut: ['Faire l’appel', 'Créer des évaluations et saisir les notes de vos classes', 'Rédiger les appréciations des bulletins', 'Remplir le cahier de textes', 'Saisir les notes des examens blancs', 'Voir votre emploi du temps et écrire aux parents'],
    nePeutPas: ['Publier les notes aux familles (direction)', 'Modifier une période verrouillée', 'Voir les finances ni les comptes'],
    parcours: [
      { titre: 'À chaque cours', etapes: ['Faites l’appel.', 'Remplissez le cahier de textes.'] },
      { titre: 'Après une évaluation', etapes: ['Créez l’évaluation.', 'Saisissez les notes.', 'Enregistrez.', 'Prévenez la direction pour la publication.'] },
      { titre: 'Fin de période', etapes: ['Rédigez vos appréciations.', 'Vérifiez que toutes vos notes sont saisies avant le verrouillage.'] },
    ],
    contact: 'la direction ou le secrétariat',
  },
  educateur: {
    resume: 'Vous suivez l’assiduité et la discipline des élèves : appel, retards, justificatifs et incidents.',
    peut: ['Faire l’appel et suivre les absences et retards', 'Accepter ou refuser les justificatifs', 'Signaler des incidents et proposer des sanctions', 'Consulter les élèves et les classes', 'Écrire aux parents'],
    nePeutPas: ['Valider les sanctions graves (direction)', 'Saisir ou publier des notes', 'Voir les finances'],
    parcours: [
      { titre: 'Chaque jour', etapes: ['Vérifiez l’appel du matin.', 'Traitez les justificatifs reçus.', 'Signalez les incidents du jour.'] },
      { titre: 'Chaque semaine', etapes: ['Consultez le rapport par classe.', 'Contactez les parents des élèves très absents.'] },
    ],
    contact: 'la direction de l’école',
  },
  comptable: {
    resume: 'Vous gérez l’argent de l’école : encaissements, reçus, impayés, tarifs et rapprochement avec le mobile money.',
    peut: ['Enregistrer les paiements et remettre les reçus', 'Annuler un paiement avec motif', 'Relancer les familles en retard', 'Régler les tarifs et les échéances', 'Rapprocher les relevés mobile money', 'Reprendre les anciens paiements par fichier'],
    nePeutPas: ['Voir les notes ni les dossiers pédagogiques', 'Créer des comptes', 'Inscrire des élèves'],
    parcours: [
      { titre: 'Chaque jour', etapes: ['Enregistrez chaque versement reçu.', 'Remettez le reçu à la famille.'] },
      { titre: 'Chaque semaine', etapes: ['Ouvrez « Impayés ».', 'Relancez les familles en retard.'] },
      { titre: 'Chaque mois', etapes: ['Importez le relevé mobile money.', 'Rapprochez et corrigez les écarts.', 'Consultez les statistiques financières.'] },
    ],
    contact: 'la direction ou le fondateur',
  },
  informatique: {
    resume: 'Vous assurez le côté technique : comptes d’accès, journal d’activité et identité de l’école.',
    peut: ['Créer les comptes et réinitialiser les mots de passe', 'Désactiver un accès', 'Consulter le journal d’activité', 'Régler l’identité de l’école', 'Publier des annonces'],
    nePeutPas: ['Voir les notes, les finances ou les dossiers des élèves', 'Publier des bulletins'],
    parcours: [
      { titre: 'Rentrée', etapes: ['Créez les comptes du personnel.', 'Vérifiez l’identité de l’école.'] },
      { titre: 'Au quotidien', etapes: ['Réinitialisez les mots de passe perdus.', 'Désactivez les accès des personnes parties.', 'Consultez le journal en cas de doute.'] },
    ],
    contact: 'la direction de l’école',
  },
  personnel: {
    resume: 'Votre rôle a été défini par l’école : vous avez accès aux pages qui correspondent aux droits que la direction vous a donnés.',
    peut: ['Utiliser les pages affichées dans votre menu', 'Envoyer des messages et lire les annonces'],
    nePeutPas: ['Ouvrir une page qui n’est pas dans votre menu', 'Modifier vos propres droits'],
    parcours: [{ titre: 'Au quotidien', etapes: ['Ouvrez les pages de votre menu.', 'Si une page manque, demandez à la personne qui gère les accès de vous donner le droit correspondant.'] }],
    contact: 'la personne qui gère les rôles et les accès dans votre école',
  },
  parent: {
    resume: 'Vous suivez la scolarité de votre enfant : notes, absences, bulletins, emploi du temps et paiement des frais.',
    peut: ['Voir les notes publiées et les bulletins', 'Voir les absences et envoyer un justificatif', 'Payer la scolarité par mobile money et télécharger les reçus', 'Consulter l’emploi du temps et le cahier de textes', 'Écrire à l’école', 'Lire les annonces'],
    nePeutPas: ['Modifier les notes ni les informations de l’école', 'Voir les autres élèves'],
    parcours: [
      { titre: 'Chaque semaine', etapes: ['Ouvrez l’accueil.', 'Regardez les absences et les notes récentes.', 'Lisez les annonces.'] },
      { titre: 'Pour payer', etapes: ['Ouvrez « Scolarité et paiement ».', 'Payez par mobile money.', 'Téléchargez votre reçu.'] },
      { titre: 'Fin de période', etapes: ['Ouvrez « Bulletins ».', 'Imprimez le bulletin.'] },
    ],
    contact: SECRETARIAT,
  },
  eleve: {
    resume: 'Ton espace pour suivre tes notes, tes absences, ton emploi du temps et le travail à faire.',
    peut: ['Voir tes notes publiées et tes bulletins', 'Voir tes absences', 'Consulter l’emploi du temps et le cahier de textes', 'Voir tes résultats aux examens blancs', 'Lire les annonces'],
    nePeutPas: ['Modifier tes notes', 'Voir les autres élèves', 'Voir la partie financière (c’est l’espace des parents)'],
    parcours: [
      { titre: 'Chaque jour', etapes: ['Regarde l’emploi du temps.', 'Consulte le travail à faire dans le cahier de textes.'] },
      { titre: 'Après une évaluation', etapes: ['Attends la publication.', 'Consulte ta note et la moyenne de la classe.'] },
    ],
    contact: SECRETARIAT,
  },
};

/* ------------------------------------------------------------ visite guidée */

const FIN: TourStep = { titre: 'L’aide est toujours là', texte: 'Cliquez sur le bouton « ? » en haut de la page à tout moment : il explique la page où vous êtes. Vous pouvez aussi relancer cette visite depuis l’onglet « Mon espace ».' };

export const TOUR: Record<Role, TourStep[]> = {
  fondateur: [
    { titre: 'Bienvenue', texte: 'Votre espace vous donne une vue d’ensemble de l’école : effectifs, finances, résultats et assiduité.' },
    { titre: 'Le tableau de bord', texte: 'La page d’accueil résume l’essentiel. Ouvrez « Statistiques » pour le détail et « Impayés » pour les retards de paiement.' },
    FIN,
  ],
  directeur: [
    { titre: 'Bienvenue', texte: 'Vous publiez les notes, validez les sanctions et signez les bulletins.' },
    { titre: 'À valider', texte: 'Sur le tableau de bord, le bloc « À valider » rassemble ce qui attend votre décision.' },
    { titre: 'Fin de période', texte: 'Dans « Notes et publication », publiez les notes puis verrouillez la période. Ensuite, générez les bulletins.' },
    FIN,
  ],
  admin: [
    { titre: 'Bienvenue', texte: 'Vous gérez l’administration de l’école : élèves, classes, comptes et réglages.' },
    { titre: 'Inscrire des élèves', texte: 'Dans « Élèves », inscrivez un élève ou importez tout un fichier Excel, avec vérification avant validation.' },
    { titre: 'Les comptes', texte: 'Dans « Comptes », créez les accès du personnel et réinitialisez un mot de passe perdu. Le mot de passe provisoire n’est montré qu’une fois.' },
    FIN,
  ],
  enseignant: [
    { titre: 'Bienvenue', texte: 'Vous faites l’appel, saisissez vos notes et remplissez le cahier de textes.' },
    { titre: 'L’appel', texte: 'En début de cours, ouvrez « Appel », cliquez sur « Tout le monde présent », marquez les absents, puis enregistrez.' },
    { titre: 'Les notes', texte: 'Dans « Saisie des notes », créez une évaluation puis saisissez les notes. La direction les publie ensuite aux familles.' },
    FIN,
  ],
  educateur: [
    { titre: 'Bienvenue', texte: 'Vous suivez l’assiduité et la discipline des élèves.' },
    { titre: 'Justificatifs', texte: 'Dans « Présences », traitez les justificatifs envoyés par les parents : acceptez ou refusez avec un motif.' },
    { titre: 'Incidents', texte: 'Dans « Discipline », signalez un incident. Les cas graves partent en validation à la direction.' },
    FIN,
  ],
  comptable: [
    { titre: 'Bienvenue', texte: 'Vous gérez les encaissements et le suivi des paiements.' },
    { titre: 'Encaisser', texte: 'Dans « Paiements », enregistrez chaque versement, puis remettez le reçu à la famille.' },
    { titre: 'Relancer', texte: 'Dans « Impayés », relancez les familles en retard, une par une ou toutes ensemble.' },
    { titre: 'Mobile money', texte: 'Dans « Rapprochement », importez le relevé de l’opérateur pour vérifier que tout correspond.' },
    FIN,
  ],
  personnel: [
    { titre: 'Bienvenue', texte: 'Votre menu dépend des droits que l’école vous a donnés. Si une page manque, demandez-la à la personne qui gère les accès.' },
    { titre: 'Votre accueil', texte: 'La page d’accueil propose des raccourcis vers les pages que vos droits ouvrent, ainsi que vos notifications et les annonces de l’école.' },
    FIN,
  ],
  informatique: [
    { titre: 'Bienvenue', texte: 'Vous gérez les accès et la partie technique de l’école.' },
    { titre: 'Les comptes', texte: 'Dans « Comptes », créez, réinitialisez ou désactivez les accès.' },
    { titre: 'Le journal', texte: 'Le « Journal d’activité » garde la trace de qui a fait quoi : utile en cas de doute.' },
    FIN,
  ],
  parent: [
    { titre: 'Bienvenue', texte: 'Vous suivez la scolarité de votre enfant : notes, absences, bulletins et paiement des frais.' },
    { titre: 'Notes et bulletins', texte: 'Les notes apparaissent quand l’école les publie. Les bulletins sont imprimables.' },
    { titre: 'Absences', texte: 'Si votre enfant est absent, ouvrez « Absences et discipline », puis « Justifier » pour envoyer le motif.' },
    { titre: 'Payer', texte: 'Dans « Scolarité et paiement », payez par Orange Money, MTN Money, Moov Money ou Wave, puis téléchargez le reçu.' },
    FIN,
  ],
  eleve: [
    { titre: 'Bienvenue', texte: 'Voici ton espace pour suivre tes notes, tes absences et ton travail à faire.' },
    { titre: 'Ton emploi du temps', texte: 'Retrouve tes cours de la semaine et le travail à faire dans le cahier de textes.' },
    { titre: 'Tes notes', texte: 'Tes notes apparaissent quand l’école les publie, avec la moyenne de la classe pour te situer.' },
    FIN,
  ],
};

/* ------------------------------------------------------------ questions fréquentes */

export const FAQ: Faq[] = [
  { q: 'J’ai oublié mon mot de passe', r: 'Personnel : sur l’écran de connexion, cliquez sur « Mot de passe oublié ? » et suivez le lien reçu par e-mail. Parents et élèves : demandez au secrétariat, qui vous remettra un nouveau mot de passe provisoire.' },
  { q: 'Je suis déconnecté tout seul', r: 'Par sécurité, la session se ferme après 20 minutes sans activité. Reconnectez-vous ; pensez à enregistrer avant de vous éloigner.' },
  { q: 'Pourquoi je ne vois pas telle page ou tel bouton ?', r: 'Chaque rôle voit uniquement ce qui le concerne. Si une action vous manque, ouvrez l’onglet « Mon espace » pour voir ce que votre rôle permet, ou contactez la direction.' },
  { q: 'Je n’ai pas reçu mes accès par e-mail', r: 'Regardez dans vos courriers indésirables, puis demandez à l’administration de l’école de vérifier votre adresse et de créer un nouveau mot de passe provisoire : il vous sera renvoyé par e-mail ou remis directement.', roles: ['fondateur', 'directeur', 'admin', 'enseignant', 'educateur', 'comptable', 'informatique', 'personnel'] },
  { q: 'Avec quoi me connecter ?', r: 'Avec le code de l’école (s’il est demandé), votre identifiant et votre mot de passe. Personnel : l’identifiant donné par l’école. Parents : votre numéro de téléphone. Élèves : le matricule. À la première connexion, vous choisissez votre propre mot de passe.' },
  { q: 'Comment changer ma photo ?', r: 'Ouvrez « Mon profil » et cliquez sur l’appareil photo. Formats acceptés : JPG, PNG, WebP, 2 Mo au plus.' },
  { q: 'Quelqu’un peut-il me donner d’autres droits ?', r: 'Oui : la personne qui gère les rôles de l’école (souvent le fondateur ou l’informatique) peut ajouter des droits à votre rôle, ou vous donner un autre rôle. Vous verrez alors de nouvelles pages dans votre menu.', roles: ['directeur', 'admin', 'enseignant', 'educateur', 'comptable', 'informatique', 'personnel'] },
  { q: 'Y a-t-il un raccourci pour ouvrir l’aide ?', r: 'Oui : appuyez sur la touche « ? » (hors d’un champ de saisie). Échap ferme l’aide.' },
  { q: 'Comment changer la langue ?', r: 'Utilisez le sélecteur de langue en haut de la page. Certaines explications de l’aide restent en français.' },
  { q: 'Comment changer mon mot de passe ?', r: 'Ouvrez le menu de votre nom en haut à droite, puis « Mon profil » et « Changer le mot de passe ».' },
  { q: 'Comment imprimer un bulletin ?', r: 'Ouvrez le bulletin, puis utilisez le bouton « Imprimer ». Dans la fenêtre d’impression, vous pouvez choisir d’enregistrer en PDF.' },
  { q: 'Une note publiée est fausse, que faire ?', r: 'L’enseignant corrige la note (la modification est immédiatement visible) ou la direction retire la publication, fait corriger, puis republie.', roles: ['enseignant', 'directeur', 'admin'] },
  { q: 'Une note n’apparaît pas', r: 'Les notes ne sont visibles des familles qu’après leur publication par la direction. Si elle tarde, contactez l’école.', roles: ['parent', 'eleve'] },
  { q: 'Comment payer la scolarité par mobile money ?', r: 'Ouvrez « Scolarité et paiement », choisissez Orange Money, MTN Money, Moov Money ou Wave, validez sur votre téléphone puis cliquez sur « J’ai validé sur mon téléphone ». Le reçu est ensuite téléchargeable.', roles: ['parent'] },
  { q: 'J’ai payé mais le paiement n’apparaît pas', r: 'Attendez quelques minutes puis actualisez. Sinon, contactez la comptabilité avec le numéro de transaction reçu de l’opérateur.', roles: ['parent'] },
  { q: 'Comment justifier une absence ?', r: 'Ouvrez « Absences et discipline », cliquez sur « Justifier » à côté de l’absence, écrivez le motif et envoyez. L’éducateur accepte ou refuse.', roles: ['parent'] },
  { q: 'J’ai fait une erreur sur un paiement', r: 'Ne supprimez rien : utilisez « Annuler le paiement » avec un motif, puis enregistrez le bon paiement. Tout est conservé dans le journal.', roles: ['comptable'] },
  { q: 'Comment inscrire beaucoup d’élèves rapidement ?', r: 'Dans « Élèves », utilisez l’import par fichier : téléchargez le modèle, remplissez-le, puis « Vérifier le fichier » avant de valider. Les erreurs sont listées ligne par ligne.', roles: ['admin'] },
  { q: 'Comment remettre les identifiants aux familles ?', r: 'Après un import ou une création de compte, l’écran affiche les identifiants et mots de passe provisoires une seule fois : imprimez-les ou notez-les aussitôt. Chaque famille choisira son mot de passe à la première connexion.', roles: ['admin', 'informatique'] },
  { q: 'Une période est verrouillée, que faire ?', r: 'Seule la direction peut la déverrouiller depuis « Notes et publication ». Demandez-lui si une correction est nécessaire.', roles: ['enseignant', 'directeur'] },
];

/* ------------------------------------------------------------ utilitaires */

/** Aide d’une page pour un rôle donné : le contenu général, complété par la variante du rôle. */
export function helpFor(role: Role | null | undefined, page: PageId): HelpPage {
  const entry = PAGES[page];
  const { roles, ...base } = entry;
  const over = role ? roles?.[role] : undefined;
  return { ...base, ...(over ?? {}) };
}

export function faqFor(role: Role | null | undefined): Faq[] {
  return FAQ.filter((f) => !f.roles || (role ? f.roles.includes(role) : false));
}

/** Texte brut d’une entrée, pour la recherche. */
export function searchHelp(role: Role | null | undefined, query: string, allowed?: readonly PageId[]): { kind: 'page' | 'faq'; id: string; title: string; extrait: string }[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => norm(text).includes(w));
  const out: { kind: 'page' | 'faq'; id: string; title: string; extrait: string }[] = [];
  for (const f of faqFor(role)) if (hit(f.q + ' ' + f.r)) out.push({ kind: 'faq', id: f.q, title: f.q, extrait: f.r });
  for (const p of (allowed ?? (Object.keys(PAGES) as PageId[]))) {
    const h = helpFor(role, p);
    const text = [h.but, ...h.etapes, ...(h.erreurs ?? []), h.astuce ?? ''].join(' ');
    if (hit(text)) out.push({ kind: 'page', id: p, title: PAGE_TITLE[p], extrait: h.but });
  }
  return out.slice(0, 12);
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const PAGE_TITLE: Record<PageId, string> = {
  dashboard: 'Accueil et tableau de bord', eleves: 'Élèves', eleve: 'Fiche élève', classes: 'Classes', matieres: 'Matières et coefficients', comptes: 'Comptes',
  parametres: 'Paramètres', annonces: 'Annonces', journal: 'Journal d’activité', notes: 'Notes', bulletins: 'Bulletins', appel: 'Appel', presences: 'Présences et absences',
  paiements: 'Paiements', caisse: 'Caisse du jour', impayes: 'Impayés', tarifs: 'Tarifs et échéances', rapprochement: 'Rapprochement mobile money', payer: 'Scolarité et paiement',
  discipline: 'Discipline', decisions: 'Bilan de fin d’année', edt: 'Emploi du temps', cahier: 'Cahier de textes', devoirs: 'Devoirs et épreuves', cours: 'Supports de cours', roles: 'Rôles et accès', examens: 'Examens blancs',
  messages: 'Messagerie', profil: 'Mon profil', stats: 'Statistiques', annee: 'Fin d’année et nouvelle année', anciens: 'Anciens élèves et exclus', archives: 'Années précédentes', repartition: 'Répartition des enseignants', conduite: 'Conduite', educateurs: 'Éducateurs et leurs classes', maclasse: 'Ma classe (professeur principal)',
};
