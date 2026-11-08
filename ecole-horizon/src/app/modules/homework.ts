import { Injectable, effect, inject, signal } from '@angular/core';
import { Api } from '../api';
import { Store } from '../store';

export type HwKind = 'fichier' | 'epreuve';
export type HwStatus = 'a_faire' | 'rendu' | 'corrige' | 'en_cours' | 'termine';
export type Correction = 'jamais' | 'fin' | 'manuel';

export interface HwMine {
  id: number | null; student: string; status: HwStatus; late: boolean; manual: boolean; leaves: number;
  submittedAt: string | null; startedAt: string | null; finishedAt: string | null; deadlineAt: string | null;
  score: number | null; feedback: string; fileName: string; comment: string; graded: boolean;
}
export interface HwQuestion { id?: number; kind: 'qcm' | 'vf'; text: string; choices: string[]; correct: number[]; points: number; }
export interface Homework {
  id: string; classId: string; subjectId: string; subjectName: string; teacherName: string; kind: HwKind; title: string; instructions: string;
  opensAt: string; dueAt: string; allowLate: boolean; maxPoints: number; durationMin: number | null; shuffle: boolean;
  correction: Correction; correctionOpen: boolean; maxLeaves: number; published: boolean; hasAttachment: boolean; attachmentName: string;
  questionCount: number; totalPoints: number; window: 'a_venir' | 'ouvert' | 'ferme'; evaluationId: number | null;
  counts?: { students: number; rendus: number; corriges: number; en_cours: number };
  mine: HwMine[]; correctionVisible: boolean; questions?: HwQuestion[];
}
export interface ResultRow extends HwMine { name: string; }
export interface Results { rows: ResultRow[]; max: number; average: number | null; questions?: { id: number; text: string; success: number | null }[]; }
export interface AttemptQuestion { id: number; kind: 'qcm' | 'vf'; text: string; points: number; multiple: boolean; choices: { i: number; text: string }[]; }
export interface Attempt { sub: HwMine; questions: AttemptQuestion[]; answers: Record<string, number[]>; remaining: number; }
export interface ReviewItem { id: number; text: string; kind: 'qcm' | 'vf'; points: number; choices: string[]; chosen: number[]; correct?: number[]; ok?: boolean; earned?: number; }
export interface HwForm {
  classId: string; subjectId: string; kind: HwKind; title: string; instructions: string; opensAt: string; dueAt: string;
  allowLate: boolean; maxPoints: number; durationMin: number; shuffle: boolean; correction: Correction; maxLeaves: number;
}

/* ---- Données du serveur → modèle de l'interface ---- */
interface ApiMine {
  id: number | null; student: number; status: HwStatus; late: boolean; manual: boolean; leaves: number; submitted_at: string | null; started_at: string | null;
  finished_at: string | null; deadline_at: string | null; score: number | null; feedback: string; file_name: string; comment: string; graded: boolean;
}
export interface ApiHomework {
  id: number; school_class: number; subject: number; subject_name: string; teacher_name: string; kind: HwKind; title: string; instructions: string;
  opens_at: string; due_at: string; allow_late: boolean; max_points: number; duration_min: number | null; shuffle: boolean; correction: Correction;
  correction_open: boolean; max_leaves: number; published: boolean; has_attachment: boolean; attachment_name: string; question_count: number; total_points: number;
  window: Homework['window']; evaluation: number | null; counts?: Homework['counts']; mine?: ApiMine[]; correction_visible?: boolean;
  questions?: { id: number; kind: 'qcm' | 'vf'; text: string; choices: string[]; correct: number[]; points: number }[];
}
export const mapMine = (m: ApiMine): HwMine => ({
  id: m.id, student: String(m.student), status: m.status, late: m.late, manual: m.manual, leaves: m.leaves ?? 0, submittedAt: m.submitted_at, startedAt: m.started_at,
  finishedAt: m.finished_at, deadlineAt: m.deadline_at, score: m.score, feedback: m.feedback, fileName: m.file_name, comment: m.comment, graded: m.graded,
});
export const mapHomework = (a: ApiHomework, codeOf: (pk: number) => string | undefined): Homework => ({
  id: String(a.id), classId: String(a.school_class), subjectId: codeOf(a.subject) ?? String(a.subject), subjectName: a.subject_name, teacherName: a.teacher_name,
  kind: a.kind, title: a.title, instructions: a.instructions, opensAt: a.opens_at, dueAt: a.due_at, allowLate: a.allow_late, maxPoints: Number(a.max_points),
  durationMin: a.duration_min, shuffle: a.shuffle, correction: a.correction, correctionOpen: a.correction_open, maxLeaves: a.max_leaves ?? 0, published: a.published,
  hasAttachment: a.has_attachment, attachmentName: a.attachment_name, questionCount: a.question_count, totalPoints: Number(a.total_points), window: a.window,
  evaluationId: a.evaluation, counts: a.counts, mine: (a.mine ?? []).map(mapMine), correctionVisible: !!a.correction_visible, questions: a.questions,
});

