import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImportReport, Store, Credential, NewStudentForm } from '../store';
import { Avatar, Icon, ListModal, Modal, FitHeight } from '../ui';
import { Chart, Serie } from '../charts';
import { dateFr, fcfa, fnum, rangLabel, toCsv, waLink } from '../format';
import { INCIDENT_LABEL, MODE_LABEL, SANCTION_LABEL, Student } from '../models';
import { mention } from '../engine';
import { accessSheetHtml } from './bulletin-html';

const phoneOk = (p: string) => p.replace(/\D/g, '').length === 10;
const fmtPhone = (p: string) => p.replace(/\D/g, '').replace(/(\d{2})(?=\d)/g, '$1 ').trim();

interface ImportRow { line: number; raw: string[]; form?: NewStudentForm; errors: string[]; }

const EXAMPLE = `nom;prenoms;sexe;naissance;lieu;classe;parent;telephone
TRAORE;Mariam;F;12/03/2012;Abidjan;6e A;Traoré Seydou;0707112233
KOFFI;Yao Emmanuel;M;04/09/2011;Bouaké;6e B;Koffi Akissi;0505334455
BAMBA;Nafissatou;F;21/01/2010;Daloa;5e A;Bamba Lassina;0102556677
N'GUESSAN;Cédric;M;30/07/2012;Yamoussoukro;Classe inconnue;N'Guessan Paul;0708998877
DIALLO;Aïcha;F;15/11/2011;Korhogo;6e A;Diallo Moussa;07123`;

