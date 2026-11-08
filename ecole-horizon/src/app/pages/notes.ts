import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { FitHeight, Icon, Modal } from '../ui';
import { dateFr, fnum, parseNote, rangLabel, toCsv } from '../format';
import { EVAL_LABEL, EvalType, Evaluation } from '../models';
import { BAREMES, BAREME_MAX, mention, sur20 } from '../engine';

// ---------- Enseignant : saisie ----------
@Component({
  selector: 'app-notes-teacher',
  imports: [FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Saisie des notes</h1><p>{{ s.term().label }}. Les notes restent en brouillon jusqu’à leur publication par l’administration.</p></div>
      <button class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Nouvelle évaluation</button></div>
    @if (s.term().locked) { <div class="banner warn"><app-icon name="lock" [size]="18" /> Cette période est verrouillée : les notes ne peuvent plus être modifiées. Contactez l’administration en cas d’erreur.</div> }
    <div class="chips">
      @for (a of s.myAssignments(); track a.id) { <button class="chip" [class.on]="sel() === a.classId + '|' + a.subjectId" (click)="sel.set(a.classId + '|' + a.subjectId)">{{ s.className(a.classId) }} · {{ s.subjectById().get(a.subjectId)?.short }}</button> }
    </div>
    @if (classId()) {
      <div class="grid kpi">
        <div class="card kpi-card"><span class="label">Élèves</span><span class="value">{{ students().length }}</span></div>
        <div class="card kpi-card"><span class="label">Évaluations</span><span class="value">{{ evs().length }}</span></div>
        <div class="card kpi-card"><span class="label">Moyenne de la classe</span><span class="value">{{ fnum(subjAvg()) }}</span><span class="hint">toutes notes saisies</span></div>
      </div>
      <div class="grid three">
        @for (e of evs(); track e.id) {
          <div class="card pad stack">
            <div class="row"><h3 class="grow">{{ e.title }}</h3>@if (e.published) { <span class="pill ok">Publiée</span> } @else { <span class="pill warn">Brouillon</span> }</div>
            <div class="small muted">{{ evalLabel[e.type] }} · sur {{ e.bareme ?? 20 }} · coef {{ coefLabel(e) }} · {{ dateFr(e.date) }}@if (e.scheduled) { · <b>Programmé par l’école</b> }</div>
            @if (e.scheduled && !count(e) && !e.published) { <span class="pill brand" style="align-self:flex-start">Notes à saisir</span> }
            <div><div class="meter"><span [style.width.%]="count(e) / Math.max(1, students().length) * 100"></span></div><div class="tiny muted" style="margin-top:4px">{{ count(e) }} / {{ students().length }} notes saisies</div></div>
            <div class="row">
              @if (s.isEvaluator(e)) { <button class="btn sm grow" (click)="openGrid(e)">{{ count(e) ? 'Modifier les notes' : 'Saisir les notes' }}</button> }
              @else { <span class="small muted grow">Notes saisies par {{ s.teacherById().get(e.teacherId)?.name ?? 'un autre enseignant' }}</span> }
              @if (canDelete(e)) { <button class="btn sm ghost" (click)="removing.set(e)" [attr.aria-label]="'Supprimer ' + e.title" title="Supprimer ce brouillon"><app-icon name="x" [size]="14" /> Supprimer</button> }
            </div>
          </div>
        } @empty { <div class="card empty" style="grid-column:1/-1">Aucune évaluation cette période. Créez-en une pour commencer.</div> }
      </div>
    }
  </div>

  @if (creating()) {
    <app-modal title="Nouvelle évaluation" (closed)="creating.set(false)">
      <div class="form-grid">
        <label class="field"><span>Classe et matière</span><select [ngModel]="nf.target" (ngModelChange)="nf.target = $event" name="tg">
          @for (a of s.myAssignments(); track a.id) { <option [value]="a.classId + '|' + a.subjectId">{{ s.className(a.classId) }} · {{ s.subjectById().get(a.subjectId)?.name }}</option> }</select>
          <span class="tiny muted">{{ targetStudents().length }} élève(s) : leurs noms et leurs champs de note s’afficheront dès la création.</span></label>
        <label class="field"><span>Type</span><select [(ngModel)]="nf.type" name="t"><option value="interro">Interrogation</option><option value="devoir">Devoir</option><option value="composition">Composition</option></select></label>
        <div class="field"><span>Note sur</span>
          <div class="chips" role="group" aria-label="Note maximale">
            @for (b of baremes; track b) { <button type="button" class="chip" [class.on]="nf.bareme === b" (click)="nf.bareme = b">{{ b }}</button> }
            <button type="button" class="chip" [class.on]="nf.bareme === 'autre'" (click)="nf.bareme = 'autre'">Autre</button>
          </div>
          @if (nf.bareme === 'autre') { <input type="number" min="1" [max]="baremeMax" step="1" [(ngModel)]="nf.autre" name="ba" placeholder="Ex. 40" aria-label="Note maximale (autre barème)" style="margin-top:6px" /> }
          <span class="tiny muted">Les notes se saisissent sur ce barème ; la moyenne et le bulletin les ramènent sur 20 (15 sur 30 compte comme 10 sur 20).</span></div>
        <label class="field"><span>Intitulé</span><input [(ngModel)]="nf.title" name="n" placeholder="Devoir 2" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
        <label class="field"><span>Date</span><input type="date" [(ngModel)]="nf.date" name="d" /></label>
        <label class="field"><span>Coefficient</span><input type="number" min="0.5" max="10" step="0.5" [(ngModel)]="nf.coef" name="cf" /><span class="tiny muted">Poids de cette note dans la moyenne de la matière (1 par défaut ; une composition ou un devoir important peut compter 2 ou 3).</span></label>
      </div>
      <div footer><button class="btn ghost" (click)="creating.set(false)">Annuler</button><button class="btn primary" (click)="create()">Créer et saisir les notes</button></div>
    </app-modal>
  }
  @if (removing(); as r) {
    <app-modal title="Supprimer l’évaluation" (closed)="removing.set(null)">
      <p>Supprimer « <b>{{ r.title }}</b> » ({{ s.className(r.classId) }}, {{ dateFr(r.date) }}) ?</p>
      @if (count(r)) { <div class="banner warn" style="margin-top:10px"><app-icon name="alert" [size]="18" /> Les {{ count(r) }} note(s) déjà saisie(s) seront effacées.</div> }
      <p class="small muted" style="margin-top:10px">Elle n’a pas été publiée : les familles ne l’ont jamais vue.</p>
      <div footer><button class="btn ghost" (click)="removing.set(null)">Annuler</button><button class="btn danger" [disabled]="busy()" (click)="remove(r)">Supprimer</button></div>
    </app-modal>
  }
  @if (grid(); as g) {
    <app-modal [title]="g.title + ' · ' + s.className(g.classId)" size="wide" (closed)="grid.set(null)">
      @if (g.published) { <div class="banner info" style="margin-bottom:12px">Cette évaluation est publiée : toute modification est immédiatement visible des familles.</div> }
      <p class="small muted" style="margin-bottom:10px">Notes sur {{ g.bareme ?? 20 }}, virgule acceptée. Laissez vide si l’élève n’a pas composé.</p>
      <div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="table"><thead><tr><th>Élève</th><th>Note /{{ g.bareme ?? 20 }}</th></tr></thead><tbody>
        @for (e of students(); track e.id; let i = $index) {
          <tr><td>{{ i + 1 }}. {{ e.nom }} {{ e.prenoms }}</td>
            <td><input class="inline-input" inputmode="decimal" [ngModel]="vals[e.id]" (ngModelChange)="vals[e.id] = $event; touch()" [attr.aria-label]="'Note de ' + e.nom" [class.bad-input]="bad(e.id)" />
              @if (bad(e.id)) { <span class="err tiny" style="color:var(--bad);margin-inline-start:8px">Note invalide (0 à {{ g.bareme ?? 20 }})</span> }</td></tr>
        }</tbody></table></div>
      <div footer><span class="small muted grow">{{ filled() }} saisie(s) · {{ nErr() }} erreur(s)</span><button class="btn ghost" (click)="grid.set(null)">Annuler</button><button class="btn primary" [disabled]="nErr() > 0" (click)="saveGrid()">Enregistrer</button></div>
    </app-modal>
  }`,
  styles: '.bad-input { border-color: var(--bad) !important; }',
})
export class NotesTeacher {
  readonly s = inject(Store); readonly Math = Math; readonly fnum = fnum; readonly dateFr = dateFr; readonly evalLabel = EVAL_LABEL;
  sel = signal('');
  readonly baremes = BAREMES; readonly baremeMax = BAREME_MAX;
  creating = signal(false); err = signal(''); nf = this.blank('');
  grid = signal<Evaluation | null>(null); vals: Record<string, string> = {}; tick = signal(0);
  removing = signal<Evaluation | null>(null); busy = signal(false);

  constructor() {
    const p = this.s.param();
    const first = this.s.myAssignments()[0];
    this.sel.set(p && p.includes('|') ? p : first ? `${first.classId}|${first.subjectId}` : '');
  }
  classId = computed(() => this.sel().split('|')[0]);
  subjectId = computed(() => this.sel().split('|')[1]);
  students = computed(() => this.s.studentsByClass().get(this.classId()) ?? []);
  evs = computed(() => { this.s.grades(); return this.s.evalsFor(this.classId(), this.subjectId()); });
  count = (e: Evaluation) => this.s.gradeCount(e.id, e.classId);
  subjAvg = computed(() => {
    const g = this.s.grades(); const evs = new Map(this.evs().map((e) => [e.id, e])); let sum = 0, n = 0;
    for (const [k, v] of Object.entries(g)) { const e = evs.get(k.split('|')[0]); if (e) { sum += sur20(v, e.bareme); n++; } }
    return n ? sum / n : null;
  });
  targetStudents = () => this.s.studentsByClass().get(this.nf.target.split('|')[0]) ?? [];
  coefLabel = (e: Evaluation) => String(e.coef ?? 1).replace('.', ',');
  private blank(target: string) { return { target, type: 'devoir' as EvalType, title: '', date: this.s.today, coef: 1, bareme: 20 as number | 'autre', autre: null as number | null }; }
  openNew(): void { this.nf = this.blank(this.sel()); this.err.set(''); this.creating.set(true); }
  async create(): Promise<void> {
    if (!this.nf.title.trim()) return void this.err.set('Donnez un intitulé.');
    const [classId, subjectId] = this.nf.target.split('|');
    if (!classId || !subjectId) return void this.err.set('Choisissez la classe et la matière.');
    const coef = Number(String(this.nf.coef).replace(',', '.'));
    if (!(coef >= 0.5 && coef <= 10)) return void this.err.set('Le coefficient doit être compris entre 0,5 et 10.');
    const bareme = this.nf.bareme === 'autre' ? Number(this.nf.autre) : this.nf.bareme;
    if (!(Number.isInteger(bareme) && bareme >= 1 && bareme <= BAREME_MAX)) return void this.err.set(`Précisez la note maximale : un nombre entier de 1 à ${BAREME_MAX}.`);
    const r = await this.s.createEvalAsync({ classId, subjectId, type: this.nf.type, title: this.nf.title.trim(), date: this.nf.date, coef, bareme });
    if (!r.ev) return void this.err.set(r.error ?? 'Création impossible.');
    this.sel.set(this.nf.target);
    this.creating.set(false); this.openGrid(r.ev);
  }
  openGrid(e: Evaluation): void {
    this.vals = {};
    for (const st of this.students()) { const v = this.s.grades()[`${e.id}|${st.id}`]; this.vals[st.id] = v === undefined ? '' : String(v).replace('.', ','); }
    this.grid.set(e); this.tick.update((n) => n + 1);
  }
  touch(): void { this.tick.update((n) => n + 1); }
  /** Seul l'enseignant de l'évaluation la retire, tant qu'elle est en brouillon (même règle que le serveur). */
  canDelete = (e: Evaluation) => !e.published && !e.scheduled && !this.s.term().locked && !!e.teacherId && e.teacherId === this.s.myTeacher()?.id;
  async remove(e: Evaluation): Promise<void> {
    this.busy.set(true);
    const r = await this.s.deleteEvalAsync(e.id);
    this.busy.set(false);
    if (!r.ok) return void this.s.toast(r.error ?? 'Suppression impossible.', 'err');
    this.removing.set(null); this.s.toast(`« ${e.title} » supprimée.`);
  }
  parsed(id: string): number | null | 'err' { this.tick(); return parseNote(this.vals[id] ?? '', this.grid()?.bareme ?? 20); }
  bad = (id: string) => this.parsed(id) === 'err';
  nErr = () => this.students().filter((s) => this.bad(s.id)).length;
  filled = () => this.students().filter((s) => { const p = this.parsed(s.id); return p !== null && p !== 'err'; }).length;
  async saveGrid(): Promise<void> {
    const e = this.grid()!; const out: Record<string, number | null> = {};
    for (const st of this.students()) { const p = this.parsed(st.id); out[st.id] = p === 'err' ? null : p; }
    const r = await this.s.saveGradesAsync(e.id, out);
    if (!r.ok) return void this.s.toast(r.error ?? 'Enregistrement impossible.', 'err');
    this.grid.set(null); this.s.toast(`Notes enregistrées (${this.filled()}). Elles seront visibles après publication.`);
  }
}

// ---------- Administration : publication et résultats ----------
@Component({
  selector: 'app-notes-admin',
  imports: [FormsModule, Icon, Modal, FitHeight],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Notes et publication</h1><p>Contrôlez les notes saisies, publiez-les aux familles et verrouillez la période.</p></div>
      <div class="row">@if (s.apiMode() && s.can('examens.write') && !s.term().locked) { <button class="btn" (click)="openSchedule()"><app-icon name="calendar" [size]="16" /> Programmer un examen</button> }
      @if (s.can('publish')) { <button class="btn" [class.danger]="!s.term().locked" (click)="toggleLock()"><app-icon name="lock" [size]="16" /> {{ s.term().locked ? 'Déverrouiller' : 'Verrouiller' }} le {{ s.term().label.toLowerCase() }}</button> }</div></div>
    @if (!s.can('publish')) { <div class="banner info">Lecture seule : la publication des notes et le verrouillage de la période sont réservés à la direction.</div> }
    @if (s.term().locked) { <div class="banner warn">Cette période est verrouillée. Les enseignants ne peuvent plus modifier les notes.</div> }
    <div class="row">
      <label class="field" style="min-width:200px"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cid.set($event)">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      <div class="tabs" style="align-self:flex-end">@if (s.role() !== 'fondateur') { <button class="tab" [class.on]="tab() === 'pub'" (click)="tab.set('pub')">Publication</button> }<button class="tab" [class.on]="tab() === 'res'" (click)="tab.set('res')">Résultats de la classe</button></div>
    </div>
    @if (tab() === 'pub') {
      <div class="card" appFitHeight>
        <div class="card-head"><h2>Évaluations de {{ s.className(cid()) }}</h2>
          @if (s.can('publish')) { <button class="btn sm primary" [disabled]="!publishable().length" (click)="publishAll()">Publier tout ce qui est saisi ({{ publishable().length }})</button> }</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th>Évaluation</th><th>Enseignant</th><th class="num">Saisies</th><th>État</th><th></th></tr></thead><tbody>
          @for (r of rows(); track r.e.id) {
            <tr><td class="cell-main">{{ s.subjectById().get(r.e.subjectId)?.name }}</td><td>{{ r.e.title }}<div class="tiny muted">{{ dateFr(r.e.date) }} · sur {{ r.e.bareme ?? 20 }}</div></td><td class="muted">{{ s.teacherOf(r.e.classId, r.e.subjectId)?.name }}</td>
              <td class="num">{{ r.n }} / {{ r.total }}</td>
              <td>@if (r.e.published) { <span class="pill ok">Publiée</span> } @else if (r.n === 0) { <span class="pill">Aucune note</span> } @else { <span class="pill warn">À publier</span> }</td>
              <td class="right">@if (s.can('publish')) { @if (r.e.published) { <button class="btn sm" (click)="s.setPublishedAsync([r.e.id], false)">Retirer</button> } @else { <button class="btn sm primary" [disabled]="r.n === 0" (click)="publishOne(r.e.id)">Publier</button> } }</td></tr>
          } @empty { <tr><td colspan="6" class="empty">Aucune évaluation.</td></tr> }
        </tbody></table></div>
      </div>
    } @else {
      <div class="card" appFitHeight>
        <div class="card-head"><h2>Résultats provisoires</h2><div class="row">@if (stats(); as st) { <span class="pill brand">Moyenne {{ fnum(st.avg) }}</span><span class="pill">Max {{ fnum(st.max) }}</span><span class="pill">Min {{ fnum(st.min) }}</span> }<button class="btn sm" (click)="exportCsv()"><app-icon name="download" [size]="14" /> Exporter</button></div></div>
        <div class="table-wrap"><table class="table hover"><thead><tr><th>Rang</th><th>Élève</th><th class="num">Moyenne</th><th>Mention</th></tr></thead><tbody>
          @for (r of ranking(); track r.id) {
            <tr style="cursor:pointer" (click)="s.go('eleve', r.id)"><td>{{ rangLabel(r.rang) }}</td><td class="cell-main">{{ r.name }}</td><td class="num"><b>{{ fnum(r.moy) }}</b></td><td>{{ mention(r.moy, s.school().seuils) }}</td></tr>
          }</tbody></table></div>
      </div>
    }
  </div>
  @if (sch(); as f) {
    <app-modal title="Programmer un examen" size="wide" (closed)="sch.set(null)">
      <div class="stack">
        <p class="small muted">L’école fixe l’examen : une évaluation est créée pour chaque classe et chaque matière choisie, confiée à l’enseignant affecté. Il est prévenu et saisit les notes de sa matière. {{ s.term().label }}.</p>
        <div class="form-grid">
          <label class="field"><span>Type</span><select [ngModel]="f.type" (ngModelChange)="upd({ type: $event })" name="st"><option value="interro">Interrogation</option><option value="devoir">Devoir</option><option value="composition">Composition</option></select></label>
          <label class="field"><span>Intitulé</span><input [ngModel]="f.title" (ngModelChange)="upd({ title: $event })" name="sn" placeholder="Composition du 1er trimestre" /></label>
          <label class="field"><span>Date de l’examen</span><input type="date" [ngModel]="f.date" (ngModelChange)="upd({ date: $event })" name="sd" /></label>
          <label class="field"><span>Coefficient</span><input type="number" min="0.5" max="10" step="0.5" [ngModel]="f.coef" (ngModelChange)="upd({ coef: $event })" name="sc" /></label>
          <label class="field"><span>Note sur</span><input type="number" min="1" [max]="baremeMax" step="1" [ngModel]="f.bareme" (ngModelChange)="upd({ bareme: $event })" name="sb" /><span class="tiny muted">10, 20, 30 ou autre ; ramenée sur 20 dans les moyennes.</span></label>
        </div>
        <div class="field"><span>Classes <button type="button" class="btn sm ghost" (click)="allClasses()">{{ f.classIds.length === s.classes().length ? 'Aucune' : 'Toutes' }}</button></span>
          <div class="chips" role="group" aria-label="Classes concernées">@for (c of s.classes(); track c.id) { <button type="button" class="chip" [class.on]="f.classIds.includes(c.id)" (click)="toggle('classIds', c.id)">{{ c.name }}</button> }</div></div>
        <div class="field"><span>Matières <button type="button" class="btn sm ghost" (click)="allSubjects()">{{ f.subjectIds.length === s.subjects().length ? 'Aucune' : 'Toutes' }}</button></span>
          <div class="chips" role="group" aria-label="Matières concernées">@for (m of s.subjects(); track m.id) { <button type="button" class="chip" [class.on]="f.subjectIds.includes(m.id)" (click)="toggle('subjectIds', m.id)">{{ m.name }}</button> }</div></div>
        @if (schErr()) { <div class="banner bad" role="alert">{{ schErr() }}</div> }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="sch.set(null)">Annuler</button><button type="button" class="btn primary" [disabled]="!f.classIds.length || !f.subjectIds.length" (click)="schedule()">Programmer</button></div>
    </app-modal>
  }`,
})
export class NotesAdmin {
  readonly s = inject(Store); readonly fnum = fnum; readonly dateFr = dateFr; readonly rangLabel = rangLabel; readonly mention = mention;
  cid = signal(this.s.param() ?? this.s.classes()[0]?.id ?? ''); tab = signal<'pub' | 'res'>(this.s.role() === 'fondateur' ? 'res' : 'pub');
  rows = computed(() => {
    this.s.grades();
    const total = this.s.studentsByClass().get(this.cid())?.length ?? 0;
    return this.s.evals().filter((e) => e.classId === this.cid() && e.termId === this.s.termId())
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId) || a.date.localeCompare(b.date)).map((e) => ({ e, n: this.s.gradeCount(e.id, e.classId), total }));
  });
  publishable = computed(() => this.rows().filter((r) => !r.e.published && r.n > 0).map((r) => r.e.id));
  stats = computed(() => this.s.classStats(this.cid(), false));
  ranking = computed(() => {
    const st = this.stats(); if (!st) return [];
    return (this.s.studentsByClass().get(this.cid()) ?? []).map((e) => { const r = st.results.get(e.id); return { id: e.id, name: `${e.nom} ${e.prenoms}`, moy: r?.moyenne ?? null, rang: r?.rang ?? null }; })
      .sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999));
  });
  // --- Programmer un examen ---
  readonly baremeMax = BAREME_MAX;
  readonly sch = signal<{ title: string; type: EvalType; date: string; coef: number; bareme: number; classIds: string[]; subjectIds: string[] } | null>(null);
  readonly schErr = signal('');
  openSchedule(): void { this.schErr.set(''); this.sch.set({ title: '', type: 'composition', date: this.s.today, coef: 1, bareme: 20, classIds: this.s.classes().map((c) => c.id), subjectIds: this.s.subjects().map((m) => m.id) }); }
  upd(p: Partial<NonNullable<ReturnType<typeof this.sch>>>): void { this.sch.update((f) => f && { ...f, ...p }); }
  toggle(k: 'classIds' | 'subjectIds', id: string): void { this.sch.update((f) => f && { ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }); }
  allClasses(): void { this.sch.update((f) => f && { ...f, classIds: f.classIds.length === this.s.classes().length ? [] : this.s.classes().map((c) => c.id) }); }
  allSubjects(): void { this.sch.update((f) => f && { ...f, subjectIds: f.subjectIds.length === this.s.subjects().length ? [] : this.s.subjects().map((m) => m.id) }); }
  async schedule(): Promise<void> {
    const f = this.sch();
    if (!f) return;
    if (!f.title.trim()) { this.schErr.set('Donnez un intitulé à l’examen.'); return; }
    if (!(Number(f.coef) >= 0.5 && Number(f.coef) <= 10)) { this.schErr.set('Le coefficient doit être compris entre 0,5 et 10.'); return; }
    const bareme = Number(f.bareme);
    if (!(Number.isInteger(bareme) && bareme >= 1 && bareme <= BAREME_MAX)) { this.schErr.set(`La note maximale doit être un nombre entier de 1 à ${BAREME_MAX}.`); return; }
    const r = await this.s.scheduleExamAsync({ ...f, coef: Number(f.coef), bareme, title: f.title.trim() });
    if (r.error) { this.schErr.set(r.error); return; }
    this.sch.set(null);
    this.s.toast(`Examen programmé : ${r.created} évaluation(s), ${r.teachers} enseignant(s) prévenu(s).` + (r.orphans ? ` ${r.orphans} sans enseignant affecté.` : ''), r.orphans ? 'info' : undefined);
  }
  async publishOne(id: string): Promise<void> { if (await this.s.setPublishedAsync([id], true)) this.s.toast('Notes publiées : les familles sont prévenues.'); }
  async publishAll(): Promise<void> { const n = this.publishable().length; if (await this.s.setPublishedAsync(this.publishable(), true)) this.s.toast(`${n} évaluation(s) publiée(s).`); }
  async toggleLock(): Promise<void> {
    const t = this.s.term();
    if (!t.locked && !confirmLock(t.label)) return;
    if (await this.s.lockTermAsync(t.id, !t.locked)) this.s.toast(t.locked ? 'Période déverrouillée.' : 'Période verrouillée.');
  }
  exportCsv(): void { void this.s.download(`resultats-${this.s.className(this.cid())}.csv`, toCsv(['Rang', 'Élève', 'Moyenne', 'Mention'], this.ranking().map((r) => [r.rang, r.name, fnum(r.moy), mention(r.moy, this.s.school().seuils)]))); }
}
function confirmLock(_label: string): boolean { return true; }

