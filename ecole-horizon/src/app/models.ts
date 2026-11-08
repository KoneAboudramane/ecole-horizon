export type Role = 'fondateur' | 'directeur' | 'admin' | 'enseignant' | 'educateur' | 'comptable' | 'informatique' | 'personnel' | 'parent' | 'eleve';
/** Identifiant d'une période d'évaluation (T1, T2… ou P4) : le nom et les dates sont propres à l'école. */
export type TermId = string;
/** Groupe de coefficients : un niveau du collège (« 6e ») ou une série du lycée (« Tle C »), propre à l'école. */
export type Groupe = string;
/** Niveaux d'une nouvelle école (système ivoirien) ; chaque école les modifie (Paramètres > Niveaux et séries). */
export const COLLEGE_LEVELS = ['6e', '5e', '4e', '3e'];
export const LYCEE_LEVELS = ['2nde', '1ère', 'Tle'];
/** Niveau de classe de l'école, dans l'ordre du cursus (le suivant = passage ; le dernier = fin de cursus). */
export interface Level { id: string; name: string; order: number; cycle: 'college' | 'lycee'; hasSeries: boolean; classes: number; }
/** Série du lycée de l'école (A, C, D, A1, E…) pour un niveau ; `groupe` = « niveau code ». */
export interface Serie { id: string; level: string; code: string; name: string; groupe: string; classes: string[]; }
export type EvalType = 'interro' | 'devoir' | 'composition';
export type PayMode = 'especes' | 'virement' | 'cheque' | 'orange' | 'mtn' | 'moov' | 'wave';
export type TemplateId = 'classique' | 'moderne' | 'compact';
/** Séance d'appel : demi-journée (vie scolaire) ou heure de cours de l'emploi du temps (« C1 », « C2 »…). */
export type Slot = 'Matin' | 'Après-midi' | `C${number}`;
export type Justif = 'aucune' | 'en_attente' | 'acceptee' | 'refusee';

export type PageId =
  | 'dashboard' | 'eleves' | 'eleve' | 'classes' | 'matieres' | 'comptes' | 'parametres'
  | 'annonces' | 'journal' | 'notes' | 'bulletins' | 'appel' | 'presences'
  | 'paiements' | 'caisse' | 'impayes' | 'tarifs' | 'rapprochement' | 'payer' | 'discipline'
  | 'decisions' | 'edt' | 'cahier' | 'examens' | 'messages' | 'profil' | 'stats' | 'annee' | 'anciens' | 'archives' | 'repartition' | 'conduite' | 'educateurs' | 'devoirs' | 'cours' | 'roles' | 'maclasse';

export interface User {
  id: string;
  username: string;
  password: string;
  role: Role;
  name: string;
  phone: string;
  active: boolean;
  mustChange: boolean;
  refId?: string; // id de l'élève, du parent ou de l'enseignant
  email?: string;
  photo?: string; // image réduite, en data URL
  lang?: string; // langue préférée
  perms?: string[]; // droits envoyés par le serveur (rôle de l'école, modifiable) ; sans serveur : la table PERMS
  roleLabel?: string; // nom du rôle choisi par l'école
  cursus?: string[]; // école à plusieurs cursus : cursus où travaille ce compte du personnel ; vide = tous
}

export interface PassageLevel { admission: number; redoublement: number; exclusion: number | null; }

