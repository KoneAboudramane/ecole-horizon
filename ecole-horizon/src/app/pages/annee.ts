import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store, RolloverPlan, RolloverRow, PlacementState, PlacementStudent } from '../store';
import { Icon, FitHeight, Modal } from '../ui';
import { dateFr, fnum, fcfa } from '../format';
import { DECISION_LABEL, DecisionValue } from '../engine';
import { DecisionsPage } from './decisions';

interface Line extends RolloverRow { sel: string; }
type Step = 1 | 2 | 3 | 4 | 5;
type Etat = 'paye' | 'attente' | 'valide' | 'tous';

// ---------- Fin d'année et nouvelle année : bilan → passage → répartition ----------
@Component({
  selector: 'app-annee',
  imports: [FormsModule, Icon, DecisionsPage, Modal, NgTemplateOutlet],
  styles: `
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; list-style: none; padding: 0; margin: 0; }
    .step { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); cursor: pointer; }
    .step .n { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--surface-2); font-weight: 700; }
    .step.on { border-color: var(--brand); box-shadow: inset 0 0 0 1px var(--brand); } .step.on .n { background: var(--brand); color: #fff; }
    .step.done .n { background: var(--ok-tint); color: var(--ok); }
    .step b { display: block; } .step span.small { color: var(--muted); }
    .rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
    .room { padding: 12px 14px; } .room .meter { margin: 8px 0 4px; }
    @media (max-width: 760px) { .steps { grid-template-columns: 1fr; } }
  `,
  template: `
  <div class="page">
    <div class="page-head"><div><h1>{{ full ? 'Fin d’année et nouvelle année' : 'Répartition des élèves' }}</h1>
      <p>@if (full) { Le bilan de chaque classe, le passage dans la nouvelle année, la validation des réinscriptions, les effectifs par niveau, puis la répartition dans les classes. }
        @else { Validez les réinscriptions sur présentation du reçu, vérifiez les effectifs par niveau, puis répartissez les élèves dans les classes. }</p></div></div>

    <ol class="steps" aria-label="Étapes">
      @for (st of steps(); track st.n) {
        <li><button type="button" class="step" [class.on]="step() === st.n" [class.done]="st.done" (click)="go(st.n)" [attr.aria-current]="step() === st.n ? 'step' : null">
          <span class="n">@if (st.done) { <app-icon name="check" [size]="16" /> } @else { {{ st.n }} }</span>
          <span><b>{{ st.title }}</b><span class="small">{{ st.state }}</span></span></button></li>
      }
    </ol>
    @if (msg()) { <div class="banner ok">{{ msg() }}</div> }
    @if (err()) { <div class="banner bad">{{ err() }}</div> }
    @if (plan()?.last; as l) {
      <div class="card pad row">
        <p class="grow small">Le passage <b>{{ l.from_year }} → {{ l.to_year }}</b> a été appliqué le {{ when(l.date) }}.
          @if (l.can_undo) { Vous pouvez encore l’annuler tant que la nouvelle année est vide. } @else { <span class="muted">{{ l.reason }}</span> }</p>
        @if (l.can_undo) { <button class="btn" [disabled]="busy()" (click)="undo()">Annuler ce passage</button> }
      </div>
    }

    @switch (step()) {
      @case (1) {
        <app-decisions [embedded]="true" />
        <div class="card pad row"><p class="grow small">Quand le bilan de toutes les classes est fait (colonne « À confirmer » à 0), passez au passage dans la nouvelle année.</p>
          <button class="btn primary" (click)="go(2)">Étape suivante : le passage <app-icon name="chevron" [size]="16" /></button></div>
      }
      @case (2) {
        @if (plan(); as p) {
          @if (p.last) {
            <div class="card pad row"><p class="grow">Le passage vers <b>{{ p.last.to_year }}</b> est déjà fait. Il reste à répartir les élèves dans les classes.</p>
              <button class="btn primary" (click)="go(3)">Aller à la répartition</button></div>
          } @else {
            <div class="card pad stack">
              <div class="row">
                <label class="field"><span>Année qui se termine</span><input [value]="p.from_year" disabled /></label>
                <label class="field"><span>Nouvelle année</span><input name="to" [(ngModel)]="toYear" placeholder="2027-2028" /></label>
                <p class="small muted grow">Chaque élève qui reste est inscrit à son nouveau niveau (supérieur, ou le même s’il redouble), <b>sans classe</b> : la classe se choisit à l’étape 3.
                  Les périodes et les échéances sont reprises avec un an de plus, l’année qui se termine est verrouillée et le solde impayé de chacun est reporté.</p>
              </div>
            </div>
            <div class="grid kpi">
              @for (k of kpis(); track k.key) { <div class="card kpi-card"><span class="label">{{ k.label }}</span><span class="value">{{ k.n }}</span></div> }
              <div class="card kpi-card" [class.alert]="missing() > 0"><span class="label">Sans décision</span><span class="value">{{ missing() }}</span><span class="hint">à régler à l’étape 1</span></div>
            </div>
            @for (g of groups(); track g.id) {
              <div class="card">
                <div class="card-head"><h2>{{ g.name }} <span class="muted small">· {{ g.lines.length }} élève(s)</span></h2></div>
                <div class="table-wrap"><table class="table">
                  <thead><tr><th>Élève</th><th class="num">Moyenne</th><th>Bilan</th><th>Que devient l’élève ?</th><th>L’an prochain</th></tr></thead>
                  <tbody>@for (r of g.lines; track r.student) {
                    <tr>
                      <td class="cell-main nowrap">{{ r.name }}</td>
                      <td class="num"><b>{{ fnum(r.annual_avg) }}</b></td>
                      <td>@if (r.decision) { <span class="pill">{{ lbl(r.decision) }}</span> } @else if (r.proposal) { <span class="pill warn" title="Proposition non confirmée">{{ lbl(r.proposal) }} ?</span> } @else { <span class="muted">En attente de notes</span> }
                        @if (r.reason) { <div class="tiny" style="color:var(--bad)">{{ r.reason }}</div> }</td>
                      <td><select [ngModel]="r.sel" (ngModelChange)="setAction(r.student, $event)" [attr.aria-label]="'Destination de ' + r.name">
                        @for (a of actionsFor(r); track a) { <option [value]="a">{{ a ? p.actions[a] : 'Choisir…' }}</option> }</select></td>
                      <td>{{ nextYear(r) }}</td>
                    </tr>
                  }</tbody></table></div>
              </div>
            } @empty { <div class="card pad empty">Aucun élève à faire passer.</div> }
            @if (lines().length) {
              <div class="card pad stack">
                @if (!confirming()) {
                  <div class="row"><p class="grow small">@if (missing()) { {{ missing() }} élève(s) sans destination : choisissez-la ci-dessus ou réglez leur cas à l’étape 1. } @else { Tout est prêt. }</p>
                    <button class="btn primary" [disabled]="missing() > 0 || busy()" (click)="confirming.set(true)"><app-icon name="check" [size]="16" /> Vérifier et appliquer</button></div>
                } @else {
                  <h2>Confirmer le passage {{ p.from_year }} → {{ toYear }}</h2>
                  <ul>@for (k of kpis(); track k.key) { <li>{{ k.n }} · {{ k.label }}</li> }</ul>
                  <p class="small">La nouvelle année sera créée et deviendra l’année en cours. Les élèves qui restent seront « à placer » jusqu’à l’étape 3.
                    Vous pourrez annuler tant qu’aucun nouvel élève, paiement ou note n’y aura été enregistré.</p>
                  <div class="row"><button class="btn" (click)="confirming.set(false)">Revenir à la correction</button>
                    <button class="btn primary" [disabled]="busy()" (click)="apply()">Appliquer le passage</button></div>
                }
              </div>
            }
          }
        } @else if (!err()) { <div class="card pad muted">Chargement…</div> }
      }
      @case (3) {
        @if (place(); as st) {
          @if (!st.total) { <ng-container *ngTemplateOutlet="none" /> }
          @else {
            <div class="grid kpi">
              <div class="card kpi-card"><span class="label">Réinscriptions validées</span><span class="value">{{ st.confirmed }}</span></div>
              <div class="card kpi-card" [class.alert]="st.paid > 0"><span class="label">Payé, à valider</span><span class="value">{{ st.paid }}</span><span class="hint">reçu à vérifier</span></div>
              <div class="card kpi-card"><span class="label">En attente de paiement</span><span class="value">{{ st.waiting }}</span></div>
            </div>
            <div class="card">
              <div class="card-head">
                <div class="row">
                  <input type="search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Nom, matricule ou n° de reçu" style="width:240px" aria-label="Rechercher" />
                  <div class="chips" role="group" aria-label="Filtrer">
                    @for (f of filters; track f.key) { <button class="chip" [class.on]="filter() === f.key" (click)="filter.set(f.key)">{{ f.label }} ({{ countState(f.key) }})</button> }
                  </div>
                </div>
                <div class="row">
                  @if (st.paid) { <button class="btn primary" [disabled]="busy()" (click)="validateAllPaid()"><app-icon name="check" [size]="16" /> Valider tous ceux qui ont payé ({{ st.paid }})</button> }
                  @if (st.waiting) { <button class="btn danger" [disabled]="busy()" (click)="departing.set(true)">Non-réinscrits : marquer comme partis ({{ st.waiting }})</button> }
                </div>
              </div>
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Élève</th><th>Niveau</th><th>Venant de</th><th>Paiement de la nouvelle année</th><th>Réinscription</th><th></th></tr></thead>
                <tbody>@for (x of reRows(); track x.student) {
                  <tr><td class="cell-main nowrap">{{ x.name }}<div class="tiny muted">{{ x.matricule }}</div></td><td>{{ x.level }}</td>
                    <td [class.muted]="!x.from_class">{{ x.from_name }}</td>
                    <td>@if (x.receipts.length) {
                        <b>{{ fcfa(x.paid) }}</b>
                        @for (r of x.receipts; track r.id) { <div class="tiny"><button class="link" (click)="openReceipt(r.id, r.receipt_no)" [attr.aria-label]="'Ouvrir le reçu ' + r.receipt_no">{{ r.receipt_no }}</button> · {{ fcfa(r.amount) }} · {{ dateFr(r.date) }}</div> }
                      } @else { <span class="muted">Aucun paiement</span> }</td>
                    <td>@switch (x.state) {
                        @case ('valide') { <span class="pill ok">Validée</span>@if (x.note) { <div class="tiny muted">{{ x.note }}</div> } }
                        @case ('paye') { <span class="pill warn">Payé, à valider</span> }
                        @default { <span class="pill">En attente</span> } }</td>
                    <td class="right nowrap">@switch (x.state) {
                        @case ('valide') { <button class="btn sm ghost" [disabled]="busy()" (click)="unvalidate(x.student)">Annuler</button> }
                        @case ('paye') { <button class="btn sm primary" [disabled]="busy()" (click)="validate(x.student)">Valider</button> }
                        @default { <button class="btn sm" [disabled]="busy()" (click)="noPay.set(x)">Valider sans paiement…</button> } }</td></tr>
                } @empty { <tr><td colspan="6" class="empty">Aucun élève pour ce filtre.</td></tr> }</tbody></table></div>
            </div>
            <p class="small muted">Le comptable encaisse et remet le reçu ; la famille le présente au secrétariat, qui vérifie le paiement (cliquez sur le n° pour ouvrir le reçu) et valide.
              Sans paiement (boursier, enfant du personnel…), « Valider sans paiement » demande un motif. Seuls les élèves validés sont répartis.</p>
          }
        } @else if (!err()) { <div class="card pad muted">Chargement…</div> }
      }
      @case (4) {
        @if (place(); as st) {
          @if (!st.total) { <ng-container *ngTemplateOutlet="none" /> }
          @else {
            <div class="card"><div class="card-head"><h2>Effectifs par niveau</h2><span class="small muted">Élèves réinscrits face aux places des classes : ouvrez une classe s’il en manque.</span></div>
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Niveau</th><th class="num">Validés</th><th class="num" title="Payé, à valider">Payé</th><th class="num" title="En attente de paiement">En attente</th><th>Classes</th><th class="num">Places libres</th><th>Résultat</th><th></th></tr></thead>
                <tbody>@for (r of effectifs(); track r.level) {
                  <tr><td class="cell-main">{{ r.level }}</td><td class="num"><b>{{ r.valides }}</b></td><td class="num">{{ r.payes }}</td><td class="num muted">{{ r.attente }}</td>
                    <td class="small">@for (c of r.classes; track c.id) { <div>{{ c.name }} · {{ c.count }} / {{ c.max }}</div> } @empty { <span class="muted">Aucune classe</span> }</td>
                    <td class="num">{{ r.libres }}</td>
                    <td>@if (r.manque > 0) { <span class="pill bad">Il manque {{ r.manque }} place(s)</span><div class="tiny muted">{{ r.creer }} classe(s) à ouvrir</div> }
                        @else { <span class="pill ok">{{ -r.manque }} place(s) de reste</span>@if (r.attente) { <div class="tiny muted">+ {{ r.attente }} élève(s) qui peuvent encore revenir</div> } }</td>
                    <td class="right">@if (s.can('classes.write')) { <button class="btn sm" [class.primary]="r.manque > 0" (click)="openNewClass(r.level)">Créer une classe</button> }</td></tr>
                }</tbody></table></div></div>
            <p class="small muted">« Validés » et « Payé » comptent comme présents ; ceux « en attente » peuvent encore se réinscrire. @if (!s.can('classes.write')) { La création d’une classe est faite par le secrétariat. }</p>
            <div class="row"><span class="grow"></span><button class="btn primary" (click)="go(5)">Étape suivante : la répartition <app-icon name="chevron" [size]="16" /></button></div>
          }
        } @else if (!err()) { <div class="card pad muted">Chargement…</div> }
      }
      @case (5) {
        @if (place(); as st) {
          @if (!st.total) { <ng-container *ngTemplateOutlet="none" /> }
          @else {
            <div class="chips" role="group" aria-label="Niveau">
              @for (lv of st.levels; track lv.level) { <button class="chip" [class.on]="lv.level === level()" (click)="pickLevel(lv.level)">{{ lv.level }} · {{ countOf(lv, true) }} validé(s)@if (countOf(lv, false)) { <span style="opacity:.75"> + {{ countOf(lv, false) }} non validé(s)</span> }</button> }
            </div>
            @if (cur(); as lv) {
              @if (!lv.classes.length) { <div class="banner warn">Aucune classe de niveau {{ lv.level }} : créez-la à l’étape « Effectifs ».</div> }
              <div class="rooms">
                @for (c of rooms(); track c.id) {
                  <div class="card room"><b>{{ c.name }}</b>
                    <div class="meter" [class.bad]="c.total > c.max"><span [style.width.%]="Math.min(100, c.total / c.max * 100)"></span></div>
                    <div class="small">{{ c.total }} / {{ c.max }} places @if (c.added) { <span class="muted">(+{{ c.added }})</span> }</div>
                    <div class="tiny muted">{{ c.f }} fille(s) · {{ c.m }} garçon(s)</div></div>
                }
              </div>
              <div class="card">
                <div class="card-head"><h2>{{ lv.level }} : {{ lv.students.length }} élève(s) à placer</h2>
                  <div class="row"><button class="btn" [disabled]="busy() || !lv.classes.length" (click)="auto()"><app-icon name="refresh" [size]="16" /> Répartir équitablement</button>
                    <button class="btn ghost" [disabled]="!chosen()" (click)="assign.set({})">Tout effacer</button>
                    <button class="btn primary" [disabled]="busy() || !chosen()" (click)="save()">Enregistrer ({{ chosen() }})</button></div></div>
                <div class="table-wrap"><table class="table">
                  <thead><tr><th>Élève</th><th>Sexe</th><th>Venant de</th><th>Réinscription</th><th>Classe l’an prochain</th></tr></thead>
                  <tbody>@for (x of sorted(lv.students); track x.student) {
                    <tr><td class="cell-main nowrap">{{ x.name }}<div class="tiny muted">{{ x.matricule }}</div></td><td>{{ x.sexe === 'F' ? 'Fille' : 'Garçon' }}</td>
                      <td [class.muted]="!x.from_class">{{ x.from_name }}@if (x.repeat) { <span class="pill warn" style="margin-inline-start:6px">Redouble</span> }</td>
                      <td>@if (x.reinscrit) { <span class="pill ok">Validée</span> } @else if (x.state === 'paye') { <span class="pill warn">Payé, à valider</span> } @else { <span class="pill">En attente</span> }</td>
                      <td><select [ngModel]="assign()[x.student] ?? ''" (ngModelChange)="setClass(x.student, $event)" [attr.aria-label]="'Classe de ' + x.name">
                        <option value="">À placer</option>@for (c of lv.classes; track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
                        @if (!x.reinscrit && assign()[x.student]) { <div class="tiny" style="color:var(--warn)">Réinscription non validée : placé(e) à la main</div> }</td></tr>
                  }</tbody></table></div>
              </div>
              <p class="small muted">« Répartir équitablement » place les élèves validés : autant que possible par classe, filles et garçons mélangés, sans dépasser les places.
                Ajustez ensuite chaque élève à la main (série en 2nde, cas particuliers). Rien n’est enregistré avant « Enregistrer » ; les familles sont alors prévenues de la classe.</p>
            }
          }
        } @else if (!err()) { <div class="card pad muted">Chargement…</div> }
      }
    }
    <ng-template #none>
      @if (plan()?.last || !full) { <div class="banner ok"><app-icon name="check" [size]="18" /> Aucun élève à placer : tous les élèves de {{ place()?.year }} ont une classe.</div> }
      @else { <div class="card pad row"><p class="grow">Rien à faire pour l’instant : validez d’abord le passage dans la nouvelle année.</p><button class="btn" (click)="go(2)">Aller au passage</button></div> }
    </ng-template>
  </div>
  @if (unconfirmed(); as n) {
    <app-modal title="Placer des élèves non validés ?" (closed)="unconfirmed.set(0)">
      <p>{{ n }} élève(s) choisi(s) n’ont pas de réinscription validée. S’ils ne reviennent pas, ils occuperont une place inutilement.</p>
      <div footer><button class="btn ghost" (click)="unconfirmed.set(0)">Revenir</button><button class="btn primary" (click)="save(true)">Les placer quand même</button></div>
    </app-modal>
  }
  @if (noPay(); as x) {
    <app-modal title="Valider sans paiement" (closed)="noPay.set(null)">
      <p><b>{{ x.name }}</b> n’a rien payé pour la nouvelle année. Indiquez pourquoi sa réinscription est validée quand même.</p>
      <label class="field" style="margin-top:12px"><span>Motif (obligatoire, inscrit au journal)</span>
        <input [(ngModel)]="motif" maxlength="150" placeholder="Ex. boursier, enfant du personnel, échéancier accordé" /></label>
      <div footer><button class="btn ghost" (click)="noPay.set(null)">Annuler</button><button class="btn primary" [disabled]="busy() || motif.trim().length < 3" (click)="validateNoPay(x.student)">Valider</button></div>
    </app-modal>
  }
  @if (newCls(); as c) {
    <app-modal title="Créer une classe" (closed)="newCls.set(null)">
      <div class="form-grid">
        <label class="field"><span>Niveau</span><input [value]="c.level" disabled /></label>
        @if (lycee(c.level)) { <label class="field"><span>Série</span><select [(ngModel)]="c.serie" (ngModelChange)="c.name = suggestName(c.level, $event)">@for (sr of s.seriesOf(c.level); track sr.id) { <option [value]="sr.code">{{ sr.code }}{{ sr.name ? ' · ' + sr.name : '' }}</option> }</select></label> }
        <label class="field"><span>Nom de la classe</span><input [(ngModel)]="c.name" maxlength="30" /></label>
        <label class="field"><span>Effectif maximum</span><input type="number" min="10" max="80" [(ngModel)]="c.max" /></label>
      </div>
      <div footer><button class="btn ghost" (click)="newCls.set(null)">Annuler</button><button class="btn primary" [disabled]="busy() || !c.name.trim()" (click)="createClass(c)">Créer</button></div>
    </app-modal>
  }
  @if (departing()) {
    <app-modal title="Marquer les non-réinscrits comme partis" (closed)="departing.set(false)">
      <p><b>{{ place()?.waiting }}</b> élève(s) passé(s) dans la nouvelle année n’ont rien payé et n’ont pas été validés.
        Ceux qui ont payé ne sont pas concernés, même si leur réinscription n’est pas encore validée.</p>
      <ul class="small" style="margin:10px 0 0 18px">
        <li>Ils quittent l’école avec le motif « Parti(e) » et leur compte est bloqué.</li>
        <li>Leur dossier et leur solde impayé de l’an passé sont conservés dans « Anciens élèves et exclus ».</li>
        <li>S’ils reviennent, on les réintègre dans une classe depuis cette page.</li>
      </ul>
      <div footer><button class="btn ghost" (click)="departing.set(false)">Annuler</button><button class="btn danger" [disabled]="busy()" (click)="depart()">Marquer comme partis</button></div>
    </app-modal>
  }`,
})
export class AnneePage {
  readonly s = inject(Store); readonly fnum = fnum; readonly fcfa = fcfa; readonly Math = Math;
  plan = signal<RolloverPlan | null>(null);
  lines = signal<Line[]>([]);
  place = signal<PlacementState | null>(null);
  step = signal<Step>(1);
  level = signal('');
  assign = signal<Partial<Record<number, string>>>({});
  err = signal(''); msg = signal(''); busy = signal(false); confirming = signal(false);
  toYear = '';
  constructor() { void this.load(true); }
  lbl(v: string): string { return DECISION_LABEL[v as DecisionValue] ?? v; }
  /** « 10/10/2026 à 02:15 » à partir de la date du serveur. */
  when(iso: string): string { return `${dateFr(iso.slice(0, 10))} à ${iso.slice(11, 16)}`; }

