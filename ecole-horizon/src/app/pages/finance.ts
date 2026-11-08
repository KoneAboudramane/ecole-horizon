import { Component, computed, inject, input, signal, OnDestroy } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, ListModal, Modal, FitHeight } from '../ui';
import { dateFr, fcfa, nombreEnLettres, toCsv, waLink } from '../format';
import { CashDay, FinanceYear, MODE_LABEL, ONLINE_MODES, PayMode, Payment, StudentStatement } from '../models';
import { discountedTarif, ordinalTranche, splitTranches } from '../engine';
import { fullHtml, receiptHtml, statementHtml } from './bulletin-html';
import { FileImport } from '../file-import';

const words = (n: number) => { const w = nombreEnLettres(n); return w.charAt(0).toUpperCase() + w.slice(1); };
function downloadReceipt(s: Store, p: Payment, duplicata = false): void {
  if (s.apiMode()) { void s.receiptPdf(p.id, p.receiptNo, duplicata); return; }
  void s.download(`recu-${p.receiptNo}${duplicata ? '-duplicata' : ''}.html`, receiptHtml(s, p.id, words(p.amount), MODE_LABEL[p.mode], duplicata, p));
}
void fullHtml;

// ---------- Tableau « payé / reste » d'un reçu ----------
@Component({
  selector: 'app-detail-recu',
  template: `
  @if (d(); as d) {
    <div class="table-wrap"><table class="table"><thead><tr><th>Échéance</th><th class="num">Dû</th><th class="num">Déjà payé</th><th class="num">Ce reçu</th><th class="num">Reste</th></tr></thead><tbody>
      @for (l of lignes(); track l.key) {
        <tr [style.font-weight]="l.paidNow > 0 ? 700 : 400"><td>{{ l.label }}@if (l.remaining > 0 && l.due) { <div class="tiny muted">à payer avant le {{ dateFr(l.due) }}</div> }</td><td class="num">{{ fcfa(l.amount) }}</td><td class="num">{{ fcfa(l.paidBefore) }}</td><td class="num">{{ fcfa(l.paidNow) }}</td><td class="num">{{ fcfa(l.remaining) }}</td></tr>
      }</tbody></table></div>
    <p class="small" style="margin:8px 0 0">Total de l’année : <b>{{ fcfa(d.total) }}</b> · payé à ce jour : <b>{{ fcfa(d.paidAfter) }}</b>@if (d.discountAmount > 0) { · remise fratrie : −{{ fcfa(d.discountAmount) }} }</p>
    <p style="margin:4px 0 0"><b>@if (d.remaining > 0) { Reste à payer : {{ fcfa(d.remaining) }} } @else { Scolarité soldée }</b></p>
    @if (d.next?.due) { <p class="small muted" style="margin:2px 0 0">Prochaine échéance : {{ d.next!.label }} le {{ dateFr(d.next!.due!) }} ({{ fcfa(d.next!.remaining) }})</p> }
    @if (advance()) { <p class="small muted" style="margin:2px 0 0">Dont {{ fcfa(advance()) }} gardés en avance, déduits de l’année suivante.</p> }
  }`,
})
export class DetailRecu {
  readonly fcfa = fcfa; readonly dateFr = dateFr;
  readonly payment = input.required<Payment>();
  d = computed(() => this.payment().detail);
  lignes = computed(() => (this.payment().detail?.lines ?? []).filter((l) => l.amount > 0));
  advance = computed(() => this.payment().advance ?? 0);
}

