import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api, ApiError } from '../api';
import { ApiCell, mapCell } from '../api-map';
import { Store } from '../store';
import { Planning } from './planning';
import { Assignment, Classe } from '../models';
import { addDays } from '../format';

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export interface SlotDef { start: string; end: string; }

/** Horaires de cours d'une école : créneaux de la journée, pauses (avant le créneau n°…) et nombre de créneaux ouverts de lundi à dimanche. */
export interface Horaires {
  creneaux: { debut: string; fin: string }[];
  pauses: Record<string, string>;
  ouverts: number[];
}
/** Horaires d'origine : créneaux d'une heure de 7h30 à 17h30, mercredi et samedi matin seulement. */
export const DEFAULT_HORAIRES: Horaires = {
  creneaux: [['07h30', '08h30'], ['08h30', '09h30'], ['09h45', '10h45'], ['10h45', '11h45'], ['11h45', '12h45'], ['14h30', '15h30'], ['15h30', '16h30'], ['16h30', '17h30']].map(([debut, fin]) => ({ debut, fin })),
  pauses: { '2': 'Récréation', '5': 'Pause déjeuner' },
  ouverts: [8, 8, 5, 8, 8, 4, 0],
};
export const slotDefs = (h: Horaires): SlotDef[] => h.creneaux.map((c) => ({ start: c.debut, end: c.fin }));
/** Pauses avec leurs heures : « Récréation · 09h30 à 09h45 ». */
export const breaksOf = (h: Horaires): Record<number, string> => {
  const out: Record<number, string> = {};
  for (const [k, label] of Object.entries(h.pauses)) {
    const i = Number(k);
    if (i > 0 && i < h.creneaux.length) { const a = h.creneaux[i - 1].fin, b = h.creneaux[i].debut; out[i] = a !== b ? `${label} · ${a} à ${b}` : label; }
  }
  return out;
};
export const slotsOpenOf = (h: Horaires, day: number): number => h.ouverts[day] ?? 0;
export const isOpenIn = (h: Horaires, day: number, slot: number): boolean => slot >= 0 && slot < slotsOpenOf(h, day);
/** Couples de créneaux qui se suivent sans pause : possibles pour un cours de deux heures. */
export const pairsOf = (h: Horaires): [number, number][] => h.creneaux.slice(0, -1).map((_, i) => [i, i + 1] as [number, number]).filter(([, y]) => !(String(y) in h.pauses));
/** Jours dans l'ordre de préférence pour placer les cours (mercredi et samedi en dernier), jours fermés exclus. */
export const dayOrderOf = (h: Horaires): number[] => [0, 1, 3, 4, 2, 5, 6].filter((d) => (h.ouverts[d] ?? 0) > 0);
export const totalSlots = (h: Horaires): number => h.ouverts.reduce((a, b) => a + b, 0);

export const SPORT = 'Terrain de sport';
export const LAB = 'Laboratoire';
export const CLASSROOMS = (n: number): string[] => Array.from({ length: n }, (_, i) => `Salle ${i + 1}`);

export interface Cell { classId: string; day: number; slot: number; subjectId: string; room: string; }

/** Jour de la semaine (0 = lundi) d'une date ISO. */
export const dayIndex = (iso: string): number => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;

const splitHours = (h: number): number[] => (h <= 1 ? [1] : h === 2 ? [2] : h === 3 ? [2, 1] : h === 4 ? [2, 2] : [2, 2, 1]);

export interface GenInput {
  horaires?: Horaires;
  classes: Classe[];
  assignments: Assignment[];
  hoursOf: (classId: string, subjectId: string) => number;
}

/**
 * Génère un emploi du temps déterministe. Garanties : aucune classe, aucun enseignant et aucune salle
 * occupés deux fois au même créneau (vérifié à chaque placement).
 */