  /** Direction : les trois étapes. Secrétariat (il compose les classes, sans passer l'année) : la répartition seulement. */
  readonly full = this.s.can('rollover');
  async load(first = false): Promise<void> {
    if (!this.full) {
      const p = await this.s.placementState();
      if (!p.state) return void this.err.set(p.error ?? 'Répartition indisponible.');
      this.err.set(''); this.place.set(p.state);
      if (first) this.step.set(3);                          // à l'ouverture seulement : ensuite on reste sur l'étape choisie
      if (!p.state.levels.some((l) => l.level === this.level())) this.pickLevel(p.state.levels[0]?.level ?? '');
      return;
    }
    const [r, p] = await Promise.all([this.s.rolloverPlan(), this.s.placementState()]);
    if (!r.plan) return void this.err.set(r.error ?? 'Aperçu indisponible.');
    this.err.set('');
    this.plan.set(r.plan); this.toYear = r.plan.to_year;
    this.lines.set(r.plan.rows.map((x) => ({ ...x, sel: x.action ?? '' })));
    this.place.set(p.state ?? null);
    if (p.state && !p.state.levels.some((l) => l.level === this.level())) this.pickLevel(p.state.levels[0]?.level ?? '');
    if (first && (r.plan.last || (p.state?.total ?? 0) > 0)) this.step.set(3);       // passage déjà fait : on reprend aux réinscriptions
  }
  go(n: Step): void { this.step.set(n); this.msg.set(''); if (n !== 1) void this.load(); }

