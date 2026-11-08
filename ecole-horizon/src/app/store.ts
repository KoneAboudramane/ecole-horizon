import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ConductSheet, DemoDeduction, Educator, Absence, Announcement, Assignment, Classe, ClassStats, Decision, Evaluation, EvalType, FeeLine, Incident, Justif, LogEntry, Perm, PERMS, Gravite, IncidentType, Sanction,
  Notice, PageId, Parent, PrincipalClass, Payment, PaymentDetail, FinanceYear, CashDay, CashClosing, StudentStatement, PayMode, Role, SchoolSettings, Slot, StatementLine, Student, StudentResult, AnnualSummary,
  INCIDENT_LABEL, SANCTION_LABEL, ROLE_LABEL, Subject, Teacher, Tarif, Term, TermId, User, Serie, Level, COLLEGE_LEVELS, LYCEE_LEVELS , ServerAccount } from './models';
import { allocate, coefKey, computeTerm, termCoef, weightedAnnual, currentTermOf, justifDeadline, termOfDate, yearClosedOf, DECISION_LABEL, DEFAULT_TRANCHES, discountedTarif, FeeDates, feeItems, paymentDetail, siblingPct, TrancheDef } from './engine';
import { buildSeed } from './seed';
import { DEMO_TODAY } from './format';
import { LANGS, Lang, setLang } from './i18n/i18n';
import { Api, ApiError } from './api';
import { Push } from './push';
import {
  ApiSuiviRow, SuiviRow, mapSuivi,
  ApiIntent, ApiPayment, ApiStatement, ApiAbsence, ApiIncident, ApiNotice, ApiSession, ApiAssignment, ApiClass, ApiCoef, ApiDecisionRow, ApiEval, ApiOverview, ApiParent, ApiSettings, ApiStudent, ApiSubject, ApiTeacher, ApiTerm, ApiUser,
  mapPayment, mapYear, mapCashDay, mapStatementOf, mapStatement, mapTarifs, mapFeeDates, mapAbsence, mapIncident, mapNotice, sessionKey, mapAssignment, mapClass, mapCoefs, mapSerie, ApiSerie, mapLevel, ApiLevel, mapDecision, mapEval, mapOverview, mapParents, mapSettings, mapStudent, mapSubject, mapTeacher, mapTerm, mapUser, settingsPatch,
  mapLog, ApiLog, mapAnnouncement, ApiAnnouncement, ApiConduct, ApiEducator, mapConduct, mapEducator, ApiPrincipal, mapPrincipal,
} from './api-map';

export interface RolloverRow { student: number; name: string; matricule: string; class: number; class_name: string; level: string; serie: string; next_level?: string | null; last_level?: boolean; cursus_nom?: string; annual_avg: number | null; decision: string | null; proposal: string | null; reason?: string; already_repeated?: boolean; sexe?: 'M' | 'F'; action: string | null; target: number | null; }
/** Étape 3 de la nouvelle année : élèves à placer d'un niveau et classes de ce niveau. */
export interface PlacementStudent { student: number; name: string; matricule: string; sexe: 'M' | 'F'; from_class: number | null; from_name: string; from_level: string; from_serie: string; repeat: boolean; new?: boolean; reinscrit: boolean;
  /** « valide » (réinscription validée), « paye » (payé, à valider par le secrétariat) ou « attente » (rien payé). */
  state: 'valide' | 'paye' | 'attente'; note: string; paid: number; receipts: { id: number; receipt_no: string; amount: number; date: string; mode: string }[]; }
export interface PlacementClass { id: number; name: string; serie: string; max: number; count: number; f: number; m: number; }
export interface PlacementState { year: string; total: number; confirmed: number; paid: number; waiting: number; levels: { level: string; classes: PlacementClass[]; students: PlacementStudent[] }[]; }
export interface RolloverPlan {
  from_year: string; to_year: string; rows: RolloverRow[]; classes: { id: number; name: string; level: string; serie: string; max: number }[];
  actions: Record<string, string>; settings: { admission: number; redoublement: number; exclusion: number | null; niveaux?: Record<string, unknown> };
  last: { from_year: string; to_year: string; date: string; can_undo: boolean; reason: string | null } | null;
}
export interface ArchiveRow { student: number; name: string; matricule: string; class: number; class_name: string; annual_avg: number | null; decision: string | null; sortie: string; }
/** Bulletin de l'année remis à la famille ? (`amount` : reste dû qui le bloque, selon le réglage de l'école). */
export interface BulletinAccess { mode: 'aucun' | 'retard' | 'total'; amount: number; locked: boolean; derogation: { note: string; by: string; date: string } | null; }
export interface ArchiveData { years: string[]; year: string | null; terms: { code: string; label: string }[]; rows: ArchiveRow[]; }
export interface VitrinePhoto { id: string; url: string; caption: string; }
export interface Accueil {
  nom: string; logo: string; carte: boolean; photos: VitrinePhoto[];
  /** Promotion de la plateforme : coordonnées (vides = masquées) et prix de l'abonnement (null = tarif sur demande). */
  contact?: { whatsapp: string; telephone: string; email: string }; prix?: { inscription: number; renouvellement: number } | null;
  /** Chiffres réels de la plateforme (totaux, aucun nom) ; null quand l'administrateur les masque. */
  chiffres?: { ecoles: number; eleves: number; connectes: number; paiements: number } | null;
  /** Fréquentation de la page d'accueil (visiteurs comptés une fois par jour) ; null quand l'administrateur la masque. */
  visiteurs?: { aujourdhui: number; mois: number; total: number } | null;
}
export interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info'; }
export interface Credential { label: string; username: string; password: string; }
export interface NewStudentForm {
  nom: string; prenoms: string; sexe: 'M' | 'F'; naissance: string; lieu: string; classId: string;
  parentName: string; parentPhone: string; parentTitle: 'M.' | 'Mme';
}

const uid = (() => { let n = 0; return (p: string) => `${p}${Date.now().toString(36)}${(++n).toString(36)}`; })();
const tempPassword = () => 'Hz' + String(Math.floor(Math.random() * 9000) + 1000);
/** Code provisoire des familles et des élèves : 6 chiffres. */
const tempPin = () => String(Math.floor(Math.random() * 900000) + 100000);

const NO_DATES: FeeDates = {};

/** Code d'école au démarrage : imposé par config.js, sinon `?ecole=` dans l'adresse, sinon le dernier code utilisé sur cet appareil. */
function initialSchoolCode(): string {
  const g = globalThis as unknown as { ECOLE_CODE?: string; location?: Location; localStorage?: Storage };
  if (g.ECOLE_CODE) return g.ECOLE_CODE.toLowerCase();
  try {
    const q = new URLSearchParams(g.location?.search ?? '').get('ecole');
    if (q) return q.toLowerCase();
    return g.localStorage?.getItem('ecole.code') ?? '';
  } catch { return ''; }
}

/** Résultat d'un contrôle ou d'un import de fichier d'élèves (renvoyé par le serveur). */
const IMPORT_PATH: Record<string, string> = { students: 'students', classes: 'classes', users: 'users', payments: 'finance/payments', subjects: 'subjects' };
export type ImportKind = 'students' | 'classes' | 'users' | 'payments' | 'subjects';
export interface ImportReport { total: number; valid: number; errors: { line: number; nom: string; errors: string[] }[]; created: { matricule: string; name: string }[]; }

/** Droits que le service informatique peut avoir sans ouvrir les données scolaires (même liste que le serveur). */
const IT_SAFE = ['accounts', 'journal.sys', 'settings.tech', 'roles.manage'];

const DEFAULT_SERIES: Record<string, string[]> = { '2nde': ['A', 'C'], '1ère': ['A', 'C', 'D'], 'Tle': ['A', 'C', 'D'] };

/** Message affiché tant que l'année n'est pas terminée (même texte que le refus de l'API). */
export const YEAR_OPEN_MSG = 'Les décisions de fin d’année pourront être enregistrées quand la dernière période sera verrouillée ou terminée.';

@Injectable({ providedIn: 'root' })
export class Store {
  private readonly api = inject(Api);
  private readonly push = inject(Push);
  /** Mode serveur : les données viennent de l'API (adresse donnée par `?api=`), pas du prototype simulé. */
  readonly apiMode = computed(() => !!this.api.base());
  private subjectPk = new Map<string, number>(); // code de matière → numéro côté serveur
  private readonly seed = buildSeed();
  /** Date du jour : la vraie en mode serveur, une date figée pour la démonstration. */
  readonly today = this.api.base() ? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : DEMO_TODAY;

  // --- Données ---
  readonly school = signal<SchoolSettings>(this.seed.school);
  readonly users = signal<User[]>(this.seed.users);
  readonly classes = signal<Classe[]>(this.seed.classes);
  readonly subjects = signal<Subject[]>(this.seed.subjects);
  readonly coefs = signal<Record<string, number>>(this.seed.coefs);
  /** Niveaux de l'école dans l'ordre du cursus (Paramètres > Niveaux et séries). */
  readonly levels = signal<Level[]>([...COLLEGE_LEVELS.map((n) => ({ n, c: 'college' as const, h: false })), ...LYCEE_LEVELS.map((n) => ({ n, c: 'lycee' as const, h: true }))]
    .map((x, i) => ({ id: `lv-${x.n}`, name: x.n, order: i, cycle: x.c, hasSeries: x.h, classes: 0 })));
  readonly levelNames = computed(() => this.levels().map((l) => l.name));
  /** Niveaux avec leur nombre de classes (mode démo : calculé). */
  readonly levelsView = computed(() => this.levels().map((l) => this.apiMode() ? l : { ...l, classes: this.classes().filter((c) => c.level === l.name).length }));
  levelInfo(name: string): Level | undefined { return this.levels().find((l) => l.name === name); }
  hasSeries(name: string): boolean { return !!this.levelInfo(name)?.hasSeries; }
  cycleOf(name: string): 'college' | 'lycee' { return this.levelInfo(name)?.cycle ?? 'college'; }
  levelsOfCycle(cycle: 'college' | 'lycee'): string[] { return this.levels().filter((l) => l.cycle === cycle).map((l) => l.name); }
  /** Niveau suivant (passage) ; null pour le dernier niveau. */
  nextLevelOf(name: string): string | null { const n = this.levelNames(), i = n.indexOf(name); return i >= 0 && i < n.length - 1 ? n[i + 1] : null; }
  isLastLevel(name: string): boolean { const n = this.levelNames(); return n.length > 0 && n[n.length - 1] === name; }
  /** Séries du lycée de l'école (Paramètres > Niveaux et séries). */
  readonly series = signal<Serie[]>(Object.entries(DEFAULT_SERIES).flatMap(([level, codes]) => codes.map((code) => ({ id: `${level}-${code}`, level, code, name: '', groupe: `${level} ${code}`, classes: [] }))));
  /** Séries avec leurs classes (mode démo : calculées à partir des classes). */
  readonly seriesView = computed(() => this.series().map((sr) => this.apiMode() ? sr : { ...sr, classes: this.classes().filter((c) => c.level === sr.level && c.serie === sr.code).map((c) => c.name) }));
  /** Groupes de coefficients : chaque niveau du collège, puis chaque série du lycée. */
  readonly groupes = computed(() => this.levels().flatMap((l) => l.hasSeries ? this.series().filter((x) => x.level === l.name).map((x) => x.groupe) : [l.name]));
  /** Séries dans l'ordre du cursus, puis par code. */
  private sortSeries = (l: Serie[]) => { const o = this.levelNames(); return [...l].sort((a, b) => o.indexOf(a.level) - o.indexOf(b.level) || a.code.localeCompare(b.code)); };
  seriesOf(level: string): Serie[] { return this.series().filter((x) => x.level === level); }
  readonly teachers = signal<Teacher[]>(this.seed.teachers);
  readonly parents = signal<Parent[]>(this.seed.parents);
  readonly students = signal<Student[]>(this.seed.students);
  readonly assignments = signal<Assignment[]>(this.seed.assignments);
  readonly terms = signal<Term[]>(this.seed.terms);
  readonly evals = signal<Evaluation[]>(this.seed.evals);
  readonly grades = signal<Record<string, number>>(this.seed.grades);
  readonly apprec = signal<Record<string, string>>(this.seed.apprec);
  readonly conseil = signal<Record<string, string>>(this.seed.conseil);
  readonly absences = signal<Absence[]>(this.seed.absences);
  readonly sessions = signal<Set<string>>(new Set(this.seed.sessions));
  readonly tarifs = signal<Record<string, Tarif>>(this.seed.tarifs);
  readonly feeDates = signal<FeeDates>(this.seed.feeDates);
  /** Tranches de scolarité de l'école (nombre, noms, parts). */
  readonly tranches = signal<TrancheDef[]>(DEFAULT_TRANCHES);
  readonly payments = signal<Payment[]>(this.seed.payments);
  /** Soldes reportés de l'année précédente, par élève (passage d'année). */
  readonly reports = signal<Record<string, number>>({});
  /** Avances reportées de l'année précédente (paiements en trop gardés), par élève. */
  readonly credits = signal<Record<string, number>>({});
  /** Clôtures de caisse (mode démo ; en mode serveur elles sont au serveur). */
  readonly closings = signal<CashClosing[]>([]);
  /** Élèves exclus, anciens ou partis (hors effectif de l'année en cours). */
  readonly formerStudents = signal<Student[]>([]);
  readonly statement = signal<StatementLine[]>(this.seed.statement);
  readonly notices = signal<Notice[]>(this.seed.notices);
  readonly log = signal<LogEntry[]>(this.seed.log);
  readonly announcements = signal<Announcement[]>(this.seed.announcements);
  readonly incidents = signal<Incident[]>(this.seed.incidents);
  readonly decisions = signal<Decision[]>(this.seed.decisions);

  // --- Session et navigation ---
  readonly userId = signal<string | null>(null);
  readonly page = signal<PageId>('dashboard');
  readonly param = signal<string | null>(null);
  readonly termId = signal<TermId>(currentTermOf(this.seed.terms, this.today) ?? 'T1');
  /** Période qui contient la date du jour (choisie par défaut, signalée « en cours » dans la barre du haut). */
  readonly currentTermId = computed(() => currentTermOf(this.terms(), this.today));
  /** Décisions de fin d'année possibles : dernière période verrouillée ou terminée. */
  readonly yearClosed = computed(() => yearClosedOf(this.terms(), this.today));
  readonly childId = signal<string | null>(null);
  /** Cursus de l'école (français par défaut ; arabe ou autre) et cursus affiché : toutes les données suivent ce choix. */
  readonly cursusList = signal<{ id: string; nom: string; langue: string; rtl: boolean; nom_ecole?: string }[]>([]);
  readonly cursusId = signal<string>('');
  /** Cursus affiché (langue du bulletin, nom de l'école dans cette langue). */
  readonly currentCursus = computed(() => this.cursusList().find((c) => c.id === this.cursusId()));
  readonly toasts = signal<Toast[]>([]);

  // --- Index ---
  readonly userById = computed(() => new Map(this.users().map((u) => [u.id, u])));
  readonly studentById = computed(() => new Map(this.students().map((s) => [s.id, s])));
  readonly classById = computed(() => new Map(this.classes().map((c) => [c.id, c])));
  readonly subjectById = computed(() => new Map(this.subjects().map((s) => [s.id, s])));
  readonly teacherById = computed(() => new Map(this.teachers().map((t) => [t.id, t])));
  readonly parentById = computed(() => new Map(this.parents().map((p) => [p.id, p])));
  readonly studentsByClass = computed(() => {
    const m = new Map<string, Student[]>();
    for (const s of this.students()) {
      const a = m.get(s.classId);
      if (a) a.push(s); else m.set(s.classId, [s]);
    }
    for (const a of m.values()) a.sort((x, y) => x.nom.localeCompare(y.nom) || x.prenoms.localeCompare(y.prenoms));
    return m;
  });

  readonly me = computed(() => {
    const id = this.userId();
    return id ? this.userById().get(id) ?? null : null;
  });
  readonly role = computed<Role | null>(() => this.me()?.role ?? null);
  readonly term = computed<Term>(() => this.terms().find((t) => t.id === this.termId()) ?? this.terms()[0] ?? { id: 'T1', label: 'Aucune période configurée', start: '', end: '', locked: true });
  can(p: Perm): boolean {
    const me = this.me();
    if (!me) return false;
    return me.perms ? me.perms.includes(p) : PERMS[me.role].includes(p);
  }

  // Périmètre de l'utilisateur connecté
  readonly myTeacher = computed(() => {
    const m = this.me();
    return m?.role === 'enseignant' ? this.teacherById().get(m.refId!) ?? null : null;
  });
  readonly myAssignments = computed(() => {
    const t = this.myTeacher();
    return t ? this.assignments().filter((a) => a.teacherId === t.id) : [];
  });
  readonly myClassIds = computed(() => [...new Set(this.myAssignments().map((a) => a.classId))]);
  readonly myChildren = computed(() => {
    const m = this.me();
    if (!m) return [];
    if (m.role === 'parent') return this.students().filter((s) => s.parentId === m.refId);
    if (m.role === 'eleve') return this.students().filter((s) => s.userId === m.id);   // une inscription par cursus suivi
    return [];
  });
  readonly activeChild = computed(() => {
    const kids = this.myChildren();
    return kids.find((k) => k.id === this.childId()) ?? kids[0] ?? null;
  });
  readonly scopeStudents = computed(() => {
    const r = this.role();
    if (r === 'educateur') { const sc = this.educatorScope(); return sc ? this.students().filter((x) => sc.includes(x.classId)) : this.students(); }
    if (r !== 'enseignant' && r !== 'parent' && r !== 'eleve') return this.students();
    if (r === 'enseignant') {
      const ids = new Set(this.myClassIds());
      return this.students().filter((s) => ids.has(s.classId));
    }
    return this.myChildren();
  });
  readonly scopeClasses = computed(() => {
    const r = this.role();
    if (r === 'enseignant') {
      const ids = new Set(this.myClassIds());
      return this.classes().filter((c) => ids.has(c.id));
    }
    const mine = this.educatorScope();
    if (r === 'educateur' && mine) return this.classes().filter((c) => mine.includes(c.id));   // classes confiées à l'éducateur
    return this.classes();
  });
  /** Classes confiées à l'éducateur connecté (null : toute l'école). */
  private readonly apiEducatorScope = signal<string[] | null>(null);
  readonly educatorClasses = signal<Record<string, string[]>>({});     // démonstration : classes de chaque éducateur
  readonly deductions = signal<DemoDeduction[]>([]);                  // démonstration : retraits de points de conduite
  readonly educatorScope = computed<string[] | null>(() => {
    if (this.apiMode()) return this.apiEducatorScope();
    const mine = this.educatorClasses()[this.userId() ?? ''];
    return mine && mine.length ? mine : null;
  });
  readonly unread = computed(() => this.myNotices().filter((n) => !n.read).length);
  readonly myNotices = computed(() => {
    const id = this.userId();
    return this.notices().filter((n) => n.userId === id).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  });
  readonly myAnnouncements = computed(() => {
    const r = this.role();
    return this.announcements().filter((a) => r && (this.apiMode() || a.audience.includes(r))).sort((a, b) => b.date.localeCompare(a.date));
  });

