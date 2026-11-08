/** Traduction des réponses du serveur vers les modèles de l'interface (fonctions pures, testées). */
import type { Candidate, Thread } from './modules/messaging';
import type { Cell } from './modules/timetable';
import type { TextEntry } from './modules/textbook';
import type { ClassResult, ExamKind, ExamType, MockSession } from './modules/mockexams';
import { Announcement, ConductDeduction, ConductSheet, Educator, LogEntry, Payment, PaymentDetail, FinanceYear, CashDay, StudentStatement, PayMode, StatementLine, Tarif, Absence, Gravite, Incident, IncidentType, Justif, Notice, PageId, PrincipalClass, Sanction, Slot, Assignment, ClassStats, Classe, Decision, EvalType, Evaluation, StudentResult, SubjectResult, Groupe, Parent, Role, SchoolSettings, Student, Subject, Teacher, Term, TermId, User, Serie, Level } from './models';

export interface ApiUser {
  id: number; username: string; name: string; role: Role; phone: string; email: string; lang: string; photo: string | null;
  must_change_password: boolean; is_active: boolean; permissions?: string[]; role_label?: string;
  etablissement?: { code: string; nom: string; lecture_seule?: boolean; abonnement?: { etat: string; fin: string | null; jours: number | null } } | null; platform_admin?: boolean;
  cursus?: number[];
}
export interface ApiClass { id: number; name: string; level: string; serie: string; groupe: Groupe; max_students: number; cycle: 'college' | 'lycee'; effectif: number; room?: number | null; prof_principal?: number | null; prof_principal_name?: string; }
export interface ApiSubject { id: number; code: string; name: string; short: string; }
export interface ApiCoef { groupe: Groupe; subject: number; value: number; }
export interface ApiLevel { id: number; name: string; order: number; cycle: 'college' | 'lycee'; has_series: boolean; classes: number; }
export const mapLevel = (x: ApiLevel): Level => ({ id: s(x.id), name: x.name, order: x.order, cycle: x.cycle, hasSeries: !!x.has_series, classes: x.classes ?? 0 });
export interface ApiSerie { id: number; level: string; code: string; name: string; groupe: string; classes: string[]; }
export const mapSerie = (x: ApiSerie): Serie => ({ id: s(x.id), level: x.level, code: x.code, name: x.name ?? '', groupe: x.groupe, classes: x.classes ?? [] });
export interface ApiTeacher { id: number; user_id: number; name: string; phone: string; subject_ids: number[]; max_hours?: number | null; }
export interface ApiParent { id: number; user_id?: number; name: string; phone: string; student_ids: number[]; }
export interface ApiStudent {
  id: number; matricule: string; username: string; user_id?: number | null; parent_user_id?: number; nom: string; prenoms: string; sexe: 'M' | 'F'; naissance: string; lieu: string;
  school_class: number | null; level?: string; reinscription_state?: '' | 'attente' | 'paye' | 'valide'; parent_id: number; parent_name: string; parent_phone: string; urgence: string; active: boolean; sortie?: '' | 'exclu' | 'ancien' | 'parti' | 'placer'; solde_sortie?: number; niveaux_redoubles?: string[];
  class_name?: string; cursus?: number | null; cursus_nom?: string; principal?: number | null;
}
export interface ApiAssignment { id: number; teacher: number; subject: number; school_class: number; }
export interface ApiTerm { id: number; code: TermId; label: string; start: string; end: string; locked: boolean; conduct_published?: boolean; coef?: number; }
export interface ApiSettings {
  name: string; address: string; phone: string; email: string; director: string; director_name?: string; hue: number; template: SchoolSettings['template'];
  compo_weight: number; remise_fratrie: number; seuils: number[]; logo?: string;
  passage_admission?: number; passage_redoublement?: number; passage_exclusion?: number | null; passage_niveaux?: Record<string, { admission: number; redoublement: number; exclusion: number | null }>;
  conduite_max?: string | number; conduite_in_average?: boolean; conduite_coef?: string | number; absence_tranche?: number; absence_points?: string | number; justif_delai?: number; conduite_baremes?: Record<string, number>; eleve_voit_cahier?: boolean; entete_pays?: string; entete_devise?: string; bulletin_blocage?: 'aucun' | 'retard' | 'total'; devoirs_actifs?: boolean;
}

const s = (n: number | string) => String(n);

