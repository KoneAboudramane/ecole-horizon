import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal, FitHeight } from '../ui';
import { dateFr, dateLong, fnum, isWeekday, toCsv } from '../format';
import { Absence, INCIDENT_LABEL, SANCTION_LABEL, Slot } from '../models';
import { Lesson, SuiviRow, slotLabel } from '../api-map';
import { Planning } from '../modules/planning';
import { Timetable } from '../modules/timetable';

type St = 'P' | 'A' | 'R';

@Component({
  selector: 'app-appel',
  imports: [FormsModule, Icon],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Appel</h1><p>Pointez la présence de la classe. Les parents sont prévenus des absences.</p></div></div>
    <div class="card pad"><div class="row">
      @if (!byLesson() || !teacher()) {
        <label class="field"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cid.set($event); reset()">@for (c of classChoices(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      }
      <label class="field"><span>Date</span><input type="date" [ngModel]="date()" [max]="s.today" (ngModelChange)="date.set($event); reset()" /></label>
      @if (!byLesson() || !teacher()) {
        <div class="field"><span>Séance</span><div class="chips">@for (sl of slots(); track sl) { <button class="chip" [class.on]="slot() === sl" (click)="slot.set(sl); reset()">{{ label(sl) }}</button> }</div></div>
      }
    </div></div>
    @if (byLesson()) {
      <div class="card">
        <div class="card-head"><h2>{{ teacher() ? 'Mes cours du jour' : 'Cours du jour' }}</h2><span class="small muted">L’appel suit l’emploi du temps de la classe. Choisissez le cours.</span></div>
        <ul class="lessons" aria-label="Cours du jour">
          @for (l of lessons(); track l.classId + l.slot) {
            <li><button type="button" class="lesson" [class.on]="l.classId === cid() && l.code === slot()" [disabled]="l.replacedOut" (click)="pick(l)"
                [attr.aria-label]="l.className + ', ' + l.subjectName + ', ' + l.start">
              <span class="when">{{ l.start }}<span class="muted"> – {{ l.end }}</span></span>
              <span class="grow"><b>{{ l.className }}</b> · {{ l.subjectName }}<span class="tiny muted"> · {{ l.room }}</span></span>
              @if (l.replacedOut) { <span class="pill">Remplacé par {{ l.replacementName }}</span> }
              @else if (l.replacementId && teacher() && l.teacherId !== l.titularId) { <span class="pill warn">Vous remplacez</span> }
              @if (!l.replacedOut) { <span class="pill" [class.ok]="l.done" [class.warn]="!l.done">{{ l.done ? 'Appel fait' : 'À faire' }}</span> }
            </button></li>
          } @empty { <li class="empty">Aucun cours ce jour-là dans l’emploi du temps.</li> }
        </ul>
      </div>
    }
    @if (!ready()) { <div class="banner info"><app-icon name="alert" [size]="18" /> Choisissez un de vos cours ci-dessus pour faire l’appel.</div> }
    @else if (!weekday() && !byLesson()) { <div class="banner warn">Cette date tombe un week-end : pas de cours.</div> }
    @else if (done()) { <div class="banner info"><app-icon name="check" [size]="18" /> L’appel de cette séance a déjà été fait. Vous pouvez le corriger.</div> }
    @else if (date() === s.today) { <div class="banner warn">Appel non fait pour cette séance.</div> }
    @if (ready()) {
    <div class="card">
      <div class="card-head"><h2>{{ s.className(cid()) }} · {{ studs().length }} élèves</h2>
        <div class="row"><span class="pill ok">{{ count('P') }} présent(s)</span><span class="pill bad">{{ count('A') }} absent(s)</span><span class="pill warn">{{ count('R') }} retard(s)</span>
          <button class="btn sm" (click)="allPresent()">Tout le monde présent</button></div></div>
      <div class="table-wrap"><table class="table"><tbody>
        @for (e of studs(); track e.id; let i = $index) {
          <tr><td class="num muted" style="width:40px">{{ i + 1 }}</td><td class="cell-main">{{ e.nom }} {{ e.prenoms }}</td>
            <td class="right"><div class="chips" style="justify-content:flex-end">
              <button class="chip" [class.on]="st(e.id) === 'P'" (click)="set(e.id, 'P')">Présent</button>
              <button class="chip" [class.on]="st(e.id) === 'A'" (click)="set(e.id, 'A')" [style.background]="st(e.id) === 'A' ? 'var(--bad)' : ''" [style.border-color]="st(e.id) === 'A' ? 'var(--bad)' : ''">Absent</button>
              <button class="chip" [class.on]="st(e.id) === 'R'" (click)="set(e.id, 'R')" [style.background]="st(e.id) === 'R' ? 'var(--accent)' : ''" [style.border-color]="st(e.id) === 'R' ? 'var(--accent)' : ''">Retard</button></div></td></tr>
        }</tbody></table></div>
      <div class="card-body row" style="justify-content:flex-end"><button class="btn primary" [disabled]="!weekday() && !byLesson()" (click)="save()">Enregistrer l’appel</button></div>
    </div>
    }
  </div>`,
  styles: `ul.lessons { list-style: none; margin: 0; padding: 0; }
    button.lesson { display: flex; gap: 12px; align-items: center; width: 100%; padding: 12px 18px; border: 0; border-bottom: 1px solid var(--line); background: transparent; text-align: start; cursor: pointer; color: var(--ink); }
    button.lesson:hover:not(:disabled) { background: var(--surface-2); } button.lesson.on { background: var(--accent-tint); box-shadow: inset 4px 0 0 var(--brand); } button.lesson:disabled { opacity: 0.6; cursor: default; }
    .when { min-width: 120px; font-weight: 600; }`,
})
export class AppelPage {
  readonly s = inject(Store);
  readonly plan = inject(Planning);
  readonly tt = inject(Timetable);
  readonly label = slotLabel;
  /** Ouvert depuis le suivi des appels : « classe|date|séance ». */
  private readonly from = (this.s.param() ?? '').split('|');
  private readonly hasFrom = this.from.length === 3;
  cid = signal(this.hasFrom ? this.from[0] : this.s.scopeClasses()[0]?.id ?? ''); date = signal(this.hasFrom ? this.from[1] : this.s.today); slot = signal<Slot>(this.hasFrom ? this.from[2] as Slot : 'Matin');
  readonly teacher = computed(() => this.s.role() === 'enseignant');
  /** Avec le serveur et un emploi du temps, l'appel se fait par cours ; sinon par demi-journée comme avant. */
  readonly byLesson = computed(() => this.s.apiMode() && this.tt.cells().length > 0);
  readonly lessons = signal<Lesson[]>([]);
  /** Un enseignant ne fait l'appel que d'un de ses cours (titulaire ou remplaçant). */
  readonly ready = computed(() => !(this.byLesson() && this.teacher()) || this.lessons().some((l) => l.classId === this.cid() && l.code === this.slot() && !l.replacedOut));
  readonly classChoices = computed(() => {
    const base = this.s.scopeClasses();
    const extra = this.lessons().filter((l) => !base.some((c) => c.id === l.classId)).map((l) => this.s.classes().find((c) => c.id === l.classId)).filter((c): c is NonNullable<typeof c> => !!c);
    return [...base, ...extra.filter((c, i, a) => a.indexOf(c) === i)];
  });
  /** Choix de la séance : les heures de cours du jour pour le personnel, sinon matin / après-midi. */
  readonly slots = computed<Slot[]>(() => ['Matin', 'Après-midi']);
  constructor() {
    void this.tt.load();
    effect(() => {
      const on = this.byLesson(); const d = this.date(); const c = this.cid(); const teacher = this.teacher();
      if (on) untracked(() => void this.loadLessons(d, teacher ? '' : c));
    });
  }
  async loadLessons(date: string, classId: string): Promise<void> {
    const ls = await this.plan.lessons(date, classId ? { classId } : {});
    this.lessons.set(ls);
    const cur = ls.find((l) => l.classId === this.cid() && l.code === this.slot());
    if (!cur && this.teacher()) { const first = ls.find((l) => !l.replacedOut); if (first) await this.pick(first); }
  }
  async pick(l: Lesson): Promise<void> {
    if (!this.studentsOf(l.classId).length) await this.s.refreshPeople();   // remplaçant : la liste des élèves de cette classe arrive à ce moment
    this.cid.set(l.classId); this.slot.set(l.code); this.reset();
  }
  private studentsOf(classId: string) { return this.s.studentsByClass().get(classId) ?? []; }
  over = signal<Record<string, St>>({});
  studs = computed(() => this.s.studentsByClass().get(this.cid()) ?? []);
  weekday = computed(() => isWeekday(this.date()));
  done = computed(() => this.s.isAppelDone(this.cid(), this.date(), this.slot()));
  existing = computed(() => new Map(this.s.absences().filter((a) => a.classId === this.cid() && a.date === this.date() && a.slot === this.slot()).map((a) => [a.studentId, a.status as St])));
  reset(): void { this.over.set({}); }
  st = (id: string): St => this.over()[id] ?? this.existing().get(id) ?? 'P';
  set(id: string, v: St): void { this.over.update((o) => ({ ...o, [id]: v })); }
  count = (v: St) => this.studs().filter((e) => this.st(e.id) === v).length;
  allPresent(): void { this.over.set(Object.fromEntries(this.studs().map((e) => [e.id, 'P' as St]))); }
  async save(): Promise<void> {
    const r = await this.s.saveAppelAsync(this.cid(), this.date(), this.slot(), this.studs().map((e) => ({ studentId: e.id, status: this.st(e.id) })));
    if (r.error) return void this.s.toast(r.error, 'err');
    this.over.set({});
    this.s.toast(`Appel enregistré. ${r.n ?? 0} famille(s) prévenue(s) par notification.`);
  }
}

@Component({
  selector: 'app-presences',
  imports: [FitHeight, FormsModule, Icon, Modal],
  styles: `tr.click { cursor: pointer; } tr.click:hover td { background: var(--surface-2); }`,
  template: `
  <div class="page">
  @if (staff()) {
    <div class="page-head"><div><h1>Présences</h1><p>Justificatifs à traiter et rapport d’assiduité par classe.</p></div><button class="btn" (click)="exportCsv()"><app-icon name="download" [size]="16" /> Exporter le rapport</button></div>
    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Assiduité globale</span><span class="value">{{ fnum(s.schoolAttendance(), 1) }} %</span></div>
      <div class="card kpi-card" [class.alert]="s.pendingJustifs().length > 0"><span class="label">Justificatifs en attente</span><span class="value">{{ s.pendingJustifs().length }}</span></div>
    </div>
    <div class="card" appFitHeight><div class="card-head"><h2>Justificatifs</h2>
      <div class="row">
        <select [ngModel]="fcls()" (ngModelChange)="fcls.set($event)" style="width:auto" aria-label="Classe"><option value="">Toutes les classes</option>@for (c of s.scopeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
        <div class="tabs"><button class="tab" [class.on]="jtab() === 'wait'" (click)="jtab.set('wait')">À traiter ({{ waiting().length }})</button><button class="tab" [class.on]="jtab() === 'todo'" (click)="jtab.set('todo')">Non justifiées ({{ unjustified().length }})</button><button class="tab" [class.on]="jtab() === 'done'" (click)="jtab.set('done')">Traités ({{ treated().length }})</button></div></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Élève</th><th>Date</th><th>{{ jtab() === 'todo' ? 'Situation' : 'Motif donné par la famille' }}</th><th>{{ jtab() === 'done' ? 'Décision' : '' }}</th></tr></thead><tbody>
      @for (a of shown(); track a.id) {
        <tr><td class="cell-main">{{ s.studentName(a.studentId) }}<div class="tiny muted">{{ s.className(a.classId) }}</div></td><td>{{ dateFr(a.date) }} · {{ label(a.slot) }}</td>
          <td>@if (jtab() === 'todo') {
              @if (a.justif === 'refusee') { <span class="pill bad">Refusé</span> <span class="tiny muted">{{ a.motif }}</span> } @else { <span class="muted">Aucun justificatif</span> }
              @if (s.justifLate(a)) { <div><span class="pill warn">Délai dépassé</span></div> }
            } @else { {{ a.motif }} }</td>
          <td class="right nowrap">@if (jtab() === 'wait') { @if (s.can('justifs')) { <button class="btn sm primary" (click)="accept(a.id, true)">Accepter</button> <button class="btn sm danger" (click)="accept(a.id, false)">Refuser</button> } }
            @else if (jtab() === 'todo') { @if (s.can('justifs')) { <button class="btn sm" (click)="openRecord(a)">Saisir un justificatif</button> } }
            @else { @if (a.justif === 'acceptee') { <span class="pill ok">Acceptée</span> } @else { <span class="pill bad">Refusée</span> } }</td></tr>
      } @empty { <tr><td colspan="4" class="empty">{{ jtab() === 'wait' ? 'Aucun justificatif en attente.' : jtab() === 'todo' ? 'Aucune absence non justifiée.' : 'Aucun justificatif traité.' }}</td></tr> }</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>Suivi des appels</h2>
      <div class="row">
        <label class="field"><span>Du</span><input type="date" [ngModel]="sFrom()" [max]="sTo()" (ngModelChange)="sFrom.set($event)" /></label>
        <label class="field"><span>Au</span><input type="date" [ngModel]="sTo()" [max]="s.today" (ngModelChange)="sTo.set($event)" /></label>
        <label class="field"><span>Classe</span><select [ngModel]="sCls()" (ngModelChange)="sCls.set($event)"><option value="">Toutes les classes</option>@for (c of s.scopeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
        <label class="row small"><input type="checkbox" [ngModel]="sMissing()" (ngModelChange)="sMissing.set($event)" /> Non faits seulement</label>
        <button class="btn" (click)="exportSuivi()"><app-icon name="download" [size]="16" /> Exporter</button>
      </div></div>
      @if (sErr()) { <div class="banner bad" role="alert">{{ sErr() }}</div> }
      <div class="table-wrap" style="max-height:420px;overflow:auto"><table class="table">
        <thead><tr><th>Date</th><th>Heure</th><th>Classe</th><th>Cours</th><th>Appel</th><th class="num" title="Absents">Abs.</th><th class="num" title="Retards">Ret.</th></tr></thead>
        <tbody>@for (r of sRows(); track r.classId + r.date + r.slot) {
          <tr class="click" (click)="openAppel(r)" title="Ouvrir l’appel">
            <td class="nowrap">{{ dateFr(r.date) }}</td>
            <td class="nowrap">@if (r.start) { {{ r.start }} – {{ r.end }} } @else { {{ label(r.slot) }} }</td>
            <td class="cell-main">{{ r.className }}</td>
            <td>@if (r.subjectName) { {{ r.subjectName }} } @else { <span class="muted">—</span> }@if (r.teacherName) { <div class="tiny muted">{{ r.teacherName }}</div> }</td>
            <td>@if (r.done) { <span class="pill ok">Fait</span>@if (r.takenBy) { <div class="tiny muted">{{ r.takenBy }}</div> }@if (r.takenAt) { <div class="tiny muted">{{ stamp(r) }}</div> } } @else { <span class="pill warn">Non fait</span> }</td>
            <td class="num">@if (r.done) { {{ r.absents }} } @else { — }</td>
            <td class="num">@if (r.done) { {{ r.retards }} } @else { — }</td></tr>
        } @empty { <tr><td colspan="7" class="empty">{{ sMissing() ? 'Aucun appel oublié sur cette période.' : 'Aucun appel sur cette période.' }}</td></tr> }</tbody></table></div>
      <div class="card-body small muted">{{ sDone() }} fait(s) · {{ sTodo() }} non fait(s)
        @if (!sPlanned()) { <span> — Sans emploi du temps, seuls les appels faits sont listés : un appel oublié ne peut pas être repéré.</span> }</div>
    </div>
    <div class="card" appFitHeight><div class="card-head"><h2>Rapport par classe</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Classe</th><th class="num">Séances</th><th class="num">Absences</th><th class="num">Retards</th><th>Assiduité</th></tr></thead><tbody>
      @for (r of report(); track r.id) {
        <tr><td class="cell-main">{{ r.name }}</td><td class="num">{{ r.sessions }}</td><td class="num">{{ r.a }}</td><td class="num">{{ r.r }}</td><td style="min-width:160px"><div class="row" style="flex-wrap:nowrap"><div class="meter grow" [class.bad]="(r.rate ?? 100) < 92"><span [style.width.%]="r.rate ?? 0"></span></div><span class="num small">{{ fnum(r.rate, 1) }} %</span></div></td></tr>
      }</tbody></table></div></div>
  } @else {
    @if (s.activeChild(); as k) {
    <div class="page-head"><div><h1>{{ s.role() === 'eleve' ? 'Mes absences' : 'Absences de ' + k.prenoms }}</h1><p>Assiduité : {{ fnum(s.attendanceRate(k.id), 0) }} % depuis le début du suivi.</p></div></div>
    @if (s.role() === 'eleve') { <div class="banner info">Seul ton parent peut envoyer un justificatif d’absence.</div> }
    <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Séance</th><th>Type</th><th>Justification</th><th></th></tr></thead><tbody>
      @for (a of mine(); track a.id) {
        <tr><td>{{ dateLong(a.date) }}</td><td>{{ label(a.slot) }}</td><td>{{ a.status === 'A' ? 'Absence' : 'Retard' }}</td>
          <td>@switch (a.justif) { @case ('acceptee') { <span class="pill ok">Justifiée</span> } @case ('en_attente') { <span class="pill warn">En attente de décision</span><div class="tiny muted">{{ a.motif }}</div> } @case ('refusee') { <span class="pill bad">Refusée</span><div class="tiny muted">{{ a.motif }}</div> } @default { <span class="muted">Non justifiée</span> } }
            @if (a.status === 'A' && (a.justif === 'aucune' || a.justif === 'refusee')) {
              @if (s.familyJustifBlock(a); as why) { <div class="tiny muted">{{ why }}</div> }
              @else if (s.justifDeadlineOf(a); as dl) { <div class="tiny muted">À justifier au plus tard le {{ dateFr(dl) }}</div> }
            }</td>
          <td class="right">@if (s.role() === 'parent' && a.status === 'A' && (a.justif === 'aucune' || a.justif === 'refusee') && !s.familyJustifBlock(a)) { <button class="btn sm" (click)="open(a.id)">Justifier</button> }</td></tr>
      } @empty { <tr><td colspan="5" class="empty">Aucune absence ni retard enregistré.</td></tr> }</tbody></table></div></div>
    @if (s.role() === 'parent') {
      <div class="card"><div class="card-head"><h2>Mesures disciplinaires</h2></div><div class="table-wrap"><table class="table"><tbody>
        @for (i of mineInc(); track i.id) {
          <tr><td class="nowrap">{{ dateFr(i.date) }}</td><td>{{ incLabel[i.type] }}<div class="small muted">{{ i.description }}</div></td><td><span class="pill" [class.bad]="i.gravite === 'grave'">{{ sancLabel[i.sanction] }}</span></td></tr>
        } @empty { <tr><td class="empty">Aucune mesure disciplinaire. Bravo !</td></tr> }</tbody></table></div></div>
    }
    }
  }
  </div>
  @if (target()) {
    <app-modal title="Justifier l’absence" (closed)="target.set(null)">
      <label class="field"><span>Motif</span><textarea rows="3" [(ngModel)]="motif" name="m" placeholder="Ex. : consultation médicale, décès dans la famille…"></textarea>@if (err()) { <span class="err">{{ err() }}</span> }</label>
      <p class="tiny muted" style="margin-top:8px">L’administration examinera votre demande et vous répondra par notification.</p>
      <div footer><button class="btn ghost" (click)="target.set(null)">Annuler</button><button class="btn primary" (click)="send()">Envoyer le justificatif</button></div>
    </app-modal>
  }
  @if (recordFor(); as a) {
    <app-modal title="Saisir un justificatif" (closed)="recordFor.set(null)">
      <p class="small"><b>{{ s.studentName(a.studentId) }}</b>, absence du {{ dateFr(a.date) }} · {{ label(a.slot) }}</p>
      <label class="field" style="margin-top:12px"><span>Motif</span><textarea rows="3" [(ngModel)]="motif" name="rm" placeholder="Ex. : certificat médical apporté au bureau"></textarea>@if (err()) { <span class="err">{{ err() }}</span> }</label>
      <p class="tiny muted" style="margin-top:8px">Pour un justificatif apporté à l’école. Il est accepté directement, la famille est prévenue et la conduite est mise à jour.</p>
      @if (s.justifLate(a)) { <div class="banner warn" style="margin-top:8px">Le délai laissé à la famille est dépassé : la saisie sera notée « hors délai » dans le journal.</div> }
      <div footer><button class="btn ghost" (click)="recordFor.set(null)">Annuler</button><button class="btn primary" (click)="record()">Enregistrer le justificatif</button></div>
    </app-modal>
  }`,
})
export class PresencesPage {
  readonly s = inject(Store); readonly fnum = fnum; readonly dateFr = dateFr; readonly dateLong = dateLong;
  readonly label = slotLabel;
  readonly incLabel = INCIDENT_LABEL; readonly sancLabel = SANCTION_LABEL;
  staff = computed(() => ['admin', 'directeur', 'fondateur', 'educateur', 'personnel'].includes(this.s.role() ?? ''));
  fcls = signal(''); jtab = signal<'wait' | 'todo' | 'done'>('wait');
  private byClass = (l: Absence[]) => l.filter((a) => !this.fcls() || a.classId === this.fcls());
  waiting = computed(() => this.byClass(this.s.pendingJustifs()));
  treated = computed(() => this.byClass(this.s.absences().filter((a) => a.justif === 'acceptee' || a.justif === 'refusee')).sort((a, b) => b.date.localeCompare(a.date)));
  unjustified = computed(() => this.byClass(this.s.absences().filter((a) => a.status === 'A' && (a.justif === 'aucune' || a.justif === 'refusee'))).sort((a, b) => b.date.localeCompare(a.date)));
  shown = computed(() => ({ wait: this.waiting(), todo: this.unjustified(), done: this.treated() })[this.jtab()]);
  recordFor = signal<Absence | null>(null);
  mineInc = computed(() => this.s.incidentsOf(this.s.activeChild()?.id ?? '').filter((i) => i.status === 'valide'));
  target = signal<string | null>(null); motif = ''; err = signal('');
  mine = computed(() => this.s.absences().filter((a) => a.studentId === this.s.activeChild()?.id).sort((a, b) => b.date.localeCompare(a.date)));
  report = computed(() => this.s.scopeClasses().filter((c) => !this.fcls() || c.id === this.fcls()).map((c) => {
    const studs = this.s.studentsByClass().get(c.id) ?? [];
    const abs = this.s.absences().filter((a) => a.classId === c.id);
    return { id: c.id, name: c.name, sessions: this.s.sessionsByClass().get(c.id) ?? 0, a: abs.filter((x) => x.status === 'A').length, r: abs.filter((x) => x.status === 'R').length, rate: studs.length ? this.s.classAttendance(c.id) : null };
  }));
  open(id: string): void { this.motif = ''; this.err.set(''); this.target.set(id); }
  async send(): Promise<void> {
    if (this.motif.trim().length < 5) return void this.err.set('Indiquez le motif de l’absence.');
    const r = await this.s.submitJustifAsync(this.target()!, this.motif.trim());
    if (!r.ok) return void this.err.set(r.error ?? 'Envoi impossible.');
    this.target.set(null); this.s.toast('Justificatif envoyé à l’administration.');
  }
  openRecord(a: Absence): void { this.motif = ''; this.err.set(''); this.recordFor.set(a); }
  async record(): Promise<void> {
    if (this.motif.trim().length < 3) return void this.err.set('Indiquez le motif de l’absence.');
    const r = await this.s.recordJustifAsync(this.recordFor()!.id, this.motif.trim());
    if (!r.ok) return void this.err.set(r.error ?? 'Enregistrement impossible.');
    this.recordFor.set(null); this.s.toast('Justificatif enregistré.');
  }
  async accept(id: string, yes: boolean): Promise<void> { if (await this.s.decideJustifAsync(id, yes)) this.s.toast(yes ? 'Justificatif accepté.' : 'Justificatif refusé.'); }
  // --- Suivi des appels ---
  private monday(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  sFrom = signal(this.monday(this.s.today)); sTo = signal(this.s.today); sCls = signal(''); sMissing = signal(false);
  sRows = signal<SuiviRow[]>([]); sErr = signal('');
  sDone = computed(() => this.sRows().filter((r) => r.done).length);
  sTodo = computed(() => this.sRows().filter((r) => !r.done).length);
  /** Au moins un cours vient de l'emploi du temps : les appels oubliés sont alors repérés. */
  sPlanned = computed(() => this.sRows().some((r) => !!r.subjectName) || this.sTodo() > 0);
  private sSeq = 0;
  constructor() {
    effect(() => {
      const f = { from: this.sFrom(), to: this.sTo(), classId: this.sCls(), missing: this.sMissing() };
      if (this.staff() && f.from && f.to) untracked(() => void this.loadSuivi(f));
    });
  }
  private async loadSuivi(f: { from: string; to: string; classId: string; missing: boolean }): Promise<void> {
    const seq = ++this.sSeq;
    const r = await this.s.appelSuiviAsync(f);
    if (seq !== this.sSeq) return;                       // un filtre plus récent a déjà relancé la recherche
    this.sErr.set(r.error ?? '');
    this.sRows.set(r.rows ?? []);
  }
  /** Heure du dernier enregistrement de l'appel (avec la date si l'appel a été corrigé un autre jour). */
  stamp(r: SuiviRow): string {
    const d = new Date(r.takenAt!);
    const p = (n: number) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return `${day === r.date ? '' : dateFr(day) + ' '}${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  openAppel(r: SuiviRow): void { this.s.go('appel', `${r.classId}|${r.date}|${r.slot}`); }
  exportSuivi(): void {
    void this.s.download(`suivi-appels-${this.sFrom()}-${this.sTo()}.csv`, toCsv(['Date', 'Heure', 'Classe', 'Cours', 'Enseignant', 'Appel', 'Fait par', 'Absents', 'Retards'],
      this.sRows().map((r) => [dateFr(r.date), r.start ? `${r.start}-${r.end}` : slotLabel(r.slot), r.className, r.subjectName, r.teacherName, r.done ? 'Fait' : 'Non fait', r.takenBy,
        r.done ? r.absents : '', r.done ? r.retards : ''])));
  }
  exportCsv(): void { void this.s.download('assiduite-par-classe.csv', toCsv(['Classe', 'Séances', 'Absences', 'Retards', 'Assiduité %'], this.report().map((r) => [r.name, r.sessions, r.a, r.r, fnum(r.rate, 1)]))); }
}
