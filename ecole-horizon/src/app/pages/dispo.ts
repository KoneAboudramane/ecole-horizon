import { Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal } from '../ui';
import { DAYS, DAYS_SHORT, Timetable } from '../modules/timetable';
import { Dispo, DispoGrid, DispoRow } from '../modules/dispo';
import { dateFr } from '../format';

const LABEL: Record<string, string> = { '': 'Disponible', p: 'Plutôt pas', x: 'Indisponible' };

/** Grille semaine × créneaux : un clic fait passer un créneau de disponible à « plutôt pas », puis à indisponible. */
@Component({
  selector: 'app-dispo-grid',
  imports: [],
  template: `
  <div class="legend small"><span class="k"></span> Disponible <span class="k p"></span> Plutôt pas <span class="k x"></span> Indisponible</div>
  <div class="table-wrap"><table class="dg">
    <thead><tr><th class="h"><span class="sr">Horaire</span></th>@for (d of tt.openDays(); track d) { <th scope="col"><button type="button" class="day" [disabled]="disabled()" (click)="toggleDay(d)" [attr.aria-label]="'Changer toute la journée : ' + days[d]">{{ short[d] }}</button></th> }</tr></thead>
    <tbody>
      @for (sl of tt.slots(); track $index; let si = $index) {
        <tr><th scope="row" class="h nowrap">{{ sl.start }}</th>
          @for (d of tt.openDays(); track d) {
            <td>@if (tt.isOpen(d, si)) {
              @let v = at(d, si);
              <button type="button" class="c" [class.p]="v === 'p'" [class.x]="v === 'x'" [disabled]="disabled()" (click)="cycle(d, si)"
                [attr.aria-label]="days[d] + ' ' + sl.start + ' : ' + label[v]" [attr.aria-pressed]="v !== ''">{{ v === 'x' ? '✕' : v === 'p' ? '~' : '' }}</button>
            } @else { <span class="c off" aria-hidden="true"></span> }</td>
          }
        </tr>
      }
    </tbody></table></div>`,
  styles: `
    .legend { display: flex; gap: 6px 10px; align-items: center; flex-wrap: wrap; color: var(--muted); margin-bottom: 8px; }
    .k { display: inline-block; width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--line); background: var(--surface); }
    .k.p, .c.p { background: var(--warn-tint); color: var(--warn); }
    .k.x, .c.x { background: var(--bad-tint); color: var(--bad); }
    .dg { border-collapse: separate; border-spacing: 3px; }
    .dg th { font-size: 12px; color: var(--muted); font-weight: 600; }
    .dg .h { text-align: start; padding-inline-end: 6px; }
    .day { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
    .day:hover:not(:disabled) { background: var(--surface-2); }
    .c { display: block; width: 44px; height: 30px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-weight: 700; cursor: pointer; }
    .c:hover:not(:disabled) { outline: 2px solid var(--brand); outline-offset: -2px; }
    .c:disabled { cursor: default; opacity: 0.8; }
    .c.off { background: var(--surface-2); border-color: transparent; opacity: 0.5; cursor: default; }
    @media (max-width: 720px) { .c { width: 36px; } }
  `,
})
export class DispoGridEditor {
  readonly tt = inject(Timetable);
  readonly value = model<DispoGrid>({});
  readonly disabled = input(false);
  readonly days = DAYS; readonly short = DAYS_SHORT; readonly label = LABEL;

  at(d: number, sl: number): '' | 'x' | 'p' { return this.value()[`${d}-${sl}`] ?? ''; }
  cycle(d: number, sl: number): void {
    const k = `${d}-${sl}`, cur = this.value()[k];
    const next = !cur ? 'p' : cur === 'p' ? 'x' : undefined;
    const g = { ...this.value() };
    if (next) g[k] = next; else delete g[k];
    this.value.set(g);
  }
  /** Toute la journée : indisponible si elle ne l'est pas déjà entièrement, sinon de nouveau disponible. */
  toggleDay(d: number): void {
    const keys = this.tt.slots().map((_, sl) => sl).filter((sl) => this.tt.isOpen(d, sl)).map((sl) => `${d}-${sl}`);
    const all = keys.every((k) => this.value()[k] === 'x');
    const g = { ...this.value() };
    for (const k of keys) { if (all) delete g[k]; else g[k] = 'x'; }
    this.value.set(g);
  }
}

