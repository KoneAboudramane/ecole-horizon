import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store, Credential } from '../store';
import { Avatar, Icon, ListModal, Modal, SchoolLogo, FitHeight } from '../ui';
import { FileImport } from '../file-import';
import { dateFr, dateLong, fnum, toCsv } from '../format';
import { Horaires, Timetable, DAYS } from '../modules/timetable';
import { SallesCard } from './salles';
import { ConduiteReglages } from './conduite';
import { SeriesCard } from './series';
import { Groupe, LogEntry, ROLE_LABEL, Role, TemplateId, User } from '../models';
import { Roles } from '../modules/roles';
import { termCoef } from '../engine';

// ---------- Classes ----------
@Component({
  selector: 'app-classes',
  imports: [FitHeight, FormsModule, Modal, Icon, FileImport],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Classes</h1><p>{{ s.classes().length }} classes, {{ s.students().length }} élèves.</p></div>
      @if (s.can('classes.write')) { <div class="row">@if (s.apiMode()) { <button class="btn" (click)="importing.set(true)"><app-icon name="upload" [size]="16" /> Importer</button> }<button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Nouvelle classe</button></div> }</div>
    <div class="card" appFitHeight><div class="table-wrap"><table class="table hover">
      <thead><tr><th>Classe</th><th>Cycle</th><th class="num">Effectif</th><th>Remplissage</th><th class="num">Moyenne</th><th class="num">Assiduité</th><th>Prof. principal</th></tr></thead>
      <tbody>
        @for (c of s.classes(); track c.id) {
          <tr style="cursor:pointer" (click)="detail.set(c.id)">
            <td class="cell-main">{{ c.name }}</td><td>{{ c.cycle === 'college' ? 'Collège' : 'Lycée' }}</td>
            <td class="num">{{ n(c.id) }} / {{ c.max }}</td>
            <td style="min-width:120px"><div class="meter" [class.bad]="n(c.id) >= c.max"><span [style.width.%]="n(c.id) / c.max * 100"></span></div></td>
            <td class="num">{{ fnum(s.classStats(c.id, true)?.avg ?? null) }}</td>
            <td class="num">{{ fnum(s.classAttendance(c.id), 1) }} %</td>
            <td [class.muted]="!c.principalId">{{ c.principalId ? (s.teacherById().get(c.principalId)?.name ?? '—') : 'À désigner' }}</td>
          </tr>
        }
      </tbody></table></div></div>
  </div>

  @if (importing()) { <app-file-import kind="classes" title="Importer des classes" noun="classe(s)" intro="Une ligne par classe : nom, niveau, série (lycée) et effectif maximum." (closed)="importing.set(false)" /> }
  @if (adding()) {
    <app-modal title="Nouvelle classe" (closed)="adding.set(false)">
      <div class="form-grid">
        <label class="field"><span>Niveau</span><select [(ngModel)]="nc.level" (ngModelChange)="fixSerie()" name="lv">@for (lv of s.levelNames(); track lv) { <option [value]="lv">{{ lv }}</option> }</select></label>
        @if (isLycee()) { <label class="field"><span>Série</span><select [(ngModel)]="nc.serie" name="se">@for (sr of s.seriesOf(nc.level); track sr.id) { <option [value]="sr.code">{{ sr.code }}{{ sr.name ? ' · ' + sr.name : '' }}</option> }</select>
          @if (!s.seriesOf(nc.level).length) { <span class="err">Aucune série en {{ nc.level }} : ajoutez-en dans Paramètres.</span> }</label> }
        <label class="field"><span>Nom de la classe</span><input [(ngModel)]="nc.name" name="nm" [placeholder]="nc.level + ' C'" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
        <label class="field"><span>Effectif maximum</span><input type="number" min="10" max="80" [(ngModel)]="nc.max" name="mx" /></label>
      </div>
      <p class="tiny muted" style="margin-top:10px">Les coefficients appliqués suivent le groupe « {{ groupLabel() }} ».</p>
      <div footer><button class="btn ghost" (click)="adding.set(false)">Annuler</button><button class="btn primary" (click)="create()">Créer</button></div>
    </app-modal>
  }
  @if (detail(); as id) {
    <app-modal [title]="s.className(id)" size="wide" (closed)="detail.set(null)">
      <div class="field" style="margin-bottom:14px"><span>Professeur principal</span>
        @if (canPrincipal()) {
          <select [ngModel]="s.classById().get(id)?.principalId ?? ''" (ngModelChange)="setPrincipal(id, $event)" aria-label="Professeur principal">
            <option value="">— Aucun —</option>
            @for (t of principalChoices(id); track t.id) { <option [value]="t.id">{{ t.name }}{{ t.here ? '' : ' (n’enseigne pas dans cette classe)' }}</option> }
          </select>
          <span class="tiny muted">Il voit toutes les notes de la classe (sans pouvoir les modifier), rédige l’avis du conseil et suit l’assiduité et la discipline. Il est prévenu.</span>
        } @else { <b>{{ s.classById().get(id)?.principalId ? (s.teacherById().get(s.classById().get(id)!.principalId!)?.name ?? '—') : 'Non désigné' }}</b> }
      </div>
      <div class="grid two">
        <div><h3 style="margin-bottom:8px">Enseignants</h3><table class="table"><tbody>
          @for (sb of s.subjectsOfClass(id); track sb.id) { <tr><td>{{ sb.name }}</td><td class="muted">{{ s.teacherOf(id, sb.id)?.name ?? 'Non affecté' }}</td></tr> }
        </tbody></table></div>
        <div><h3 style="margin-bottom:8px">Élèves ({{ n(id) }})</h3><div style="max-height:320px;overflow:auto"><table class="table"><tbody>
          @for (e of s.studentsByClass().get(id) ?? []; track e.id) { <tr style="cursor:pointer" (click)="detail.set(null); s.go('eleve', e.id)"><td>{{ e.nom }} {{ e.prenoms }}</td><td class="tiny muted">{{ e.matricule }}</td></tr> }
        </tbody></table></div></div>
      </div>
    </app-modal>
  }`,
})
export class ClassesPage {
  importing = signal(false);
  readonly s = inject(Store); readonly fnum = fnum;
  adding = signal(false); detail = signal<string | null>(null); err = signal('');
  /** Direction et secrétariat désignent le professeur principal (mêmes droits que la répartition des enseignants). */
  canPrincipal = () => this.s.can('classes.write') || this.s.can('subjects.write');
  /** Enseignants de la classe d'abord, puis les autres. */
  principalChoices(classId: string) {
    const here = new Set(this.s.assignments().filter((a) => a.classId === classId).map((a) => a.teacherId));
    return this.s.teachers().map((t) => ({ id: t.id, name: t.name, here: here.has(t.id) }))
      .sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name));
  }
  async setPrincipal(classId: string, teacherId: string): Promise<void> {
    const r = await this.s.setPrincipalAsync(classId, teacherId || null);
    if (!r.ok) return void this.s.toast(r.error ?? 'Enregistrement impossible.', 'err');
    const t = teacherId ? this.s.teacherById().get(teacherId)?.name : null;
    this.s.toast(t ? `${t} est professeur principal de la ${this.s.className(classId)}.` : `La ${this.s.className(classId)} n’a plus de professeur principal.`);
  }
  nc = { level: this.s.levelNames()[0] ?? '', serie: 'A', name: '', max: 45 };
  constructor() { const p = this.s.param(); if (p) this.detail.set(p); }
  n = (id: string) => this.s.studentsByClass().get(id)?.length ?? 0;
  isLycee = () => this.s.hasSeries(this.nc.level);
  groupLabel = () => this.s.groupeFor(this.nc.level, this.nc.serie);
  /** Au changement de niveau, la première série de ce niveau. */
  fixSerie(): void { const l = this.s.seriesOf(this.nc.level); if (l.length && !l.some((x) => x.code === this.nc.serie)) this.nc.serie = l[0].code; }
  openAdd(): void { this.nc = { level: this.s.levelNames()[0] ?? '', serie: 'A', name: '', max: 45 }; this.fixSerie(); this.err.set(''); this.adding.set(true); }
  async create(): Promise<void> {
    if (!this.nc.name.trim()) return void this.err.set('Donnez un nom à la classe.');
    const r = await this.s.addClassAsync({ name: this.nc.name, level: this.nc.level, serie: this.isLycee() ? this.nc.serie : undefined, max: this.nc.max });
    if (!r.cl) return void this.err.set(r.error ?? 'Création impossible.');
    this.adding.set(false); this.s.toast(`Classe ${r.cl.name} créée.`);
  }
}

// ---------- Matières, coefficients, affectations ----------
@Component({
  selector: 'app-matieres',
  imports: [FitHeight, FormsModule, Modal, Icon, FileImport],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Matières et coefficients</h1><p>Chaque école saisit ses propres matières. Les coefficients s’appliquent par niveau ou par série et pondèrent la moyenne générale.</p></div>
      @if (s.can('subjects.write')) { <div class="row">@if (s.apiMode()) { <button class="btn" (click)="importing.set(true)"><app-icon name="upload" [size]="16" /> Importer</button> }<button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Ajouter une matière</button></div> }</div>
    @if (importing()) { <app-file-import kind="subjects" title="Importer des matières" noun="matière(s)" intro="Une ligne par matière : son nom et, si vous voulez, son abréviation." (closed)="importing.set(false)" /> }
    @if (!s.subjects().length) {
      <div class="card empty stack" style="align-items:center;padding:32px 20px">
        <b>Bienvenue : commencez par saisir les matières de votre école.</b>
        <span class="small muted">Aucune matière n’est prédéfinie. Ajoutez-les une à une, ou importez-les toutes d’un coup depuis un fichier Excel. Vous fixerez ensuite leurs coefficients et les enseignants.</span>
        @if (s.can('subjects.write')) { <button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Ajouter ma première matière</button> }
      </div>
    } @else {
    <div class="banner info">Vérifiez les coefficients avec le programme officiel de votre établissement.</div>
    <div class="tabs"><button class="tab" [class.on]="tab() === 'coef'" (click)="tab.set('coef')">Coefficients</button><button class="tab" [class.on]="tab() === 'aff'" (click)="tab.set('aff')">Affectations des enseignants</button></div>
    @if (tab() === 'coef') {
      <div class="chips">@for (g of s.groupes(); track g) { <button class="chip" [class.on]="g === groupe()" (click)="groupe.set(g)">{{ g }}</button> }</div>
      <p class="small muted">Chaque niveau du collège et chaque série du lycée a ses coefficients (les séries se gèrent dans Paramètres). Un coefficient à 0 retire la matière des bulletins de ce groupe. Une matière qui a déjà des notes ou des cours ne peut plus être supprimée.</p>
      <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th class="num">Coefficient</th><th>Statut</th>@if (s.can('subjects.write')) { <th></th> }</tr></thead><tbody>
        @for (sb of s.subjects(); track sb.id) {
          <tr><td class="cell-main">{{ sb.name }} <span class="tiny muted">({{ sb.short }})</span></td>
            <td class="num"><input class="inline-input" type="number" min="0" max="10" [ngModel]="coef(sb.id)" [disabled]="!s.can('subjects.write')" (ngModelChange)="set(sb.id, $event)" [attr.aria-label]="'Coefficient ' + sb.name" /></td>
            <td>@if (coef(sb.id) > 0) { <span class="pill ok">Enseignée</span> } @else { <span class="pill">Non enseignée</span> }</td>
            @if (s.can('subjects.write')) { <td class="right nowrap"><button class="btn sm" (click)="openEdit(sb.id)">Modifier</button> <button class="btn sm danger" (click)="remove(sb.id)">Supprimer</button></td> }</tr>
        }
        <tr><td><b>Total des coefficients</b></td><td class="num"><b>{{ total() }}</b></td><td></td>@if (s.can('subjects.write')) { <td></td> }</tr>
      </tbody></table></div></div>
    } @else {
      <label class="field" style="max-width:260px"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cid.set($event)">@for (c of s.classes(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th>Enseignant</th></tr></thead><tbody>
        @for (sb of s.subjectsOfClass(cid()); track sb.id) {
          <tr><td class="cell-main">{{ sb.name }}</td><td><select style="max-width:280px" [disabled]="!s.can('subjects.write')" [ngModel]="s.teacherOf(cid(), sb.id)?.id ?? ''" (ngModelChange)="assign(sb.id, $event)">
            <option value="">— Non affecté —</option>
            @for (t of teachersFor(sb.id); track t.id) { <option [value]="t.id">{{ t.name }}</option> }</select></td></tr>
        }</tbody></table></div></div>
    }
    }
  </div>
  @if (editing() !== null) {
    <app-modal [title]="editing() ? 'Modifier la matière' : 'Nouvelle matière'" (closed)="editing.set(null)">
      <div class="stack">
        <label class="field"><span>Nom de la matière</span><input [(ngModel)]="fname" name="fname" placeholder="Ex. Mathématiques" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
        <label class="field"><span>Abréviation (facultative)</span><input [(ngModel)]="fshort" name="fshort" maxlength="12" placeholder="Ex. Maths" /></label>
      </div>
      <div footer><button class="btn ghost" (click)="editing.set(null)">Annuler</button><button class="btn primary" (click)="save()">Enregistrer</button></div>
    </app-modal>
  }`,
})
export class MatieresPage {
  readonly s = inject(Store);
  tab = signal<'coef' | 'aff'>('coef'); groupe = signal<Groupe>(this.s.groupes()[0] ?? ''); cid = signal(this.s.classes()[0]?.id ?? '');
  importing = signal(false);
  /** null : fenêtre fermée ; '' : nouvelle matière ; sinon identifiant de la matière modifiée. */
  editing = signal<string | null>(null); err = signal(''); fname = ''; fshort = '';
  coef = (sid: string) => this.s.coefs()[`${this.groupe()}|${sid}`] ?? 0;
  total = computed(() => this.s.subjects().reduce((a, x) => a + (this.s.coefs()[`${this.groupe()}|${x.id}`] ?? 0), 0));
  set(sid: string, v: number | string): void { const n = Math.max(0, Math.min(10, Math.round(Number(v) || 0))); void this.s.setCoefAsync(this.groupe(), sid, n); }
  teachersFor(sid: string) { return this.s.teachers().filter((t) => t.subjectIds.includes(sid)); }
  async assign(sid: string, tid: string): Promise<void> { if (await this.s.setAssignmentAsync(this.cid(), sid, tid)) this.s.toast('Affectation enregistrée.'); }
  openAdd(): void { this.fname = ''; this.fshort = ''; this.err.set(''); this.editing.set(''); }
  openEdit(id: string): void { const sb = this.s.subjectById().get(id); if (!sb) return; this.fname = sb.name; this.fshort = sb.short; this.err.set(''); this.editing.set(id); }
  async save(): Promise<void> {
    const id = this.editing();
    const r = id ? await this.s.renameSubjectAsync(id, this.fname, this.fshort) : await this.s.addSubjectAsync(this.fname, this.fshort);
    if (!r.ok) return void this.err.set(r.error ?? 'Enregistrement impossible.');
    this.editing.set(null); this.s.toast(id ? 'Matière modifiée.' : 'Matière ajoutée. Pensez à fixer son coefficient.');
  }
  async remove(id: string): Promise<void> {
    const sb = this.s.subjectById().get(id);
    if (!sb || !confirm(`Supprimer la matière « ${sb.name} » ?`)) return;
    const r = await this.s.deleteSubjectAsync(id);
    this.s.toast(r.ok ? 'Matière supprimée.' : (r.error ?? 'Suppression impossible.'), r.ok ? 'ok' : 'err');
  }
}