  steps = computed(() => {
    const done = !!this.plan()?.last, left = this.place()?.total ?? 0;
    const st = this.place();
    const reins = { n: 3 as Step, title: 'Réinscriptions', state: st?.total ? `${st.paid} à valider · ${st.waiting} en attente` : 'Rien à valider', done: !!st?.total && !st.paid && !st.waiting };
    const eff = { n: 4 as Step, title: 'Effectifs', state: this.effectifs().some((r) => r.manque > 0) ? 'Des classes manquent' : 'Places par niveau', done: false };
    const rep = { n: 5 as Step, title: 'Répartition', state: left ? `${left} élève(s) à placer` : 'Tous les élèves sont placés', done: !left && (done || !this.full) };
    if (!this.full) return [reins, eff, rep];
    return [
      { n: 1 as Step, title: 'Bilan de l’année', state: done ? 'Année précédente close' : 'Admis, redoublants, exclus par classe', done },
      { n: 2 as Step, title: 'Passage', state: done ? `Fait : ${this.plan()!.last!.to_year}` : 'Créer la nouvelle année', done },
      reins, eff, rep,
    ];
  });

  // --- Étape 2 : passage ---
  actionsFor(r: Line): string[] { return [...(r.sel ? [] : ['']), ...((r.last_level ?? this.s.isLastLevel(r.level)) ? ['graduate', 'repeat', 'exclude', 'leave'] : ['promote', 'repeat', 'exclude', 'leave'])]; }
  setAction(id: number, a: string): void { this.lines.update((ls) => ls.map((l) => (l.student === id ? { ...l, sel: a } : l))); this.confirming.set(false); }
  nextYear(r: Line): string {
    if (r.sel === 'promote') return `${r.next_level ?? this.s.nextLevelOf(r.level)} · à placer`;   // niveaux du cursus de l'élève (donnés par le serveur)
    if (r.sel === 'repeat') return `${r.level} · à placer`;
    return ({ graduate: 'Ancien élève', exclude: 'Quitte l’école (exclu)', leave: 'Quitte l’école' } as Record<string, string>)[r.sel] ?? '—';
  }
  groups = computed(() => {
    const m = new Map<number, { id: number; name: string; lines: Line[] }>();
    for (const l of this.lines()) { const g = m.get(l.class) ?? { id: l.class, name: l.class_name, lines: [] }; g.lines.push(l); m.set(l.class, g); }
    return [...m.values()];
  });
  kpis = computed(() => {
    const labels = this.plan()?.actions ?? {};
    const n: Record<string, number> = {};
    for (const l of this.lines()) if (l.sel) n[l.sel] = (n[l.sel] ?? 0) + 1;
    return Object.keys(labels).filter((k) => n[k]).map((k) => ({ key: k, label: labels[k], n: n[k] }));
  });
  missing = computed(() => this.lines().filter((l) => !l.sel).length);
  async apply(): Promise<void> {
    this.busy.set(true); this.err.set(''); this.msg.set('');
    const r = await this.s.applyRollover(this.lines().map((l) => ({ student: l.student, action: l.sel })), this.toYear.trim());
    this.busy.set(false); this.confirming.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Le passage n’a pas pu être appliqué.');
    await this.load();
    this.step.set(3);
    this.msg.set(`L’année ${r.year} est ouverte. ${r.toPlace ?? 0} élève(s) attendent la validation de leur réinscription, puis une classe.${r.carried ? ` ${r.carried} élève(s) ont un solde reporté.` : ''}`);
  }
  async undo(): Promise<void> {
    this.busy.set(true); this.err.set(''); this.msg.set('');
    const r = await this.s.undoRollover();
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Annulation impossible.');
    await this.load();
    this.step.set(2);
    this.msg.set('Le passage a été annulé : l’année précédente est de nouveau en cours.');
  }

