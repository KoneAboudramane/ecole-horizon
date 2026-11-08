import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { Api } from '../api';
import { Store } from '../store';
import { Timetable, slotsOpenOf } from './timetable';
import { dateFr } from '../format';

/** Indisponibilités d'un enseignant : « jour-créneau » → `x` indisponible, `p` plutôt pas ; un créneau absent est disponible. */
export type DispoGrid = Record<string, 'x' | 'p'>;
export interface DispoRow { id: string; name: string; grid: DispoGrid; updated: string | null; hours: number; open: number; available: number; avoid: number; required: number; }
export interface DispoState { limite: string | null; ratio: number; closed: boolean; teachers: DispoRow[]; }

interface ApiDispoRow extends Omit<DispoRow, 'id'> { id: number; }

/** Disponibilités des enseignants, saisies avant l'emploi du temps (valables toute l'année). */
@Injectable({ providedIn: 'root' })
export class Dispo {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  private readonly tt = inject(Timetable);

  /** Mode démonstration : grilles et réglages gardés en mémoire. */
  private readonly demoGrids = signal<Record<string, { grid: DispoGrid; updated: string }>>({});
  private readonly demoCfg = signal<{ limite: string | null; ratio: number }>({ limite: null, ratio: 1.5 });
  private readonly remote = signal<DispoState | null>(null);

  readonly state: Signal<DispoState> = computed(() => (this.s.apiMode() ? this.remote() ?? { limite: null, ratio: 1.5, closed: false, teachers: [] } : this.demoState()));
  readonly byId: Signal<Map<string, DispoRow>> = computed(() => new Map(this.state().teachers.map((t) => [t.id, t])));

