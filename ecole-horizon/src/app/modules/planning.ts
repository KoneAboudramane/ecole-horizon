import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api, ApiError } from '../api';
import { ApiLesson, ApiPlan, ApiRepartition, ApiReplacement, ApiRoom, Lesson, Replacement, Room, mapLesson, mapReplacement, mapRoom } from '../api-map';
import { Store } from '../store';

export interface TeacherLoad { id: string; name: string; subjectIds: string[]; maxHours: number | null; hours: number; classes: number; }
export interface RepartitionSubject { id: string; code: string; name: string; teachers: number; classes: { id: string; name: string; teacherId: string; hours: number }[]; }
export interface PlanRow { classId: string; subjectCode: string; teacherId: string; hours: number; }
export interface PlanMiss { classId: string; subjectCode: string; why: 'aucun_enseignant' | 'max_heures'; }
export interface Candidate { id: string; name: string; same_subject: boolean; busy: string; dispo?: '' | 'x' | 'p'; }

/** Salles, cours du jour (déduits des emplois du temps), remplacements et répartition des enseignants. Tout cela vient du serveur. */
@Injectable({ providedIn: 'root' })
export class Planning {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  readonly rooms = signal<Room[]>([]);
  readonly roomNames = computed(() => this.rooms().map((r) => r.name));
  readonly roomByName = computed(() => new Map(this.rooms().map((r) => [r.name, r])));

