import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal } from '../ui';
import { addDays, dateFr, fnum, parseNote, rangLabel } from '../format';
import {
  ExamKind, MockExams, MockSession, columnLabel, columnOf, eligible, markKey, typeLabel,
} from '../modules/mockexams';

type Tab = 'resultats' | 'saisie' | 'coefs';
interface KindForm { id: string | null; name: string; levels: string[]; perSerie: boolean; coefs: Record<string, Record<string, number>>; active: boolean; }

@Component({
  selector: 'app-examens',
  imports: [FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Examens blancs</h1><p>{{ intro() }}</p></div>
      @if (s.can('examens.write')) { <div class="row">@if (view() === 'types') { <button type="button" class="btn primary" (click)="openKind(null)"><app-icon name="plus" [size]="16" /> Nouvel examen</button> }
        @else { <button type="button" class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Nouvelle session</button> }</div> }</div>
    @if (s.can('examens.write')) {
      <div class="tabs"><button class="tab" [class.on]="view() === 'sessions'" (click)="view.set('sessions')">Sessions</button><button class="tab" [class.on]="view() === 'types'" (click)="view.set('types')">Types d’examen</button></div>
    }
    @if (view() === 'types') {
      <div class="card">
        <div class="card-head"><div><h2>Examens préparés par l’école</h2><div class="small muted">Saisissez vos examens nationaux (BEPC, BAC, DEF, CEP, Brevet…) : nom, niveaux concernés et coefficients. Ils sont proposés à la création d’une session.</div></div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Examen</th><th>Niveaux</th><th>Coefficients</th><th class="num">Sessions</th><th>État</th><th></th></tr></thead><tbody>
          @for (k of mx.kinds(); track k.id) {
            <tr [class.muted]="!k.active"><td class="cell-main">{{ k.name }}</td><td>{{ k.levels.join(', ') }}</td>
              <td>{{ k.perSerie ? 'Par série' : 'Une liste pour toutes les classes' }}<div class="tiny muted">{{ kindCoefsSummary(k) }}</div></td>
              <td class="num">{{ mx.usage(k) }}</td>
              <td>@if (k.active) { <span class="pill ok">Proposé</span> } @else { <span class="pill">Masqué</span> }</td>
              <td class="right nowrap"><button class="btn sm" (click)="openKind(k)">Modifier</button>
                <button class="btn sm" (click)="toggleKind(k)">{{ k.active ? 'Masquer' : 'Réafficher' }}</button>
                @if (!mx.usage(k)) { <button class="btn sm danger" (click)="askRemoveKind.set(k)">Retirer</button> }</td></tr>
          } @empty { <tr><td colspan="6" class="empty">Aucun examen : ajoutez ceux que vos élèves préparent.</td></tr> }
        </tbody></table></div>
        <div class="card-body tiny muted">Un examen utilisé par une session ne peut pas être retiré : masquez-le, l’historique est conservé. Modifier un examen ne change pas les sessions déjà créées. « Autre examen » reste toujours disponible pour un examen ponctuel.</div>
      </div>
    } @else {

    @if (sessions().length === 0) {
      <div class="card"><div class="empty">{{ isFamily() ? 'Aucun résultat d’examen blanc n’est publié pour le moment.' : 'Aucune session d’examen blanc.' }}</div></div>
    } @else {
      <div class="grid three" role="list" aria-label="Sessions">
        @for (x of sessions(); track x.id) {
          <button type="button" role="listitem" class="card pad sess" [class.sel]="sess()?.id === x.id" (click)="pick(x.id)" [attr.aria-pressed]="sess()?.id === x.id">
            <div class="row" style="justify-content:space-between"><span class="pill brand">{{ typeLabel(x.type) }}</span>
              <span class="pill" [class.ok]="x.status === 'publié'" [class.warn]="x.status !== 'publié'">{{ x.status === 'publié' ? 'Publié' : 'Brouillon' }}</span></div>
            <b>{{ x.name }}</b>
            <span class="small muted">Du {{ dateFr(x.start) }} au {{ dateFr(x.end) }}</span>
            <span class="small muted">{{ classNames(x) }}</span>
          </button>
        }
      </div>
    }

    @if (sess(); as x) {
      @if (isFamily()) {
        @if (kid(); as k) {
          @if (kidRow(); as r) {
            <div class="card">
              <div class="card-head"><h2>{{ k.prenoms }} {{ k.nom }} · {{ x.name }}</h2><span class="pill brand">{{ s.className(k.classId) }}</span></div>
              <div class="card-body stack">
                <div class="grid kpi">
                  <div class="card kpi-card"><span class="label">Moyenne pondérée</span><span class="value">{{ r.avg === null ? '—' : fnum(r.avg) + ' / 20' }}</span></div>
                  <div class="card kpi-card"><span class="label">Rang dans la classe</span><span class="value">{{ rangLabel(r.rank, res().effectif) }}</span></div>
                  <div class="card kpi-card"><span class="label">Mention</span><span class="value">{{ r.mention }}</span></div>
                  <div class="card kpi-card" [class.alert]="r.admissible === false"><span class="label">Admissibilité</span><span class="value">{{ r.admissible === null ? 'Incomplet' : r.admissible ? 'Admissible' : 'Non admissible' }}</span><span class="hint">Seuil indicatif : 10 / 20</span></div>
                </div>
                <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th class="num">Note / 20</th><th class="num">Coefficient</th><th class="num">Points</th></tr></thead><tbody>
                  @for (sb of res().subjects; track sb.id; let i = $index) {
                    <tr><td class="cell-main">{{ sb.name }}</td><td class="num">{{ r.marks[i] === null ? '—' : fnum(r.marks[i]) }}</td><td class="num">{{ sb.coef }}</td><td class="num">{{ r.marks[i] === null ? '—' : fnum(r.marks[i]! * sb.coef) }}</td></tr>
                  }</tbody></table></div>
                <div class="banner info"><app-icon name="chart" [size]="18" /> Moyenne de la classe : {{ res().avg === null ? '—' : fnum(res().avg) }} / 20 · Meilleure moyenne : {{ res().max === null ? '—' : fnum(res().max) }} / 20</div>
                <p class="tiny muted">Examen blanc d’entraînement. Les coefficients sont indicatifs et ne remplacent pas ceux de l’examen officiel.</p>
              </div>
            </div>
          } @else { <div class="card"><div class="empty">{{ k.prenoms }} n’est pas concerné par cette session.</div></div> }
        }
      } @else {
        <div class="card">
          <div class="card-head"><div><h2>{{ x.name }}</h2><div class="small muted">{{ typeLabel(x.type) }} · du {{ dateFr(x.start) }} au {{ dateFr(x.end) }}</div></div>
            @if (s.can('examens.write')) {
              <div class="row">
                @if (x.status === 'publié') { <button type="button" class="btn" (click)="confirm.set('draft')">Repasser en brouillon</button> }
                @else { <button type="button" class="btn primary" (click)="confirm.set('publish')"><app-icon name="upload" [size]="16" /> Publier les résultats</button> }
              </div>
            }</div>
          <div class="tabs" role="tablist">
            <button type="button" class="tab" role="tab" [class.on]="tab() === 'resultats'" [attr.aria-selected]="tab() === 'resultats'" (click)="tab.set('resultats')">Résultats</button>
            @if (canEnter()) { <button type="button" class="tab" role="tab" [class.on]="tab() === 'saisie'" [attr.aria-selected]="tab() === 'saisie'" (click)="tab.set('saisie')">Saisie des notes</button> }
            <button type="button" class="tab" role="tab" [class.on]="tab() === 'coefs'" [attr.aria-selected]="tab() === 'coefs'" (click)="tab.set('coefs')">Coefficients</button>
          </div>

          @if (tab() === 'resultats' || (tab() === 'saisie' && !canEnter())) {
            <div class="card-body stack">
              @if (x.status !== 'publié') { <div class="banner warn"><app-icon name="lock" [size]="18" /> Résultats provisoires : les familles ne les voient pas tant que la session n’est pas publiée.</div> }
              @if (classes().length > 1) { <div class="chips" role="group" aria-label="Classe">@for (c of classes(); track c) { <button type="button" class="chip" [class.on]="cls() === c" (click)="clsSel.set(c)">{{ s.className(c) }}</button> }</div> }
              <div class="grid kpi">
                <div class="card kpi-card"><span class="label">Élèves classés</span><span class="value">{{ res().complete }} / {{ res().effectif }}</span></div>
                <div class="card kpi-card"><span class="label">Moyenne de la classe</span><span class="value">{{ res().avg === null ? '—' : fnum(res().avg) }}</span></div>
                <div class="card kpi-card"><span class="label">Meilleure · plus faible</span><span class="value">{{ res().max === null ? '—' : fnum(res().max) + ' · ' + fnum(res().min) }}</span></div>
                <div class="card kpi-card"><span class="label">Taux d’admissibilité</span><span class="value">{{ res().rate === null ? '—' : res().rate + ' %' }}</span><span class="hint">{{ res().admis }} élève(s) à 10 / 20 ou plus</span></div>
              </div>
              <div class="table-wrap"><table class="table hover"><thead><tr><th class="num">Rang</th><th>Élève</th>
                @for (sb of res().subjects; track sb.id) { <th class="num" [title]="sb.name">{{ sb.short }}<div class="tiny">coef {{ sb.coef }}</div></th> }
                <th class="num">Moyenne / 20</th><th>Mention</th><th>Admissibilité</th></tr></thead><tbody>
                @for (r of ordered(); track r.studentId) {
                  <tr><td class="num">{{ r.rank === null ? '—' : r.rank }}</td><td class="cell-main nowrap">{{ s.studentName(r.studentId) }}</td>
                    @for (m of r.marks; track $index) { <td class="num">{{ m === null ? '—' : fnum(m) }}</td> }
                    <td class="num"><b>{{ r.avg === null ? '—' : fnum(r.avg) }}</b></td>
                    <td>{{ r.mention }}</td>
                    <td>@if (r.admissible === null) { <span class="pill warn">{{ r.filled }} / {{ res().subjects.length }} notes</span> } @else if (r.admissible) { <span class="pill ok">Admissible</span> } @else { <span class="pill bad">Non admissible</span> }</td></tr>
                } @empty { <tr><td [attr.colspan]="res().subjects.length + 5" class="empty">Aucun élève dans cette classe.</td></tr> }</tbody></table></div>
            </div>
          }

          @if (tab() === 'saisie' && canEnter()) {
            <div class="card-body stack">
              @if (x.status === 'publié') { <div class="banner info"><app-icon name="lock" [size]="18" /> Les résultats sont publiés : la saisie est verrouillée.@if (s.can('examens.write')) { Repassez la session en brouillon pour corriger une note. }</div> }
              <div class="card flat"><div class="table-wrap"><table class="table"><thead><tr><th>Avancement de la saisie</th>@for (sb of allSubjects(); track sb.id) { <th class="num">{{ sb.short }}</th> }</tr></thead><tbody>
                @for (c of classes(); track c) {
                  <tr><td class="cell-main">{{ s.className(c) }}</td>
                    @for (sb of allSubjects(); track sb.id) {
                      <td class="num">@if (hasSubject(c, sb.id)) { <span class="pill" [class.ok]="done(c, sb.id).done === done(c, sb.id).total" [class.warn]="done(c, sb.id).done < done(c, sb.id).total">{{ done(c, sb.id).done }} / {{ done(c, sb.id).total }}</span> } @else { <span class="muted">—</span> }</td>
                    }</tr>
                }</tbody></table></div></div>
              <div class="form-grid" style="max-width:520px">
                <label class="field"><span>Classe</span><select [ngModel]="cls()" (ngModelChange)="clsSel.set($event); typed.set({})">@for (c of classes(); track c) { <option [value]="c">{{ s.className(c) }}</option> }</select></label>
                <label class="field"><span>Matière</span><select [ngModel]="subj()" (ngModelChange)="subjSel.set($event); typed.set({})">@for (sb of editable(); track sb.id) { <option [value]="sb.id">{{ sb.name }}</option> }</select></label>
              </div>
              @if (editable().length === 0) { <div class="empty">Vous n’enseignez aucune matière évaluée dans cette classe.</div> }
              @else {
                <div class="table-wrap"><table class="table"><thead><tr><th class="num" style="width:50px">N°</th><th>Élève</th><th class="num">Note / 20</th></tr></thead><tbody>
                  @for (st of students(); track st.id; let i = $index) {
                    <tr><td class="num muted">{{ i + 1 }}</td><td class="cell-main">{{ st.nom }} {{ st.prenoms }}</td>
                      <td class="num"><input class="inline-input" inputmode="decimal" autocomplete="off" [disabled]="x.status === 'publié'" [attr.aria-label]="'Note de ' + st.nom + ' ' + st.prenoms" [class.bad-input]="bad().has(st.id)"
                        [ngModel]="val(st.id)" (ngModelChange)="setTyped(st.id, $event)" [name]="'n' + st.id" /></td></tr>
                  }</tbody></table></div>
                @if (bad().size) { <div class="banner bad" role="alert"><app-icon name="alert" [size]="18" /> Une note doit être comprise entre 0 et 20.</div> }
                <div class="row" style="justify-content:flex-end"><button type="button" class="btn primary" [disabled]="x.status === 'publié'" (click)="saveMarks()">Enregistrer les notes</button></div>
              }
            </div>
          }

          @if (tab() === 'coefs') {
            <div class="card-body stack">
              <div class="banner info"><app-icon name="alert" [size]="18" /> Coefficients fixés à la création de la session (repris du type d’examen, puis ajustés).</div>
              <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th>@for (col of sessCols(); track col) { <th class="num">{{ colLabel(col) }}</th> }</tr></thead><tbody>
                @for (sb of s.subjects(); track sb.id) {
                  @if (usedSubject(sb.id)) { <tr><td class="cell-main">{{ sb.name }}</td>@for (col of sessCols(); track col) { <td class="num">{{ x.coefs[col]?.[sb.id] || '—' }}</td> }</tr> }
                }</tbody></table></div>
            </div>
          }
        </div>
      }
    }
    }
  </div>

  @if (creating()) {
    <app-modal title="Nouvelle session d’examen blanc" size="xl" (closed)="creating.set(false)">
      <div class="stack">
        <div class="form-grid">
          <label class="field"><span>Nom de la session</span><input [ngModel]="fName()" (ngModelChange)="fName.set($event)" name="nm" />
            @if (touched() && fName().trim().length < 3) { <span class="err">Donnez un nom à la session</span> }</label>
          <div class="field"><span>Examen préparé</span><div class="chips" role="group" aria-label="Type d’examen">
            @for (k of activeKinds(); track k.id) { <button type="button" class="chip" [class.on]="fKind() === k.id" (click)="setType(k.id)">{{ k.name }} ({{ k.levels.join(', ') }})</button> }
            <button type="button" class="chip" [class.on]="fKind() === ''" (click)="setType('')">Autre examen</button></div>
            @if (fKind() === '') { <span class="tiny muted">Donnez-lui le nom de votre choix, puis choisissez les classes et les coefficients.</span> }
            @else if (missingCols().length) { <span class="tiny" style="color:var(--warn)">Pas de coefficients enregistrés pour {{ missingCols().join(', ') }} : saisissez-les ci-dessous.</span> }</div>
          <label class="field"><span>Du</span><input type="date" [ngModel]="fStart()" (ngModelChange)="fStart.set($event)" name="d1" /></label>
          <label class="field"><span>Au</span><input type="date" [ngModel]="fEnd()" (ngModelChange)="fEnd.set($event)" name="d2" />
            @if (touched() && (!fStart() || !fEnd() || fEnd() < fStart())) { <span class="err">La fin doit suivre le début</span> }</label>
        </div>
        <div class="field"><span>Classes concernées</span><div class="chips" role="group" aria-label="Classes concernées">
          @for (c of eligibleClasses(); track c.id) { <button type="button" class="chip" [class.on]="fClasses().includes(c.id)" [attr.aria-pressed]="fClasses().includes(c.id)" (click)="toggleClass(c.id)">{{ c.name }}</button> }</div>
          @if (touched() && fClasses().length === 0) { <span class="err">Choisissez au moins une classe</span> }</div>
        <div class="field"><span>Coefficients par matière (0 : matière non évaluée)</span>
          <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th>@for (col of cols(); track col) { <th class="num">{{ colLabel(col) }}</th> }</tr></thead><tbody>
            @for (sb of s.subjects(); track sb.id) {
              <tr><td class="cell-main">{{ sb.name }}</td>@for (col of cols(); track col) { <td class="num"><input class="inline-input" type="number" min="0" max="10" step="1" [ngModel]="coefVal(col, sb.id)" (ngModelChange)="setCoef(col, sb.id, $event)" [name]="'c' + col + sb.id" [attr.aria-label]="'Coefficient ' + sb.name + ' ' + colLabel(col)" /></td> }</tr>
            }</tbody></table></div>
          <span class="tiny muted">Valeurs reprises du type d’examen : ajustez-les pour cette session si besoin.</span>
          @if (touched() && !coefsOk()) { <span class="err">Chaque colonne doit contenir au moins une matière avec un coefficient</span> }</div>
      </div>
      <div footer><button type="button" class="btn ghost" (click)="creating.set(false)">Annuler</button><button type="button" class="btn primary" (click)="create()">Créer la session</button></div>
    </app-modal>
  }
  @if (kindForm(); as f) {
    <app-modal [title]="f.id ? 'Modifier l’examen ' + f.name : 'Nouvel examen'" size="xl" (closed)="kindForm.set(null)">
      <div class="stack">
        <div class="form-grid">
          <label class="field"><span>Nom de l’examen</span><input [(ngModel)]="f.name" name="kn" maxlength="40" placeholder="BEPC, BAC, DEF, CEP, Brevet…" /></label>
          <div class="field"><span>Coefficients</span><div class="chips">
            <button type="button" class="chip" [class.on]="!f.perSerie" (click)="f.perSerie = false; kindCols.set(colsFor(f))">Une liste pour toutes les classes</button>
            <button type="button" class="chip" [class.on]="f.perSerie" (click)="f.perSerie = true; kindCols.set(colsFor(f))">Une liste par série</button></div></div>
        </div>
        <div class="field"><span>Niveaux concernés</span><div class="chips">
          @for (lv of allLevels(); track lv) { <button type="button" class="chip" [class.on]="f.levels.includes(lv)" (click)="toggleLevel(f, lv)">{{ lv }}</button> }</div>
          <div class="row" style="margin-top:6px"><input [(ngModel)]="extraLevel" name="xl" maxlength="10" placeholder="Autre niveau (ex. 9e)" style="max-width:200px" /><button type="button" class="btn sm" (click)="addLevel(f)">Ajouter</button></div></div>
        <div class="field"><span>Coefficients par matière (0 : matière non évaluée)</span>
          @if (f.perSerie && !kindCols().length) { <span class="tiny muted">Choisissez un niveau qui a des séries (Paramètres > Séries du lycée).</span> }
          <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th>@for (col of kindCols(); track col) { <th class="num">{{ colLabel(col) }}
            @if (kindCols().length > 1) { <select class="tiny" style="display:block;margin-top:4px" (change)="copyCol(f, $any($event.target).value, col); $any($event.target).value = ''"><option value="">Copier…</option>@for (o of kindCols(); track o) { @if (o !== col) { <option [value]="o">depuis {{ colLabel(o) }}</option> } }</select> }</th> }</tr></thead><tbody>
            @for (sb of s.subjects(); track sb.id) {
              <tr><td class="cell-main">{{ sb.name }}</td>@for (col of kindCols(); track col) { <td class="num"><input class="inline-input" type="number" min="0" max="20" [ngModel]="f.coefs[col]?.[sb.id] ?? 0" (ngModelChange)="setKindCoef(f, col, sb.id, $event)" [name]="'k' + col + sb.id" [attr.aria-label]="'Coefficient ' + sb.name + ' ' + colLabel(col)" /></td> }</tr>
            }</tbody></table></div>
          <span class="tiny muted">Saisissez les coefficients officiels de l’examen dans votre pays. Ils seront proposés à chaque nouvelle session, qui peut encore les ajuster.</span></div>
        @if (kindErr()) { <div class="banner bad">{{ kindErr() }}</div> }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="kindForm.set(null)">Annuler</button><button type="button" class="btn primary" (click)="saveKind(f)">{{ f.id ? 'Enregistrer' : 'Ajouter l’examen' }}</button></div>
    </app-modal>
  }
  @if (askRemoveKind(); as k) {
    <app-modal [title]="'Retirer l’examen ' + k.name" (closed)="askRemoveKind.set(null)">
      <p>« {{ k.name }} » ne sera plus proposé. Aucune session ne l’utilise.</p>
      <div footer><button type="button" class="btn ghost" (click)="askRemoveKind.set(null)">Annuler</button><button type="button" class="btn danger" (click)="removeKind(k)">Retirer</button></div>
    </app-modal>
  }
  @if (confirm(); as c) {
    <app-modal [title]="c === 'publish' ? 'Publier les résultats' : 'Repasser en brouillon'" (closed)="confirm.set(null)">
      @if (c === 'publish') {
        <p>Les parents et les élèves des classes concernées pourront consulter leurs résultats et seront prévenus par notification.</p>
        @if (sess() && mx.missingMarks(sess()!) > 0) { <div class="banner warn" style="margin-top:12px"><app-icon name="alert" [size]="18" /> {{ mx.missingMarks(sess()!) }} note(s) ne sont pas encore saisies. Les élèves concernés verront un résultat incomplet.</div> }
      } @else { <p>Les familles ne verront plus les résultats et la saisie des notes sera de nouveau possible.</p> }
      <div footer><button type="button" class="btn ghost" (click)="confirm.set(null)">Annuler</button><button type="button" class="btn primary" (click)="applyConfirm()">{{ c === 'publish' ? 'Publier' : 'Repasser en brouillon' }}</button></div>
    </app-modal>
  }`,
  styles: `
    button.sess { text-align: start; display: flex; flex-direction: column; gap: 4px; cursor: pointer; font: inherit; color: inherit; }
    button.sess:hover { border-color: var(--brand); }
    button.sess.sel { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-tint), inset 4px 0 0 var(--brand); }
    .bad-input { border-color: var(--bad) !important; }
    .card-body .card.flat { overflow: hidden; }
  `,
})
export class ExamensPage {
  readonly typeLabel = typeLabel;
  readonly view = signal<'sessions' | 'types'>('sessions');
  readonly s = inject(Store);
  readonly mx = inject(MockExams);
  constructor() { void this.mx.load(); }
  readonly dateFr = dateFr; readonly fnum = fnum; readonly rangLabel = rangLabel; readonly colLabel = columnLabel;

  readonly isFamily = computed(() => this.s.role() === 'parent' || this.s.role() === 'eleve');
  readonly kid = computed(() => (this.isFamily() ? this.s.activeChild() : null));
  readonly intro = computed(() => {
    if (this.isFamily()) return 'Résultats des examens blancs (BEPC blanc, BAC blanc), publiés par la direction.';
    if (this.s.role() === 'enseignant') return 'Saisissez les notes de votre matière et consultez les résultats de vos classes.';
    return 'Organisez les examens blancs, suivez la saisie des notes et publiez les résultats aux familles.';
  });

  readonly sessions = computed(() => {
    const all = this.mx.sessions();
    if (this.isFamily()) { const k = this.kid(); return all.filter((x) => x.status === 'publié' && !!k && x.classIds.includes(k.classId)); }
    if (this.s.role() === 'enseignant') { const mine = new Set(this.s.myClassIds()); return all.filter((x) => x.classIds.some((c) => mine.has(c))); }
    return all;
  });
  readonly selId = signal<string | null>(null);
  readonly sess = computed<MockSession | undefined>(() => this.sessions().find((x) => x.id === this.selId()) ?? this.sessions()[0]);
  readonly tab = signal<Tab>('resultats');
  pick(id: string): void { this.selId.set(id); this.clsSel.set(''); this.typed.set({}); this.subjSel.set(''); }

  classNames = (x: MockSession): string => x.classIds.filter((c) => this.s.classById().has(c)).map((c) => this.s.className(c)).join(', ');

  readonly classes = computed(() => {
    const x = this.sess();
    if (!x) return [];
    if (this.s.role() === 'enseignant') { const mine = new Set(this.s.myClassIds()); return x.classIds.filter((c) => mine.has(c)); }
    return x.classIds;
  });
  readonly clsSel = signal('');
  readonly cls = computed(() => {
    const k = this.kid();
    if (k) return k.classId;
    return this.classes().includes(this.clsSel()) ? this.clsSel() : this.classes()[0] ?? '';
  });
  readonly res = computed(() => {
    const x = this.sess();
    return x && this.cls() ? this.mx.result(x, this.cls()) : { subjects: [], rows: [], effectif: 0, complete: 0, avg: null, max: null, min: null, admis: 0, rate: null };
  });
  readonly ordered = computed(() => [...this.res().rows].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || this.s.studentName(a.studentId).localeCompare(this.s.studentName(b.studentId))));
  readonly kidRow = computed(() => { const k = this.kid(); return k ? this.res().rows.find((r) => r.studentId === k.id) : undefined; });

  // --- Saisie des notes ---
  readonly canEnter = computed(() => this.s.role() === 'enseignant' || this.s.can('examens.write'));
  readonly typed = signal<Record<string, string>>({});
  readonly subjSel = signal('');
  readonly bad = signal<Set<string>>(new Set());
  readonly students = computed(() => this.s.studentsByClass().get(this.cls()) ?? []);
  readonly allSubjects = computed(() => {
    const x = this.sess();
    const m = new Map<string, { id: string; short: string }>();
    if (x) for (const c of this.classes()) for (const sb of this.mx.subjectsFor(x, c)) m.set(sb.id, sb);
    return [...m.values()];
  });
  hasSubject = (c: string, sb: string): boolean => !!this.sess() && this.mx.subjectsFor(this.sess()!, c).some((x) => x.id === sb);
  done = (c: string, sb: string) => this.mx.progress(this.sess()!, c, sb);
  readonly editable = computed(() => {
    const x = this.sess();
    if (!x || !this.cls()) return [];
    const subs = this.mx.subjectsFor(x, this.cls());
    if (this.s.can('examens.write')) return subs;
    const mine = new Set(this.s.myAssignments().filter((a) => a.classId === this.cls()).map((a) => a.subjectId));
    return subs.filter((sb) => mine.has(sb.id));
  });
  readonly subj = computed(() => (this.editable().some((e) => e.id === this.subjSel()) ? this.subjSel() : this.editable()[0]?.id ?? ''));
  val(studentId: string): string {
    const t = this.typed()[studentId];
    if (t !== undefined) return t;
    const v = this.sess()?.marks[markKey(studentId, this.subj())];
    return v === undefined ? '' : String(v).replace('.', ',');
  }
  setTyped(id: string, v: string): void {
    this.typed.update((t) => ({ ...t, [id]: v }));
    if (this.bad().has(id)) this.bad.update((b) => { const n = new Set(b); n.delete(id); return n; });
  }
  async saveMarks(): Promise<void> {
    const x = this.sess();
    if (!x || x.status === 'publié' || !this.subj()) return;
    if (!this.editable().some((e) => e.id === this.subj())) { this.s.toast('Vous ne pouvez saisir que les notes de votre matière.', 'err'); return; }
    const values: Record<string, number | null> = {};
    const errs = new Set<string>();
    for (const [id, t] of Object.entries(this.typed())) {
      const p = parseNote(t);
      if (p === 'err') errs.add(id); else values[id] = p;
    }
    this.bad.set(errs);
    if (errs.size) return;
    if (this.s.apiMode()) {
      const err = await this.mx.saveMarksAsync(x.id, this.cls(), this.subj(), values);
      if (err) { this.s.toast(err, 'err'); return; }
    } else this.mx.saveMarks(x.id, this.cls(), this.subj(), values);
    this.typed.set({});
    this.s.toast('Notes enregistrées.');
  }

  // --- Publication ---
  readonly confirm = signal<'publish' | 'draft' | null>(null);
  async applyConfirm(): Promise<void> {
    const x = this.sess(); const c = this.confirm();
    if (!x || !c) return;
    if (this.s.apiMode()) {
      const err = await this.mx.setStatusAsync(x.id, c === 'publish' ? 'publié' : 'brouillon');
      if (err) { this.s.toast(err, 'err'); return; }
    } else this.mx.setStatus(x.id, c === 'publish' ? 'publié' : 'brouillon');
    this.confirm.set(null);
    this.s.toast(c === 'publish' ? 'Résultats publiés. Les familles sont prévenues.' : 'Session repassée en brouillon.');
  }

  readonly sessCols = computed(() => Object.keys(this.sess()?.coefs ?? {}).sort());
  usedSubject = (id: string): boolean => this.sessCols().some((c) => (this.sess()?.coefs[c]?.[id] ?? 0) > 0);

  // --- Création d'une session ---
  readonly creating = signal(false);
  readonly touched = signal(false);
  readonly fName = signal('');
  /** Type d'examen choisi ('' : « Autre examen »). */
  readonly fKind = signal('');
  readonly kind = computed(() => this.mx.kindById(this.fKind() || undefined));
  readonly activeKinds = computed(() => this.mx.kinds().filter((k) => k.active));
  readonly fStart = signal(this.s.today);
  readonly fEnd = signal(addDays(this.s.today, 4));
  readonly fClasses = signal<string[]>([]);
  readonly edits = signal<Record<string, number>>({});
  readonly eligibleClasses = computed(() => this.s.classes().filter((c) => eligible(this.kind(), c)));
  readonly cols = computed(() => {
    if (!this.kind()?.perSerie) return ['*'];
    return [...new Set(this.fClasses().map((id) => columnOf(true, this.s.classById().get(id)!)))].sort();
  });
  /** Colonnes sans coefficients enregistrés sur le type d'examen : à saisir. */
  readonly missingCols = computed(() => { const k = this.kind(); return k ? this.cols().filter((c) => !k.coefs[c]).map((c) => this.colLabel(c)) : []; });
  coefVal(col: string, sb: string): number {
    return this.edits()[`${col}|${sb}`] ?? this.kind()?.coefs[col]?.[sb] ?? 0;
  }
  setCoef(col: string, sb: string, v: number | string | null): void {
    const n = Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
    this.edits.update((e) => ({ ...e, [`${col}|${sb}`]: n }));
  }
  coefsOk = computed(() => this.fClasses().length > 0 && this.cols().every((col) => this.s.subjects().some((sb) => this.coefVal(col, sb.id) > 0)));
  openNew(): void {
    this.touched.set(false);
    this.setType(this.activeKinds()[0]?.id ?? '');
    this.fStart.set(this.s.today); this.fEnd.set(addDays(this.s.today, 4));
    this.creating.set(true);
  }
  setType(kindId: string): void {
    this.fKind.set(kindId);
    this.edits.set({});
    const k = this.kind();
    this.fClasses.set(k ? this.s.classes().filter((c) => eligible(k, c)).map((c) => c.id) : []);
    const n = k ? this.mx.sessions().filter((x) => x.kindId === k.id).length + 1 : 0;
    this.fName.set(k ? `${k.name} blanc n°${n}` : '');
  }

  // --- Types d'examen ---
  readonly kindForm = signal<KindForm | null>(null);
  readonly kindCols = signal<string[]>([]);
  readonly kindErr = signal('');
  readonly askRemoveKind = signal<ExamKind | null>(null);
  extraLevel = '';
  private readonly addedLevels = signal<string[]>([]);
  /** Niveaux proposés : ceux des classes de l'école, les niveaux habituels, et ceux saisis. */
  readonly allLevels = computed(() => {
    const std = this.s.levelNames();
    const set = new Set([...std, ...this.s.classes().map((c) => c.level), ...this.mx.kinds().flatMap((k) => k.levels), ...this.addedLevels()]);
    return [...set].sort((a, b) => (std.indexOf(a) + 1 || 99) - (std.indexOf(b) + 1 || 99) || a.localeCompare(b));
  });
  kindCoefsSummary(k: ExamKind): string {
    const cols = Object.keys(k.coefs);
    if (!cols.length) return 'Coefficients à saisir';
    return cols.map((c) => `${c === '*' ? '' : c + ' : '}${Object.keys(k.coefs[c]).length} matière(s)`).join(' · ');
  }
  /** Colonnes du formulaire : « * », ou les séries des niveaux choisis (et celles déjà saisies). */
  colsFor(f: KindForm): string[] {
    if (!f.perSerie) return ['*'];
    const set = new Set([...this.s.series().filter((x) => f.levels.includes(x.level)).map((x) => x.code), ...Object.keys(f.coefs).filter((c) => c !== '*')]);
    return [...set].sort();
  }
  openKind(k: ExamKind | null): void {
    this.kindErr.set(''); this.extraLevel = '';
    const f: KindForm = k ? { id: k.id, name: k.name, levels: [...k.levels], perSerie: k.perSerie, coefs: structuredClone(k.coefs), active: k.active }
      : { id: null, name: '', levels: [], perSerie: false, coefs: {}, active: true };
    this.kindCols.set(this.colsFor(f)); this.kindForm.set(f);
  }
  toggleLevel(f: KindForm, lv: string): void {
    f.levels = f.levels.includes(lv) ? f.levels.filter((x) => x !== lv) : [...f.levels, lv];
    this.kindCols.set(this.colsFor(f));
  }
  addLevel(f: KindForm): void {
    const lv = this.extraLevel.trim();
    if (!lv) return;
    this.addedLevels.update((l) => l.includes(lv) ? l : [...l, lv]);
    if (!f.levels.includes(lv)) f.levels = [...f.levels, lv];
    this.extraLevel = ''; this.kindCols.set(this.colsFor(f));
  }
  setKindCoef(f: KindForm, col: string, sb: string, v: number | string | null): void {
    f.coefs = { ...f.coefs, [col]: { ...(f.coefs[col] ?? {}), [sb]: Math.max(0, Math.min(20, Math.round(Number(v) || 0))) } };
  }
  copyCol(f: KindForm, from: string, to: string): void {
    if (!from) return;
    f.coefs = { ...f.coefs, [to]: { ...(f.coefs[from] ?? {}) } };
    this.kindForm.set({ ...f });
  }
  async saveKind(f: KindForm): Promise<void> {
    const coefs: KindForm['coefs'] = {};
    for (const col of this.colsFor(f)) if (f.coefs[col]) coefs[col] = f.coefs[col];
    const r = await this.mx.saveKindAsync(f.id, { name: f.name, levels: f.levels, perSerie: f.perSerie, coefs, active: f.active });
    if (!r.ok) return void this.kindErr.set(r.error ?? 'Enregistrement impossible.');
    this.kindForm.set(null);
    this.s.toast(f.id ? 'Examen modifié. Les sessions déjà créées gardent leurs coefficients.' : `Examen « ${f.name.trim()} » ajouté.`);
  }
  async toggleKind(k: ExamKind): Promise<void> {
    const r = await this.mx.setKindActiveAsync(k, !k.active);
    this.s.toast(r.ok ? (k.active ? `« ${k.name} » n’est plus proposé pour les nouvelles sessions.` : `« ${k.name} » est de nouveau proposé.`) : (r.error ?? 'Impossible.'), r.ok ? 'ok' : 'err');
  }
  async removeKind(k: ExamKind): Promise<void> {
    const r = await this.mx.removeKindAsync(k);
    this.askRemoveKind.set(null);
    this.s.toast(r.ok ? `« ${k.name} » retiré.` : (r.error ?? 'Retrait impossible.'), r.ok ? 'ok' : 'err');
  }
  toggleClass(id: string): void {
    this.fClasses.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
  async create(): Promise<void> {
    this.touched.set(true);
    if (this.fName().trim().length < 3 || !this.fStart() || !this.fEnd() || this.fEnd() < this.fStart() || !this.coefsOk()) return;
    const coefs: MockSession['coefs'] = {};
    for (const col of this.cols()) {
      coefs[col] = {};
      for (const sb of this.s.subjects()) { const v = this.coefVal(col, sb.id); if (v > 0) coefs[col][sb.id] = v; }
    }
    const k = this.kind();
    const f = { name: this.fName().trim(), type: k?.name ?? 'AUTRE', kindId: k?.id, perSerie: !!k?.perSerie, start: this.fStart(), end: this.fEnd(), classIds: this.fClasses(), coefs };
    let created: { id: string };
    if (this.s.apiMode()) {
      const r = await this.mx.createAsync(f);
      if (!r.id) { this.s.toast(r.error ?? 'Création impossible.', 'err'); return; }
      created = { id: r.id };
    } else created = this.mx.create(f);
    this.creating.set(false);
    this.selId.set(created.id); this.tab.set('resultats'); this.clsSel.set('');
    this.s.toast('Session créée. Les enseignants concernés sont prévenus.');
  }
}