export function generateTimetable(inp: GenInput): { cells: Cell[]; unplaced: number } {
  const hr = inp.horaires ?? DEFAULT_HORAIRES;
  const pairs = pairsOf(hr);
  const cells: Cell[] = [];
  const teacherBusy = new Set<string>();
  const classBusy = new Set<string>();
  const roomBusy = new Set<string>();
  const load = new Map<string, number>(); // classe|jour -> créneaux utilisés
  let unplaced = 0;

  inp.classes.forEach((cl, ci) => {
    const home = `Salle ${ci + 1}`;
    const subs = inp.assignments
      .filter((a) => a.classId === cl.id)
      .map((a) => ({ a, h: Math.min(5, a.subjectId === 'eps' ? 2 : inp.hoursOf(cl.id, a.subjectId)) }))
      .sort((x, y) => y.h - x.h || x.a.subjectId.localeCompare(y.a.subjectId));
    const blocks: { subj: string; teacher: string; len: number; n: number }[] = [];
    subs.forEach(({ a, h }, si) => splitHours(h).forEach((len, n) => blocks.push({ subj: a.subjectId, teacher: a.teacherId, len, n: n + si })));
    blocks.sort((x, y) => y.len - x.len);
    const daysUsed = new Map<string, Set<number>>();

    const tryPlace = (b: { subj: string; teacher: string; len: number }, strict: boolean): boolean => {
      const days = dayOrderOf(hr).sort((d1, d2) => (load.get(`${cl.id}|${d1}`) ?? 0) - (load.get(`${cl.id}|${d2}`) ?? 0) || ((d1 + ci) % 6) - ((d2 + ci) % 6));
      const sport = b.subj === 'eps';
      for (const day of days) {
        if (strict && daysUsed.get(b.subj)?.has(day)) continue;
        const options: number[][] = b.len === 2 ? pairs.filter(([, y]) => isOpenIn(hr, day, y)).map(([x, y]) => [x, y]) : Array.from({ length: slotsOpenOf(hr, day) }, (_, i) => [i]);
        options.sort((p, q) => (sport ? q[0] - p[0] : p[0] - q[0]));
        for (const slots of options) {
          const labFree = b.subj === 'pc' && b.len === 2 && slots.every((sl) => !roomBusy.has(`${LAB}|${day}|${sl}`));
          const room = sport ? SPORT : labFree ? LAB : home;
          const free = slots.every((sl) => !classBusy.has(`${cl.id}|${day}|${sl}`) && !teacherBusy.has(`${b.teacher}|${day}|${sl}`) && !roomBusy.has(`${room}|${day}|${sl}`));
          if (!free) continue;
          for (const sl of slots) {
            cells.push({ classId: cl.id, day, slot: sl, subjectId: b.subj, room });
            classBusy.add(`${cl.id}|${day}|${sl}`);
            teacherBusy.add(`${b.teacher}|${day}|${sl}`);
            roomBusy.add(`${room}|${day}|${sl}`);
          }
          load.set(`${cl.id}|${day}`, (load.get(`${cl.id}|${day}`) ?? 0) + slots.length);
          (daysUsed.get(b.subj) ?? daysUsed.set(b.subj, new Set()).get(b.subj)!).add(day);
          return true;
        }
      }
      return false;
    };

    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (tryPlace(b, true) || tryPlace(b, false)) continue;
      // Un bloc de 2 h qui ne tient pas d'un seul tenant est découpé en deux fois 1 h
      if (b.len === 2) blocks.push({ ...b, len: 1 }, { ...b, len: 1 });
      else unplaced++;
    }
  });
  return { cells, unplaced };
}