export const mapUser = (u: ApiUser, refId?: string): User => ({
  id: s(u.id), username: u.username, password: '', role: u.role, name: u.name, phone: u.phone, active: u.is_active,
  mustChange: u.must_change_password, refId, email: u.email || undefined, photo: u.photo ?? undefined, lang: u.lang, perms: u.permissions, roleLabel: u.role_label || undefined, cursus: (u.cursus ?? []).map(String),
});
export const mapClass = (c: ApiClass): Classe => ({ id: s(c.id), name: c.name, level: c.level, serie: c.serie || undefined, groupe: c.groupe, max: c.max_students, cycle: c.cycle, roomId: c.room != null ? s(c.room) : undefined, principalId: c.prof_principal != null ? s(c.prof_principal) : undefined });
/** L'interface identifie une matière par son code (« ma », « fr »…) ; le serveur par un numéro. */
export const mapSubject = (x: ApiSubject): Subject => ({ id: x.code, name: x.name, short: x.short });
export const mapTeacher = (t: ApiTeacher, codeOf: Map<number, string>): Teacher => ({
  id: s(t.id), userId: s(t.user_id), name: t.name, phone: t.phone, subjectIds: t.subject_ids.map((i) => codeOf.get(i)).filter((c): c is string => !!c), maxHours: t.max_hours ?? null,
});
export const mapStudent = (x: ApiStudent): Student => ({
  id: s(x.id), matricule: x.matricule, nom: x.nom, prenoms: x.prenoms, sexe: x.sexe, naissance: x.naissance, lieu: x.lieu,
  classId: x.school_class != null ? s(x.school_class) : `placer:${x.level ?? ''}`, parentId: s(x.parent_id), userId: x.user_id != null ? s(x.user_id) : `u-s${x.id}`, urgence: x.urgence,
  active: x.active, sortie: x.sortie ?? '', soldeSortie: Number(x.solde_sortie ?? 0), niveauxRedoubles: x.niveaux_redoubles ?? [], level: x.level, reinscription: x.reinscription_state ?? '',
  cursusId: x.cursus != null ? s(x.cursus) : undefined, cursusNom: x.cursus_nom ?? '', principalId: x.principal != null ? s(x.principal) : undefined, classLabel: x.class_name ?? '',
});
/** Parents : liste du serveur si autorisée, sinon déduits des élèves visibles (un parent ne voit que ses enfants). */
export function mapParents(list: ApiParent[] | null, students: ApiStudent[]): Parent[] {
  if (list) return list.map((p) => ({ id: s(p.id), userId: p.user_id != null ? s(p.user_id) : `u-p${p.id}`, name: p.name, phone: p.phone, studentIds: p.student_ids.map(s) }));
  const m = new Map<number, Parent>();
  for (const st of students) {
    const p = m.get(st.parent_id) ?? { id: s(st.parent_id), userId: st.parent_user_id != null ? s(st.parent_user_id) : `u-p${st.parent_id}`, name: st.parent_name, phone: st.parent_phone, studentIds: [] };
    p.studentIds.push(s(st.id));
    m.set(st.parent_id, p);
  }
  return [...m.values()];
}
export const mapAssignment = (a: ApiAssignment, codeOf: Map<number, string>): Assignment | null => {
  const sub = codeOf.get(a.subject);
  return sub ? { id: s(a.id), teacherId: s(a.teacher), subjectId: sub, classId: s(a.school_class) } : null;
};
export const mapCoefs = (list: ApiCoef[], codeOf: Map<number, string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of list) { const code = codeOf.get(c.subject); if (code) out[`${c.groupe}|${code}`] = c.value; }
  return out;
};
export const mapTerm = (t: ApiTerm): Term => ({ id: t.code, label: t.label, start: t.start, end: t.end, locked: t.locked, conductPublished: !!t.conduct_published, coef: t.coef });
export const mapSettings = (c: ApiSettings, year: string, prev?: SchoolSettings): SchoolSettings => ({
  name: c.name, logo: c.logo || undefined, address: c.address, phone: c.phone, email: c.email, director: c.director, directorName: c.director_name || c.director, year, hue: c.hue, template: c.template,
  compoWeight: c.compo_weight, seuils: c.seuils as SchoolSettings['seuils'], remiseFratrie: c.remise_fratrie,
  passageAdmission: c.passage_admission ?? 10, passageRedoublement: c.passage_redoublement ?? 8, passageExclusion: c.passage_exclusion ?? null, passageNiveaux: c.passage_niveaux ?? {},
  conduiteMax: Number(c.conduite_max ?? 20), conduiteInAverage: c.conduite_in_average ?? true, conduiteCoef: Number(c.conduite_coef ?? 1),
  entetePays: c.entete_pays ?? 'République de Côte d’Ivoire', enteteDevise: c.entete_devise ?? 'Union – Discipline – Travail', bulletinBlocage: c.bulletin_blocage ?? 'retard', eleveVoitCahier: !!c.eleve_voit_cahier, devoirsActifs: !!c.devoirs_actifs, absenceTranche: c.absence_tranche ?? 3, absencePoints: Number(c.absence_points ?? 1), justifDelai: c.justif_delai ?? 0, conduiteBaremes: c.conduite_baremes ?? {},
});
export const settingsPatch = (p: Partial<SchoolSettings>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'address', 'phone', 'email', 'director', 'hue', 'template', 'seuils'] as const) if (k in p) out[k] = p[k];
  if ('compoWeight' in p) out['compo_weight'] = p.compoWeight;
  if ('remiseFratrie' in p) out['remise_fratrie'] = p.remiseFratrie;
  if ('passageAdmission' in p) out['passage_admission'] = p.passageAdmission;
  if ('passageRedoublement' in p) out['passage_redoublement'] = p.passageRedoublement;
  if ('passageExclusion' in p) out['passage_exclusion'] = p.passageExclusion ?? null;
  if ('passageNiveaux' in p) out['passage_niveaux'] = p.passageNiveaux ?? {};
  if ('conduiteMax' in p) out['conduite_max'] = p.conduiteMax;
  if ('conduiteInAverage' in p) out['conduite_in_average'] = p.conduiteInAverage;
  if ('conduiteCoef' in p) out['conduite_coef'] = p.conduiteCoef;
  if ('absenceTranche' in p) out['absence_tranche'] = p.absenceTranche;
  if ('absencePoints' in p) out['absence_points'] = p.absencePoints;
  if ('justifDelai' in p) out['justif_delai'] = p.justifDelai;
  if ('eleveVoitCahier' in p) out['eleve_voit_cahier'] = !!p.eleveVoitCahier;
  if ('entetePays' in p) out['entete_pays'] = p.entetePays ?? '';
  if ('enteteDevise' in p) out['entete_devise'] = p.enteteDevise ?? '';
  if ('bulletinBlocage' in p) out['bulletin_blocage'] = p.bulletinBlocage;
  if ('devoirsActifs' in p) out['devoirs_actifs'] = !!p.devoirsActifs;
  if ('conduiteBaremes' in p) out['conduite_baremes'] = p.conduiteBaremes ?? {};
  if ('logo' in p) out['logo'] = p.logo ?? '';
  return out;
};