  constructor() {
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode()) return;
      if (!me) { this.remote.set(null); return; }
      void this.load();
    });
  }

  /** Créneaux ouverts dans les horaires de l'école (« jour-créneau »). */
  readonly openKeys: Signal<string[]> = computed(() => {
    const h = this.tt.horaires();
    return [0, 1, 2, 3, 4, 5, 6].flatMap((d) => Array.from({ length: slotsOpenOf(h, d) }, (_, sl) => `${d}-${sl}`));
  });

  /** Heures de cours par semaine de chaque enseignant, comptées comme le générateur. */
  private readonly hours: Signal<Map<string, number>> = computed(() => {
    const m = new Map<string, number>();
    for (const a of this.s.assignments()) m.set(a.teacherId, (m.get(a.teacherId) ?? 0) + Math.min(5, a.subjectId === 'eps' ? 2 : this.s.coefOf(a.classId, a.subjectId)));
    return m;
  });

  /** Ligne de synthèse d'une grille : créneaux disponibles, « plutôt pas », minimum exigé. */
  row(id: string, name: string, grid: DispoGrid, updated: string | null, ratio = this.state().ratio, hours = this.hoursOf(id)): DispoRow {
    const keys = new Set(this.openKeys());
    const g: DispoGrid = Object.fromEntries(Object.entries(grid).filter(([k]) => keys.has(k)));
    const vals = Object.values(g);
    return { id, name, grid: g, updated, hours, open: keys.size, available: keys.size - vals.filter((v) => v === 'x').length,
      avoid: vals.filter((v) => v === 'p').length, required: ratio ? Math.min(keys.size, Math.ceil(hours * ratio)) : 0 };
  }
  hoursOf(id: string): number { return this.byId().get(id)?.hours ?? this.hours().get(id) ?? 0; }

  private readonly demoState: Signal<DispoState> = computed(() => {
    const cfg = this.demoCfg(), g = this.demoGrids(), me = this.s.myTeacher();
    const list = this.s.role() === 'enseignant' ? (me ? [me] : []) : this.s.can('edt.write') ? this.s.teachers() : [];
    return { ...cfg, closed: !!cfg.limite && this.s.today > cfg.limite,
      teachers: list.map((t) => this.row(t.id, t.name, g[t.id]?.grid ?? {}, g[t.id]?.updated ?? null, cfg.ratio, this.hours().get(t.id) ?? 0)) };
  });

  async load(): Promise<void> {
    if (!this.s.apiMode() || !this.s.me()) return;
    try {
      const r = await this.api.get<Omit<DispoState, 'teachers'> & { teachers: ApiDispoRow[] }>('timetable/dispo/');
      this.remote.set({ ...r, teachers: r.teachers.map((t) => ({ ...t, id: String(t.id) })) });
    } catch { /* l'enseignant sans fiche ou un rôle sans accès : rien à afficher */ }
  }

  /** Enregistre la grille d'un enseignant. Renvoie l'erreur éventuelle, ou l'avertissement du serveur (minimum non atteint). */
  async saveAsync(teacherId: string, grid: DispoGrid): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const staff = this.s.can('edt.write');
    const st = this.state();
    if (!this.s.apiMode()) {
      if (!staff && st.closed) return { ok: false, error: `La saisie des disponibilités est close depuis le ${dateFr(st.limite ?? '')}. Adressez-vous à la direction.` };
      const t = this.s.teachers().find((x) => x.id === teacherId);
      if (!t) return { ok: false, error: 'Enseignant introuvable.' };
      const r = this.row(teacherId, t.name, grid, null);
      if (!staff && r.available < r.required) return { ok: false, error: `Gardez au moins ${r.required} créneaux disponibles pour vos ${r.hours} h de cours (vous en laissez ${r.available}).` };
      this.demoGrids.update((g) => ({ ...g, [teacherId]: { grid: r.grid, updated: new Date().toISOString() } }));
      if (t.userId !== this.s.me()?.id) this.s.notify([t.userId], 'La direction a mis à jour vos disponibilités pour l’emploi du temps.', 'systeme', 'edt');
      this.s.addLog('Disponibilités', `${t.name} : ${Object.values(r.grid).filter((v) => v === 'x').length} créneau(x) indisponible(s)`);
      return { ok: true, warning: r.available < r.required ? `${t.name} ne laisse que ${r.available} créneaux disponibles pour ${r.hours} h de cours.` : '' };
    }
    try {
      const r = await this.api.request<{ warning?: string }>('PUT', `timetable/dispo/${teacherId}/`, { grid });
      await this.load();
      return { ok: true, warning: r?.warning ?? '' };
    } catch (e) { return { ok: false, error: this.s.errorMessage(e) }; }
  }

  async saveSettingsAsync(limite: string | null, ratio: number): Promise<string | null> {
    if (!this.s.apiMode()) { this.demoCfg.set({ limite, ratio }); return null; }
    try { await this.api.request('PUT', 'timetable/dispo/', { limite, ratio }); await this.load(); return null; }
    catch (e) { return this.s.errorMessage(e); }
  }

  /** Rappel aux enseignants qui n'ont pas encore rempli leurs disponibilités ; renvoie le nombre de destinataires. */
  async remindAsync(): Promise<number | string> {
    if (!this.s.apiMode()) {
      const late = this.state().teachers.filter((t) => !t.updated);
      const lim = this.state().limite;
      this.s.notify(late.map((t) => this.s.teachers().find((x) => x.id === t.id)?.userId ?? '').filter(Boolean),
        `Indiquez vos disponibilités pour l’emploi du temps${lim ? ` avant le ${dateFr(lim)}` : ''} : page Emploi du temps, « Mes disponibilités ».`, 'systeme', 'edt');
      return late.length;
    }
    try { return (await this.api.post<{ sent: number }>('timetable/dispo/remind/')).sent; }
    catch (e) { return this.s.errorMessage(e); }
  }

  /** État d'un créneau pour un enseignant (`x`, `p` ou chaîne vide). */
  at(teacherId: string | undefined, day: number, slot: number): '' | 'x' | 'p' {
    return (teacherId && this.byId().get(teacherId)?.grid[`${day}-${slot}`]) || '';
  }
}
