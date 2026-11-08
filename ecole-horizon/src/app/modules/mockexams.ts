import { Injectable, effect, inject, signal } from '@angular/core';
import { Api } from '../api';
import { ApiExamType, ApiMockResult, ApiMockSession, mapExamKind, mapMockResult, mapMockSession, marksOf } from '../api-map';
import { Store } from '../store';
import { Classe } from '../models';
import { dateFr } from '../format';

/** Nom de l'examen préparé (« BEPC », « DEF »…), ou « AUTRE » pour un examen ponctuel. */
export type ExamType = string;
/** Type d'examen défini par l'école : nom, niveaux concernés, coefficients par défaut (une colonne « * » ou une par série). */
export interface ExamKind { id: string; name: string; levels: string[]; perSerie: boolean; coefs: Record<string, Record<string, number>>; active: boolean; sessions: number; }
export type SessionStatus = 'brouillon' | 'publié';

export interface MockSession {
  id: string;
  name: string;
  type: ExamType;
  /** Type d'examen de l'école (absent : « Autre examen »). */
  kindId?: string;
  /** Une colonne de coefficients par série (comme le BAC). */
  perSerie: boolean;
  start: string;
  end: string;
  classIds: string[];
  /** Coefficients par colonne ('*' : toutes les classes, sinon la série) puis par matière. */
  coefs: Record<string, Record<string, number>>;
  status: SessionStatus;
  /** Notes sur 20, clé "élève|matière". */
  marks: Record<string, number>;
}

/** Types d'examen de démonstration (Côte d'Ivoire) ; chaque école les modifie ou en saisit d'autres (DEF, CEP…). */
const DEMO_KINDS: ExamKind[] = [
  { id: 'xt-bepc', name: 'BEPC', levels: ['3e'], perSerie: false, active: true, sessions: 0, coefs: { '*': { fr: 3, ma: 3, an: 2, hg: 2, pc: 2, sv: 1, eps: 1 } } },
  { id: 'xt-bac', name: 'BAC', levels: ['Tle'], perSerie: true, active: true, sessions: 0, coefs: {
    A: { fr: 4, ph: 4, hg: 3, an: 3, lv2: 2, ma: 2, eps: 1 },
    C: { ma: 5, pc: 4, sv: 2, ph: 2, fr: 2, an: 2, hg: 2, eps: 1 },
    D: { ma: 4, pc: 4, sv: 4, ph: 2, fr: 2, an: 2, hg: 2, eps: 1 } } },
];

/** Libellé de l'examen d'une session. */
export const typeLabel = (type: ExamType): string => (type === 'AUTRE' ? 'Autre examen' : type);
/** Colonne de coefficients d'une classe : sa série pour un examen « par série », sinon « * » (ou la série si une colonne existe pour elle). */
export const columnOf = (perSerie: boolean, cl: Classe, coefs?: Record<string, unknown>): string =>
  perSerie ? cl.serie ?? '*' : cl.serie && coefs && cl.serie in coefs ? cl.serie : '*';
export const columnLabel = (col: string): string => (col === '*' ? 'Toutes les classes' : `Série ${col}`);
/** Classe concernée par un type d'examen (aucun type : « Autre examen », toutes les classes). */
export const eligible = (kind: ExamKind | null | undefined, cl: Classe): boolean => !kind || !kind.levels.length || kind.levels.includes(cl.level);
export const markKey = (studentId: string, subjectId: string): string => `${studentId}|${subjectId}`;

/** Session à créer : `kindId` absent pour « Autre examen ». */
export interface NewSession { name: string; type: ExamType; kindId?: string; perSerie: boolean; start: string; end: string; classIds: string[]; coefs: MockSession['coefs']; }

export interface ResultRow {
  studentId: string;
  marks: (number | null)[];
  filled: number;
  avg: number | null;
  mention: string;
  admissible: boolean | null;
  rank: number | null;
}
export interface ClassResult {
  subjects: { id: string; name: string; short: string; coef: number }[];
  rows: ResultRow[];
  effectif: number;
  complete: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  admis: number;
  rate: number | null;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100000;
};
const round025 = (n: number): number => Math.round(n * 4) / 4;

@Injectable({ providedIn: 'root' })
export class MockExams {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  readonly kinds = signal<ExamKind[]>(this.s.apiMode() ? [] : structuredClone(DEMO_KINDS));
  readonly sessions = signal<MockSession[]>(this.s.apiMode() ? [] : this.seed());
  /** Mode serveur : résultats calculés par le serveur, clé « session|classe ». */
  private readonly served = signal(new Map<string, ClassResult>());
  private n = 0;