export interface SchoolSettings {
  name: string;
  logo?: string;
  address: string;
  phone: string;
  email: string;
  director: string;
  directorName?: string; // nom imprimé sur les bulletins : Paramètres, sinon compte de direction (serveur)
  year: string;
  hue: number;
  template: TemplateId;
  compoWeight: number; // poids de la composition dans la moyenne de matière (0 à 1)
  seuils: [number, number, number, number]; // très bien, bien, assez bien, passable
  remiseFratrie: number; // % de remise sur la scolarité du 2e enfant et suivants d'un même parent
  passageAdmission?: number; // moyenne annuelle à partir de laquelle l'élève passe en classe supérieure
  passageRedoublement?: number; // en dessous : redoublement (entre les deux : conseil de classe)
  passageExclusion?: number | null; // facultatif : en dessous, l'exclusion est proposée
  passageNiveaux?: Record<string, PassageLevel>; // exceptions par niveau (6e, 5e…) ; un niveau absent suit la règle de l'école
  conduiteMax?: number; // note de conduite de départ (20 par défaut)
  devoirsActifs?: boolean; // devoirs à rendre et épreuves en ligne ouverts par l’école (non par défaut)
  bulletinBlocage?: 'aucun' | 'retard' | 'total'; // bulletin des familles bloqué si impayé : échéances échues (« retard », par défaut) ou toute la scolarité
  entetePays?: string; // en-tête du bulletin (modèle classique) : « République de Côte d’Ivoire » par défaut ; vide = ligne omise
  enteteDevise?: string; // « Union – Discipline – Travail » par défaut
  eleveVoitCahier?: boolean; // l'élève voit le cahier de textes (non par défaut : réservé aux parents et au personnel)
  conduiteInAverage?: boolean; // la conduite entre dans la moyenne générale (oui par défaut)
  conduiteCoef?: number;
  absenceTranche?: number; // absences non justifiées par retrait (0 : aucune règle)
  absencePoints?: number; // points retirés par tranche
  justifDelai?: number; // jours laissés aux familles pour justifier une absence (0 : sans délai)
  conduiteBaremes?: Record<string, number>; // retrait conseillé par sanction
}

export interface Classe {
  id: string;
  name: string;
  level: string;
  serie?: string;
  groupe: Groupe;
  max: number;
  cycle: 'college' | 'lycee';
  roomId?: string; // salle principale (mode serveur)
  principalId?: string; // professeur principal (enseignant), attribué par la direction ou le secrétariat
}

export interface Subject { id: string; name: string; short: string; }
export interface Teacher { id: string; userId: string; name: string; phone: string; subjectIds: string[]; maxHours?: number | null; }
export interface Parent { id: string; userId: string; name: string; phone: string; studentIds: string[]; }

export interface Student {
  id: string;
  matricule: string;
  nom: string;
  prenoms: string;
  sexe: 'M' | 'F';
  naissance: string;
  lieu: string;
  classId: string;
  parentId: string;
  userId: string;
  urgence: string;
  active?: boolean;
  sortie?: '' | 'exclu' | 'ancien' | 'parti' | 'placer'; // « placer » : passé dans la nouvelle année, en attente d'une classe
  soldeSortie?: number;
  niveauxRedoubles?: string[]; // niveaux déjà redoublés (« 5e »…) : un 2e redoublement du même niveau mène à l'exclusion
  level?: string; // niveau (celui de la classe, ou le nouveau niveau d'un élève « à placer » : classId vaut alors « placer:5e »)
  reinscription?: '' | 'attente' | 'paye' | 'valide'; // élève à placer : rien payé, payé (à valider par le secrétariat), réinscription validée
  cursusId?: string; cursusNom?: string; // école à plusieurs cursus : cursus de cette inscription
  principalId?: string; // inscription dans un autre cursus : inscription principale de la même personne
  classLabel?: string; // classe telle que donnée par le serveur (utile pour une inscription d'un autre cursus que celui affiché)
}

export interface Assignment { id: string; teacherId: string; subjectId: string; classId: string; }
export interface Term { id: TermId; label: string; start: string; end: string; locked: boolean; conductPublished?: boolean; coef?: number; } // coef : poids dans la moyenne annuelle
/** Bilan de l'année (bulletin de la dernière période) : moyenne de chaque période et son coefficient, moyenne et rang annuels, chiffres de la classe. */
export interface AnnualSummary { periodes: { label: string; coef: number; moy: number | null }[]; moyenne: number | null; rang: number | null; effectif: number; avg: number | null; max: number | null; min: number | null; }