// --- Notes, résultats, décisions (les calculs viennent du serveur) ---
export interface ApiEval { id: number; school_class: number; subject: number; term: TermId; type: EvalType; title: string; date: string; published: boolean; teacher: number | null; scheduled?: boolean; coef?: string | number; bareme?: number; }
export interface ApiSubjectResult { subject: number; coef: number; mc: number | null; compo: number | null; moy: number | null; rang: number | null; class_moy: number | null; class_max: number | null; class_min: number | null; }
export interface ApiResult { student: number; subjects: ApiSubjectResult[]; moyenne: number | null; rang: number | null; total_points: number; total_coef: number; conduite?: { note: number; max: number; coef: number; in_average: boolean } | null; }
export interface ApiClassStats { effectif: number; avg: number | null; max: number | null; min: number | null; results: Record<string, ApiResult>; }
export interface ApiOverview {
  term: TermId; locked: boolean; evaluations: ApiEval[]; grades: Record<string, number>;
  appreciations: { student: number; subject: number; text: string }[]; council: { student: number; text: string }[];
  stats: Record<string, { pub: ApiClassStats; all?: ApiClassStats }>;
}
export interface ApiDecisionRow { student: number; class: number; annual_avg: number | null; terms: number; decision: { value: Decision['value']; comment: string; batch?: boolean } | null; }

