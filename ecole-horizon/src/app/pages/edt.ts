import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal, FitHeight } from '../ui';
import { DispoCard } from './dispo';
import { Dispo } from '../modules/dispo';
import { Cell, DAYS, DAYS_SHORT, Timetable, dayIndex } from '../modules/timetable';
import { Candidate, Planning } from '../modules/planning';
import { Replacement } from '../api-map';
import { addDays, dateFr } from '../format';

const HUES: Record<string, number> = { fr: 20, ma: 215, an: 280, hg: 40, sv: 130, pc: 190, eps: 5, edhc: 330, ph: 255, lv2: 160, ar: 95 };

interface CellView { open: boolean; cell?: Cell; subject: string; line2: string; room: string; hue: number; }

@Component({
  selector: 'app-edt',
  imports: [DispoCard, FitHeight, FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Emploi du temps</h1>
      <p>{{ intro() }}</p></div>
      @if (s.apiMode() && s.can('edt.write')) { <button class="btn" (click)="regenerate()">Régénérer l’emploi du temps</button> }</div>

    @if (showControls()) {
      <div class="card pad"><div class="row">
        @if (modes()) {
          <div class="field"><span>Affichage</span><div class="chips" role="group" aria-label="Affichage">
            <button type="button" class="chip" [class.on]="mode() === 'classe'" (click)="mode.set('classe')">Par classe</button>
            <button type="button" class="chip" [class.on]="mode() === 'enseignant'" (click)="mode.set('enseignant')">Par enseignant</button></div></div>
        }
        @if (mode() === 'classe') {
          <label class="field"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cidSel.set($event)">@for (c of classChoices(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
        } @else if (s.role() !== 'enseignant') {
          <label class="field"><span>Enseignant</span><select [ngModel]="tid()" (ngModelChange)="tidSel.set($event)">@for (t of s.teachers(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }</select></label>
        }
      </div></div>
    }

    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Heures par semaine</span><span class="value">{{ hours() }} h</span></div>
      @if (mode() === 'classe') {
        <div class="card kpi-card"><span class="label">Matières enseignées</span><span class="value">{{ subjectCount() }}</span></div>
        <div class="card kpi-card"><span class="label">Enseignants</span><span class="value">{{ teacherCount() }}</span></div>
      } @else {
        <div class="card kpi-card"><span class="label">Classes suivies</span><span class="value">{{ classCount() }}</span></div>
        <div class="card kpi-card"><span class="label">Créneaux libres</span><span class="value">{{ freeSlots() }}</span><span class="hint">Sur {{ totalSlots() }} créneaux ouverts par semaine</span></div>
      }
    </div>

    <div class="card">
      <div class="card-head"><h2>{{ title() }}</h2>
        @if (canEdit()) { <span class="small muted">Cliquez sur un créneau pour le modifier.</span> }</div>
      <div class="mob-days only-mobile" role="group" aria-label="Jour affiché">
        <div class="chips" style="padding:12px 14px 0">@for (di of tt.openDays(); track di) { <button type="button" class="chip" [class.on]="mobDay() === di" (click)="mobDay.set(di)">{{ dayShort[di] }}</button> }</div>
      </div>
      <div class="table-wrap"><table class="tt">
        <thead><tr><th class="hcol"><span class="sr">Horaire</span></th>
          @for (di of vdays(); track di) { <th scope="col" [class.today]="di === todayIdx">{{ days[di] }}@if (di === todayIdx) { <span class="tiny today-tag">Aujourd’hui</span> }</th> }</tr></thead>
        <tbody>
          @for (sl of slots(); track $index; let si = $index) {
            @if (breaks()[si]) { <tr class="brk"><td [attr.colspan]="vdays().length + 1">{{ breaks()[si] }}</td></tr> }
            <tr><th scope="row" class="hcol nowrap">{{ sl.start }}<br /><span class="muted">{{ sl.end }}</span></th>
              @for (di of vdays(); track di) {
                @let v = grid()[si][di];
                <td [class.today]="di === todayIdx">
                  @if (!v.open) { <div class="cell closed" aria-hidden="true">—</div> }
                  @else if (canEdit()) {
                    <button type="button" class="cell" [class.empty]="!v.cell" [style.--h]="v.hue" (click)="edit(di, si)" [attr.aria-label]="v.cell ? v.subject + ', ' + days[di] + ' ' + sl.start : 'Créneau libre, ' + days[di] + ' ' + sl.start">
                      @if (v.cell) { <b>{{ v.subject }}</b><span class="l2">{{ v.line2 }}</span><span class="rm">{{ v.room }}</span> } @else { <span class="free"><app-icon name="plus" [size]="14" /></span> }
                    </button>
                  } @else {
                    <div class="cell" [class.empty]="!v.cell" [style.--h]="v.hue">
                      @if (v.cell) { <b>{{ v.subject }}</b><span class="l2">{{ v.line2 }}</span><span class="rm">{{ v.room }}</span> }
                    </div>
                  }
                </td>
              }
            </tr>
          }
        </tbody></table></div>
    </div>

    @if (!kid()) { <app-dispo-card /> }

    @if (s.apiMode() && s.can('edt.write')) {
      <div class="card" appFitHeight>
        <div class="card-head"><h2>Remplacements</h2><span class="small muted grow">Quand un enseignant est absent, un collègue libre tient la classe ; il fait l’appel et remplit le cahier de textes.</span>
          <button type="button" class="btn sm primary" (click)="openRepl()">Organiser un remplacement</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Cours</th><th>Remplaçant</th><th>Enseignant absent</th><th></th></tr></thead><tbody>
          @for (r of repls(); track r.id) {
            <tr><td>{{ dateFr(r.date) }}</td><td class="cell-main">{{ r.className }} · {{ r.subjectName }}<div class="tiny muted">{{ slots()[r.slot]?.start }} à {{ slots()[r.slot]?.end }}</div></td><td>{{ r.teacherName }}</td><td>{{ r.absentName || '—' }}</td>
              <td><button type="button" class="btn sm danger" (click)="cancelRepl(r)" [attr.aria-label]="'Annuler le remplacement du ' + dateFr(r.date)">Annuler</button></td></tr>
          } @empty { <tr><td colspan="5" class="empty">Aucun remplacement prévu dans les 30 prochains jours.</td></tr> }</tbody></table></div>
      </div>
    }

    @if (staffView()) {
      <div class="card" appFitHeight>
        <div class="card-head"><h2>Charge horaire des enseignants</h2><span class="small muted">Heures de cours par semaine</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Enseignant</th><th>Matière</th><th class="num">Classes</th><th class="num">Heures</th><th style="min-width:140px">Charge</th></tr></thead><tbody>
          @for (t of load(); track t.id) {
            <tr><td class="cell-main">{{ t.name }}</td><td>{{ t.subject }}</td><td class="num">{{ t.classes }}</td><td class="num">{{ t.hours }} h</td>
              <td><div class="meter" [class.accent]="t.hours > 28" role="img" [attr.aria-label]="t.hours + ' heures sur ' + totalSlots()"><span [style.width.%]="t.hours / totalSlots() * 100"></span></div></td></tr>
          } @empty { <tr><td colspan="5" class="empty">Aucun enseignant.</td></tr> }</tbody></table></div>
      </div>
    }
  </div>

  @if (replForm(); as f) {
    <app-modal title="Organiser un remplacement" (closed)="replForm.set(null)">
      <div class="stack">
        <label class="field"><span>Date</span><input type="date" [ngModel]="f.date" (ngModelChange)="setReplDate($event)" [min]="s.today" name="rd" /></label>
        <label class="field"><span>Classe</span><select [ngModel]="f.classId" (ngModelChange)="setReplClass($event)" name="rc">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
        <label class="field"><span>Cours à remplacer</span>
          <select [ngModel]="f.slot" (ngModelChange)="setReplSlot($event)" name="rs">
            @for (o of replSlots(); track o.slot) { <option [value]="o.slot">{{ o.label }}</option> }
            @if (!replSlots().length) { <option value="">Aucun cours ce jour-là</option> }</select></label>
        <label class="field"><span>Remplaçant</span>
          <select [ngModel]="f.teacherId" (ngModelChange)="pickTeacher($event)" name="rt">
            <option value="">Choisir…</option>
            @for (c of cands(); track c.id) { <option [value]="c.id" [disabled]="!!c.busy">{{ c.name }}{{ c.same_subject ? ' (même matière)' : '' }}{{ c.busy ? ' — déjà en cours avec ' + c.busy : c.dispo === 'x' ? ' — indisponible' : c.dispo === 'p' ? ' — préfère éviter' : '' }}</option> }</select></label>
        @if (replErr()) { <div class="banner bad" role="alert"><app-icon name="alert" [size]="18" /> {{ replErr() }}</div> }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="replForm.set(null)">Annuler</button><button type="button" class="btn primary" [disabled]="!f.teacherId || f.slot === ''" (click)="saveRepl()">Enregistrer</button></div>
    </app-modal>
  }

  @if (editing(); as e) {
    <app-modal [title]="DAYS[e.day] + ' · ' + slots()[e.slot].start + ' à ' + slots()[e.slot].end" (closed)="editing.set(null)">
      <div class="stack">
        <p class="muted small">{{ s.className(cid()) }}</p>
        <label class="field"><span>Matière</span>
          <select [ngModel]="fSubject()" (ngModelChange)="fSubject.set($event)" name="sb">
            <option value="">Aucun cours (créneau libre)</option>
            @for (sb of subjectsHere(); track sb.id) { <option [value]="sb.id">{{ sb.name }}</option> }
          </select></label>
        @if (fSubject()) {
          <div class="field"><span>Enseignant</span><div class="row card flat pad"><b>{{ teacherName() }}</b></div>
            <span class="tiny muted">L’enseignant est celui affecté à cette matière dans la classe.</span></div>
          <label class="field"><span>Salle</span>
            <select [ngModel]="fRoom()" (ngModelChange)="fRoom.set($event)" name="rm">@for (r of tt.rooms(); track r) { <option [value]="r">{{ roomLabel(r) }}</option> }</select></label>
          @if (dispoWarning(); as w) { <div class="banner warn" role="status"><app-icon name="alert" [size]="18" /> {{ w }}</div> }
          @if (capacityWarning(); as w) { <div class="banner warn" role="status"><app-icon name="alert" [size]="18" /> {{ w }}</div> }
        }
        @for (m of conflicts(); track m) { <div class="banner bad" role="alert"><app-icon name="alert" [size]="18" /> {{ m }}</div> }
      </div>
      <div footer>
        @if (e.had) { <button type="button" class="btn danger" (click)="clearSlot()">Vider le créneau</button> }
        <button type="button" class="btn ghost" (click)="editing.set(null)">Annuler</button>
        <button type="button" class="btn primary" [disabled]="conflicts().length > 0" (click)="save()">Enregistrer</button>
      </div>
    </app-modal>
  }`,
  styles: `
    .tt { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; min-width: 860px; }
    .tt th, .tt td { border-bottom: 1px solid var(--line); border-inline-end: 1px solid var(--line); padding: 4px; vertical-align: top; }
    .tt thead th { background: var(--surface-2); font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 10px 6px; text-align: center; }
    .tt th.today { color: var(--accent-ink); background: var(--accent-tint); }
    .today-tag { display: block; text-transform: none; letter-spacing: 0; font-weight: 600; }
    .tt td.today { background: color-mix(in srgb, var(--accent-tint) 35%, transparent); }
    .tt .hcol { width: 76px; text-align: start; font-size: 12.5px; font-weight: 600; background: var(--surface-2); padding: 8px 8px; }
    .tt th.hcol { text-transform: none; letter-spacing: 0; color: var(--ink); }
    .tt .brk td { background: var(--surface-2); color: var(--muted); font-size: 12px; text-align: center; padding: 4px; font-style: italic; }
    .cell { display: flex; flex-direction: column; gap: 1px; width: 100%; min-height: 66px; padding: 6px 8px; text-align: start; border-radius: 8px; border: 0; font-size: 12.5px; line-height: 1.3;
      border-inline-start: 3px solid hsl(var(--h, 155) 50% 42%); background: color-mix(in srgb, hsl(var(--h, 155) 60% 50%) 14%, var(--surface)); color: var(--ink); }
    button.cell { cursor: pointer; }
    button.cell:hover { outline: 2px solid var(--brand); outline-offset: -2px; }
    .cell b { font-size: 13px; }
    .cell .l2 { color: var(--muted); }
    .cell .rm { color: var(--muted); font-size: 11.5px; margin-top: auto; }
    .cell.empty { background: transparent; border-inline-start-color: transparent; }
    .cell.empty .free { margin: auto; color: var(--muted); opacity: 0.55; }
    .cell.closed { background: var(--surface-2); border-inline-start-color: transparent; align-items: center; justify-content: center; color: var(--muted); opacity: 0.6; }
    .only-mobile { display: none; }
    @media (max-width: 720px) {
      .only-mobile { display: block; }
      .tt { min-width: 0; }
      .tt .hcol { width: 64px; }
      .cell { min-height: 58px; }
    }
  `,
})
export class EdtPage {
  readonly s = inject(Store);
  readonly tt = inject(Timetable);
  readonly DAYS = DAYS; readonly days = DAYS; readonly dayShort = DAYS_SHORT; readonly slots = this.tt.slots; readonly breaks = this.tt.breaks;
  readonly todayIdx = dayIndex(this.s.today);

  constructor() {
    void this.loadRepl();
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(max-width: 720px)');
      const on = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
      mq.addEventListener('change', on);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', on));
    }
  }

  readonly plan = inject(Planning);
  readonly dateFr = dateFr;
  readonly role = this.s.role;
  readonly kid = computed(() => (this.role() === 'parent' || this.role() === 'eleve' ? this.s.activeChild() : null));
  readonly classChoices = computed(() => this.s.scopeClasses());
  readonly modes = computed(() => this.role() !== 'parent' && this.role() !== 'eleve');
  readonly showControls = computed(() => !this.kid());
  readonly mode = signal<'classe' | 'enseignant'>(this.role() === 'enseignant' ? 'enseignant' : 'classe');
  readonly mobDay = signal(this.todayIdx >= 0 && this.tt.openDays().includes(this.todayIdx) ? this.todayIdx : (this.tt.openDays()[0] ?? 0));
  readonly narrow = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches);
  readonly vdays = computed(() => (this.narrow() ? [this.mobDay()] : this.tt.openDays()));
  readonly cidSel = signal(this.s.scopeClasses()[0]?.id ?? '');
  readonly tidSel = signal(this.s.teachers()[0]?.id ?? '');
  readonly cid = computed(() => this.kid()?.classId ?? this.cidSel());
  readonly tid = computed(() => this.s.myTeacher()?.id ?? this.tidSel());

  readonly intro = computed(() => {
    const r = this.role();
    if (r === 'parent' || r === 'eleve') return 'Les cours de la semaine pour la classe de votre enfant.';
    if (r === 'enseignant') return 'Vos cours de la semaine, ou l’emploi du temps de l’une de vos classes.';
    return this.s.can('edt.write') ? 'Consultez et modifiez l’emploi du temps. Les conflits d’enseignant et de salle sont détectés automatiquement.' : 'Emploi du temps hebdomadaire par classe ou par enseignant.';
  });
  readonly canEdit = computed(() => this.s.can('edt.write') && this.mode() === 'classe' && !this.kid());
  readonly staffView = computed(() => !this.kid() && this.role() !== 'enseignant');

  readonly teacher = computed(() => this.s.teacherById().get(this.tid()));
  readonly title = computed(() => {
    if (this.kid()) return `${this.s.className(this.kid()!.classId)} · ${this.kid()!.prenoms}`;
    return this.mode() === 'classe' ? this.s.className(this.cid()) : (this.teacher()?.name ?? '');
  });

  readonly grid = computed<CellView[][]>(() => {
    const mode = this.mode();
    const cid = this.cid();
    const t = this.teacher();
    return this.tt.slots().map((_, si) => DAYS.map((__, di) => {
      const open = this.tt.isOpen(di, si);
      const cell = !open ? undefined : mode === 'classe' || this.kid() ? this.tt.cellAt(cid, di, si) : t ? this.tt.teacherCellAt(t.id, di, si) : undefined;
      if (!cell) return { open, subject: '', line2: '', room: '', hue: 155 };
      const subject = this.s.subjectById().get(cell.subjectId)?.name ?? '';
      const line2 = mode === 'classe' || this.kid() ? this.s.teacherOf(cell.classId, cell.subjectId)?.name ?? '' : this.s.className(cell.classId);
      return { open, cell, subject, line2, room: cell.room, hue: HUES[cell.subjectId] ?? 155 };
    }));
  });

  readonly hours = computed(() => (this.mode() === 'classe' || this.kid() ? this.tt.classHours(this.cid()) : (this.tt.hoursByTeacher().get(this.tid()) ?? 0)));
  readonly subjectCount = computed(() => new Set(this.tt.cells().filter((c) => c.classId === this.cid()).map((c) => c.subjectId)).size);
  readonly teacherCount = computed(() => this.tt.classTeachers(this.cid()));
  readonly classCount = computed(() => this.tt.teacherClasses(this.tid()));
  readonly freeSlots = computed(() => this.tt.totalSlots() - this.hours());
  readonly totalSlots = this.tt.totalSlots;
  readonly load = computed(() => this.s.teachers().map((t) => ({
    id: t.id, name: t.name, subject: t.subjectIds.map((x) => this.s.subjectById().get(x)?.name).join(', '),
    hours: this.tt.hoursByTeacher().get(t.id) ?? 0, classes: this.tt.teacherClasses(t.id),
  })).sort((a, b) => b.hours - a.hours));

  async regenerate(): Promise<void> {
    const r = await this.tt.generateAsync();
    if (typeof r === 'string') { this.s.toast(r, 'err'); return; }
    const who = (r.blocked_by ?? []).map((x) => `${x.name} (${x.missing} h)`).join(', ');
    this.s.toast(`Emploi du temps régénéré : ${r.cells} heures${r.unplaced ? `, ${r.unplaced} non placée(s)` : ''}.${who ? ` Heures bloquées par les indisponibilités de : ${who}.` : ''}`, 'info');
  }

  // --- Édition d'un créneau ---
  readonly editing = signal<{ day: number; slot: number; had: boolean } | null>(null);
  readonly fSubject = signal('');
  readonly fRoom = signal('');
  readonly subjectsHere = computed(() => this.s.subjectsOfClass(this.cid()));
  readonly teacherName = computed(() => this.s.teacherOf(this.cid(), this.fSubject())?.name ?? 'Non affecté');
  readonly conflicts = computed(() => {
    const e = this.editing();
    if (!e || !this.fSubject()) return [];
    return this.tt.conflicts({ classId: this.cid(), day: e.day, slot: e.slot, subjectId: this.fSubject(), room: this.fRoom() });
  });

  /** Nom de la salle avec ses places quand l'école a enregistré ses salles. */
  roomLabel(name: string): string {
    const r = this.plan.roomByName().get(name);
    return r ? `${name} (${r.capacity} places)` : name;
  }
  /** Salle principale de la classe (si l'école en a défini une). */
  homeRoom(classId: string): string {
    const id = this.s.classes().find((c) => c.id === classId)?.roomId;
    return (id && this.plan.rooms().find((r) => r.id === id)?.name) || '';
  }
  readonly dispo = inject(Dispo);
  /** L'enseignant de la matière s'est déclaré indisponible (ou préfère éviter) ce créneau : averti, pas bloqué. */
  readonly dispoWarning = computed(() => {
    const e = this.editing(), t = this.s.teacherOf(this.cid(), this.fSubject());
    const v = e && t ? this.dispo.at(t.id, e.day, e.slot) : '';
    return v === 'x' ? `${t!.name} s’est déclaré indisponible à ce créneau.` : v === 'p' ? `${t!.name} préfère ne pas avoir cours à ce créneau.` : '';
  });
  readonly capacityWarning = computed(() => {
    const r = this.plan.roomByName().get(this.fRoom());
    const n = this.s.students().filter((x) => x.classId === this.cid() && x.active !== false).length;
    return r && this.fSubject() && n > r.capacity ? `${r.name} a ${r.capacity} places pour ${n} élèves en ${this.s.className(this.cid())}.` : '';
  });

  edit(day: number, slot: number): void {
    const cur = this.tt.cellAt(this.cid(), day, slot);
    this.fSubject.set(cur?.subjectId ?? '');
    const mine = this.tt.cells().find((c) => c.classId === this.cid() && c.room.startsWith('Salle'))?.room;
    const order = this.s.apiMode() ? [...this.s.classes()].sort((a, b) => Number(a.id) - Number(b.id)) : this.s.classes();
    this.fRoom.set(cur?.room ?? (this.homeRoom(this.cid()) || (mine ?? this.tt.rooms()[order.findIndex((c) => c.id === this.cid())] ?? this.tt.rooms()[0])));
    this.editing.set({ day, slot, had: !!cur });
  }
  async save(): Promise<void> {
    const e = this.editing();
    if (!e || this.conflicts().length) return;
    if (!this.fSubject()) { void this.clearSlot(); return; }
    if (this.s.apiMode()) {
      const err = await this.tt.setAsync({ classId: this.cid(), day: e.day, slot: e.slot, subjectId: this.fSubject(), room: this.fRoom() });
      if (err) { this.s.toast(err, 'err'); return; }
      this.editing.set(null);
      const w = this.tt.warnings();
      this.s.toast(w.length ? `Emploi du temps mis à jour. Attention : ${w[0]}` : 'Emploi du temps mis à jour.'); return;
    }
    this.tt.set({ classId: this.cid(), day: e.day, slot: e.slot, subjectId: this.fSubject(), room: this.fRoom() });
    const t = this.s.teacherOf(this.cid(), this.fSubject());
    const label = `${this.s.className(this.cid())} · ${this.s.subjectById().get(this.fSubject())?.name} · ${DAYS[e.day]} ${this.tt.slots()[e.slot].start}`;
    this.s.addLog('Emploi du temps', `Créneau modifié : ${label} (${this.fRoom()})`);
    if (t) this.s.notify([t.userId], `Votre emploi du temps a changé : ${label}.`, 'systeme', 'edt');
    this.editing.set(null);
    this.s.toast('Emploi du temps mis à jour.');
  }
  async clearSlot(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (this.s.apiMode()) {
      const err = await this.tt.clearAsync(this.cid(), e.day, e.slot);
      if (err) { this.s.toast(err, 'err'); return; }
      this.editing.set(null); this.s.toast('Créneau libéré.'); return;
    }
    const cur = this.tt.cellAt(this.cid(), e.day, e.slot);
    this.tt.clear(this.cid(), e.day, e.slot);
    if (cur) {
      const t = this.s.teacherOf(cur.classId, cur.subjectId);
      const label = `${this.s.className(cur.classId)} · ${this.s.subjectById().get(cur.subjectId)?.name} · ${DAYS[e.day]} ${this.tt.slots()[e.slot].start}`;
      this.s.addLog('Emploi du temps', `Créneau libéré : ${label}`);
      if (t) this.s.notify([t.userId], `Un cours a été retiré de votre emploi du temps : ${label}.`, 'systeme', 'edt');
    }
    this.editing.set(null);
    this.s.toast('Créneau libéré.');
  }

  // --- Remplacements ---
  readonly repls = signal<Replacement[]>([]);
  readonly replForm = signal<{ date: string; classId: string; slot: number | ''; teacherId: string } | null>(null);
  readonly replErr = signal('');
  readonly cands = signal<Candidate[]>([]);
  async loadRepl(): Promise<void> {
    if (!this.s.apiMode() || !this.s.can('edt.write')) return;
    this.repls.set(await this.plan.replacements(this.s.today, addDays(this.s.today, 30)));
  }
  /** Cours de la classe ce jour-là (déduits de son emploi du temps). */
  readonly replSlots = computed(() => {
    const f = this.replForm();
    if (!f) return [];
    const di = dayIndex(f.date);
    return this.tt.cells().filter((c) => c.classId === f.classId && c.day === di && this.tt.isOpen(c.day, c.slot)).sort((a, b) => a.slot - b.slot)
      .map((c) => ({ slot: c.slot, label: `${this.slots()[c.slot]?.start} · ${this.s.subjectById().get(c.subjectId)?.name ?? ''}` }));
  });
  openRepl(): void {
    this.replErr.set(''); this.cands.set([]);
    this.replForm.set({ date: this.s.today, classId: this.s.classes()[0]?.id ?? '', slot: '', teacherId: '' });
    this.afterReplChange();
  }
  setReplDate(d: string): void { this.replForm.update((f) => f && { ...f, date: d }); this.afterReplChange(); }
  setReplClass(c: string): void { this.replForm.update((f) => f && { ...f, classId: c }); this.afterReplChange(); }
  setReplSlot(v: string): void { this.replForm.update((f) => f && { ...f, slot: v === '' ? '' : Number(v), teacherId: '' }); void this.loadCands(); }
  private afterReplChange(): void {
    this.replForm.update((f) => f && { ...f, slot: this.replSlots()[0]?.slot ?? '', teacherId: '' });
    void this.loadCands();
  }
  private async loadCands(): Promise<void> {
    const f = this.replForm();
    if (!f || f.slot === '') { this.cands.set([]); return; }
    this.cands.set(await this.plan.candidates(f.classId, f.date, f.slot));
  }
  pickTeacher(id: string): void { this.replForm.update((f) => f && { ...f, teacherId: id }); }
  async saveRepl(): Promise<void> {
    const f = this.replForm();
    if (!f || f.slot === '' || !f.teacherId) return;
    const e = await this.plan.addReplacement(f.classId, f.date, f.slot, f.teacherId);
    if (e) { this.replErr.set(e); return; }
    this.replForm.set(null); this.s.toast('Remplacement enregistré : le remplaçant est prévenu.');
    await this.loadRepl();
  }
  async cancelRepl(r: Replacement): Promise<void> {
    const e = await this.plan.removeReplacement(r.id);
    if (e) { this.s.toast(e, 'err'); return; }
    this.s.toast('Remplacement annulé.'); await this.loadRepl();
  }
}