  // --- Étape 3 : répartition ---
  cur = computed(() => this.place()?.levels.find((l) => l.level === this.level()) ?? null);
  pickLevel(lv: string): void { this.level.set(lv); this.assign.set({}); }
  setClass(student: number, cid: string): void { this.assign.update((a) => { const n = { ...a }; if (cid) n[student] = cid; else delete n[student]; return n; }); }
  chosen = computed(() => Object.keys(this.assign()).length);
  /** Occupation de chaque classe en comptant les choix pas encore enregistrés. */
  rooms = computed(() => {
    const lv = this.cur(); if (!lv) return [];
    const a = this.assign();
    return lv.classes.map((c) => {
      const mine = lv.students.filter((x) => a[x.student] === String(c.id));
      const f = mine.filter((x) => x.sexe === 'F').length;
      return { ...c, added: mine.length, total: c.count + mine.length, f: c.f + f, m: c.m + mine.length - f };
    });
  });
  async auto(): Promise<void> {
    this.busy.set(true);
    const r = await this.s.suggestPlacement(this.level());
    this.busy.set(false);
    if (!r.assignments) return void this.s.toast(r.error ?? 'Proposition impossible.', 'err');
    const next: Partial<Record<number, string>> = {};
    let none = 0;
    for (const [sid, cid] of Object.entries(r.assignments)) { if (cid) next[Number(sid)] = String(cid); else none++; }
    this.assign.set(next);
    const waiting = this.cur() ? this.countOf(this.cur()!, false) : 0;
    this.s.toast((none ? `Répartition proposée. ${none} élève(s) sans place : ouvrez une classe à l’étape « Effectifs ».` : 'Répartition proposée : vérifiez puis enregistrez.')
      + (waiting ? ` ${waiting} élève(s) sans réinscription validée ne sont pas répartis.` : ''), none ? 'info' : 'ok');
  }
  // --- Réinscription ---
  // --- Étape 3 : validation des réinscriptions ---
  readonly filters: { key: Etat; label: string }[] = [{ key: 'paye', label: 'Payé, à valider' }, { key: 'attente', label: 'En attente' }, { key: 'valide', label: 'Validées' }, { key: 'tous', label: 'Tous' }];
  readonly dateFr = dateFr;
  filter = signal<Etat>('paye'); q = signal(''); noPay = signal<PlacementStudent | null>(null); motif = '';
  private all = computed(() => (this.place()?.levels ?? []).flatMap((lv) => lv.students.map((x) => ({ ...x, level: lv.level }))));
  countState(k: Etat): number { return k === 'tous' ? this.all().length : this.all().filter((x) => x.state === k).length; }
  reRows = computed(() => {
    const f = this.filter(), t = this.q().trim().toLowerCase();
    return this.all().filter((x) => (f === 'tous' || x.state === f)
      && (!t || `${x.name} ${x.matricule} ${x.receipts.map((r) => r.receipt_no).join(' ')}`.toLowerCase().includes(t)));
  });
  openReceipt(id: number, no: string): void { void this.s.receiptPdf(String(id), no); }
  private async setReins(ids: number[], ok: boolean, motif = '', done = ''): Promise<void> {
    this.busy.set(true);
    const r = await this.s.setReinscription(ids, ok, motif);
    this.busy.set(false);
    if (!r.ok) return void this.s.toast(r.error ?? 'Opération impossible.', 'err');
    const keep = this.assign(); await this.load(); this.assign.set(keep);
    if (done) this.s.toast(done);
  }
  validate(id: number): Promise<void> { return this.setReins([id], true, '', 'Réinscription validée.'); }
  unvalidate(id: number): Promise<void> { return this.setReins([id], false, '', 'Validation annulée.'); }
  async validateNoPay(id: number): Promise<void> { await this.setReins([id], true, this.motif.trim(), 'Réinscription validée sans paiement.'); this.noPay.set(null); this.motif = ''; }
  validateAllPaid(): Promise<void> {
    const ids = this.all().filter((x) => x.state === 'paye').map((x) => x.student);
    return this.setReins(ids, true, '', `${ids.length} réinscription(s) validée(s).`);
  }

