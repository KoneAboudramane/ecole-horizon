import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, FitHeight } from '../ui';
import { PlanMiss, PlanRow, Planning, RepartitionSubject, TeacherLoad } from '../modules/planning';

/** Plusieurs enseignants pour une même matière (ex. trois professeurs de maths) : on les répartit entre les classes, charge équilibrée. */
@Component({
  selector: 'app-repartition',
  imports: [FitHeight, FormsModule, Icon],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Répartition des enseignants</h1>
      <p>Quand plusieurs enseignants donnent la même matière, répartissez-les entre les classes. L’emploi du temps de chaque enseignant se déduit ensuite de celui des classes.</p></div>
      <button type="button" class="btn primary" [disabled]="busy()" (click)="propose(null)">Proposer pour toutes les matières</button></div>

    @if (loadErr()) { <div class="banner bad" role="alert"><app-icon name="alert" [size]="18" /> {{ loadErr() }}</div> }

    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Enseignants</span><span class="value">{{ teachers().length }}</span></div>
      <div class="card kpi-card" [class.alert]="orphans() > 0"><span class="label">Classes sans enseignant</span><span class="value">{{ orphans() }}</span><span class="hint">Matières à pourvoir dans une classe</span></div>
      <div class="card kpi-card" [class.alert]="over().length > 0"><span class="label">Enseignants au-dessus de leur maximum</span><span class="value">{{ over().length }}</span></div>
    </div>

    @if (plan(); as pl) {
      <div class="card pad stack" role="region" aria-label="Proposition de répartition">
        <div class="row"><h2 class="grow">Proposition</h2><span class="small muted">{{ pl.rows.length }} affectation(s)</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th>Classe</th><th>Enseignant proposé</th><th class="num">Heures</th></tr></thead><tbody>
          @for (r of pl.rows; track r.classId + r.subjectCode) {
            <tr><td>{{ subjectName(r.subjectCode) }}</td><td>{{ s.className(r.classId) }}</td><td class="cell-main">{{ teacherName(r.teacherId) }}</td><td class="num">{{ r.hours }} h</td></tr>
          } @empty { <tr><td colspan="4" class="empty">Rien à répartir : toutes les classes ont déjà un enseignant.</td></tr> }</tbody></table></div>
        @if (pl.missing.length) {
          <div class="banner warn" role="status"><app-icon name="alert" [size]="18" />
            <div>Sans enseignant possible :
              <ul class="miss">@for (m of pl.missing; track m.classId + m.subjectCode) { <li>{{ subjectName(m.subjectCode) }} · {{ s.className(m.classId) }} — {{ m.why === 'max_heures' ? 'maximum d’heures atteint pour les enseignants de cette matière' : 'aucun enseignant ne donne cette matière' }}</li> }</ul></div></div>
        }
        <label class="check"><input type="checkbox" [ngModel]="reset()" (ngModelChange)="reset.set($event); refresh()" name="rs" /> Tout refaire : remplacer les affectations existantes de ces matières</label>
        <div class="row" style="gap:8px"><button type="button" class="btn ghost" (click)="plan.set(null)">Annuler</button>
          <button type="button" class="btn primary" [disabled]="busy() || !pl.rows.length" (click)="apply()">Appliquer cette répartition</button></div>
      </div>
    }

    <div class="card" appFitHeight>
      <div class="card-head"><h2>Charge des enseignants</h2><span class="small muted">Heures de cours par semaine, d’après les affectations</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Enseignant</th><th>Matières</th><th class="num">Classes</th><th class="num">Heures</th><th>Maximum d’heures</th><th style="min-width:120px">Charge</th></tr></thead><tbody>
        @for (t of teachers(); track t.id) {
          <tr><td class="cell-main">{{ t.name }}</td><td>{{ subjectsOf(t) }}</td><td class="num">{{ t.classes }}</td>
            <td class="num" [class.bad-text]="t.maxHours != null && t.hours > t.maxHours">{{ t.hours }} h</td>
            <td><input class="inline-input num-in" type="number" min="1" max="60" [ngModel]="t.maxHours ?? ''" (change)="setMax(t, $any($event.target).value)" [attr.aria-label]="'Maximum d’heures de ' + t.name" placeholder="Libre" /></td>
            <td><div class="meter" [class.accent]="t.maxHours != null && t.hours > t.maxHours" role="img" [attr.aria-label]="t.hours + ' heures'"><span [style.width.%]="meter(t)"></span></div></td></tr>
        } @empty { <tr><td colspan="6" class="empty">Aucun enseignant. Créez les comptes dans « Comptes ».</td></tr> }</tbody></table></div>
    </div>

    @for (sb of subjects(); track sb.id) {
      <div class="card">
        <div class="card-head"><h2>{{ sb.name }}</h2>
          <span class="small muted grow">{{ sb.teachers }} enseignant(s) · {{ unfilled(sb) }} classe(s) sans enseignant</span>
          <button type="button" class="btn sm" [disabled]="busy() || sb.teachers === 0" (click)="propose(sb)">Répartir</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Classe</th><th class="num">Heures</th><th>Enseignant</th></tr></thead><tbody>
          @for (c of sb.classes; track c.id) {
            <tr><td class="cell-main">{{ c.name }}</td><td class="num">{{ c.hours }} h</td>
              <td><select [ngModel]="c.teacherId" (ngModelChange)="assign(sb, c.id, $event)" [attr.aria-label]="sb.name + ', ' + c.name">
                <option value="">Non affecté</option>
                @for (t of teachersOf(sb); track t.id) { <option [value]="t.id">{{ t.name }}</option> }</select></td></tr>
          }</tbody></table></div>
      </div>
    }
  </div>`,
  styles: `ul.miss { margin: 4px 0 0; padding-inline-start: 18px; } .num-in { width: 84px; } .bad-text { color: var(--danger, #b3261e); font-weight: 700; }
    .check { display: flex; gap: 8px; align-items: center; font-size: 14px; }`,
})
export class RepartitionPage {
  readonly s = inject(Store);
  readonly p = inject(Planning);
  readonly teachers = signal<TeacherLoad[]>([]);
  readonly subjects = signal<RepartitionSubject[]>([]);
  readonly loadErr = signal('');
  readonly busy = signal(false);
  readonly plan = signal<{ rows: PlanRow[]; missing: PlanMiss[]; committed: boolean } | null>(null);
  readonly reset = signal(false);
  private scope: RepartitionSubject | null = null;

  readonly orphans = computed(() => this.subjects().reduce((n, sb) => n + this.unfilled(sb), 0));
  readonly over = computed(() => this.teachers().filter((t) => t.maxHours != null && t.hours > t.maxHours));

  constructor() { void this.load(); }

  async load(): Promise<void> {
    const r = await this.p.repartition();
    if (typeof r === 'string') { this.loadErr.set(r); return; }
    this.loadErr.set(''); this.teachers.set(r.teachers); this.subjects.set(r.subjects);
  }
  unfilled(sb: RepartitionSubject): number { return sb.classes.filter((c) => !c.teacherId).length; }
  teachersOf(sb: RepartitionSubject): TeacherLoad[] { return this.teachers().filter((t) => t.subjectIds.includes(sb.code)); }
  subjectsOf(t: TeacherLoad): string { return t.subjectIds.map((c) => this.s.subjectById().get(c)?.name ?? c).join(', ') || '—'; }
  subjectName(code: string): string { return this.s.subjectById().get(code)?.name ?? code; }
  teacherName(id: string): string { return this.teachers().find((t) => t.id === id)?.name ?? ''; }
  meter(t: TeacherLoad): number { return Math.min(100, (t.hours / Math.max(t.maxHours ?? 28, 1)) * 100); }

  async propose(sb: RepartitionSubject | null): Promise<void> {
    this.scope = sb; this.reset.set(false);
    await this.refresh();
  }
  async refresh(): Promise<void> {
    this.busy.set(true);
    const r = await this.p.plan(this.scope ? [this.scope.code] : this.subjects().map((x) => x.code), { reset: this.reset() });
    this.busy.set(false);
    if (typeof r === 'string') { this.s.toast(r, 'err'); return; }
    this.plan.set(r);
  }
  async apply(): Promise<void> {
    this.busy.set(true);
    const r = await this.p.plan(this.scope ? [this.scope.code] : this.subjects().map((x) => x.code), { reset: this.reset(), commit: true });
    this.busy.set(false);
    if (typeof r === 'string') { this.s.toast(r, 'err'); return; }
    this.plan.set(null);
    this.s.toast(`${r.rows.length} affectation(s) enregistrée(s).`);
    await this.load();
  }
  async assign(sb: RepartitionSubject, classId: string, teacherId: string): Promise<void> {
    if (await this.s.setAssignmentAsync(classId, sb.code, teacherId)) await this.load();
  }
  async setMax(t: TeacherLoad, raw: string): Promise<void> {
    const v = raw.trim() === '' ? null : Number(raw);
    if (v !== null && (!Number.isFinite(v) || v < 1 || v > 60)) { this.s.toast('Indiquez un nombre d’heures entre 1 et 60, ou laissez vide.', 'err'); return; }
    const e = await this.p.setMaxHours(t.id, v);
    if (e) this.s.toast(e, 'err'); else await this.load();
  }
}
