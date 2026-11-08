import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store, YEAR_OPEN_MSG } from '../store';
import { Icon, FitHeight, Modal } from '../ui';
import { fnum } from '../format';
import { DECISION_LABEL, DecisionValue, proposeFor, ruleFor } from '../engine';

interface Row {
  id: string; name: string; avg: number | null; terms: number; rang: number | null;
  abs: number; inc: number; prop: { value: DecisionValue | null; label: string; reason: string };
}
/** Situation d'un élève dans le bilan : la décision prise, sinon la proposition. */
type Etat = DecisionValue | 'attente';
const GROUPS: { key: Etat; label: string; hint: string }[] = [
  { key: 'admis', label: 'Admis', hint: 'passent en classe supérieure (anciens élèves en Terminale)' },
  { key: 'conseil', label: 'Conseil à réunir', hint: 'à trancher : admis, redoublement ou exclusion' },
  { key: 'redouble', label: 'Redoublent', hint: 'restent au même niveau' },
  { key: 'exclu', label: 'Exclus', hint: 'renvoi, ou redoublement accordé par la direction' },
  { key: 'attente', label: 'En attente de notes', hint: 'pas encore de moyenne annuelle' },
];

// ---------- Bilan de fin d'année (étape 1 de la nouvelle année) ----------
@Component({
  selector: 'app-decisions',
  imports: [FitHeight, FormsModule, Icon, Modal],
  // Tableau resserré : cellules moins espacées, en-têtes courts (libellé complet au survol), liste de décision de largeur fixe,
  // le commentaire prend la place qui reste : tout tient dans la largeur sans barre de défilement horizontale.
  styles: `
    .dec th, .dec td { padding: 8px 10px; }
    .dec .dec-sel { width: 138px; padding-inline: 8px; }
    .dec .dec-com { width: 100%; }
    .dec .dec-com input { width: 100%; min-width: 120px; }
    .dec td .pill { white-space: nowrap; }
    .dec tr.grp th { text-transform: none; letter-spacing: 0; font-size: 13px; background: var(--surface); color: var(--text); }
    .dec tr.grp th .muted { font-weight: 400; }
    .dec .excl { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
    .syn td, .syn th { padding: 7px 10px; } .syn tr { cursor: pointer; } .syn tr.on td { background: var(--brand-tint); }
  `,
  template: `
  <div [class.page]="!embedded()">
    @if (!embedded()) {
      <div class="page-head"><div><h1>Bilan de fin d’année</h1>
        <p>Pour chaque classe : admis, redoublants et exclus. Les propositions découlent de la moyenne annuelle ; la décision finale appartient à la direction.</p></div></div>
    }
    @if (!s.can('decisions.write')) { <div class="banner info">Consultation seule : les décisions sont prises par la direction.</div> }
    @else if (!s.yearClosed()) { <div class="banner info">{{ yearOpenMsg }} <span>Les propositions ci-dessous sont indicatives.</span></div> }
    <div class="card">
      <div class="card-head"><h2>Synthèse par classe</h2><span class="small muted">Décision prise, sinon proposition. Cliquez sur une classe pour la détailler.</span></div>
      <div class="table-wrap" style="max-height:240px;overflow:auto"><table class="table syn">
        <thead><tr><th>Classe</th><th class="num">Élèves</th><th class="num">Admis</th><th class="num">Conseil</th><th class="num">Redoublent</th><th class="num">Exclus</th><th class="num" title="Élèves dont la décision n’est pas encore enregistrée">À confirmer</th></tr></thead>
        <tbody>@for (c of synthese(); track c.id) {
          <tr [class.on]="c.id === cid()" (click)="pick(c.id)"><td class="cell-main">{{ c.name }}</td><td class="num">{{ c.n }}</td><td class="num">{{ c.admis }}</td><td class="num">{{ c.conseil }}</td>
            <td class="num">{{ c.redouble }}</td><td class="num">@if (c.exclu) { <span class="pill bad">{{ c.exclu }}</span> } @else { 0 }</td>
            <td class="num">@if (c.open) { <span class="pill warn">{{ c.open }}</span> } @else { <span class="pill ok">0</span> }</td></tr>
        }</tbody></table></div>
    </div>
    <div class="card pad row">
      <label class="field"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="pick($event)">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      <p class="small muted grow">Règle de l’école : {{ rule() }}. Un élève qui devrait redoubler un niveau qu’il a déjà redoublé est proposé à l’exclusion.</p>
      @if (s.can('decisions.write')) {
        @if (batchCount()) { <button class="btn" (click)="undo.set(true)"><app-icon name="refresh" [size]="16" /> Annuler la validation</button> }
        <button class="btn primary" [disabled]="!fillable() || !s.yearClosed()" [attr.title]="s.yearClosed() ? null : yearOpenMsg" (click)="validateAll()"><app-icon name="check" [size]="16" /> Valider les propositions de la classe</button>
      }
    </div>
    <div class="card" appFitHeight><div class="table-wrap"><table class="table dec">
      <thead><tr><th>Élève</th><th class="num" title="Moyenne annuelle">Moyenne</th><th class="c">Rang</th><th class="num" title="Absences">Abs.</th><th class="num" title="Incidents de discipline">Inc.</th><th>Proposition</th><th title="Décision de la direction">Décision</th><th class="dec-com">Commentaire</th>@if (s.can('decisions.write')) { <th></th> }</tr></thead>
      <tbody>
        @for (g of grouped(); track g.key) {
          <tr class="grp"><th [attr.colspan]="s.can('decisions.write') ? 9 : 8">{{ g.label }} · {{ g.rows.length }} <span class="muted">— {{ g.hint }}</span></th></tr>
          @for (r of g.rows; track r.id) {
            <tr>
              <td class="cell-main nowrap">{{ r.name }}</td>
              <td class="num"><b>{{ fnum(r.avg) }}</b>@if (r.avg !== null) { <div class="tiny muted nowrap">{{ r.terms }} pér.</div> }</td>
              <td class="c">{{ r.rang ?? '—' }}</td>
              <td class="num">{{ r.abs }}</td>
              <td class="num">{{ r.inc }}</td>
              <td><span class="pill" [class.ok]="r.prop.value === 'admis'" [class.warn]="r.prop.value === 'conseil'" [class.bad]="r.prop.value === 'redouble' || r.prop.value === 'exclu'">{{ r.prop.label }}</span>
                @if (r.prop.reason) { <div class="tiny" style="color:var(--bad)">{{ r.prop.reason }}</div> }</td>
              @if (s.can('decisions.write')) {
                <td><select class="dec-sel" [disabled]="!s.yearClosed()" [ngModel]="valueOf(r.id)" (ngModelChange)="draft(r.id, { v: $event })" [attr.aria-label]="'Décision pour ' + r.name"><option value="">Non décidé</option>@for (k of keys; track k) { <option [value]="k">{{ label[k] }}</option> }</select></td>
                <td class="dec-com"><input [disabled]="!s.yearClosed()" [ngModel]="commentOf(r.id)" (ngModelChange)="draft(r.id, { c: $event })" maxlength="120" placeholder="Facultatif" [attr.aria-label]="'Commentaire pour ' + r.name" /></td>
                <td class="right nowrap">
                  @if (!s.yearClosed()) { <span class="muted">—</span> }
                  @else if (g.key === 'exclu' && !dirty(r.id)) {
                    <div class="excl">
                      <button class="btn sm" (click)="grant.set(r)" title="Accorder un redoublement (motif demandé)" [attr.aria-label]="'Accorder un redoublement à ' + r.name">Redoublement…</button>
                      @if (s.decisionOf(r.id)?.value !== 'exclu') { <button class="btn sm danger" (click)="confirmExclusion(r)" title="Confirmer le renvoi" [attr.aria-label]="'Confirmer le renvoi de ' + r.name">Renvoi</button> }
                    </div>
                  } @else {
                    <button class="btn sm primary" [disabled]="!dirty(r.id)" (click)="save(r.id)" [attr.aria-label]="'Enregistrer la décision de ' + r.name">Enregistrer</button>
                  }
                </td>
              } @else {
                <td>@if (s.decisionOf(r.id); as d) { <span class="pill">{{ label[d.value] }}</span> } @else { <span class="muted">Non décidé</span> }</td>
                <td class="small">{{ s.decisionOf(r.id)?.comment || '—' }}</td>
              }
            </tr>
          }
        } @empty { <tr><td colspan="9" class="empty">Aucun élève dans cette classe.</td></tr> }
      </tbody></table></div></div>
  </div>

  @if (undo()) {
    <app-modal title="Annuler la validation de la classe" (closed)="undo.set(false)">
      <p><b>{{ batchCount() }} décision(s) validée(s) en lot seront retirées pour {{ s.className(cid()) }}.</b></p>
      <p>Les élèves concernés repassent en « Non décidé ». Les décisions prises une à une (renvoi, redoublement accordé…) sont conservées.</p>
      <div footer><button class="btn ghost" (click)="undo.set(false)">Retour</button>
        <button class="btn danger" (click)="cancelBatch()">Annuler la validation</button></div>
    </app-modal>
  }

  @if (grant(); as r) {
    <app-modal title="Accorder un redoublement" (closed)="grant.set(null)">
      <p><b>{{ r.name }}</b>@if (r.prop.reason) { <span class="muted"> ({{ r.prop.reason.toLowerCase() }})</span> } est proposé(e) à l’exclusion.
        La direction peut lui accorder exceptionnellement un redoublement.</p>
      <label class="field" style="margin-top:12px"><span>Motif (obligatoire, visible dans le dossier)</span>
        <input [(ngModel)]="motif" maxlength="100" placeholder="Ex. raisons de santé, engagement écrit de la famille" /></label>
      <div footer><button class="btn ghost" (click)="grant.set(null)">Annuler</button>
        <button class="btn primary" [disabled]="motif.trim().length < 3" (click)="grantRepeat(r)">Accorder le redoublement</button></div>
    </app-modal>
  }`,
})
export class DecisionsPage {
  readonly s = inject(Store); readonly fnum = fnum; readonly label = DECISION_LABEL;
  /** Affichée dans la page « Nouvelle année » (étape 1) : sans titre de page. */
  readonly embedded = input(false);
  readonly keys = Object.keys(DECISION_LABEL) as DecisionValue[];
  level = computed(() => this.s.classById().get(this.cid())?.level);
  rule = computed(() => {
    const r = ruleFor(this.s.school(), this.level());
    return `${fnum(r.admission)} et plus, admission ; de ${fnum(r.redoublement)} à moins de ${fnum(r.admission)}, examen par le conseil ; moins de ${fnum(r.redoublement)}, redoublement proposé${r.exclusion != null ? `, moins de ${fnum(r.exclusion)}, exclusion proposée` : ''}`;
  });
  cid = signal(this.s.classes().find((c) => c.id === 'c3a')?.id ?? this.s.classes()[0]?.id ?? '');
  drafts = signal<Record<string, { v?: string; c?: string }>>({});
  grant = signal<Row | null>(null); motif = '';
  undo = signal(false);
  readonly yearOpenMsg = YEAR_OPEN_MSG;