export interface Evaluation {
  id: string;
  classId: string;
  subjectId: string;
  termId: TermId;
  type: EvalType;
  title: string;
  date: string;
  published: boolean;
  teacherId: string;
  scheduled?: boolean; // programmée par l'école
  coef?: number; // poids dans la moyenne de la matière (1 par défaut)
  bareme?: number; // note maximale : sur 10, 20, 30… (20 par défaut). Les notes sont gardées sur ce barème, les moyennes les ramènent sur 20.
}

export interface Absence {
  id: string;
  studentId: string;
  classId: string;
  date: string;
  slot: Slot;
  status: 'A' | 'R';
  justif: Justif;
  motif?: string;
}

export interface Payment {
  id: string;
  studentId: string;
  amount: number;
  mode: PayMode;
  ref?: string;
  date: string;
  receiptNo: string;
  status: 'confirme' | 'annule';
  byUserId: string;
  /** Nom de l'encaisseur donné par le serveur (la liste des comptes n'est pas accessible à tous). */
  byName?: string;
  note?: string;
  /** Part gardée en avance (au-delà du solde dû). */
  advance?: number;
  /** Année scolaire du paiement (libellé), donnée par le serveur. */
  yearLabel?: string;
  /** Détail figé sur le reçu : ce que ce paiement a réglé par échéance et ce qui reste. */
  detail?: PaymentDetail;
}

export interface PaymentDetailLine { key: string; label: string; due?: string; amount: number; paidBefore: number; paidNow: number; remaining: number }
export interface PaymentDetail {
  lines: PaymentDetailLine[]; total: number; paidBefore: number; paidAfter: number; remaining: number; credit: number;
  discountPct: number; discountAmount: number; next?: { label: string; due?: string; remaining: number }; reconstructed?: boolean;
}
export interface FinanceYear { label: string; current: boolean; collected: number; count: number; cancelled: number; advances: number; carriedOver: number | null; carriedCredit: number | null }
export interface CashClosing { date: string; expected: number; counted: number; gap: number; note: string; by: string }
export interface CashDay {
  date: string; total: number; count: number; expectedCash: number; byMode: { mode: PayMode; count: number; total: number }[];
  cancelled: { receiptNo: string; student: string; amount: number; note: string }[]; closing: CashClosing | null;
}
export interface StudentStatement {
  studentId: string; name: string; matricule: string; className: string;
  years: { label: string; report: number; credit: number; paid: number; payments: { id: string; receiptNo: string; date: string; amount: number; mode: PayMode; status: 'confirme' | 'annule'; advance: number }[] }[];
}

export interface StatementLine {
  id: string;
  ref: string;
  date: string;
  mode: PayMode;
  amount: number;
  phone: string;
  paymentId?: string;
}

export interface Notice {
  id: string;
  userId: string;
  text: string;
  date: string;
  read: boolean;
  kind: 'note' | 'absence' | 'paiement' | 'annonce' | 'compte' | 'systeme' | 'discipline';
  page?: PageId;
}

export interface Decision {
  studentId: string;
  value: 'admis' | 'redouble' | 'exclu' | 'conseil';
  comment: string;
  byUserId: string;
  date: string;
  /** Enregistrée par « Valider les propositions de la classe » : annulable en lot. */
  batch?: boolean;
}

export interface LogEntry { id: string; ts: string; userId: string; userName?: string; action: string; detail: string; }

export interface Announcement {
  id: string;
  title: string;
  body: string;
  date: string;
  audience: Role[];
  authorId: string;
  cursusNoms?: string[]; // école à plusieurs cursus : cursus visés ; vide = toute l'école
}