// ---------- Comptes ----------
@Component({
  selector: 'app-comptes',
  imports: [FitHeight, FormsModule, Modal, Icon, Avatar, FileImport, ListModal, NgTemplateOutlet],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Comptes utilisateurs</h1><p>Créez le personnel, désactivez un accès ou réinitialisez un mot de passe.</p></div>
      <div class="row">@if (s.apiMode()) { <button class="btn" (click)="importing.set(true)"><app-icon name="upload" [size]="16" /> Importer</button> }<button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Nouveau compte du personnel</button></div></div>
  @if (importing()) { <app-file-import kind="users" title="Importer du personnel" noun="compte(s)" intro="Enseignants, comptable, éducateurs, secrétariat : une ligne par personne, avec son e-mail." (closed)="importing.set(false)" /> }
    <div class="row"><div class="chips">
      @for (r of roles; track r) { <button class="chip" [class.on]="role() === r" (click)="role.set(r); shown.set(40)">{{ r ? roleLabel[r] : 'Tous' }}</button> }</div>
      <input type="search" placeholder="Rechercher" [ngModel]="q()" (ngModelChange)="q.set($event)" style="max-width:240px" aria-label="Rechercher un compte" /></div>
    <div class="card" appFitHeight><div class="table-wrap"><table class="table hover">
      <thead><ng-container [ngTemplateOutlet]="uHead" /></thead><tbody>
        @for (u of page(); track u.id) { <ng-container [ngTemplateOutlet]="uRow" [ngTemplateOutletContext]="{ $implicit: u }" /> }
        @empty { <tr><td colspan="5" class="empty">Aucun compte.</td></tr> }
      </tbody></table></div>
      @if (list().length > shown()) { <div class="card-body center"><button class="btn" (click)="all.set(true)">Afficher la suite · {{ list().length - shown() }} de plus</button></div> }
    </div>
    <ng-template #uHead><tr><th>Utilisateur</th><th>Rôle</th><th>Identifiant</th><th>État</th><th></th></tr></ng-template>
    <ng-template #uRow let-u>
          <tr><td><div class="row"><app-avatar [name]="u.name" [size]="28" /><div><span class="cell-main">{{ u.name }}</span>@if (isStaff(u.role)) { <div class="tiny" [class.muted]="u.email">@if (u.email) { {{ u.email }} } @else { <span class="pill warn">E-mail manquant</span> }</div> }</div></div></td><td>{{ roleName(u) }}@if (multiCursus() && scoped(u.role)) { <div class="tiny muted">{{ s.cursusLabel(u) }}</div> }</td><td><code>{{ u.username }}</code></td>
            <td>@if (!u.active) { <span class="pill bad">Désactivé</span> } @else if (u.mustChange) { <span class="pill warn">Mot de passe provisoire</span> } @else { <span class="pill ok">Actif</span> }</td>
            <td class="right nowrap">@if (locked(u.role)) { <span class="tiny muted">Géré par la direction</span> } @else { @if (isStaff(u.role)) { <button class="btn sm" (click)="openMail(u.id)">E-mail</button> } @if (s.apiMode() && isStaff(u.role) && u.id !== s.userId()) { <button class="btn sm" (click)="openRole(u.id)">Rôle</button> } <button class="btn sm" (click)="reset(u.id)">Réinitialiser</button> <button class="btn sm" [class.danger]="u.active" (click)="toggle(u.id)">{{ u.active ? 'Désactiver' : 'Réactiver' }}</button> }</td></tr>
    </ng-template>
  </div>
  @if (all()) { <app-list-modal title="Comptes utilisateurs" [items]="list()" [head]="uHead" [row]="uRow" [text]="userText" [cols]="5" [hover]="true"
      placeholder="Nom, identifiant, e-mail ou rôle" (closed)="all.set(false)" /> }
  @if (adding()) {
    <app-modal title="Nouveau compte du personnel" (closed)="adding.set(false)">
      @if (made()) {
        <div class="banner ok">Compte créé. Communiquez ces identifiants à la personne : le mot de passe est provisoire.</div>
        <div class="card flat pad" style="margin-top:12px"><b>{{ made()!.label }}</b><div class="small">Identifiant : <code>{{ made()!.username }}</code> · Mot de passe : <code>{{ made()!.password }}</code></div></div>
      } @else {
        <div class="form-grid">
          <label class="field"><span>Nom complet</span><input [(ngModel)]="nf.name" name="n" />@if (touched() && !nf.name.trim()) { <span class="err">Obligatoire</span> }</label>
          @if (s.apiMode() && rs.choices().length) {
            <label class="field"><span>Rôle</span><select [ngModel]="nf.roleId" (ngModelChange)="pickRole($event)" name="r">@for (c of choices(); track c.id) { <option [ngValue]="c.id">{{ c.label }}</option> }</select></label>
          } @else {
          <label class="field"><span>Rôle</span><select [(ngModel)]="nf.role" name="r"><option value="enseignant">Enseignant</option><option value="educateur">Éducateur</option><option value="comptable">Comptable</option><option value="admin">Secrétariat</option>@if (!isIt()) { <option value="directeur">Directeur</option><option value="fondateur">Fondateur</option> }<option value="informatique">Informatique (facultatif)</option></select></label>
          }
          @if (multiCursus() && scoped(nf.role)) {
            <label class="field"><span>Cursus</span><select [(ngModel)]="nf.cursus" name="cu">
              @if (s.seesAllCursus()) { <option value="">Tous les cursus</option> }
              @for (c of s.cursusList(); track c.id) { <option [value]="c.id">{{ c.nom }}</option> }</select>
              <span class="tiny muted">Directeur, éducateur : un cursus en général. Secrétariat, comptable, fondateur : tous les cursus.</span></label>
          }
          @if (nf.role === 'enseignant') { <label class="field"><span>Matière enseignée</span><select [(ngModel)]="nf.subjectId" name="s">@for (sb of s.subjects(); track sb.id) { <option [value]="sb.id">{{ sb.name }}</option> }</select></label> }
          <label class="field"><span>Identifiant de connexion</span><input [(ngModel)]="nf.username" name="u" placeholder="prof.nom" />@if (err()) { <span class="err">{{ err() }}</span> }</label>
          <label class="field"><span>Adresse e-mail (obligatoire)</span><input type="email" [(ngModel)]="nf.email" name="m" placeholder="prenom.nom@exemple.com" autocapitalize="none" />@if (touched() && !mailOk()) { <span class="err">Adresse e-mail valide obligatoire</span> }<span class="tiny muted">Sert à réinitialiser le mot de passe par e-mail.</span></label>
          <label class="field"><span>Téléphone</span><input [(ngModel)]="nf.phone" name="t" /></label>
        </div>
      }
      <div footer>@if (made()) { <button class="btn primary" (click)="adding.set(false)">Fermer</button> } @else { <button class="btn ghost" (click)="adding.set(false)">Annuler</button><button class="btn primary" (click)="create()">Créer le compte</button> }</div>
    </app-modal>
  }
  @if (chg(); as c) {
    <app-modal title="Changer le rôle" (closed)="chg.set(null)">
      <p>Rôle de <b>{{ c.name }}</b> :</p>
      <label class="field"><span>Rôle</span><select [ngModel]="c.roleId" (ngModelChange)="chg.set({ ...c, roleId: $event, error: '' })" name="cr">@for (x of choices(); track x.id) { <option [ngValue]="x.id">{{ x.label }}</option> }</select></label>
      @if (multiCursus() && c.scoped) {
        <label class="field"><span>Cursus</span><select [ngModel]="c.cursus" (ngModelChange)="chg.set({ ...c, cursus: $event, error: '' })" name="cc">
          @if (s.seesAllCursus()) { <option value="">Tous les cursus</option> }
          @for (x of s.cursusList(); track x.id) { <option [value]="x.id">{{ x.nom }}</option> }</select></label>
      }
      @if (c.error) { <div class="err">{{ c.error }}</div> }
      <div footer><button class="btn ghost" (click)="chg.set(null)">Annuler</button><button class="btn primary" (click)="saveRole()">Enregistrer</button></div>
    </app-modal>
  }
  @if (mail(); as m) {
    <app-modal title="Adresse e-mail du compte" (closed)="mail.set(null)">
      <p>Compte de <b>{{ m.name }}</b>. Le lien « mot de passe oublié » sera envoyé à cette adresse : vérifiez-la avec la personne.</p>
      <label class="field" style="margin-top:10px"><span>Adresse e-mail</span><input type="email" [ngModel]="m.email" (ngModelChange)="mail.set({ id: m.id, name: m.name, email: $event, error: '' })" name="me" autocapitalize="none" /></label>
      @if (m.error) { <div class="banner bad" role="alert">{{ m.error }}</div> }
      <div footer><button class="btn ghost" (click)="mail.set(null)">Annuler</button><button class="btn primary" (click)="saveMail()">Enregistrer</button></div>
    </app-modal>
  }
  @if (pw(); as p) {
    <app-modal title="Mot de passe réinitialisé" (closed)="pw.set(null)">
      <p>Nouveau mot de passe provisoire pour <b>{{ p.name }}</b> : <code>{{ p.pw }}</code></p><p class="small muted" style="margin-top:8px">La personne devra le changer à sa prochaine connexion.</p>
      <div footer><button class="btn primary" (click)="pw.set(null)">Fermer</button></div>
    </app-modal>
  }`,
})
export class ComptesPage {
  importing = signal(false);
  readonly s = inject(Store); readonly roleLabel = ROLE_LABEL;
  readonly roles: ('' | Role)[] = ['', 'fondateur', 'directeur', 'admin', 'enseignant', 'educateur', 'comptable', 'informatique', 'parent', 'eleve'];
  role = signal<'' | Role>(''); q = signal(''); shown = signal(40); all = signal(false);
  /** Texte d'un compte pour la recherche de la liste complète. */
  userText = (u: User) => `${u.name} ${u.username} ${u.email ?? ''} ${this.roleName(u)}`;
  adding = signal(false); made = signal<Credential | null>(null); touched = signal(false); err = signal(''); pw = signal<{ name: string; pw: string } | null>(null);
  nf = { name: '', role: 'enseignant' as 'fondateur' | 'directeur' | 'admin' | 'enseignant' | 'educateur' | 'comptable' | 'informatique' | 'personnel', roleId: undefined as number | undefined, phone: '', subjectId: 'ma', username: '', email: '', cursus: '' as string | null };
  /** École à plusieurs cursus : chaque compte du personnel a un périmètre (l'enseignant, la famille : d'après leurs classes). */
  multiCursus = computed(() => this.s.apiMode() && this.s.cursusList().length > 1);
  scoped = (role: Role | string) => role !== 'enseignant' && role !== 'parent' && role !== 'eleve';
  /** Périmètre proposé selon le rôle : le cursus affiché pour un directeur, un éducateur ou un rôle de l'école ; tous pour les autres. */
  defaultCursus(role: string): string { return ['directeur', 'educateur', 'personnel'].includes(role) || !this.s.seesAllCursus() ? this.s.cursusId() : ''; }
  readonly rs = inject(Roles);
  /** Rôles proposés : ceux de l'école, sans ceux que le service informatique ne gère pas ; l'informatique, facultative, en fin de liste. */
  choices = computed(() => {
    const list = this.rs.choices().filter((c) => !this.isIt() || (c.base !== 'directeur' && c.base !== 'fondateur'));
    const it = (c: { base: string }) => c.base === 'informatique';
    return [...list.filter((c) => !it(c)), ...list.filter(it).map((c) => ({ ...c, label: `${c.label} (facultatif)` }))];
  });
  pickRole(id: number): void { const c = this.rs.choices().find((x) => x.id === id); if (c) { this.nf.roleId = id; this.nf.role = c.base as typeof this.nf.role; this.nf.cursus = this.defaultCursus(c.base); } }
  roleName(u: { role: Role; roleLabel?: string }): string { return u.roleLabel || this.roleLabel[u.role]; }
  chg = signal<{ id: string; name: string; roleId: number | null; error: string; cursus: string; scoped: boolean } | null>(null);
  openRole(id: string): void {
    const u = this.s.userById().get(id);
    if (u) this.chg.set({ id, name: u.name, roleId: this.rs.choices().find((c) => c.label === this.roleName(u))?.id ?? null, error: '', cursus: u.cursus?.[0] ?? '', scoped: this.scoped(u.role) });
  }
  async saveRole(): Promise<void> {
    const c = this.chg(); if (!c || c.roleId === null) return;
    const r = await this.s.setUserRoleAsync(c.id, c.roleId, this.multiCursus() && c.scoped ? c.cursus : null);
    if (!r.ok) return void this.chg.set({ ...c, error: r.error ?? '' });
    this.chg.set(null); this.s.toast('Rôle modifié.');
  }
  isIt = computed(() => this.s.role() === 'informatique');
  /** Le service informatique ne gère pas les comptes de la direction ni du fondateur. */
  locked(role: Role): boolean { return this.isIt() && (role === 'directeur' || role === 'fondateur'); }
  constructor() { const p = this.s.param(); const t = p ? this.s.teacherById().get(p) : null; if (t) this.q.set(t.name); if (this.s.apiMode()) void this.rs.loadChoices(); }
  list = computed(() => { const t = this.q().trim().toLowerCase(); return this.s.users().filter((u) => (!this.role() || u.role === this.role()) && (!t || `${u.name} ${u.username}`.toLowerCase().includes(t))); });
  page = computed(() => this.list().slice(0, this.shown()));
  openAdd(): void { const first = this.choices().find((c) => c.base === 'enseignant'); this.nf = { name: '', role: 'enseignant', roleId: first?.id, phone: '', subjectId: this.s.subjects()[0]?.id ?? '', username: '', email: '', cursus: '' }; this.made.set(null); this.touched.set(false); this.err.set(''); this.adding.set(true); }
  mailOk(): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.nf.email.trim()); }
  isStaff(r: Role): boolean { return r !== 'parent' && r !== 'eleve'; }
  mail = signal<{ id: string; name: string; email: string; error: string } | null>(null);
  openMail(id: string): void { const u = this.s.userById().get(id); if (u) this.mail.set({ id, name: u.name, email: u.email ?? '', error: '' }); }
  async saveMail(): Promise<void> {
    const m = this.mail(); if (!m) return;
    const r = await this.s.setUserEmailAsync(m.id, m.email);
    if (!r.ok) return void this.mail.set({ ...m, error: r.error ?? '' });
    this.mail.set(null); this.s.toast('Adresse e-mail enregistrée.');
  }
  async create(): Promise<void> {
    this.touched.set(true);
    if (!this.mailOk()) return;
    if (!this.nf.name.trim() || !this.nf.username.trim()) return void this.err.set(this.nf.username.trim() ? '' : 'Choisissez un identifiant.');
    const r = await this.s.createStaffAsync({ ...this.nf, cursus: this.multiCursus() && this.scoped(this.nf.role) ? this.nf.cursus : null });   // école à un seul cursus : périmètre par défaut du serveur
    if (!r.cred) return void this.err.set(r.error ?? 'Création impossible.');
    this.made.set(r.cred);
  }
  async reset(id: string): Promise<void> { const pw = await this.s.resetPasswordAsync(id); if (pw) this.pw.set({ name: this.s.userName(id), pw }); }
  toggle(id: string): void {
    if (id === this.s.userId()) return void this.s.toast('Vous ne pouvez pas désactiver votre propre compte.', 'err');
    void this.s.toggleActiveAsync(id);
  }
}

// ---------- Paramètres ----------
@Component({
  selector: 'app-parametres',
  imports: [FormsModule, SchoolLogo, SallesCard, ConduiteReglages, SeriesCard],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Paramètres de l’école</h1><p>Identité, couleur de la plateforme, modèle de bulletin et règles de calcul.</p></div></div>
    <div class="grid two">
      <div class="card pad stack"><h2>Identité</h2>
        <div class="logo-edit">
          <app-logo [src]="s.school().logo" [size]="96" />
          <div class="stack">
            <b>Logo de l’école</b>
            <span class="small muted">Image PNG, JPG ou SVG, de préférence carrée. Affiché sur la connexion, le menu et les bulletins.</span>
            <div class="row-gap">
              <label class="btn" [class.disabled]="!brand()">Choisir un logo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden [disabled]="!brand()" (change)="pickLogo($event)" /></label>
              @if (s.school().logo) { <button class="btn" type="button" [disabled]="!brand()" (click)="s.updateSchoolAsync({ logo: undefined }); s.toast('Logo retiré.')">Retirer le logo</button> }
            </div>
          </div>
        </div>
        <div class="form-grid">
          <label class="field"><span>Nom de l’établissement</span><input [(ngModel)]="f.name" name="a" /></label>
          @if (!techOnly()) {
          <label class="field"><span>Année scolaire</span><input [(ngModel)]="f.year" name="b" /></label>
          <label class="field"><span>Directeur / Directrice</span><input [(ngModel)]="f.director" name="c" /></label>
          <label class="field"><span>Téléphone</span><input [(ngModel)]="f.phone" name="d" /></label>
          <label class="field"><span>Adresse</span><input [(ngModel)]="f.address" name="e" /></label>
          <label class="field"><span>E-mail</span><input [(ngModel)]="f.email" name="f" /></label>
          }
        </div>
        <div><button class="btn primary" (click)="saveInfo()">Enregistrer l’identité</button></div>
      </div>
      <div class="stack">
        <div class="card pad stack"><h2>Couleur de la plateforme</h2>
          <div class="chips">@for (h of hues; track h.v) { <button class="chip" [class.on]="s.school().hue === h.v" (click)="s.updateSchoolAsync({ hue: h.v })"><span class="dot" [style.background]="'hsl(' + h.v + ' 80% 30%)'"></span>{{ h.n }}</button> }</div>
          <p class="small muted">Le changement s’applique tout de suite à tous les écrans.</p></div>
        @if (!techOnly() && s.can('settings') && s.apiMode()) {
        <div class="card pad stack"><h2>Passage en classe supérieure</h2>
          <p class="small muted">Ces moyennes sont choisies par votre école. Elles servent à proposer la décision de chaque élève en fin d’année ; la direction garde le dernier mot.</p>
          <div class="row">
            <label class="field"><span>Moyenne d’admission</span><input type="number" min="0" max="20" step="0.01" name="pAdm" [(ngModel)]="pg.adm" /></label>
            <label class="field"><span>En dessous de, redoublement</span><input type="number" min="0" max="20" step="0.01" name="pRed" [(ngModel)]="pg.red" /></label>
            <label class="field"><span>Exclusion en dessous de (facultatif)</span><input type="number" min="0" max="20" step="0.01" name="pExc" [(ngModel)]="pg.exc" placeholder="Aucune" /></label>
          </div>
          <p class="small muted">Entre les deux premières moyennes, l’élève est examiné par le conseil de classe. Sans moyenne d’exclusion, aucun élève n’est proposé à l’exclusion.</p>
          <h3>Exceptions par niveau</h3>
          <p class="small muted">Un niveau sans exception suit la règle ci-dessus. Cochez un niveau pour lui donner ses propres moyennes (par exemple une règle plus stricte en 3e ou en Terminale).</p>
          <div class="chips"><button class="chip" (click)="cycleRule(s.levelsOfCycle('college'))">Même règle propre pour tout le collège</button><button class="chip" (click)="cycleRule(s.levelsOfCycle('lycee'))">Même règle propre pour tout le lycée</button><button class="chip" (click)="clearRules()">Aucune exception</button></div>
          @for (lv of s.levelNames(); track lv) {
            <div class="row pn-row">
              <label class="field inline"><span><input type="checkbox" [attr.aria-label]="'Règle propre pour ' + lv" [ngModel]="pnOf(lv).on" (ngModelChange)="setPn(lv, 'on', $event)" /> {{ lv }}</span></label>
              @if (pnOf(lv).on) {
                <label class="field"><span>Admission</span><input type="number" min="0" max="20" step="0.01" [attr.aria-label]="'Admission ' + lv" [ngModel]="pnOf(lv).adm" (ngModelChange)="setPn(lv, 'adm', $event)" /></label>
                <label class="field"><span>Redoublement en dessous de</span><input type="number" min="0" max="20" step="0.01" [attr.aria-label]="'Redoublement ' + lv" [ngModel]="pnOf(lv).red" (ngModelChange)="setPn(lv, 'red', $event)" /></label>
                <label class="field"><span>Exclusion (facultatif)</span><input type="number" min="0" max="20" step="0.01" [attr.aria-label]="'Exclusion ' + lv" [ngModel]="pnOf(lv).exc" (ngModelChange)="setPn(lv, 'exc', $event)" placeholder="Aucune" /></label>
              } @else { <span class="small muted">Suit la règle de l’école</span> }
            </div>
          }
          @if (pgErr()) { <div class="banner bad">{{ pgErr() }}</div> }
          <div><button class="btn primary" (click)="savePg()">Enregistrer les moyennes</button></div></div>
        }
        @if (!techOnly() && s.can('settings')) {
        <div class="card pad stack"><h2>Périodes d’évaluation</h2>
          <p class="small muted">Chaque école choisit son découpage de l’année : trimestres, semestres ou autre. Les notes, bulletins et moyennes annuelles suivent ces périodes.</p>
          <p class="small muted" style="margin:0">Coefficient : poids de la période dans la moyenne annuelle. Par défaut, usage ivoirien : 1er trimestre coefficient 1, les suivants coefficient 2. Exemple : (moy. T1 × 1 + moy. T2 × 2 + moy. T3 × 2) ÷ 5.</p>
          <div class="chips"><button class="chip" type="button" (click)="preset('tri')">3 trimestres</button><button class="chip" type="button" (click)="preset('sem')">2 semestres</button></div>
          <div class="stack">
            @for (p of pd(); track $index; let i = $index) {
              <div class="per-row">
                <input class="grow" [ngModel]="p.label" (ngModelChange)="setP(i, 'label', $event)" aria-label="Nom de la période" placeholder="Ex. 1er semestre" />
                <input type="date" [ngModel]="p.start" (ngModelChange)="setP(i, 'start', $event)" aria-label="Début" />
                <span>→</span>
                <input type="date" [ngModel]="p.end" (ngModelChange)="setP(i, 'end', $event)" aria-label="Fin" />
                <label class="row" style="gap:4px;flex:none"><span class="small muted">coef.</span><input type="number" min="1" max="9" step="1" style="width:58px" [ngModel]="p.coef" (ngModelChange)="setP(i, 'coef', +$event)" aria-label="Coefficient dans la moyenne annuelle" /></label>
                <button class="btn sm danger" type="button" [disabled]="pd().length < 2" (click)="removeP(i)" aria-label="Retirer cette période">×</button>
              </div>
            }
            <div><button class="btn sm" type="button" [disabled]="pd().length >= 6" (click)="addP()">+ Ajouter une période</button></div>
          </div>
          @if (pErr()) { <div class="err">{{ pErr() }}</div> }
          <div><button class="btn primary" type="button" (click)="saveP()">Enregistrer les périodes</button></div>
          <p class="tiny muted">Une période qui a déjà des évaluations ne peut pas être retirée.</p>
        </div>
        }
        @if (!techOnly() && s.apiMode() && s.can('edt.write')) {
        <div class="card pad stack"><h2>Horaires de cours</h2>
          <p class="small muted">Jours de classe, heures des créneaux, pauses et nombre de créneaux ouverts par jour. Ils servent à l’emploi du temps de toutes les classes.</p>
          <div class="stack">
            @for (c of hd().creneaux; track $index; let i = $index) {
              <div class="slot-row">
                <span class="tiny muted">Créneau {{ i + 1 }}</span>
                <input class="inline-input" [ngModel]="c.debut" (ngModelChange)="setT(i, 'debut', $event)" aria-label="Début" placeholder="07h30" />
                <span>→</span>
                <input class="inline-input" [ngModel]="c.fin" (ngModelChange)="setT(i, 'fin', $event)" aria-label="Fin" placeholder="08h30" />
                @if (i > 0) { <input class="grow" [ngModel]="hd().pauses[i] || ''" (ngModelChange)="setPause(i, $event)" aria-label="Pause avant ce créneau" placeholder="Pause avant (ex. Récréation)" /> }
                <button class="btn sm danger" type="button" [disabled]="hd().creneaux.length < 2" (click)="removeSlot(i)" aria-label="Retirer ce créneau">×</button>
              </div>
            }
            <div><button class="btn sm" type="button" [disabled]="hd().creneaux.length >= 12" (click)="addSlot()">+ Ajouter un créneau</button></div>
          </div>
          <b>Jours de classe</b>
          <div class="days">
            @for (d of days; track d; let i = $index) {
              <label class="field"><span>{{ d }}</span>
                <select [ngModel]="hd().ouverts[i]" (ngModelChange)="setOuverts(i, $event)">
                  <option [value]="0">Fermé</option>
                  @for (n of range(); track n) { <option [value]="n">{{ n }} créneau{{ n > 1 ? 'x' : '' }}</option> }
                </select></label>
            }
          </div>
          @if (hErr()) { <div class="err">{{ hErr() }}</div> }
          <div><button class="btn primary" type="button" (click)="saveHoraires()">Enregistrer les horaires</button></div>
        </div>
        }
        @if (!techOnly() && s.apiMode() && s.can('edt.write')) { <app-salles /> }
        @if (!techOnly()) {
        <div class="card pad stack"><h2>Bulletins</h2>
          <div class="field"><span>Modèle par défaut</span>
            <div class="chips">@for (t of templates; track t.id) { <button class="chip" [class.on]="s.school().template === t.id" [disabled]="!s.can('settings')" (click)="s.updateSchoolAsync({ template: t.id })">{{ t.n }}</button> }</div></div>
          <p class="small muted" style="margin:0">{{ templateHelp() }}</p>
          <div class="form-grid">
            <label class="field"><span>En-tête : pays</span><input maxlength="80" [disabled]="!s.can('settings')" [ngModel]="s.school().entetePays" (change)="s.updateSchoolAsync({ entetePays: $any($event.target).value.trim() })" placeholder="République de Côte d’Ivoire" /></label>
            <label class="field"><span>En-tête : devise</span><input maxlength="80" [disabled]="!s.can('settings')" [ngModel]="s.school().enteteDevise" (change)="s.updateSchoolAsync({ enteteDevise: $any($event.target).value.trim() })" placeholder="Union – Discipline – Travail" /></label>
          </div>
          <div class="small muted">Affichés en haut à droite du modèle Classique, au-dessus de l’année scolaire (qui suit l’année ouverte). Laissez un champ vide pour retirer la ligne. Enregistré quand vous quittez le champ.</div></div>
        <div class="card pad stack"><h2>Bulletins et impayés</h2>
          <label class="field"><span>Les parents et l’élève voient et téléchargent le bulletin de l’année</span>
            <select [disabled]="!s.can('settings')" [ngModel]="s.school().bulletinBlocage ?? 'retard'" (ngModelChange)="s.updateSchoolAsync({ bulletinBlocage: $event })">
              <option value="retard">Si les échéances arrivées à terme sont réglées</option>
              <option value="total">Seulement si toute la scolarité de l’année est soldée</option>
              <option value="aucun">Toujours, même en cas d’impayé</option>
            </select></label>
          <div class="small muted">Les notes restent visibles et la direction voit toujours tous les bulletins. Pour un cas particulier, la direction peut débloquer le bulletin d’un élève depuis la page Bulletins.</div></div>
        <div class="card pad stack"><h2>Règles de calcul</h2>
          <label class="field"><span>Poids de la composition dans la moyenne de matière : {{ (s.school().compoWeight * 100).toFixed(0) }} %</span>
            <input type="range" min="0" max="100" step="5" [ngModel]="s.school().compoWeight * 100" (ngModelChange)="s.updateSchoolAsync({ compoWeight: $event / 100 })" /></label>
          <div class="small muted">Le reste correspond à la moyenne des interrogations et devoirs.</div>
          <div class="form-grid">
            @for (i of [0, 1, 2, 3]; track i) { <label class="field"><span>{{ labels[i] }} à partir de</span><input type="number" min="0" max="20" step="0.5" [ngModel]="s.school().seuils[i]" (ngModelChange)="seuil(i, $event)" /></label> }
          </div></div>
        @if (s.can('settings')) { <app-conduite-reglages /> }
        <div class="card pad stack"><h2>Devoirs et épreuves en ligne</h2>
          <label class="row"><input type="checkbox" [disabled]="!s.can('settings')" [ngModel]="!!s.school().devoirsActifs" (ngModelChange)="s.updateSchoolAsync({ devoirsActifs: $event })" /> <span>Devoirs, supports de cours et épreuves en ligne : les enseignants peuvent envoyer des devoirs, des épreuves (QCM, vrai ou faux), des liens et fichiers de cours, et programmer des cours en direct</span></label>
          <div class="small muted">Par défaut fermé. Les élèves rendent leurs copies sur la plateforme ; les parents suivent les devoirs, les notes et les supports de leur enfant (sans le lien des cours en direct).</div></div>
        <div class="card pad stack"><h2>Ce que voit l’élève</h2>
          <p class="small muted" style="margin:0">L’élève voit toujours son emploi du temps, ses notes, ses absences et ses bulletins (sous réserve du réglage sur les impayés ci-dessus).</p>
          <label class="row"><input type="checkbox" [disabled]="!s.can('settings')" [ngModel]="!!s.school().eleveVoitCahier" (ngModelChange)="s.updateSchoolAsync({ eleveVoitCahier: $event })" /> <span>L’élève voit aussi le cahier de textes (devoirs et contenu des séances)</span></label>
          <div class="small muted">Par défaut, le cahier de textes est réservé aux parents et au personnel.</div></div>
        <div class="card pad stack"><h2>Remise fratrie</h2>
          <label class="field"><span>Remise sur la scolarité du 2e enfant et des suivants : {{ s.school().remiseFratrie }} %</span>
            <input type="number" min="0" max="100" step="1" [disabled]="!s.can('settings')" [ngModel]="s.school().remiseFratrie" (ngModelChange)="remise($event)" /></label>
          <div class="small muted">S’applique à la scolarité d’enfants d’un même parent (pas à l’inscription) et recalcule les soldes.</div></div>
        }
      </div>
    </div>
    <app-series-card />
  </div>`,
  styles: '.logo-edit { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding-bottom: 6px; } .row-gap { display: flex; gap: 8px; flex-wrap: wrap; } label.btn { cursor: pointer; } label.btn.disabled { opacity: .5; pointer-events: none; } .per-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .per-row .grow { flex: 1 1 150px; min-width: 0; } .slot-row { display: flex; gap: 8px; align-items: center; } .slot-row .inline-input { width: 76px; flex: none; } .slot-row .grow { flex: 1; min-width: 0; } .days { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; } @media (max-width: 560px) { .slot-row { flex-wrap: wrap; } .slot-row .grow { flex-basis: 100%; order: 5; } } .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; margin-inline-end: 7px; vertical-align: -1px; }',
})
export class ParametresPage {
  readonly s = inject(Store);
  readonly tt = inject(Timetable); readonly days = DAYS;
  f = { ...this.s.school() };
  private periodRows = () => this.s.terms().map((t, i) => ({ label: t.label, start: t.start, end: t.end, coef: termCoef(t, i) }));
  pd = signal<{ label: string; start: string; end: string; coef: number }[]>(this.periodRows()); pErr = signal('');
  setP(i: number, k: 'label' | 'start' | 'end' | 'coef', v: string | number): void { this.pd.update((l) => l.map((p, j) => (j === i ? { ...p, [k]: v } : p))); }
  addP(): void {
    const l = this.pd(), last = l[l.length - 1];
    const d = last?.end ? new Date(last.end + 'T12:00:00Z') : new Date();
    const a = new Date(d.getTime() + 86400000), b = new Date(a.getTime() + 90 * 86400000);
    this.pd.set([...l, { label: '', start: a.toISOString().slice(0, 10), end: b.toISOString().slice(0, 10), coef: l.length ? 2 : 1 }]);
  }
  removeP(i: number): void { this.pd.update((l) => l.filter((_, j) => j !== i)); }
  /** Découpage rapide : garde le début et la fin de l'année et répartit les périodes à parts égales. */
  preset(kind: 'tri' | 'sem'): void {
    const l = this.pd(); const n = kind === 'tri' ? 3 : 2;
    const t0 = new Date((l[0]?.start || `${new Date().getFullYear()}-09-07`) + 'T12:00:00Z').getTime();
    const t1 = new Date((l[l.length - 1]?.end || `${new Date().getFullYear() + 1}-06-30`) + 'T12:00:00Z').getTime();
    const span = Math.floor((t1 - t0) / 86400000 / n), day = (k: number) => new Date(t0 + k * 86400000).toISOString().slice(0, 10);
    const names = kind === 'tri' ? ['1er trimestre', '2e trimestre', '3e trimestre'] : ['1er semestre', '2e semestre'];
    this.pd.set(names.map((label, i) => ({ label, start: day(i * (span + 1)), end: i === n - 1 ? new Date(t1).toISOString().slice(0, 10) : day(i * (span + 1) + span), coef: i === 0 ? 1 : 2 })));
  }
  async saveP(): Promise<void> {
    this.pErr.set('');
    const r = await this.s.savePeriodesAsync(this.pd());
    if (!r.ok) return void this.pErr.set(r.error ?? 'Enregistrement impossible.');
    this.pd.set(this.periodRows());
    this.s.toast('Périodes enregistrées.');
  }
  pg = { adm: this.s.school().passageAdmission ?? 10, red: this.s.school().passageRedoublement ?? 8, exc: this.s.school().passageExclusion as number | null };
  pgErr = signal('');
  pn = signal<Record<string, { on: boolean; adm: number | null; red: number | null; exc: number | null }>>(Object.fromEntries(this.s.levelNames().map((lv) => {
    const r = this.s.school().passageNiveaux?.[lv];
    return [lv, { on: !!r, adm: r?.admission ?? this.pg.adm, red: r?.redoublement ?? this.pg.red, exc: r?.exclusion ?? null }];
  })));
  /** Règle d'un niveau (un niveau ajouté depuis l'ouverture de la page suit la règle de l'école). */
  pnOf(lv: string) { return this.pn()[lv] ?? { on: false, adm: this.pg.adm, red: this.pg.red, exc: null }; }
  setPn(lv: string, k: 'on' | 'adm' | 'red' | 'exc', v: unknown): void { this.pn.update((m) => ({ ...m, [lv]: { ...this.pnOf(lv), [k]: v === '' ? null : v } })); }
  /** Donne la même règle propre à tous les niveaux d'un cycle (reprend celle du premier niveau déjà réglé, sinon la règle de l'école). */
  cycleRule(lvs: string[]): void {
    this.pn.update((m) => {
      const src = lvs.map((l) => m[l]).find((x) => x?.on) ?? { adm: this.pg.adm, red: this.pg.red, exc: this.pg.exc };
      const out = { ...m };
      for (const l of lvs) out[l] = { on: true, adm: src.adm, red: src.red, exc: src.exc };
      return out;
    });
  }
  clearRules(): void { this.pn.update((m) => Object.fromEntries(Object.entries(m).map(([l, x]) => [l, { ...x, on: false }]))); }
  async savePg(): Promise<void> {
    this.pgErr.set('');
    const exc = this.pg.exc === null || (this.pg.exc as unknown) === '' ? null : Number(this.pg.exc);
    const niv: Record<string, { admission: number; redoublement: number; exclusion: number | null }> = {};
    for (const lv of this.s.levelNames()) { const x = this.pnOf(lv); if (x.on) niv[lv] = { admission: Number(x.adm), redoublement: Number(x.red), exclusion: x.exc === null ? null : Number(x.exc) }; }
    const r = await this.s.savePassageAsync({ passageAdmission: Number(this.pg.adm), passageRedoublement: Number(this.pg.red), passageExclusion: exc, passageNiveaux: niv });
    if (!r.ok) return void this.pgErr.set(r.error ?? 'Enregistrement impossible.');
    this.s.toast('Moyennes de passage enregistrées.');
  }
  hd = signal<Horaires>(structuredClone(this.tt.horaires())); hErr = signal('');
  range = computed(() => Array.from({ length: this.hd().creneaux.length }, (_, i) => i + 1));
  private cloneH(): Horaires { return structuredClone(this.hd()); }
  setT(i: number, k: 'debut' | 'fin', v: string): void { const h = this.cloneH(); h.creneaux[i][k] = v.trim(); this.hd.set(h); }
  setPause(i: number, v: string): void { const h = this.cloneH(); if (v.trim()) h.pauses[String(i)] = v; else delete h.pauses[String(i)]; this.hd.set(h); }
  setOuverts(i: number, v: number | string): void { const h = this.cloneH(); h.ouverts[i] = Number(v) || 0; this.hd.set(h); }
  addSlot(): void {
    const h = this.cloneH(); const last = h.creneaux[h.creneaux.length - 1];
    h.creneaux.push({ debut: last?.fin ?? '07h30', fin: '' }); this.hd.set(h);
  }
  removeSlot(i: number): void {
    const h = this.cloneH(); h.creneaux.splice(i, 1);
    const n = h.creneaux.length, p: Record<string, string> = {};
    for (const [k, v] of Object.entries(h.pauses)) { const j = Number(k); if (j < i && j >= 1) p[k] = v; else if (j > i && j - 1 >= 1) p[String(j - 1)] = v; }
    h.pauses = p; h.ouverts = h.ouverts.map((o) => Math.min(o, n)); this.hd.set(h);
  }
  async saveHoraires(): Promise<void> {
    this.hErr.set('');
    let r = await this.tt.saveHorairesAsync(this.hd());
    if (!r.ok && r.invalides) {
      if (!confirm(`${r.invalides} cours déjà placés tombent sur des créneaux ou des jours qui n’existent plus. Les retirer de l’emploi du temps et enregistrer ?`)) return;
      r = await this.tt.saveHorairesAsync(this.hd(), true);
    }
    if (!r.ok) return void this.hErr.set(r.error ?? 'Enregistrement impossible.');
    this.hd.set(structuredClone(this.tt.horaires())); this.s.toast('Horaires enregistrés.');
  }
  /** Service informatique : seulement le nom, le logo et la couleur. */
  techOnly = computed(() => !this.s.can('settings') && this.s.can('settings.tech'));
  brand = computed(() => this.s.can('settings') || this.s.can('settings.tech'));
  readonly labels = ['Très bien', 'Bien', 'Assez bien', 'Passable'];
  readonly hues = [{ v: 155, n: 'Vert' }, { v: 215, n: 'Bleu' }, { v: 275, n: 'Violet' }, { v: 345, n: 'Bordeaux' }, { v: 190, n: 'Turquoise' }];
  readonly templates: { id: TemplateId; n: string }[] = [{ id: 'classique', n: 'Classique' }, { id: 'moderne', n: 'Moderne' }, { id: 'compact', n: 'Compact' }];
  templateHelp = computed(() => ({ classique: 'Mise en page sobre à l’en-tête officiel, adaptée à l’impression noir et blanc.', moderne: 'Bandeau coloré, indicateurs visuels et graphique de comparaison avec la classe.', compact: 'Tout tient sur une demi-page : idéal pour imprimer beaucoup de bulletins.' })[this.s.school().template]);
  constructor() { void this.tt.load().then(() => this.hd.set(structuredClone(this.tt.horaires()))); }
  async saveInfo(): Promise<void> { const { name, year, director, phone, address, email } = this.f; await this.s.updateSchoolAsync(this.techOnly() ? { name } : { name, year, director, phone, address, email }); this.s.toast('Paramètres enregistrés.'); }
  pickLogo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) { this.s.toast('Format non pris en charge : utilisez PNG, JPG, SVG ou WebP.', 'err'); return; }
    if (file.size > 3 * 1024 * 1024) { this.s.toast('Image trop lourde (3 Mo maximum).', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const url = String(rd.result);
      if (file.type === 'image/svg+xml' && !this.s.apiMode()) { this.s.updateSchoolAsync({ logo: url }); this.s.toast('Logo enregistré.'); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 320 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        this.s.updateSchoolAsync({ logo: cv.toDataURL('image/png') }); this.s.toast('Logo enregistré.');
      };
      img.onerror = () => this.s.toast('Image illisible.', 'err');
      img.src = url;
    };
    rd.readAsDataURL(file);
  }
  remise(v: number): void { const n = Math.min(100, Math.max(0, Math.round(Number(v) || 0))); this.s.updateSchoolAsync({ remiseFratrie: n }); }
  seuil(i: number, v: number): void { const t = [...this.s.school().seuils] as [number, number, number, number]; t[i] = Number(v) || 0; this.s.updateSchoolAsync({ seuils: t }); }
}

