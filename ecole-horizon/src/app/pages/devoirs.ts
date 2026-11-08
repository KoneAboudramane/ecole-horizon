import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal } from '../ui';
import {
  Attempt, AttemptQuestion, Homework, HwForm, HwKind, HwMine, HwQuestion, Homeworks, Results, ReviewItem, mmss, toInput,
} from '../modules/homework';

type Tab = 'sujet' | 'copies';
type Filter = 'tous' | 'afaire' | 'faits' | 'brouillons' | 'encours' | 'fermes';

const p2 = (n: number) => String(n).padStart(2, '0');
const when = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} à ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const blankQ = (kind: 'qcm' | 'vf'): HwQuestion => ({ kind, text: '', choices: kind === 'qcm' ? ['', '', '', ''] : ['Vrai', 'Faux'], correct: [], points: 1 });

@Component({
  selector: 'app-devoirs',
  imports: [FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Devoirs et épreuves</h1><p>{{ intro() }}</p></div>
      @if (isTeacher() && !sel()) { <button type="button" class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Nouveau devoir</button> }</div>

    @if (!sel()) {
      <div class="chips" role="group" aria-label="Filtrer">
        @for (f of filters(); track f.id) { <button type="button" class="chip" [class.on]="filter() === f.id" [attr.aria-pressed]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}</button> }
      </div>
      @if (shown().length === 0) {
        <div class="card"><div class="empty">{{ hw.loaded() ? (isTeacher() ? 'Aucun devoir pour le moment. Cliquez sur « Nouveau devoir » pour en envoyer un à l’une de vos classes.' : 'Aucun devoir pour le moment.') : 'Chargement…' }}</div></div>
      } @else {
        <div class="grid three" role="list" aria-label="Devoirs">
          @for (h of shown(); track h.id) {
            <button type="button" role="listitem" class="card pad item" (click)="open(h)">
              <div class="row" style="justify-content:space-between;gap:8px">
                <span class="pill brand">{{ h.kind === 'epreuve' ? 'Épreuve en ligne' : 'Devoir à rendre' }}</span>
                <span class="pill" [class.ok]="state(h).tone === 'ok'" [class.warn]="state(h).tone === 'warn'" [class.bad]="state(h).tone === 'bad'">{{ state(h).label }}</span>
              </div>
              <b>{{ h.title }}</b>
              <span class="small muted">{{ h.subjectName }} · {{ s.className(h.classId) }}</span>
              <span class="small muted">À rendre avant le {{ when(h.dueAt) }}</span>
              @if (isStaff()) { <span class="small">{{ h.counts?.rendus ?? 0 }} / {{ h.counts?.students ?? 0 }} rendus · {{ h.counts?.corriges ?? 0 }} notés</span> }
              @else if (scoreOf(h) !== null) { <span class="small"><b>Note : {{ scoreOf(h) }} / {{ h.totalPoints }}</b></span> }
            </button>
          }
        </div>
      }
    } @else {
      @if (sel(); as h) {
      <button type="button" class="btn ghost back" (click)="close()"><app-icon name="chevron" [size]="14" class="flip" /> Tous les devoirs</button>
      <div class="card">
        <div class="card-head"><div><h2>{{ h.title }}</h2>
          <div class="small muted">{{ h.subjectName }} · {{ s.className(h.classId) }} · {{ h.kind === 'epreuve' ? 'Épreuve en ligne' : 'Devoir à rendre en fichier' }}</div></div>
          <span class="pill" [class.ok]="state(h).tone === 'ok'" [class.warn]="state(h).tone === 'warn'" [class.bad]="state(h).tone === 'bad'">{{ state(h).label }}</span></div>

        @if (isTeacher()) {
          <div class="tabs" role="tablist">
            <button type="button" class="tab" role="tab" [class.on]="tab() === 'sujet'" [attr.aria-selected]="tab() === 'sujet'" (click)="tab.set('sujet')">Sujet</button>
            <button type="button" class="tab" role="tab" [class.on]="tab() === 'copies'" [attr.aria-selected]="tab() === 'copies'" [disabled]="!h.published" (click)="showCopies()">Copies et résultats</button>
          </div>
        }

        <div class="card-body stack">
          @if (!isTeacher() || tab() === 'sujet') {
            <dl class="facts">
              <div><dt>Ouvert le</dt><dd>{{ when(h.opensAt) }}</dd></div>
              <div><dt>À rendre avant le</dt><dd>{{ when(h.dueAt) }}</dd></div>
              @if (h.kind === 'epreuve') { <div><dt>Durée</dt><dd>{{ h.durationMin }} minutes</dd></div><div><dt>Questions</dt><dd>{{ h.questionCount }} · {{ h.totalPoints }} points</dd></div><div><dt>Sorties de la page</dt><dd>{{ h.maxLeaves ? h.maxLeaves + ' au plus' : 'sans limite' }}</dd></div> }
              @else { <div><dt>Barème</dt><dd>sur {{ h.maxPoints }}</dd></div><div><dt>Retard</dt><dd>{{ h.allowLate ? 'accepté (signalé)' : 'refusé' }}</dd></div> }
              <div><dt>Enseignant</dt><dd>{{ h.teacherName || '—' }}</dd></div>
            </dl>
            @if (h.instructions) { <div class="consigne">{{ h.instructions }}</div> }
            @if (h.hasAttachment) { <div class="row"><button type="button" class="btn" (click)="hw.downloadAttachment(h)"><app-icon name="download" [size]="16" /> Télécharger le sujet ({{ h.attachmentName }})</button></div> }
          }

          <!-- ============ ENSEIGNANT : sujet ============ -->
          @if (isTeacher() && tab() === 'sujet') {
            @if (!h.published) { <div class="banner info"><app-icon name="lock" [size]="18" /> Brouillon : la classe ne voit rien tant que vous n’avez pas cliqué sur « Envoyer à la classe ».</div> }
            @if (locked(h)) { <div class="banner warn"><app-icon name="alert" [size]="18" /> Des élèves ont déjà commencé ou rendu : les questions, la durée et le barème ne peuvent plus changer.</div> }
            <div class="row" style="flex-wrap:wrap">
              <button type="button" class="btn" (click)="openEdit(h)">Modifier les réglages</button>
              <label class="btn" [class.disabled]="busy()">{{ h.hasAttachment ? 'Remplacer le sujet joint' : 'Joindre un sujet (PDF, image, Word)' }}
                <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.odt,.txt" (change)="onAttach($event)" /></label>
              @if (h.hasAttachment) { <button type="button" class="btn ghost" (click)="detach(h)">Retirer le sujet joint</button> }
              @if (!h.published) { <button type="button" class="btn primary" (click)="askSend.set(true)"><app-icon name="upload" [size]="16" /> Envoyer à la classe</button> }
              @if (!h.counts?.rendus && !h.counts?.en_cours) { <button type="button" class="btn ghost danger" (click)="askDelete.set(true)">Supprimer</button> }
            </div>

            @if (h.kind === 'epreuve') {
              <h3>Questions</h3>
              @for (q of qs(); track $index; let i = $index) {
                <fieldset class="qedit" [disabled]="locked(h)">
                  <legend>Question {{ i + 1 }} · {{ q.kind === 'vf' ? 'Vrai ou faux' : 'QCM' }}</legend>
                  <label class="field"><span>Énoncé</span><textarea rows="2" [ngModel]="q.text" (ngModelChange)="setQ(i, { text: $event })" [name]="'qt' + i"></textarea></label>
                  @if (q.kind === 'qcm') {
                    <div class="stack tight">
                      @for (c of q.choices; track $index; let j = $index) {
                        <div class="choice-row">
                          <input type="checkbox" [checked]="q.correct.includes(j)" (change)="toggleCorrect(i, j)" [attr.aria-label]="'Bonne réponse : proposition ' + (j + 1)" />
                          <input class="inline-input grow" [ngModel]="c" (ngModelChange)="setChoice(i, j, $event)" [name]="'qc' + i + '_' + j" [attr.aria-label]="'Proposition ' + (j + 1)" placeholder="Proposition {{ j + 1 }}" />
                          @if (q.choices.length > 2) { <button type="button" class="btn ghost sm" (click)="delChoice(i, j)" aria-label="Retirer la proposition"><app-icon name="x" [size]="14" /></button> }
                        </div>
                      }
                      @if (q.choices.length < 8) { <button type="button" class="btn ghost sm" (click)="addChoice(i)"><app-icon name="plus" [size]="14" /> Ajouter une proposition</button> }
                      <span class="tiny muted">Cochez la ou les bonnes réponses. Plusieurs cases cochées : l’élève doit toutes les trouver pour avoir les points.</span>
                    </div>
                  } @else {
                    <div class="row"><label class="row"><input type="radio" [name]="'vf' + i" [checked]="q.correct[0] === 0" (change)="setQ(i, { correct: [0] })" /> Vrai</label>
                      <label class="row"><input type="radio" [name]="'vf' + i" [checked]="q.correct[0] === 1" (change)="setQ(i, { correct: [1] })" /> Faux</label></div>
                  }
                  <div class="row" style="justify-content:space-between;flex-wrap:wrap">
                    <label class="field inline"><span>Points</span><input class="inline-input" type="number" min="0.25" max="20" step="0.25" [ngModel]="q.points" (ngModelChange)="setQ(i, { points: +$event })" [name]="'qp' + i" /></label>
                    <button type="button" class="btn ghost sm" (click)="delQ(i)">Supprimer la question</button>
                  </div>
                </fieldset>
              } @empty { <div class="empty">Aucune question. Ajoutez un QCM ou une question vrai ou faux.</div> }
              @if (!locked(h)) {
                <div class="row" style="flex-wrap:wrap">
                  <button type="button" class="btn" (click)="addQ('qcm')"><app-icon name="plus" [size]="14" /> Ajouter un QCM</button>
                  <button type="button" class="btn" (click)="addQ('vf')"><app-icon name="plus" [size]="14" /> Ajouter un vrai ou faux</button>
                  <button type="button" class="btn primary" [disabled]="busy()" (click)="saveQs()">Enregistrer les questions</button>
                </div>
                <span class="tiny muted">Total : {{ totalQ() }} point(s). Les élèves verront l’ordre des questions et des réponses {{ h.shuffle ? 'mélangé' : 'dans l’ordre saisi' }}.</span>
              }
            }
          }

          <!-- ============ ENSEIGNANT / DIRECTION : copies ============ -->
          @if (isStaff() && (tab() === 'copies' || !isTeacher())) {
            @if (!isTeacher()) { <h3>Copies et résultats</h3> }
            @if (res(); as r) {
              <div class="grid kpi">
                <div class="card kpi-card"><span class="label">Copies rendues</span><span class="value">{{ h.counts?.rendus ?? 0 }} / {{ h.counts?.students ?? 0 }}</span></div>
                <div class="card kpi-card"><span class="label">Notées</span><span class="value">{{ h.counts?.corriges ?? 0 }}</span></div>
                <div class="card kpi-card"><span class="label">Moyenne</span><span class="value">{{ r.average === null ? '—' : r.average + ' / ' + r.max }}</span></div>
                @if (h.kind === 'epreuve') { <div class="card kpi-card"><span class="label">En cours</span><span class="value">{{ h.counts?.en_cours ?? 0 }}</span></div> }
              </div>
              <div class="table-wrap"><table class="table"><thead><tr><th>Élève</th><th>État</th><th>Rendu le</th>@if (h.kind === 'epreuve') { <th class="num">Sorties</th> }<th class="num">Note / {{ r.max }}</th><th>Commentaire</th><th></th></tr></thead><tbody>
                @for (x of r.rows; track x.student) {
                  <tr>
                    <td class="cell-main nowrap">{{ x.name }}</td>
                    <td><span class="pill" [class.ok]="x.status === 'corrige' || x.status === 'termine'" [class.warn]="x.status === 'en_cours' || (x.status === 'rendu')" [class.bad]="x.late">{{ rowLabel(x) }}</span></td>
                    <td class="small">{{ when(x.finishedAt || x.submittedAt) }}</td>
                    @if (h.kind === 'epreuve') { <td class="num"><span class="pill" [class.bad]="x.leaves > 0" [class.ok]="x.leaves === 0 && !!x.startedAt">{{ x.startedAt ? x.leaves : '—' }}</span></td> }
                    <td class="num"><input class="inline-input" inputmode="decimal" autocomplete="off" [disabled]="!isTeacher()" [attr.aria-label]="'Note de ' + x.name" [class.bad-input]="badScore(x.student)" [ngModel]="edit(x.student).score" (ngModelChange)="setEdit(x.student, { score: $event })" [name]="'n' + x.student" /></td>
                    <td><input class="inline-input wide" [disabled]="!isTeacher()" [attr.aria-label]="'Commentaire pour ' + x.name" [ngModel]="edit(x.student).feedback" (ngModelChange)="setEdit(x.student, { feedback: $event })" [name]="'f' + x.student" maxlength="500" /></td>
                    <td class="nowrap">
                      @if (h.kind === 'fichier' && x.fileName && x.id) { <button type="button" class="btn ghost sm" (click)="hw.downloadCopy(x.id, x.fileName)"><app-icon name="download" [size]="14" /> Copie</button> }
                      @if (h.kind === 'epreuve' && x.id && x.finishedAt && !x.manual) { <button type="button" class="btn ghost sm" (click)="showReview(x.id)">Réponses</button> }
                    </td>
                  </tr>
                  @if (x.comment) { <tr class="sub"><td></td><td colspan="6" class="small muted">Message de l’élève : {{ x.comment }}</td></tr> }
                }</tbody></table></div>
              @if (anyBad()) { <div class="banner bad" role="alert"><app-icon name="alert" [size]="18" /> Une note doit être comprise entre 0 et {{ r.max }}.</div> }
              @if (isTeacher()) {
                <div class="row" style="justify-content:flex-end;flex-wrap:wrap">
                  @if (h.correction === 'manuel' && h.kind === 'epreuve') { <button type="button" class="btn" (click)="toggleCorrection(h)">{{ h.correctionOpen ? 'Fermer le corrigé aux élèves' : 'Ouvrir le corrigé aux élèves' }}</button> }
                  <button type="button" class="btn" [disabled]="busy() || !(h.counts?.corriges)" (click)="toGrades(h)">Reporter dans le carnet de notes</button>
                  <button type="button" class="btn primary" [disabled]="busy() || anyBad()" (click)="saveGrades()">Enregistrer les notes</button>
                </div>
                <span class="tiny muted">Pour un élève qui a rendu sur papier, saisissez directement sa note. Le report ramène les notes sur 20 et crée une évaluation « devoir » (non publiée) ; vous la publiez comme les autres notes.</span>
              }
              @if (h.kind === 'epreuve' && r.questions?.length) {
                <h3>Réussite par question</h3>
                <div class="table-wrap"><table class="table"><thead><tr><th>Question</th><th class="num">Bonnes réponses</th></tr></thead><tbody>
                  @for (q of r.questions; track q.id) { <tr><td>{{ q.text }}</td><td class="num">{{ q.success === null ? '—' : q.success + ' %' }}</td></tr> }</tbody></table></div>
              }
            } @else { <div class="empty">Chargement…</div> }
          }

          <!-- ============ ÉLÈVE / PARENT ============ -->
          @if (!isStaff()) {
            @if (mine(); as m) {
              @if (m.graded && m.score !== null) {
                <div class="banner ok"><app-icon name="check" [size]="18" /> <span><b>Note : {{ m.score }} / {{ h.totalPoints }}</b>@if (m.feedback) { · {{ m.feedback }} }</span></div>
              }
            }
            @if (h.kind === 'fichier') {
              @if (mine(); as m) {
                @if (m.submittedAt) {
                  <div class="banner info"><app-icon name="check" [size]="18" /> <span>Copie rendue le {{ when(m.submittedAt) }}@if (m.late) { <b> · en retard</b> } : {{ m.fileName }}</span></div>
                }
              }
              @if (isStudent()) {
                @if (h.window === 'a_venir') { <div class="banner info"><app-icon name="lock" [size]="18" /> Ce devoir ouvre le {{ when(h.opensAt) }}.</div> }
                @else if (!canSubmit(h)) { <div class="banner warn"><app-icon name="lock" [size]="18" /> {{ mine()?.graded ? 'Votre copie est corrigée : elle ne peut plus être remplacée.' : 'La date limite est passée et ce devoir n’accepte plus de copie.' }}</div> }
                @else {
                  @if (h.window === 'ferme') { <div class="banner warn"><app-icon name="alert" [size]="18" /> La date limite est passée : votre copie sera marquée « en retard ».</div> }
                  <div class="stack tight" style="max-width:520px">
                    <label class="field"><span>{{ mine()?.submittedAt ? 'Remplacer ma copie' : 'Ma copie (PDF, photo, Word — 5 Mo maximum)' }}</span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.odt,.txt" (change)="onPick($event)" /></label>
                    <label class="field"><span>Message pour l’enseignant (facultatif)</span><input [ngModel]="comment()" (ngModelChange)="comment.set($event)" name="cm" maxlength="500" /></label>
                    <div class="row"><button type="button" class="btn primary" [disabled]="busy() || !picked()" (click)="submit(h)"><app-icon name="upload" [size]="16" /> {{ mine()?.submittedAt ? 'Remplacer ma copie' : 'Rendre ma copie' }}</button></div>
                  </div>
                }
              } @else if (!mine()?.submittedAt) { <div class="banner info"><app-icon name="alert" [size]="18" /> {{ kid()?.prenoms }} n’a pas encore rendu ce devoir.</div> }
            } @else {
              <!-- épreuve -->
              @if (mine(); as m) {
                @if (m.status === 'termine') {
                  <div class="banner ok"><app-icon name="check" [size]="18" /> <span>Épreuve terminée le {{ when(m.finishedAt) }}. <b>Note : {{ m.score }} / {{ h.totalPoints }}</b></span></div>
                  @if (h.correctionVisible && m.id) { <div class="row"><button type="button" class="btn" (click)="showReview(m.id)">Voir le corrigé</button></div> }
                  @else if (h.correction !== 'jamais') { <span class="tiny muted">Le corrigé s’ouvrira {{ h.correction === 'fin' ? 'après la fermeture de l’épreuve (' + when(h.dueAt) + ')' : 'quand l’enseignant l’ouvrira' }}.</span> }
                }
              }
              @if (isStudent() && mine()?.status !== 'termine') {
                @if (h.window === 'a_venir') { <div class="banner info"><app-icon name="lock" [size]="18" /> L’épreuve ouvre le {{ when(h.opensAt) }}.</div> }
                @else if (h.window === 'ferme' && !mine()) { <div class="banner warn"><app-icon name="lock" [size]="18" /> L’épreuve est fermée.</div> }
                @else {
                  <div class="banner info"><app-icon name="alert" [size]="18" /> <span>Vous avez <b>{{ h.durationMin }} minutes</b> dès que vous cliquez sur « {{ mine() ? 'Reprendre' : 'Démarrer' }} ». Le chronomètre ne s’arrête pas, même si votre connexion coupe. À la fin du temps, votre copie est rendue automatiquement.@if (h.maxLeaves) { Ne quittez pas la page : {{ h.maxLeaves }} sortie(s) au plus, puis la copie est rendue d’office. }</span></div>
                  <div class="row"><button type="button" class="btn primary" [disabled]="busy()" (click)="askStart.set(true)">{{ mine() ? 'Reprendre l’épreuve' : 'Démarrer l’épreuve' }}</button></div>
                }
              } @else if (!isStudent() && mine()?.status !== 'termine') { <div class="banner info"><app-icon name="alert" [size]="18" /> {{ kid()?.prenoms }} n’a pas encore passé cette épreuve.</div> }
            }
          }
        </div>
      </div>
      }
    }
  </div>

  <!-- ============ Épreuve en cours ============ -->
  @if (attempt(); as at) {
    <div class="exam" role="dialog" aria-modal="true" aria-label="Épreuve en cours">
      <div class="exam-bar">
        <div><b>{{ sel()?.title }}</b><div class="tiny muted">{{ answered() }} / {{ at.questions.length }} questions répondues</div></div>
        <div class="timer" [class.low]="left() <= 60" role="timer" aria-label="Temps restant">{{ clock() }}</div>
        <button type="button" class="btn primary" [disabled]="busy()" (click)="askFinish.set(true)">Terminer et rendre</button>
      </div>
      @if (warn(); as w) { <div class="banner bad leave" role="alert"><app-icon name="alert" [size]="18" /> {{ w }}</div> }
      <div class="exam-body">
        @for (q of at.questions; track q.id; let i = $index) {
          <fieldset class="card pad q">
            <legend class="q-title">Question {{ i + 1 }} <span class="muted small">· {{ q.points }} point{{ q.points > 1 ? 's' : '' }}</span></legend>
            <p>{{ q.text }}</p>
            @if (q.multiple) { <p class="tiny muted">Plusieurs réponses sont possibles.</p> }
            <div class="stack tight">
              @for (c of q.choices; track c.i) {
                <label class="opt" [class.on]="has(q, c.i)">
                  @if (q.multiple) { <input type="checkbox" [checked]="has(q, c.i)" (change)="toggle(q, c.i)" /> }
                  @else { <input type="radio" [name]="'a' + q.id" [checked]="has(q, c.i)" (change)="choose(q, c.i)" /> }
                  <span>{{ c.text }}</span></label>
              }
            </div>
          </fieldset>
        }
        <div class="row" style="justify-content:center;padding:12px 0 40px"><button type="button" class="btn primary" [disabled]="busy()" (click)="askFinish.set(true)">Terminer et rendre ma copie</button></div>
      </div>
    </div>
  }

  @if (form(); as f) {
    <app-modal [title]="editingId() ? 'Modifier le devoir' : 'Nouveau devoir'" size="wide" (closed)="form.set(null)">
      <div class="stack">
        <div class="form-grid">
          <label class="field"><span>Classe</span><select [ngModel]="f.classId" (ngModelChange)="setForm({ classId: $event })" name="fc" [disabled]="!!editingId() && lockedForm()">@for (c of s.scopeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
          <label class="field"><span>Matière</span><select [ngModel]="f.subjectId" (ngModelChange)="setForm({ subjectId: $event })" name="fs" [disabled]="!!editingId() && lockedForm()">@for (m of mySubjects(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }</select></label>
        </div>
        <div class="field"><span>Type de devoir</span><div class="chips" role="group" aria-label="Type de devoir">
          <button type="button" class="chip" [class.on]="f.kind === 'fichier'" [attr.aria-pressed]="f.kind === 'fichier'" [disabled]="!!editingId()" (click)="setForm({ kind: 'fichier' })">Devoir à rendre en fichier</button>
          <button type="button" class="chip" [class.on]="f.kind === 'epreuve'" [attr.aria-pressed]="f.kind === 'epreuve'" [disabled]="!!editingId()" (click)="setForm({ kind: 'epreuve' })">Épreuve en ligne (QCM, vrai ou faux)</button></div></div>
        <label class="field"><span>Titre</span><input [ngModel]="f.title" (ngModelChange)="setForm({ title: $event })" name="ft" maxlength="120" />
          @if (touched() && f.title.trim().length < 3) { <span class="err">Donnez un titre au devoir</span> }</label>
        <label class="field"><span>Consigne</span><textarea rows="4" [ngModel]="f.instructions" (ngModelChange)="setForm({ instructions: $event })" name="fi" maxlength="3000"></textarea></label>
        <div class="form-grid">
          <label class="field"><span>Ouvre le</span><input type="datetime-local" [ngModel]="f.opensAt" (ngModelChange)="setForm({ opensAt: $event })" name="fo" /></label>
          <label class="field"><span>À rendre avant le</span><input type="datetime-local" [ngModel]="f.dueAt" (ngModelChange)="setForm({ dueAt: $event })" name="fd" />
            @if (touched() && (!f.dueAt || f.dueAt <= f.opensAt)) { <span class="err">La date limite doit suivre l’ouverture</span> }</label>
        </div>
        @if (f.kind === 'epreuve') {
          <div class="form-grid">
            <label class="field"><span>Durée de l’épreuve (minutes)</span><input type="number" min="1" max="480" [ngModel]="f.durationMin" (ngModelChange)="setForm({ durationMin: +$event })" name="fm" [disabled]="!!editingId() && lockedForm()" /></label>
            <label class="field"><span>Corrigé pour l’élève</span><select [ngModel]="f.correction" (ngModelChange)="setForm({ correction: $event })" name="fk">
              <option value="fin">Visible après la fermeture de l’épreuve</option><option value="manuel">Visible quand je l’ouvre</option><option value="jamais">Jamais : l’élève voit seulement sa note</option></select></label>
          </div>
          <label class="field"><span>Sorties de la page tolérées (0 : sans limite)</span><input type="number" min="0" max="20" [ngModel]="f.maxLeaves" (ngModelChange)="setForm({ maxLeaves: +$event })" name="fv" />
            <span class="tiny muted">Pendant l’épreuve, l’élève est prévenu à chaque sortie de la page. Au-delà de ce nombre, sa copie est rendue d’office.</span></label>
          <label class="row"><input type="checkbox" [ngModel]="f.shuffle" (ngModelChange)="setForm({ shuffle: $event })" name="fh" /> <span>Mélanger l’ordre des questions et des réponses (différent pour chaque élève)</span></label>
        } @else {
          <div class="form-grid">
            <label class="field"><span>Barème (note maximale)</span><input type="number" min="1" max="100" [ngModel]="f.maxPoints" (ngModelChange)="setForm({ maxPoints: +$event })" name="fx" [disabled]="!!editingId() && lockedForm()" /></label>
            <label class="field"><span>Remise après la date limite</span><select [ngModel]="f.allowLate" (ngModelChange)="setForm({ allowLate: $event === true || $event === 'true' })" name="fl"><option [ngValue]="true">Acceptée, signalée « en retard »</option><option [ngValue]="false">Refusée</option></select></label>
          </div>
        }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="form.set(null)">Annuler</button><button type="button" class="btn primary" [disabled]="busy()" (click)="saveForm()">{{ editingId() ? 'Enregistrer' : 'Créer le brouillon' }}</button></div>
    </app-modal>
  }

  @if (askSend()) {
    <app-modal title="Envoyer à la classe" (closed)="askSend.set(false)">
      <p>Les élèves de la {{ s.className(sel()?.classId ?? '') }} et leurs parents seront prévenus. @if (sel()?.kind === 'epreuve') { Vous ne pourrez plus modifier les questions dès qu’un élève aura commencé. }</p>
      <div footer><button type="button" class="btn ghost" (click)="askSend.set(false)">Annuler</button><button type="button" class="btn primary" [disabled]="busy()" (click)="send()">Envoyer</button></div>
    </app-modal>
  }
  @if (askDelete()) {
    <app-modal title="Supprimer ce devoir" (closed)="askDelete.set(false)">
      <p>« {{ sel()?.title }} » sera supprimé définitivement.</p>
      <div footer><button type="button" class="btn ghost" (click)="askDelete.set(false)">Annuler</button><button type="button" class="btn primary" [disabled]="busy()" (click)="remove()">Supprimer</button></div>
    </app-modal>
  }
  @if (askStart()) {
    <app-modal [title]="mine() ? 'Reprendre l’épreuve' : 'Démarrer l’épreuve'" (closed)="askStart.set(false)">
      <p>Le chronomètre {{ mine() ? 'continue de tourner depuis votre premier démarrage' : 'démarre maintenant et ne peut pas être mis en pause' }}. Votre travail est enregistré au fur et à mesure.</p>
      <div footer><button type="button" class="btn ghost" (click)="askStart.set(false)">Pas maintenant</button><button type="button" class="btn primary" [disabled]="busy()" (click)="start()">{{ mine() ? 'Reprendre' : 'Démarrer' }}</button></div>
    </app-modal>
  }
  @if (askFinish()) {
    <app-modal title="Rendre ma copie" (closed)="askFinish.set(false)">
      <p>@if (unanswered() > 0) { <b>{{ unanswered() }} question(s) sans réponse.</b> }Une fois la copie rendue, vous ne pourrez plus la modifier.</p>
      <div footer><button type="button" class="btn ghost" (click)="askFinish.set(false)">Continuer l’épreuve</button><button type="button" class="btn primary" [disabled]="busy()" (click)="finishNow(false)">Rendre ma copie</button></div>
    </app-modal>
  }
  @if (review(); as items) {
    <app-modal title="Réponses" size="wide" (closed)="review.set(null)">
      <div class="stack">
        @for (it of items; track it.id; let i = $index) {
          <div class="card pad">
            <b>{{ i + 1 }}. {{ it.text }}</b>
            <ul class="rv">
              @for (c of it.choices; track $index; let j = $index) {
                <li [class.good]="it.correct?.includes(j)" [class.mine]="it.chosen.includes(j)"><span class="mark">{{ it.chosen.includes(j) ? '☒' : '☐' }}</span> {{ c }}@if (it.correct?.includes(j)) { <span class="tiny"> · bonne réponse</span> }</li>
              }
            </ul>
            @if (it.ok !== undefined) { <span class="pill" [class.ok]="it.ok" [class.bad]="!it.ok">{{ it.ok ? '+' + it.earned + ' pt' : '0 pt' }}</span> }
            @if (it.chosen.length === 0) { <span class="tiny muted">Pas de réponse</span> }
          </div>
        }
      </div>
    </app-modal>
  }`,
  styles: `
    button.item { text-align: start; display: flex; flex-direction: column; gap: 5px; cursor: pointer; font: inherit; color: inherit; }
    button.item:hover { border-color: var(--brand); }
    .back { margin-bottom: 10px; } .flip { transform: rotate(180deg); }
    .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 18px; margin: 0; }
    .facts div { display: flex; flex-direction: column; gap: 2px; } .facts dt { font-size: 12px; color: var(--muted); } .facts dd { margin: 0; font-weight: 550; }
    .consigne { white-space: pre-wrap; padding: 12px 14px; border-radius: 10px; background: var(--surface-2); }
    .stack.tight { gap: 8px; }
    .qedit { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; margin: 0; min-width: 0; }
    .qedit legend { font-weight: 600; padding: 0 6px; }
    .choice-row { display: flex; gap: 8px; align-items: center; } .choice-row .grow { flex: 1; min-width: 0; }
    .field.inline { flex-direction: row; align-items: center; gap: 8px; } .inline-input.wide { width: 100%; min-width: 140px; }
    .bad-input { border-color: var(--bad) !important; } tr.sub td { border-top: 0; padding-top: 0; }
    .btn.danger { color: var(--bad); }
    .exam { position: fixed; inset: 0; z-index: 55; background: var(--bg); display: flex; flex-direction: column; }
    .exam-bar { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--surface); flex-wrap: wrap; }
    .timer { font-variant-numeric: tabular-nums; font-size: 28px; font-weight: 700; padding: 2px 14px; border-radius: 10px; background: var(--brand-tint); color: var(--brand); }
    .timer.low { background: var(--bad-tint, #fde8e8); color: var(--bad); }
    .leave { margin: 10px 16px 0; }
    .exam-body { overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; max-width: 820px; width: 100%; margin: 0 auto; }
    fieldset.q { margin: 0; min-width: 0; } .q-title { font-weight: 650; padding: 0 6px; }
    .opt { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
    .opt.on { border-color: var(--brand); background: var(--brand-tint); } .opt input { margin-top: 3px; }
    ul.rv { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 4px; }
    ul.rv li.good { color: var(--ok, #1a7f4b); font-weight: 600; } ul.rv li.mine:not(.good) { color: var(--bad); } .mark { font-family: monospace; }
    @media (max-width: 640px) { .exam-bar { gap: 8px; } .timer { font-size: 22px; } }
  `,
})
export class DevoirsPage implements OnDestroy {
  readonly s = inject(Store);
  readonly hw = inject(Homeworks);
  readonly when = when;
  constructor() {
    if (this.s.apiMode()) void this.hw.load();
    effect(() => { if (this.attempt() && this.left() === 0) untracked(() => { if (!this.busy()) void this.finishNow(true); }); });
  }
  ngOnDestroy(): void { this.stopTimer(); }

  readonly isTeacher = computed(() => this.s.role() === 'enseignant');
  readonly isStaff = computed(() => this.isTeacher() || this.s.role() === 'directeur');
  readonly isStudent = computed(() => this.s.role() === 'eleve');
  readonly kid = computed(() => (this.isStaff() ? null : this.s.activeChild()));
  readonly intro = computed(() => {
    if (this.isTeacher()) return 'Envoyez un devoir à rendre en fichier ou une épreuve en ligne à vos classes, puis corrigez les copies.';
    if (this.isStaff()) return 'Les devoirs et épreuves envoyés par les enseignants (lecture seule).';
    if (this.isStudent()) return 'Tes devoirs à rendre et tes épreuves en ligne.';
    return 'Les devoirs et épreuves de votre enfant, avec leur état et leurs notes.';
  });

  // --- Liste ---
  readonly filter = signal<Filter>('tous');
  readonly filters = computed<{ id: Filter; label: string }[]>(() => this.isStaff()
    ? [{ id: 'tous', label: 'Tous' }, ...(this.isTeacher() ? [{ id: 'brouillons' as Filter, label: 'Brouillons' }] : []), { id: 'encours', label: 'En cours' }, { id: 'fermes', label: 'Fermés' }]
    : [{ id: 'tous', label: 'Tous' }, { id: 'afaire', label: 'À faire' }, { id: 'faits', label: 'Terminés' }]);
  mineOf(h: Homework): HwMine | null {
    const k = this.kid();
    return k ? h.mine.find((m) => m.student === k.id) ?? null : null;
  }
  private done(h: Homework): boolean { const m = this.mineOf(h); return !!m && (h.kind === 'epreuve' ? m.status === 'termine' : !!m.submittedAt); }
  readonly shown = computed(() => {
    const k = this.kid(), f = this.filter();
    let l = this.hw.list().filter((h) => this.isStaff() || h.classId === k?.classId);
    if (this.isStaff()) {
      l = l.filter((h) => f === 'tous' || (f === 'brouillons' ? !h.published : f === 'encours' ? h.published && h.window !== 'ferme' : h.published && h.window === 'ferme'));
    } else {
      l = l.filter((h) => f === 'tous' || (f === 'faits' ? this.done(h) : !this.done(h)));
      l = [...l].sort((a, b) => Number(this.done(a)) - Number(this.done(b)) || (this.done(a) ? b.dueAt.localeCompare(a.dueAt) : a.dueAt.localeCompare(b.dueAt)));
    }
    return l;
  });
  state(h: Homework): { label: string; tone: '' | 'ok' | 'warn' | 'bad' } {
    if (this.isStaff()) {
      if (!h.published) return { label: 'Brouillon', tone: 'warn' };
      return h.window === 'ferme' ? { label: 'Fermé', tone: '' } : h.window === 'a_venir' ? { label: 'Programmé', tone: 'warn' } : { label: 'Ouvert', tone: 'ok' };
    }
    const m = this.mineOf(h);
    if (m?.graded && h.kind === 'fichier') return { label: 'Corrigé', tone: 'ok' };
    if (h.kind === 'epreuve') {
      if (m?.status === 'termine') return { label: 'Terminée', tone: 'ok' };
      if (m?.status === 'en_cours') return { label: 'En cours', tone: 'warn' };
      return h.window === 'ferme' ? { label: 'Manquée', tone: 'bad' } : h.window === 'a_venir' ? { label: 'À venir', tone: '' } : { label: 'À faire', tone: 'warn' };
    }
    if (m?.submittedAt) return { label: m.late ? 'Rendu en retard' : 'Rendu', tone: m.late ? 'bad' : 'ok' };
    return h.window === 'ferme' ? { label: 'En retard', tone: 'bad' } : h.window === 'a_venir' ? { label: 'À venir', tone: '' } : { label: 'À faire', tone: 'warn' };
  }
  scoreOf(h: Homework): number | null { return this.mineOf(h)?.score ?? null; }

  // --- Détail ---
  readonly selId = signal<string | null>(null);
  readonly sel = computed(() => this.hw.list().find((x) => x.id === this.selId()) ?? null);
  readonly mine = computed(() => { const h = this.sel(); return h ? this.mineOf(h) : null; });
  readonly tab = signal<Tab>('sujet');
  readonly busy = signal(false);
  readonly qs = signal<HwQuestion[]>([]);
  readonly res = signal<Results | null>(null);
  readonly edits = signal<Record<string, { score: string; feedback: string }>>({});
  readonly review = signal<ReviewItem[] | null>(null);
  readonly picked = signal<File | null>(null);
  readonly comment = signal('');
  readonly askSend = signal(false); readonly askDelete = signal(false); readonly askStart = signal(false); readonly askFinish = signal(false);

  async open(h: Homework): Promise<void> {
    this.selId.set(h.id); this.tab.set('sujet'); this.res.set(null); this.picked.set(null); this.comment.set('');
    const full = await this.hw.get(h.id);
    if (full?.questions) this.qs.set(full.questions.map((q) => ({ ...q })));
    else this.qs.set([]);
    if (this.isStaff() && !this.isTeacher()) void this.loadRes();
  }
  close(): void { this.selId.set(null); this.res.set(null); void this.hw.load(); }
  locked = (h: Homework): boolean => h.published && ((h.counts?.rendus ?? 0) + (h.counts?.en_cours ?? 0) > 0);
  lockedForm = computed(() => { const h = this.sel(); return !!h && this.locked(h); });
  canSubmit(h: Homework): boolean {
    const m = this.mine();
    return h.window !== 'a_venir' && !m?.graded && (h.window === 'ouvert' || h.allowLate);
  }
  rowLabel(x: HwMine): string {
    if (x.status === 'corrige') return x.late ? 'Corrigé · retard' : 'Corrigé';
    if (x.status === 'termine') return 'Terminée';
    if (x.status === 'en_cours') return 'En cours';
    if (x.status === 'rendu') return x.late ? 'Rendu en retard' : 'Rendu';
    return x.graded ? 'Noté' : 'Pas rendu';
  }

  // --- Enseignant : réglages, questions ---
  readonly form = signal<HwForm | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly touched = signal(false);
  readonly mySubjects = computed(() => {
    const f = this.form();
    const ids = new Set(this.s.myAssignments().filter((a) => a.classId === f?.classId).map((a) => a.subjectId));
    return this.s.subjects().filter((x) => ids.has(x.id));
  });
  openNew(): void {
    const a = this.s.myAssignments()[0];
    if (!a) { this.s.toast('Aucune classe ne vous est affectée : demandez à la direction de vous en confier.', 'err'); return; }
    const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(18, 0, 0, 0);
    this.editingId.set(null); this.touched.set(false);
    this.form.set({ classId: a.classId, subjectId: a.subjectId, kind: 'fichier', title: '', instructions: '', opensAt: toInput(new Date().toISOString()), dueAt: toInput(d.toISOString()),
      allowLate: true, maxPoints: 20, durationMin: 30, shuffle: true, correction: 'fin', maxLeaves: 3 });
  }
  openEdit(h: Homework): void {
    this.editingId.set(h.id); this.touched.set(false);
    this.form.set({ classId: h.classId, subjectId: h.subjectId, kind: h.kind, title: h.title, instructions: h.instructions, opensAt: toInput(h.opensAt), dueAt: toInput(h.dueAt),
      allowLate: h.allowLate, maxPoints: h.maxPoints, durationMin: h.durationMin ?? 30, shuffle: h.shuffle, correction: h.correction, maxLeaves: h.maxLeaves });
  }
  setForm(p: Partial<HwForm>): void {
    const f = this.form();
    if (!f) return;
    const next = { ...f, ...p };
    if (p.classId && p.classId !== f.classId) next.subjectId = this.s.myAssignments().find((a) => a.classId === p.classId)?.subjectId ?? '';
    this.form.set(next);
  }
  async saveForm(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.touched.set(true);
    if (f.title.trim().length < 3 || !f.dueAt || f.dueAt <= f.opensAt || !f.subjectId) return;
    this.busy.set(true);
    const id = this.editingId();
    const r = id ? await this.hw.update(id, f) : await this.hw.create(f);
    this.busy.set(false);
    if (r.error || !r.hw) { this.s.toast(r.error ?? 'Erreur', 'err'); return; }
    this.form.set(null);
    this.s.toast(id ? 'Devoir modifié.' : 'Brouillon créé. Ajoutez le sujet ou les questions, puis envoyez-le à la classe.');
    if (!id) void this.open(r.hw);
  }
  addQ(kind: 'qcm' | 'vf'): void { this.qs.update((l) => [...l, blankQ(kind)]); }
  delQ(i: number): void { this.qs.update((l) => l.filter((_, k) => k !== i)); }
  setQ(i: number, p: Partial<HwQuestion>): void { this.qs.update((l) => l.map((q, k) => (k === i ? { ...q, ...p } : q))); }
  setChoice(i: number, j: number, v: string): void { this.qs.update((l) => l.map((q, k) => (k === i ? { ...q, choices: q.choices.map((c, m) => (m === j ? v : c)) } : q))); }
  addChoice(i: number): void { this.qs.update((l) => l.map((q, k) => (k === i ? { ...q, choices: [...q.choices, ''] } : q))); }
  delChoice(i: number, j: number): void {
    this.qs.update((l) => l.map((q, k) => (k === i ? { ...q, choices: q.choices.filter((_, m) => m !== j), correct: q.correct.filter((c) => c !== j).map((c) => (c > j ? c - 1 : c)) } : q)));
  }
  toggleCorrect(i: number, j: number): void {
    this.qs.update((l) => l.map((q, k) => (k === i ? { ...q, correct: q.correct.includes(j) ? q.correct.filter((c) => c !== j) : [...q.correct, j].sort() } : q)));
  }
  totalQ = computed(() => this.qs().reduce((t, q) => t + (Number(q.points) || 0), 0));
  async saveQs(): Promise<void> {
    const h = this.sel();
    if (!h) return;
    this.busy.set(true);
    const r = await this.hw.saveQuestions(h.id, this.qs());
    this.busy.set(false);
    if (r.error) { this.s.toast(r.error, 'err'); return; }
    if (r.hw?.questions) this.qs.set(r.hw.questions.map((q) => ({ ...q })));
    this.s.toast('Questions enregistrées.');
  }
  async onAttach(ev: Event): Promise<void> {
    const h = this.sel(), input = ev.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!h || !f) return;
    this.busy.set(true);
    const r = await this.hw.attach(h.id, f);
    this.busy.set(false);
    this.s.toast(r.error ?? 'Sujet joint.', r.error ? 'err' : 'ok');
  }
  async detach(h: Homework): Promise<void> { const e = await this.hw.detach(h.id); this.s.toast(e ?? 'Sujet retiré.', e ? 'err' : 'ok'); }
  async send(): Promise<void> {
    const h = this.sel();
    if (!h) return;
    this.busy.set(true);
    const r = await this.hw.send(h.id);
    this.busy.set(false);
    this.askSend.set(false);
    this.s.toast(r.error ?? 'Envoyé. Les élèves et leurs parents sont prévenus.', r.error ? 'err' : 'ok');
  }
  async remove(): Promise<void> {
    const h = this.sel();
    if (!h) return;
    this.busy.set(true);
    const e = await this.hw.remove(h.id);
    this.busy.set(false);
    this.askDelete.set(false);
    if (e) { this.s.toast(e, 'err'); return; }
    this.selId.set(null); this.s.toast('Devoir supprimé.');
  }

  // --- Enseignant : copies et notes ---
  async showCopies(): Promise<void> { this.tab.set('copies'); await this.loadRes(); }
  async loadRes(): Promise<void> {
    const h = this.sel();
    if (!h) return;
    const r = await this.hw.results(h.id);
    this.res.set(r);
    const e: Record<string, { score: string; feedback: string }> = {};
    for (const x of r?.rows ?? []) e[x.student] = { score: x.score === null ? '' : String(x.score).replace('.', ','), feedback: x.feedback };
    this.edits.set(e);
  }
  edit(id: string): { score: string; feedback: string } { return this.edits()[id] ?? { score: '', feedback: '' }; }
  setEdit(id: string, p: Partial<{ score: string; feedback: string }>): void { this.edits.update((e) => ({ ...e, [id]: { ...this.edit(id), ...p } })); }
  private num(v: string): number | null { const t = v.trim().replace(',', '.'); return t === '' ? null : Number(t); }
  badScore(id: string): boolean { const n = this.num(this.edit(id).score), max = this.res()?.max ?? 20; return n !== null && (Number.isNaN(n) || n < 0 || n > max); }
  anyBad = computed(() => (this.res()?.rows ?? []).some((x) => this.badScore(x.student)));
  async saveGrades(): Promise<void> {
    const h = this.sel(), r = this.res();
    if (!h || !r) return;
    const grades = r.rows.filter((x) => {
      const e = this.edit(x.student), n = this.num(e.score);
      return n !== x.score || (e.feedback !== x.feedback && n !== null);
    }).map((x) => ({ student: x.student, score: this.num(this.edit(x.student).score), feedback: this.edit(x.student).feedback }));
    if (!grades.length) { this.s.toast('Aucune modification à enregistrer.'); return; }
    this.busy.set(true);
    const err = await this.hw.grade(h.id, grades);
    this.busy.set(false);
    if (err) { this.s.toast(err, 'err'); return; }
    this.s.toast('Notes enregistrées. Les élèves et leurs parents sont prévenus.');
    await this.loadRes();
  }
  async toGrades(h: Homework): Promise<void> {
    this.busy.set(true);
    const r = await this.hw.toGrades(h.id);
    this.busy.set(false);
    this.s.toast(r.error ?? `${r.grades} note(s) reportée(s) dans le carnet. Publiez-les depuis « Saisie des notes ».`, r.error ? 'err' : 'ok');
  }
  async toggleCorrection(h: Homework): Promise<void> { const e = await this.hw.setCorrection(h.id, !h.correctionOpen); this.s.toast(e ?? (h.correctionOpen ? 'Corrigé fermé.' : 'Corrigé ouvert aux élèves.'), e ? 'err' : 'ok'); }
  async showReview(subId: number): Promise<void> { const r = await this.hw.review(subId); if (r) this.review.set(r); }

  // --- Élève : fichier ---
  onPick(ev: Event): void { this.picked.set((ev.target as HTMLInputElement).files?.[0] ?? null); }
  async submit(h: Homework): Promise<void> {
    const f = this.picked();
    if (!f) return;
    this.busy.set(true);
    const e = await this.hw.submit(h.id, f, this.comment());
    this.busy.set(false);
    if (e) { this.s.toast(e, 'err'); return; }
    this.picked.set(null); this.comment.set('');
    this.s.toast('Copie rendue. Votre enseignant est prévenu.');
  }

  // --- Élève : épreuve chronométrée ---
  readonly attempt = signal<Attempt | null>(null);
  readonly answers = signal<Record<string, number[]>>({});
  private readonly now = signal(Date.now());
  private readonly deadline = signal(0);
  private ticker: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly left = computed(() => Math.max(0, Math.ceil((this.deadline() - this.now()) / 1000)));
  readonly clock = computed(() => mmss(this.left()));
  readonly warn = signal('');
  private away = false;
  private readonly onLeave = (): void => {
    const h = this.sel();
    if (this.away || !h || !this.attempt() || (document.visibilityState !== 'hidden' && document.hasFocus())) return;
    this.away = true;
    void this.hw.leave(h.id).then((r) => {
      if (!r) return;
      this.warn.set(r.finished ? 'Trop de sorties de la page : votre copie a été rendue d’office.' : `Vous avez quitté la page de l’épreuve (sortie ${r.leaves}${r.maxLeaves ? ' sur ' + r.maxLeaves : ''}). Restez sur cette page jusqu’à la fin.`);
      if (r.finished) void this.finishNow(true);
    });
  };
  private readonly onBack = (): void => { if (document.visibilityState === 'visible') this.away = false; };
  private readonly onUnload = (e: BeforeUnloadEvent): void => { if (this.attempt()) { e.preventDefault(); e.returnValue = ''; } };
  private listen(on: boolean): void {
    const m = on ? 'addEventListener' : 'removeEventListener';
    document[m]('visibilitychange', this.onLeave); document[m]('visibilitychange', this.onBack);
    window[m]('blur', this.onLeave); window[m]('focus', this.onBack); window[m]('beforeunload', this.onUnload);
  }
  readonly answered = computed(() => Object.values(this.answers()).filter((v) => v.length > 0).length);
  readonly unanswered = computed(() => (this.attempt()?.questions.length ?? 0) - this.answered());

  async start(): Promise<void> {
    const h = this.sel();
    if (!h) return;
    this.busy.set(true);
    const r = await this.hw.start(h.id);
    this.busy.set(false);
    this.askStart.set(false);
    if (r.error || !r.attempt) { this.s.toast(r.error ?? 'Erreur', 'err'); await this.hw.load(); return; }
    this.answers.set(r.attempt.answers);
    this.deadline.set(Date.now() + r.attempt.remaining * 1000);
    this.now.set(Date.now());
    this.warn.set(''); this.away = false;
    this.attempt.set(r.attempt); this.listen(true);
    this.ticker = setInterval(() => { this.now.set(Date.now()); if (this.dirty && !this.saveTimer) void this.flush(); }, 1000);
  }
  private stopTimer(): void {
    this.listen(false);
    if (this.ticker) clearInterval(this.ticker);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.ticker = this.saveTimer = null;
  }
  has(q: AttemptQuestion, i: number): boolean { return (this.answers()[String(q.id)] ?? []).includes(i); }
  choose(q: AttemptQuestion, i: number): void { this.setAnswer(q, [i]); }
  toggle(q: AttemptQuestion, i: number): void {
    const cur = this.answers()[String(q.id)] ?? [];
    this.setAnswer(q, cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort());
  }
  private setAnswer(q: AttemptQuestion, v: number[]): void {
    this.answers.update((a) => ({ ...a, [String(q.id)]: v }));
    this.dirty = true;
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush(); }, 800);
  }
  private async flush(): Promise<void> {
    const h = this.sel();
    if (!h || !this.dirty || !this.attempt()) return;
    this.dirty = false;
    const e = await this.hw.saveAnswers(h.id, this.answers());
    if (e) this.dirty = true;     // on réessaiera ; si le temps est écoulé, la clôture automatique prend le relais
  }
  async finishNow(auto: boolean): Promise<void> {
    const h = this.sel();
    if (!h || !this.attempt()) return;
    this.busy.set(true);
    const r = await this.hw.finish(h.id, this.answers());
    this.busy.set(false);
    this.askFinish.set(false);
    if (r.error) { this.s.toast(r.error, 'err'); if (!auto) return; }
    this.stopTimer(); this.attempt.set(null); this.dirty = false;
    await this.hw.get(h.id);
    this.s.toast(auto ? 'Le temps est écoulé : votre copie a été rendue.' : 'Copie rendue.');
  }
}