export interface FeeItem { key: string; label: string; due: string; amount: number; }
export interface FeeLine extends FeeItem { paid: number; remaining: number; overdue: boolean; }
export interface Tarif { ins: number; sco: number; complement?: number | null; } // complement : en plus d'un autre cursus (vide = ins + sco)
/** Compte d'un élève calculé par le serveur (forfait global des élèves inscrits dans plusieurs cursus compris). */
export interface ServerAccount { lines: FeeLine[]; total: number; paid: number; balance: number; overdue: number; discount_pct: number; discount_amount: number;
  cursus_detail: { cursus: string; level: string; label: string; amount: number }[]; }

export interface SubjectResult {
  subjectId: string;
  coef: number;
  mc: number | null;
  compo: number | null;
  moy: number | null;
  rang: number | null;
  classMoy: number | null;
  classMax: number | null;
  classMin: number | null;
}

export interface StudentResult {
  studentId: string;
  subjects: SubjectResult[];
  moyenne: number | null;
  rang: number | null;
  totalPoints: number;
  totalCoef: number;
  conduite?: { note: number; max: number; coef: number; inAverage: boolean } | null;
}

/** Tableau de bord du professeur principal pour sa classe et une période : tout est en lecture, sauf l'avis du conseil. */
export interface PrincipalClass {
  classId: string; className: string; termLabel: string; locked: boolean;
  students: { id: string; nom: string; prenoms: string; matricule: string }[];
  subjects: { id: string; name: string; coef: number }[];
  evals: { id: string; subjectId: string; title: string; type: EvalType; date: string; bareme: number; coef: number; published: boolean; teacherName: string }[];
  grades: Record<string, number>; // "évaluation|élève" → note sur le barème de l'évaluation
  stats: ClassStats | undefined;
  assiduite: Record<string, { absences: number; nonJustifiees: number; retards: number }>;
  absences: { studentId: string; date: string; slot: string; status: 'A' | 'R'; justif: string; motif: string }[];
  incidents: { studentId: string; date: string; type: string; gravite: string; sanction: string; description: string; status: string }[];
  council: Partial<Record<string, string>>; // élève → avis du conseil
}

export interface ClassStats {
  classId: string;
  effectif: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  results: Map<string, StudentResult>;
}

export const ROLE_LABEL: Record<Role, string> = {
  fondateur: 'Fondateur',
  directeur: 'Directeur',
  admin: 'Secrétariat',
  enseignant: 'Enseignant',
  educateur: 'Éducateur',
  comptable: 'Comptable',
  informatique: 'Informatique',
  personnel: 'Personnel',
  parent: 'Parent',
  eleve: 'Élève',
};

// Matrice des permissions : qui peut faire quoi
export type Perm =
  | 'students.write' | 'classes.write' | 'subjects.write' | 'accounts' | 'settings' | 'publish' | 'conseil' | 'bulletins.gen'
  | 'justifs' | 'appel' | 'discipline' | 'discipline.validate' | 'pay.write' | 'pay.read' | 'tarifs.write'
  | 'rapprochement.write' | 'annonces.write' | 'journal' | 'grades.locked'
  | 'journal.sys' | 'settings.tech'
  | 'decisions.write' | 'rollover' | 'edt.write' | 'cahier.write' | 'examens.write' | 'conduite' | 'educateurs.write' | 'devoirs.write' | 'devoirs.read' | 'roles.manage' | 'stats.academic' | 'stats.finance' | 'stats.vie';

export const PERMS: Record<Role, Perm[]> = {
  fondateur: ['pay.read', 'tarifs.write', 'journal', 'roles.manage'],
  directeur: ['subjects.write', 'settings', 'publish', 'conseil', 'bulletins.gen', 'justifs', 'discipline', 'discipline.validate', 'pay.read', 'annonces.write', 'journal', 'grades.locked', 'decisions.write', 'rollover', 'edt.write', 'examens.write', 'devoirs.read', 'conduite', 'educateurs.write'],
  admin: ['students.write', 'classes.write', 'subjects.write', 'accounts', 'settings', 'bulletins.gen', 'annonces.write', 'journal', 'edt.write', 'examens.write', 'educateurs.write'],
  enseignant: ['appel', 'cahier.write', 'devoirs.write'],
  educateur: ['appel', 'justifs', 'discipline', 'conduite'],
  comptable: ['pay.write', 'pay.read', 'tarifs.write', 'rapprochement.write'],
  informatique: ['accounts', 'journal.sys', 'settings.tech'],
  personnel: [],
  parent: [],
  eleve: [],
};