/** Valeur d'un champ `datetime-local` (heure locale) pour une date ISO. */
export const toInput = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const mmss = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Devoirs à rendre et épreuves en ligne. Cette fonction n'existe qu'avec le serveur : il garde les fichiers,
 * compte le temps des épreuves et corrige les QCM (la démonstration sans serveur ne les propose pas).
 */
@Injectable({ providedIn: 'root' })
export class Homeworks {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  readonly list = signal<Homework[]>([]);
  readonly loaded = signal(false);

  constructor() {
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode() || !me) { this.list.set([]); this.loaded.set(false); return; }
      if (this.s.school().devoirsActifs) void this.load();
    });
  }

  private fail(e: unknown): string { return this.s.errorMessage(e); }
  private map(a: ApiHomework): Homework { return mapHomework(a, (pk) => this.s.subjectCode(pk)); }

  async load(): Promise<void> {
    try {
      this.list.set((await this.api.get<ApiHomework[]>('homeworks/')).map((a) => this.map(a)));
      this.loaded.set(true);
    } catch { /* on garde l'état précédent */ }
  }
  /** Remplace un devoir de la liste par sa version à jour. */
  private put(a: ApiHomework): Homework {
    const h = this.map(a);
    this.list.update((l) => (l.some((x) => x.id === h.id) ? l.map((x) => (x.id === h.id ? h : x)) : [h, ...l]));
    return h;
  }
  async get(id: string): Promise<Homework | null> {
    try { return this.put(await this.api.get<ApiHomework>(`homeworks/${id}/`)); } catch { return null; }
  }

  private body(f: Partial<HwForm>): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    if (f.classId !== undefined) o['school_class'] = Number(f.classId);
    if (f.subjectId !== undefined) o['subject'] = this.s.subjectPkOf(f.subjectId);
    if (f.kind !== undefined) o['kind'] = f.kind;
    if (f.title !== undefined) o['title'] = f.title.trim();
    if (f.instructions !== undefined) o['instructions'] = f.instructions.trim();
    if (f.opensAt) o['opens_at'] = f.opensAt;
    if (f.dueAt) o['due_at'] = f.dueAt;
    if (f.allowLate !== undefined) o['allow_late'] = f.allowLate;
    if (f.kind === 'fichier' && f.maxPoints !== undefined) o['max_points'] = f.maxPoints;
    if (f.kind === 'epreuve' && f.durationMin !== undefined) o['duration_min'] = f.durationMin;
    if (f.shuffle !== undefined) o['shuffle'] = f.shuffle;
    if (f.correction !== undefined) o['correction'] = f.correction;
    if (f.kind === 'epreuve' && f.maxLeaves !== undefined) o['max_leaves'] = f.maxLeaves;
    return o;
  }
  async create(f: HwForm): Promise<{ hw?: Homework; error?: string }> {
    try { return { hw: this.put(await this.api.post<ApiHomework>('homeworks/', this.body(f))) }; } catch (e) { return { error: this.fail(e) }; }
  }
  async update(id: string, f: Partial<HwForm>): Promise<{ hw?: Homework; error?: string }> {
    try { return { hw: this.put(await this.api.patch<ApiHomework>(`homeworks/${id}/`, this.body(f))) }; } catch (e) { return { error: this.fail(e) }; }
  }
  async remove(id: string): Promise<string | null> {
    try { await this.api.delete(`homeworks/${id}/`); this.list.update((l) => l.filter((x) => x.id !== id)); return null; } catch (e) { return this.fail(e); }
  }
  async saveQuestions(id: string, qs: HwQuestion[]): Promise<{ hw?: Homework; error?: string }> {
    try {
      const questions = qs.map((q) => ({ kind: q.kind, text: q.text, choices: q.kind === 'vf' ? [] : q.choices, correct: q.correct, points: q.points }));
      return { hw: this.put(await this.api.put<ApiHomework>(`homeworks/${id}/questions/`, { questions })) };
    } catch (e) { return { error: this.fail(e) }; }
  }
  async send(id: string): Promise<{ hw?: Homework; error?: string }> {
    try { return { hw: this.put(await this.api.post<ApiHomework>(`homeworks/${id}/send/`)) }; } catch (e) { return { error: this.fail(e) }; }
  }
  async attach(id: string, file: File): Promise<{ hw?: Homework; error?: string }> {
    const fd = new FormData(); fd.append('file', file);
    try { return { hw: this.put(await this.api.post<ApiHomework>(`homeworks/${id}/attachment/`, fd)) }; } catch (e) { return { error: this.fail(e) }; }
  }
  async detach(id: string): Promise<string | null> {
    try { await this.api.delete(`homeworks/${id}/attachment/`); await this.get(id); return null; } catch (e) { return this.fail(e); }
  }
  async downloadAttachment(h: Homework): Promise<void> {
    try { this.s.saveBlob(h.attachmentName || 'sujet', await this.api.blob(`homeworks/${h.id}/attachment/`)); } catch (e) { this.s.toast(this.fail(e), 'err'); }
  }
  async downloadCopy(subId: number, name: string): Promise<void> {
    try { this.s.saveBlob(name || 'copie', await this.api.blob(`submissions/${subId}/file/`)); } catch (e) { this.s.toast(this.fail(e), 'err'); }
  }

  // --- Élève ---
  async submit(id: string, file: File, comment: string): Promise<string | null> {
    const fd = new FormData(); fd.append('file', file); fd.append('comment', comment);
    try { await this.api.post(`homeworks/${id}/submit/`, fd); await this.get(id); return null; } catch (e) { return this.fail(e); }
  }
  async start(id: string): Promise<{ attempt?: Attempt; error?: string }> {
    try {
      const r = await this.api.post<ApiMine & { questions: AttemptQuestion[]; answers: Record<string, number[]>; remaining: number }>(`homeworks/${id}/start/`);
      return { attempt: { sub: mapMine(r), questions: r.questions, answers: r.answers ?? {}, remaining: r.remaining } };
    } catch (e) { return { error: this.fail(e) }; }
  }
  async saveAnswers(id: string, answers: Record<string, number[]>): Promise<string | null> {
    try { await this.api.put(`homeworks/${id}/answers/`, { answers }); return null; } catch (e) { return this.fail(e); }
  }
  /** Signale au serveur que l'élève a quitté la page de l'épreuve. */
  async leave(id: string): Promise<{ leaves: number; maxLeaves: number; finished: boolean } | null> {
    try { const r = await this.api.post<{ leaves: number; max_leaves: number; finished: boolean }>(`homeworks/${id}/leave/`); return { leaves: r.leaves, maxLeaves: r.max_leaves, finished: r.finished }; } catch { return null; }
  }
  async finish(id: string, answers: Record<string, number[]>): Promise<{ mine?: HwMine; error?: string }> {
    try {
      const m = mapMine(await this.api.post<ApiMine>(`homeworks/${id}/finish/`, { answers }));
      await this.get(id);
      return { mine: m };
    } catch (e) { return { error: this.fail(e) }; }
  }

  // --- Enseignant : copies, notes, report ---
  async results(id: string): Promise<Results | null> {
    try {
      const r = await this.api.get<{ rows: (ApiMine & { name: string })[]; max: number; average: number | null; questions?: Results['questions'] }>(`homeworks/${id}/submissions/`);
      return { rows: r.rows.map((x) => ({ ...mapMine(x), name: x.name })), max: r.max, average: r.average, questions: r.questions };
    } catch (e) { this.s.toast(this.fail(e), 'err'); return null; }
  }
  async review(subId: number): Promise<ReviewItem[] | null> {
    try { return (await this.api.get<{ answers: ReviewItem[] }>(`submissions/${subId}/`)).answers; } catch (e) { this.s.toast(this.fail(e), 'err'); return null; }
  }
  async grade(id: string, grades: { student: string; score: number | null; feedback: string }[]): Promise<string | null> {
    try {
      await this.api.put(`homeworks/${id}/grades/`, { grades: grades.map((g) => ({ student: Number(g.student), score: g.score, feedback: g.feedback })) });
      await this.get(id); return null;
    } catch (e) { return this.fail(e); }
  }
  async setCorrection(id: string, open: boolean): Promise<string | null> {
    try { await this.api.post(`homeworks/${id}/correction/`, { open }); await this.get(id); return null; } catch (e) { return this.fail(e); }
  }
  async toGrades(id: string): Promise<{ grades?: number; published?: boolean; error?: string }> {
    try { const r = await this.api.post<{ grades: number; published: boolean }>(`homeworks/${id}/to-grades/`, {}); await this.get(id); return r; } catch (e) { return { error: this.fail(e) }; }
  }
}