// ---------- Parent / élève : consultation ----------
@Component({
  selector: 'app-notes-view',
  template: `
  @if (kid(); as k) {
  <div class="page">
    <div class="page-head"><div><h1>{{ s.role() === 'eleve' ? 'Mes notes' : 'Notes de ' + k.prenoms }}</h1><p>{{ s.className(k.classId) }} · {{ s.term().label }}. Seules les notes publiées par l’école apparaissent ici.</p></div></div>
    @if (!has()) {
      <div class="card empty">Aucune note n’est encore publiée pour cette période.</div>
    } @else {
      <div class="grid kpi">
        <div class="card kpi-card"><span class="label">Moyenne générale</span><span class="value">{{ fnum(res()?.moyenne ?? null) }}<span class="muted small"> /20</span></span><span class="hint">{{ mention(res()?.moyenne ?? null, s.school().seuils) }}</span></div>
        <div class="card kpi-card"><span class="label">Rang</span><span class="value">{{ rangLabel(res()?.rang ?? null) }}</span><span class="hint">sur {{ eff() }} élèves</span></div>
        <div class="card kpi-card"><span class="label">Moyenne de la classe</span><span class="value">{{ fnum(s.classStats(k.classId, true)?.avg ?? null) }}</span></div>
      </div>
      <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th>Notes</th><th class="num">Moyenne</th><th class="num">Classe</th><th class="num">Rang</th></tr></thead><tbody>
        @for (r of lines(); track r.id) {
          <tr><td class="cell-main">{{ r.name }}<div class="tiny muted">coef. {{ r.coef }} · {{ r.teacher }}</div></td>
            <td><div class="chips">@for (g of r.grades; track g.t) { <span class="pill" [class.ok]="g.n20 >= 10" [class.bad]="g.n20 < 10" [title]="g.t">{{ g.t }} : {{ fnum(g.v) }}@if (g.b !== 20) {/{{ g.b }}}</span> } @empty { <span class="muted small">—</span> }</div></td>
            <td class="num"><b>{{ fnum(r.moy) }}</b></td><td class="num muted">{{ fnum(r.cm) }}</td><td class="num">{{ rangLabel(r.rang) }}</td></tr>
        }</tbody></table></div></div>
    }
  </div>
  }`,
})
export class NotesView {
  readonly s = inject(Store); readonly fnum = fnum; readonly rangLabel = rangLabel; readonly mention = mention;
  kid = computed(() => this.s.activeChild());
  res = computed(() => { const k = this.kid(); return k ? this.s.resultOf(k.id, true) : undefined; });
  eff = computed(() => this.s.classStats(this.kid()?.classId ?? '', true)?.effectif ?? this.s.studentsByClass().get(this.kid()?.classId ?? '')?.length ?? 0);
  has = computed(() => (this.res()?.subjects ?? []).some((x) => x.moy !== null));
  lines = computed(() => {
    const k = this.kid(); const r = this.res(); if (!k || !r) return [];
    return r.subjects.map((x) => {
      const grades = this.s.evalsFor(k.classId, x.subjectId).filter((e) => e.published)
        .map((e) => ({ t: e.title, v: this.s.grades()[`${e.id}|${k.id}`], b: e.bareme ?? 20 }))
        .filter((g): g is { t: string; v: number; b: number } => g.v !== undefined)
        .map((g) => ({ ...g, n20: sur20(g.v, g.b) }));
      return { id: x.subjectId, name: this.s.subjectById().get(x.subjectId)?.name ?? '', coef: x.coef, teacher: this.s.teacherOf(k.classId, x.subjectId)?.name ?? '', grades, moy: x.moy, cm: x.classMoy, rang: x.rang };
    });
  });
}

@Component({
  selector: 'app-notes',
  imports: [NotesTeacher, NotesAdmin, NotesView],
  template: `@switch (s.role()) { @case ('enseignant') { <app-notes-teacher /> } @case ('admin') { <app-notes-admin /> } @case ('directeur') { <app-notes-admin /> } @case ('fondateur') { <app-notes-admin /> } @case ('personnel') { <app-notes-admin /> } @default { <app-notes-view /> } }`,
})
export class NotesPage { readonly s = inject(Store); }