export const mapEval = (e: ApiEval, codeOf: Map<number, string>): Evaluation | null => {
  const sub = codeOf.get(e.subject);
  return sub ? { id: s(e.id), classId: s(e.school_class), subjectId: sub, termId: e.term, type: e.type, title: e.title, date: e.date, published: e.published, teacherId: e.teacher ? s(e.teacher) : '', scheduled: !!e.scheduled, coef: e.coef === undefined ? 1 : Number(e.coef), bareme: e.bareme ?? 20 } : null;
};
const mapResult = (r: ApiResult, codeOf: Map<number, string>): StudentResult => ({
  studentId: s(r.student), moyenne: r.moyenne, rang: r.rang, totalPoints: r.total_points, totalCoef: r.total_coef,
  conduite: r.conduite ? { note: r.conduite.note, max: r.conduite.max, coef: r.conduite.coef, inAverage: r.conduite.in_average } : null,
  subjects: r.subjects.flatMap((x): SubjectResult[] => {
    const code = codeOf.get(x.subject);
    return code ? [{ subjectId: code, coef: x.coef, mc: x.mc, compo: x.compo, moy: x.moy, rang: x.rang, classMoy: x.class_moy, classMax: x.class_max, classMin: x.class_min }] : [];
  }),
});
export function mapClassStats(classId: string, c: ApiClassStats, codeOf: Map<number, string>): ClassStats {
  return { classId, effectif: c.effectif, avg: c.avg, max: c.max, min: c.min, results: new Map(Object.values(c.results).map((r) => [s(r.student), mapResult(r, codeOf)])) };
}
export interface ApiPrincipal {
  class: { id: number; name: string }; term: TermId; term_label: string; locked: boolean;
  students: { id: number; nom: string; prenoms: string; matricule: string }[];
  subjects: { id: number; name: string; coef: number }[];
  evaluations: { id: number; subject: number; title: string; type: EvalType; date: string; bareme: number; coef: number; published: boolean; teacher_name: string }[];
  grades: Record<string, number>; stats: ApiClassStats;
  assiduite: Record<string, { absences: number; non_justifiees: number; retards: number }>;
  absences: { student: number; date: string; slot: string; status: 'A' | 'R'; justif: string; motif: string }[];
  incidents: { student: number; date: string; type: string; gravite: string; sanction: string; description: string; status: string }[];
  council: Record<string, string>;
}
export function mapPrincipal(d: ApiPrincipal, codeOf: Map<number, string>): PrincipalClass {
  const cid = s(d.class.id);
  return {
    classId: cid, className: d.class.name, termLabel: d.term_label, locked: d.locked,
    students: d.students.map((x) => ({ id: s(x.id), nom: x.nom, prenoms: x.prenoms, matricule: x.matricule })),
    subjects: d.subjects.flatMap((x) => { const code = codeOf.get(x.id); return code ? [{ id: code, name: x.name, coef: x.coef }] : []; }),
    evals: d.evaluations.flatMap((e) => { const code = codeOf.get(e.subject); return code ? [{ id: s(e.id), subjectId: code, title: e.title, type: e.type, date: e.date, bareme: e.bareme, coef: e.coef, published: e.published, teacherName: e.teacher_name }] : []; }),
    grades: d.grades, stats: mapClassStats(cid, d.stats, codeOf),
    assiduite: Object.fromEntries(Object.entries(d.assiduite).map(([k, v]) => [k, { absences: v.absences, nonJustifiees: v.non_justifiees, retards: v.retards }])),
    absences: d.absences.map((a) => ({ studentId: s(a.student), date: a.date, slot: a.slot, status: a.status, justif: a.justif, motif: a.motif })),
    incidents: d.incidents.map((i) => ({ studentId: s(i.student), date: i.date, type: i.type, gravite: i.gravite, sanction: i.sanction, description: i.description, status: i.status })),
    council: d.council,
  };
}
export function mapOverview(o: ApiOverview, codeOf: Map<number, string>) {
  const pub = new Map<string, ClassStats>(), all = new Map<string, ClassStats>();
  for (const [cid, v] of Object.entries(o.stats)) {
    pub.set(cid, mapClassStats(cid, v.pub, codeOf));
    all.set(cid, mapClassStats(cid, v.all ?? v.pub, codeOf)); // la famille n'a pas de « tout » : elle ne voit que le publié
  }
  const apprec: Record<string, string> = {};
  for (const a of o.appreciations) { const code = codeOf.get(a.subject); if (code) apprec[`${a.student}|${o.term}|${code}`] = a.text; }
  const conseil: Record<string, string> = {};
  for (const c of o.council) conseil[`${c.student}|${o.term}`] = c.text;
  return {
    evals: o.evaluations.map((e) => mapEval(e, codeOf)).filter((e): e is Evaluation => !!e),
    grades: Object.fromEntries(Object.entries(o.grades).map(([k, v]) => [k, Number(v)])) as Record<string, number>,
    apprec, conseil, pub, all,
  };
}
export const mapDecision = (d: ApiDecisionRow): Decision | null =>
  d.decision ? { studentId: s(d.student), value: d.decision.value, comment: d.decision.comment, byUserId: '', date: '', batch: !!d.decision.batch } : null;