  // --- Étape 4 : effectifs par niveau ---
  effectifs = computed(() => (this.place()?.levels ?? []).map((lv) => {
    const n = (k: string) => lv.students.filter((x) => x.state === k).length;
    const valides = n('valide'), payes = n('paye'), attente = n('attente');
    const libres = lv.classes.reduce((a, c) => a + Math.max(0, c.max - c.count), 0);
    const manque = valides + payes - libres;
    const taille = Math.max(...lv.classes.map((c) => c.max), 45);
    return { level: lv.level, classes: lv.classes, valides, payes, attente, libres, manque, creer: manque > 0 ? Math.ceil(manque / taille) : 0 };
  }));
  newCls = signal<{ level: string; name: string; serie: string; max: number } | null>(null);
  lycee = (lv: string) => this.s.hasSeries(lv);
  /** Nom proposé : la lettre suivante au collège (6e B), la série au lycée (2nde C, puis 2nde C2…). */
  suggestName(level: string, serie = 'C'): string {
    const names = new Set(this.s.classes().map((c) => c.name.toLowerCase()));
    if (this.lycee(level)) { let n = `${level} ${serie}`, i = 2; while (names.has(n.toLowerCase())) n = `${level} ${serie}${i++}`; return n; }
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { const n = `${level} ${l}`; if (!names.has(n.toLowerCase())) return n; }
    return `${level} `;
  }
  openNewClass(level: string): void {
    const max = Math.max(...this.s.classes().filter((c) => c.level === level).map((c) => c.max), 45);
    const serie = this.s.seriesOf(level)[0]?.code ?? '';
    this.newCls.set({ level, serie, name: this.suggestName(level, serie), max });
  }
  async createClass(c: { level: string; name: string; serie: string; max: number }): Promise<void> {
    this.busy.set(true);
    const r = await this.s.addClassAsync({ name: c.name.trim(), level: c.level, serie: this.lycee(c.level) ? c.serie : undefined, max: Number(c.max) || 45 });
    this.busy.set(false);
    if (!r.cl) return void this.s.toast(r.error ?? 'Création impossible.', 'err');
    this.newCls.set(null);
    await this.load();
    this.s.toast(`La classe ${r.cl.name} est créée.`);
  }
  unconfirmed = signal(0); departing = signal(false);
  countOf(lv: { students: { reinscrit: boolean }[] }, confirmed: boolean): number { return lv.students.filter((x) => x.reinscrit === confirmed).length; }
  /** Réinscrits d'abord, puis ceux en attente. */
  sorted<T extends { reinscrit: boolean; name: string }>(list: readonly T[]): T[] { return [...list].sort((a, b) => Number(b.reinscrit) - Number(a.reinscrit) || a.name.localeCompare(b.name)); }
  async depart(): Promise<void> {
    this.busy.set(true);
    const r = await this.s.markDeparted();
    this.busy.set(false); this.departing.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Opération impossible.');
    this.assign.set({});
    await this.load();
    this.msg.set(`${r.departed} élève(s) non réinscrit(s) marqué(s) comme partis. Leur dossier est dans « Anciens élèves et exclus ».`);
    this.filter.set('tous');
  }
  async save(force = false): Promise<void> {
    const list = Object.entries(this.assign()).filter(([, cls]) => !!cls).map(([student, cls]) => ({ student: Number(student), class: Number(cls) }));
    if (!list.length) return;
    const waiting = new Set((this.cur()?.students ?? []).filter((x) => !x.reinscrit).map((x) => x.student));
    const n = list.filter((x) => waiting.has(x.student)).length;
    if (n && !force) return void this.unconfirmed.set(n);          // avertissement : élèves pas encore réinscrits
    this.unconfirmed.set(0);
    this.busy.set(true); this.err.set('');
    const r = await this.s.savePlacement(list);
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Enregistrement impossible.');
    this.assign.set({});
    await this.load();
    this.msg.set(`${r.placed} élève(s) placé(s), les familles sont prévenues.${r.remaining ? ` Il reste ${r.remaining} élève(s) à placer.` : ' Tous les élèves ont une classe.'}`);
  }
}