// ---------- Annonces ----------
@Component({
  selector: 'app-annonces',
  imports: [FormsModule, Modal, Icon],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Annonces</h1><p>Informations de l’école destinées aux familles et au personnel.</p></div>
      @if (s.can('annonces.write')) { <button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Nouvelle annonce</button> }</div>
    <div class="stack">
      @for (a of s.myAnnouncements(); track a.id) {
        <article class="card pad stack"><div class="row"><h2 class="grow">{{ a.title }}</h2><span class="tiny muted">{{ dateLong(a.date) }}</span></div>
          <p>{{ a.body }}</p>
          @if (multi() || s.can('annonces.write')) {
            <div class="chips">
              @if (multi()) { <span class="pill ok">{{ (a.cursusNoms ?? []).join(', ') || 'Toute l’école' }}</span> }
              @if (s.can('annonces.write')) { @for (r of a.audience; track r) { <span class="pill">{{ roleLabel[r] }}</span> } }
            </div>
          }</article>
      } @empty { <div class="card empty">Aucune annonce pour le moment.</div> }
    </div>
  </div>
  @if (adding()) {
    <app-modal title="Nouvelle annonce" (closed)="adding.set(false)">
      <div class="stack">
        <label class="field"><span>Titre</span><input [(ngModel)]="t" name="t" />@if (touched() && !t.trim()) { <span class="err">Obligatoire</span> }</label>
        <label class="field"><span>Message</span><textarea rows="4" [(ngModel)]="b" name="b"></textarea>@if (touched() && !b.trim()) { <span class="err">Obligatoire</span> }</label>
        @if (multi()) {
          <label class="field"><span>Cursus</span><select [ngModel]="cu()" (ngModelChange)="cu.set($event)" name="cu">
            @if (s.seesAllCursus()) { <option value="">Toute l’école (tous les cursus)</option> }
            @for (c of s.cursusList(); track c.id) { <option [value]="c.id">{{ c.nom }}</option> }</select>
            <span class="tiny muted">Seuls les familles, élèves et membres du personnel de ce cursus verront l’annonce.</span></label>
        }
        <div class="field"><span>Destinataires</span><div class="chips">@for (r of roles; track r) { <button type="button" class="chip" [class.on]="aud().includes(r)" (click)="toggle(r)">{{ roleLabel[r] }}</button> }</div>
          @if (touched() && !aud().length) { <span class="err">Choisissez au moins un groupe</span> }</div>
      </div>
      <div footer><button class="btn ghost" (click)="adding.set(false)">Annuler</button><button class="btn primary" (click)="send()">Publier</button></div>
    </app-modal>
  }`,
})
export class AnnoncesPage {
  readonly s = inject(Store); readonly dateLong = dateLong; readonly roleLabel = ROLE_LABEL;
  readonly roles: Role[] = ['parent', 'eleve', 'enseignant', 'educateur', 'comptable', 'informatique', 'admin', 'directeur', 'fondateur'];
  adding = signal(false); touched = signal(false); aud = signal<Role[]>(['parent', 'eleve', 'enseignant']); t = ''; b = '';
  /** École à plusieurs cursus : l'annonce vise toute l'école ou un cursus. */
  multi = computed(() => this.s.apiMode() && this.s.cursusList().length > 1);
  cu = signal('');
  openAdd(): void { this.t = ''; this.b = ''; this.touched.set(false); this.aud.set(['parent', 'eleve', 'enseignant']); this.cu.set(this.s.seesAllCursus() ? '' : this.s.cursusId()); this.adding.set(true); }
  toggle(r: Role): void { this.aud.update((a) => (a.includes(r) ? a.filter((x) => x !== r) : [...a, r])); }
  async send(): Promise<void> {
    this.touched.set(true);
    if (!this.t.trim() || !this.b.trim() || !this.aud().length) return;
    const ok = await this.s.addAnnouncementAsync({ title: this.t.trim(), body: this.b.trim(), audience: [...new Set([...this.aud(), this.s.role()!])], cursus: this.multi() ? this.cu() : null });
    if (!ok) return;
    this.adding.set(false); this.s.toast('Annonce publiée et notifiée.');
  }
}

// ---------- Journal ----------
@Component({
  selector: 'app-journal',
  imports: [FitHeight, FormsModule, Icon, ListModal, NgTemplateOutlet],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Journal d’activité</h1><p>Trace des actions sensibles : notes, publications, paiements, comptes.</p></div>
      <button class="btn" (click)="exportCsv()"><app-icon name="download" [size]="16" /> Exporter</button></div>
    <input type="search" placeholder="Filtrer par action, personne ou détail" [ngModel]="q()" (ngModelChange)="q.set($event); shown.set(60)" style="max-width:360px" aria-label="Filtrer le journal" />
    <div class="card" appFitHeight><div class="table-wrap"><table class="table"><thead><ng-container [ngTemplateOutlet]="jHead" /></thead><tbody>
      @for (l of page(); track l.id) { <ng-container [ngTemplateOutlet]="jRow" [ngTemplateOutletContext]="{ $implicit: l }" /> }
      @empty { <tr><td colspan="4" class="empty">Aucune entrée.</td></tr> }</tbody></table></div>
      @if (list().length > shown()) { <div class="card-body center"><button class="btn" (click)="all.set(true)">Afficher la suite · {{ list().length - shown() }} de plus</button></div> }</div>
    <ng-template #jHead><tr><th>Date</th><th>Action</th><th>Détail</th><th>Par</th></tr></ng-template>
    <ng-template #jRow let-l><tr><td class="nowrap tiny">{{ dateFr(l.ts) }} {{ l.ts.slice(11, 16) }}</td><td><span class="pill brand">{{ l.action }}</span></td><td>{{ l.detail }}</td><td class="muted">{{ who(l) }}</td></tr></ng-template>
  </div>
  @if (all()) { <app-list-modal title="Journal d’activité" [items]="list()" [head]="jHead" [row]="jRow" [text]="logText" [cols]="4" [exportable]="true"
      placeholder="Action, personne ou détail" (exported)="exportCsv()" (closed)="all.set(false)" /> }`,
})
export class JournalPage {
  readonly s = inject(Store); readonly dateFr = dateFr;
  q = signal(''); shown = signal(60); all = signal(false);
  who = (l: LogEntry) => l.userName ?? (l.userId === 'u-system' ? 'Système' : this.s.userName(l.userId));
  logText = (l: LogEntry) => `${l.action} ${l.detail} ${this.who(l)} ${dateFr(l.ts)}`;
  constructor() { void this.s.loadLog(); }
  list = computed(() => { const t = this.q().trim().toLowerCase(); return this.s.log().filter((l) => !t || `${l.action} ${l.detail} ${l.userName ?? this.s.userName(l.userId)}`.toLowerCase().includes(t)); });
  page = computed(() => this.list().slice(0, this.shown()));
  exportCsv(): void { void this.s.download('journal.csv', toCsv(['Date', 'Action', 'Détail', 'Par'], this.list().map((l) => [l.ts.replace('T', ' '), l.action, l.detail, l.userName ?? this.s.userName(l.userId)]))); }
}