// --- Présences, discipline, notifications ---
export interface ApiAbsence { id: number; student: number; school_class: number; date: string; slot: Slot; status: 'A' | 'R'; justif: Justif; motif: string; }
export interface ApiSession { school_class: number; date: string; slot: Slot; }
export interface ApiIncident {
  id: number; student: number; date: string; type: IncidentType; gravite: Gravite; sanction: Sanction; description: string;
  status: Incident['status']; by: number | null; decided_by: number | null; decision_note: string; points?: number;
}
export interface ApiNotice { id: number; text: string; kind: string; page: string; read: boolean; created: string; }

export const mapAbsence = (a: ApiAbsence): Absence => ({ id: s(a.id), studentId: s(a.student), classId: s(a.school_class), date: a.date, slot: a.slot, status: a.status, justif: a.justif, motif: a.motif || undefined });
export const sessionKey = (x: ApiSession): string => `${x.school_class}|${x.date}|${x.slot}`;
export const mapIncident = (i: ApiIncident): Incident => ({
  id: s(i.id), studentId: s(i.student), date: i.date, type: i.type, gravite: i.gravite, sanction: i.sanction, description: i.description,
  status: i.status, byUserId: i.by ? s(i.by) : '', decidedBy: i.decided_by ? s(i.decided_by) : undefined, decisionNote: i.decision_note || undefined, points: i.points ?? 0,
});
const KINDS: Notice['kind'][] = ['note', 'absence', 'paiement', 'annonce', 'compte', 'systeme', 'discipline'];
export const mapNotice = (n: ApiNotice, userId: string): Notice => ({
  id: s(n.id), userId, text: n.text, date: n.created.slice(0, 10), read: n.read,
  kind: KINDS.includes(n.kind as Notice['kind']) ? (n.kind as Notice['kind']) : 'systeme', page: (n.page || undefined) as PageId | undefined,
});

// --- Finances ---
export interface ApiPayment { id: number; student: number; amount: number; mode: PayMode; ref: string; date: string; receipt_no: string; status: 'confirme' | 'annule'; by: number | null; by_name: string; note: string; advance?: number; year_label?: string; detail?: ApiPaymentDetail | null; }
export interface ApiPaymentDetail { lines: { key: string; label: string; due: string | null; amount: number; paid_before: number; paid_now: number; remaining: number }[]; total: number; paid_before: number; paid_after: number; remaining: number; credit: number; discount_pct: number; discount_amount: number; next: { label: string; due: string | null; remaining: number } | null; reconstructed?: boolean }
export interface ApiStatement { id: number; ref: string; date: string; mode: PayMode; amount: number; phone: string; payment: number | null; }
export interface ApiIntent { reference: string; student: number; amount: number; mode: PayMode; phone: string; status: 'pending' | 'succeeded' | 'failed' | 'mismatch'; payment: number | null; }

export const mapDetail = (d: ApiPaymentDetail): PaymentDetail => ({
  lines: d.lines.map((l) => ({ key: l.key, label: l.label, due: l.due ?? undefined, amount: l.amount, paidBefore: l.paid_before, paidNow: l.paid_now, remaining: l.remaining })),
  total: d.total, paidBefore: d.paid_before, paidAfter: d.paid_after, remaining: d.remaining, credit: d.credit, discountPct: d.discount_pct, discountAmount: d.discount_amount,
  next: d.next ? { label: d.next.label, due: d.next.due ?? undefined, remaining: d.next.remaining } : undefined, reconstructed: d.reconstructed || undefined,
});
export const mapPayment = (p: ApiPayment): Payment => ({
  id: s(p.id), studentId: s(p.student), amount: p.amount, mode: p.mode, ref: p.ref || undefined, date: p.date, receiptNo: p.receipt_no,
  status: p.status, byUserId: p.by ? s(p.by) : 'u-system', byName: p.by_name || undefined, note: p.note || undefined,
  advance: p.advance || undefined, yearLabel: p.year_label || undefined, detail: p.detail ? mapDetail(p.detail) : undefined,
});
export const mapYear = (y: { label: string; current: boolean; collected: number; count: number; cancelled: number; advances: number; carried_over: number | null; carried_credit: number | null }): FinanceYear =>
  ({ label: y.label, current: y.current, collected: y.collected, count: y.count, cancelled: y.cancelled, advances: y.advances, carriedOver: y.carried_over, carriedCredit: y.carried_credit });
