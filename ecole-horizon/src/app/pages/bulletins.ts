import { Component, ViewEncapsulation, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { BulletinAccess, Store } from '../store';
import { FitHeight, Icon } from '../ui';
import { fcfa, fnum } from '../format';
import { AnnualSummary, TemplateId } from '../models';
import { BULLETIN_CSS, bulletinHtml, fullHtml } from './bulletin-html';

const TEMPLATES: { id: TemplateId; n: string; d: string }[] = [
  { id: 'classique', n: 'Classique', d: 'Sobre, en-tête officiel' },
  { id: 'moderne', n: 'Moderne', d: 'Couleurs et barres de comparaison' },
  { id: 'compact', n: 'Compact', d: 'Une demi-page' },
];

@Component({
  selector: 'app-bulletin',
  encapsulation: ViewEncapsulation.None,
  styles: [BULLETIN_CSS + '.bl-wrap { overflow-x: auto; padding-bottom: 4px; } .bl-wrap .bl { min-width: 640px; }'],
  template: `<div class="bl-wrap" [innerHTML]="html()"></div>`,
})
export class BulletinView {
  private s = inject(Store);
  private san = inject(DomSanitizer);
  studentId = input.required<string>();
  tpl = input.required<TemplateId>();
  published = input(true);
  // Bulletin de la dernière période en mode serveur : le bilan annuel vient du serveur (lui seul connaît toutes les périodes de la classe)
  private annual = signal<AnnualSummary | null>(null);
  private loadAnnual = effect(() => {
    const id = this.studentId(), pub = this.published(), last = this.s.isLastTerm(), term = this.s.termId(); this.s.grades();
    this.annual.set(null);
    if (id && last && this.s.apiMode()) void this.s.bulletinAnnual(id, pub).then((a) => { if (this.studentId() === id && this.s.termId() === term) this.annual.set(a); });
  });
  html = computed(() => {
    // Toutes les valeurs sont échappées dans bulletinHtml
    this.s.termId(); this.s.apprec(); this.s.conseil(); this.s.school(); this.s.grades(); this.s.evals(); this.s.absences(); this.s.decisions();
    return this.san.bypassSecurityTrustHtml(bulletinHtml(this.s, this.studentId(), this.tpl(), this.published(), this.s.apiMode() ? this.annual() : undefined));
  });
}

@Component({
  selector: 'app-bulletins',
  imports: [FormsModule, Icon, BulletinView, FitHeight],
  styles: `
    .bull-layout { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 20px; align-items: start; }
    .bull-side { position: sticky; top: 16px; }
    /* Grand écran : la page ne défile plus, seul l'aperçu du bulletin défile dans son cadre */
    .bull-layout.fit-h { align-items: stretch; }
    .bull-layout.fit-h > * { min-height: 0; overflow: auto; }
    .bull-layout.fit-h > app-bulletin { display: block; }
    .bull-layout.fit-h > .bull-side { position: static; }
    .bull-side .field { flex: 1 1 100%; }
    .bull-side .field select { width: 100%; }
    .bull-actions .btn { flex: 1 1 100%; justify-content: center; }
    @media (max-width: 1100px) {
      .bull-layout { grid-template-columns: 1fr; }
      .bull-side { position: static; }
    }
  `,
  template: `
  <div class="page">
  @switch (s.role()) {
    @case ('enseignant') {
      <div class="page-head"><div><h1>Appréciations</h1><p>{{ s.term().label }}. Rédigez l’appréciation de chaque élève dans votre matière : elle figurera sur le bulletin.</p></div></div>
      @if (s.term().locked) { <div class="banner warn">Période verrouillée : les appréciations ne sont plus modifiables.</div> }
      <div class="chips">@for (a of s.myAssignments(); track a.id) { <button class="chip" [class.on]="asg() === a.classId + '|' + a.subjectId" (click)="asg.set(a.classId + '|' + a.subjectId)">{{ s.className(a.classId) }} · {{ s.subjectById().get(a.subjectId)?.short }}</button> }</div>
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Élève</th><th class="num">Moyenne</th><th style="width:55%">Appréciation</th></tr></thead><tbody>
        @for (e of tStudents(); track e.id) {
          <tr><td class="cell-main">{{ e.nom }} {{ e.prenoms }}</td><td class="num"><b>{{ fnum(avgOf(e.id)) }}</b></td>
            <td><input [disabled]="s.term().locked" [ngModel]="s.apprec()[e.id + '|' + s.termId() + '|' + tSubject()]" (change)="saveApp(e.id, $any($event.target).value)" placeholder="Ex. : Bon travail, continuez ainsi." maxlength="90" [attr.aria-label]="'Appréciation de ' + e.nom" /></td></tr>
        }</tbody></table></div></div>
      <div>
        <button class="btn" (click)="suggest()" [disabled]="s.term().locked">Proposer des appréciations pour les cases vides</button>
        <span class="tiny muted" style="margin-inline-start:8px">D’après la moyenne de matière ; à relire avant publication.</span></div>
    }
    @default {
      <div class="page-head"><div><h1>{{ s.role() === 'eleve' ? 'Mes bulletins' : 'Bulletins' }}</h1>
        <p>{{ s.term().label }}.
          @if (staff()) { Visualisez, complétez le conseil de classe et générez les bulletins. } @else { Bulletin établi à partir des notes publiées. }</p></div></div>
      @if (famLocked(); as a) {
        <div class="banner warn stack" role="status">
          <b>Bulletin disponible après règlement {{ a.mode === 'retard' ? 'des échéances en retard' : 'du reste de la scolarité' }} : {{ fcfa(a.amount) }}.</b>
          <span>Les notes restent consultables dans « Notes ». @if (s.role() === 'parent') { Vous pouvez régler en ligne ou auprès de la comptabilité de l’école. } @else { Rapprochez-vous de vos parents ou de la comptabilité de l’école. }</span>
          @if (s.role() === 'parent') { <div><button class="btn primary" (click)="s.go('payer')"><app-icon name="card" [size]="16" /> Régler la scolarité</button></div> }
        </div>
      }
      <!-- Réglages à gauche, aperçu du bulletin à droite (l'un sous l'autre sur un écran étroit) -->
      <div class="bull-layout" appFitHeight>
      <div class="card pad stack bull-side">
        <div class="row">
          @if (staff()) {
            <label class="field"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cid.set($event); pickFirst()">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
            <label class="field" style="min-width:230px"><span>Élève</span><select [ngModel]="sid()" (ngModelChange)="picked.set($event)">@for (e of aStudents(); track e.id) { <option [value]="e.id">{{ e.nom }} {{ e.prenoms }}</option> }</select></label>
          }
          @if (staff()) { <div class="field"><span>Modèle</span><div class="chips">@for (t of templates; track t.id) { <button class="chip" [class.on]="tpl() === t.id" [title]="t.d" (click)="tpl.set(t.id)">{{ t.n }}</button> }</div></div> }
          @if (staff()) {
            <label class="row small" style="align-self:flex-end;gap:6px"><input type="checkbox" [ngModel]="prov()" (ngModelChange)="prov.set($event)" /> Inclure les notes non publiées (aperçu provisoire)</label>
          }
        </div>
        <!-- Appréciation du conseil et téléchargements sur une même ligne (le champ prend la place libre, les boutons s'alignent en bas) -->
        <div class="row bull-actions">
          @if (staff() && sid()) {
            <label class="field"><span>Appréciation du conseil de classe</span>
              <textarea rows="2" maxlength="220" [disabled]="!s.can('conseil')" [ngModel]="s.conseil()[sid() + '|' + s.termId()]" (change)="saveConseil($any($event.target).value)" placeholder="Ex. : Résultats satisfaisants. Poursuivre les efforts."></textarea></label>
          }
          <button class="btn primary" [disabled]="!sid() || famLocked()" (click)="downloadOne()"><app-icon name="download" [size]="16" /> Télécharger ce bulletin</button>
          @if (s.can('bulletins.gen')) { <button class="btn" (click)="downloadClass()"><app-icon name="file" [size]="16" /> Générer tous les bulletins de la classe ({{ aStudents().length }})</button> }
        </div>
        @if (staff() && sid() && access(); as a) {
          @if (a.derogation) {
            <div class="banner info stack small">Bulletin remis à la famille par dérogation{{ a.derogation.by ? ' de ' + a.derogation.by : '' }}{{ a.derogation.note ? ' : « ' + a.derogation.note + ' »' : '' }}.
              @if (s.can('bulletins.gen')) { <div><button class="btn" (click)="derogation(false)">Retirer la dérogation</button></div> }</div>
          } @else if (a.locked) {
            <div class="banner warn stack small">La famille ne voit pas ce bulletin : {{ fcfa(a.amount) }} {{ a.mode === 'retard' ? 'd’échéances en retard' : 'restant sur la scolarité' }}.
              @if (s.can('bulletins.gen')) {
                <div class="row"><input [ngModel]="derogNote()" (ngModelChange)="derogNote.set($event)" maxlength="200" placeholder="Motif (facultatif) : cas social, arrangement…" aria-label="Motif de la dérogation" style="flex:1 1 180px" />
                  <button class="btn" (click)="derogation(true)">Débloquer pour cette année</button></div>
              }</div>
          }
        }
        @if (staff() && sid()) { <span class="tiny muted">Appréciation : @if (s.can('conseil')) { enregistrée automatiquement quand vous quittez le champ. } @else { rédigée par la direction. }</span> }
        @if (s.apiMode()) { <p class="tiny muted">Le PDF est produit par le serveur. Un bulletin définitif porte un QR code : en le scannant, on vérifie que le document correspond aux notes enregistrées par l’école.</p> }
        @else { <p class="tiny muted">Le fichier téléchargé s’ouvre dans le navigateur ; le bouton « Imprimer » permet de l’enregistrer en PDF.</p> }
      </div>
      @if (famLocked()) { <div class="card empty">Bulletin non disponible pour le moment.</div> }
      @else if (sid()) {
        <app-bulletin [studentId]="sid()" [tpl]="tpl()" [published]="!staff() || !prov()" />
      } @else { <div class="card empty">Aucun élève à afficher.</div> }
      </div>
    }
  }
  </div>`,
})
export class BulletinsPage {
  readonly s = inject(Store); readonly fnum = fnum; readonly fcfa = fcfa; readonly templates = TEMPLATES;
  staff = computed(() => ['admin', 'directeur', 'fondateur'].includes(this.s.role() ?? ''));
  tpl = signal<TemplateId>(this.s.school().template); prov = signal(false);
  cid = signal(this.s.classes().find((c) => c.id === 'c3a')?.id ?? this.s.classes()[0]?.id ?? '');
  picked = signal<string | null>(null);
  aStudents = computed(() => this.s.studentsByClass().get(this.cid()) ?? []);
  sid = computed(() => {
    const r = this.s.role();
    if (r === 'parent' || r === 'eleve') return this.s.activeChild()?.id ?? '';
    const p = this.picked();
    return p && this.aStudents().some((x) => x.id === p) ? p : this.aStudents()[0]?.id ?? '';
  });
  // Bulletin réservé aux familles à jour (réglage de l'école) : état lu sur le serveur pour l'élève affiché
  access = signal<BulletinAccess | null>(null); derogNote = signal('');
  famLocked = computed(() => { const a = this.access(); return (this.s.role() === 'parent' || this.s.role() === 'eleve') && a?.locked ? a : null; });
  private loadAccess = effect(() => {
    const id = this.sid(); this.access.set(null); this.derogNote.set('');
    if (id && this.s.apiMode() && this.s.role() !== 'enseignant') void this.s.bulletinAccess(id).then((a) => { if (this.sid() === id) this.access.set(a); });
  });
  async derogation(on: boolean): Promise<void> {
    const a = await this.s.setBulletinDerogation(this.sid(), on, this.derogNote().trim());
    if (a) { this.access.set(a); this.derogNote.set(''); }
  }
  constructor() {
    const p = this.s.param(); const st = p ? this.s.studentById().get(p) : null;
    if (st && this.staff()) { this.cid.set(st.classId); this.picked.set(st.id); }
  }
  // sid est dérivé ; l'écriture passe par picked
  pickFirst(): void { this.picked.set(null); }

  // Enseignant
  asg = signal(`${this.s.myAssignments()[0]?.classId}|${this.s.myAssignments()[0]?.subjectId}`);
  tStudents = computed(() => this.s.studentsByClass().get(this.asg().split('|')[0]) ?? []);
  tSubject = computed(() => this.asg().split('|')[1]);
  avgOf(id: string): number | null { return this.s.resultOf(id, false)?.subjects.find((x) => x.subjectId === this.tSubject())?.moy ?? null; }
  saveApp(id: string, v: string): void { void this.s.setApprecAsync(id, this.s.termId(), this.tSubject(), v.trim()); }
  async suggest(): Promise<void> {
    let n = 0;
    for (const e of this.tStudents()) {
      const key = `${e.id}|${this.s.termId()}|${this.tSubject()}`;
      const m = this.avgOf(e.id);
      if (m === null || this.s.apprec()[key]) continue;
      const t = m >= 16 ? 'Excellent travail, félicitations.' : m >= 14 ? 'Très bon parcours, à poursuivre.' : m >= 12 ? 'Bons résultats, peut encore progresser.' : m >= 10 ? 'Résultats passables, des efforts sont attendus.' : m >= 8 ? 'Insuffisant. Travail et assiduité à renforcer.' : 'Très insuffisant. Un suivi est nécessaire.';
      if (await this.s.setApprecAsync(e.id, this.s.termId(), this.tSubject(), t)) n++;
    }
    this.s.toast(n ? `${n} appréciation(s) proposée(s). Relisez-les avant publication.` : 'Aucune case vide à compléter.', n ? 'ok' : 'info');
  }

  // Admin / familles
  async saveConseil(v: string): Promise<void> { if (await this.s.setConseilAsync(this.sid(), this.s.termId(), v.trim())) this.s.toast('Appréciation enregistrée.'); }
  private published = () => !this.staff() || !this.prov();
  downloadOne(): void {
    const st = this.s.studentById().get(this.sid())!;
    if (this.s.apiMode()) { void this.s.bulletinPdf('students', st.id, this.tpl(), this.published(), `bulletin-${st.nom.toLowerCase()}-${st.prenoms.split(' ')[0].toLowerCase()}-${this.s.termId()}.pdf`); return; }
    const html = fullHtml(`Bulletin ${st.nom} ${st.prenoms}`, [bulletinHtml(this.s, st.id, this.tpl(), this.published())], this.s.school().hue);
    void this.s.download(`bulletin-${st.nom.toLowerCase()}-${st.prenoms.split(' ')[0].toLowerCase()}-${this.s.termId()}.html`, html);
  }
  downloadClass(): void {
    if (this.s.apiMode()) { void this.s.bulletinPdf('classes', this.cid(), this.tpl(), this.published(), `bulletins-${this.s.className(this.cid()).replace(/\s/g, '')}-${this.s.termId()}.pdf`); return; }
    const list = this.aStudents();
    const html = fullHtml(`Bulletins ${this.s.className(this.cid())}`, list.map((e) => bulletinHtml(this.s, e.id, this.tpl(), this.published())), this.s.school().hue);
    this.s.addLog('Bulletins', `Génération des bulletins ${this.s.className(this.cid())} (${list.length}) · ${this.s.term().label}`);
    void this.s.download(`bulletins-${this.s.className(this.cid()).replace(/\s/g, '')}-${this.s.termId()}.html`, html);
  }
}
