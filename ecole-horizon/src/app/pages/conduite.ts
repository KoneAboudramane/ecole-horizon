import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal, FitHeight } from '../ui';
import { dateFr, fnum } from '../format';
import { ConductRow, ConductSheet, DEFAULT_BAREMES, Educator, SANCTION_LABEL, Sanction } from '../models';

/** Note de conduite : maximum de l'école moins les retraits de points de la période (absences non justifiées, sanctions, autres). */
@Component({
  selector: 'app-conduite',
  imports: [FitHeight, FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Conduite</h1><p>Chaque élève part de la note maximale ; vous retirez des points pour les absences non justifiées et les sanctions, à votre appréciation.</p></div></div>
    <div class="card pad"><div class="row">
      <label class="field"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cid.set($event)" name="cl">@for (c of s.scopeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      <label class="field"><span>Période</span><select [ngModel]="s.termId()" (ngModelChange)="changeTerm($event)" name="tm">@for (t of s.terms(); track t.id) { <option [value]="t.id">{{ t.label }}</option> }</select></label>
    </div></div>
    @if (err()) { <div class="banner bad" role="alert">{{ err() }}</div> }
    @if (sheet(); as sh) {
      @if (sh.locked) { <div class="banner warn"><app-icon name="lock" [size]="18" /> Cette période est verrouillée : seule la direction peut modifier la conduite.</div> }
      <div class="grid kpi">
        <div class="card kpi-card"><span class="label">Note de départ</span><span class="value">{{ fnum(sh.max, 0) }}</span><span class="hint">{{ sh.inAverage ? 'compte dans la moyenne, coef. ' + sh.coef : 'hors moyenne générale' }}</span></div>
        <div class="card kpi-card"><span class="label">Moyenne de conduite de la classe</span><span class="value">{{ fnum(avg(), 1) }}</span></div>
        <div class="card kpi-card" [class.alert]="toApply() > 0"><span class="label">Retraits d’absences à appliquer</span><span class="value">{{ toApply() }}</span><span class="hint">élève(s)</span></div>
      </div>
      <div class="card pad stack">
        <div class="row" style="justify-content:space-between">
          <div>
            @if (sh.rule.tranche > 0) { <b>Règle de l’école :</b> <span>{{ sh.rule.tranche }} demi-journée(s) d’absence non justifiée = −{{ fnum(sh.rule.points, 1) }} point.</span>
              <div class="small muted">Plusieurs cours manqués la même demi-journée comptent pour une seule absence. Une absence justifiée ne compte pas.</div> }
            @else { <span class="muted">L’école n’a pas fixé de règle pour les absences : retirez les points à la main.</span> }
          </div>
          <div class="row">
            @if (sh.rule.tranche > 0) { <button class="btn" [disabled]="sh.locked && !s.can('grades.locked')" (click)="apply()">Appliquer aux absences non justifiées</button> }
            @if (s.can('publish')) {
              <button class="btn" [class.primary]="!sh.published" (click)="publish(!sh.published)">{{ sh.published ? 'Retirer la publication' : 'Publier aux familles' }}</button> }
          </div>
        </div>
        @if (sh.published) { <span class="pill ok" style="align-self:flex-start">Publiée : visible des familles sur le bulletin</span> }
        @else { <span class="pill warn" style="align-self:flex-start">Brouillon : les familles ne voient pas encore la conduite</span> }
      </div>
      <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Élève</th><th class="num">Absences non justifiées</th><th class="num">Retrait dû</th><th class="num">Points retirés</th><th class="num">Note /{{ fnum(sh.max, 0) }}</th><th></th></tr></thead><tbody>
        @for (r of sh.students; track r.studentId) {
          <tr><td class="cell-main">{{ r.name }}</td>
            <td class="num">{{ r.halfdays }} <span class="tiny muted">demi-j.</span></td>
            <td class="num">@if (sh.rule.tranche > 0) { <span [class.warn-text]="r.due !== r.applied">−{{ fnum(r.due, 1) }}</span>@if (r.due !== r.applied) { <div class="tiny muted">appliqué : −{{ fnum(r.applied, 1) }}</div> } } @else { — }</td>
            <td class="num">−{{ fnum(r.removed, 1) }}</td>
            <td class="num"><b [class.bad-text]="r.note < sh.max / 2">{{ fnum(r.note, 1) }}</b></td>
            <td class="right nowrap"><button class="btn sm ghost" (click)="toggle(r.studentId)">{{ open() === r.studentId ? 'Masquer' : 'Détail' }}</button>
              <button class="btn sm" [disabled]="sh.locked && !s.can('grades.locked')" (click)="openAdd(r)">Retirer des points</button></td></tr>
          @if (open() === r.studentId) {
            <tr><td colspan="6" style="background:var(--surface-2)">
              @for (d of r.deductions; track d.id) {
                <div class="row small" style="padding:4px 0">
                  <span class="muted" style="min-width:90px">{{ dateFr(d.date) }}</span><b>−{{ fnum(d.points, 1) }}</b><span class="grow">{{ d.reason }}</span>
                  @if (d.pending) { <span class="pill warn">En attente de la direction : ne compte pas encore</span> }
                  @if (d.refused) { <span class="pill">Sanction refusée : ne compte pas</span> }
                  <span class="tiny muted">{{ d.byName }}</span>
                  <button class="btn sm ghost" (click)="remove(d.id)" [attr.aria-label]="'Annuler le retrait de ' + r.name">Annuler</button>
                </div>
              } @empty { <span class="small muted">Aucun retrait : note maximale.</span> }
            </td></tr>
          }
        } @empty { <tr><td colspan="6" class="empty">Aucun élève dans cette classe.</td></tr> }</tbody></table></div></div>
    }
  </div>
  @if (adding(); as a) {
    <app-modal title="Retirer des points de conduite" (closed)="adding.set(null)">
      <div class="stack">
        <p><b>{{ a.row.name }}</b></p><p class="small muted">Note actuelle : {{ fnum(a.row.note, 1) }} / {{ fnum(a.row.max, 0) }}</p>
        <div class="field"><span>Suggestions (modifiables)</span><div class="chips">@for (k of sanctions; track k) { <button type="button" class="chip" (click)="suggest(k)">{{ sancLabel[k] }} −{{ fnum(bareme(k), 1) }}</button> }</div></div>
        <div class="form-grid">
          <label class="field"><span>Points à retirer</span><input type="number" min="0.5" max="20" step="0.5" [(ngModel)]="pts" name="pt" /></label>
          <label class="field"><span>Date</span><input type="date" [(ngModel)]="when" [max]="s.today" name="dt" /></label>
        </div>
        <label class="field"><span>Motif</span><input [(ngModel)]="why" name="mo" placeholder="Ex. : retards répétés, tenue non conforme…" />@if (addErr()) { <span class="err">{{ addErr() }}</span> }</label>
      </div>
      <div footer><button class="btn ghost" (click)="adding.set(null)">Annuler</button><button class="btn primary" (click)="addSave()">Retirer {{ pts }} point(s)</button></div>
    </app-modal>
  }`,
  styles: '.warn-text { color: var(--warn, #b45309); font-weight: 600; } .bad-text { color: var(--bad); }',
})
export class ConduitePage {
  readonly s = inject(Store); readonly fnum = fnum; readonly dateFr = dateFr; readonly sancLabel = SANCTION_LABEL;
  readonly sanctions = Object.keys(SANCTION_LABEL) as Sanction[];
  cid = signal(this.s.scopeClasses()[0]?.id ?? '');
  sheet = signal<ConductSheet | null>(null); err = signal(''); open = signal<string | null>(null);
  adding = signal<{ row: ConductRow } | null>(null); pts = 1; why = ''; when = this.s.today; addErr = signal('');
  avg = computed(() => { const l = this.sheet()?.students ?? []; return l.length ? l.reduce((a, r) => a + r.note, 0) / l.length : null; });
  toApply = computed(() => (this.sheet()?.students ?? []).filter((r) => r.due !== r.applied).length);
  constructor() {
    effect(() => { const c = this.cid(); this.s.termId(); if (c) untracked(() => void this.load()); });
  }
  async load(): Promise<void> {
    const r = await this.s.conductAsync(this.cid());
    this.err.set(r.error ?? ''); this.sheet.set(r.sheet ?? null);
  }
  async changeTerm(t: string): Promise<void> { await this.s.setTerm(t as never); }
  toggle(id: string): void { this.open.update((o) => (o === id ? null : id)); }
  bareme = (k: string) => this.s.school().conduiteBaremes?.[k] ?? DEFAULT_BAREMES[k] ?? 1;
  openAdd(row: ConductRow): void { this.pts = 1; this.why = ''; this.when = this.s.today; this.addErr.set(''); this.adding.set({ row }); }
  suggest(k: Sanction): void { this.pts = this.bareme(k); this.why = this.sancLabel[k]; }
  async addSave(): Promise<void> {
    const a = this.adding(); if (!a) return;
    const pts = Number(String(this.pts).replace(',', '.'));
    if (!(pts >= 0.1 && pts <= 20)) return void this.addErr.set('Indiquez un nombre de points entre 0,1 et 20.');
    if (this.why.trim().length < 3) return void this.addErr.set('Indiquez le motif.');
    const r = await this.s.addDeductionAsync({ studentId: a.row.studentId, points: pts, reason: this.why.trim(), date: this.when });
    if (!r.ok) return void this.addErr.set(r.error ?? 'Enregistrement impossible.');
    this.adding.set(null); this.open.set(a.row.studentId); await this.load();
    this.s.toast(`−${fnum(pts, 1)} point(s) de conduite pour ${a.row.name}.`);
  }
  async remove(id: string): Promise<void> {
    const r = await this.s.removeDeductionAsync(id);
    if (!r.ok) return void this.s.toast(r.error ?? 'Annulation impossible.', 'err');
    await this.load(); this.s.toast('Retrait annulé.');
  }
  async apply(): Promise<void> {
    const r = await this.s.applyAbsencesAsync(this.cid());
    if (r.error) return void this.s.toast(r.error, 'err');
    await this.load(); this.s.toast(r.updated ? `Retraits d’absences appliqués (${r.updated} élève(s)).` : 'Rien à changer : les retraits sont à jour.');
  }
  async publish(v: boolean): Promise<void> {
    const r = await this.s.publishConductAsync(v);
    if (!r.ok) return void this.s.toast(r.error ?? 'Action impossible.', 'err');
    await this.load(); this.s.toast(v ? 'Notes de conduite publiées : les familles sont prévenues.' : 'Publication retirée.');
  }
}

/** Direction et secrétariat : classes confiées à chaque éducateur. Un éducateur sans classe garde la vue de toute l'école. */
@Component({
  selector: 'app-educateurs',
  imports: [FormsModule],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Éducateurs et leurs classes</h1><p>Chaque éducateur ne gère que les classes qui lui sont confiées : appel, justificatifs, discipline et conduite. Sans classe attribuée, il voit toute l’école.</p></div></div>
    @if (loaded() && !list().length) { <div class="card empty">Aucun compte éducateur. Créez-le dans « Comptes ».</div> }
    @for (e of list(); track e.id) {
      <div class="card pad stack">
        <div class="row"><h3 class="grow">{{ e.name }}</h3>
          @if (e.classes.length) { <span class="pill ok">{{ e.classes.length }} classe(s)</span> } @else { <span class="pill warn">Toute l’école</span> }</div>
        <div class="chips" role="group" [attr.aria-label]="'Classes de ' + e.name">@for (c of s.classes(); track c.id) {
          <button type="button" class="chip" [class.on]="e.classes.includes(c.id)" (click)="toggle(e, c.id)">{{ c.name }}</button> }</div>
        <div class="row"><button class="btn primary" [disabled]="!dirty(e)" (click)="save(e)">Enregistrer</button>
          <button class="btn ghost" [disabled]="!e.classes.length" (click)="clear(e)">Retirer toutes les classes</button></div>
      </div>
    }
  </div>`,
})
export class EducateursPage {
  readonly s = inject(Store);
  list = signal<Educator[]>([]); loaded = signal(false); private saved = new Map<string, string>();
  constructor() { void this.load(); }
  async load(): Promise<void> {
    const l = await this.s.educatorsAsync();
    this.saved = new Map(l.map((e) => [e.id, [...e.classes].sort().join(',')]));
    this.list.set(l); this.loaded.set(true);
  }
  dirty = (e: Educator) => [...e.classes].sort().join(',') !== (this.saved.get(e.id) ?? '');
  toggle(e: Educator, cid: string): void {
    this.list.update((l) => l.map((x) => (x.id === e.id ? { ...x, classes: x.classes.includes(cid) ? x.classes.filter((c) => c !== cid) : [...x.classes, cid] } : x)));
  }
  clear(e: Educator): void { this.list.update((l) => l.map((x) => (x.id === e.id ? { ...x, classes: [] } : x))); }
  async save(e: Educator): Promise<void> {
    const cur = this.list().find((x) => x.id === e.id)!;
    const r = await this.s.setEducatorClassesAsync(e.id, cur.classes);
    if (!r.ok) return void this.s.toast(r.error ?? 'Enregistrement impossible.', 'err');
    this.saved.set(e.id, [...cur.classes].sort().join(','));
    this.list.update((l) => [...l]);
    this.s.toast(`Classes de ${e.name} enregistrées.`);
  }
}

/** Réglages de la conduite (Paramètres) : note maximale, place dans la moyenne, règle des absences, retraits conseillés. */
@Component({
  selector: 'app-conduite-reglages',
  imports: [FormsModule],
  template: `
  <div class="card pad stack"><h2>Conduite</h2>
    <div class="form-grid">
      <label class="field"><span>Note de conduite maximale (départ)</span><input type="number" min="1" max="100" step="1" [(ngModel)]="f.max" name="cm" /></label>
      <label class="field"><span>Coefficient dans la moyenne générale</span><input type="number" min="0.5" max="10" step="0.5" [(ngModel)]="f.coef" name="cc" [disabled]="!f.inAvg" /></label>
    </div>
    <label class="row"><input type="checkbox" [(ngModel)]="f.inAvg" name="ia" /> La conduite entre dans la moyenne générale</label>
    <div class="form-grid">
      <label class="field"><span>Demi-journées d’absence non justifiée par retrait (0 : aucune règle)</span><input type="number" min="0" max="50" step="1" [(ngModel)]="f.tranche" name="tr" /></label>
      <label class="field"><span>Points retirés par tranche</span><input type="number" min="0.5" max="20" step="0.5" [(ngModel)]="f.pts" name="ap" /></label>
      <label class="field"><span>Délai pour justifier une absence, en jours (0 : sans délai)</span><input type="number" min="0" max="90" step="1" [(ngModel)]="f.delai" name="jd" /></label>
    </div>
    <p class="small muted">Passé ce délai, la famille ne peut plus envoyer de justificatif depuis son espace ; l’éducateur ou la direction peut encore en saisir un.</p>
    <div class="field"><span>Retraits conseillés par sanction (l’éducateur reste libre de décider)</span>
      <div class="form-grid">@for (k of sanctions; track k) { <label class="field"><span class="small">{{ sancLabel[k] }}</span><input type="number" min="0" max="20" step="0.5" [ngModel]="f.bar[k]" (ngModelChange)="f.bar[k] = $event" [name]="'b' + k" /></label> }</div></div>
    @if (err()) { <div class="banner bad" role="alert">{{ err() }}</div> }
    <div><button class="btn primary" (click)="save()">Enregistrer les règles de conduite</button></div>
  </div>`,
})
export class ConduiteReglages {
  readonly s = inject(Store); readonly sancLabel = SANCTION_LABEL; readonly sanctions = Object.keys(SANCTION_LABEL) as Sanction[];
  err = signal('');
  f = (() => {
    const c = this.s.school();
    return { max: c.conduiteMax ?? 20, coef: c.conduiteCoef ?? 1, inAvg: c.conduiteInAverage ?? true, tranche: c.absenceTranche ?? 3, pts: c.absencePoints ?? 1, delai: c.justifDelai ?? 0,
      bar: Object.fromEntries(Object.keys(SANCTION_LABEL).map((k) => [k, c.conduiteBaremes?.[k] ?? DEFAULT_BAREMES[k] ?? 1])) as Record<string, number> };
  })();
  async save(): Promise<void> {
    const r = await this.s.saveSettingsAsync({
      conduiteMax: Number(this.f.max), conduiteCoef: Number(this.f.coef), conduiteInAverage: this.f.inAvg, absenceTranche: Math.round(Number(this.f.tranche) || 0),
      absencePoints: Number(this.f.pts), justifDelai: Math.max(0, Math.round(Number(this.f.delai) || 0)), conduiteBaremes: Object.fromEntries(Object.entries(this.f.bar).map(([k, v]) => [k, Number(v) || 0])),
    });
    this.err.set(r.error ?? '');
    if (r.ok) { await this.s.loadTerm(); this.s.toast('Règles de conduite enregistrées. Les moyennes sont recalculées.'); }
  }
}