/** Disponibilités sur la page Emploi du temps : la grille de l'enseignant, ou le suivi de la direction. */
@Component({
  selector: 'app-dispo-card',
  imports: [DispoGridEditor, FormsModule, Icon, Modal],
  template: `
  @if (mine(); as me) {
    <div class="card pad stack">
      <div class="card-head flat"><h2>Mes disponibilités</h2>
        <span class="small muted grow">Valables toute l’année. Indiquez les créneaux où vous ne pouvez pas venir : la direction en tient compte pour faire l’emploi du temps.</span></div>
      @if (st().closed) { <div class="banner warn" role="status"><app-icon name="lock" [size]="18" /> La saisie est close depuis le {{ dateFr(st().limite!) }}. Pour un changement, adressez-vous à la direction.</div> }
      @else if (st().limite) { <div class="banner info" role="status"><app-icon name="calendar" [size]="18" /> À remplir avant le {{ dateFr(st().limite!) }}.</div> }
      <app-dispo-grid [(value)]="grid" [disabled]="st().closed" />
      @let r = draftRow();
      <p class="small" [class.bad]="r.available < r.required">{{ r.available }} créneau(x) disponible(s) sur {{ r.open }}@if (r.required) { · minimum demandé : {{ r.required }} pour vos {{ r.hours }} h de cours }.
        @if (me.updated) { <span class="muted">Dernier enregistrement : {{ dateFr(me.updated.slice(0, 10)) }}.</span> } @else { <span class="muted">Pas encore enregistrées.</span> }</p>
      @if (!st().closed) {
        <div class="row"><button type="button" class="btn ghost" (click)="grid.set({})">Tout disponible</button>
          <button type="button" class="btn primary" [disabled]="saving() || r.available < r.required" (click)="saveMine(me)">Enregistrer mes disponibilités</button></div>
      }
    </div>
  }

  @if (staff()) {
    <div class="card">
      <div class="card-head"><h2>Disponibilités des enseignants</h2>
        <span class="small muted grow">{{ filled() }} sur {{ st().teachers.length }} ont rempli. La génération n’utilise jamais un créneau indisponible, et un créneau « plutôt pas » en dernier recours.</span>
        <button type="button" class="btn sm" [disabled]="!late()" (click)="remind()">Relancer ({{ late() }})</button></div>
      <div class="pad row settings">
        <label class="field"><span>Date limite de saisie</span><input type="date" [(ngModel)]="fLimite" name="dl" /></label>
        <label class="field"><span>Créneaux disponibles exigés par heure de cours</span><input type="number" min="0" max="5" step="0.5" [(ngModel)]="fRatio" name="dr" /></label>
        <button type="button" class="btn" (click)="saveSettings()">Enregistrer</button>
        <span class="tiny muted grow">Après la date limite, seule la direction peut modifier. 0 : aucun minimum.</span>
      </div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Enseignant</th><th class="num">Heures</th><th class="num">Disponibles</th><th class="num">Plutôt pas</th><th>Saisie</th><th></th></tr></thead><tbody>
        @for (t of st().teachers; track t.id) {
          <tr><td class="cell-main">{{ t.name }}</td><td class="num">{{ t.hours }} h</td>
            <td class="num" [class.bad]="t.available < t.required">{{ t.available }} / {{ t.open }}@if (t.available < t.required) { <div class="tiny">minimum {{ t.required }}</div> }</td>
            <td class="num">{{ t.avoid }}</td>
            <td>@if (t.updated) { {{ dateFr(t.updated.slice(0, 10)) }} } @else { <span class="pill warn">Non remplie</span> }</td>
            <td><button type="button" class="btn sm" (click)="open(t)">Voir ou modifier</button></td></tr>
        } @empty { <tr><td colspan="6" class="empty">Aucun enseignant.</td></tr> }</tbody></table></div>
    </div>
  }

  @if (editing(); as t) {
    <app-modal [title]="'Disponibilités · ' + t.name" size="wide" (closed)="editing.set(null)">
      <div class="stack">
        <app-dispo-grid [(value)]="grid" />
        @let r = draftRow();
        <p class="small" [class.bad]="r.available < r.required">{{ r.available }} créneau(x) disponible(s) sur {{ r.open }}@if (r.required) { · minimum : {{ r.required }} pour {{ r.hours }} h de cours }.</p>
        <p class="tiny muted">L’enseignant est prévenu de la modification.</p>
      </div>
      <div footer><button type="button" class="btn ghost" (click)="editing.set(null)">Annuler</button>
        <button type="button" class="btn primary" [disabled]="saving()" (click)="saveOther(t)">Enregistrer</button></div>
    </app-modal>
  }`,
  styles: `
    .card-head.flat { padding: 0; border: 0; }
    .settings { align-items: flex-end; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
    .bad { color: var(--bad); }
  `,
})
export class DispoCard {
  readonly s = inject(Store);
  readonly d = inject(Dispo);
  readonly dateFr = dateFr;
  readonly st = this.d.state;
  readonly staff = computed(() => this.s.can('edt.write'));
  readonly mine = computed(() => (this.s.role() === 'enseignant' ? this.st().teachers.find((t) => t.id === this.s.myTeacher()?.id) ?? null : null));
  readonly filled = computed(() => this.st().teachers.filter((t) => t.updated).length);
  readonly late = computed(() => this.st().teachers.length - this.filled());