// ---------- Paiements (guichet) ----------
@Component({
  selector: 'app-paiements',
  imports: [FitHeight, FormsModule, Icon, Modal, FileImport, DetailRecu, ListModal, NgTemplateOutlet],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Paiements</h1><p>Encaissements de la scolarité, au guichet et en ligne. Chaque paiement génère un reçu numéroté.</p></div>
      <div class="row"><button class="btn" (click)="exportCsv()"><app-icon name="download" [size]="16" /> Exporter</button>@if (s.can('pay.write') && s.apiMode()) { <button class="btn" (click)="importing.set(true)"><app-icon name="upload" [size]="16" /> Importer</button> }@if (s.can('pay.write')) { <button class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Enregistrer un paiement</button> }</div></div>
    @if (!s.can('pay.write')) { <div class="banner info">Consultation seule : les encaissements sont saisis par le comptable.</div> }
    @if (past(); as y) {
      <div class="banner info"><span>Année {{ y.label }} : consultation seule. Encaissé {{ fcfa(y.collected) }} en {{ y.count }} paiement(s)@if (y.cancelled) { , {{ y.cancelled }} annulé(s) }.
        @if (y.carriedOver !== null) { Impayés reportés sur l’année suivante : <b>{{ fcfa(y.carriedOver) }}</b>@if (y.carriedCredit) { · avances reportées : <b>{{ fcfa(y.carriedCredit) }}</b> }. }</span></div>
    } @else {
      <div class="grid kpi">
        <div class="card kpi-card"><span class="label">Encaissé au total</span><span class="value">{{ fcfa(s.finance().collected) }}</span></div>
        <div class="card kpi-card"><span class="label">Encaissé ce mois</span><span class="value">{{ fcfa(s.finance().monthCollected) }}</span></div>
        <div class="card kpi-card"><span class="label">Paiements en ligne</span><span class="value">{{ onlineShare() }} %</span><span class="hint">du total encaissé</span></div>
      </div>
    }
    <div class="card" appFitHeight>
      <div class="card-head"><div class="row">
        <input type="search" placeholder="Élève, reçu ou référence" [ngModel]="q()" (ngModelChange)="q.set($event); shown.set(40)" style="width:240px" aria-label="Filtrer les paiements" />
        <select [ngModel]="mode()" (ngModelChange)="mode.set($event)" style="width:auto"><option value="">Tous les moyens</option>@for (m of modes; track m) { <option [value]="m">{{ label[m] }}</option> }</select>
        @if (years().length > 1) { <select [ngModel]="year()" (ngModelChange)="setYear($event)" style="width:auto" aria-label="Année"><option value="">Année en cours</option>@for (y of olderYears(); track y.label) { <option [value]="y.label">Année {{ y.label }}</option> }</select> }</div></div>
      <div class="table-wrap"><table class="table hover"><thead><ng-container [ngTemplateOutlet]="pHead" /></thead><tbody>
        @for (p of page(); track p.id) { <ng-container [ngTemplateOutlet]="pRow" [ngTemplateOutletContext]="{ $implicit: p }" /> }
        @empty { <tr><td colspan="7" class="empty">Aucun paiement.</td></tr> }</tbody></table></div>
      @if (list().length > shown()) { <div class="card-body center"><button class="btn" (click)="all.set(true)">Afficher la suite · {{ list().length - shown() }} de plus</button></div> }
    </div>
    <ng-template #pHead><tr><th>Date</th><th>Reçu</th><th>Élève</th><th>Moyen</th><th class="num">Montant</th><th>Statut</th><th></th></tr></ng-template>
    <ng-template #pRow let-p>
          <tr><td class="nowrap">{{ dateFr(p.date) }}</td><td class="num">{{ p.receiptNo }}</td><td class="cell-main">{{ s.studentName(p.studentId) }}<div class="tiny muted">{{ s.className(s.studentById().get(p.studentId)?.classId ?? '') }} · {{ p.byName ?? s.userName(p.byUserId) }}</div></td>
            <td>{{ modeOf(p) }}@if (p.ref) { <div class="tiny muted">{{ p.ref }}</div> }</td><td class="num"><b [style.text-decoration]="p.status === 'annule' ? 'line-through' : ''">{{ fcfa(p.amount) }}</b>@if (p.advance) { <div class="tiny muted">dont {{ fcfa(p.advance) }} en avance</div> }</td>
            <td>@if (p.status === 'confirme') { <span class="pill ok">Confirmé</span> } @else { <span class="pill bad" [title]="p.note ?? ''">Annulé</span> }</td>
            <td class="right nowrap"><button class="btn sm" (click)="receipt(p)" title="Réimprimer le reçu : il porte la mention Duplicata">Duplicata</button> <button class="btn sm" (click)="openStatement(p.studentId)">Relevé</button> @if (!year() && p.status === 'confirme' && s.can('pay.write')) { <button class="btn sm danger" (click)="askCancel(p)">Annuler</button> }</td></tr>
    </ng-template>
  </div>
  @if (all()) { <app-list-modal [title]="year() ? 'Paiements · année ' + year() : 'Paiements'" [items]="list()" [head]="pHead" [row]="pRow" [text]="payText" [cols]="7" [hover]="true"
      placeholder="Élève, reçu, référence ou moyen" (closed)="all.set(false)" /> }

  @if (importing()) { <app-file-import kind="payments" title="Importer des paiements déjà encaissés" noun="paiement(s)" intro="Reprise de paiements anciens : matricule, montant, date, mode et référence. Aucun parent n’est notifié ; chaque paiement reçoit un numéro de reçu." (closed)="importing.set(false)" /> }
  @if (adding()) {
    <app-modal title="Enregistrer un paiement" size="wide" (closed)="adding.set(false)">
      @if (done(); as d) {
        <div class="banner ok"><app-icon name="check" [size]="18" /> Paiement enregistré, reçu {{ d.receiptNo }}.</div>
        <div class="card flat pad stack" style="margin-top:12px"><div><span class="muted small">Élève</span><br><b>{{ s.studentName(d.studentId) }}</b></div>
          <div><span class="muted small">Montant</span><br><b style="font-size:20px">{{ fcfa(d.amount) }}</b></div>
          <div class="small"><i>{{ words(d.amount) }} francs CFA</i></div>
          <app-detail-recu [payment]="d" /></div>
      } @else {
        <div class="stack">
          <div class="field"><span>Élève</span>
            @if (picked(); as p) { <div class="row card flat pad"><b class="grow">{{ s.studentName(p) }}</b><span class="muted small">{{ s.className(s.studentById().get(p)?.classId ?? '') }}</span><button class="link small" (click)="picked.set(null); amount = ''; surplusAsk.set(null)">Changer</button></div> }
            @else {
              <div class="row">
                <select [ngModel]="fLevel()" (ngModelChange)="fLevel.set($event); fClass.set('')" style="width:auto" aria-label="Niveau"><option value="">Tous les niveaux</option>@for (l of levels(); track l) { <option [value]="l">{{ l }}</option> }</select>
                <select [ngModel]="fClass()" (ngModelChange)="fClass.set($event)" style="width:auto" aria-label="Classe"><option value="">Toutes les classes</option>@for (c of classChoices(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }@if (hasToPlace()) { <option value="placer">À placer (sans classe)</option> }</select>
                <select [ngModel]="fStatus()" (ngModelChange)="fStatus.set($event)" style="width:auto" aria-label="Situation"><option value="">Toutes les situations</option><option value="reste">Reste à payer</option><option value="retard">En retard</option><option value="solde">Soldés</option></select>
              </div>
              <input type="search" [ngModel]="sq()" (ngModelChange)="sq.set($event)" placeholder="Tapez un nom ou un matricule" />
              <div style="max-height:240px;overflow:auto">
                @for (r of found(); track r.id) { <button type="button" class="btn ghost block" style="justify-content:flex-start" (click)="pick(r.id)">{{ r.nom }} {{ r.prenoms }} <span class="muted small">· {{ s.className(r.classId) }} · {{ r.matricule }} · @if (s.balance(r.id).solde > 0) { reste {{ fcfa(s.balance(r.id).solde) }} } @else { soldé }</span></button> }
                @if (filtering() && !found().length) { <p class="muted small">Aucun élève ne correspond à ces filtres.</p> }
              </div>
              @if (foundMore() > 0) { <p class="muted small">… et {{ foundMore() }} autre(s) : précisez le filtre ou tapez un nom.</p> }
            }
          </div>
          @if (picked(); as p) {
            <div class="card flat pad small"><b>Situation :</b> payé {{ fcfa(s.balance(p).paid) }} sur {{ fcfa(s.balance(p).total) }} · reste <b>{{ fcfa(s.balance(p).solde) }}</b>@if (s.siblingDiscount(p).pct > 0) { <span class="pill ok" style="margin-inline-start:6px">Remise fratrie −{{ s.siblingDiscount(p).pct }} %</span> }
              @if (s.balance(p).overdue > 0) { <span class="pill warn" style="margin-inline-start:6px">dont {{ fcfa(s.balance(p).overdue) }} échu</span> }</div>
            <div class="form-grid">
              <label class="field"><span>Montant (FCFA)</span><input inputmode="numeric" [(ngModel)]="amount" name="am" (ngModelChange)="surplusAsk.set(null)" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
              <label class="field"><span>Moyen de paiement</span><select [(ngModel)]="pm" name="pm"><option value="especes">Espèces</option><option value="virement">Virement</option><option value="cheque">Chèque</option></select></label>
              <label class="field"><span>Référence {{ pm === 'especes' ? '(facultatif)' : '(n° de chèque ou de virement)' }}</span><input [(ngModel)]="ref" name="rf" /></label>
            </div>
            @if (amountNum() > 0) { <p class="small muted">En lettres : <i>{{ words(amountNum()) }} francs CFA</i></p> }
            @if (surplusAsk(); as x) {
              <div class="banner warn"><span>Le montant dépasse le solde de {{ fcfa(x) }}. Voulez-vous garder ces {{ fcfa(x) }} en avance ? Ils seront déduits de la scolarité de l’année suivante. <button class="btn sm" (click)="surplusAsk.set(null)">Corriger le montant</button> <button class="btn sm primary" (click)="save(true)">Garder {{ fcfa(x) }} en avance</button></span></div>
            }
          }
        </div>
      }
      <div footer>
        @if (done(); as d) { <button class="btn" (click)="receipt(d, false)">Télécharger le reçu</button><button class="btn primary" (click)="openNew()">Nouveau paiement</button> }
        @else { <button class="btn ghost" (click)="adding.set(false)">Annuler</button><button class="btn primary" [disabled]="!picked()" (click)="save()">Enregistrer</button> }
      </div>
    </app-modal>
  }
  @if (cancelling(); as c) {
    <app-modal title="Annuler le paiement" (closed)="cancelling.set(null)">
      <p>Annuler le reçu <b>{{ c.receiptNo }}</b> de {{ fcfa(c.amount) }} pour {{ s.studentName(c.studentId) }} ? Le solde de l’élève sera recalculé. Cette action est tracée dans le journal.</p>
      <label class="field" style="margin-top:12px"><span>Motif (obligatoire)</span><input [(ngModel)]="reason" name="rs" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
      <div footer><button class="btn ghost" (click)="cancelling.set(null)">Garder le paiement</button><button class="btn danger" (click)="confirmCancel()">Annuler le paiement</button></div>
    </app-modal>
  }
  @if (stmt(); as st) {
    <app-modal title="Relevé de paiements" size="wide" (closed)="stmt.set(null)">
      <p><b>{{ st.name }}</b> · {{ st.className }} · {{ st.matricule }}</p>
      @for (y of st.years; track y.label) {
        <h3 style="margin:12px 0 4px">Année {{ y.label }}</h3>
        <p class="small muted" style="margin:0 0 6px">@if (y.report > 0) { Solde reporté : {{ fcfa(y.report) }} · }@if (y.credit > 0) { Avance reportée : {{ fcfa(y.credit) }} · }Total payé : <b>{{ fcfa(y.paid) }}</b></p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Reçu</th><th>Moyen</th><th class="num">Montant</th></tr></thead><tbody>
          @for (p of y.payments; track p.id) { <tr [style.opacity]="p.status === 'annule' ? 0.5 : 1"><td>{{ dateFr(p.date) }}</td><td>{{ p.receiptNo }}@if (p.status === 'annule') { <span class="pill bad" style="margin-inline-start:6px">Annulé</span> }</td><td>{{ label[p.mode] }}</td><td class="num">{{ fcfa(p.amount) }}</td></tr> }</tbody></table></div>
      } @empty { <p class="muted">Aucun paiement enregistré pour cet élève.</p> }
      <div footer><button class="btn ghost" (click)="stmt.set(null)">Fermer</button><button class="btn primary" (click)="printStatement()"><app-icon name="download" [size]="16" /> Télécharger pour les parents</button></div>
    </app-modal>
  }`,
})
export class PaiementsPage {
  importing = signal(false);
  readonly s = inject(Store); readonly fcfa = fcfa; readonly dateFr = dateFr; readonly label = MODE_LABEL; readonly words = words;
  readonly modes = Object.keys(MODE_LABEL) as PayMode[];
  q = signal(''); mode = signal(''); shown = signal(40); all = signal(false);
  modeOf = (p: Payment) => this.label[p.mode];
  /** Texte d'un paiement pour la recherche de la liste complète. */
  payText = (p: Payment) => `${p.receiptNo} ${this.s.studentName(p.studentId)} ${this.s.className(this.s.studentById().get(p.studentId)?.classId ?? '')} ${p.ref ?? ''} ${this.label[p.mode]} ${dateFr(p.date)}`;
  adding = signal(false); picked = signal<string | null>(null); sq = signal(''); amount = ''; pm: 'especes' | 'virement' | 'cheque' = 'especes'; ref = '';
  err = signal(''); done = signal<Payment | null>(null); cancelling = signal<Payment | null>(null); reason = '';
  fLevel = signal(''); fClass = signal(''); fStatus = signal(''); surplusAsk = signal<number | null>(null);
  years = signal<FinanceYear[]>([]); year = signal(''); pastPayments = signal<Payment[]>([]); stmt = signal<StudentStatement | null>(null);
  constructor() {
    const p = this.s.param();
    if (this.s.can('pay.write')) { if (p === 'new') this.openNew(); else if (p) { this.openNew(); this.pick(p); } }
    void this.s.financeYears().then((y) => this.years.set(y));
  }
  olderYears = computed(() => this.years().filter((y) => !y.current));
  past = computed(() => (this.year() ? this.years().find((y) => y.label === this.year()) ?? null : null));
  async setYear(label: string): Promise<void> {
    this.year.set(label); this.shown.set(40);
    this.pastPayments.set(label ? await this.s.paymentsOfYear(label) : []);
  }
  list = computed(() => {
    const t = this.q().trim().toLowerCase();
    const src = this.year() ? this.pastPayments() : this.s.payments();
    return src.filter((p) => (!this.mode() || p.mode === this.mode()) && (!t || `${this.s.studentName(p.studentId)} ${p.receiptNo} ${p.ref ?? ''}`.toLowerCase().includes(t)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo));
  });
  page = computed(() => this.list().slice(0, this.shown()));
  onlineShare = computed(() => { const f = this.s.finance(); const on = ONLINE_MODES.reduce((a, m) => a + (f.byMode.get(m) ?? 0), 0); return f.collected ? Math.round((on / f.collected) * 100) : 0; });
  levels = computed(() => [...new Set(this.s.classes().map((c) => c.level))]);
  classChoices = computed(() => this.s.classes().filter((c) => !this.fLevel() || c.level === this.fLevel()));
  hasToPlace = computed(() => this.s.students().some((x) => x.classId.startsWith('placer:')));
  filtering = computed(() => !!(this.fLevel() || this.fClass() || this.fStatus() || this.sq().trim().length >= 2));
  private matches = computed(() => {
    if (!this.filtering()) return [];
    const t = this.sq().trim().toLowerCase(); const lv = this.fLevel(), cl = this.fClass(), stt = this.fStatus();
    return this.s.students().filter((x) => {
      if (cl && (cl === 'placer' ? !x.classId.startsWith('placer:') : x.classId !== cl)) return false;
      if (lv && this.s.levelOf(x.id) !== lv) return false;               // élève à placer : son nouveau niveau
      if (t.length >= 2 && !`${x.nom} ${x.prenoms} ${x.matricule}`.toLowerCase().includes(t)) return false;
      if (stt) { const b = this.s.balance(x.id); if (stt === 'reste' && b.solde <= 0) return false; if (stt === 'retard' && b.overdue <= 0) return false; if (stt === 'solde' && b.solde > 0) return false; }
      return true;
    });
  });
  found = computed(() => this.matches().slice(0, 30));
  foundMore = computed(() => Math.max(0, this.matches().length - 30));
  amountNum = () => Number(this.amount.replace(/\s/g, '')) || 0;
  openNew(): void { this.picked.set(null); this.sq.set(''); this.fLevel.set(''); this.fClass.set(''); this.fStatus.set(''); this.surplusAsk.set(null); this.amount = ''; this.pm = 'especes'; this.ref = ''; this.err.set(''); this.done.set(null); this.adding.set(true); }
  pick(id: string): void {
    this.picked.set(id);
    const next = this.s.feeLines(id).find((l) => l.remaining > 0);
    this.amount = next ? String(next.remaining) : '';
  }
  async save(advance = false): Promise<void> {
    const id = this.picked()!; const n = this.amountNum(); const solde = this.s.balance(id).solde;
    if (n <= 0) return void this.err.set('Saisissez un montant supérieur à zéro.');
    if (this.pm !== 'especes' && !this.ref.trim()) return void this.err.set('La référence est obligatoire pour ce moyen de paiement.');
    if (n > solde && !advance) { this.err.set(''); return void this.surplusAsk.set(n - solde); }
    const r = await this.s.recordPaymentAsync({ studentId: id, amount: n, mode: this.pm, ref: this.ref.trim() || undefined, advance });
    if (!r.payment) { if (r.surplus) { this.err.set(''); return void this.surplusAsk.set(r.surplus); } return void this.err.set(r.error ?? 'Encaissement impossible.'); }
    this.done.set(r.payment);
    this.surplusAsk.set(null);
    this.err.set('');
  }
  receipt(p: Payment, duplicata = true): void { downloadReceipt(this.s, p, duplicata); }
  async openStatement(studentId: string): Promise<void> { this.stmt.set(await this.s.studentStatement(studentId)); }
  printStatement(): void { const st = this.stmt(); if (st) void this.s.download(`releve-${st.matricule}.html`, statementHtml(this.s, st)); }
  askCancel(p: Payment): void { this.reason = ''; this.err.set(''); this.cancelling.set(p); }
  async confirmCancel(): Promise<void> {
    if (this.reason.trim().length < 3) return void this.err.set('Indiquez le motif de l’annulation.');
    if (!(await this.s.cancelPaymentAsync(this.cancelling()!.id, this.reason.trim()))) return;
    this.cancelling.set(null); this.s.toast('Paiement annulé.');
  }
  exportCsv(): void {
    void this.s.download('paiements.csv', toCsv(['Date', 'Reçu', 'Élève', 'Classe', 'Moyen', 'Référence', 'Montant', 'Statut'],
      this.list().map((p) => [dateFr(p.date), p.receiptNo, this.s.studentName(p.studentId), this.s.className(this.s.studentById().get(p.studentId)?.classId ?? ''), MODE_LABEL[p.mode], p.ref, p.amount, p.status])));
  }
}

// ---------- Caisse du jour ----------
@Component({
  selector: 'app-caisse',
  imports: [FitHeight, FormsModule],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Caisse du jour</h1><p>Encaissements de la journée par moyen de paiement, et clôture avec les espèces réellement comptées.</p></div>
      <div class="row"><input type="date" [ngModel]="date()" (ngModelChange)="setDate($event)" [max]="s.today" aria-label="Jour" style="width:auto" /></div></div>
    @if (day(); as d) {
      <div class="grid kpi">
        <div class="card kpi-card"><span class="label">Encaissé ce jour</span><span class="value">{{ fcfa(d.total) }}</span><span class="hint">{{ d.count }} reçu(s)</span></div>
        <div class="card kpi-card"><span class="label">Espèces attendues en caisse</span><span class="value">{{ fcfa(d.expectedCash) }}</span></div>
        <div class="card kpi-card" [class.alert]="!!d.closing && d.closing.gap !== 0"><span class="label">Clôture</span>
          <span class="value">@if (d.closing) { {{ d.closing.gap === 0 ? 'Sans écart' : (d.closing.gap > 0 ? '+' : '') + fcfa(d.closing.gap) }} } @else { Non clôturée }</span></div>
      </div>
      <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Moyen de paiement</th><th class="num">Reçus</th><th class="num">Total</th></tr></thead><tbody>
        @for (m of d.byMode; track m.mode) { <tr><td>{{ label[m.mode] }}</td><td class="num">{{ m.count }}</td><td class="num"><b>{{ fcfa(m.total) }}</b></td></tr> }
        @empty { <tr><td colspan="3" class="empty">Aucun encaissement ce jour.</td></tr> }</tbody></table></div></div>
      @if (d.cancelled.length) {
        <div class="card pad"><h2>Reçus annulés ce jour</h2>
          @for (c of d.cancelled; track c.receiptNo) { <p class="small" style="margin:4px 0">{{ c.receiptNo }} · {{ c.student }} · {{ fcfa(c.amount) }} <span class="muted">— {{ c.note }}</span></p> }</div>
      }
      <div class="card pad stack">
        <h2>Clôture de la caisse</h2>
        @if (d.closing; as c) {
          <p>Clôturée par <b>{{ c.by }}</b> : attendu {{ fcfa(c.expected) }}, compté {{ fcfa(c.counted) }}.@if (c.note) { <span class="muted"> Explication : {{ c.note }}</span> }</p>
        } @else if (s.can('pay.write')) {
          <div class="form-grid">
            <label class="field"><span>Espèces comptées (FCFA)</span><input inputmode="numeric" [(ngModel)]="counted" name="cnt" /></label>
            <label class="field"><span>Explication de l’écart (si besoin)</span><input [(ngModel)]="note" name="nt" /></label>
          </div>
          @if (countedNum() !== null) { <p class="small muted">Écart avec les reçus : <b>{{ gap() > 0 ? '+' : '' }}{{ fcfa(gap()) }}</b></p> }
          @if (err()) { <div class="err">{{ err() }}</div> }
          <div><button class="btn primary" (click)="close()" [disabled]="countedNum() === null">Clôturer la caisse</button></div>
        } @else { <p class="muted">Cette journée n’est pas encore clôturée par le comptable.</p> }
      </div>
    }
  </div>`,
})
export class CaissePage {
  readonly s = inject(Store); readonly fcfa = fcfa; readonly label = MODE_LABEL;
  date = signal(this.s.today); day = signal<CashDay | null>(null); counted = ''; note = ''; err = signal('');
  constructor() { void this.load(); }
  async load(): Promise<void> { this.day.set(await this.s.cashDay(this.date())); }
  setDate(d: string): void { if (!d) return; this.date.set(d); this.counted = ''; this.note = ''; this.err.set(''); void this.load(); }
  countedNum(): number | null { const t = this.counted.replace(/\s/g, ''); return t !== '' && /^\d+$/.test(t) ? Number(t) : null; }
  gap(): number { return (this.countedNum() ?? 0) - (this.day()?.expectedCash ?? 0); }
  async close(): Promise<void> {
    const n = this.countedNum(); if (n === null) return;
    const r = await this.s.cashClose(this.date(), n, this.note);
    if (!r.ok) return void this.err.set(r.error ?? 'Clôture impossible.');
    this.err.set(''); this.s.toast('Caisse clôturée.'); await this.load();
  }
}

// ---------- Impayés ----------
@Component({
  selector: 'app-impayes',
  imports: [FitHeight, FormsModule, Icon],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Impayés</h1><p>Familles ayant une échéance dépassée au {{ dateFr(s.today) }}.</p></div>
      <div class="row">@if (s.can('pay.write')) { <button class="btn" (click)="relanceAll()" [disabled]="!list().length">Relancer toutes les familles ({{ list().length }})</button> }<button class="btn" (click)="exportCsv()"><app-icon name="download" [size]="16" /> Exporter</button></div></div>
    <div class="grid kpi">
      <div class="card kpi-card alert"><span class="label">Total échu</span><span class="value">{{ fcfa(s.finance().overdue) }}</span></div>
      <div class="card kpi-card"><span class="label">Familles concernées</span><span class="value">{{ s.finance().overdueCount }}</span></div>
      <div class="card kpi-card"><span class="label">Relances envoyées</span><span class="value">{{ relances().size }}</span></div>
    </div>
    <div class="card" appFitHeight>
      <div class="card-head"><div class="row"><select [ngModel]="cls()" (ngModelChange)="cls.set($event)" style="width:auto" aria-label="Classe"><option value="">Toutes les classes</option>@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
        <select [ngModel]="ech()" (ngModelChange)="ech.set($event)" style="width:auto" aria-label="Échéance"><option value="">Toutes les échéances</option>@for (e of echeances(); track e.key) { <option [value]="e.key">{{ e.label }}</option> }</select></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Élève</th><th>Parent</th><th>Échéance</th><th class="num">Échu</th><th class="num">Retard</th><th></th></tr></thead><tbody>
        @for (r of list(); track r.id) {
          <tr><td class="cell-main">{{ r.name }}<div class="tiny muted">{{ r.cls }}</div></td><td>{{ r.parent }}<div class="tiny muted">{{ r.phone }}</div></td><td class="small">{{ r.labels }}</td><td class="num"><b>{{ fcfa(r.overdue) }}</b></td>
            <td class="num"><span class="pill" [class.bad]="r.days > 60" [class.warn]="r.days <= 60">{{ r.days }} j</span></td>
            <td class="right nowrap">@if (s.can('pay.write')) { @if (relances().has(r.id)) { <span class="pill ok">Relancée</span> } @else { <button class="btn sm" (click)="relance(r.id)">Relancer</button> } @if (wa(r); as u) { <a class="btn sm" [href]="u" target="_blank" rel="noopener" data-i18n-skip>WhatsApp</a> } <button class="btn sm primary" (click)="s.go('paiements', r.id)">Encaisser</button> }</td></tr>
        } @empty { <tr><td colspan="6" class="empty">Aucun impayé : toutes les familles sont à jour.</td></tr> }</tbody></table></div>
    </div>
  </div>`,
})
export class ImpayesPage {
  readonly s = inject(Store); readonly fcfa = fcfa; readonly dateFr = dateFr;
  /** Message prêt à envoyer, avec l'échéance concernée, le montant et la date limite. */
  message(r: { name: string; parent: string; overdue: number; labels: string; since: string }): string {
    return `Bonjour ${r.parent}, l'école vous rappelle que l'échéance « ${r.labels} » de ${r.name} (${fcfa(r.overdue)}) était due le ${dateFr(r.since)}. Merci de régulariser dès que possible. Cordialement.`;
  }
  wa(r: { name: string; parent: string; phone: string; overdue: number; labels: string; since: string }): string | null { return waLink(r.phone, this.message(r)); }
  cls = signal(''); ech = signal(''); relances = signal(new Set<string>());
  echeances = computed(() => [{ key: 'REP', label: 'Solde de l’année précédente' }, { key: 'INS', label: 'Inscription' }, ...this.s.tranches().map((t, i) => ({ key: `T${i + 1}`, label: t.label }))]);
  list = computed(() => {
    const out: { id: string; name: string; cls: string; parent: string; phone: string; overdue: number; days: number; parentUser: string; labels: string; since: string }[] = [];
    for (const e of this.s.students()) {
      if (this.cls() && e.classId !== this.cls()) continue;
      const lines = this.s.feeLines(e.id).filter((l) => l.overdue && (!this.ech() || l.key === this.ech()));
      if (!lines.length) continue;
      const oldest = lines.map((l) => l.due).sort()[0];
      const p = this.s.parentById().get(e.parentId);
      out.push({ id: e.id, name: `${e.nom} ${e.prenoms}`, cls: this.s.className(e.classId), parent: p?.name ?? '', phone: p?.phone ?? '', overdue: lines.reduce((a, l) => a + l.remaining, 0), days: Math.round((Date.parse(this.s.today) - Date.parse(oldest)) / 86400000), parentUser: p?.userId ?? '',
        labels: lines.map((l) => l.label).join(' + '), since: oldest });
    }
    return out.sort((a, b) => b.days - a.days || b.overdue - a.overdue);
  });
  relance(id: string): void {
    if (this.s.apiMode()) { void this.remoteRelance([id]); return; }
    const r = this.list().find((x) => x.id === id); if (!r) return;
    this.s.notify([r.parentUser], `Rappel : ${fcfa(r.overdue)} de scolarité restent à régler pour ${r.name.split(' ').slice(1).join(' ')}.`, 'paiement', 'payer');
    this.relances.update((x) => new Set(x).add(id)); this.s.toast(`Rappel envoyé à ${r.parent}.`);
  }
  async remoteRelance(ids: string[]): Promise<void> {
    const n = await this.s.remindAsync(ids);
    if (n > 0) { this.relances.update((x) => new Set([...x, ...ids])); this.s.toast(`${n} rappel(s) envoyé(s).`); }
  }
  relanceAll(): void { if (this.s.apiMode()) { void this.remoteRelance(this.list().filter((r) => !this.relances().has(r.id)).map((r) => r.id)); return; } const todo = this.list().filter((r) => !this.relances().has(r.id)); for (const r of todo) this.relance(r.id); this.s.addLog('Relances', `${todo.length} famille(s) relancée(s)`); }
  exportCsv(): void { void this.s.download('impayes.csv', toCsv(['Élève', 'Classe', 'Parent', 'Téléphone', 'Échéance', 'Montant échu', 'Jours de retard'], this.list().map((r) => [r.name, r.cls, r.parent, r.phone, r.labels, r.overdue, r.days]))); }
}

// ---------- Tarifs ----------
@Component({
  selector: 'app-tarifs',
  imports: [FitHeight, FormsModule],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Tarifs et échéances</h1><p>Frais d’inscription et de scolarité par niveau, découpés en tranches choisies par l’école.</p></div></div>
    <div class="banner info">Toute modification recalcule immédiatement les soldes de tous les élèves du niveau concerné. Une remise fratrie de {{ s.school().remiseFratrie }} % s’applique à la scolarité du 2e enfant et des suivants d’une même famille (réglable dans les paramètres).</div>
    @if (!s.can('tarifs.write')) { <div class="banner info">Consultation seule : les tarifs sont fixés par le fondateur et le comptable.</div> }
    <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Niveau</th><th class="num">Inscription</th><th class="num">Scolarité annuelle</th><th class="num">{{ s.tranches()[0].label }}</th><th class="num">Total</th><th class="num">Scolarité 2e enfant et suivants</th>@if (multi()) { <th class="num" title="Ce que paie en plus, pour ce cursus, un élève qui suit déjà un autre cursus de l’école">Si suivi avec un autre cursus</th> }</tr></thead><tbody>
      @for (lv of levels; track lv) {
        <tr><td class="cell-main">{{ lv }}</td>
          <td class="num"><input class="inline-input" style="width:110px !important" type="number" min="0" step="1000" [ngModel]="s.tarifOf(lv).ins" [disabled]="!s.can('tarifs.write')" (change)="set(lv, 'ins', $any($event.target).value)" /></td>
          <td class="num"><input class="inline-input" style="width:120px !important" type="number" min="0" step="1000" [ngModel]="s.tarifOf(lv).sco" [disabled]="!s.can('tarifs.write')" (change)="set(lv, 'sco', $any($event.target).value)" /></td>
          <td class="num">{{ fcfa(first(lv)) }}</td><td class="num"><b>{{ fcfa(s.tarifOf(lv).ins + s.tarifOf(lv).sco) }}</b></td><td class="num muted">{{ fcfa(sibling(lv)) }}</td>
          @if (multi()) { <td class="num"><input class="inline-input" style="width:120px !important" type="number" min="0" step="1000" [ngModel]="s.tarifOf(lv).complement" [placeholder]="s.tarifOf(lv).ins + s.tarifOf(lv).sco" [disabled]="!s.can('tarifs.write')" (change)="setComplement(lv, $any($event.target).value)" [attr.aria-label]="'Tarif en complément, ' + lv" /></td> }</tr>
      }</tbody></table></div></div>
    @if (multi()) { <p class="small muted" style="margin:0">Un élève inscrit dans plusieurs cursus paie un forfait global : le tarif complet de son cursus principal, plus le tarif « si suivi avec un autre cursus » de chaque autre cursus. Laissez la case vide pour faire payer le tarif complet (somme des deux).</p> }
    <div class="card pad stack"><h2>Tranches de scolarité</h2>
      <p class="small muted">Chaque école choisit ses tranches : leur nombre, leur nom et leur part. La scolarité est partagée au prorata des parts (1, 1, 1 : trois tranches égales ; 50, 30, 20 : la moitié à la rentrée…). Les paiements déjà reçus restent comptés : les soldes sont recalculés.</p>
      <div class="stack">
        @for (t of td(); track $index; let i = $index) {
          <div class="tr-row">
            <input class="grow" [ngModel]="t.label" [disabled]="!s.can('tarifs.write')" (ngModelChange)="setT(i, 'label', $event)" aria-label="Nom de la tranche" />
            <label class="tiny muted">Part <input class="inline-input" type="number" min="1" max="1000" [ngModel]="t.part" [disabled]="!s.can('tarifs.write')" (ngModelChange)="setT(i, 'part', $event)" aria-label="Part de la tranche" /></label>
            <span class="tiny muted" style="min-width:48px">{{ pct(t.part) }} %</span>
            @if (s.can('tarifs.write')) { <button class="btn sm danger" type="button" [disabled]="td().length < 2" (click)="removeT(i)" aria-label="Retirer cette tranche">×</button> }
          </div>
        }
        @if (s.can('tarifs.write')) { <div><button class="btn sm" type="button" [disabled]="td().length >= 10" (click)="addT()">+ Ajouter une tranche</button></div> }
      </div>
      @if (tErr()) { <div class="err">{{ tErr() }}</div> }
      @if (s.can('tarifs.write')) { <div><button class="btn primary" type="button" (click)="saveT()">Enregistrer les tranches</button></div> }
    </div>
    <div class="card pad stack"><h2>Dates d’échéance</h2>
      <div class="form-grid">
        @for (d of dates(); track d.k) { <label class="field"><span>{{ d.l }}</span><input type="date" [disabled]="!s.can('tarifs.write')" [ngModel]="s.feeDates()[d.k]" (change)="saveDate(d.k, $any($event.target).value)" /></label> }
      </div></div>
  </div>`,
  styles: '.tr-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .tr-row .grow { flex: 1 1 160px; min-width: 0; } .tr-row .inline-input { width: 80px !important; }',
})
export class TarifsPage {
  readonly s = inject(Store); readonly fcfa = fcfa; readonly round = Math.round;
  readonly dates = computed(() => [{ k: 'INS', l: 'Inscription' }, ...this.s.tranches().map((t, i) => ({ k: `T${i + 1}`, l: t.label }))]);
  td = signal<{ label: string; part: number }[]>(this.s.tranches().map((t) => ({ ...t }))); tErr = signal('');
  first = (lv: string): number => splitTranches(this.s.tarifOf(lv).sco, this.td().map((t) => t.part))[0] ?? 0;
  pct = (part: number): number => Math.round((100 * (Number(part) || 0)) / (this.td().reduce((a, t) => a + (Number(t.part) || 0), 0) || 1));
  setT(i: number, k: 'label' | 'part', v: string | number): void { this.td.update((l) => l.map((t, j) => (j === i ? { ...t, [k]: k === 'part' ? Math.max(1, Math.round(Number(v) || 1)) : String(v) } : t))); }
  addT(): void { this.td.update((l) => [...l, { label: ordinalTranche(l.length + 1), part: 1 }]); }
  removeT(i: number): void { this.td.update((l) => l.filter((_, j) => j !== i)); }
  async saveT(): Promise<void> {
    this.tErr.set('');
    const r = await this.s.saveTranchesAsync(this.td());
    if (!r.ok) return void this.tErr.set(r.error ?? 'Enregistrement impossible.');
    this.td.set(this.s.tranches().map((t) => ({ ...t })));
    this.s.toast('Tranches enregistrées. Pensez à vérifier les dates d’échéance.');
  }
  levels = [...new Set([...this.s.levelNames(), ...Object.keys(this.s.tarifs())])];   // tous les niveaux du cursus, même sans tarif encore
  multi = computed(() => this.s.apiMode() && this.s.cursusList().length > 1);
  async setComplement(lv: string, v: string): Promise<void> {
    const n = v === '' ? null : Math.max(0, Math.round(Number(v) || 0));
    if (await this.s.setTarifAsync(lv, { ...this.s.tarifOf(lv), complement: n })) this.s.toast(`Tarif ${lv} mis à jour.`);
  }
  sibling(lv: string): number { return discountedTarif(this.s.tarifOf(lv), this.s.school().remiseFratrie ?? 0).sco; }
  async set(lv: string, f: 'ins' | 'sco', v: string): Promise<void> {
    const n = Math.max(0, Math.round(Number(v) || 0));
    if (await this.s.setTarifAsync(lv, { ...this.s.tarifOf(lv), [f]: n })) this.s.toast(`Tarif ${lv} mis à jour.`);
  }
  async saveDate(k: string, v: string): Promise<void> { if (v && (await this.s.setFeeDateAsync(k, v))) this.s.toast('Échéance mise à jour.'); }
}

// ---------- Rapprochement ----------
@Component({
  selector: 'app-rapprochement',
  imports: [FitHeight, FormsModule, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Rapprochement</h1><p>Comparez le relevé de l’agrégateur de paiement mobile (Orange, MTN, Moov, Wave) aux paiements enregistrés.</p></div>
      @if (s.apiMode() && s.can('rapprochement.write')) { <label class="btn">Importer le relevé (CSV)<input type="file" accept=".csv,text/csv" hidden (change)="onCsv($event)" /></label> }</div>
    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Lignes du relevé</span><span class="value">{{ s.statement().length }}</span></div>
      <div class="card kpi-card"><span class="label">Concordantes</span><span class="value">{{ s.statement().length - s.statementIssues().length }}</span></div>
      <div class="card kpi-card" [class.alert]="s.statementIssues().length > 0"><span class="label">À vérifier</span><span class="value">{{ s.statementIssues().length }}</span></div>
    </div>
    <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Référence</th><th>Moyen</th><th class="num">Montant relevé</th><th>Paiement enregistré</th><th>État</th><th></th></tr></thead><tbody>
      @for (l of lines(); track l.id) {
        <tr><td class="nowrap">{{ dateFr(l.date) }}</td><td class="num">{{ l.ref }}<div class="tiny muted">{{ l.phone }}</div></td><td>{{ label[l.mode] }}</td><td class="num"><b>{{ fcfa(l.amount) }}</b></td>
          <td>@if (l.pay) { {{ s.studentName(l.pay.studentId) }}<div class="tiny muted">{{ l.pay.receiptNo }} · {{ fcfa(l.pay.amount) }}</div> } @else { <span class="muted">—</span> }</td>
          <td>@if (l.state === 'ok') { <span class="pill ok">Concordant</span> } @else if (l.state === 'ecart') { <span class="pill warn">Écart de montant</span> } @else { <span class="pill bad">Non rattaché</span> }</td>
          <td class="right">@if (l.state === 'ecart' && s.can('rapprochement.write')) { <button class="btn sm" (click)="fix(l.id)">Aligner sur le relevé</button> } @if (l.state === 'orphelin' && s.can('rapprochement.write')) { <button class="btn sm primary" (click)="open(l.id)">Rattacher à un élève</button> }</td></tr>
      }</tbody></table></div></div>
  </div>
  @if (target(); as t) {
    <app-modal title="Rattacher le paiement à un élève" (closed)="target.set(null)">
      <p class="small">Ligne {{ t.ref }} · {{ fcfa(t.amount) }} · {{ label[t.mode] }} · {{ t.phone }}. Un paiement et un reçu seront créés pour l’élève choisi.</p>
      <label class="field" style="margin-top:12px"><span>Élève</span><input type="search" [ngModel]="sq()" (ngModelChange)="sq.set($event)" placeholder="Nom ou matricule" /></label>
      @for (r of found(); track r.id) { <button type="button" class="btn block" [class.primary]="choice() === r.id" style="justify-content:flex-start;margin-top:6px" (click)="choice.set(r.id)">{{ r.nom }} {{ r.prenoms }} <span class="small" style="opacity:.8">· {{ s.className(r.classId) }}</span></button> }
      <div footer><button class="btn ghost" (click)="target.set(null)">Annuler</button><button class="btn primary" [disabled]="!choice()" (click)="attach()">Rattacher</button></div>
    </app-modal>
  }`,
})
export class RapprochementPage {
  readonly s = inject(Store); readonly fcfa = fcfa; readonly dateFr = dateFr; readonly label = MODE_LABEL;
  target = signal<{ id: string; ref: string; amount: number; mode: PayMode; phone: string } | null>(null); sq = signal(''); choice = signal('');
  lines = computed(() => {
    const pm = new Map(this.s.payments().map((p) => [p.id, p]));
    return this.s.statement().map((l) => {
      const pay = l.paymentId ? pm.get(l.paymentId) : undefined;
      return { ...l, pay, state: !pay ? ('orphelin' as const) : pay.amount !== l.amount ? ('ecart' as const) : ('ok' as const) };
    }).sort((a, b) => (a.state === 'ok' ? 1 : 0) - (b.state === 'ok' ? 1 : 0) || b.date.localeCompare(a.date));
  });
  found = computed(() => { const t = this.sq().trim().toLowerCase(); return t.length < 2 ? [] : this.s.students().filter((x) => `${x.nom} ${x.prenoms} ${x.matricule}`.toLowerCase().includes(t)).slice(0, 5); });
  open(id: string): void { const l = this.s.statement().find((x) => x.id === id)!; this.sq.set(''); this.choice.set(''); this.target.set(l); }
  async attach(): Promise<void> { if (!(await this.s.matchLineAsync(this.target()!.id, this.choice()))) return; this.target.set(null); this.s.toast('Paiement rattaché, reçu créé.'); }
  async fix(id: string): Promise<void> { if (await this.s.fixMismatchAsync(id)) this.s.toast('Montant du paiement aligné sur le relevé.'); }
  async onCsv(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement; const f = input.files?.[0]; input.value = '';
    if (!f) return;
    const r = await this.s.importStatementAsync(f);
    if (r.error) return void this.s.toast(r.error, 'err');
    this.s.toast(`Relevé importé : ${r.created} ligne(s) ajoutée(s)${r.skipped ? `, ${r.skipped} déjà connue(s)` : ''}${r.errors?.length ? `, ${r.errors.length} invalide(s)` : ''}.`, r.errors?.length ? 'info' : 'ok');
  }
}

// ---------- Parent : scolarité et paiement mobile money (simulé) ----------
type Step = 'form' | 'wait' | 'process' | 'ok' | 'fail';
const OPS: { id: PayMode; name: string; color: string; code: string }[] = [
  { id: 'orange', name: 'Orange Money', color: '#ff7900', code: '#144#' },
  { id: 'mtn', name: 'MTN Money', color: '#ffcc00', code: '*133#' },
  { id: 'moov', name: 'Moov Money', color: '#0066b3', code: '*155#' },
  { id: 'wave', name: 'Wave', color: '#1dc8f2', code: 'application Wave' },
];

@Component({
  selector: 'app-payer',
  imports: [FormsModule, Icon, Modal],
  template: `
  @if (kid(); as k) {
  <div class="page">
    <div class="page-head"><div><h1>Scolarité de {{ k.prenoms }}</h1><p>{{ s.className(k.classId) }} · année {{ s.school().year }}</p></div></div>
    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Total annuel</span><span class="value">{{ fcfa(bal().total) }}</span></div>
      <div class="card kpi-card"><span class="label">Déjà payé</span><span class="value">{{ fcfa(bal().paid) }}</span></div>
      <div class="card kpi-card" [class.alert]="bal().overdue > 0"><span class="label">Reste à payer</span><span class="value">{{ fcfa(bal().solde) }}</span>@if (bal().overdue > 0) { <span class="hint">dont {{ fcfa(bal().overdue) }} échu</span> }</div>
    </div>
    @if (s.cursusDetail(k.id).length) {
      <div class="card pad stack"><h2>Forfait de tous les cursus</h2>
        @for (d of s.cursusDetail(k.id); track $index) { <div class="row small"><span class="grow">{{ d.label }} · {{ d.cursus }} ({{ d.level }})</span><b>{{ fcfa(d.amount) }}</b></div> }
        <span class="tiny muted">Un seul échéancier et un seul reçu pour tous les cursus.</span></div>
    }
    @if (carried(); as c) {
      <div class="banner info"><span>@if (c.report > 0) { Un solde de <b>{{ fcfa(c.report) }}</b> de l’année précédente est compris dans le total, à régler en premier. }@if (c.credit > 0) { Une avance de <b>{{ fcfa(c.credit) }}</b> versée l’an dernier a été déduite. }</span></div>
    }
    <div class="grid two">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Échéancier</h2></div><div class="table-wrap"><table class="table"><tbody>
          @for (l of s.feeLines(k.id); track l.key) {
            <tr><td class="cell-main">{{ l.label }}<div class="tiny muted">avant le {{ dateFr(l.due) }}</div></td><td class="num">{{ fcfa(l.amount) }}</td>
              <td>@if (l.remaining === 0) { <span class="pill ok">Payée</span> } @else if (l.overdue) { <span class="pill bad">Reste {{ fcfa(l.remaining) }}</span> } @else if (l.paid > 0) { <span class="pill warn">Reste {{ fcfa(l.remaining) }}</span> } @else { <span class="pill">À venir</span> }</td></tr>
          }
          @if (s.siblingDiscount(k.id); as sd) { @if (sd.pct > 0) { <tr><td class="cell-main">Remise fratrie −{{ sd.pct }} %<div class="tiny muted">déjà déduite de la scolarité</div></td><td class="num">−{{ fcfa(sd.amount) }}</td><td><span class="pill ok">Appliquée</span></td></tr> } }</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>Reçus</h2><button class="btn sm" (click)="openStatement()">Relevé et années passées</button></div><div class="table-wrap"><table class="table"><tbody>
          @for (p of pays(); track p.id) {
            <tr><td>{{ dateFr(p.date) }}<div class="tiny muted">{{ p.receiptNo }}</div></td><td>{{ label[p.mode] }}</td><td class="num">{{ fcfa(p.amount) }}@if (p.detail) { <div class="tiny muted">{{ p.detail.remaining > 0 ? 'reste ' + fcfa(p.detail.remaining) : 'soldé' }}</div> }</td><td class="right"><button class="btn sm" (click)="receipt(p)">Reçu</button></td></tr>
          } @empty { <tr><td class="empty">Aucun paiement enregistré.</td></tr> }</tbody></table></div></div>
      </div>

      <div class="card pad stack" style="align-self:start">
        <h2>Payer par mobile money</h2>
        @if (bal().solde === 0) { <div class="banner ok">La scolarité de {{ k.prenoms }} est entièrement réglée. Merci !</div> }
        @else {
          @switch (step()) {
            @case ('form') {
              <div class="field"><span>Montant à payer</span><div class="chips">
                @for (o of amountOpts(); track o.label) { <button class="chip" [class.on]="amount === o.v" (click)="amount = o.v">{{ o.label }} · {{ fcfa(+o.v) }}</button> }</div>
                <input inputmode="numeric" [(ngModel)]="amount" name="amt" placeholder="Autre montant" /></div>
              <div class="field"><span>Opérateur</span><div class="ops">
                @for (o of ops; track o.id) { <button type="button" class="op" [class.on]="op() === o.id" (click)="op.set(o.id)"><i [style.background]="o.color"></i>{{ o.name }}</button> }</div></div>
              <label class="field"><span>Numéro {{ opName() }}</span><input inputmode="tel" [(ngModel)]="phone" name="ph" placeholder="07 12 34 56 78" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
              <button class="btn accent block" (click)="start()">Payer {{ amountNum() > 0 ? fcfa(amountNum()) : '' }}</button>
              @if (!s.apiMode()) { <div class="banner info tiny">Mode démonstration : aucun argent réel n’est débité. Un numéro se terminant par <b>00</b> simule un paiement refusé.</div> }
            }
            @case ('wait') {
              <div class="ussd"><div class="tiny">Message de {{ opName() }}</div>
                <p>Demande de paiement de <b>{{ fcfa(amountNum()) }}</b> à « {{ s.school().name }} ». Saisissez votre code secret pour confirmer.</p>
                <div class="tiny">Ou composez {{ currentOp().code }}</div></div>
              <p class="small muted">Une demande a été envoyée au <b>{{ phone }}</b>. Validez-la sur votre téléphone, puis revenez ici.</p>
              <button class="btn primary block" (click)="validate()">J’ai validé sur mon téléphone{{ s.apiMode() ? '' : ' (simulation)' }}</button>
              <button class="btn ghost block" (click)="reset()">Annuler</button>
            }
            @case ('process') { <div class="center stack" style="padding:20px 0"><div class="spin" aria-hidden="true"></div><b>Confirmation par l’opérateur…</b><span class="small muted">Nous attendons la réponse de {{ opName() }}. Ne fermez pas cette page.</span></div> }
            @case ('ok') {
              <div class="banner ok"><app-icon name="check" [size]="18" /><span><b>Paiement confirmé.</b> {{ fcfa(last()!.amount) }} reçus. Reçu n° {{ last()!.receiptNo }}.</span></div>
              <button class="btn block" (click)="receipt(last()!)">Télécharger le reçu</button>
              <button class="btn primary block" (click)="reset()">Terminer</button>
            }
            @case ('fail') {
              <div class="banner bad"><b>Paiement refusé.</b> {{ opName() }} indique : solde insuffisant ou code secret erroné. Aucun montant n’a été débité.</div>
              <button class="btn primary block" (click)="step.set('form')">Réessayer</button>
            }
          }
        }
      </div>
    </div>
  </div>
  }
  @if (stmt(); as st) {
    <app-modal title="Relevé de paiements" size="wide" (closed)="stmt.set(null)">
      <p><b>{{ st.name }}</b> · {{ st.className }}</p>
      @for (y of st.years; track y.label) {
        <h3 style="margin:12px 0 4px">Année {{ y.label }}</h3>
        <p class="small muted" style="margin:0 0 6px">Total payé : <b>{{ fcfa(y.paid) }}</b></p>
        <div class="table-wrap"><table class="table"><tbody>
          @for (p of y.payments; track p.id) { <tr [style.opacity]="p.status === 'annule' ? 0.5 : 1"><td>{{ dateFr(p.date) }}<div class="tiny muted">{{ p.receiptNo }}@if (p.status === 'annule') { · annulé }</div></td><td>{{ label[p.mode] }}</td><td class="num">{{ fcfa(p.amount) }}</td></tr> }</tbody></table></div>
      } @empty { <p class="muted">Aucun paiement enregistré.</p> }
      <div footer><button class="btn ghost" (click)="stmt.set(null)">Fermer</button><button class="btn primary" (click)="printStatement()">Télécharger</button></div>
    </app-modal>
  }`,
  styles: `
    .ops { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .op { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--surface); cursor: pointer; font-weight: 600; }
    .op i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; flex: none; }
    .op.on { border-color: var(--brand); background: var(--brand-tint); }
    .ussd { background: #1b1f1d; color: #eaf3ee; border-radius: 12px; padding: 14px 16px; display: grid; gap: 6px; font-family: ui-monospace, monospace; font-size: 13px; }
    .spin { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--brand); animation: sp 0.9s linear infinite; margin: 0 auto; }
    @keyframes sp { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
  `,
})
export class PayerPage implements OnDestroy {
  readonly s = inject(Store); readonly fcfa = fcfa; readonly dateFr = dateFr; readonly label = MODE_LABEL; readonly ops = OPS;
  step = signal<Step>('form'); op = signal<PayMode>('orange'); phone = ''; amount = ''; err = signal(''); last = signal<Payment | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  kid = computed(() => this.s.activeChild());
  bal = computed(() => this.s.balance(this.kid()?.id ?? ''));
  pays = computed(() => (this.s.paymentsByStudent().get(this.kid()?.id ?? '') ?? []).filter((p) => p.status === 'confirme').sort((a, b) => b.date.localeCompare(a.date)));
  currentOp = () => OPS.find((o) => o.id === this.op())!;
  opName = () => this.currentOp().name;
  amountNum = () => Number(this.amount.replace(/\s/g, '')) || 0;
  amountOpts = computed(() => {
    const b = this.bal(); const next = this.s.feeLines(this.kid()?.id ?? '').find((l) => l.remaining > 0);
    const o: { label: string; v: string }[] = [];
    if (b.overdue > 0) o.push({ label: 'Montant échu', v: String(b.overdue) });
    if (next && next.remaining !== b.overdue) o.push({ label: next.label, v: String(next.remaining) });
    if (b.solde !== b.overdue && b.solde !== next?.remaining) o.push({ label: 'Tout solder', v: String(b.solde) });
    return o;
  });
  constructor() { const o = this.amountOpts(); if (o.length) this.amount = o[0].v; }
  ngOnDestroy(): void { clearTimeout(this.timer); }
  private ref = '';
  async start(): Promise<void> {
    const n = this.amountNum(); const solde = this.bal().solde;
    if (n < 100) return void this.err.set('Saisissez un montant d’au moins 100 FCFA.');
    if (n > solde) return void this.err.set(`Le montant dépasse le reste à payer (${fcfa(solde)}).`);
    if (this.phone.replace(/\D/g, '').length !== 10) return void this.err.set('Saisissez un numéro à 10 chiffres.');
    this.err.set('');
    if (this.s.apiMode()) {
      const r = await this.s.initiatePay(this.kid()!.id, n, this.op(), this.phone.replace(/\D/g, ''));
      if (!r.intent) return void this.err.set(r.error ?? 'Paiement impossible.');
      this.ref = r.intent.reference;
    }
    this.step.set('wait');
  }
  private async settleOnline(): Promise<void> {
    // En développement, le serveur peut simuler l'opérateur ; en production seul le retour signé de l'opérateur confirme.
    await this.s.sandboxConfirm(this.ref, this.phone.replace(/\D/g, '').endsWith('00'));
    for (let i = 0; i < 45 && this.step() === 'process'; i++) {
      const it = await this.s.intentStatus(this.ref);
      if (it && it.status !== 'pending') {
        if (it.status === 'succeeded' && it.payment) {
          await this.s.refreshFinance();
          const p = this.s.payments().find((x) => x.id === String(it.payment));
          if (p) { this.last.set(p); this.step.set('ok'); return; }
        }
        return void this.step.set('fail');
      }
      await new Promise((r) => (this.timer = setTimeout(r, 2000)));
    }
    if (this.step() === 'process') { this.s.toast('Le serveur attend encore la réponse de l’opérateur. Vous serez prévenu par notification.', 'info'); this.reset(); }
  }
  validate(): void {
    this.step.set('process');
    if (this.s.apiMode()) { void this.settleOnline(); return; }
    this.timer = setTimeout(() => {
      // Simule la notification de l'opérateur (webhook) : le paiement n'est confirmé qu'à ce moment-là
      if (this.phone.replace(/\D/g, '').endsWith('00')) return void this.step.set('fail');
      const k = this.kid()!; const ref = `${this.op().slice(0, 2).toUpperCase()}-${this.s.today.replace(/-/g, '').slice(2)}-${Math.floor(Math.random() * 9000 + 1000)}`;
      const p = this.s.recordPayment({ studentId: k.id, amount: this.amountNum(), mode: this.op(), ref, byUserId: 'u-system', note: 'Paiement en ligne' });
      this.s.statement.update((x) => [...x, { id: 'st-' + p.id, ref, date: p.date, mode: p.mode, amount: p.amount, phone: this.phone, paymentId: p.id }]);
      this.last.set(p); this.step.set('ok');
    }, 1600);
  }
  reset(): void { clearTimeout(this.timer); this.step.set('form'); const o = this.amountOpts(); this.amount = o[0]?.v ?? ''; }
  receipt(p: Payment): void { downloadReceipt(this.s, p); }
  carried = computed(() => { const id = this.kid()?.id ?? ''; const report = this.s.reports()[id] ?? 0, credit = this.s.credits()[id] ?? 0; return report > 0 || credit > 0 ? { report, credit } : null; });
  stmt = signal<StudentStatement | null>(null);
  async openStatement(): Promise<void> { this.stmt.set(await this.s.studentStatement(this.kid()!.id)); }
  printStatement(): void { const st = this.stmt(); if (st) void this.s.download(`releve-${st.matricule}.html`, statementHtml(this.s, st)); }
}