@Component({
  selector: 'app-anciens',
  imports: [FitHeight, FormsModule],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Anciens élèves et exclus</h1>
      <p>Les élèves qui ne sont plus dans l’effectif de l’année en cours. Leur dossier est conservé : on peut réintégrer un élève exclu ou parti dans une classe.</p></div></div>
    @if (msg()) { <div class="banner ok">{{ msg() }}</div> }
    @if (err()) { <div class="banner bad">{{ err() }}</div> }
    <div class="card pad row">
      <label class="field grow"><span>Rechercher</span><input name="q" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Nom, prénoms ou matricule" /></label>
      <label class="field"><span>Situation</span><select [ngModel]="f()" (ngModelChange)="f.set($event)"><option value="">Toutes</option><option value="exclu">Exclus</option><option value="ancien">Anciens élèves</option><option value="parti">Partis</option></select></label>
    </div>
    <div class="card" appFitHeight><div class="table-wrap"><table class="table">
      <thead><tr><th>Élève</th><th>Matricule</th><th>Situation</th><th class="num">Solde laissé</th><th>Réintégrer dans</th></tr></thead>
      <tbody>
        @for (st of list(); track st.id) {
          <tr>
            <td class="cell-main">{{ st.nom }} {{ st.prenoms }}</td>
            <td>{{ st.matricule }}</td>
            <td><span class="pill" [class.bad]="st.sortie === 'exclu'">{{ sit[st.sortie || 'parti'] }}</span></td>
            <td class="num">{{ st.soldeSortie ? fcfa(st.soldeSortie) : '—' }}</td>
            <td>
              <div class="row">
                <select [ngModel]="pick()[st.id] || ''" (ngModelChange)="setPick(st.id, $event)" [attr.aria-label]="'Classe d’accueil de ' + st.nom"><option value="">Choisir une classe…</option>@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
                <button class="btn sm primary" [disabled]="!pick()[st.id] || busy()" (click)="back(st.id)">Réintégrer</button>
              </div></td>
          </tr>
        } @empty { <tr><td colspan="5" class="empty">Aucun ancien élève ni exclu pour le moment.</td></tr> }
      </tbody></table></div></div>
  </div>`,
})
export class AnciensPage {
  readonly s = inject(Store); readonly fcfa = fcfa;
  readonly sit: Record<string, string> = { exclu: 'Exclu(e)', ancien: 'Ancien élève', parti: 'Parti(e)' };
  q = signal(''); f = signal(''); pick = signal<Record<string, string>>({});
  err = signal(''); msg = signal(''); busy = signal(false);
  constructor() { void this.s.loadFormer(); }
  list = computed(() => {
    const q = this.q().trim().toLowerCase(), f = this.f();
    return this.s.formerStudents().filter((x) => (!f || (x.sortie || 'parti') === f) && (!q || `${x.nom} ${x.prenoms} ${x.matricule}`.toLowerCase().includes(q)));
  });
  setPick(id: string, c: string): void { this.pick.update((p) => ({ ...p, [id]: c })); }
  async back(id: string): Promise<void> {
    this.busy.set(true); this.err.set(''); this.msg.set('');
    const r = await this.s.reintegrateAsync(id, this.pick()[id]);
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Réintégration impossible.');
    this.msg.set('L’élève est réintégré. Son solde éventuel est reporté sur sa scolarité.');
    await this.s.loadFormer();
  }
}