  constructor() {
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode()) return;
      if (!me) { this.sessions.set([]); this.served.set(new Map()); return; }
      void this.load();
    });
  }
  async load(): Promise<void> {
    if (!this.s.apiMode() || !this.s.me()) return;
    try {
      const [list, kinds] = await Promise.all([this.api.get<ApiMockSession[]>('mock-exams/'), this.api.get<ApiExamType[]>('mock-exam-types/').catch(() => [] as ApiExamType[])]);
      this.kinds.set(kinds.map(mapExamKind));
      const served = new Map<string, ClassResult>();
      const out: MockSession[] = [];
      for (const x of list) {
        let marks: Record<string, number> = {};
        const family = this.s.role() === 'parent' || this.s.role() === 'eleve';
        const rs = await Promise.all(x.classes.filter((c) => !family || this.s.classById().has(String(c))).map(async (c) => {
          try { return await this.api.get<ApiMockResult>(`mock-exams/${x.id}/results/?class=${c}`); } catch { return null; }
        }));
        for (const r of rs) if (r) { served.set(`${x.id}|${r.class}`, mapMockResult(r)); marks = { ...marks, ...marksOf(r) }; }
        out.push(mapMockSession(x, marks));
      }
      this.sessions.set(out); this.served.set(served);
    } catch { /* on garde l'état précédent */ }
  }
  kindById(id: string | undefined): ExamKind | undefined { return this.kinds().find((k) => k.id === id); }
  /** Nombre de sessions d'un type (mode démo : compté sur les sessions). */
  usage(k: ExamKind): number { return this.s.apiMode() ? k.sessions : this.sessions().filter((x) => x.kindId === k.id).length; }

  /** Ajoute ou modifie un type d'examen (nom, niveaux, coefficients saisis). Les sessions déjà créées ne changent pas. */
  async saveKindAsync(id: string | null, k: Omit<ExamKind, 'id' | 'sessions'>): Promise<{ ok: boolean; error?: string }> {
    const name = k.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return { ok: false, error: 'Donnez le nom de l’examen (BEPC, BAC, DEF, CEP…).' };
    if (!k.levels.length) return { ok: false, error: 'Choisissez au moins un niveau.' };
    if (this.kinds().some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `L’examen « ${name} » existe déjà.` };
    const coefs: ExamKind['coefs'] = {};
    for (const [col, t] of Object.entries(k.coefs)) { const kept = Object.fromEntries(Object.entries(t).filter(([, v]) => v > 0)); if (Object.keys(kept).length) coefs[col] = kept; }
    if (!this.s.apiMode()) {
      const next = { ...k, name, coefs };
      this.kinds.update((l) => id ? l.map((x) => x.id === id ? { ...x, ...next } : x) : [...l, { ...next, id: `xt-${Date.now().toString(36)}${++this.n}`, sessions: 0 }]);
      this.s.addLog('Examens blancs', `Type d’examen ${id ? 'modifié' : 'ajouté'} : ${name}`);
      return { ok: true };
    }
    const body = { name, levels: k.levels, per_serie: k.perSerie, coefs, active: k.active };
    try { await (id ? this.api.request('PATCH', `mock-exam-types/${id}/`, body) : this.api.post('mock-exam-types/', body)); await this.load(); return { ok: true }; }
    catch (e) { return { ok: false, error: this.s.errorMessage(e) }; }
  }
  /** Masque (ou réaffiche) un type : il n'est plus proposé pour les nouvelles sessions ; l'historique reste. */
  async setKindActiveAsync(k: ExamKind, active: boolean): Promise<{ ok: boolean; error?: string }> {
    if (!this.s.apiMode()) { this.kinds.update((l) => l.map((x) => x.id === k.id ? { ...x, active } : x)); return { ok: true }; }
    try { await this.api.request('PATCH', `mock-exam-types/${k.id}/`, { active }); await this.load(); return { ok: true }; }
    catch (e) { return { ok: false, error: this.s.errorMessage(e) }; }
  }
  /** Retire un type qu'aucune session n'utilise. */
  async removeKindAsync(k: ExamKind): Promise<{ ok: boolean; error?: string }> {
    if (this.usage(k)) return { ok: false, error: `« ${k.name} » est utilisé par ${this.usage(k)} session(s) : masquez-le plutôt.` };
    if (!this.s.apiMode()) { this.kinds.update((l) => l.filter((x) => x.id !== k.id)); return { ok: true }; }
    try { await this.api.request('DELETE', `mock-exam-types/${k.id}/`); await this.load(); return { ok: true }; }
    catch (e) { return { ok: false, error: this.s.errorMessage(e) }; }
  }

  async createAsync(f: NewSession): Promise<{ id?: string; error?: string }> {
    try {
      const r = await this.api.post<ApiMockSession>('mock-exams/', { name: f.name, type: f.type, exam_type: f.kindId ? Number(f.kindId) : null, start: f.start, end: f.end, classes: f.classIds.map(Number), coefs: f.coefs });
      await this.load(); return { id: String(r.id) };
    } catch (e) { return { error: this.s.errorMessage(e) }; }
  }
  async saveMarksAsync(sessionId: string, classId: string, subjectId: string, values: Record<string, number | null>): Promise<string | null> {
    try {
      await this.api.put(`mock-exams/${sessionId}/marks/`, { school_class: Number(classId), subject: this.s.subjectPkOf(subjectId), values });
      await this.load(); return null;
    } catch (e) { return this.s.errorMessage(e); }
  }
  async setStatusAsync(sessionId: string, status: SessionStatus): Promise<string | null> {
    try { await this.api.post(`mock-exams/${sessionId}/publish/`, { published: status === 'publié' }); await this.load(); return null; }
    catch (e) { return this.s.errorMessage(e); }
  }

  private seed(): MockSession[] {
    const bias: Record<string, number> = { ma: -0.8, pc: -0.6, fr: -0.2, an: 0, hg: 0.3, sv: 0.4, eps: 2.5, ph: -0.4, lv2: 0.3 };
    const mk = (classIds: string[], coefs: MockSession['coefs'], perSerie: boolean, only?: string[]): Record<string, number> => {
      const marks: Record<string, number> = {};
      for (const cid of classIds) {
        const cl = this.s.classById().get(cid);
        if (!cl) continue;
        const col = columnOf(perSerie, cl);
        for (const st of this.s.studentsByClass().get(cid) ?? []) {
          const base = st.id === 's-marie' ? 14.6 : 8.2 + (hash(st.id) % 70) / 10;
          for (const sb of Object.keys(coefs[col] ?? {})) {
            if (only && !only.includes(sb)) continue;
            const noise = (hash(`${st.id}|${sb}`) % 60) / 10 - 3;
            marks[markKey(st.id, sb)] = round025(Math.min(19.5, Math.max(2, base + (bias[sb] ?? 0) + noise)));
          }
        }
      }
      return marks;
    };
    const [bepc, bac] = DEMO_KINDS;
    const bepcClasses = this.s.classes().filter((c) => eligible(bepc, c)).map((c) => c.id);
    const bacClasses = this.s.classes().filter((c) => eligible(bac, c)).map((c) => c.id);
    const bepcCoefs = structuredClone(bepc.coefs);
    const bacCoefs: MockSession['coefs'] = {};
    for (const c of this.s.classes().filter((x) => bacClasses.includes(x.id))) {
      const col = columnOf(true, c);
      if (bac.coefs[col]) bacCoefs[col] = { ...bac.coefs[col] };
    }
    return [
      { id: 'mx-bepc1', name: 'BEPC blanc n°1', type: 'BEPC', kindId: bepc.id, perSerie: false, start: '2026-11-30', end: '2026-12-04', classIds: bepcClasses, coefs: bepcCoefs, status: 'publié', marks: mk(bepcClasses, bepcCoefs, false) },
      { id: 'mx-bac1', name: 'BAC blanc n°1', type: 'BAC', kindId: bac.id, perSerie: true, start: '2026-12-07', end: '2026-12-11', classIds: bacClasses, coefs: bacCoefs, status: 'brouillon', marks: mk(bacClasses, bacCoefs, true, ['ma', 'fr', 'ph']) },
    ];
  }

  byId(id: string | null): MockSession | undefined {
    return this.sessions().find((x) => x.id === id);
  }

  subjectsFor(sess: MockSession, classId: string): ClassResult['subjects'] {
    const cl = this.s.classById().get(classId);
    if (!cl) return [];
    const co = sess.coefs[columnOf(sess.perSerie, cl, sess.coefs)] ?? {};
    return this.s.subjects().filter((sb) => (co[sb.id] ?? 0) > 0).map((sb) => ({ id: sb.id, name: sb.name, short: sb.short, coef: co[sb.id] }))
      .sort((a, b) => b.coef - a.coef);
  }

  mention(avg: number | null): string {
    if (avg === null) return '—';
    const [tb, b, ab, p] = this.s.school().seuils;
    return avg >= tb ? 'Très bien' : avg >= b ? 'Bien' : avg >= ab ? 'Assez bien' : avg >= p ? 'Passable' : 'Insuffisant';
  }

  result(sess: MockSession, classId: string): ClassResult {
    if (this.s.apiMode()) { const r = this.served().get(`${sess.id}|${classId}`); if (r) return r; }
    const subjects = this.subjectsFor(sess, classId);
    const students = this.s.studentsByClass().get(classId) ?? [];
    const rows: ResultRow[] = students.map((st) => {
      const marks = subjects.map((sb) => sess.marks[markKey(st.id, sb.id)] ?? null);
      const filled = marks.filter((m) => m !== null).length;
      const complete = subjects.length > 0 && filled === subjects.length;
      let avg: number | null = null;
      if (complete) {
        const tot = subjects.reduce((a, sb, i) => a + (marks[i] as number) * sb.coef, 0);
        const coef = subjects.reduce((a, sb) => a + sb.coef, 0);
        avg = Math.round((tot / coef) * 100) / 100;
      }
      return { studentId: st.id, marks, filled, avg, mention: this.mention(avg), admissible: avg === null ? null : avg >= 10, rank: null };
    });
    const sorted = rows.filter((r) => r.avg !== null).sort((a, b) => (b.avg as number) - (a.avg as number));
    sorted.forEach((r, i) => { r.rank = i > 0 && sorted[i - 1].avg === r.avg ? sorted[i - 1].rank : i + 1; });
    const avgs = sorted.map((r) => r.avg as number);
    const admis = sorted.filter((r) => r.admissible).length;
    return {
      subjects, rows, effectif: students.length, complete: sorted.length,
      avg: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null,
      max: avgs.length ? Math.max(...avgs) : null,
      min: avgs.length ? Math.min(...avgs) : null,
      admis, rate: sorted.length ? Math.round((admis / sorted.length) * 100) : null,
    };
  }

  /** Nombre de notes saisies / attendues pour une matière dans une classe. */
  progress(sess: MockSession, classId: string, subjectId: string): { done: number; total: number } {
    const st = this.s.studentsByClass().get(classId) ?? [];
    return { done: st.filter((x) => sess.marks[markKey(x.id, subjectId)] !== undefined).length, total: st.length };
  }
  missingMarks(sess: MockSession): number {
    let n = 0;
    for (const cid of sess.classIds) for (const sb of this.subjectsFor(sess, cid)) { const p = this.progress(sess, cid, sb.id); n += p.total - p.done; }
    return n;
  }

  create(f: NewSession): MockSession {
    const sess: MockSession = { ...f, id: `mx-${Date.now().toString(36)}${++this.n}`, status: 'brouillon', marks: {} };
    this.sessions.update((l) => [...l, sess]);
    this.s.addLog('Examens blancs', `Session créée : ${sess.name} (${sess.type}, du ${dateFr(sess.start)} au ${dateFr(sess.end)})`);
    // Les enseignants concernés sont prévenus qu'ils peuvent saisir leurs notes
    const teachers = new Set<string>();
    for (const cid of sess.classIds) for (const sb of this.subjectsFor(sess, cid)) { const t = this.s.teacherOf(cid, sb.id); if (t) teachers.add(t.userId); }
    this.s.notify([...teachers], `Nouvelle session « ${sess.name} » : pensez à saisir vos notes avant la publication.`, 'systeme', 'examens');
    return sess;
  }

  saveMarks(sessionId: string, classId: string, subjectId: string, values: Record<string, number | null>): void {
    this.sessions.update((l) => l.map((x) => {
      if (x.id !== sessionId) return x;
      const marks = { ...x.marks };
      for (const [sid, v] of Object.entries(values)) {
        if (v === null) delete marks[markKey(sid, subjectId)]; else marks[markKey(sid, subjectId)] = v;
      }
      return { ...x, marks };
    }));
    const sess = this.byId(sessionId);
    this.s.addLog('Examens blancs', `Notes saisies : ${sess?.name} · ${this.s.className(classId)} · ${this.s.subjectById().get(subjectId)?.name}`);
  }

  setStatus(sessionId: string, status: SessionStatus): number {
    const sess = this.byId(sessionId);
    if (!sess) return 0;
    this.sessions.update((l) => l.map((x) => (x.id === sessionId ? { ...x, status } : x)));
    this.s.addLog('Examens blancs', `${status === 'publié' ? 'Résultats publiés' : 'Session repassée en brouillon'} : ${sess.name}`);
    if (status !== 'publié') return 0;
    const ids = new Set<string>();
    for (const cid of sess.classIds) for (const st of this.s.studentsByClass().get(cid) ?? []) this.s.familyUserIds(st.id).forEach((u) => ids.add(u));
    this.s.notify([...ids], `Les résultats du ${sess.name} sont disponibles.`, 'note', 'examens');
    return ids.size;
  }
}