@Component({
  selector: 'app-eleves',
  imports: [FormsModule, Icon, Avatar, Modal, FitHeight, ListModal, NgTemplateOutlet],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Élèves</h1><p>{{ list().length }} élève(s) affiché(s) sur {{ s.students().length }}.</p></div>
      <div class="row">
        <button class="btn" (click)="exportCsv()"><app-icon name="download" [size]="16" /> Exporter</button>
        @if (s.can('students.write')) {
          <button class="btn" (click)="openImport()"><app-icon name="upload" [size]="16" /> Importer</button>
          <button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Nouvel élève</button>
        }
      </div></div>
    <div class="card" appFitHeight>
      <div class="card-head">
        <div class="row">
          <input type="search" placeholder="Nom ou matricule" [ngModel]="q()" (ngModelChange)="q.set($event)" style="width:230px" aria-label="Filtrer" />
          <select [ngModel]="cls()" (ngModelChange)="cls.set($event)" style="width:auto" aria-label="Classe">
            <option value="">Toutes les classes</option>
            @for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select>
        </div>
      </div>
      <div class="table-wrap"><table class="table hover">
        <thead><ng-container [ngTemplateOutlet]="head" /></thead>
        <tbody>
          @for (st of page(); track st.id) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: st }" /> }
          @empty { <tr><td colspan="5" class="empty">Aucun élève ne correspond à ces critères.</td></tr> }
        </tbody></table></div>
      @if (list().length > shown()) {
        <div class="card-body center"><button class="btn" (click)="all.set(true)">Afficher la suite · {{ list().length - shown() }} de plus</button></div>
      }
    </div>
    <ng-template #head><tr><th>Élève</th><th>Matricule</th><th>Classe</th><th>Parent</th><th class="right">Solde</th></tr></ng-template>
    <ng-template #row let-st>
            <tr style="cursor:pointer" (click)="s.go('eleve', st.id)">
              <td><div class="row"><app-avatar [name]="st.prenoms + ' ' + st.nom" [size]="30" /><span class="cell-main">{{ st.nom }} {{ st.prenoms }}</span></div></td>
              <td class="num">{{ st.matricule }}</td><td>{{ s.className(st.classId) }}</td>
              <td>{{ s.parentById().get(st.parentId)?.name }}<div class="tiny muted">{{ s.parentById().get(st.parentId)?.phone }}</div></td>
              <td class="right num">@if (s.balance(st.id).overdue > 0) { <span class="pill warn">{{ fcfa(s.balance(st.id).overdue) }} échu</span> } @else if (s.balance(st.id).solde === 0) { <span class="pill ok">Soldé</span> } @else { <span class="muted">{{ fcfa(s.balance(st.id).solde) }}</span> }</td>
            </tr>
    </ng-template>
    @if (all()) { <app-list-modal title="Élèves" [items]="list()" [head]="head" [row]="row" [text]="studentText" [cols]="5" [hover]="true" [exportable]="true"
        placeholder="Nom, matricule, classe ou parent" (exported)="exportCsv()" (closed)="all.set(false)" /> }
  </div>

  @if (adding()) {
    <app-modal title="Inscrire un nouvel élève" size="wide" (closed)="adding.set(false)">
      @if (created()) {
        <div class="banner ok">Élève inscrit. Remettez ces identifiants à la famille : les mots de passe sont provisoires et seront à changer à la première connexion.</div>
        <div class="stack" style="margin-top:14px">
          @for (c of created(); track c.username) {
            <div class="card flat pad"><b>{{ c.label }}</b><div class="small">Identifiant : <code>{{ c.username }}</code> · Mot de passe : <code>{{ c.password }}</code></div></div>
          } @empty { <p class="muted">Le parent possède déjà un compte : aucun nouvel identifiant n'a été créé pour lui.</p> }
        </div>
      } @else {
        <div class="form-grid">
          <label class="field"><span>Nom</span><input [(ngModel)]="f.nom" name="nom" />@if (touched() && !f.nom.trim()) { <span class="err">Obligatoire</span> }</label>
          <label class="field"><span>Prénoms</span><input [(ngModel)]="f.prenoms" name="prenoms" />@if (touched() && !f.prenoms.trim()) { <span class="err">Obligatoire</span> }</label>
          <label class="field"><span>Sexe</span><select [(ngModel)]="f.sexe" name="sexe"><option value="F">Fille</option><option value="M">Garçon</option></select></label>
          <label class="field"><span>Date de naissance</span><input type="date" [(ngModel)]="f.naissance" name="nais" />@if (touched() && !f.naissance) { <span class="err">Obligatoire</span> }</label>
          <label class="field"><span>Lieu de naissance</span><input [(ngModel)]="f.lieu" name="lieu" /></label>
          <label class="field"><span>Classe</span><select [(ngModel)]="f.classId" name="cl">
            <optgroup label="Classe">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }} ({{ (s.studentsByClass().get(c.id)?.length ?? 0) }}/{{ c.max }})</option> }</optgroup>
            @if (s.apiMode()) { <optgroup label="À répartir plus tard (la classe se choisit à la répartition)">@for (lv of levels; track lv) { <option [value]="'placer:' + lv">{{ lv }} · à répartir</option> }</optgroup> }
          </select>@if (f.classId.startsWith('placer:')) { <span class="tiny muted">L’élève rejoint la liste « à placer » de son niveau (Fin d’année et nouvelle année, étape 3). La scolarité peut être encaissée dès maintenant.</span> }</label>
        </div>
        <h3 style="margin:18px 0 10px">Parent ou tuteur</h3>
        <div class="form-grid">
          <label class="field"><span>Civilité</span><select [(ngModel)]="f.parentTitle" name="civ"><option value="M.">M.</option><option value="Mme">Mme</option></select></label>
          <label class="field"><span>Nom complet</span><input [(ngModel)]="f.parentName" name="pn" />@if (touched() && !f.parentName.trim()) { <span class="err">Obligatoire</span> }</label>
          <label class="field"><span>Téléphone (10 chiffres)</span><input [(ngModel)]="f.parentPhone" name="tel" inputmode="tel" placeholder="07 12 34 56 78" />@if (touched() && !phoneOk(f.parentPhone)) { <span class="err">Numéro à 10 chiffres requis</span> }</label>
        </div>
        <p class="tiny muted" style="margin-top:10px">Si le numéro appartient déjà à un parent, l’élève est rattaché à son compte (fratrie).</p>
      }
      <div footer>
        @if (created()) { <button class="btn" (click)="printSheet()"><app-icon name="download" [size]="16" /> Fiche d’accès à imprimer</button><button class="btn ghost" (click)="adding.set(false)">Fermer</button><button class="btn primary" (click)="openAdd()">Inscrire un autre élève</button> }
        @else { <button class="btn ghost" (click)="adding.set(false)">Annuler</button><button class="btn primary" (click)="save()">Inscrire l’élève</button> }
      </div>
    </app-modal>
  }

  @if (importing()) {
    <app-modal title="Importer des élèves" size="xl" (closed)="importing.set(false)">
      @if (importDone()) {
        <div class="banner ok">{{ importDone()!.length }} compte(s) créé(s). Téléchargez la liste des identifiants provisoires avant de fermer cette fenêtre.</div>
        <div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>Compte</th><th>Identifiant</th><th>Mot de passe provisoire</th></tr></thead><tbody>
          @for (c of importDone()!.slice(0, 12); track c.username) { <tr><td>{{ c.label }}</td><td><code>{{ c.username }}</code></td><td><code>{{ c.password }}</code></td></tr> }
        </tbody></table></div>
        @if (importDone()!.length > 12) { <p class="tiny muted">… et {{ importDone()!.length - 12 }} autres dans le fichier.</p> }
      } @else if (s.apiMode()) {
        <p class="small muted">Importez un fichier Excel (.xlsx) ou CSV. Le site le vérifie d’abord et liste les erreurs ligne par ligne : rien n’est enregistré avant votre confirmation.</p>
        <div class="row" style="margin:10px 0"><button class="btn sm" (click)="s.downloadImportTemplate()"><app-icon name="download" [size]="16" /> Télécharger le modèle Excel</button></div>
        <label class="field"><span>Fichier à importer</span><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pickFile($event)" /></label>
        @if (fileErr()) { <div class="banner bad" role="alert" style="margin-top:8px">{{ fileErr() }}</div> }
        @if (report(); as r) {
          <div class="row" style="margin:12px 0"><span class="pill ok">{{ r.valid }} valide(s)</span> @if (r.errors.length) { <span class="pill bad">{{ r.errors.length }} à corriger</span> } <span class="tiny muted">sur {{ r.total }} ligne(s)</span></div>
          @if (r.errors.length) {
            <div class="table-wrap"><table class="table"><thead><tr><th>Ligne</th><th>Nom</th><th>Problème</th></tr></thead><tbody>
              @for (e of r.errors.slice(0, 50); track e.line) { <tr><td class="num">{{ e.line }}</td><td>{{ e.nom }}</td><td><span class="pill bad" style="white-space:normal">{{ e.errors.join(" · ") }}</span></td></tr> }
            </tbody></table></div>
            @if (r.errors.length > 50) { <p class="tiny muted">… et {{ r.errors.length - 50 }} autre(s) erreur(s).</p> }
            <p class="small muted" style="margin-top:8px">Les lignes en erreur seront ignorées. Vous pouvez les corriger dans le fichier puis le choisir à nouveau, ou importer seulement les lignes valides.</p>
          }
        }
      } @else {
        <p class="small muted">Collez le contenu d’un fichier CSV (séparateur point-virgule) avec les colonnes : nom, prénoms, sexe, naissance (JJ/MM/AAAA), lieu, classe, parent, téléphone.</p>
        <div class="row" style="margin:10px 0"><button class="btn sm" (click)="csv.set(example)">Charger un exemple</button></div>
        <textarea rows="6" [ngModel]="csv()" (ngModelChange)="csv.set($event); checked.set(false)" placeholder="nom;prenoms;sexe;naissance;lieu;classe;parent;telephone" style="font-family:monospace;font-size:13px"></textarea>
        <div class="row" style="margin:12px 0"><button class="btn" (click)="checked.set(true)" [disabled]="!csv().trim()">Vérifier le fichier</button>
          @if (checked()) { <span class="pill ok">{{ okRows().length }} valide(s)</span> @if (badRows().length) { <span class="pill bad">{{ badRows().length }} à corriger</span> } }</div>
        @if (checked()) {
          <div class="table-wrap"><table class="table"><thead><tr><th>Ligne</th><th>Élève</th><th>Classe</th><th>Parent</th><th>Contrôle</th></tr></thead><tbody>
            @for (r of rows(); track r.line) {
              <tr><td class="num">{{ r.line }}</td><td>{{ r.raw[0] }} {{ r.raw[1] }}</td><td>{{ r.raw[5] }}</td><td>{{ r.raw[6] }} <span class="tiny muted">{{ r.raw[7] }}</span></td>
                <td>@if (r.errors.length) { <span class="pill bad">{{ r.errors.join(' · ') }}</span> } @else { <span class="pill ok">Valide</span> }</td></tr>
            }
          </tbody></table></div>
          @if (badRows().length) { <p class="small muted" style="margin-top:8px">Les lignes en erreur seront ignorées. Corrigez-les dans le fichier puis vérifiez à nouveau, ou importez seulement les lignes valides.</p> }
        }
      }
      <div footer>
        @if (importDone()) { <button class="btn" (click)="downloadCreds()"><app-icon name="download" [size]="16" /> Télécharger les identifiants</button><button class="btn primary" (click)="importing.set(false)">Terminer</button> }
        @else if (s.apiMode()) { <button class="btn ghost" (click)="importing.set(false)">Annuler</button><button class="btn primary" [disabled]="!report()?.valid || busy()" (click)="runFileImport()">{{ busy() ? 'Import…' : 'Importer ' + (report()?.valid ?? 0) + ' élève(s)' }}</button> }
        @else { <button class="btn ghost" (click)="importing.set(false)">Annuler</button><button class="btn primary" [disabled]="!checked() || !okRows().length" (click)="runImport()">Importer {{ okRows().length }} élève(s)</button> }
      </div>
    </app-modal>
  }`,
})
export class ElevesPage {
  readonly s = inject(Store);
  get levels(): string[] { return this.s.levelNames(); }
  readonly fcfa = fcfa; readonly phoneOk = phoneOk; readonly example = EXAMPLE;
  q = signal(''); cls = signal(''); shown = signal(50); all = signal(false);
  /** Texte d'un élève pour la recherche de la liste complète. */
  studentText = (st: Student) => `${st.nom} ${st.prenoms} ${st.matricule} ${this.s.className(st.classId)} ${this.s.parentById().get(st.parentId)?.name ?? ''} ${this.s.parentById().get(st.parentId)?.phone ?? ''}`;
  adding = signal(false); created = signal<Credential[] | null>(null); touched = signal(false);
  importing = signal(false); csv = signal(''); checked = signal(false); importDone = signal<Credential[] | null>(null);
  f: NewStudentForm = this.blank();

  list = computed(() => {
    const t = this.q().trim().toLowerCase();
    return this.s.students().filter((x) => (!this.cls() || x.classId === this.cls()) && (!t || `${x.nom} ${x.prenoms} ${x.matricule}`.toLowerCase().includes(t)))
      .sort((a, b) => a.nom.localeCompare(b.nom) || a.prenoms.localeCompare(b.prenoms));
  });
  page = computed(() => this.list().slice(0, this.shown()));

  private blank(): NewStudentForm {
    return { nom: '', prenoms: '', sexe: 'F', naissance: '', lieu: '', classId: this.s?.classes()[0]?.id ?? '', parentName: '', parentPhone: '', parentTitle: 'M.' };
  }
  printSheet(): void {
    const c = this.created(); if (!c) return;
    void this.s.download(`fiche-acces-${this.f.nom.trim().toLowerCase().replace(/\s+/g, '-') || 'eleve'}.html`, accessSheetHtml(this.s, `${this.f.prenoms} ${this.f.nom}`.trim(), c, globalThis.location?.origin ?? ''));
  }
  openAdd(): void { this.f = this.blank(); this.created.set(null); this.touched.set(false); this.adding.set(true); }
  readonly busy = signal(false);
  async save(): Promise<void> {
    if (this.busy()) return;
    this.touched.set(true);
    const f = this.f;
    if (!f.nom.trim() || !f.prenoms.trim() || !f.naissance || !f.parentName.trim() || !phoneOk(f.parentPhone)) return;
    const cl = this.s.classById().get(f.classId);
    if (cl && (this.s.studentsByClass().get(cl.id)?.length ?? 0) >= cl.max) { this.s.toast(`La classe ${cl.name} est complète.`, 'err'); return; }
    this.busy.set(true);
    try {
      this.created.set((await this.s.addStudentAsync({ ...f, parentPhone: fmtPhone(f.parentPhone) })).creds);
      this.s.toast('Élève inscrit.');
    } catch (e) {
      this.s.toast(e instanceof Error ? e.message : 'Inscription impossible.', 'err');
    } finally { this.busy.set(false); }
  }
  exportCsv(): void {
    const csv = toCsv(['Matricule', 'Nom', 'Prénoms', 'Sexe', 'Naissance', 'Classe', 'Parent', 'Téléphone'],
      this.list().map((x) => [x.matricule, x.nom, x.prenoms, x.sexe, dateFr(x.naissance), this.s.className(x.classId), this.s.parentById().get(x.parentId)?.name, this.s.parentById().get(x.parentId)?.phone]));
    void this.s.download('eleves.csv', csv);
  }

  report = signal<ImportReport | null>(null); fileErr = signal(''); private pickedFile: File | null = null;
  async pickFile(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.report.set(null); this.fileErr.set(''); this.pickedFile = f;
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return void this.fileErr.set('Choisissez un fichier .xlsx (Excel) ou .csv.');
    if (f.size > 2_000_000) return void this.fileErr.set('Fichier trop volumineux (2 Mo au maximum).');
    const r = await this.s.importStudentsFile(f, false);
    if (r.ok) this.report.set(r.res ?? null); else this.fileErr.set(r.error ?? 'Fichier illisible.');
  }
  async runFileImport(): Promise<void> {
    if (this.busy() || !this.pickedFile) return;
    this.busy.set(true);
    const r = await this.s.importStudentsFile(this.pickedFile, true);
    this.busy.set(false);
    if (!r.ok) return void this.fileErr.set(r.error ?? 'Import impossible.');
    this.importDone.set(r.creds ?? []);
    const bad = r.res?.errors.length ?? 0;
    this.s.toast(`${r.res?.created.length ?? 0} élève(s) importé(s)${bad ? `, ${bad} ligne(s) ignorée(s)` : ''}.`, bad ? 'err' : 'ok');
  }
  openImport(): void { this.report.set(null); this.fileErr.set(''); this.pickedFile = null; this.csv.set(''); this.checked.set(false); this.importDone.set(null); this.importing.set(true); }
  rows = computed<ImportRow[]>(() => {
    const lines = this.csv().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const body = /^nom\b/i.test(lines[0] ?? '') ? lines.slice(1) : lines;
    const seen = new Set<string>();
    return body.map((ln, i) => {
      const raw = ln.split(';').map((x) => x.trim());
      const errors: string[] = [];
      const [nom, prenoms, sexe, naiss, lieu, classe, parent, tel] = raw;
      if (!nom || !prenoms) errors.push('nom ou prénoms manquant');
      const cl = this.s.classes().find((c) => c.name.toLowerCase() === (classe ?? '').toLowerCase());
      if (!cl) errors.push('classe inconnue');
      let iso = '';
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(naiss ?? '');
      if (m) iso = `${m[3]}-${m[2]}-${m[1]}`; else if (/^\d{4}-\d{2}-\d{2}$/.test(naiss ?? '')) iso = naiss;
      if (!iso) errors.push('date invalide');
      if (!phoneOk(tel ?? '')) errors.push('téléphone invalide');
      if (!parent) errors.push('parent manquant');
      const key = `${nom}|${prenoms}|${iso}`.toLowerCase();
      if (seen.has(key) || this.s.students().some((x) => `${x.nom}|${x.prenoms}|${x.naissance}`.toLowerCase() === key)) errors.push('doublon');
      seen.add(key);
      const res: ImportRow = { line: i + 1, raw, errors };
      if (!errors.length) {
        const title = /^mme\b/i.test(parent) ? 'Mme' : 'M.';
        res.form = { nom, prenoms, sexe: /^f/i.test(sexe) ? 'F' : 'M', naissance: iso, lieu: lieu ?? '', classId: cl!.id, parentName: parent.replace(/^(m\.|mme)\s+/i, ''), parentPhone: fmtPhone(tel), parentTitle: title };
      }
      return res;
    });
  });
  okRows = computed(() => this.rows().filter((r) => !r.errors.length));
  badRows = computed(() => this.rows().filter((r) => r.errors.length));
  async runImport(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const all: Credential[] = [];
    let ok = 0, ko = 0;
    for (const r of this.okRows()) {
      try { all.push(...(await this.s.addStudentAsync(r.form!)).creds); ok++; } catch { ko++; }
    }
    this.busy.set(false);
    this.importDone.set(all);
    this.s.toast(ko ? `${ok} élève(s) importé(s), ${ko} refusé(s) par le serveur.` : `${ok} élève(s) importé(s).`, ko ? 'err' : 'ok');
  }
  downloadCreds(): void {
    void this.s.download('identifiants-provisoires.csv', toCsv(['Compte', 'Identifiant', 'Mot de passe provisoire'], (this.importDone() ?? []).map((c) => [c.label, c.username, c.password])));
  }
}

@Component({
  selector: 'app-fiche',
  imports: [FormsModule, Avatar, Modal, Chart],
  template: `
  @if (st(); as e) {
  <div class="page">
    <div><button class="link small" (click)="s.go(['enseignant', 'comptable'].includes(s.role() ?? '') ? 'dashboard' : 'eleves')">← Retour</button></div>
    <div class="page-head">
      <div class="row"><app-avatar [name]="e.prenoms + ' ' + e.nom" [size]="56" />
        <div><h1>{{ e.nom }} {{ e.prenoms }}</h1><p>{{ s.className(e.classId) }} · matricule {{ e.matricule }}</p></div></div>
      <div class="row">
        @if (waParent(e); as u) { <a class="btn" [href]="u" target="_blank" rel="noopener" data-i18n-skip>WhatsApp parent</a> }
        @if (s.can('students.write')) { <button class="btn" (click)="openEdit()">Modifier le dossier</button> }
        @if (s.can('bulletins.gen')) { <button class="btn primary" (click)="s.go('bulletins', e.id)">Voir le bulletin</button> }
      </div>
    </div>
    <div class="tabs">
      @for (t of tabs(); track t.id) { <button class="tab" [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button> }
    </div>
    @switch (tab()) {
      @case ('infos') {
        <div class="grid two">
          <div class="card pad stack"><h3>Identité</h3>
            <div class="small"><span class="muted">Sexe :</span> {{ e.sexe === 'F' ? 'Fille' : 'Garçon' }}</div>
            <div class="small"><span class="muted">Né(e) le :</span> {{ dateFr(e.naissance) }} à {{ e.lieu || '—' }}</div>
            <div class="small"><span class="muted">Classe :</span> {{ s.className(e.classId) }}</div>
            <div class="small"><span class="muted">Compte élève :</span> {{ s.userById().get(e.userId)?.username }} @if (!s.userById().get(e.userId)?.active) { <span class="pill bad">désactivé</span> }</div></div>
          @if (s.apiMode() && s.cursusList().length > 1) {
            <div class="card pad stack"><h3>Cursus</h3>
              <div class="small"><span class="muted">{{ e.cursusNom }} :</span> {{ s.className(e.classId) }}</div>
              @for (i of others(); track i.id) { <div class="small"><span class="muted">{{ i.cursusNom }} :</span> {{ i.classLabel }} @if (!i.active) { <span class="pill">inactif</span> }</div> }
              @if (s.can('students.write') && freeCursus().length) {
                @if (!enroll()) { <div><button class="btn sm" (click)="openEnroll()">Inscrire dans un autre cursus</button></div> }
                @else {
                  <div class="form-grid">
                    <label class="field"><span>Cursus</span><select [ngModel]="enroll()!.cursus" (ngModelChange)="pickEnrollCursus($event)">@for (c of freeCursus(); track c.id) { <option [value]="c.id">{{ c.nom }}</option> }</select></label>
                    <label class="field"><span>Classe</span><select [ngModel]="enroll()!.classId" (ngModelChange)="patchEnroll({ classId: $event })">
                      <option value="">À répartir plus tard</option>
                      @for (k of enroll()!.classes; track k.id) { <option [value]="k.id" [disabled]="k.free <= 0">{{ k.name }}{{ k.free <= 0 ? ' (complète)' : '' }}</option> }</select></label>
                    @if (!enroll()!.classId) { <label class="field"><span>Niveau</span><select [ngModel]="enroll()!.level" (ngModelChange)="patchEnroll({ level: $event })">@for (l of enroll()!.levels; track l) { <option [value]="l">{{ l }}</option> }</select></label> }
                  </div>
                  @if (enroll()!.error) { <div class="banner bad">{{ enroll()!.error }}</div> }
                  <div class="row"><button class="btn primary sm" (click)="saveEnroll()">Inscrire</button><button class="btn sm" (click)="enroll.set(null)">Annuler</button></div>
                  <span class="tiny muted">Même élève : même compte, même matricule, même parent. Ses notes et bulletins sont propres à chaque cursus.</span>
                }
              }
            </div>
          }
          <div class="card pad stack"><h3>Parent ou tuteur</h3>
            <div class="small"><b>{{ s.parentById().get(e.parentId)?.name }}</b></div>
            <div class="small"><span class="muted">Téléphone :</span> {{ s.parentById().get(e.parentId)?.phone }}</div>
            <div class="small"><span class="muted">Contact d’urgence :</span> {{ e.urgence }}</div>
            <div class="small"><span class="muted">Enfants rattachés :</span> {{ siblings() }}</div></div>
          @if (s.can('accounts')) {
            <div class="card pad stack"><h3>Accès à l’application</h3>
              <p class="small muted" style="margin:0">Le parent se connecte avec son numéro de téléphone, l’élève avec son matricule. Un code oublié se remplace par un nouveau code provisoire.</p>
              <div class="row"><span class="small grow"><span class="muted">Élève :</span> {{ s.userById().get(e.userId)?.username }}</span><button class="btn sm" (click)="askReset('eleve', e.id)">Réinitialiser</button></div>
              @if (s.parentById().get(e.parentId); as pa) {
                <div class="row"><span class="small grow"><span class="muted">Parent :</span> {{ s.userById().get(pa.userId)?.username }}</span><button class="btn sm" (click)="askReset('parent', e.id)">Réinitialiser</button></div>
              }
            </div>
          }
        </div>
      }
      @case ('resultats') {
        <div class="card">
          <div class="card-head"><h2>Résultats du {{ s.term().label.toLowerCase() }}</h2>
            @if (res()) { <div class="row"><span class="pill brand">Moyenne {{ fnum(res()!.moyenne) }}</span><span class="pill">{{ rangLabel(res()!.rang, effectif()) }}</span><span class="pill ok">{{ mention(res()!.moyenne, s.school().seuils) }}</span></div> }</div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th class="num">Coef.</th><th class="num">Classes</th><th class="num">Compo.</th><th class="num">Moyenne</th><th class="num">Rang</th><th class="num">Moy. classe</th></tr></thead><tbody>
            @for (r of res()?.subjects ?? []; track r.subjectId) {
              <tr><td class="cell-main">{{ s.subjectById().get(r.subjectId)?.name }}</td><td class="num">{{ r.coef }}</td><td class="num">{{ fnum(r.mc) }}</td><td class="num">{{ fnum(r.compo) }}</td><td class="num"><b>{{ fnum(r.moy) }}</b></td><td class="num">{{ rangLabel(r.rang) }}</td><td class="num muted">{{ fnum(r.classMoy) }}</td></tr>
            }
          </tbody></table></div>
        </div>
        @if (subjChart().labels.length) {
          <div class="card pad stack"><div><h3>Moyenne par matière</h3><p class="small muted">Comparée à la moyenne de la classe. Trait pointillé : 10/20.</p></div>
            <div style="max-width:720px;width:100%"><app-chart type="bar" [labels]="subjChart().labels" [series]="subjChart().series" [yMax]="20" [refLine]="10" [fmt]="note1" label="Moyenne par matière" /></div></div>
        }
      }
      @case ('absences') {
        <div class="card"><div class="card-head"><h2>Absences et retards</h2><span class="pill">Assiduité {{ fnum(s.attendanceRate(e.id), 0) }} %</span></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Séance</th><th>Type</th><th>Justification</th></tr></thead><tbody>
            @for (a of abs(); track a.id) {
              <tr><td>{{ dateFr(a.date) }}</td><td>{{ a.slot }}</td><td>{{ a.status === 'A' ? 'Absence' : 'Retard' }}</td>
                <td>@switch (a.justif) { @case ('acceptee') { <span class="pill ok">Justifiée</span> } @case ('en_attente') { <span class="pill warn">En attente</span> } @case ('refusee') { <span class="pill bad">Refusée</span> } @default { <span class="muted">—</span> } }</td></tr>
            } @empty { <tr><td colspan="4" class="empty">Aucune absence enregistrée.</td></tr> }
          </tbody></table></div></div>
      }
      @case ('discipline') {
        <div class="card"><div class="card-head"><h2>Discipline</h2></div>
          <div class="table-wrap"><table class="table"><tbody>
            @for (i of s.incidentsOf(e.id); track i.id) {
              <tr><td class="nowrap">{{ dateFr(i.date) }}</td><td>{{ incLabel[i.type] }}<div class="small muted">{{ i.description }}</div></td><td>{{ sancLabel[i.sanction] }}</td>
                <td>@if (i.status === 'valide') { <span class="pill ok">Validée</span> } @else if (i.status === 'a_valider') { <span class="pill warn">À valider</span> } @else { <span class="pill">Refusée</span> }</td></tr>
            } @empty { <tr><td class="empty">Aucun incident enregistré.</td></tr> }
          </tbody></table></div></div>
      }
      @case ('scolarite') {
        <div class="grid kpi">
          <div class="card kpi-card"><span class="label">Total annuel</span><span class="value">{{ fcfa(bal().total) }}</span></div>
          <div class="card kpi-card"><span class="label">Payé</span><span class="value">{{ fcfa(bal().paid) }}</span></div>
          <div class="card kpi-card" [class.alert]="bal().overdue > 0"><span class="label">Échu non payé</span><span class="value">{{ fcfa(bal().overdue) }}</span></div>
        </div>
        @if (s.cursusDetail(e.id).length) {
          <div class="card pad stack"><h3>Forfait de tous les cursus</h3>
            @for (d of s.cursusDetail(e.id); track $index) { <div class="row small"><span class="grow">{{ d.label }} · {{ d.cursus }} ({{ d.level }})</span><b>{{ fcfa(d.amount) }}</b></div> }
            <span class="tiny muted">Un seul compte pour l’élève : les paiements couvrent tous ses cursus.</span></div>
        }
        <div class="grid two">
          <div class="card"><div class="card-head"><h2>Échéancier</h2></div><div class="table-wrap"><table class="table"><tbody>
            @for (l of s.feeLines(e.id); track l.key) {
              <tr><td class="cell-main">{{ l.label }}<div class="tiny muted">échéance {{ dateFr(l.due) }}</div></td><td class="num">{{ fcfa(l.amount) }}</td>
                <td>@if (l.remaining === 0) { <span class="pill ok">Payée</span> } @else if (l.overdue) { <span class="pill bad">En retard : {{ fcfa(l.remaining) }}</span> } @else { <span class="pill">À venir</span> }</td></tr>
            }</tbody></table></div></div>
          <div class="card"><div class="card-head"><h2>Paiements</h2></div><div class="table-wrap"><table class="table"><tbody>
            @for (p of pays(); track p.id) {
              <tr><td>{{ dateFr(p.date) }}<div class="tiny muted">{{ p.receiptNo }}</div></td><td>{{ modeLabel[p.mode] }}</td><td class="num" [style.text-decoration]="p.status === 'annule' ? 'line-through' : ''">{{ fcfa(p.amount) }}</td></tr>
            } @empty { <tr><td class="empty">Aucun paiement.</td></tr> }</tbody></table></div></div>
        </div>
      }
    }
  </div>
  @if (reset(); as r) {
      <app-modal [title]="r.pw ? 'Nouveau code provisoire' : 'Réinitialiser l’accès'" (closed)="reset.set(null)">
        @if (r.pw) {
          <div class="banner ok">Remettez ce code à la personne concernée : il est affiché une seule fois et devra être changé à la première connexion.</div>
          <div class="card flat pad" style="margin-top:12px"><b>{{ r.label }}</b><div class="small">Identifiant : <code>{{ r.username }}</code> · Code provisoire : <code>{{ r.pw }}</code></div></div>
        } @else {
          <p>Créer un nouveau code pour <b>{{ r.label }}</b> ? L’ancien mot de passe ne fonctionnera plus@if (r.kind === 'parent') { ; le compte du parent sert pour tous ses enfants }.</p>
        }
        @if (r.pw) { <div footer><button class="btn ghost" (click)="reset.set(null)">Fermer</button><button class="btn primary" (click)="printReset()">Fiche d’accès à imprimer</button></div> }
        @else { <div footer><button class="btn ghost" (click)="reset.set(null)">Annuler</button><button class="btn primary" (click)="doReset()">Créer un nouveau code</button></div> }
      </app-modal>
    }
  @if (editing()) {
    <app-modal title="Modifier le dossier" (closed)="editing.set(false)">
      <div class="form-grid">
        <label class="field"><span>Nom</span><input [(ngModel)]="ed.nom" name="a" /></label>
        <label class="field"><span>Prénoms</span><input [(ngModel)]="ed.prenoms" name="b" /></label>
        <label class="field"><span>Date de naissance</span><input type="date" [(ngModel)]="ed.naissance" name="c" /></label>
        <label class="field"><span>Lieu</span><input [(ngModel)]="ed.lieu" name="d" /></label>
        <label class="field"><span>Classe</span><select [(ngModel)]="ed.classId" name="e">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
        <label class="field"><span>Contact d’urgence</span><input [(ngModel)]="ed.urgence" name="f" /></label>
      </div>
      <label class="row small" style="margin-top:12px;gap:8px"><input type="checkbox" [(ngModel)]="ed.redouble" name="g" />
        A déjà redoublé la {{ levelOf(ed.classId) }} <span class="muted">(un nouveau redoublement de ce niveau sera proposé comme exclusion)</span></label>
      <div footer><button class="btn ghost" (click)="editing.set(false)">Annuler</button><button class="btn primary" (click)="saveEdit()">Enregistrer</button></div>
    </app-modal>
  }
  } @else { <div class="page"><div class="empty">Élève introuvable.</div></div> }`,
})
export class FichePage {
  readonly s = inject(Store);
  waParent(e: { nom: string; prenoms: string; parentId?: any }): string | null {
    if (!this.s.can('students.write')) return null;
    const p: any = this.s.parentById().get(e.parentId);
    return p ? waLink(p.phone, `Bonjour ${p.name}, ici l'école au sujet de ${e.prenoms} ${e.nom}.`) : null;
  }
  readonly dateFr = dateFr; readonly fcfa = fcfa; readonly fnum = fnum; readonly rangLabel = rangLabel; readonly mention = mention; readonly modeLabel = MODE_LABEL; readonly incLabel = INCIDENT_LABEL; readonly sancLabel = SANCTION_LABEL;
  tab = signal('infos'); editing = signal(false);
  reset = signal<{ kind: 'eleve' | 'parent'; userId: string; label: string; username: string; pw: string } | null>(null);
  askReset(kind: 'eleve' | 'parent', studentId: string): void {
    const e = this.s.studentById().get(studentId); if (!e) return;
    const userId = kind === 'eleve' ? e.userId : this.s.parentById().get(e.parentId)?.userId ?? '';
    const u = this.s.userById().get(userId); if (!u) return;
    this.reset.set({ kind, userId, label: kind === 'eleve' ? `Élève : ${e.prenoms} ${e.nom}` : `Parent : ${u.name}`, username: u.username, pw: '' });
  }
  async doReset(): Promise<void> {
    const r = this.reset(); if (!r) return;
    const pw = await this.s.resetPasswordAsync(r.userId);
    if (pw) this.reset.set({ ...r, pw });
  }
  printReset(): void {
    const r = this.reset(), e = this.st(); if (!r?.pw || !e) return;
    void this.s.download(`fiche-acces-${e.matricule.toLowerCase()}.html`, accessSheetHtml(this.s, `${e.prenoms} ${e.nom}`, [{ label: r.label, username: r.username, password: r.pw }], globalThis.location?.origin ?? ''));
  }
  ed = { nom: '', prenoms: '', naissance: '', lieu: '', classId: '', urgence: '', redouble: false };
  st = computed(() => this.s.studentById().get(this.s.param() ?? ''));
  // École à plusieurs cursus : inscriptions de l'élève dans les autres cursus, et inscription dans un nouveau cursus
  others = signal<{ id: string; cursus: string; cursusNom: string; classLabel: string; active: boolean }[]>([]);
  private loadOthers = effect(() => {
    const e = this.st(); this.others.set([]); this.enroll.set(null);
    if (e && this.s.apiMode() && this.s.cursusList().length > 1) void this.s.studentInscriptions(e.id).then((l) => { if (this.st()?.id === e.id) this.others.set(l); });
  });
  freeCursus = computed(() => { const taken = new Set([this.st()?.cursusId, ...this.others().map((i) => i.cursus)]); return this.s.cursusList().filter((c) => !taken.has(c.id)); });
  enroll = signal<{ cursus: string; classId: string; level: string; classes: { id: number; name: string; free: number }[]; levels: string[]; error: string } | null>(null);
  patchEnroll(p: Partial<{ classId: string; level: string }>): void { const v = this.enroll(); if (v) this.enroll.set({ ...v, ...p, error: '' }); }
  async pickEnrollCursus(id: string): Promise<void> {
    const r = await this.s.cursusClasses(id);
    this.enroll.set({ cursus: id, classId: r.classes.find((k) => k.free > 0)?.id.toString() ?? '', level: r.levels[0] ?? '', classes: r.classes, levels: r.levels, error: '' });
  }
  openEnroll(): void { const c = this.freeCursus()[0]; if (c) void this.pickEnrollCursus(c.id); }
  async saveEnroll(): Promise<void> {
    const v = this.enroll(), e = this.st(); if (!v || !e) return;
    const r = await this.s.enrollInCursus(e.id, v.cursus, v.classId || null, v.level);
    if (!r.ok) return void this.enroll.set({ ...v, error: r.error ?? 'Inscription impossible.' });
    this.enroll.set(null);
    this.others.set(await this.s.studentInscriptions(e.id));
  }
  tabs = computed(() => {
    const r = this.s.role();
    const t = [{ id: 'infos', label: 'Informations' }];
    if (r === 'admin' || r === 'directeur' || r === 'fondateur' || r === 'enseignant') t.push({ id: 'resultats', label: 'Résultats' });
    if (r !== 'comptable') t.push({ id: 'absences', label: 'Absences' });
    if (this.s.can('discipline')) t.push({ id: 'discipline', label: 'Discipline' });
    if (r === 'admin' || this.s.can('pay.read')) t.push({ id: 'scolarite', label: 'Scolarité' });
    return t;
  });
  res = computed(() => { const e = this.st(); return e ? this.s.resultOf(e.id, false) : undefined; });
  readonly note1 = (n: number) => fnum(n, 1);
  subjChart = computed(() => {
    const rows = (this.res()?.subjects ?? []).filter((x) => x.moy !== null);
    const nm = (id: string) => this.s.subjectById().get(id)?.short ?? '';
    return { labels: rows.map((x) => nm(x.subjectId)), series: [{ name: 'Élève', values: rows.map((x) => x.moy) }, { name: 'Classe', values: rows.map((x) => x.classMoy) }] as Serie[] };
  });
  effectif = computed(() => this.s.studentsByClass().get(this.st()?.classId ?? '')?.length ?? 0);
  abs = computed(() => this.s.absences().filter((a) => a.studentId === this.st()?.id).sort((a, b) => b.date.localeCompare(a.date)));
  bal = computed(() => this.s.balance(this.st()?.id ?? ''));
  pays = computed(() => (this.s.paymentsByStudent().get(this.st()?.id ?? '') ?? []).slice().sort((a, b) => b.date.localeCompare(a.date)));
  siblings = computed(() => (this.s.students().filter((x) => x.parentId === this.st()?.parentId).map((x) => x.prenoms).join(', ')));
  openEdit(): void {
    const e = this.st()!;
    this.ed = { nom: e.nom, prenoms: e.prenoms, naissance: e.naissance, lieu: e.lieu, classId: e.classId, urgence: e.urgence,
      redouble: (e.niveauxRedoubles ?? []).includes(this.levelOf(e.classId)) };
    this.editing.set(true);
  }
  levelOf = (classId: string) => this.s.classById().get(classId)?.level ?? '';
  async saveEdit(): Promise<void> {
    if (!this.ed.nom.trim() || !this.ed.prenoms.trim()) return void this.s.toast('Le nom et les prénoms sont obligatoires.', 'err');
    const { redouble, ...ed } = this.ed;
    const lv = this.levelOf(ed.classId), before = this.st()!.niveauxRedoubles ?? [];
    const niveauxRedoubles = redouble ? [...new Set([...before, lv])] : before.filter((x) => x !== lv);
    const r = await this.s.updateStudentAsync(this.st()!.id, { ...ed, nom: ed.nom.trim().toUpperCase(), prenoms: ed.prenoms.trim(), niveauxRedoubles });
    if (!r.ok) return void this.s.toast(r.error ?? 'Modification impossible.', 'err');
    this.editing.set(false);
    this.s.toast('Dossier mis à jour.');
  }
}