  readonly grid = signal<DispoGrid>({});
  readonly editing = signal<DispoRow | null>(null);
  readonly saving = signal(false);
  readonly draftRow = computed(() => {
    const t = this.editing() ?? this.mine();
    return this.d.row(t?.id ?? '', t?.name ?? '', this.grid(), null);
  });
  fLimite = '';
  fRatio = 1.5;

  constructor() {
    // La grille de l'enseignant et les réglages de la direction suivent ce que renvoie le serveur
    effect(() => { const me = this.mine(); if (me && !this.editing()) this.grid.set({ ...me.grid }); });
    effect(() => { const st = this.st(); this.fLimite = st.limite ?? ''; this.fRatio = st.ratio; });
  }

  async saveMine(me: DispoRow): Promise<void> {
    this.saving.set(true);
    const r = await this.d.saveAsync(me.id, this.grid());
    this.saving.set(false);
    this.s.toast(r.ok ? 'Disponibilités enregistrées.' : r.error ?? 'Enregistrement impossible.', r.ok ? 'ok' : 'err');
  }
  open(t: DispoRow): void { this.grid.set({ ...t.grid }); this.editing.set(t); }
  async saveOther(t: DispoRow): Promise<void> {
    this.saving.set(true);
    const r = await this.d.saveAsync(t.id, this.grid());
    this.saving.set(false);
    if (!r.ok) { this.s.toast(r.error ?? 'Enregistrement impossible.', 'err'); return; }
    this.editing.set(null);
    this.s.toast(r.warning ? `Disponibilités enregistrées. Attention : ${r.warning}` : 'Disponibilités enregistrées.', r.warning ? 'info' : 'ok');
  }
  async saveSettings(): Promise<void> {
    const ratio = Number(this.fRatio);
    if (!(ratio >= 0 && ratio <= 5)) { this.s.toast('Choisissez un nombre entre 0 et 5.', 'err'); return; }
    const e = await this.d.saveSettingsAsync(this.fLimite || null, ratio);
    this.s.toast(e ?? 'Réglages enregistrés.', e ? 'err' : 'ok');
  }
  async remind(): Promise<void> {
    const n = await this.d.remindAsync();
    this.s.toast(typeof n === 'string' ? n : `Rappel envoyé à ${n} enseignant(s).`, typeof n === 'string' ? 'err' : 'ok');
  }
}