export const mapCashDay = (d: { date: string; total: number; count: number; expected_cash: number; by_mode: { mode: PayMode; count: number; total: number }[]; cancelled: { receipt_no: string; student: string; amount: number; note: string }[]; closing: { date: string; expected: number; counted: number; gap: number; note: string; by: string } | null }): CashDay =>
  ({ date: d.date, total: d.total, count: d.count, expectedCash: d.expected_cash, byMode: d.by_mode, cancelled: d.cancelled.map((c) => ({ receiptNo: c.receipt_no, student: c.student, amount: c.amount, note: c.note })), closing: d.closing });
export const mapStatementOf = (d: { student: number; name: string; matricule: string; class: string; years: { label: string; report: number; credit: number; paid: number; payments: { id: number; receipt_no: string; date: string; amount: number; mode: PayMode; status: 'confirme' | 'annule'; advance: number }[] }[] }): StudentStatement =>
  ({ studentId: s(d.student), name: d.name, matricule: d.matricule, className: d.class,
     years: d.years.map((y) => ({ label: y.label, report: y.report, credit: y.credit, paid: y.paid, payments: y.payments.map((p) => ({ id: s(p.id), receiptNo: p.receipt_no, date: p.date, amount: p.amount, mode: p.mode, status: p.status, advance: p.advance })) })) });
export const mapStatement = (l: ApiStatement): StatementLine => ({ id: s(l.id), ref: l.ref, date: l.date, mode: l.mode, amount: l.amount, phone: l.phone, paymentId: l.payment ? s(l.payment) : undefined });
export const mapTarifs = (rows: { level: string; ins: number; sco: number; complement?: number | null }[]): Record<string, Tarif> => Object.fromEntries(rows.map((r) => [r.level, { ins: r.ins, sco: r.sco, complement: r.complement ?? null }]));
export function mapFeeDates(rows: { key: string; date: string | null }[], prev: Record<string, string> = {}): Record<string, string> {
  const out = { ...prev };
  for (const r of rows) if (r.date) out[r.key] = r.date;
  return out;
}

// --- Journal ---
export interface ApiLog { id: number; ts: string; user: number | null; user_name: string; action: string; detail: string; }
export const mapLog = (l: ApiLog): LogEntry => ({ id: s(l.id), ts: l.ts.slice(0, 16), userId: l.user ? s(l.user) : 'u-system', userName: l.user_name || 'Système', action: l.action, detail: l.detail });

// --- Annonces et messagerie ---
export interface ApiAnnouncement { id: number; title: string; body: string; audience: Role[]; author: number | null; author_name: string; created: string; cursus?: number[]; cursus_noms?: string[]; }
export const mapAnnouncement = (a: ApiAnnouncement): Announcement => ({ id: s(a.id), title: a.title, body: a.body, date: a.created.slice(0, 10), audience: a.audience, authorId: a.author ? s(a.author) : '', cursusNoms: a.cursus_noms ?? [] });
export interface ApiThread { id: number; subject: string; creator: number; participants: { id: number; name: string }[]; last_message: { text: string; sender: number; created: string } | null; unread: number; updated: string; }
export interface ApiThreadFull extends ApiThread { messages: { id: number; sender: number; sender_name: string; text: string; created: string }[]; }
export interface ApiRecipient { user: number; name: string; sub: string; group: Candidate['group']; is_parent: boolean; }
export function mapThread(t: ApiThreadFull | ApiThread, myId: string): Thread {
  const names: Record<string, string> = {};
  for (const p of t.participants) names[s(p.id)] = p.name;
  const msgs = 'messages' in t ? t.messages : [];
  for (const m of msgs) if (m.sender_name) names[s(m.sender)] = names[s(m.sender)] ?? m.sender_name;
  return {
    id: s(t.id), subject: t.subject, creatorId: s(t.creator), participantIds: t.participants.map((p) => s(p.id)),
    messages: msgs.map((m) => ({ id: s(m.id), fromId: s(m.sender), text: m.text, ts: m.created.slice(0, 16) })),
    read: { [myId]: 0 }, names, unread: t.unread,
  };
}
export const mapRecipient = (r: ApiRecipient): Candidate => ({ userId: s(r.user), name: r.name, sub: r.sub, group: r.group, classIds: [], isParent: r.is_parent });