// Discipline
export type Gravite = 'legere' | 'moyenne' | 'grave';
export type IncidentType = 'bavardage' | 'tenue' | 'devoirs' | 'telephone' | 'insolence' | 'bagarre' | 'fraude' | 'degradation' | 'autre';
export type Sanction = 'observation' | 'avertissement' | 'retenue' | 'travail' | 'convocation' | 'exclusion_cours' | 'exclusion_temp';
export interface Incident {
  id: string;
  studentId: string;
  date: string;
  type: IncidentType;
  gravite: Gravite;
  sanction: Sanction;
  description: string;
  status: 'valide' | 'a_valider' | 'refuse';
  byUserId: string;
  decidedBy?: string;
  decisionNote?: string;
  points?: number; // points retirés de la note de conduite
}
/** Note de conduite d'une classe pour une période (les calculs viennent du serveur). */
export interface ConductDeduction { id: string; points: number; reason: string; kind: 'absences' | 'discipline' | 'autre'; date: string; byName: string; pending: boolean; refused: boolean; }
export interface ConductRow { studentId: string; name: string; max: number; removed: number; note: number; halfdays: number; due: number; applied: number; deductions: ConductDeduction[]; }
export interface ConductSheet {
  classId: string; termId: TermId; locked: boolean; published: boolean; max: number; inAverage: boolean; coef: number;
  rule: { tranche: number; points: number }; students: ConductRow[];
}
/** Retrait de points enregistré dans la démonstration (le serveur garde les siens). */
export interface DemoDeduction { id: string; studentId: string; termId: TermId; points: number; reason: string; kind: ConductDeduction['kind']; date: string; byName: string; incidentId?: string; }
export interface Educator { id: string; name: string; classes: string[]; }
/** Retrait de points conseillé par sanction (modifiable par l'école ; l'éducateur garde toute latitude). */
export const DEFAULT_BAREMES: Record<string, number> = { observation: 0.5, avertissement: 1, retenue: 1, travail: 1, convocation: 1.5, exclusion_cours: 1.5, exclusion_temp: 3 };
export const INCIDENT_LABEL: Record<IncidentType, string> = {
  bavardage: 'Bavardage', tenue: 'Tenue non conforme', devoirs: 'Devoirs non faits', telephone: 'Téléphone en classe',
  insolence: 'Insolence', bagarre: 'Bagarre', fraude: 'Fraude ou triche', degradation: 'Dégradation de matériel', autre: 'Autre',
};
export const SANCTION_LABEL: Record<Sanction, string> = {
  observation: 'Observation écrite', avertissement: 'Avertissement', retenue: 'Retenue', travail: 'Travail d’intérêt scolaire',
  convocation: 'Convocation des parents', exclusion_cours: 'Exclusion de cours', exclusion_temp: 'Exclusion temporaire',
};
export const GRAVITE_LABEL: Record<Gravite, string> = { legere: 'Légère', moyenne: 'Moyenne', grave: 'Grave' };

export const MODE_LABEL: Record<PayMode, string> = {
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  orange: 'Orange Money',
  mtn: 'MTN Money',
  moov: 'Moov Money',
  wave: 'Wave',
};

export const ONLINE_MODES: PayMode[] = ['orange', 'mtn', 'moov', 'wave'];
export const isOnline = (m: PayMode) => ONLINE_MODES.includes(m);

export const EVAL_LABEL: Record<EvalType, string> = {
  interro: 'Interrogation',
  devoir: 'Devoir',
  composition: 'Composition',
};