  pick(id: string): void { this.cid.set(id); this.drafts.set({}); }

  private rowsOf(classId: string): Row[] {
    const level = this.s.classById().get(classId)?.level;
    const list = (this.s.studentsByClass().get(classId) ?? []).map((st) => ({ st, a: this.s.annualAverage(st.id) }));
    const avgs = list.map((x) => x.a.value).filter((v): v is number => v !== null);
    return list.map(({ st, a }) => ({
      id: st.id, name: `${st.nom} ${st.prenoms}`, avg: a.value, terms: a.terms,
      rang: a.value === null ? null : 1 + avgs.filter((v) => v > a.value! + 1e-9).length,
      abs: this.s.absByStudent().get(st.id)?.a ?? 0,
      inc: this.s.incidentsOf(st.id).filter((i) => i.status !== 'refuse').length,
      prop: proposeFor(a.value, this.s.school(), level, st.niveauxRedoubles ?? []),
    }));
  }
  /** Situation retenue : la décision enregistrée, sinon la proposition. */
  private etat(r: Row): Etat { return this.s.decisionOf(r.id)?.value ?? r.prop.value ?? 'attente'; }

  rows = computed<Row[]>(() => this.rowsOf(this.cid()));
  grouped = computed(() => {
    const rows = this.rows();
    return GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => this.etat(r) === g.key).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)) })).filter((g) => g.rows.length);
  });
  synthese = computed(() => this.s.classes().map((c) => {
    const rows = this.rowsOf(c.id);
    const n = { admis: 0, conseil: 0, redouble: 0, exclu: 0, attente: 0 } as Record<Etat, number>;
    for (const r of rows) n[this.etat(r)]++;
    return { id: c.id, name: c.name, n: rows.length, ...n, open: rows.filter((r) => !this.s.decisionOf(r.id)).length };
  }).filter((c) => c.n > 0));
  fillable = computed(() => this.rows().some((r) => !this.s.decisionOf(r.id) && r.prop.value));
  /** Décisions de la classe enregistrées par « Valider les propositions de la classe ». */
  batchCount = computed(() => this.rows().filter((r) => this.s.decisionOf(r.id)?.batch).length);

  valueOf(id: string): string { return this.drafts()[id]?.v ?? this.s.decisionOf(id)?.value ?? ''; }
  commentOf(id: string): string { return this.drafts()[id]?.c ?? this.s.decisionOf(id)?.comment ?? ''; }
  draft(id: string, p: { v?: string; c?: string }): void { this.drafts.update((d) => ({ ...d, [id]: { ...d[id], ...p } })); }
  dirty(id: string): boolean {
    const v = this.valueOf(id);
    return !!v && (v !== (this.s.decisionOf(id)?.value ?? '') || this.commentOf(id).trim() !== (this.s.decisionOf(id)?.comment ?? ''));
  }
  private clear(id: string): void { this.drafts.update((d) => { const n = { ...d }; delete n[id]; return n; }); }
  async save(id: string): Promise<void> {
    const v = this.valueOf(id) as DecisionValue;
    if (!v || !(await this.s.setDecisionAsync(id, v, this.commentOf(id)))) return;
    this.clear(id);
    this.s.toast('Décision enregistrée, la famille est informée.');
  }
  async confirmExclusion(r: Row): Promise<void> {
    if (!(await this.s.setDecisionAsync(r.id, 'exclu', r.prop.reason || this.commentOf(r.id)))) return;
    this.clear(r.id);
    this.s.toast(`Renvoi confirmé pour ${r.name}.`);
  }
  async grantRepeat(r: Row): Promise<void> {
    const motif = this.motif.trim();
    if (motif.length < 3) return;
    if (!(await this.s.setDecisionAsync(r.id, 'redouble', `Redoublement accordé : ${motif}`))) return;
    this.clear(r.id); this.grant.set(null); this.motif = '';
    this.s.toast(`Redoublement accordé à ${r.name}.`);
  }
  async validateAll(): Promise<void> {
    let n = 0;
    for (const r of this.rows()) {
      if (this.s.decisionOf(r.id) || !r.prop.value) continue;
      if (await this.s.setDecisionAsync(r.id, r.prop.value, r.prop.reason, true, true)) n++;
    }
    if (n && !this.s.apiMode()) this.s.addLog('Décisions de fin d\'année', `Propositions validées pour ${this.s.className(this.cid())} (${n} élève(s))`);
    this.drafts.set({});
    this.s.toast(n ? `${n} décision(s) enregistrée(s).` : 'Aucune proposition à valider.', n ? 'ok' : 'info');
  }
  async cancelBatch(): Promise<void> {
    const n = await this.s.cancelBatchAsync(this.cid());
    this.undo.set(false);
    if (n === null) return;
    this.drafts.set({});
    this.s.toast(n ? `Validation annulée : ${n} décision(s) retirée(s).` : 'Aucune décision validée en lot dans cette classe.', n ? 'ok' : 'info');
  }
}