/** Contrôle indépendant : renvoie les doubles réservations (enseignant, salle, classe). */
export function findClashes(cells: Cell[], teacherOf: (classId: string, subjectId: string) => string | undefined): string[] {
  const seen = new Map<string, Cell>();
  const out: string[] = [];
  for (const c of cells) {
    const keys = [`C|${c.classId}|${c.day}|${c.slot}`, `T|${teacherOf(c.classId, c.subjectId)}|${c.day}|${c.slot}`, `R|${c.room}|${c.day}|${c.slot}`];
    for (const k of keys) {
      if (seen.has(k)) out.push(k);
      else seen.set(k, c);
    }
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class Timetable {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  private readonly plan = inject(Planning);
  /** Salles proposées : celles de l'école si elle les a enregistrées, sinon « Salle 1… », laboratoire, terrain. */
  readonly rooms = computed(() => (this.s.apiMode() && this.plan.roomNames().length ? this.plan.roomNames() : [...CLASSROOMS(this.s.classes().length), LAB, SPORT, 'Salle informatique']));
  /** Avertissements du serveur au dernier enregistrement (salle trop petite…). */
  readonly warnings = signal<string[]>([]);
  /** Horaires de l'école (ceux d'origine tant que le serveur ne les a pas fournis). */
  readonly horaires = signal<Horaires>(DEFAULT_HORAIRES);
  readonly slots = computed(() => slotDefs(this.horaires()));
  readonly breaks = computed(() => breaksOf(this.horaires()));
  readonly openDays = computed(() => [0, 1, 2, 3, 4, 5, 6].filter((d) => slotsOpenOf(this.horaires(), d) > 0));
  readonly totalSlots = computed(() => totalSlots(this.horaires()));
  isOpen = (day: number, slot: number): boolean => isOpenIn(this.horaires(), day, slot);
  readonly cells = signal<Cell[]>(
    this.s.apiMode() ? [] : generateTimetable({
      classes: this.s.classes(),
      assignments: this.s.assignments(),
      hoursOf: (c, sb) => this.s.coefOf(c, sb),
    }).cells,
  );

  constructor() {
    // Mode serveur : l'emploi du temps vient du serveur
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode()) return;
      if (!me) { this.cells.set([]); return; }
      void this.load();
    });
  }
  async load(): Promise<void> {
    if (!this.s.apiMode() || !this.s.me()) return;
    try {
      const r = await this.api.get<{ cells: ApiCell[]; horaires?: Horaires }>('timetable/');
      if (r.horaires) this.horaires.set(r.horaires);
      const codeOf = new Map(this.s.subjects().map((x) => [this.s.subjectPkOf(x.id) ?? -1, x.id] as [number, string]));
      this.cells.set(r.cells.map((c) => mapCell(c, codeOf)).filter((c): c is Cell => !!c));
    } catch { /* on garde l'état précédent */ }
  }
  /** Place ou remplace un cours sur le serveur ; renvoie les messages de conflit éventuels. */
  async setAsync(cell: Cell): Promise<string | null> {
    const sb = this.s.subjectPkOf(cell.subjectId);
    try {
      const r = await this.api.request<{ warnings?: string[] }>('PUT', 'timetable/', { school_class: Number(cell.classId), day: cell.day, slot: cell.slot, subject: sb, room: cell.room });
      this.warnings.set(r?.warnings ?? []);
      await this.load(); return null;
    } catch (e) { return this.s.errorMessage(e); }
  }
  async clearAsync(classId: string, day: number, slot: number): Promise<string | null> {
    try { await this.api.request('DELETE', `timetable/?class=${classId}&day=${day}&slot=${slot}`); await this.load(); return null; }
    catch (e) { return this.s.errorMessage(e); }
  }
  /** Enregistre les horaires de l'école. Si des cours tomberaient sur des créneaux supprimés, le serveur le dit : `invalides` donne leur nombre. */
  async saveHorairesAsync(h: Horaires, retirer = false): Promise<{ ok: boolean; error?: string; invalides?: number }> {
    if (!this.s.apiMode()) { this.horaires.set(h); return { ok: true }; }
    try {
      await this.api.request('PUT', 'timetable/horaires/', { ...h, retirer });
      await this.load();
      return { ok: true };
    } catch (e) {
      const n = Number((e instanceof ApiError ? e.errors?.['invalides'] : 0) ?? 0);
      return { ok: false, error: this.s.errorMessage(e), invalides: n || undefined };
    }
  }
  async generateAsync(): Promise<{ cells: number; unplaced: number; blocked_by?: { name: string; missing: number }[] } | string> {
    try { const r = await this.api.post<{ cells: number; unplaced: number; blocked_by?: { name: string; missing: number }[] }>('timetable/generate/'); await this.load(); return r; }
    catch (e) { return this.s.errorMessage(e); }
  }

  private readonly byClassMap = computed(() => new Map(this.cells().map((c) => [`${c.classId}|${c.day}|${c.slot}`, c])));
  private readonly byTeacherMap = computed(() => {
    const m = new Map<string, Cell[]>();
    for (const c of this.cells()) {
      const t = this.s.teacherOf(c.classId, c.subjectId)?.id;
      if (!t) continue;
      const k = `${t}|${c.day}|${c.slot}`;
      const a = m.get(k);
      if (a) a.push(c); else m.set(k, [c]);
    }
    return m;
  });
  private readonly byRoomMap = computed(() => {
    const m = new Map<string, Cell[]>();
    for (const c of this.cells()) {
      const k = `${c.room}|${c.day}|${c.slot}`;
      const a = m.get(k);
      if (a) a.push(c); else m.set(k, [c]);
    }
    return m;
  });
  /** Charge hebdomadaire (heures) de chaque enseignant. */
  readonly hoursByTeacher = computed(() => {
    const m = new Map<string, number>();
    for (const c of this.cells()) {
      const t = this.s.teacherOf(c.classId, c.subjectId)?.id;
      if (t) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  });

  cellAt(classId: string, day: number, slot: number): Cell | undefined {
    return this.byClassMap().get(`${classId}|${day}|${slot}`);
  }
  teacherCellAt(teacherId: string, day: number, slot: number): Cell | undefined {
    return this.byTeacherMap().get(`${teacherId}|${day}|${slot}`)?.[0];
  }
  classHours(classId: string): number {
    return this.cells().filter((c) => c.classId === classId).length;
  }
  classTeachers(classId: string): number {
    return new Set(this.cells().filter((c) => c.classId === classId).map((c) => this.s.teacherOf(c.classId, c.subjectId)?.id)).size;
  }
  /** Classes différentes d'un enseignant dans la semaine. */
  teacherClasses(teacherId: string): number {
    return new Set(this.cells().filter((c) => this.s.teacherOf(c.classId, c.subjectId)?.id === teacherId).map((c) => c.classId)).size;
  }

  /** Messages d'erreur si le créneau proposé crée un conflit (enseignant occupé, salle prise). */
  conflicts(d: Cell): string[] {
    const out: string[] = [];
    const t = this.s.teacherOf(d.classId, d.subjectId);
    if (!t) out.push('Aucun enseignant n’est affecté à cette matière dans cette classe.');
    else {
      const other = (this.byTeacherMap().get(`${t.id}|${d.day}|${d.slot}`) ?? []).find((c) => c.classId !== d.classId);
      if (other) out.push(`${t.name} est déjà en cours avec la ${this.s.className(other.classId)} à ce créneau.`);
    }
    const r = (this.byRoomMap().get(`${d.room}|${d.day}|${d.slot}`) ?? []).find((c) => c.classId !== d.classId);
    if (r) out.push(`${d.room} est déjà occupée par la ${this.s.className(r.classId)} à ce créneau.`);
    return out;
  }

  set(cell: Cell): void {
    this.cells.update((cs) => [...cs.filter((c) => !(c.classId === cell.classId && c.day === cell.day && c.slot === cell.slot)), cell]);
  }
  clear(classId: string, day: number, slot: number): void {
    this.cells.update((cs) => cs.filter((c) => !(c.classId === classId && c.day === day && c.slot === slot)));
  }

  /** Prochaine date (après `after`) où la classe a cours dans cette matière. */
  nextSession(classId: string, subjectId: string, after: string): string | null {
    const days = new Set(this.cells().filter((c) => c.classId === classId && c.subjectId === subjectId).map((c) => c.day));
    if (!days.size) return null;
    for (let i = 1; i <= 14; i++) {
      const d = addDays(after, i);
      if (days.has(dayIndex(d))) return d;
    }
    return null;
  }
  /** La classe a-t-elle cours dans cette matière ce jour de la semaine ? */
  hasSessionOn(classId: string, subjectId: string, date: string): boolean {
    const d = dayIndex(date);
    return this.cells().some((c) => c.classId === classId && c.subjectId === subjectId && c.day === d);
  }
}