  constructor() {
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode()) return;
      if (!me) { this.rooms.set([]); return; }
      void this.loadRooms();
    });
  }
  private codeOf(): Map<number, string> { return new Map(this.s.subjects().map((x) => [this.s.subjectPkOf(x.id) ?? -1, x.id] as [number, string])); }
  private fail(e: unknown): string { return this.s.errorMessage(e); }

  // --- Salles ---
  async loadRooms(): Promise<void> {
    if (!this.s.apiMode() || !this.s.me()) return;
    try { this.rooms.set((await this.api.get<ApiRoom[]>('rooms/')).map(mapRoom)); } catch { /* on garde l'état précédent */ }
  }
  async saveRoom(id: string | null, f: { name: string; capacity: number; kind: string }): Promise<string | null> {
    try {
      if (id) await this.api.patch(`rooms/${id}/`, f); else await this.api.post('rooms/', f);
      await Promise.all([this.loadRooms(), this.s.refreshStructure()]); return null;
    } catch (e) { return this.fail(e); }
  }
  /** Supprime une salle. Si des cours y sont placés, le serveur le dit (`cours`) et demande confirmation (`force`). */
  async removeRoom(id: string, force = false): Promise<{ ok: boolean; error?: string; cours?: number }> {
    try { await this.api.request('DELETE', `rooms/${id}/${force ? '?force=1' : ''}`); await Promise.all([this.loadRooms(), this.s.refreshStructure()]); return { ok: true }; }
    catch (e) { return { ok: false, error: this.fail(e), cours: e instanceof ApiError && e.errors?.['code'] === 'salle_utilisee' ? Number(e.errors?.['cours'] ?? 0) : undefined }; }
  }
  async autoAssign(reset: boolean): Promise<{ assigned: string[]; left: string[] } | string> {
    try { const r = await this.api.post<{ assigned: string[]; left: string[] }>('rooms/auto/', { reset }); await Promise.all([this.loadRooms(), this.s.refreshStructure()]); return r; }
    catch (e) { return this.fail(e); }
  }
  /** Choisit la salle principale d'une classe (`null` : aucune). */
  async setClassRoom(classId: string, roomId: string | null): Promise<string | null> {
    try { await this.api.patch(`classes/${classId}/`, { room: roomId ? Number(roomId) : null }); await Promise.all([this.loadRooms(), this.s.refreshStructure()]); return null; }
    catch (e) { return this.fail(e); }
  }

  // --- Cours du jour ---
  async lessons(date: string, opts: { teacherId?: string; classId?: string } = {}): Promise<Lesson[]> {
    const q = new URLSearchParams({ date });
    if (opts.teacherId) q.set('teacher', opts.teacherId);
    if (opts.classId) q.set('class', opts.classId);
    try {
      const r = await this.api.get<{ lessons: ApiLesson[] }>(`lessons/?${q}`);
      const codeOf = this.codeOf();
      return r.lessons.map((l) => mapLesson(l, codeOf)).filter((l): l is Lesson => !!l);
    } catch { return []; }
  }

  // --- Remplacements ---
  async replacements(from: string, to: string): Promise<Replacement[]> {
    try { const codeOf = this.codeOf(); return (await this.api.get<ApiReplacement[]>(`replacements/?from=${from}&to=${to}`)).map((r) => mapReplacement(r, codeOf)); } catch { return []; }
  }
  async candidates(classId: string, date: string, slot: number): Promise<Candidate[]> {
    try { return (await this.api.get<Candidate[]>(`replacements/candidates/?class=${classId}&date=${date}&slot=${slot}`)).map((c) => ({ ...c, id: String(c.id) })); } catch { return []; }
  }
  async addReplacement(classId: string, date: string, slot: number, teacherId: string): Promise<string | null> {
    try { await this.api.post('replacements/', { school_class: Number(classId), date, slot, teacher: Number(teacherId) }); return null; } catch (e) { return this.fail(e); }
  }
  async removeReplacement(id: string): Promise<string | null> {
    try { await this.api.request('DELETE', `replacements/${id}/`); return null; } catch (e) { return this.fail(e); }
  }

  // --- Répartition des enseignants ---
  async repartition(): Promise<{ teachers: TeacherLoad[]; subjects: RepartitionSubject[] } | string> {
    try {
      const r = await this.api.get<ApiRepartition>('assignments/repartition/');
      const codeOf = this.codeOf();
      return {
        teachers: r.teachers.map((t) => ({ id: String(t.id), name: t.name, subjectIds: t.subject_ids.map((i) => codeOf.get(i)).filter((c): c is string => !!c), maxHours: t.max_hours, hours: t.hours, classes: t.classes })),
        subjects: r.subjects.flatMap((x) => { const code = codeOf.get(x.id); return code ? [{ id: String(x.id), code, name: x.name, teachers: x.teachers, classes: x.classes.map((c) => ({ id: String(c.id), name: c.name, teacherId: c.teacher != null ? String(c.teacher) : '', hours: c.hours })) }] : []; }),
      };
    } catch (e) { return this.fail(e); }
  }
  /** Propose (ou, avec `commit`, enregistre) une répartition équilibrée. */
  async plan(subjectCodes: string[], opts: { reset?: boolean; commit?: boolean } = {}): Promise<{ rows: PlanRow[]; missing: PlanMiss[]; committed: boolean } | string> {
    try {
      const r = await this.api.post<ApiPlan>('assignments/repartition/', { subjects: subjectCodes.map((c) => this.s.subjectPkOf(c)).filter((x) => x != null), reset: !!opts.reset, commit: !!opts.commit });
      const codeOf = this.codeOf();
      if (opts.commit) await this.s.refreshStructure();
      return {
        rows: r.assignments.map((a) => ({ classId: String(a.school_class), subjectCode: codeOf.get(a.subject) ?? '', teacherId: String(a.teacher), hours: a.hours })),
        missing: r.missing.map((m) => ({ classId: String(m.school_class), subjectCode: codeOf.get(m.subject) ?? '', why: m.why })),
        committed: r.committed,
      };
    } catch (e) { return this.fail(e); }
  }
  async setMaxHours(teacherId: string, hours: number | null): Promise<string | null> {
    try { await this.api.patch(`teachers/${teacherId}/`, { max_hours: hours }); await this.s.refreshStructure(); return null; } catch (e) { return this.fail(e); }
  }
}