  // --- Résultats scolaires ---
  private compute(onlyPublished: boolean, term: Term = this.term()): Map<string, ClassStats> {
    return computeTerm({
      classes: this.classes(), students: this.students(), subjects: this.subjects(), coefs: this.coefs(),
      evals: this.evals(), grades: this.grades(), termId: term.id, compoWeight: this.school().compoWeight, onlyPublished,
      conduct: term.conductPublished || !onlyPublished ? this.conductInput(term.id) : undefined,
    });
  }
  /** Mode démonstration : bilan annuel de chaque classe (moyennes des périodes pondérées par leur coefficient, rang annuel). */
  private annualLocal(onlyPublished: boolean): Map<string, Map<string, AnnualSummary>> {
    const terms = this.terms();
    const per = terms.map((t) => this.compute(onlyPublished, t));
    const out = new Map<string, Map<string, AnnualSummary>>();
    for (const c of this.classes()) {
      const rows = new Map<string, AnnualSummary>();
      for (const st of this.studentsByClass().get(c.id) ?? []) {
        const periodes = terms.map((t, i) => ({ label: t.label, coef: termCoef(t, i), moy: per[i].get(c.id)?.results.get(st.id)?.moyenne ?? null }));
        rows.set(st.id, { periodes, moyenne: weightedAnnual(periodes), rang: null, effectif: 0, avg: null, max: null, min: null });
      }
      const vals = [...rows.values()].map((r) => r.moyenne).filter((v): v is number => v !== null);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      for (const r of rows.values()) {
        const m = r.moyenne;
        Object.assign(r, { rang: m === null ? null : 1 + vals.filter((v) => v > m + 1e-9).length, effectif: rows.size, avg,
          max: vals.length ? Math.max(...vals) : null, min: vals.length ? Math.min(...vals) : null });
      }
      out.set(c.id, rows);
    }
    return out;
  }
  private readonly annualPub = computed(() => (this.apiMode() ? new Map<string, Map<string, AnnualSummary>>() : this.annualLocal(true)));
  private readonly annualAll = computed(() => (this.apiMode() ? new Map<string, Map<string, AnnualSummary>>() : this.annualLocal(false)));
  /** Mode démonstration : bilan annuel d'un élève (en mode serveur, voir `bulletinAnnual`). */
  annualSummary(studentId: string, published: boolean): AnnualSummary | undefined {
    const st = this.studentById().get(studentId);
    return st ? (published ? this.annualPub() : this.annualAll()).get(st.classId)?.get(studentId) : undefined;
  }
  /** La période affichée est la dernière de l'année : son bulletin porte le bilan annuel. */
  readonly isLastTerm = computed(() => { const t = this.terms(); return t.length > 0 && t[t.length - 1].id === this.termId(); });
  /** Mode serveur : bilan annuel du bulletin de la dernière période, calculé par le serveur (notes publiées si `published`). */
  async bulletinAnnual(studentId: string, published: boolean): Promise<AnnualSummary | null> {
    if (!this.apiMode()) return this.annualSummary(studentId, published) ?? null;
    try {
      const r = await this.api.get<{ annual: null | { periodes: { label: string; coef: number; moy: number | null }[]; moyenne: number | null; rang: number | null; effectif: number; class_avg: number | null; class_max: number | null; class_min: number | null } }>(
        `students/${studentId}/bulletin/?term=${this.termId()}${published ? '&published=1' : ''}`);
      const a = r.annual;
      return a ? { periodes: a.periodes.map((p) => ({ label: p.label, coef: p.coef, moy: p.moy })), moyenne: a.moyenne, rang: a.rang, effectif: a.effectif, avg: a.class_avg, max: a.class_max, min: a.class_min } : null;
    } catch { return null; }
  }
  /** Réglages de conduite avec leurs valeurs par défaut. */
  private conductCfg() {
    const c = this.school();
    return { max: c.conduiteMax ?? 20, coef: c.conduiteCoef ?? 1, inAverage: c.conduiteInAverage ?? true, tranche: c.absenceTranche ?? 3, points: c.absencePoints ?? 1 };
  }
  /** Points retirés par élève pour la période courante (les retraits d'une sanction refusée ou en attente ne comptent pas). */
  private removedByStudent(termId: TermId): Record<string, number> {
    const inc = new Map(this.incidents().map((i) => [i.id, i.status]));
    const out: Record<string, number> = {};
    for (const d of this.deductions()) if (d.termId === termId && (!d.incidentId || inc.get(d.incidentId) === 'valide')) out[d.studentId] = (out[d.studentId] ?? 0) + d.points;
    return out;
  }
  private conductInput(termId: TermId = this.termId()) {
    if (this.apiMode()) return undefined;
    const c = this.conductCfg();
    return { max: c.max, coef: c.coef, inAverage: c.inAverage, removed: this.removedByStudent(termId) };
  }
  /** Mode serveur : moyennes et rangs viennent du serveur (lui seul voit toute la classe) ; sinon calcul local. */
  readonly serverStats = signal<{ pub: Map<string, ClassStats>; all: Map<string, ClassStats> } | null>(null);
  private readonly annual = signal<Map<string, { value: number | null; terms: number }>>(new Map());
  private termPk = new Map<TermId, number>();
  readonly statsAll = computed(() => (this.apiMode() ? this.serverStats()?.all ?? new Map<string, ClassStats>() : this.compute(false)));
  readonly statsPub = computed(() => (this.apiMode() ? this.serverStats()?.pub ?? new Map<string, ClassStats>() : this.compute(true)));

  classStats(classId: string, published: boolean): ClassStats | undefined {
    return (published ? this.statsPub() : this.statsAll()).get(classId);
  }
  resultOf(studentId: string, published: boolean): StudentResult | undefined {
    const st = this.studentById().get(studentId);
    return st ? this.classStats(st.classId, published)?.results.get(studentId) : undefined;
  }
  subjectsOfClass(classId: string): Subject[] {
    const cl = this.classById().get(classId);
    if (!cl) return [];
    return this.subjects().filter((s) => (this.coefs()[coefKey(cl.groupe, s.id)] ?? 0) > 0);
  }
  coefOf(classId: string, subjectId: string): number {
    const cl = this.classById().get(classId);
    return cl ? this.coefs()[coefKey(cl.groupe, subjectId)] ?? 0 : 0;
  }
  evalsFor(classId: string, subjectId: string, termId: TermId = this.termId()): Evaluation[] {
    return this.evals().filter((e) => e.classId === classId && e.subjectId === subjectId && e.termId === termId).sort((a, b) => a.date.localeCompare(b.date));
  }
  teacherOf(classId: string, subjectId: string): Teacher | undefined {
    const a = this.assignments().find((x) => x.classId === classId && x.subjectId === subjectId);
    return a ? this.teacherById().get(a.teacherId) : undefined;
  }
  gradeCount(evalId: string, classId: string): number {
    const g = this.grades();
    return (this.studentsByClass().get(classId) ?? []).filter((s) => g[`${evalId}|${s.id}`] !== undefined).length;
  }
  annualAverage(studentId: string): { value: number | null; terms: number } {
    if (this.apiMode()) return this.annual().get(studentId) ?? { value: null, terms: 0 };
    const a = this.annualSummary(studentId, true);      // moyenne des périodes pondérée par leur coefficient
    return { value: a?.moyenne ?? null, terms: a?.periodes.filter((p) => p.moy !== null).length ?? 0 };
  }