// --- Emploi du temps et cahier de textes ---
export interface ApiCell { id: number; school_class: number; day: number; slot: number; subject: number; room: string; }
export interface ApiEntry { id: number; school_class: number; subject: number; teacher: number | null; teacher_name?: string; date: string; content: string; homework: string; due: string | null; }
export const mapCell = (c: ApiCell, codeOf: Map<number, string>): Cell | null => {
  const sb = codeOf.get(c.subject);
  return sb ? { classId: s(c.school_class), day: c.day, slot: c.slot, subjectId: sb, room: c.room } : null;
};
export const mapEntry = (e: ApiEntry, codeOf: Map<number, string>): TextEntry | null => {
  const sb = codeOf.get(e.subject);
  return sb ? { id: s(e.id), classId: s(e.school_class), subjectId: sb, teacherId: e.teacher ? s(e.teacher) : '', teacherName: e.teacher_name || undefined, date: e.date, content: e.content, homework: e.homework, due: e.due ?? '' } : null;
};

// --- Examens blancs ---
export interface ApiMockSession { id: number; name: string; type: ExamType; exam_type?: number | null; per_serie?: boolean; start: string; end: string; classes: number[]; coefs: Record<string, Record<string, number>>; published: boolean; }
export interface ApiExamType { id: number; name: string; levels: string[]; per_serie: boolean; coefs: Record<string, Record<string, number>>; active: boolean; sessions: number; }
export const mapExamKind = (x: ApiExamType): ExamKind => ({ id: s(x.id), name: x.name, levels: x.levels ?? [], perSerie: !!x.per_serie, coefs: x.coefs ?? {}, active: x.active !== false, sessions: x.sessions ?? 0 });
export interface ApiMockResult {
  class: number; effectif: number; complete: number; avg: number | null; max: number | null; min: number | null; admis: number; rate: number | null;
  subjects: { id: number; code: string; name: string; short: string; coef: number }[];
  rows: { student: number; name: string; marks: (number | null)[]; filled: number; avg: number | null; mention: string; admissible: boolean | null; rank: number | null }[];
}
export const mapMockResult = (r: ApiMockResult): ClassResult => ({
  subjects: r.subjects.map((x) => ({ id: x.code, name: x.name, short: x.short, coef: x.coef })),
  rows: r.rows.map((x) => ({ studentId: s(x.student), marks: x.marks, filled: x.filled, avg: x.avg, mention: x.mention, admissible: x.admissible, rank: x.rank })),
  effectif: r.effectif, complete: r.complete, avg: r.avg, max: r.max, min: r.min, admis: r.admis, rate: r.rate,
});
/** Notes saisies, reconstituées à partir des lignes de résultats (clé « élève|matière »). */
export function marksOf(r: ApiMockResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of r.rows) r.subjects.forEach((sb, i) => { const m = row.marks[i]; if (m !== null && m !== undefined) out[`${row.student}|${sb.code}`] = m; });
  return out;
}
export const mapMockSession = (x: ApiMockSession, marks: Record<string, number>): MockSession => ({
  id: s(x.id), name: x.name, type: x.type, kindId: x.exam_type != null ? s(x.exam_type) : undefined, perSerie: !!x.per_serie,
  start: x.start, end: x.end, classIds: x.classes.map(s), coefs: x.coefs, status: x.published ? 'publié' : 'brouillon', marks,
});

// --- Salles, cours du jour, remplacements, répartition ---
export type RoomKind = 'classe' | 'labo' | 'info' | 'sport' | 'autre';
export interface ApiRoom { id: number; name: string; capacity: number; kind: RoomKind; classes: string[]; }
export interface Room { id: string; name: string; capacity: number; kind: RoomKind; classes: string[]; }
export const mapRoom = (r: ApiRoom): Room => ({ id: s(r.id), name: r.name, capacity: r.capacity, kind: r.kind, classes: r.classes });
export const ROOM_KIND_LABEL: Record<RoomKind, string> = { classe: 'Salle de classe', labo: 'Laboratoire', info: 'Salle informatique', sport: 'Terrain / gymnase', autre: 'Autre' };