  // --- Présences ---
  readonly sessionsByClass = computed(() => {
    const m = new Map<string, number>();
    for (const k of this.sessions()) {
      const c = k.split('|')[0];
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  });
  readonly absByStudent = computed(() => {
    const m = new Map<string, { a: number; r: number; aJust: number; pending: number }>();
    for (const x of this.absences()) {
      const e = m.get(x.studentId) ?? { a: 0, r: 0, aJust: 0, pending: 0 };
      if (x.status === 'A') {
        e.a++;
        if (x.justif === 'acceptee') e.aJust++;
        if (x.justif === 'en_attente') e.pending++;
      } else e.r++;
      m.set(x.studentId, e);
    }
    return m;
  });
  attendanceRate(studentId: string): number | null {
    const st = this.studentById().get(studentId);
    if (!st) return null;
    const n = this.sessionsByClass().get(st.classId) ?? 0;
    if (!n) return null;
    return (1 - (this.absByStudent().get(studentId)?.a ?? 0) / n) * 100;
  }
  classAttendance(classId: string): number | null {
    const n = this.sessionsByClass().get(classId) ?? 0;
    const studs = this.studentsByClass().get(classId) ?? [];
    if (!n || !studs.length) return null;
    const m = this.absByStudent();
    const a = studs.reduce((s, x) => s + (m.get(x.id)?.a ?? 0), 0);
    return (1 - a / (n * studs.length)) * 100;
  }
  readonly schoolAttendance = computed(() => {
    let sessions = 0, abs = 0;
    const m = this.absByStudent();
    for (const c of this.classes()) {
      const n = this.sessionsByClass().get(c.id) ?? 0;
      const studs = this.studentsByClass().get(c.id) ?? [];
      sessions += n * studs.length;
      abs += studs.reduce((s, x) => s + (m.get(x.id)?.a ?? 0), 0);
    }
    return sessions ? (1 - abs / sessions) * 100 : null;
  });
  readonly pendingJustifs = computed(() => this.absences().filter((a) => a.status === 'A' && a.justif === 'en_attente'));

  // --- Finance ---
  readonly paymentsByStudent = computed(() => {
    const m = new Map<string, Payment[]>();
    for (const p of this.payments()) {
      const a = m.get(p.studentId);
      if (a) a.push(p); else m.set(p.studentId, [p]);
    }
    return m;
  });
  readonly paidByStudent = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.payments()) if (p.status === 'confirme') m.set(p.studentId, (m.get(p.studentId) ?? 0) + p.amount);
    for (const [id, c] of Object.entries(this.credits())) m.set(id, (m.get(id) ?? 0) + c);
    return m;
  });
  tarifOf(level: string): Tarif {
    return this.tarifs()[level] ?? { ins: 0, sco: 0 };
  }
  feeLines(studentId: string): FeeLine[] {
    const server = this.apiMode() ? this.serverAccounts()?.get(studentId) : undefined;
    if (server) return server.lines;
    const st = this.studentById().get(studentId);
    const level = this.levelOf(studentId);
    if (!st || !level) return [];
    return allocate(feeItems(this.tarifOf(level), this.feeDates(), this.siblingPct(studentId), this.tranches(), this.reports()[studentId] ?? 0, this.terms()[0]?.start), this.paidByStudent().get(studentId) ?? 0, this.today);
  }
  /** Pourcentage de remise fratrie applicable à cet élève (0 si aîné ou enfant unique). */
  siblingPct(studentId: string): number {
    // Le serveur compte les frères et sœurs dans l'ordre d'inscription (numéro croissant)
    const list = this.apiMode() ? [...this.students()].sort((a, b) => Number(a.id) - Number(b.id)) : this.students();
    return siblingPct(list, studentId, this.school().remiseFratrie ?? 0);
  }
  /** Montant de la remise fratrie sur la scolarité de l'élève, en FCFA. */
  siblingDiscount(studentId: string): { pct: number; amount: number } {
    const server = this.apiMode() ? this.serverAccounts()?.get(studentId) : undefined;
    if (server) return { pct: server.discount_pct, amount: server.discount_amount };
    const level = this.levelOf(studentId);
    const pct = this.siblingPct(studentId);
    if (!level || !pct) return { pct: 0, amount: 0 };
    const t = this.tarifOf(level);
    return { pct, amount: t.sco - discountedTarif(t, pct).sco };
  }
  balance(studentId: string): { total: number; paid: number; solde: number; overdue: number } {
    const server = this.apiMode() ? this.serverAccounts()?.get(studentId) : undefined;
    if (server) return { total: server.total, paid: server.paid, solde: server.balance, overdue: server.overdue };
    const lines = this.feeLines(studentId);
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const paid = this.paidByStudent().get(studentId) ?? 0;
    return { total, paid, solde: Math.max(0, total - paid), overdue: lines.filter((l) => l.overdue).reduce((a, l) => a + l.remaining, 0) };
  }
  readonly finance = computed(() => {
    let expected = 0, dueToDate = 0, overdue = 0, overdueCount = 0, collected = 0;
    const overdueByClass = new Map<string, number>();
    const byMonth = new Map<string, number>();
    const byMode = new Map<PayMode, number>();
    for (const st of this.students()) {
      const lines = this.feeLines(st.id);
      expected += lines.reduce((a, l) => a + l.amount, 0);
      dueToDate += lines.filter((l) => l.due <= this.today).reduce((a, l) => a + l.amount, 0);
      const od = lines.filter((l) => l.overdue).reduce((a, l) => a + l.remaining, 0);
      if (od > 0) {
        overdue += od;
        overdueCount++;
        overdueByClass.set(st.classId, (overdueByClass.get(st.classId) ?? 0) + od);
      }
    }
    for (const p of this.payments()) {
      if (p.status !== 'confirme') continue;
      collected += p.amount;
      byMonth.set(p.date.slice(0, 7), (byMonth.get(p.date.slice(0, 7)) ?? 0) + p.amount);
      byMode.set(p.mode, (byMode.get(p.mode) ?? 0) + p.amount);
    }
    const month = this.today.slice(0, 7);
    return { expected, dueToDate, overdue, overdueCount, collected, byMonth, byMode, overdueByClass, monthCollected: byMonth.get(month) ?? 0 };
  });
  readonly statementIssues = computed(() => {
    const pm = new Map(this.payments().map((p) => [p.id, p]));
    return this.statement().filter((l) => !l.paymentId || pm.get(l.paymentId)?.amount !== l.amount);
  });

  // --- Utilitaires ---
  userName(id: string): string {
    if (id === 'u-system') return 'Paiement en ligne';
    return this.userById().get(id)?.name ?? '—';
  }
  studentName(id: string): string {
    const s = this.studentById().get(id);
    return s ? `${s.nom} ${s.prenoms}` : '—';
  }
  className(id: string): string {
    if (id.startsWith('placer:')) return `${id.slice(7)} · à placer`;       // élève sans classe : son nouveau niveau
    return this.classById().get(id)?.name ?? '—';
  }
  /** Niveau d'un élève : celui de sa classe, ou son nouveau niveau s'il est à placer (tarifs de scolarité). */
  levelOf(studentId: string): string | undefined {
    const st = this.studentById().get(studentId);
    if (!st) return undefined;
    return st.classId.startsWith('placer:') ? st.classId.slice(7) : this.classById().get(st.classId)?.level;
  }
  go(page: PageId, param: string | null = null): void {
    this.page.set(page);
    this.param.set(param);
    try { globalThis.scrollTo?.({ top: 0 }); } catch { /* sans effet */ }
  }
  toast(text: string, kind: Toast['kind'] = 'ok'): void {
    const id = Date.now() + Math.random();
    this.toasts.update((t) => [...t, { id, text, kind }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 4200);
  }
  addLog(action: string, detail: string): void {
    if (this.apiMode()) return; // en mode serveur, le journal est tenu par le serveur
    const entry: LogEntry = { id: uid('l'), ts: new Date().toISOString().slice(0, 10) === this.today ? `${this.today}T${new Date().toTimeString().slice(0, 5)}` : `${this.today}T09:00`, userId: this.userId() ?? 'u-system', action, detail };
    this.log.update((l) => [entry, ...l]);
  }
  notify(userIds: string[], text: string, kind: Notice['kind'], page?: PageId): void {
    const date = this.today;
    const items = [...new Set(userIds)].map((u) => ({ id: uid('n'), userId: u, text, date, read: false, kind, page }));
    this.notices.update((n) => [...n, ...items]);
  }
  markRead(id: string): void {
    this.notices.update((n) => n.map((x) => (x.id === id ? { ...x, read: true } : x)));
  }
  markAllRead(): void {
    const me = this.userId();
    this.notices.update((n) => n.map((x) => (x.userId === me ? { ...x, read: true } : x)));
  }
  familyUserIds(studentId: string): string[] {
    const st = this.studentById().get(studentId);
    if (!st) return [];
    return [st.userId, this.parentById().get(st.parentId)?.userId ?? ''].filter(Boolean);
  }
  usersWithRole(role: Role): string[] {
    return this.users().filter((u) => u.role === role && u.active).map((u) => u.id);
  }

  // Export de fichiers (capacité « downloads » du viewer)
  async download(filename: string, data: string): Promise<void> {
    try {
      const claude = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
      const dl = (await claude?.use?.('downloads')) as { save: (r: { filename: string; data: string }) => Promise<{ status: string }> } | null | undefined;
      if (dl) {
        await dl.save({ filename, data });
        this.toast(`Fichier prêt : ${filename}`);
        return;
      }
      // Hors prototype (site déployé) : téléchargement classique du navigateur.
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const type = ({ csv: 'text/csv', html: 'text/html', json: 'application/json', txt: 'text/plain' } as Record<string, string>)[ext] ?? 'application/octet-stream';
      this.saveBlob(filename, new Blob(ext === 'csv' ? ['\ufeff', data] : [data], { type: `${type};charset=utf-8` }));
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'declined') this.toast("Le fichier n'a pas pu être enregistré.", 'err');
    }
  }
  /** Enregistre un fichier via le navigateur (lien temporaire). */
  saveBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.toast(`Fichier prêt : ${filename}`);
  }
  /** Bulletin d'un élève (`students`) ou de toute une classe (`classes`) en PDF, produit par le serveur. */
  async bulletinPdf(kind: 'students' | 'classes', id: string, template: string, published: boolean, filename: string): Promise<boolean> {
    try {
      const file = kind === 'students' ? 'bulletin.pdf' : 'bulletins.pdf';
      this.saveBlob(filename, await this.api.blob(`${kind}/${id}/${file}?term=${this.termId()}&template=${template}${published ? '&published=1' : ''}`));
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  /** Le bulletin de l'année est-il remis à la famille de l'élève (impayé, dérogation de la direction) ? */
  async bulletinAccess(studentId: string): Promise<BulletinAccess | null> {
    try { return await this.api.get<BulletinAccess>(`students/${studentId}/bulletin-access/`); } catch { return null; }
  }
  /** Dérogation de la direction : bulletin remis malgré l'impayé pour l'année (`on`), ou retirée. */
  async setBulletinDerogation(studentId: string, on: boolean, note = ''): Promise<BulletinAccess | null> {
    try {
      const path = `students/${studentId}/bulletin-access/`;
      const r = on ? await this.api.post<BulletinAccess>(path, { note }) : await this.api.delete<BulletinAccess>(path);
      this.toast(on ? 'Bulletin débloqué pour cette année.' : 'Dérogation retirée.');
      return r;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return null; }
  }
  /** Années passées : élèves inscrits à l'époque, moyennes et décisions (consultation). */
  async archives(year?: string): Promise<{ data?: ArchiveData; error?: string }> {
    try { return { data: await this.api.get<ArchiveData>(`archives/${year ? `?year=${encodeURIComponent(year)}` : ''}`) }; } catch (e) { return { error: this.fail(e).error }; }
  }
  /** Bulletin d'une année passée (version définitive), en PDF produit par le serveur. */
  async archivePdf(studentId: string, year: string, term: string, filename: string): Promise<boolean> {
    try { this.saveBlob(filename, await this.api.blob(`students/${studentId}/bulletin.pdf?term=${term}&year=${encodeURIComponent(year)}&published=1`)); return true; }
    catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  /** Reçu de paiement : PDF généré par le serveur (mode serveur), sinon page HTML locale. */
  async receiptPdf(paymentId: string, receiptNo: string, duplicata = false): Promise<boolean> {
    try { this.saveBlob(`recu-${receiptNo}${duplicata ? '-duplicata' : ''}.pdf`, await this.api.blob(`finance/payments/${paymentId}/receipt.pdf${duplicata ? '?duplicata=1' : ''}`)); return true; }
    catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }

  // --- Mode serveur (API) ---
  private codeOf(): Map<number, string> { return new Map([...this.subjectPk].map(([c, pk]) => [pk, c])); }
  subjectCode(pk: number): string | undefined { return this.codeOf().get(pk); }
  subjectPkOf(code: string): number | undefined { return this.subjectPk.get(code); }
  errorMessage(e: unknown): string { return this.fail(e).error; }
  private fail(e: unknown): { ok: false; error: string } {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Une erreur est survenue. Réessayez.' };
  }
  /** Vide toutes les données (déconnexion en mode serveur : rien ne doit rester à l'écran). */
  private clearData(): void {
    this.users.set([]); this.classes.set([]); this.subjects.set([]); this.coefs.set({}); this.series.set([]); this.levels.set([]); this.teachers.set([]); this.parents.set([]);
    this.students.set([]); this.assignments.set([]); this.evals.set([]); this.grades.set({}); this.apprec.set({}); this.conseil.set({});
    this.absences.set([]); this.sessions.set(new Set()); this.payments.set([]); this.reports.set({}); this.credits.set({}); this.formerStudents.set([]); this.statement.set([]); this.notices.set([]);
    this.tarifs.set({}); this.feeDates.set(NO_DATES); this.tranches.set(DEFAULT_TRANCHES);
    this.log.set([]); this.announcements.set([]); this.incidents.set([]); this.decisions.set([]);
    this.serverStats.set(null); this.annual.set(new Map()); this.termPk = new Map();
  }
  private async optional<T>(path: string, fallback: T): Promise<T> {
    try { return await this.api.all<T extends (infer E)[] ? E : never>(path) as T; } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return fallback;
      throw e;
    }
  }
  /** Charge la structure de l'école et les élèves visibles par la personne connectée. */
  async hydrate(me: ApiUser): Promise<void> {
    const A = this.api;
    this.abonnement.set(me.etablissement?.abonnement ?? null);
    this.lectureSeule.set(!!me.etablissement?.lecture_seule);
    if (me.role === 'informatique' && !(me.permissions ?? []).some((p) => !IT_SAFE.includes(p))) return this.hydrateIt(me);   // droits scolaires accordés par l'école : données complètes
    await this.loadCursus(me);
    const [subjects, coefs, classes, cal, cfg, students, teachers, assigns, parentsList, allUsers] = await Promise.all([
      A.all<ApiSubject>('subjects/'), A.get<ApiCoef[]>('coefficients/'), A.all<ApiClass>('classes/'),
      A.get<{ year: { label: string } | null; terms: ApiTerm[] }>('calendar/'), A.get<ApiSettings>('settings/'),
      this.optional<ApiStudent[]>('students/', []), this.optional<ApiTeacher[]>('teachers/', []), this.optional<ApiAssignment[]>('assignments/', []),
      this.optional<ApiParent[] | null>('parents/', null), this.optional<ApiUser[]>('users/', []),
    ]);
    this.levels.set((await this.optional<ApiLevel[]>('levels/', [])).map(mapLevel));
    this.series.set(this.sortSeries((await this.optional<ApiSerie[]>('series/', [])).map(mapSerie)));
    this.subjectPk = new Map(subjects.map((x) => [x.code, x.id]));
    const codeOf = this.codeOf();
    this.subjects.set(subjects.map(mapSubject));
    this.coefs.set(mapCoefs(coefs, codeOf));
    this.classes.set(classes.map(mapClass));
    this.terms.set(cal.terms.map(mapTerm));
    this.termPk = new Map(cal.terms.map((t) => [t.code, t.id]));
    this.termId.set(this.currentTermId() ?? 'T1');
    this.school.set(mapSettings(cfg, cal.year?.label ?? '', this.school()));
    const present = students.filter((x) => x.active !== false || x.sortie === 'placer');   // dont les élèves à placer (sans classe)
    this.students.set(present.map(mapStudent));
    this.parents.set(mapParents(parentsList && parentsList.length ? parentsList : null, present));
    const tchs = teachers.map((t) => mapTeacher(t, codeOf));
    this.teachers.set(tchs);
    this.assignments.set(assigns.map((a) => mapAssignment(a, codeOf)).filter((a): a is NonNullable<typeof a> => !!a));
    let refId: string | undefined;
    if (me.role === 'enseignant') refId = tchs.find((t) => t.userId === String(me.id))?.id;
    else if (me.role === 'parent') refId = present[0] ? String(present[0].parent_id) : undefined;
    else if (me.role === 'eleve') refId = present[0] ? String(present[0].id) : undefined;
    const list = allUsers.length ? allUsers : [me];
    const users = list.map((u) => mapUser(u, u.id === me.id ? refId : undefined));
    if (!users.some((u) => u.id === String(me.id))) users.push(mapUser(me, refId));
    this.users.set(users);
    await Promise.all([this.loadTerm(), this.loadDecisions(), this.loadAttendance(), this.loadIncidents(), this.loadNotices(String(me.id)), this.loadFinance(), this.loadLog(), this.loadAnnouncements()]);
    if (me.role === 'educateur') await this.loadEducatorScope();
    await this.loadToPlace(me.permissions ?? []);
  }
  /** Cursus de l'école ; le personnel travaille dans celui qu'il a choisi (gardé le temps de l'onglet), sinon le premier. */
  private async loadCursus(me: ApiUser): Promise<void> {
    const list = (await this.optional<{ id: number; nom: string; langue: string; rtl: boolean; nom_ecole?: string }[]>('cursus/', [])).map((c) => ({ ...c, id: String(c.id) }));
    this.cursusList.set(list);
    if (list.length < 2) { this.api.setCursus(''); this.cursusId.set(list[0]?.id ?? ''); return; }
    if (me.role === 'parent' || me.role === 'eleve') {
      // Famille : les données affichées sont celles du cursus de l'enfant (ou de l'inscription) choisi
      const kids = await this.optional<ApiStudent[]>('students/', []);
      const saved = this.savedChild();
      const kid = kids.find((k) => String(k.id) === saved) ?? kids[0];
      const id = kid?.cursus != null ? String(kid.cursus) : list[0].id;
      this.api.setCursus(id); this.cursusId.set(id);
      if (kid) this.childId.set(String(kid.id));
      return;
    }
    const saved = this.api.savedCursus();
    const id = list.some((c) => c.id === saved) ? saved : list[0].id;
    this.api.setCursus(id); this.cursusId.set(id);
  }
  private static readonly CHILD = 'ecole.enfant';
  private savedChild(): string {
    try { return (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.getItem(Store.CHILD) ?? ''; } catch { return ''; }
  }
  /** Famille : choisit l'enfant (ou l'inscription) affiché ; s'il est dans un autre cursus, les données sont relues dans ce cursus. */
  pickChild(id: string): void {
    const kid = this.myChildren().find((k) => k.id === id);
    if (!kid) return;
    try { (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.setItem(Store.CHILD, id); } catch { /* stockage indisponible */ }
    if (this.apiMode() && kid.cursusId && this.cursusList().length > 1 && kid.cursusId !== this.cursusId()) { this.api.setCursus(kid.cursusId); globalThis.location?.reload(); return; }
    this.childId.set(id);
  }
  /** Les enfants de la famille sont-ils répartis sur plusieurs cursus ? (on affiche alors le cursus de chacun) */
  readonly childrenAcrossCursus = computed(() => new Set(this.myChildren().map((k) => k.cursusId)).size > 1);
  /** Inscriptions d'un élève dans les autres cursus, et inscription dans un nouveau cursus (secrétariat). */
  async studentInscriptions(id: string): Promise<{ id: string; cursus: string; cursusNom: string; classLabel: string; active: boolean }[]> {
    try {
      const r = await this.api.get<{ inscriptions: { id: number; cursus: number; cursus_nom: string; class_name: string; active: boolean }[] }>(`students/${id}/`);
      return r.inscriptions.map((i) => ({ id: String(i.id), cursus: String(i.cursus), cursusNom: i.cursus_nom, classLabel: i.class_name, active: i.active }));
    } catch { return []; }
  }
  async cursusClasses(cursusId: string): Promise<{ classes: { id: number; name: string; level: string; free: number }[]; levels: string[] }> {
    try { return await this.api.get(`cursus/${cursusId}/classes/`); } catch { return { classes: [], levels: [] }; }
  }
  async enrollInCursus(studentId: string, cursusId: string, classId: string | null, level: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.api.post(`students/${studentId}/cursus/`, classId ? { cursus: Number(cursusId), school_class: Number(classId) } : { cursus: Number(cursusId), level });
      this.toast('Élève inscrit dans l’autre cursus.');
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  /** Passe à un autre cursus : la page est rechargée et toutes les données sont relues dans ce cursus. */
  switchCursus(id: string): void {
    if (id === this.cursusId()) return;
    this.api.setCursus(id);
    globalThis.location?.reload();
  }
  async loadEducatorScope(): Promise<void> {
    try { const r = await this.api.get<{ classes: number[] | null }>('educators/mine/'); this.apiEducatorScope.set(r.classes ? r.classes.map(String) : null); } catch { this.apiEducatorScope.set(null); }
  }
  /** Service informatique : ni élèves, ni notes, ni finances. Seulement l'identité de l'école, les comptes et le journal. */
  private async hydrateIt(me: ApiUser): Promise<void> {
    const [cfg, allUsers, teachers] = await Promise.all([this.api.get<ApiSettings>('settings/'), this.optional<ApiUser[]>('users/', []), this.optional<ApiTeacher[]>('teachers/', [])]);
    this.school.set(mapSettings(cfg, '', this.school()));
    this.teachers.set(teachers.map((t) => mapTeacher(t, this.codeOf())));
    const list = allUsers.length ? allUsers : [me];
    const users = list.map((u) => mapUser(u, undefined));
    if (!users.some((u) => u.id === String(me.id))) users.push(mapUser(me, undefined));
    this.users.set(users);
    await Promise.all([this.loadNotices(String(me.id)), this.loadLog(), this.loadAnnouncements()]);
  }
  private async orEmpty<T>(p: Promise<T[]>): Promise<T[]> {
    try { return await p; } catch (e) { if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return []; throw e; }
  }
  async loadAttendance(): Promise<void> {
    if (!this.apiMode()) return;
    try {
      const [abs, ses] = await Promise.all([
        this.orEmpty(this.api.all<ApiAbsence>('absences/?page_size=500')),
        this.orEmpty(this.api.get<ApiSession[]>('attendance/sessions/')),
      ]);
      this.absences.set(abs.map(mapAbsence));
      this.sessions.set(new Set(ses.map(sessionKey)));
    } catch (e) { this.toast(this.fail(e).error, 'err'); }
  }
  async loadFinance(): Promise<void> {
    if (!this.apiMode()) return;
    try {
      const [tarifs, dates, trs, pays, stmt, reps] = await Promise.all([
        this.api.get<{ level: string; ins: number; sco: number; complement?: number | null }[]>('finance/tarifs/'),
        this.api.get<{ key: string; date: string | null }[]>('finance/dates/'),
        this.api.get<{ tranches: TrancheDef[] }>('finance/tranches/'),
        this.orEmpty(this.api.all<ApiPayment>('finance/payments/?page_size=500')),
        this.orEmpty(this.api.get<ApiStatement[]>('finance/statement/')),
        this.api.get<{ reports: Record<string, number>; credits?: Record<string, number> }>('finance/reports/').catch((e) => { if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return { reports: {}, credits: {} }; throw e; }),
      ]);
      this.reports.set(reps.reports ?? {});
      this.credits.set(reps.credits ?? {});
      this.tarifs.set(mapTarifs(tarifs));
      this.tranches.set(trs.tranches.length ? trs.tranches : DEFAULT_TRANCHES);
      this.feeDates.set(mapFeeDates(dates, NO_DATES));
      this.payments.set(pays.map(mapPayment));
      this.statement.set(stmt.map(mapStatement));
      await this.loadAccounts();
    } catch (e) { this.toast(this.fail(e).error, 'err'); }
  }
  /** Comptes calculés par le serveur : une seule règle de calcul (forfait global des élèves inscrits dans plusieurs cursus). */
  readonly serverAccounts = signal<Map<string, ServerAccount> | null>(null);
  private async loadAccounts(): Promise<void> {
    try {
      const r = await this.api.get<{ accounts: Record<string, ServerAccount> }>('finance/accounts/');
      this.serverAccounts.set(new Map(Object.entries(r.accounts).map(([id, a]) => [id, { ...a, lines: a.lines.map((l) => ({ ...l, due: !l.due || l.due === '0001-01-01' ? '' : l.due })) }])));
    } catch { this.serverAccounts.set(null); }
  }
  /** Détail du forfait d'un élève inscrit dans plusieurs cursus (vide sinon). */
  cursusDetail(studentId: string): ServerAccount['cursus_detail'] { return this.serverAccounts()?.get(studentId)?.cursus_detail ?? []; }
  async recordPaymentAsync(f: { studentId: string; amount: number; mode: PayMode; ref?: string; note?: string; advance?: boolean }): Promise<{ payment?: Payment; error?: string; surplus?: number; balance?: number }> {
    if (!this.apiMode()) return { payment: this.recordPayment(f) };
    try {
      const r = await this.api.post<ApiPayment>('finance/payments/', { student: Number(f.studentId), amount: Math.round(f.amount), mode: f.mode, ref: f.ref ?? '', note: f.note ?? '', advance: !!f.advance });
      await this.loadFinance();
      return { payment: mapPayment(r) };
    } catch (e) {
      if (e instanceof ApiError && String(e.errors?.['code']) === 'surplus') return { error: e.message, surplus: Number(e.errors?.['surplus']), balance: Number(e.errors?.['balance']) };
      return { error: this.fail(e).error };
    }
  }
  /** Années scolaires avec leurs chiffres de caisse (mode démo : l'année en cours seulement). */
  async financeYears(): Promise<FinanceYear[]> {
    if (!this.apiMode()) {
      const ok = this.payments().filter((p) => p.status === 'confirme');
      return [{ label: this.currentYearLabel(), current: true, collected: ok.reduce((a, p) => a + p.amount, 0), count: ok.length, cancelled: this.payments().length - ok.length,
        advances: ok.reduce((a, p) => a + (p.advance ?? 0), 0), carriedOver: null, carriedCredit: null }];
    }
    try { return (await this.api.get<Parameters<typeof mapYear>[0][]>('finance/years/')).map(mapYear); } catch (e) { this.toast(this.fail(e).error, 'err'); return []; }
  }
  currentYearLabel(): string { return this.terms()[0]?.start ? `${this.terms()[0].start.slice(0, 4)}-${Number(this.terms()[0].start.slice(0, 4)) + 1}` : ''; }
  /** Paiements d'une année passée (lecture seule), par libellé d'année. */
  async paymentsOfYear(label: string): Promise<Payment[]> {
    if (!this.apiMode()) return this.payments();
    try { return (await this.api.all<ApiPayment>(`finance/payments/?year=${encodeURIComponent(label)}&page_size=500`)).map(mapPayment); } catch (e) { this.toast(this.fail(e).error, 'err'); return []; }
  }
  /** Relevé de paiements d'un élève sur toutes les années. */
  async studentStatement(studentId: string): Promise<StudentStatement | null> {
    if (!this.apiMode()) {
      const st = this.studentById().get(studentId); if (!st) return null;
      const ps = this.payments().filter((p) => p.studentId === studentId).sort((a, b) => a.date.localeCompare(b.date));
      return { studentId, name: `${st.nom} ${st.prenoms}`, matricule: st.matricule, className: this.className(st.classId),
        years: ps.length ? [{ label: this.currentYearLabel(), report: this.reports()[studentId] ?? 0, credit: this.credits()[studentId] ?? 0, paid: ps.filter((p) => p.status === 'confirme').reduce((a, p) => a + p.amount, 0),
          payments: ps.map((p) => ({ id: p.id, receiptNo: p.receiptNo, date: p.date, amount: p.amount, mode: p.mode, status: p.status, advance: p.advance ?? 0 })) }] : [] };
    }
    try { return mapStatementOf(await this.api.get<Parameters<typeof mapStatementOf>[0]>(`finance/students/${studentId}/statement/`)); } catch (e) { this.toast(this.fail(e).error, 'err'); return null; }
  }
  /** Journée de caisse : encaissements par mode, annulations, espèces attendues et clôture éventuelle. */
  async cashDay(date: string): Promise<CashDay | null> {
    if (!this.apiMode()) {
      const day = this.payments().filter((p) => p.date === date);
      const ok = day.filter((p) => p.status === 'confirme');
      const byMode = new Map<PayMode, { mode: PayMode; count: number; total: number }>();
      for (const p of ok) { const r = byMode.get(p.mode) ?? { mode: p.mode, count: 0, total: 0 }; r.count++; r.total += p.amount; byMode.set(p.mode, r); }
      return { date, total: ok.reduce((a, p) => a + p.amount, 0), count: ok.length, expectedCash: byMode.get('especes')?.total ?? 0, byMode: [...byMode.values()],
        cancelled: day.filter((p) => p.status === 'annule').map((p) => ({ receiptNo: p.receiptNo, student: this.studentName(p.studentId), amount: p.amount, note: p.note ?? '' })),
        closing: this.closings().find((c) => c.date === date) ?? null };
    }
    try { return mapCashDay(await this.api.get<Parameters<typeof mapCashDay>[0]>(`finance/cash/?date=${date}`)); } catch (e) { this.toast(this.fail(e).error, 'err'); return null; }
  }
  /** Clôture de la caisse du jour : espèces comptées, avec un mot d'explication s'il y a un écart. */
  async cashClose(date: string, counted: number, note: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      const day = await this.cashDay(date);
      if (!day) return { ok: false, error: 'Journée introuvable.' };
      if (day.closing) return { ok: false, error: 'La caisse de ce jour est déjà clôturée.' };
      if (counted !== day.expectedCash && !note.trim()) return { ok: false, error: 'Il y a un écart : expliquez-le en une phrase.' };
      this.closings.update((c) => [...c, { date, expected: day.expectedCash, counted, gap: counted - day.expectedCash, note: note.trim(), by: this.userName(this.userId() ?? '') }]);
      this.addLog('Clôture de caisse', `${date} · attendu ${day.expectedCash} · compté ${counted} FCFA`);
      return { ok: true };
    }
    try { await this.api.post('finance/cash/close/', { date, counted, note }); return { ok: true }; } catch (e) { return { ok: false, error: this.fail(e).error }; }
  }
  async cancelPaymentAsync(id: string, reason: string): Promise<boolean> {
    if (!this.apiMode()) { this.cancelPayment(id, reason); return true; }
    try { await this.api.post(`finance/payments/${id}/cancel/`, { reason }); await this.loadFinance(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async setTarifAsync(level: string, t: Tarif): Promise<boolean> {
    if (!this.apiMode()) { this.setTarif(level, t); return true; }
    try { await this.api.put('finance/tarifs/', { level, ins: t.ins, sco: t.sco, complement: t.complement ?? null }); await this.loadFinance(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  /** Enregistre les tranches de scolarité (nombre, noms, parts). Les paiements déjà reçus couvrent les nouvelles échéances dans l'ordre. */
  async saveTranchesAsync(list: TrancheDef[]): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.tranches.set(list.map((t) => ({ label: t.label.trim(), part: Math.max(1, Math.round(t.part)) }))); return { ok: true }; }
    try { await this.api.put('finance/tranches/', { tranches: list }); await this.loadFinance(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  /** Moyennes de passage choisies par l'école (admission, redoublement, exclusion facultative). */
  async savePassageAsync(p: { passageAdmission: number; passageRedoublement: number; passageExclusion: number | null; passageNiveaux?: SchoolSettings['passageNiveaux'] }): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.school.update((s) => ({ ...s, ...p })); return { ok: true }; }
    try {
      const cfg = await this.api.patch<ApiSettings>('settings/', settingsPatch(p));
      this.school.set(mapSettings(cfg, this.school().year, this.school()));
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  async saveSettingsAsync(p: Partial<SchoolSettings>): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.school.update((x) => ({ ...x, ...p })); return { ok: true }; }
    try {
      const cfg = await this.api.patch<ApiSettings>('settings/', settingsPatch(p));
      this.school.set(mapSettings(cfg, this.school().year, this.school()));
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  /** Aperçu du passage à l'année suivante (rien n'est modifié). */
  async rolloverPlan(): Promise<{ plan?: RolloverPlan; error?: string }> {
    try { return { plan: await this.api.get<RolloverPlan>('rollover/plan/') }; } catch (e) { return { error: this.fail(e).error }; }
  }
  private async afterRollover(): Promise<void> {
    const me = await this.api.get<ApiUser>('me/');
    await this.hydrate(me);
    await this.refreshPeople();
  }
  async applyRollover(moves: { student: number; action: string; class?: number | null }[], toYear?: string): Promise<{ ok: boolean; error?: string; year?: string; counts?: Record<string, number>; carried?: number; toPlace?: number }> {
    try {
      const r = await this.api.post<{ year: string; counts: Record<string, number>; carried_over: number; to_place: number }>('rollover/apply/', { moves, to_year: toYear });
      await this.afterRollover();
      return { ok: true, year: r.year, counts: r.counts, carried: r.carried_over, toPlace: r.to_place };
    } catch (e) { return this.fail(e); }
  }
  // --- Nouvelle année, étape 3 : répartition des élèves à placer ---
  /** Nombre d'élèves passés dans la nouvelle année qui attendent encore une classe (bandeau du tableau de bord). */
  readonly toPlace = signal(0);
  /** Parmi eux : payé mais pas encore validé par le secrétariat, et rien payé. */
  readonly toPlacePaid = signal(0);
  readonly toPlaceWaiting = signal(0);
  async placementState(): Promise<{ state?: PlacementState; error?: string }> {
    try {
      const st = await this.api.get<PlacementState>('rollover/placement/');
      this.toPlace.set(st.total); this.toPlacePaid.set(st.paid); this.toPlaceWaiting.set(st.waiting);
      return { state: st };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  /** Le secrétariat valide la réinscription (sur reçu ; sans paiement, avec un motif) ; `false` annule la validation. */
  async setReinscription(students: number[], confirmed: boolean, motif = ''): Promise<{ ok: boolean; error?: string }> {
    try { await this.api.post('rollover/reinscription/', { students, confirmed, motif }); await this.refreshPeople(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  /** Les élèves non réinscrits quittent l'école (« Parti(e) ») : tous, ou ceux indiqués. */
  async markDeparted(students?: number[]): Promise<{ ok: boolean; error?: string; departed?: number }> {
    try {
      const r = await this.api.post<{ departed: number; remaining: number }>('rollover/departs/', students ? { students } : {});
      await this.refreshPeople(); await this.loadToPlace();
      return { ok: true, departed: r.departed };
    } catch (e) { return this.fail(e); }
  }
  async suggestPlacement(level: string): Promise<{ assignments?: Record<string, number | null>; error?: string }> {
    try { return { assignments: (await this.api.post<{ assignments: Record<string, number | null> }>('rollover/placement/suggest/', { level })).assignments }; }
    catch (e) { return { error: this.fail(e).error }; }
  }
  async savePlacement(assignments: { student: number; class: number }[]): Promise<{ ok: boolean; error?: string; placed?: number; remaining?: number }> {
    try {
      const r = await this.api.post<{ placed: number; remaining: number }>('rollover/placement/', { assignments });
      this.toPlace.set(r.remaining);
      await this.refreshPeople(); await this.refreshStructure(); await this.loadFinance();
      return { ok: true, placed: r.placed, remaining: r.remaining };
    } catch (e) { return this.fail(e); }
  }
  /** `perms` : droits du compte (passés à l'ouverture de session, avant que le compte courant soit connu). */
  async loadToPlace(perms?: readonly string[]): Promise<void> {
    const p = perms ?? this.me()?.perms ?? [];
    if (this.apiMode() && (p.includes('rollover') || p.includes('classes.write'))) await this.placementState();
  }
  async undoRollover(): Promise<{ ok: boolean; error?: string }> {
    try { await this.api.post('rollover/undo/', {}); await this.afterRollover(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async reintegrateAsync(id: string, classId: string): Promise<{ ok: boolean; error?: string }> {
    try { await this.api.post(`students/${id}/reintegrate/`, { school_class: Number(classId) }); await this.refreshPeople(); await this.refreshStructure(); await this.loadFinance(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  /** Enregistre les périodes d'évaluation de l'année (trimestres, semestres ou autre). */
  async savePeriodesAsync(list: { label: string; start: string; end: string; coef: number }[]): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      const cur = this.terms();
      if (list.some((p) => !Number.isInteger(p.coef) || p.coef < 1 || p.coef > 9)) return { ok: false, error: 'Le coefficient d’une période est un nombre entier de 1 à 9.' };
      this.terms.set(list.map((p, i) => ({ id: cur[i]?.id ?? `P${i + 1}`, label: p.label.trim(), start: p.start, end: p.end, locked: cur[i]?.locked ?? false, coef: p.coef })));
      if (!this.terms().some((t) => t.id === this.termId())) this.termId.set(this.currentTermId() ?? this.terms()[0].id);
      return { ok: true };
    }
    try {
      const r = await this.api.request<ApiTerm[]>('PUT', 'calendar/periodes/', { periodes: list });
      this.terms.set(r.map(mapTerm));
      this.termPk = new Map(r.map((t) => [t.code, t.id]));
      if (!r.some((t) => t.code === this.termId())) this.termId.set(this.currentTermId() ?? r[0].code);
      await this.loadTerm();
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  async setFeeDateAsync(key: string, date: string): Promise<boolean> {
    if (!this.apiMode()) { this.setFeeDate(key, date); return true; }
    try { await this.api.put('finance/dates/', { key, date }); await this.loadFinance(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async matchLineAsync(lineId: string, studentId: string): Promise<boolean> {
    if (!this.apiMode()) { this.matchLine(lineId, studentId); return true; }
    try { await this.api.post(`finance/statement/${lineId}/match/`, { student: Number(studentId) }); await this.loadFinance(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async fixMismatchAsync(lineId: string): Promise<boolean> {
    if (!this.apiMode()) { this.fixMismatch(lineId); return true; }
    try { await this.api.post(`finance/statement/${lineId}/fix/`); await this.loadFinance(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async importStatementAsync(file: File): Promise<{ created?: number; skipped?: number; errors?: { line: number; error: string }[]; error?: string }> {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await this.api.post<{ created: number; skipped: number; errors: { line: number; error: string }[] }>('finance/statement/import/', fd);
      await this.loadFinance();
      return r;
    } catch (e) { return { error: this.fail(e).error }; }
  }
  /** Paiement mobile money : crée la demande ; seul le retour de l'opérateur confirme (voir pollIntent). */
  async initiatePay(studentId: string, amount: number, mode: PayMode, phone: string): Promise<{ intent?: ApiIntent; error?: string }> {
    try {
      return { intent: await this.api.post<ApiIntent>('finance/pay/initiate/', { student: Number(studentId), amount, mode, phone }) };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  /** Bac à sable (développement) : simule le retour de l'opérateur. Renvoie false si le serveur ne l'autorise pas (production). */
  async sandboxConfirm(reference: string, fail = false): Promise<boolean> {
    try { await this.api.post(`finance/pay/${reference}/sandbox-confirm/${fail ? '?fail=1' : ''}`); return true; } catch { return false; }
  }
  async intentStatus(reference: string): Promise<ApiIntent | null> {
    try { return await this.api.get<ApiIntent>(`finance/pay/${reference}/`); } catch { return null; }
  }
  async remindAsync(ids: string[]): Promise<number> {
    try { const r = await this.api.post<{ sent: number }>('finance/reminders/', { students: ids.map(Number) }); return r.sent; }
    catch (e) { this.toast(this.fail(e).error ?? 'Erreur', 'err'); return 0; }
  }
  /** Identité publique de l'école (nom, logo, couleur) pour l'écran de connexion. */
  /** Contrôle anti-robot (petit calcul) : défi courant, ou null quand le serveur ne l'exige pas. */
  readonly captcha = signal<{ token: string; question: string } | null>(null);
  async loadCaptcha(): Promise<void> {
    if (!this.apiMode()) return;
    try {
      const c = await this.api.get<{ enabled: boolean; token?: string; question?: string }>('auth/captcha/');
      this.captcha.set(c.enabled && c.token ? { token: c.token, question: c.question ?? '' } : null);
    } catch { this.captcha.set(null); }
  }
  private captchaBody(answer: string): Record<string, string> {
    const c = this.captcha();
    return c ? { captcha_token: c.token, captcha_answer: answer.trim() } : {};
  }
  /** Page d'accueil publique : commune à toutes les écoles, réglée par l'administrateur de la plateforme (nom, logo, diaporama, carte d'exemple).
   *  `window.ECOLE_PHOTOS` (config.js) sert de secours tant qu'aucune photo n'est enregistrée. */
  readonly accueil = signal<Accueil>({ nom: '', logo: '', carte: true, photos: ((globalThis as unknown as { ECOLE_PHOTOS?: unknown[] }).ECOLE_PHOTOS ?? [])
    .filter((u): u is string => typeof u === 'string').map((url, i) => ({ id: 'cfg' + i, url, caption: '' })) });
  async loadPublicSchool(): Promise<void> {
    if (!this.apiMode()) return;
    try {
      const code = this.ecole().trim().toLowerCase();
      const r = await this.api.get<{ name: string; logo: string; hue: number; multi?: boolean; code?: string; accueil?: Omit<Accueil, 'photos'> & { photos: (Omit<VitrinePhoto, 'id'> & { id: number })[] } }>(code ? `public/school/?ecole=${encodeURIComponent(code)}` : 'public/school/');
      this.multiSchool.set(!!r.multi || !!code);
      this.school.update((s) => ({ ...s, name: r.name, logo: r.logo || undefined, hue: r.hue }));
      if (r.accueil) {
        const a = r.accueil;
        this.accueil.update((cur) => ({ nom: a.nom, logo: a.logo, carte: a.carte, photos: a.photos.length ? a.photos.map((p) => ({ ...p, id: String(p.id) })) : cur.photos,
          contact: a.contact, prix: a.prix ?? null, chiffres: a.chiffres ?? null, visiteurs: a.visiteurs ?? null }));
      }
    } catch { /* serveur injoignable : l'écran de connexion garde ses valeurs par défaut */ }
  }
  /** Page d'accueil : signale une visite (comptage anonyme, pour la fréquentation vue par l'administrateur de la plateforme). */
  recordVisit(): void {
    if (this.apiMode()) void this.api.post('public/visite/').catch(() => undefined);
  }
  /** Page d'accueil : une école intéressée demande une démonstration (sans compte). */
  async requestDemoAsync(f: { ecole: string; ville: string; nom: string; telephone: string; email: string; message: string; site: string }): Promise<{ ok: boolean; error?: string; errors?: Record<string, unknown> }> {
    if (!this.apiMode()) return { ok: true };
    try { await this.api.post('public/demande-demo/', f); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  /** Code de l'établissement saisi à la connexion (plateforme multi-écoles). Verrouillé par `window.ECOLE_CODE` (config.js) ou le paramètre `?ecole=`. */
  /** Abonnement de l'école, communiqué à la direction seulement (null pour les autres rôles). */
  readonly abonnement = signal<{ etat: string; fin: string | null; jours: number | null } | null>(null);
  /** Message de rappel affiché à la direction quand l'échéance approche ou est dépassée. */
  readonly abonnementAlerte = computed(() => {
    const a = this.abonnement();
    if (!a || (a.etat !== 'bientot' && a.etat !== 'grace') || !a.fin) return '';
    const d = new Date(a.fin + 'T12:00:00').toLocaleDateString('fr-FR');
    return a.etat === 'bientot'
      ? `L’abonnement de l’école arrive à échéance le ${d}. Contactez l’administration de la plateforme pour le renouveler.`
      : `L’abonnement de l’école a expiré le ${d}. L’école passera bientôt en lecture seule : contactez sans tarder l’administration de la plateforme.`;
  });
  /** Abonnement échu au-delà du délai de grâce : tout le monde consulte, personne ne modifie (le serveur refuse les modifications). */
  readonly lectureSeule = signal(false);
  readonly ecole = signal(initialSchoolCode());
  /** Vrai quand le serveur héberge plusieurs écoles : l'écran de connexion demande alors le code. */
  readonly multiSchool = signal(false);
  readonly ecoleLocked = !!(globalThis as unknown as { ECOLE_CODE?: string }).ECOLE_CODE;
  setEcole(code: string): void {
    this.ecole.set(code);
    try { globalThis.localStorage?.setItem('ecole.code', code.trim().toLowerCase()); } catch { /* sans effet */ }
  }
  async loadAnnouncements(): Promise<void> {
    if (!this.apiMode()) return;
    try { this.announcements.set((await this.api.get<ApiAnnouncement[]>('announcements/')).map(mapAnnouncement)); } catch { this.announcements.set([]); }
  }
  /** `cursus` (école à plusieurs cursus) : un cursus visé, '' = toute l'école ; null = choix par défaut du serveur. */
  async addAnnouncementAsync(f: { title: string; body: string; audience: Role[]; cursus?: string | null }): Promise<boolean> {
    if (!this.apiMode()) { this.addAnnouncement(f); return true; }
    try {
      await this.api.post('announcements/', { title: f.title, body: f.body, audience: f.audience, ...(f.cursus != null ? { cursus: f.cursus ? [Number(f.cursus)] : [] } : {}) });
      await this.loadAnnouncements(); return true;
    }
    catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async loadLog(): Promise<void> {
    if (!this.apiMode()) return;
    try { const r = await this.api.get<{ results: ApiLog[] }>('journal/?page_size=500'); this.log.set(r.results.map(mapLog)); }
    catch { this.log.set([]); }
  }
  async refreshFinance(): Promise<void> { await this.loadFinance(); await this.loadNotices(); }
  async loadIncidents(): Promise<void> {
    if (!this.apiMode()) return;
    try { this.incidents.set((await this.orEmpty(this.api.all<ApiIncident>('incidents/'))).map(mapIncident)); } catch (e) { this.toast(this.fail(e).error, 'err'); }
  }
  private poll: ReturnType<typeof setInterval> | undefined;
  async loadNotices(forUser?: string): Promise<void> {
    const uid0 = forUser ?? this.userId();
    if (!this.apiMode() || !uid0) return;
    try {
      const r = await this.api.get<{ results: ApiNotice[] }>('notifications/');
      this.notices.set(r.results.map((n) => mapNotice(n, uid0)));
    } catch { /* silencieux : la prochaine interrogation réessaie */ }
  }
  startPolling(): void {
    this.stopPolling();
    if (this.apiMode()) this.poll = setInterval(() => void this.loadNotices(), 60000);
  }
  stopPolling(): void { if (this.poll) clearInterval(this.poll); this.poll = undefined; }

  /** Suivi des appels de la période (personnel) : cours prévus, faits ou non, absents et retards. */
  async appelSuiviAsync(f: { from: string; to: string; classId?: string; missing?: boolean }): Promise<{ rows?: SuiviRow[]; error?: string }> {
    if (!this.apiMode()) return { rows: this.demoSuivi(f) };
    try {
      const q = new URLSearchParams({ from: f.from, to: f.to, ...(f.classId ? { class: f.classId } : {}), ...(f.missing ? { missing: '1' } : {}) });
      const r = await this.api.get<{ rows: ApiSuiviRow[] }>(`attendance/suivi/?${q}`);
      return { rows: r.rows.map(mapSuivi) };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  /** Démonstration (sans emploi du temps) : les appels faits par demi-journée ; un appel oublié ne peut pas y être repéré. */
  private demoSuivi(f: { from: string; to: string; classId?: string; missing?: boolean }): SuiviRow[] {
    if (f.missing) return [];
    const scope = new Set(this.scopeClasses().map((c) => c.id));
    const rows: SuiviRow[] = [];
    for (const key of this.sessions()) {
      const [classId, date, slot] = key.split('|');
      if (!scope.has(classId) || (f.classId && classId !== f.classId) || date < f.from || date > f.to) continue;
      const abs = this.absences().filter((a) => a.classId === classId && a.date === date && a.slot === slot);
      rows.push({ date, classId, className: this.className(classId), slot: slot as Slot, subjectName: '', start: '', end: '', teacherName: '', done: true, takenBy: '', takenAt: null,
        absents: abs.filter((a) => a.status === 'A').length, retards: abs.filter((a) => a.status === 'R').length });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date) || a.slot.localeCompare(b.slot) || a.className.localeCompare(b.className));
  }
  async saveAppelAsync(classId: string, date: string, slot: Slot, entries: { studentId: string; status: 'P' | 'A' | 'R' }[]): Promise<{ n?: number; error?: string }> {
    if (!this.apiMode()) return { n: this.saveAppel(classId, date, slot, entries) };
    try {
      const r = await this.api.put<{ absents: number; notified: number }>('attendance/appel/', {
        school_class: Number(classId), date, slot, entries: entries.map((e) => ({ student: Number(e.studentId), status: e.status })),
      });
      await this.loadAttendance();
      return { n: r.notified };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  /** Dernier jour où la famille peut justifier l'absence (null : sans délai). */
  justifDeadlineOf(a: Absence): string | null { return justifDeadline(a.date, this.school().justifDelai); }
  /** Délai laissé aux familles dépassé. */
  justifLate(a: Absence): boolean { const d = this.justifDeadlineOf(a); return !!d && this.today > d; }
  /** Pourquoi la famille ne peut plus justifier l'absence elle-même (null : elle le peut). */
  familyJustifBlock(a: Absence): string | null {
    if (termOfDate(this.terms(), a.date)?.locked) return 'Période verrouillée : adressez-vous à l’école.';
    if (this.justifLate(a)) return 'Délai de justification dépassé : adressez-vous à l’école.';
    return null;
  }
  /** Période verrouillée : seule la direction traite encore les justificatifs. */
  private justifLockMsg(a: Absence): string | null {
    return termOfDate(this.terms(), a.date)?.locked && !this.can('grades.locked') ? 'Cette période est verrouillée : seule la direction peut traiter ce justificatif.' : null;
  }
  async submitJustifAsync(absId: string, motif: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      const ab = this.absences().find((x) => x.id === absId);
      const block = ab && this.familyJustifBlock(ab);
      if (block) return { ok: false, error: block };
      this.submitJustif(absId, motif); return { ok: true };
    }
    try { await this.api.post(`absences/${absId}/justify/`, { motif }); await this.loadAttendance(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async decideJustifAsync(absId: string, accept: boolean): Promise<boolean> {
    if (!this.apiMode()) {
      const ab = this.absences().find((x) => x.id === absId);
      const lock = ab && this.justifLockMsg(ab);
      if (lock) { this.toast(lock, 'err'); return false; }
      this.decideJustif(absId, accept); return true;
    }
    try { await this.api.post(`absences/${absId}/decide/`, { accept }); await this.loadAttendance(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  /** L'école enregistre un justificatif apporté au bureau (certificat papier…) : accepté d'office, même après le délai. */
  async recordJustifAsync(absId: string, motif: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      const ab = this.absences().find((x) => x.id === absId);
      if (!ab || !this.can('justifs')) return { ok: false, error: 'Action non autorisée.' };
      const lock = this.justifLockMsg(ab); if (lock) return { ok: false, error: lock };
      const late = this.justifLate(ab);
      this.absences.update((l) => l.map((x) => (x.id === absId ? { ...x, justif: 'acceptee' as Justif, motif } : x)));
      this.refreshAbsenceDeduction(ab.studentId, ab.date);
      this.notify(this.familyUserIds(ab.studentId), `L’absence de ${this.studentById().get(ab.studentId)?.prenoms ?? ''} du ${ab.date.split('-').reverse().join('/')} a été justifiée par l’école.`, 'absence', 'presences');
      this.addLog('Justificatif', `Saisi par l’école${late ? ' (hors délai)' : ''} : ${this.studentName(ab.studentId)}, ${ab.date.split('-').reverse().join('/')}`);
      return { ok: true };
    }
    try { await this.api.post(`absences/${absId}/record/`, { motif }); await this.loadAttendance(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async addIncidentAsync(f: { studentId: string; type: IncidentType; gravite: Gravite; sanction: Sanction; description: string; date?: string; retrait?: number }): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.addIncident(f); return { ok: true }; }
    try {
      await this.api.post('incidents/', { student: Number(f.studentId), type: f.type, gravite: f.gravite, sanction: f.sanction, description: f.description, date: f.date ?? this.today, ...(f.retrait ? { retrait: f.retrait } : {}) });
      await this.loadIncidents();
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  // --- Conduite ---
  /** Demi-journées d'absence non justifiée d'un élève sur la période (plusieurs séances le même matin = une seule). */
  private halfdays(studentId: string, t: Term): number {
    const seen = new Set<string>();
    for (const a of this.absences()) {
      if (a.studentId === studentId && a.status === 'A' && (a.justif === 'aucune' || a.justif === 'refusee') && a.date >= t.start && a.date <= t.end) seen.add(`${a.date}|${a.slot.startsWith('Après') ? 'A' : 'M'}`);
    }
    return seen.size;
  }
  /** Après une décision sur un justificatif : le retrait « absences » déjà appliqué suit (rien n'est créé). */
  private refreshAbsenceDeduction(studentId: string, date: string): void {
    const t = termOfDate(this.terms(), date), c = this.conductCfg();
    const cur = t && this.deductions().find((d) => d.studentId === studentId && d.termId === t.id && d.kind === 'absences');
    if (!t || !cur || !c.tranche) return;
    const hd = this.halfdays(studentId, t), due = Math.floor(hd / c.tranche) * c.points;
    this.deductions.update((l) => (due <= 0 ? l.filter((d) => d !== cur) : l.map((d) => (d === cur ? { ...d, points: due, reason: `${hd} demi-journée(s) d’absence non justifiée(s)` } : d))));
  }
  private demoSheet(classId: string): ConductSheet {
    const c = this.conductCfg(), t = this.term(), removed = this.removedByStudent(t.id);
    const inc = new Map(this.incidents().map((i) => [i.id, i.status]));
    return {
      classId, termId: t.id, locked: t.locked, published: !!t.conductPublished, max: c.max, inAverage: c.inAverage, coef: c.coef, rule: { tranche: c.tranche, points: c.points },
      students: (this.studentsByClass().get(classId) ?? []).map((st) => {
        const ded = this.deductions().filter((d) => d.studentId === st.id && d.termId === t.id);
        const r = removed[st.id] ?? 0, hd = this.halfdays(st.id, t);
        return { studentId: st.id, name: `${st.nom} ${st.prenoms}`, max: c.max, removed: r, note: Math.max(0, c.max - r), halfdays: hd,
          due: c.tranche ? Math.floor(hd / c.tranche) * c.points : 0, applied: ded.find((d) => d.kind === 'absences')?.points ?? 0,
          deductions: ded.map((d) => ({ id: d.id, points: d.points, reason: d.reason, kind: d.kind, date: d.date, byName: d.byName,
            pending: !!d.incidentId && inc.get(d.incidentId) !== 'valide', refused: !!d.incidentId && inc.get(d.incidentId) === 'refuse' })) };
      }),
    };
  }
  private lockedMsg(): string | null { return this.term().locked && !this.can('grades.locked') ? 'Cette période est verrouillée. Seule la direction peut modifier la conduite.' : null; }
  private inScope(classId: string): boolean { const sc = this.educatorScope(); return !sc || sc.includes(classId); }
  async conductAsync(classId: string): Promise<{ sheet?: ConductSheet; error?: string }> {
    if (!this.apiMode()) return this.inScope(classId) ? { sheet: this.demoSheet(classId) } : { error: 'Cette classe ne fait pas partie de vos classes.' };
    try { return { sheet: mapConduct(await this.api.get<ApiConduct>(`conduct/?class=${classId}&term=${this.termId()}`)) }; } catch (e) { return { error: this.fail(e).error }; }
  }
  async addDeductionAsync(f: { studentId: string; points: number; reason: string; date?: string }): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      const st = this.studentById().get(f.studentId);
      if (!st || !this.inScope(st.classId)) return { ok: false, error: 'Cet élève n’est pas dans vos classes.' };
      const lock = this.lockedMsg(); if (lock) return { ok: false, error: lock };
      this.deductions.update((l) => [...l, { id: uid('cd-'), studentId: f.studentId, termId: this.termId(), points: f.points, reason: f.reason, kind: 'autre', date: f.date ?? this.today, byName: this.me()?.name ?? '' }]);
      this.addLog('Conduite', `${this.studentName(f.studentId)} : −${f.points} (${f.reason})`);
      return { ok: true };
    }
    try { await this.api.post('conduct/deductions/', { student: Number(f.studentId), term: this.termId(), points: f.points, reason: f.reason, ...(f.date ? { date: f.date } : {}) }); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async removeDeductionAsync(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      const lock = this.lockedMsg(); if (lock) return { ok: false, error: lock };
      this.deductions.update((l) => l.filter((d) => d.id !== id));
      return { ok: true };
    }
    try { await this.api.request('DELETE', `conduct/deductions/${id}/`); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async applyAbsencesAsync(classId: string): Promise<{ updated?: number; error?: string }> {
    if (!this.apiMode()) {
      const c = this.conductCfg(), t = this.term();
      if (!c.tranche) return { error: 'L’école n’a pas fixé de règle pour les absences (Paramètres > Conduite).' };
      const lock = this.lockedMsg(); if (lock) return { error: lock };
      let n = 0;
      let list = this.deductions();
      for (const st of this.studentsByClass().get(classId) ?? []) {
        const hd = this.halfdays(st.id, t), due = Math.floor(hd / c.tranche) * c.points;
        const cur = list.find((d) => d.studentId === st.id && d.termId === t.id && d.kind === 'absences');
        const reason = `${hd} demi-journée(s) d’absence non justifiée(s)`;
        if (due <= 0) { if (cur) { list = list.filter((d) => d !== cur); n++; } continue; }
        if (!cur) { list = [...list, { id: uid('cd-'), studentId: st.id, termId: t.id, points: due, reason, kind: 'absences', date: this.today, byName: this.me()?.name ?? '' }]; n++; }
        else if (cur.points !== due || cur.reason !== reason) { list = list.map((d) => (d === cur ? { ...d, points: due, reason } : d)); n++; }
      }
      this.deductions.set(list);
      return { updated: n };
    }
    try { return await this.api.post<{ updated: number }>('conduct/absences/apply/', { school_class: Number(classId), term: this.termId() }); } catch (e) { return { error: this.fail(e).error }; }
  }
  async publishConductAsync(published: boolean): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) {
      this.terms.update((l) => l.map((t) => t.id === this.termId() ? { ...t, conductPublished: published } : t));
      if (published) for (const st of this.students()) this.notify(this.familyUserIds(st.id), `La note de conduite de ${st.prenoms} (${this.term().label}) est disponible sur le bulletin.`, 'note', 'bulletins');
      return { ok: true };
    }
    try {
      await this.api.post('conduct/publish/', { term: this.termId(), published });
      this.terms.update((l) => l.map((t) => t.id === this.termId() ? { ...t, conductPublished: published } : t));
      await this.loadTerm();
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  async educatorsAsync(): Promise<Educator[]> {
    if (!this.apiMode()) return this.users().filter((u) => u.role === 'educateur').map((u) => ({ id: u.id, name: u.name, classes: this.educatorClasses()[u.id] ?? [] }));
    try { return (await this.api.get<ApiEducator[]>('educators/')).map(mapEducator); } catch (e) { this.toast(this.fail(e).error, 'err'); return []; }
  }
  async setEducatorClassesAsync(id: string, classIds: string[]): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.educatorClasses.update((m) => ({ ...m, [id]: classIds })); this.notify([id], 'Vos classes ont été mises à jour.', 'systeme', 'presences'); return { ok: true }; }
    try { await this.api.put(`educators/${id}/classes/`, { classes: classIds.map(Number) }); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async decideIncidentAsync(id: string, accept: boolean, note: string): Promise<boolean> {
    if (!this.apiMode()) { this.decideIncident(id, accept, note); return true; }
    try { await this.api.post(`incidents/${id}/decide/`, { accept, note }); await this.loadIncidents(); return true; } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async markReadAsync(id: string): Promise<void> {
    this.markRead(id);
    if (this.apiMode()) { try { await this.api.post('notifications/read/', { ids: [Number(id)] }); } catch { /* sans effet */ } }
  }
  async markAllReadAsync(): Promise<void> {
    this.markAllRead();
    if (this.apiMode()) { try { await this.api.post('notifications/read/', {}); } catch { /* sans effet */ } }
  }
  /** Charge évaluations, notes, appréciations et statistiques du trimestre affiché. */
  async loadTerm(): Promise<void> {
    if (!this.apiMode()) return;
    try {
      const o = mapOverview(await this.api.get<ApiOverview>(`overview/?term=${this.termId()}`), this.codeOf());
      this.evals.set(o.evals); this.grades.set(o.grades); this.apprec.set(o.apprec); this.conseil.set(o.conseil);
      this.serverStats.set({ pub: o.pub, all: o.all });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { this.evals.set([]); this.grades.set({}); this.serverStats.set({ pub: new Map(), all: new Map() }); return; }
      this.toast(this.fail(e).error, 'err');
    }
  }
  async loadDecisions(): Promise<void> {
    if (!this.apiMode()) return;
    try {
      const rows = await this.api.get<ApiDecisionRow[]>('decisions/');
      this.decisions.set(rows.map(mapDecision).filter((d): d is Decision => !!d));
      this.annual.set(new Map(rows.map((r) => [String(r.student), { value: r.annual_avg, terms: r.terms }])));
    } catch (e) { if (!(e instanceof ApiError && e.status === 403)) this.toast(this.fail(e).error, 'err'); }
  }
  async setTerm(t: TermId): Promise<void> {
    this.termId.set(t);
    await this.loadTerm();
  }
  private async refreshResults(): Promise<void> { await this.loadTerm(); await this.loadDecisions(); }

  async createEvalAsync(f: { classId: string; subjectId: string; type: EvalType; title: string; date: string; coef?: number; bareme?: number }): Promise<{ ev?: Evaluation; error?: string }> {
    if (!this.apiMode()) return { ev: this.createEval(f) };
    const sub = this.subjectPk.get(f.subjectId);
    if (sub === undefined) return { error: 'Matière inconnue.' };
    try {
      const r = await this.api.post<ApiEval>('evaluations/', { school_class: Number(f.classId), subject: sub, term: this.termId(), type: f.type, title: f.title, date: f.date, coef: f.coef ?? 1, bareme: f.bareme ?? 20 });
      await this.loadTerm();
      return { ev: mapEval(r, this.codeOf()) ?? undefined };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  /** L'école programme un examen : une évaluation par classe et matière, confiée à l'enseignant affecté (prévenu). */
  async scheduleExamAsync(f: { title: string; type: EvalType; date: string; coef?: number; bareme?: number; classIds: string[]; subjectIds: string[] }): Promise<{ created?: number; kept?: number; teachers?: number; orphans?: number; error?: string }> {
    try {
      const r = await this.api.post<{ created: number; kept: number; teachers: number; orphans: unknown[] }>('evaluations/schedule/', {
        title: f.title, type: f.type, term: this.termId(), date: f.date, coef: f.coef ?? 1, bareme: f.bareme ?? 20,
        classes: f.classIds.map(Number), subjects: f.subjectIds.map((c) => this.subjectPk.get(c)).filter((x): x is number => x !== undefined),
      });
      await this.loadTerm();
      return { created: r.created, kept: r.kept, teachers: r.teachers, orphans: r.orphans.length };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  async saveGradesAsync(evalId: string, values: Record<string, number | null>): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.saveGrades(evalId, values);
    try {
      await this.api.put(`evaluations/${evalId}/grades/`, { values });
      await this.refreshResults();
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  /** Supprime une évaluation encore en brouillon, avec ses notes (le serveur refuse si elle est publiée, verrouillée ou programmée par l'école). */
  async deleteEvalAsync(evalId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.deleteEval(evalId);
    try {
      await this.api.delete(`evaluations/${evalId}/`);
      await this.refreshResults();
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  async setPublishedAsync(evalIds: string[], published: boolean): Promise<boolean> {
    if (!this.apiMode()) { this.setPublished(evalIds, published); return true; }
    try {
      await this.api.post('evaluations/publish/', { ids: evalIds.map(Number), published });
      await this.refreshResults();
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async lockTermAsync(termId: TermId, locked: boolean): Promise<boolean> {
    if (!this.apiMode()) { this.lockTerm(termId, locked); return true; }
    const pk = this.termPk.get(termId);
    if (pk === undefined) return false;
    try {
      await this.api.post(`terms/${pk}/lock/`, { locked });
      this.terms.update((t) => t.map((x) => (x.id === termId ? { ...x, locked } : x)));
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async setApprecAsync(studentId: string, termId: TermId, subjectId: string, text: string): Promise<boolean> {
    if (!this.apiMode()) { this.setApprec(studentId, termId, subjectId, text); return true; }
    const sub = this.subjectPk.get(subjectId);
    if (sub === undefined) return false;
    try {
      await this.api.put('appreciations/', { student: Number(studentId), term: termId, subject: sub, text });
      this.setApprec(studentId, termId, subjectId, text);
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  // --- Professeur principal ---
  /** Classes dont l'enseignant connecté est professeur principal. */
  readonly myPrincipalClasses = computed(() => { const me = this.myTeacher(); return me ? this.classes().filter((c) => c.principalId === me.id) : []; });
  /** Attribue (ou retire, `null`) le professeur principal d'une classe : direction et secrétariat. */
  async setPrincipalAsync(classId: string, teacherId: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.setPrincipal(classId, teacherId);
    try {
      const c = await this.api.put<ApiClass>(`classes/${classId}/principal/`, { teacher: teacherId ? Number(teacherId) : null });
      this.classes.update((l) => l.map((x) => (x.id === classId ? mapClass(c) : x)));
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  setPrincipal(classId: string, teacherId: string | null): { ok: boolean; error?: string } {
    if (!this.can('classes.write') && !this.can('subjects.write')) return { ok: false, error: 'Vous n’avez pas le droit d’effectuer cette action.' };
    this.classes.update((l) => l.map((x) => (x.id === classId ? { ...x, principalId: teacherId ?? undefined } : x)));
    const t = teacherId ? this.teacherById().get(teacherId) : undefined;
    if (t) this.notify([t.userId], `Vous êtes professeur principal de la ${this.className(classId)}.`, 'systeme', 'maclasse');
    this.addLog('Professeur principal', `${this.className(classId)} : ${t?.name ?? 'aucun'}`);
    return { ok: true };
  }
  /** Tout ce que le professeur principal voit de sa classe pour la période choisie (le serveur vérifie qu'il l'est bien). */
  async principalClassAsync(classId: string): Promise<{ data?: PrincipalClass; error?: string }> {
    if (!this.apiMode()) return { data: this.demoPrincipal(classId) };
    try {
      return { data: mapPrincipal(await this.api.get<ApiPrincipal>(`principal/${classId}/?term=${this.termId()}`), this.codeOf()) };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  private demoPrincipal(classId: string): PrincipalClass {
    const t = this.term(), studs = this.studentsByClass().get(classId) ?? [], ids = new Set(studs.map((x) => x.id));
    const inTerm = (d: string) => (!t.start || d >= t.start) && (!t.end || d <= t.end);
    const evals = this.evals().filter((e) => e.classId === classId && e.termId === t.id);
    const evIds = new Set(evals.map((e) => e.id));
    const absences = this.absences().filter((a) => ids.has(a.studentId) && inTerm(a.date)).sort((a, b) => b.date.localeCompare(a.date));
    const assiduite: PrincipalClass['assiduite'] = {};
    for (const a of absences) {
      const c = (assiduite[a.studentId] ??= { absences: 0, nonJustifiees: 0, retards: 0 });
      if (a.status === 'R') c.retards++; else { c.absences++; if (a.justif !== 'acceptee') c.nonJustifiees++; }
    }
    return {
      classId, className: this.className(classId), termLabel: t.label, locked: !!t.locked,
      students: studs.map((x) => ({ id: x.id, nom: x.nom, prenoms: x.prenoms, matricule: x.matricule })),
      subjects: this.subjectsOfClass(classId).map((x) => ({ id: x.id, name: x.name, coef: this.coefOf(classId, x.id) })),
      evals: evals.map((e) => ({ id: e.id, subjectId: e.subjectId, title: e.title, type: e.type, date: e.date, bareme: e.bareme ?? 20, coef: e.coef ?? 1, published: e.published, teacherName: this.teacherById().get(e.teacherId)?.name ?? '' })),
      grades: Object.fromEntries(Object.entries(this.grades()).filter(([k]) => evIds.has(k.split('|')[0]))),
      stats: this.classStats(classId, false), assiduite,
      absences: absences.map((a) => ({ studentId: a.studentId, date: a.date, slot: a.slot, status: a.status, justif: a.justif, motif: a.motif ?? '' })),
      incidents: this.incidents().filter((i) => ids.has(i.studentId) && inTerm(i.date) && i.status !== 'refuse').sort((a, b) => b.date.localeCompare(a.date))
        .map((i) => ({ studentId: i.studentId, date: i.date, type: INCIDENT_LABEL[i.type], gravite: i.gravite, sanction: SANCTION_LABEL[i.sanction], description: i.description, status: i.status })),
      council: Object.fromEntries(studs.map((x) => [x.id, this.conseil()[`${x.id}|${t.id}`] ?? '']).filter(([, v]) => v)),
    };
  }
  async setConseilAsync(studentId: string, termId: TermId, text: string): Promise<boolean> {
    if (!this.apiMode()) { this.setConseil(studentId, termId, text); return true; }
    try {
      await this.api.put('council/', { student: Number(studentId), term: termId, text });
      this.setConseil(studentId, termId, text);
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async setDecisionAsync(studentId: string, value: Decision['value'], comment: string, silent = false, batch = false): Promise<boolean> {
    if (!this.apiMode()) return this.setDecision(studentId, value, comment, silent, batch);
    try {
      await this.api.put('decisions/', { student: Number(studentId), value, comment: comment.trim(), batch });
      this.decisions.update((x) => [...x.filter((y) => y.studentId !== studentId), { studentId, value, comment: comment.trim(), byUserId: this.userId() ?? '', date: this.today, batch }]);
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  /** Annule « Valider les propositions de la classe » : retire les décisions validées en lot, garde celles prises une à une. */
  async cancelBatchAsync(classId: string): Promise<number | null> {
    if (!this.can('decisions.write')) return null;
    const ids = new Set((this.studentsByClass().get(classId) ?? []).map((st) => st.id));
    const drop = () => this.decisions.update((x) => x.filter((d) => !(d.batch && ids.has(d.studentId))));
    if (!this.apiMode()) {
      const n = this.decisions().filter((d) => d.batch && ids.has(d.studentId)).length;
      drop();
      if (n) this.addLog('Décisions de fin d\'année', `Validation des propositions annulée pour ${this.className(classId)} (${n} élève(s))`);
      return n;
    }
    try {
      const r = await this.api.delete<{ deleted: number }>(`decisions/?class=${classId}`);
      drop();
      return r.deleted;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return null; }
  }

  async loadFormer(): Promise<void> { if (this.apiMode()) await this.refreshPeople(); }
  async refreshPeople(): Promise<void> {
    const [students, parentsList] = await Promise.all([this.api.all<ApiStudent>('students/'), this.optional<ApiParent[] | null>('parents/', null)]);
    const present = students.filter((x) => x.active !== false || x.sortie === 'placer');   // dont les élèves à placer (sans classe)
    this.students.set(present.map(mapStudent));
    this.formerStudents.set(students.filter((x) => x.active === false && x.sortie !== 'placer').map(mapStudent));   // « à placer » : pas un ancien élève
    this.parents.set(mapParents(parentsList && parentsList.length ? parentsList : null, present));
  }
  async refreshStructure(): Promise<void> {
    const [subjects, classes, coefs, assigns, teachers, series, levels] = await Promise.all([this.api.all<ApiSubject>('subjects/'), this.api.all<ApiClass>('classes/'), this.api.get<ApiCoef[]>('coefficients/'), this.optional<ApiAssignment[]>('assignments/', []), this.optional<ApiTeacher[]>('teachers/', []), this.optional<ApiSerie[]>('series/', []), this.optional<ApiLevel[]>('levels/', [])]);
    this.levels.set(levels.map(mapLevel));
    this.series.set(this.sortSeries(series.map(mapSerie)));
    this.subjectPk = new Map(subjects.map((x) => [x.code, x.id]));
    const codeOf = this.codeOf();
    this.subjects.set(subjects.map(mapSubject));
    this.classes.set(classes.map(mapClass));
    this.coefs.set(mapCoefs(coefs, codeOf));
    this.assignments.set(assigns.map((a) => mapAssignment(a, codeOf)).filter((a): a is NonNullable<typeof a> => !!a));
    if (teachers.length) this.teachers.set(teachers.map((t) => mapTeacher(t, codeOf)));
  }
  private applyMe(u: ApiUser): void {
    const id = String(u.id);
    this.users.update((us) => us.map((x) => (x.id === id ? { ...mapUser(u, x.refId) } : x)));
  }

  /** Vrai pendant la reprise d'une session après un rechargement de la page (évite d'afficher l'écran de connexion un instant). */
  readonly resuming = signal(false);
  get canResume(): boolean { return this.apiMode() && this.api.resumable; }
  async resume(): Promise<boolean> {
    if (!this.apiMode() || !this.api.resumable) return false;
    this.resuming.set(true);
    try {
      if (!(await this.api.resume())) return false;
      const me = await this.api.get<ApiUser>('me/');
      if (me.platform_admin) { await this.api.logout(); return false; }
      await this.hydrate(me);
      this.userId.set(String(me.id));
      this.startPolling();
      if (me.lang && LANGS.some((l) => l.id === me.lang)) setLang(me.lang as Lang);
      return true;
    } catch {
      await this.api.logout(); this.clearData();
      return false;
    } finally { this.resuming.set(false); }
  }
  async loginAsync(username: string, password: string, captchaAnswer = ''): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.login(username, password);
    try {
      const me = await this.api.login<ApiUser>(username.trim(), password, this.ecole().trim().toLowerCase(), this.captchaBody(captchaAnswer));
      if (me.platform_admin) {
        await this.api.logout();
        return { ok: false, error: 'Ce compte administre la plateforme : ouvrez la page /plateforme.html.' };
      }
      await this.hydrate(me);
      this.userId.set(String(me.id));
      this.startPolling();
      if (me.lang && LANGS.some((l) => l.id === me.lang)) setLang(me.lang as Lang);
      this.page.set('dashboard'); this.param.set(null); this.childId.set(null);
      try { globalThis.scrollTo?.({ top: 0 }); } catch { /* sans effet */ }
      return { ok: true };
    } catch (e) {
      await this.api.logout();
      this.clearData();
      void this.loadCaptcha();
      return this.fail(e);
    }
  }
  async changePasswordAsync(newPw: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.changePassword(newPw);
    try {
      await this.api.post('me/password/', { new: newPw, confirm: newPw });
      const id = this.userId();
      this.users.update((us) => us.map((u) => (u.id === id ? { ...u, mustChange: false } : u)));
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  async changeOwnPasswordAsync(current: string, next: string, confirm: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.changeOwnPassword(current, next, confirm);
    try { await this.api.post('me/password/', { current, new: next, confirm }); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async updateProfileAsync(patch: { name?: string; phone?: string; email?: string; lang?: string }): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) return this.updateProfile(patch);
    try { this.applyMe(await this.api.patch<ApiUser>('me/', patch)); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  async setPhotoAsync(dataUrl: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.setPhoto(dataUrl); return { ok: true }; }
    try {
      if (dataUrl === null) this.applyMe(await this.api.delete<ApiUser>('me/photo/'));
      else {
        const blob = await (await fetch(dataUrl)).blob();
        const fd = new FormData();
        fd.append('photo', blob, 'photo.jpg');
        this.applyMe(await this.api.post<ApiUser>('me/photo/', fd));
      }
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }

  async addStudentAsync(f: NewStudentForm): Promise<{ student: Student; creds: Credential[] }> {
    if (!this.apiMode()) return this.addStudent(f);
    const r = await this.api.post<{ student: ApiStudent; credentials: { role: string; name: string; username: string; password: string }[] }>('students/', {
      nom: f.nom, prenoms: f.prenoms, sexe: f.sexe, naissance: f.naissance, lieu: f.lieu,
      ...(f.classId.startsWith('placer:') ? { level: f.classId.slice(7) } : { school_class: Number(f.classId) }),
      parent_name: `${f.parentTitle} ${f.parentName.trim()}`, parent_phone: f.parentPhone,
    });
    await this.refreshPeople();
    await this.reloadAccounts();
    await this.loadToPlace();
    return {
      student: mapStudent(r.student),
      creds: r.credentials.map((c) => ({ label: `${c.role === 'parent' ? 'Parent' : 'Élève'} : ${c.name}`, username: c.username, password: c.password })),
    };
  }
  /** Modèle Excel d'import des élèves (classes de l'école en liste déroulante). */
  async downloadImportTemplate(kind: ImportKind = 'students'): Promise<void> {
    try { this.saveBlob(`modele-import-${{ students: 'eleves', classes: 'classes', users: 'personnel', payments: 'paiements', subjects: 'matieres' }[kind]}.xlsx`, await this.api.blob(`${IMPORT_PATH[kind]}/import/modele/`)); }
    catch (e) { this.toast(this.fail(e).error ?? 'Téléchargement impossible.', 'err'); }
  }
  /** Import d'un fichier .xlsx ou .csv : `commit = false` pour vérifier seulement, `true` pour inscrire les lignes valides. */
  async importStudentsFile(file: File, commit: boolean, kind: ImportKind = 'students'): Promise<{ ok: boolean; error?: string; res?: ImportReport; creds?: Credential[] }> {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await this.api.post<ImportReport & { credentials?: { role: string; name: string; username: string; password: string }[] }>(`${IMPORT_PATH[kind]}/import/${commit ? '?commit=1' : ''}`, fd);
      if (commit) { await this.refreshPeople(); await this.reloadAccounts(); await this.refreshStructure(); await this.loadFinance(); }
      return { ok: true, res: r, creds: (r.credentials ?? []).map((c) => ({ label: `${c.role === 'parent' ? 'Parent' : c.role === 'eleve' ? 'Élève' : (ROLE_LABEL as Record<string, string>)[c.role] ?? c.role} : ${c.name}`, username: c.username, password: c.password })) };
    } catch (e) { return { ok: false, error: this.fail(e).error }; }
  }
  async updateStudentAsync(id: string, patch: Partial<Student>): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.updateStudent(id, patch); return { ok: true }; }
    try {
      const body: Record<string, unknown> = {};
      for (const k of ['nom', 'prenoms', 'naissance', 'lieu', 'urgence'] as const) if (k in patch) body[k] = patch[k];
      if (patch.niveauxRedoubles !== undefined) body['niveaux_redoubles'] = patch.niveauxRedoubles;
      if (patch.classId !== undefined) body['school_class'] = Number(patch.classId);
      await this.api.patch(`students/${id}/`, body);
      await this.refreshPeople();
      await this.refreshStructure();
      return { ok: true };
    } catch (e) { return this.fail(e); }
  }
  async addClassAsync(c: { name: string; level: string; serie?: string; max: number }): Promise<{ cl?: Classe; error?: string }> {
    if (!this.apiMode()) { const cl = this.addClass(c); return cl ? { cl } : { error: 'Une classe porte déjà ce nom.' }; }
    try {
      const r = await this.api.post<ApiClass>('classes/', { name: c.name.trim(), level: c.level, serie: c.serie ?? '', max_students: c.max });
      await this.refreshStructure();
      return { cl: mapClass(r) };
    } catch (e) {
      const msg = this.fail(e).error;
      return { error: /existe d[ée]j[àa]/i.test(msg) ? 'Une classe porte déjà ce nom.' : msg };
    }
  }
  /** Code technique unique tiré du nom (lettres minuscules, 12 caractères au plus). */
  private subjectCodeFor(name: string): string {
    const base = (name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)) || 'mat';
    const taken = new Set(this.subjects().map((x) => x.id));
    let code = base, n = 2;
    while (taken.has(code)) { const suf = String(n++); code = base.slice(0, 12 - suf.length) + suf; }
    return code;
  }
  async addSubjectAsync(name: string, short: string): Promise<{ ok: boolean; error?: string }> {
    name = name.trim(); short = short.trim() || name.slice(0, 4);
    if (!name) return { ok: false, error: 'Donnez un nom à la matière.' };
    if (this.subjects().some((x) => x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'Cette matière existe déjà.' };
    if (!this.apiMode()) { this.subjects.update((l) => [...l, { id: this.subjectCodeFor(name), name, short }]); return { ok: true }; }
    try { await this.api.post('subjects/', { code: this.subjectCodeFor(name), name, short }); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  async renameSubjectAsync(id: string, name: string, short: string): Promise<{ ok: boolean; error?: string }> {
    name = name.trim(); short = short.trim() || name.slice(0, 4);
    if (!name) return { ok: false, error: 'Donnez un nom à la matière.' };
    if (!this.apiMode()) { this.subjects.update((l) => l.map((x) => x.id === id ? { ...x, name, short } : x)); return { ok: true }; }
    const pk = this.subjectPk.get(id);
    if (pk === undefined) return { ok: false, error: 'Matière introuvable.' };
    try { await this.api.request('PATCH', `subjects/${pk}/`, { name, short }); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  async deleteSubjectAsync(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { this.subjects.update((l) => l.filter((x) => x.id !== id)); return { ok: true }; }
    const pk = this.subjectPk.get(id);
    if (pk === undefined) return { ok: false, error: 'Matière introuvable.' };
    try { await this.api.request('DELETE', `subjects/${pk}/`); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Ajoute un niveau (après `after`, sinon à la fin du cursus). */
  async addLevelAsync(f: { name: string; cycle: 'college' | 'lycee'; hasSeries: boolean; after: string }): Promise<{ ok: boolean; error?: string }> {
    const name = f.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 10) return { ok: false, error: 'Donnez un nom de 1 à 10 caractères (7e, 9e année, 10e…).' };
    if (this.levels().some((l) => l.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `Le niveau « ${name} » existe déjà.` };
    if (!this.apiMode()) {
      const names = this.levelNames(); const pos = f.after && names.includes(f.after) ? names.indexOf(f.after) + 1 : names.length;
      const l = [...this.levels()]; l.splice(pos, 0, { id: `lv-${name}`, name, order: pos, cycle: f.cycle, hasSeries: f.hasSeries, classes: 0 });
      this.levels.set(l.map((x, i) => ({ ...x, order: i }))); this.addLog('Niveau', `Niveau ajouté : ${name}`);
      return { ok: true };
    }
    try { await this.api.post('levels/', { name, cycle: f.cycle, has_series: f.hasSeries, after: f.after }); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Modifie un niveau : le nom et « à séries » seulement s'il n'a pas de classe ; le cycle toujours. */
  async updateLevelAsync(id: string, p: { name: string; cycle: 'college' | 'lycee'; hasSeries: boolean }): Promise<{ ok: boolean; error?: string }> {
    const lv = this.levelsView().find((x) => x.id === id);
    if (!lv) return { ok: false, error: 'Niveau introuvable.' };
    const name = p.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 10) return { ok: false, error: 'Donnez un nom de 1 à 10 caractères.' };
    if (lv.classes && (name !== lv.name || p.hasSeries !== lv.hasSeries)) return { ok: false, error: `Le niveau ${lv.name} a des classes : seul son cycle peut changer.` };
    if (this.levels().some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `Le niveau « ${name} » existe déjà.` };
    if (!this.apiMode()) {
      this.levels.update((l) => l.map((x) => x.id === id ? { ...x, name, cycle: p.cycle, hasSeries: p.hasSeries } : x));
      if (name !== lv.name) this.series.update((l) => l.map((x) => x.level === lv.name ? { ...x, level: name, groupe: `${name} ${x.code}` } : x));
      if (!p.hasSeries) this.series.update((l) => l.filter((x) => x.level !== name));
      this.classes.update((l) => l.map((c) => c.level === name ? { ...c, cycle: p.cycle } : c));
      return { ok: true };
    }
    const body: Record<string, unknown> = { cycle: p.cycle };
    if (name !== lv.name) body['name'] = name;
    if (p.hasSeries !== lv.hasSeries) body['has_series'] = p.hasSeries;
    try { await this.api.request('PATCH', `levels/${id}/`, body); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Retire un niveau sans classe (avec ses séries et coefficients). */
  async removeLevelAsync(id: string): Promise<{ ok: boolean; error?: string }> {
    const lv = this.levelsView().find((x) => x.id === id);
    if (!lv) return { ok: false, error: 'Niveau introuvable.' };
    if (lv.classes) return { ok: false, error: `Le niveau ${lv.name} a des classes.` };
    if (!this.apiMode()) { this.levels.update((l) => l.filter((x) => x.id !== id)); this.series.update((l) => l.filter((x) => x.level !== lv.name)); return { ok: true }; }
    try { await this.api.request('DELETE', `levels/${id}/`); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Nouvel ordre du cursus (le passage suit cet ordre). */
  async reorderLevelsAsync(names: string[]): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiMode()) { const m = new Map(this.levels().map((l) => [l.name, l])); this.levels.set(names.map((n, i) => ({ ...m.get(n)!, order: i }))); return { ok: true }; }
    try { await this.api.post('levels/order/', { names }); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Ajoute une série du lycée ; `copyFrom` (un groupe, ex. « Tle C ») recopie ses coefficients. */
  async addSerieAsync(level: string, code: string, name: string, copyFrom = ''): Promise<{ ok: boolean; error?: string }> {
    code = code.trim().toUpperCase(); name = name.trim();
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(code)) return { ok: false, error: 'Code de 1 à 10 caractères : une lettre, puis lettres ou chiffres (A, C, A1, G2…).' };
    if (this.series().some((x) => x.level === level && x.code === code)) return { ok: false, error: `La série ${code} existe déjà en ${level}.` };
    if (!this.apiMode()) {
      const groupe = `${level} ${code}`;
      this.series.update((l) => this.sortSeries([...l, { id: `${level}-${code}`, level, code, name, groupe, classes: [] }]));
      if (copyFrom) this.coefs.update((c) => { const n = { ...c }; for (const [k, v] of Object.entries(c)) if (k.startsWith(copyFrom + '|')) n[groupe + k.slice(copyFrom.length)] = v; return n; });
      return { ok: true };
    }
    try { await this.api.post('series/', { level, code, name, copy_from: copyFrom }); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Renomme une série ; le code ne change que si aucune classe ne l'utilise (ses coefficients suivent). */
  async updateSerieAsync(id: string, patch: { code: string; name: string }): Promise<{ ok: boolean; error?: string }> {
    const sr = this.series().find((x) => x.id === id);
    if (!sr) return { ok: false, error: 'Série introuvable.' };
    const code = patch.code.trim().toUpperCase(), name = patch.name.trim();
    if (!this.apiMode()) {
      if (code !== sr.code) {
        if (this.classes().some((c) => c.level === sr.level && c.serie === sr.code)) return { ok: false, error: 'Le code ne peut plus changer : une classe utilise cette série.' };
        if (!/^[A-Z][A-Z0-9]{0,9}$/.test(code)) return { ok: false, error: 'Code de 1 à 10 caractères : une lettre, puis lettres ou chiffres.' };
        if (this.series().some((x) => x.level === sr.level && x.code === code)) return { ok: false, error: `La série ${code} existe déjà en ${sr.level}.` };
      }
      const groupe = `${sr.level} ${code}`;
      this.series.update((l) => l.map((x) => x.id === id ? { ...x, code, name, groupe } : x));
      if (groupe !== sr.groupe) this.coefs.update((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k.startsWith(sr.groupe + '|') ? groupe + k.slice(sr.groupe.length) : k, v])));
      return { ok: true };
    }
    const body: Record<string, string> = { name };
    if (code !== sr.code) body['code'] = code;
    try { await this.api.request('PATCH', `series/${id}/`, body); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  /** Retire une série qu'aucune classe n'utilise (et ses coefficients). */
  async removeSerieAsync(id: string): Promise<{ ok: boolean; error?: string }> {
    const sr = this.series().find((x) => x.id === id);
    if (!sr) return { ok: false, error: 'Série introuvable.' };
    if (!this.apiMode()) {
      const used = this.classes().filter((c) => c.level === sr.level && c.serie === sr.code).map((c) => c.name);
      if (used.length) return { ok: false, error: `La série ${sr.groupe} est utilisée par ${used.join(', ')}.` };
      this.series.update((l) => l.filter((x) => x.id !== id));
      this.coefs.update((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith(sr.groupe + '|'))));
      return { ok: true };
    }
    try { await this.api.request('DELETE', `series/${id}/`); await this.refreshStructure(); return { ok: true }; }
    catch (e) { return this.fail(e); }
  }
  async setCoefAsync(groupe: string, subjectId: string, value: number): Promise<void> {
    if (!this.apiMode()) return this.setCoef(groupe, subjectId, value);
    const pk = this.subjectPk.get(subjectId);
    if (pk === undefined) return;
    try { await this.api.put('coefficients/', { groupe, subject: pk, value }); await this.refreshStructure(); } catch (e) { this.toast(this.fail(e).error, 'err'); }
  }
  async setAssignmentAsync(classId: string, subjectId: string, teacherId: string): Promise<boolean> {
    if (!this.apiMode()) { this.setAssignment(classId, subjectId, teacherId); return true; }
    const pk = this.subjectPk.get(subjectId);
    if (pk === undefined) return false;
    try {
      await this.api.put('assignments/', { school_class: Number(classId), subject: pk, teacher: teacherId ? Number(teacherId) : null });
      await this.refreshStructure();
      return true;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return false; }
  }
  async createStaffAsync(f: { name: string; role: 'admin' | 'directeur' | 'fondateur' | 'educateur' | 'enseignant' | 'comptable' | 'informatique' | 'personnel'; roleId?: number; phone: string; subjectId?: string; username: string; email?: string; cursus?: string | null }): Promise<{ cred?: Credential; error?: string }> {
    if (!this.apiMode()) { const c = this.createStaff(f); return c ? { cred: c } : { error: 'Cet identifiant existe déjà.' }; }
    try {
      const r = await this.api.post<{ user: ApiUser; credentials: { username: string; password: string }; invitation?: boolean | null }>('users/', { name: f.name, role: f.role, ...(f.roleId ? { role_id: f.roleId } : {}), phone: f.phone, username: f.username, email: (f.email ?? '').trim(), ...(f.cursus != null ? { cursus: f.cursus ? [Number(f.cursus)] : [] } : {}) });
      if (f.role === 'enseignant' && f.subjectId && this.subjectPk.has(f.subjectId)) {
        const ts = await this.api.get<ApiTeacher[]>('teachers/');
        const t = ts.find((x) => x.user_id === r.user.id);
        if (t) await this.api.patch(`teachers/${t.id}/`, { subject_ids: [this.subjectPk.get(f.subjectId)] });
      }
      await this.reloadAccounts();
      return { cred: { label: r.user.name + (r.invitation === true ? ' (accès envoyés par e-mail)' : r.invitation === false ? ' (e-mail non envoyé : remettez les accès)' : ''), username: r.credentials.username, password: r.credentials.password } };
    } catch (e) { return { error: this.fail(e).error }; }
  }
  private async reloadAccounts(): Promise<void> {
    const codeOf = this.codeOf();
    const me = this.me();
    const [users, teachers] = await Promise.all([this.optional<ApiUser[]>('users/', []), this.optional<ApiTeacher[]>('teachers/', [])]);
    if (users.length) this.users.set(users.map((u) => mapUser(u, u.id === Number(me?.id) ? me?.refId : undefined)));
    this.teachers.set(teachers.map((t) => mapTeacher(t, codeOf)));
  }
  /** Donne à un compte du personnel un autre rôle de l'école. */
  /** Rôle d'un compte du personnel et, dans une école à plusieurs cursus, son périmètre (`cursus` : un cursus, '' = tous ; null = inchangé). */
  async setUserRoleAsync(userId: string, roleId: number, cursus: string | null = null): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.api.patch(`users/${userId}/`, { role_id: roleId, ...(cursus != null ? { cursus: cursus ? [Number(cursus)] : [] } : {}) });
      await this.reloadAccounts(); return { ok: true };
    } catch (e) { return { ok: false, error: this.fail(e).error }; }
  }
  /** Périmètre lisible d'un compte : « Tous les cursus » ou le nom de ses cursus. */
  cursusLabel(u: { cursus?: string[] }): string {
    const ids = u.cursus ?? [];
    return ids.length ? ids.map((id) => this.cursusList().find((c) => c.id === id)?.nom ?? 'Autre cursus').join(', ') : 'Tous les cursus';
  }
  /** Le compte connecté voit-il tous les cursus ? (il peut alors donner l'accès à tous) */
  readonly seesAllCursus = computed(() => !(this.me()?.cursus ?? []).length);
  /** Le secrétariat ou le service informatique corrige l'adresse e-mail d'un compte (utilisée pour « mot de passe oublié »). */
  async setUserEmailAsync(userId: string, email: string): Promise<{ ok: boolean; error?: string }> {
    const mail = email.trim();
    if (!this.apiMode()) { this.users.update((us) => us.map((u) => (u.id === userId ? { ...u, email: mail || undefined } : u))); return { ok: true }; }
    try { await this.api.patch(`users/${userId}/`, { email: mail }); await this.reloadAccounts(); return { ok: true }; } catch (e) { return this.fail(e); }
  }
  /** « Mot de passe oublié » du personnel : le serveur répond toujours la même chose, qu'un compte existe ou non. */
  async forgotPasswordAsync(identifier: string, captchaAnswer = ''): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (!this.apiMode()) return { ok: true, message: 'Mode démonstration : l’envoi d’e-mails fonctionne avec le serveur de l’école.' };
    try {
      const r = await this.api.post<{ detail: string }>('auth/forgot-password/', { identifier: identifier.trim(), ecole: this.ecole().trim().toLowerCase(), ...this.captchaBody(captchaAnswer) });
      void this.loadCaptcha();
      return { ok: true, message: r.detail };
    } catch (e) { void this.loadCaptcha(); return this.fail(e); }
  }
  async resetWithLinkAsync(uid: string, token: string, next: string, confirm: string): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (!this.apiMode()) return { ok: false, error: 'Disponible avec le serveur de l’école.' };
    try {
      const r = await this.api.post<{ detail: string }>('auth/reset-password/', { ecole: this.ecole().trim().toLowerCase(), uid, token, new: next, confirm });
      return { ok: true, message: r.detail };
    } catch (e) { return this.fail(e); }
  }
  async resetPasswordAsync(userId: string): Promise<string> {
    if (!this.apiMode()) return this.resetPassword(userId);
    try {
      const r = await this.api.post<{ credentials: { password: string }; invitation?: boolean | null }>(`users/${userId}/reset-password/`);
      if (r.invitation === true) this.toast('Le nouveau mot de passe a aussi été envoyé par e-mail.');
      return r.credentials.password;
    } catch (e) { this.toast(this.fail(e).error, 'err'); return ''; }
  }
  async toggleActiveAsync(userId: string): Promise<void> {
    if (!this.apiMode()) return this.toggleActive(userId);
    try { await this.api.post(`users/${userId}/toggle-active/`); await this.reloadAccounts(); } catch (e) { this.toast(this.fail(e).error, 'err'); }
  }
  /** Réglages de l'école : l'identité et les règles de calcul passent par le serveur ; le logo est enregistré sur le serveur (PNG, JPEG ou WebP). */
  async updateSchoolAsync(patch: Partial<SchoolSettings>): Promise<void> {
    if (!this.apiMode()) return this.updateSchool(patch);
    this.school.update((s) => ({ ...s, ...patch }));
    const body = settingsPatch(patch);
    if (!Object.keys(body).length) return;
    try {
      const prev = this.school();
      const cfg = await this.api.patch<ApiSettings>('settings/', body);
      this.school.set(mapSettings(cfg, prev.year, prev));
    } catch (e) { this.toast(this.fail(e).error, 'err'); }
  }

  // --- Authentification ---
  login(username: string, password: string): { ok: boolean; error?: string } {
    const u = this.users().find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
    if (!u || u.password !== password) return { ok: false, error: 'Identifiant ou mot de passe incorrect.' };
    if (!u.active) return { ok: false, error: "Ce compte est désactivé. Contactez l'administration de l'école." };
    this.userId.set(u.id);
    if (u.lang && LANGS.some((l) => l.id === u.lang)) setLang(u.lang as Lang);
    this.page.set('dashboard');
    this.param.set(null);
    this.childId.set(null);
    try { globalThis.scrollTo?.({ top: 0 }); } catch { /* sans effet */ }
    return { ok: true };
  }
  logout(): void {
    this.userId.set(null);
    this.page.set('dashboard');
    this.stopPolling();
    // Les alertes de cet appareil s'arrêtent avant la fin de session (le serveur exige encore la connexion)
    if (this.apiMode()) { void this.push.forget().finally(() => this.api.logout()); this.clearData(); void this.loadCaptcha(); }
  }
  changePassword(newPw: string): { ok: boolean; error?: string } {
    const me = this.me();
    if (!me) return { ok: false, error: 'Session expirée.' };
    if (newPw.length < 6) return { ok: false, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
    if (newPw === me.password) return { ok: false, error: "Choisissez un mot de passe différent de l'actuel." };
    this.users.update((us) => us.map((u) => (u.id === me.id ? { ...u, password: newPw, mustChange: false } : u)));
    this.addLog('Mot de passe', `Mot de passe modifié par ${me.name}`);
    return { ok: true };
  }

  // --- Profil de l'utilisateur ---
  updateProfile(patch: { name?: string; phone?: string; email?: string; lang?: string }): { ok: boolean; error?: string } {
    const me = this.me();
    if (!me) return { ok: false, error: 'Session expirée.' };
    const clean: Partial<User> = {};
    if (patch.name !== undefined) {
      const n = patch.name.trim().replace(/\s+/g, ' ');
      if (n.length < 3) return { ok: false, error: 'Indiquez votre nom complet.' };
      clean.name = n;
    }
    if (patch.phone !== undefined) {
      const digits = patch.phone.replace(/[\s.\-]/g, '');
      if (digits && !/^\+?\d{8,13}$/.test(digits)) return { ok: false, error: 'Numéro de téléphone invalide.' };
      clean.phone = patch.phone.trim();
    }
    if (patch.email !== undefined) {
      const e = patch.email.trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return { ok: false, error: 'Adresse e-mail invalide.' };
      clean.email = e;
    }
    if (patch.lang !== undefined) clean.lang = patch.lang;
    this.users.update((us) => us.map((u) => (u.id === me.id ? { ...u, ...clean } : u)));
    if (clean.name) {
      this.teachers.update((ts) => ts.map((t) => (t.userId === me.id ? { ...t, name: clean.name! } : t)));
      this.parents.update((ps) => ps.map((p) => (p.userId === me.id ? { ...p, name: clean.name! } : p)));
    }
    if (clean.phone !== undefined) {
      this.teachers.update((ts) => ts.map((t) => (t.userId === me.id ? { ...t, phone: clean.phone! } : t)));
      this.parents.update((ps) => ps.map((p) => (p.userId === me.id ? { ...p, phone: clean.phone! } : p)));
    }
    this.addLog('Profil', `Informations personnelles modifiées par ${me.name}`);
    return { ok: true };
  }
  setPhoto(dataUrl: string | null): void {
    const me = this.me();
    if (!me) return;
    this.users.update((us) => us.map((u) => (u.id === me.id ? { ...u, photo: dataUrl ?? undefined } : u)));
    this.addLog('Profil', dataUrl ? `Photo de profil modifiée par ${me.name}` : `Photo de profil supprimée par ${me.name}`);
  }
  changeOwnPassword(current: string, next: string, confirm: string): { ok: boolean; error?: string } {
    const me = this.me();
    if (!me) return { ok: false, error: 'Session expirée.' };
    if (current !== me.password) return { ok: false, error: 'Le mot de passe actuel est incorrect.' };
    if (next !== confirm) return { ok: false, error: 'Les deux mots de passe ne sont pas identiques.' };
    return this.changePassword(next);
  }

  // --- Élèves et comptes ---
  private nextMatricule(): string {
    const max = this.students().reduce((m, s) => Math.max(m, parseInt(s.matricule.split('-')[1], 10) || 0), 0);
    return `HZ26-${String(max + 1).padStart(4, '0')}`;
  }
  addStudent(f: NewStudentForm): { student: Student; creds: Credential[] } {
    const matricule = this.nextMatricule();
    const sid = uid('s-');
    const studentPw = tempPin();
    const creds: Credential[] = [];
    const phoneDigits = f.parentPhone.replace(/\s/g, '');
    let parent = this.parents().find((p) => p.phone.replace(/\s/g, '') === phoneDigits);
    if (!parent) {
      const pid = uid('p-');
      const puid = 'u-' + pid;
      const pw = tempPin();
      const name = `${f.parentTitle} ${f.parentName.trim()}`;
      parent = { id: pid, userId: puid, name, phone: f.parentPhone, studentIds: [] };
      const pu: User = { id: puid, username: phoneDigits, password: pw, role: 'parent', name, phone: f.parentPhone, active: true, mustChange: true, refId: pid };
      this.users.update((u) => [...u, pu]);
      this.parents.update((p) => [...p, parent!]);
      creds.push({ label: `Parent : ${name}`, username: phoneDigits, password: pw });
    }
    const suid = 'u-' + sid;
    const student: Student = {
      id: sid, matricule, nom: f.nom.trim().toUpperCase(), prenoms: f.prenoms.trim(), sexe: f.sexe, naissance: f.naissance, lieu: f.lieu.trim(),
      classId: f.classId, parentId: parent.id, userId: suid, urgence: f.parentPhone,
    };
    const su: User = { id: suid, username: matricule.toLowerCase(), password: studentPw, role: 'eleve', name: `${student.prenoms} ${student.nom}`, phone: '', active: true, mustChange: true, refId: sid };
    this.users.update((u) => [...u, su]);
    this.students.update((s) => [...s, student]);
    const pid = parent.id;
    this.parents.update((ps) => ps.map((p) => (p.id === pid ? { ...p, studentIds: [...p.studentIds, sid] } : p)));
    creds.unshift({ label: `Élève : ${student.prenoms} ${student.nom}`, username: su.username, password: studentPw });
    this.addLog('Inscription', `${student.nom} ${student.prenoms} inscrit en ${this.className(f.classId)} (${matricule})`);
    return { student, creds };
  }
  updateStudent(id: string, patch: Partial<Student>): void {
    this.students.update((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    this.addLog('Dossier élève', `Dossier modifié : ${this.studentName(id)}`);
  }
  addClass(c: { name: string; level: string; serie?: string; max: number }): Classe | null {
    if (this.classes().some((x) => x.name.toLowerCase() === c.name.trim().toLowerCase())) return null;
    const groupe = this.groupeFor(c.level, c.serie);
    const cl: Classe = {
      id: uid('c'), name: c.name.trim(), level: c.level, serie: c.serie || undefined, groupe, max: c.max,
      cycle: this.cycleOf(c.level),
    };
    this.classes.update((x) => [...x, cl]);
    this.addLog('Classe', `Classe créée : ${cl.name}`);
    return cl;
  }
  /** Groupe de coefficients : le niveau au collège (« 6e »), le niveau et la série au lycée (« Tle C »). */
  groupeFor(level: string, serie?: string): Classe['groupe'] {
    return !this.hasSeries(level) ? level : `${level} ${(serie || this.seriesOf(level)[0]?.code || 'A').toUpperCase()}`;
  }
  updateClass(id: string, patch: Partial<Classe>): void {
    this.classes.update((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  setCoef(groupe: string, subjectId: string, value: number): void {
    this.coefs.update((c) => {
      const next = { ...c };
      if (value > 0) next[`${groupe}|${subjectId}`] = value;
      else delete next[`${groupe}|${subjectId}`];
      return next;
    });
  }
  setAssignment(classId: string, subjectId: string, teacherId: string): void {
    this.assignments.update((as) => {
      const rest = as.filter((a) => !(a.classId === classId && a.subjectId === subjectId));
      return teacherId ? [...rest, { id: `a-${classId}-${subjectId}`, classId, subjectId, teacherId }] : rest;
    });
    this.addLog('Affectation', `${this.className(classId)} · ${this.subjectById().get(subjectId)?.name} → ${this.teacherById().get(teacherId)?.name ?? 'aucun'}`);
  }
  createStaff(f: { name: string; role: 'admin' | 'directeur' | 'fondateur' | 'educateur' | 'enseignant' | 'comptable' | 'informatique' | 'personnel'; phone: string; subjectId?: string; username: string; email?: string }): Credential | null {
    if (this.users().some((u) => u.username.toLowerCase() === f.username.trim().toLowerCase())) return null;
    const id = uid('u-');
    const pw = tempPassword();
    let refId: string | undefined;
    if (f.role === 'enseignant') {
      refId = uid('t-');
      const t: Teacher = { id: refId, userId: id, name: f.name.trim(), phone: f.phone, subjectIds: f.subjectId ? [f.subjectId] : [] };
      this.teachers.update((x) => [...x, t]);
    }
    this.users.update((u) => [...u, { id, username: f.username.trim(), password: pw, role: f.role, name: f.name.trim(), phone: f.phone, email: f.email?.trim() || undefined, active: true, mustChange: true, refId }]);
    this.addLog('Compte', `Compte créé : ${f.name.trim()} (${f.role})`);
    return { label: f.name.trim(), username: f.username.trim(), password: pw };
  }
  toggleActive(userId: string): void {
    const u = this.userById().get(userId);
    if (!u) return;
    this.users.update((us) => us.map((x) => (x.id === userId ? { ...x, active: !x.active } : x)));
    this.addLog('Compte', `${u.active ? 'Désactivation' : 'Réactivation'} du compte ${u.name}`);
  }
  resetPassword(userId: string): string {
    const role = this.users().find((x) => x.id === userId)?.role;
    const pw = role === 'parent' || role === 'eleve' ? tempPin() : tempPassword();
    this.users.update((us) => us.map((x) => (x.id === userId ? { ...x, password: pw, mustChange: true } : x)));
    this.addLog('Compte', `Mot de passe réinitialisé : ${this.userName(userId)}`);
    return pw;
  }
  updateSchool(patch: Partial<SchoolSettings>): void {
    this.school.update((s) => ({ ...s, ...patch }));
  }

  // --- Décisions de fin d'année ---
  decisionOf(studentId: string): Decision | undefined {
    return this.decisions().find((d) => d.studentId === studentId);
  }
  setDecision(studentId: string, value: Decision['value'], comment: string, silent = false, batch = false): boolean {
    if (!this.can('decisions.write')) return false;
    if (!this.yearClosed()) { this.toast(YEAR_OPEN_MSG, 'err'); return false; }
    const d: Decision = { studentId, value, comment: comment.trim(), byUserId: this.userId() ?? 'u-system', date: this.today, batch };
    this.decisions.update((x) => [...x.filter((y) => y.studentId !== studentId), d]);
    if (!silent) this.addLog('Décision de fin d\'année', `${this.studentName(studentId)} : ${DECISION_LABEL[value]}`);
    const st = this.studentById().get(studentId);
    this.notify(this.familyUserIds(studentId), `Décision du conseil de classe pour ${st?.prenoms ?? ''} : ${DECISION_LABEL[value]}.`, 'systeme', 'bulletins');
    return true;
  }

  // --- Notes ---
  createEval(f: { classId: string; subjectId: string; type: EvalType; title: string; date: string; coef?: number; bareme?: number }): Evaluation {
    const e: Evaluation = {
      id: uid('ev-'), classId: f.classId, subjectId: f.subjectId, termId: this.termId(), type: f.type, title: f.title,
      date: f.date, coef: f.coef ?? 1, bareme: f.bareme ?? 20, published: false, teacherId: this.teacherOf(f.classId, f.subjectId)?.id ?? this.myTeacher()?.id ?? '',
    };
    this.evals.update((x) => [...x, e]);
    this.addLog('Évaluation', `${f.title} créée : ${this.className(f.classId)}, ${this.subjectById().get(f.subjectId)?.name}`);
    return e;
  }
  saveGrades(evalId: string, values: Record<string, number | null>): { ok: boolean; error?: string } {
    const ev = this.evals().find((e) => e.id === evalId);
    if (!ev) return { ok: false, error: 'Évaluation introuvable.' };
    const term = this.terms().find((t) => t.id === ev.termId)!;
    if (!this.isEvaluator(ev)) return { ok: false, error: 'Seul l’enseignant de cette évaluation peut saisir, modifier ou effacer ses notes.' };
    if (term.locked && !this.can('grades.locked')) return { ok: false, error: 'Cette période est verrouillée. Demandez à la direction de la déverrouiller pour corriger.' };
    this.grades.update((g) => {
      const next = { ...g };
      for (const [sid, v] of Object.entries(values)) {
        if (v === null) delete next[`${evalId}|${sid}`];
        else next[`${evalId}|${sid}`] = v;
      }
      return next;
    });
    this.addLog(term.locked ? 'Modification après verrouillage' : 'Saisie de notes', `${this.className(ev.classId)}, ${this.subjectById().get(ev.subjectId)?.name}, ${ev.title}`);
    return { ok: true };
  }
  /** L'enseignant qui fait passer l'évaluation : le seul à saisir, modifier ou effacer ses notes (même règle que le serveur). */
  isEvaluator(ev: Evaluation): boolean {
    const me = this.myTeacher();
    if (!me) return false;
    return ev.teacherId ? ev.teacherId === me.id : this.myAssignments().some((a) => a.classId === ev.classId && a.subjectId === ev.subjectId);
  }
  deleteEval(evalId: string): { ok: boolean; error?: string } {
    const ev = this.evals().find((e) => e.id === evalId);
    if (!ev) return { ok: false, error: 'Évaluation introuvable.' };
    if (!ev.teacherId || ev.teacherId !== this.myTeacher()?.id) return { ok: false, error: 'Seul l’enseignant de cette évaluation peut la supprimer.' };
    if (ev.published) return { ok: false, error: 'Retirez d’abord la publication avant de supprimer cette évaluation.' };
    if (this.terms().find((t) => t.id === ev.termId)?.locked && !this.can('grades.locked')) return { ok: false, error: 'Cette période est verrouillée. Demandez à la direction de la déverrouiller pour corriger.' };
    this.evals.update((es) => es.filter((e) => e.id !== evalId));
    this.grades.update((g) => Object.fromEntries(Object.entries(g).filter(([k]) => k.split('|')[0] !== evalId)));
    this.addLog('Évaluation supprimée', `${ev.title} · ${this.className(ev.classId)}, ${this.subjectById().get(ev.subjectId)?.name}`);
    return { ok: true };
  }
  setPublished(evalIds: string[], published: boolean): void {
    if (!this.can('publish')) return;
    const set = new Set(evalIds);
    const touched = this.evals().filter((e) => set.has(e.id) && e.published !== published);
    if (!touched.length) return;
    this.evals.update((es) => es.map((e) => (set.has(e.id) ? { ...e, published } : e)));
    this.addLog(published ? 'Publication' : 'Retrait de publication', touched.length === 1
      ? `${this.className(touched[0].classId)}, ${this.subjectById().get(touched[0].subjectId)?.name}, ${touched[0].title}`
      : `${touched.length} évaluations`);
    if (published) {
      const classIds = [...new Set(touched.map((e) => e.classId))];
      for (const c of classIds) {
        const subs = [...new Set(touched.filter((e) => e.classId === c).map((e) => this.subjectById().get(e.subjectId)?.name))].join(', ');
        for (const s of this.studentsByClass().get(c) ?? []) {
          this.notify(this.familyUserIds(s.id), `Nouvelles notes publiées (${subs}) pour ${s.prenoms}.`, 'note', 'notes');
        }
      }
    }
  }
  lockTerm(termId: TermId, locked: boolean): void {
    if (!this.can('publish')) return;
    this.terms.update((t) => t.map((x) => (x.id === termId ? { ...x, locked } : x)));
    this.addLog(locked ? 'Verrouillage' : 'Déverrouillage', `${this.terms().find((t) => t.id === termId)?.label}`);
  }
  setApprec(studentId: string, termId: TermId, subjectId: string, text: string): void {
    this.apprec.update((a) => ({ ...a, [`${studentId}|${termId}|${subjectId}`]: text }));
  }
  setConseil(studentId: string, termId: TermId, text: string): void {
    this.conseil.update((a) => ({ ...a, [`${studentId}|${termId}`]: text }));
  }

  // --- Présences ---
  isAppelDone(classId: string, date: string, slot: Slot): boolean {
    return this.sessions().has(`${classId}|${date}|${slot}`);
  }
  saveAppel(classId: string, date: string, slot: Slot, entries: { studentId: string; status: 'P' | 'A' | 'R' }[]): number {
    const previous = new Map(this.absences().filter((a) => a.classId === classId && a.date === date && a.slot === slot).map((a) => [a.studentId, a]));
    const kept = this.absences().filter((a) => !(a.classId === classId && a.date === date && a.slot === slot));
    const fresh: Absence[] = [];
    const notifyIds: string[] = [];
    for (const e of entries) {
      if (e.status === 'P') continue;
      const old = previous.get(e.studentId);
      fresh.push({ id: old?.id ?? uid('ab-'), studentId: e.studentId, classId, date, slot, status: e.status, justif: old?.justif ?? 'aucune', motif: old?.motif });
      if (e.status === 'A' && !old) notifyIds.push(e.studentId);
    }
    this.absences.update(() => [...kept, ...fresh]);
    this.sessions.update((s) => new Set(s).add(`${classId}|${date}|${slot}`));
    for (const sid of notifyIds) {
      const st = this.studentById().get(sid)!;
      this.notify(this.familyUserIds(sid), `${st.prenoms} a été absent(e) le ${date.split('-').reverse().join('/')} (${slot.toLowerCase()}).`, 'absence', 'presences');
    }
    this.addLog('Appel', `${this.className(classId)}, ${date.split('-').reverse().join('/')} ${slot}: ${fresh.filter((f) => f.status === 'A').length} absent(s)`);
    return notifyIds.length;
  }
  submitJustif(absId: string, motif: string): void {
    this.absences.update((a) => a.map((x) => (x.id === absId ? { ...x, justif: 'en_attente' as Justif, motif } : x)));
    const ab = this.absences().find((x) => x.id === absId);
    if (ab) this.notify(this.usersWithRole('educateur'), `Justificatif d'absence reçu pour ${this.studentName(ab.studentId)}.`, 'absence', 'presences');
    this.addLog('Justificatif', `Justificatif envoyé pour ${ab ? this.studentName(ab.studentId) : ''}`);
  }
  decideJustif(absId: string, accept: boolean): void {
    const ab = this.absences().find((x) => x.id === absId);
    this.absences.update((a) => a.map((x) => (x.id === absId ? { ...x, justif: (accept ? 'acceptee' : 'refusee') as Justif } : x)));
    if (ab) {
      this.refreshAbsenceDeduction(ab.studentId, ab.date);
      this.notify(this.familyUserIds(ab.studentId), `Le justificatif d'absence de ${this.studentById().get(ab.studentId)?.prenoms} a été ${accept ? 'accepté' : 'refusé'}.`, 'absence', 'presences');
      this.addLog('Justificatif', `${accept ? 'Accepté' : 'Refusé'} : ${this.studentName(ab.studentId)}`);
    }
  }

  // --- Finance ---
  private nextReceipt(): string {
    const max = this.payments().reduce((m, p) => Math.max(m, parseInt(p.receiptNo.split('-')[2], 10) || 0), 0);
    return `REC-2026-${String(max + 1).padStart(5, '0')}`;
  }
  /** Détail d'un paiement (démo) : échéances réglées et reste, calculés au moment du paiement. */
  paymentDetailOf(studentId: string, amount: number): PaymentDetail | undefined {
    const st = this.studentById().get(studentId); const level = this.levelOf(studentId);
    if (!st || !level) return undefined;
    const pct = this.siblingPct(studentId), t = this.tarifOf(level), rep = this.reports()[studentId] ?? 0, start = this.terms()[0]?.start;
    const items = feeItems(t, this.feeDates(), pct, this.tranches(), rep, start);
    const full = feeItems(t, this.feeDates(), 0, this.tranches(), rep, start).reduce((a, l) => a + l.amount, 0);
    return paymentDetail(items, full, this.paidByStudent().get(studentId) ?? 0, amount, this.today, pct);
  }
  recordPayment(f: { studentId: string; amount: number; mode: PayMode; date?: string; ref?: string; note?: string; byUserId?: string; advance?: boolean }): Payment {
    const detail = this.paymentDetailOf(f.studentId, Math.round(f.amount));
    const p: Payment = {
      id: uid('pay-'), studentId: f.studentId, amount: Math.round(f.amount), mode: f.mode, ref: f.ref, date: f.date ?? this.today,
      receiptNo: this.nextReceipt(), status: 'confirme', byUserId: f.byUserId ?? this.userId() ?? 'u-system', note: f.note,
      detail, advance: detail?.credit ? Math.min(detail.credit, Math.round(f.amount)) : undefined, yearLabel: this.currentYearLabel() || undefined,
    };
    this.payments.update((x) => [...x, p]);
    const st = this.studentById().get(f.studentId);
    if (st) {
      const parentUser = this.parentById().get(st.parentId)?.userId;
      if (parentUser) this.notify([parentUser], `Paiement de ${Math.round(f.amount).toLocaleString('fr-FR')} FCFA reçu pour ${st.prenoms}. Reçu ${p.receiptNo}. ${detail && detail.remaining > 0 ? `Reste à payer : ${detail.remaining.toLocaleString('fr-FR')} FCFA.` : 'Scolarité soldée.'}`, 'paiement', 'payer');
      this.notify(this.usersWithRole('comptable'), `Nouveau paiement : ${st.nom} ${st.prenoms}, ${Math.round(f.amount).toLocaleString('fr-FR')} FCFA.`, 'paiement', 'paiements');
    }
    this.addLog('Paiement', `${p.receiptNo} · ${this.studentName(f.studentId)} · ${p.amount.toLocaleString('fr-FR')} FCFA`);
    return p;
  }
  cancelPayment(id: string, reason: string): void {
    const p = this.payments().find((x) => x.id === id);
    if (!p) return;
    this.payments.update((x) => x.map((y) => (y.id === id ? { ...y, status: 'annule' as const, note: `Annulé : ${reason}` } : y)));
    this.addLog('Annulation de paiement', `${p.receiptNo} annulé (${reason})`);
  }
  setTarif(level: string, t: Tarif): void {
    this.tarifs.update((x) => ({ ...x, [level]: t }));
    this.addLog('Tarifs', `Tarif modifié : ${level}`);
  }
  setFeeDate(key: string, date: string): void {
    this.feeDates.update((d) => ({ ...d, [key]: date }));
  }
  matchLine(lineId: string, studentId: string): void {
    const l = this.statement().find((x) => x.id === lineId);
    if (!l) return;
    const p = this.recordPayment({ studentId, amount: l.amount, mode: l.mode, date: l.date, ref: l.ref, note: 'Rattaché depuis le relevé', byUserId: 'u-system' });
    this.statement.update((s) => s.map((x) => (x.id === lineId ? { ...x, paymentId: p.id } : x)));
  }
  fixMismatch(lineId: string): void {
    const l = this.statement().find((x) => x.id === lineId);
    if (!l?.paymentId) return;
    this.payments.update((ps) => ps.map((p) => (p.id === l.paymentId ? { ...p, amount: l.amount, note: 'Montant corrigé d\'après le relevé' } : p)));
    this.addLog('Rapprochement', `Montant corrigé : ${l.ref}`);
  }

  // --- Discipline ---
  readonly pendingIncidents = computed(() => this.incidents().filter((i) => i.status === 'a_valider'));
  incidentsOf(studentId: string): Incident[] {
    return this.incidents().filter((i) => i.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date));
  }
  addIncident(f: { studentId: string; type: IncidentType; gravite: Gravite; sanction: Sanction; description: string; date?: string; retrait?: number }): Incident {
    const needs = (f.gravite === 'grave' || f.sanction === 'exclusion_temp') && !this.can('discipline.validate');
    const inc: Incident = {
      id: uid('in-'), studentId: f.studentId, date: f.date ?? this.today, type: f.type, gravite: f.gravite, sanction: f.sanction,
      description: f.description, status: needs ? 'a_valider' : 'valide', byUserId: this.userId() ?? '',
    };
    this.incidents.update((x) => [inc, ...x]);
    const tm = this.terms().find((t) => t.start <= inc.date && inc.date <= t.end);
    if (f.retrait && f.retrait > 0 && tm) this.deductions.update((l) => [...l, { id: uid('cd-'), studentId: f.studentId, termId: tm.id, points: f.retrait!, reason: `${INCIDENT_LABEL[inc.type]} · ${SANCTION_LABEL[inc.sanction]}`, kind: 'discipline', date: inc.date, byName: this.me()?.name ?? '', incidentId: inc.id }]);
    const st = this.studentById().get(f.studentId);
    if (needs) {
      this.notify(this.usersWithRole('directeur'), `Une sanction grave (${this.className(st?.classId ?? '')}) attend votre validation.`, 'discipline', 'discipline');
    } else if (st) {
      this.notifyIncident(inc);
    }
    this.addLog('Discipline', `${this.studentName(f.studentId)} : ${inc.type}, ${needs ? 'à valider' : 'validé'}`);
    return inc;
  }
  private notifyIncident(inc: Incident): void {
    const st = this.studentById().get(inc.studentId);
    const parent = st ? this.parentById().get(st.parentId)?.userId : undefined;
    if (st && parent) this.notify([parent], `Mesure disciplinaire pour ${st.prenoms} : ${inc.sanction === 'convocation' ? 'convocation des parents' : 'voir le détail dans l’espace Absences'}.`, 'discipline', 'presences');
  }
  decideIncident(id: string, accept: boolean, note: string): void {
    if (!this.can('discipline.validate')) return;
    let updated: Incident | undefined;
    this.incidents.update((x) => x.map((i) => {
      if (i.id !== id) return i;
      updated = { ...i, status: accept ? 'valide' : 'refuse', decidedBy: this.userId() ?? '', decisionNote: note };
      return updated;
    }));
    if (updated) {
      if (accept) this.notifyIncident(updated);
      this.notify([updated.byUserId], `Votre sanction concernant ${this.studentName(updated.studentId)} a été ${accept ? 'validée' : 'refusée'} par la direction.`, 'discipline', 'discipline');
      this.addLog('Discipline', `${accept ? 'Validation' : 'Refus'} : ${this.studentName(updated.studentId)}`);
    }
  }

  // --- Annonces ---
  addAnnouncement(f: { title: string; body: string; audience: Role[] }): void {
    const a: Announcement = { id: uid('an-'), title: f.title, body: f.body, date: this.today, audience: f.audience, authorId: this.userId() ?? '' };
    this.announcements.update((x) => [a, ...x]);
    const targets = this.users().filter((u) => f.audience.includes(u.role) && u.active && u.id !== this.userId()).map((u) => u.id);
    this.notify(targets, `Nouvelle annonce : ${f.title}`, 'annonce', 'annonces');
    this.addLog('Annonce', f.title);
  }

  // --- Recherche globale ---
  search(q: string): { kind: 'eleve' | 'classe' | 'enseignant'; id: string; label: string; sub: string }[] {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const out: { kind: 'eleve' | 'classe' | 'enseignant'; id: string; label: string; sub: string }[] = [];
    for (const s of this.scopeStudents()) {
      if (`${s.nom} ${s.prenoms} ${s.matricule}`.toLowerCase().includes(t)) {
        out.push({ kind: 'eleve', id: s.id, label: `${s.nom} ${s.prenoms}`, sub: `${this.className(s.classId)} · ${s.matricule}` });
        if (out.length >= 8) break;
      }
    }
    for (const c of this.scopeClasses()) if (c.name.toLowerCase().includes(t)) out.push({ kind: 'classe', id: c.id, label: c.name, sub: `${this.studentsByClass().get(c.id)?.length ?? 0} élèves` });
    if (this.can('accounts')) {
      for (const tc of this.teachers()) if (tc.name.toLowerCase().includes(t)) out.push({ kind: 'enseignant', id: tc.id, label: tc.name, sub: tc.subjectIds.map((x) => this.subjectById().get(x)?.name).join(', ') });
    }
    return out.slice(0, 12);
  }
}