export interface ApiLesson {
  school_class: number; class_name: string; subject: number; subject_name: string; slots: number[]; slot: number; code: string; room: string;
  teacher: number | null; titular: number | null; replacement: number | null; replacement_name: string; replaced_out: boolean;
  start: string; end: string; done: boolean; entry: number | null;
}
/** Un cours du jour, déduit de l'emploi du temps de la classe. `code` est le créneau d'appel (« C1 »…). */
export interface Lesson {
  classId: string; className: string; subjectId: string; subjectName: string; slots: number[]; slot: number; code: Slot; room: string;
  teacherId: string; titularId: string; replacementId?: string; replacementName: string; replacedOut: boolean;
  start: string; end: string; done: boolean; entryId?: string;
}
export const mapLesson = (l: ApiLesson, codeOf: Map<number, string>): Lesson | null => {
  const sub = codeOf.get(l.subject);
  return sub ? {
    classId: s(l.school_class), className: l.class_name, subjectId: sub, subjectName: l.subject_name, slots: l.slots, slot: l.slot, code: l.code as Slot, room: l.room,
    teacherId: l.teacher != null ? s(l.teacher) : '', titularId: l.titular != null ? s(l.titular) : '', replacementId: l.replacement != null ? s(l.replacement) : undefined,
    replacementName: l.replacement_name, replacedOut: l.replaced_out, start: l.start, end: l.end, done: l.done, entryId: l.entry != null ? s(l.entry) : undefined,
  } : null;
};
/** Une ligne du suivi des appels : un cours prévu à l'emploi du temps, ou un appel fait hors emploi du temps. */
export interface ApiSuiviRow {
  date: string; school_class: number; class_name: string; slot: Slot; subject_name: string; start: string; end: string; teacher_name: string;
  done: boolean; taken_by: string; taken_at: string | null; absents: number; retards: number;
}
export interface SuiviRow {
  date: string; classId: string; className: string; slot: Slot; subjectName: string; start: string; end: string; teacherName: string;
  done: boolean; takenBy: string; takenAt: string | null; absents: number; retards: number;
}
export const mapSuivi = (r: ApiSuiviRow): SuiviRow => ({
  date: r.date, classId: s(r.school_class), className: r.class_name, slot: r.slot, subjectName: r.subject_name, start: r.start, end: r.end, teacherName: r.teacher_name,
  done: r.done, takenBy: r.taken_by, takenAt: r.taken_at, absents: r.absents, retards: r.retards,
});
/** Libellé d'un créneau d'appel : « Matin », « Après-midi » ou « Cours 3 ». */
export const slotLabel = (slot: string): string => (/^C\d$/.test(slot) ? `Cours ${slot.slice(1)}` : slot);

export interface ApiReplacement { id: number; school_class: number; class_name: string; subject: number; subject_name: string; date: string; slot: number; teacher: number; teacher_name: string; absent: number | null; absent_name: string; }
export interface Replacement { id: string; classId: string; className: string; subjectId: string; subjectName: string; date: string; slot: number; teacherId: string; teacherName: string; absentName: string; }
export const mapReplacement = (r: ApiReplacement, codeOf: Map<number, string> = new Map()): Replacement => ({ id: s(r.id), classId: s(r.school_class), className: r.class_name, subjectId: codeOf.get(r.subject) ?? '', subjectName: r.subject_name, date: r.date, slot: r.slot, teacherId: s(r.teacher), teacherName: r.teacher_name, absentName: r.absent_name });

export interface ApiRepartition {
  teachers: { id: number; name: string; subject_ids: number[]; max_hours: number | null; hours: number; classes: number }[];
  subjects: { id: number; name: string; teachers: number; classes: { id: number; name: string; teacher: number | null; hours: number }[] }[];
}
export interface ApiPlan { assignments: { school_class: number; subject: number; teacher: number; hours: number }[]; missing: { school_class: number; subject: number; why: 'aucun_enseignant' | 'max_heures' }[]; committed: boolean; }

// --- Conduite et éducateurs ---
export interface ApiConduct {
  class: number; term: TermId; locked: boolean; published: boolean; max: number; in_average: boolean; coef: number; rule: { tranche: number; points: number };
  students: { student: number; name: string; max: number; removed: number; note: number; halfdays: number; due: number; applied: number;
    deductions: { id: number; points: number; reason: string; kind: ConductDeduction['kind']; date: string; by_name: string; pending: boolean; refused: boolean }[] }[];
}
export const mapConduct = (c: ApiConduct): ConductSheet => ({
  classId: s(c.class), termId: c.term, locked: c.locked, published: c.published, max: c.max, inAverage: c.in_average, coef: c.coef, rule: c.rule,
  students: c.students.map((r) => ({ studentId: s(r.student), name: r.name, max: r.max, removed: r.removed, note: r.note, halfdays: r.halfdays, due: r.due, applied: r.applied,
    deductions: r.deductions.map((d) => ({ id: s(d.id), points: d.points, reason: d.reason, kind: d.kind, date: d.date, byName: d.by_name, pending: d.pending, refused: d.refused })) })),
});
export interface ApiEducator { id: number; name: string; classes: number[]; }
export const mapEducator = (e: ApiEducator): Educator => ({ id: s(e.id), name: e.name, classes: e.classes.map(s) });
