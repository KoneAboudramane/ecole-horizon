import { Component, computed, inject, signal } from '@angular/core';
import { Store } from '../store';
import { Icon, ListModal } from '../ui';
import { Spark } from '../charts';
import { addDays, dateFr, dateLong, fcfa, fnum, monthLabel, rangLabel } from '../format';
import { Announcement, GRAVITE_LABEL, INCIDENT_LABEL, Incident, LogEntry, MODE_LABEL, PageId, PayMode, ROLE_LABEL, SANCTION_LABEL } from '../models';
import { mention, sur20 } from '../engine';
import { Lesson } from '../api-map';
import { Planning } from '../modules/planning';
import { Timetable } from '../modules/timetable';
import { adaptNav } from '../nav-perms';
import { PushCta } from '../push-cta';

@Component({
  selector: 'app-dashboard',
  imports: [Icon, Spark, ListModal, PushCta],
  template: `
  <div class="page">
    @switch (s.role()) {
      @case ('directeur') {
        @if (s.toPlace() > 0) {
          <div class="banner warn"><app-icon name="users" [size]="18" /> {{ s.toPlace() }} élève(s) attendent une classe : {{ s.toPlacePaid() }} réinscription(s) à valider (payé), {{ s.toPlaceWaiting() }} sans paiement. Ils n’apparaissent ni à l’appel ni dans les notes.
            <button class="btn sm" style="margin-inline-start:auto" (click)="s.go('annee')">Répartir dans les classes</button></div>
        }
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. Ce qui demande votre décision aujourd’hui.</p></div></div>
        <div class="grid kpi">
          <div class="card kpi-card"><span class="label">Élèves inscrits</span><span class="value">{{ s.students().length }}</span><span class="hint">{{ s.classes().length }} classes</span></div>
          <div class="card kpi-card"><span class="label">Moyenne générale de l’école</span><span class="value">{{ fnum(schoolAvg()) }}</span><span class="hint">notes publiées, {{ s.term().label }}</span><app-spark [values]="sp().avg" label="Tendance de la moyenne" /></div>
          <div class="card kpi-card"><span class="label">Assiduité</span><span class="value">{{ fnum(s.schoolAttendance(), 1) }} %</span><span class="hint">absences par semaine</span><app-spark [values]="sp().abs" color="var(--s2)" label="Absences par semaine" /></div>
          <div class="card kpi-card"><span class="label">Recouvrement de la scolarité</span><span class="value">{{ fnum(rate(), 1) }} %</span><span class="hint">{{ fcfa(s.finance().overdue) }} échus</span></div>
        </div>
        @if (todo().length) {
          <div class="card"><div class="card-head"><h2>À valider</h2></div>
            <div class="stack todo">
              @for (t of todo(); track t.text) { <button type="button" class="todo-item" (click)="s.go(t.page)"><app-icon [name]="t.icon" [size]="18" /><span class="grow">{{ t.text }}</span><app-icon name="chevron" [size]="16" /></button> }
            </div></div>
        }
        <div class="grid two">
          <div class="card">
            <div class="card-head"><h2>Moyenne par classe</h2><span class="tiny muted">notes publiées, {{ s.term().label }}</span></div>
            <div class="card-body stack">
              @for (c of classAvgs(); track c.name) { <div class="bar-row"><span class="bar-label">{{ c.name }}</span><div class="meter"><span [style.width.%]="c.avg === null ? 0 : c.avg * 5"></span></div><span class="num bar-val">{{ fnum(c.avg) }}</span></div> }
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Activité récente</h2><button class="link small" (click)="full.set('journal')">Tout voir</button></div>
            <div class="table-wrap"><table class="table"><tbody>
              @for (l of s.log().slice(0, 7); track l.id) { <tr><td><span class="cell-main">{{ l.action }}</span><div class="tiny muted">{{ l.detail }}</div></td><td class="tiny muted nowrap">{{ dateFr(l.ts) }}<br>{{ l.userName ? l.userName : l.userId === 'u-system' ? 'Système' : s.userName(l.userId) }}</td></tr> }
            </tbody></table></div>
          </div>
        </div>
      }
      @case ('fondateur') {
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. La situation de l’établissement, en lecture seule.</p></div></div>
        <div class="grid kpi">
          <div class="card kpi-card"><span class="label">Élèves inscrits</span><span class="value">{{ s.students().length }}</span><span class="hint">{{ s.classes().length }} classes</span></div>
          <div class="card kpi-card"><span class="label">Encaissé depuis la rentrée</span><span class="value">{{ fcfa(s.finance().collected) }}</span><span class="hint">Ce mois : {{ fcfa(s.finance().monthCollected) }}</span><app-spark [values]="sp().cash" label="Encaissements par mois" /></div>
          <div class="card kpi-card"><span class="label">Taux de recouvrement</span><span class="value">{{ fnum(rate(), 1) }} %</span><span class="hint">de ce qui était dû à ce jour</span></div>
          <div class="card kpi-card alert"><span class="label">Impayés échus</span><span class="value">{{ fcfa(s.finance().overdue) }}</span><span class="hint">{{ s.finance().overdueCount }} familles</span></div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-head"><h2>Encaissements par mois</h2></div>
            <div class="card-body stack">@for (m of months(); track m.k) { <div class="bar-row"><span class="bar-label">{{ m.label }}</span><div class="meter accent"><span [style.width.%]="m.pct"></span></div><span class="num bar-val wide">{{ fcfa(m.v) }}</span></div> }</div></div>
          <div class="card"><div class="card-head"><h2>Effectifs par niveau</h2></div>
            <div class="card-body stack">@for (l of levels(); track l.name) { <div class="bar-row"><span class="bar-label">{{ l.name }}</span><div class="meter"><span [style.width.%]="l.pct"></span></div><span class="num bar-val">{{ l.n }}</span></div> }</div></div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-head"><h2>Résultats par classe</h2><span class="tiny muted">moyenne, notes publiées</span></div>
            <div class="card-body stack">@for (c of classAvgs(); track c.name) { <div class="bar-row"><span class="bar-label">{{ c.name }}</span><div class="meter"><span [style.width.%]="c.avg === null ? 0 : c.avg * 5"></span></div><span class="num bar-val">{{ fnum(c.avg) }}</span></div> }</div></div>
          <div class="card"><div class="card-head"><h2>Vue de la direction</h2></div>
            <div class="card-body stack">
              <div class="small">Moyenne générale de l’école : <b>{{ fnum(schoolAvg()) }}</b> / 20</div>
              <div class="small">Assiduité : <b>{{ fnum(s.schoolAttendance(), 1) }} %</b></div>
              <div class="small">Sanctions disciplinaires : <b>{{ s.incidents().length }}</b> dont {{ s.pendingIncidents().length }} en attente de validation</div>
              <div class="small">Écarts de rapprochement mobile money : <b>{{ s.statementIssues().length }}</b></div>
              <div class="row"><button class="btn sm" (click)="s.go('paiements')">Voir les finances</button><button class="btn sm" (click)="s.go('tarifs')">Tarifs</button></div>
            </div></div>
        </div>
      }
      @case ('admin') {
        @if (s.toPlace() > 0) {
          <div class="banner warn"><app-icon name="users" [size]="18" /> {{ s.toPlace() }} élève(s) attendent une classe : {{ s.toPlacePaid() }} réinscription(s) à valider (payé), {{ s.toPlaceWaiting() }} sans paiement.
            <button class="btn sm" style="margin-inline-start:auto" (click)="s.go('annee')">Répartir dans les classes</button></div>
        }
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. Inscriptions, classes et comptes.</p></div>
          <div class="row"><button class="btn primary" (click)="s.go('eleves')">Inscrire un élève</button><button class="btn" (click)="s.go('comptes')">Gérer les comptes</button></div></div>
        <div class="grid kpi">
          <div class="card kpi-card"><span class="label">Élèves inscrits</span><span class="value">{{ s.students().length }}</span></div>
          <div class="card kpi-card"><span class="label">Classes</span><span class="value">{{ s.classes().length }}</span></div>
          <div class="card kpi-card"><span class="label">Comptes actifs</span><span class="value">{{ activeAccounts() }}</span></div>
          <div class="card kpi-card" [class.alert]="tempAccounts() > 0"><span class="label">Mots de passe provisoires</span><span class="value">{{ tempAccounts() }}</span><span class="hint">comptes jamais activés</span></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Activité récente</h2><button class="link small" (click)="full.set('journal')">Tout voir</button></div>
          <div class="table-wrap"><table class="table"><tbody>
            @for (l of s.log().slice(0, 7); track l.id) { <tr><td><span class="cell-main">{{ l.action }}</span><div class="tiny muted">{{ l.detail }}</div></td><td class="tiny muted nowrap">{{ dateFr(l.ts) }}<br>{{ l.userName ? l.userName : l.userId === 'u-system' ? 'Système' : s.userName(l.userId) }}</td></tr> }
          </tbody></table></div>
        </div>
      }
      @case ('educateur') {
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. Vie scolaire : appel, absences et discipline.</p></div>
          <div class="row"><button class="btn primary" (click)="s.go('appel')">Faire l’appel</button><button class="btn" (click)="s.go('discipline')">Signaler un incident</button></div></div>
        <div class="grid kpi">
          @if (byLesson()) {
            <div class="card kpi-card" [class.alert]="appelsLeft() > 0"><span class="label">Appels du jour à faire</span><span class="value">{{ appelsLeft() }}</span><span class="hint">sur {{ lessonsToday().length }} cours</span></div>
          } @else {
            <div class="card kpi-card" [class.alert]="appelsLeft() > 0"><span class="label">Appels du matin à faire</span><span class="value">{{ appelsLeft() }}</span><span class="hint">sur {{ s.classes().length }} classes</span></div>
          }
          <div class="card kpi-card" [class.alert]="s.pendingJustifs().length > 0"><span class="label">Justificatifs en attente</span><span class="value">{{ s.pendingJustifs().length }}</span></div>
          <div class="card kpi-card"><span class="label">Assiduité</span><span class="value">{{ fnum(s.schoolAttendance(), 1) }} %</span><span class="hint">absences par semaine</span><app-spark [values]="sp().abs" color="var(--s2)" label="Absences par semaine" /></div>
          <div class="card kpi-card"><span class="label">Incidents ouverts</span><span class="value">{{ s.pendingIncidents().length }}</span><span class="hint">en attente de la direction</span></div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-head"><h2>Élèves les plus absents</h2><span class="tiny muted">absences non justifiées</span></div>
            <div class="table-wrap"><table class="table"><tbody>
              @for (r of topAbsent(); track r.id) { <tr style="cursor:pointer" (click)="s.go('eleve', r.id)"><td class="cell-main">{{ r.name }}<div class="tiny muted">{{ r.cls }}</div></td><td class="num"><span class="pill warn">{{ r.n }} absence(s)</span></td></tr> }
            </tbody></table></div></div>
          <div class="card"><div class="card-head"><h2>Derniers incidents</h2><button class="link small" (click)="full.set('discipline')">Tout voir</button></div>
            <div class="table-wrap"><table class="table"><tbody>
              @for (i of s.incidents().slice(0, 5); track i.id) { <tr><td class="cell-main">{{ s.studentName(i.studentId) }}<div class="tiny muted">{{ dateFr(i.date) }}</div></td><td>@if (i.status === 'a_valider') { <span class="pill warn">À valider</span> } @else if (i.status === 'valide') { <span class="pill ok">Validée</span> } @else { <span class="pill">Refusée</span> }</td></tr> }
            </tbody></table></div></div>
        </div>
      }
      @case ('enseignant') {
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. Vos classes et vos tâches du jour.</p></div>
          <div class="row"><button class="btn primary" (click)="s.go('appel')">Faire l’appel</button><button class="btn" (click)="s.go('notes')">Saisir des notes</button></div></div>
        @if (s.myPrincipalClasses().length) {
          <div class="banner info"><app-icon name="users" [size]="18" /> Vous êtes professeur principal de la {{ principalNames() }}.<button class="btn sm" style="margin-inline-start:auto" (click)="s.go('maclasse')">Ouvrir ma classe</button></div>
        }
        @if (appelTodo().length) {
          <div class="banner warn"><b>Appel du jour à faire :</b> {{ appelTodo().join(', ') }}.</div>
        } @else {
          <div class="banner ok">L’appel du jour est fait pour toutes vos classes.</div>
        }
        <div class="grid three">
          @for (a of s.myAssignments(); track a.id) {
            <div class="card pad stack">
              <div class="row"><h3 class="grow">{{ s.className(a.classId) }}</h3><span class="pill brand">{{ s.subjectById().get(a.subjectId)?.short }}</span></div>
              <div class="small muted">{{ s.studentsByClass().get(a.classId)?.length ?? 0 }} élèves · {{ s.evalsFor(a.classId, a.subjectId).length }} évaluations cette période</div>
              <div class="small">{{ pending(a.classId, a.subjectId) }}</div>
              <button class="btn sm" (click)="s.go('notes', a.classId + '|' + a.subjectId)">Ouvrir les notes</button>
            </div>
          }
        </div>
      }
      @case ('personnel') {
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. {{ s.me()?.roleLabel || 'Personnel' }}.</p></div></div>
        @if (shortcuts().length) {
          <div class="grid three">
            @for (n of shortcuts(); track n.page) { <button type="button" class="card pad item" style="display:grid;gap:4px;text-align:left" (click)="s.go(n.page)"><b>{{ n.label }}</b><span class="small muted">Ouvrir</span></button> }
          </div>
        } @else { <div class="card pad" style="max-width:560px"><h2>Bienvenue</h2><p class="muted">Votre rôle n’a pas encore de page de travail. Demandez à la personne qui gère les accès de vous donner les droits qu’il vous faut.</p></div> }
        <div class="grid two">
          <div class="card"><div class="card-head"><h2>Dernières notifications</h2></div>
            <div class="table-wrap"><table class="table"><tbody>
              @for (n of s.myNotices().slice(0, 5); track n.id) { <tr><td>{{ n.text }}<div class="tiny muted">{{ dateLong(n.date) }}</div></td></tr> }
              @empty { <tr><td class="muted">Aucune notification.</td></tr> }
            </tbody></table></div></div>
          <div class="card"><div class="card-head"><h2>Annonces de l’école</h2><button class="link small" (click)="full.set('annonces')">Tout voir</button></div>
            <div class="card-body stack">
              @for (a of s.myAnnouncements().slice(0, 3); track a.id) { <div><b>{{ a.title }}</b><div class="small muted">{{ a.body }}</div></div> }
            </div></div>
        </div>
      }
      @case ('informatique') {
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. Comptes, accès et journal de la plateforme.</p></div>
          <div class="row"><button class="btn primary" (click)="s.go('comptes')">Gérer les comptes</button><button class="btn" (click)="s.go('parametres')">Identité de l’école</button></div></div>
        <div class="grid kpi">
          <div class="card kpi-card"><span class="label">Comptes actifs</span><span class="value">{{ activeAccounts() }}</span></div>
          <div class="card kpi-card" [class.alert]="tempAccounts() > 0"><span class="label">Mots de passe provisoires</span><span class="value">{{ tempAccounts() }}</span><span class="hint">comptes jamais activés</span></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Activité récente</h2><button class="link small" (click)="full.set('journal')">Tout voir</button></div>
          <div class="table-wrap"><table class="table"><tbody>
            @for (l of s.log().slice(0, 7); track l.id) { <tr><td><span class="cell-main">{{ l.action }}</span><div class="tiny muted">{{ l.detail }}</div></td><td class="tiny muted nowrap">{{ dateFr(l.ts) }}<br>{{ l.userName ? l.userName : l.userId === 'u-system' ? 'Système' : s.userName(l.userId) }}</td></tr> }
          </tbody></table></div>
        </div>
      }
      @case ('comptable') {
        <div class="page-head"><div><h1>Bonjour, {{ firstName() }}</h1><p>{{ dateLong(s.today) }}. Suivi des encaissements de la scolarité.</p></div>
          <button class="btn primary" (click)="s.go('paiements', 'new')">Enregistrer un paiement</button></div>
        <div class="grid kpi">
          <div class="card kpi-card"><span class="label">Attendu à ce jour</span><span class="value">{{ fcfa(s.finance().dueToDate) }}</span></div>
          <div class="card kpi-card"><span class="label">Encaissé</span><span class="value">{{ fcfa(s.finance().collected) }}</span><span class="hint">Taux de recouvrement : {{ fnum(rate(), 1) }} %</span><app-spark [values]="sp().cash" label="Encaissements par mois" /></div>
          <div class="card kpi-card alert"><span class="label">Impayés échus</span><span class="value">{{ fcfa(s.finance().overdue) }}</span><span class="hint">{{ s.finance().overdueCount }} familles</span></div>
          <div class="card kpi-card" [class.alert]="s.statementIssues().length > 0"><span class="label">Écarts de rapprochement</span><span class="value">{{ s.statementIssues().length }}</span><span class="hint">à vérifier avec le relevé</span></div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-head"><h2>Encaissements par mois</h2></div>
            <div class="card-body stack">
              @for (m of months(); track m.k) {
                <div class="bar-row"><span class="bar-label">{{ m.label }}</span><div class="meter accent"><span [style.width.%]="m.pct"></span></div><span class="num bar-val wide">{{ fcfa(m.v) }}</span></div>
              }
            </div></div>
          <div class="card"><div class="card-head"><h2>Par moyen de paiement</h2></div>
            <div class="card-body stack">
              @for (m of modes(); track m.k) {
                <div class="bar-row"><span class="bar-label wide">{{ m.label }}</span><div class="meter"><span [style.width.%]="m.pct"></span></div><span class="num bar-val wide">{{ fcfa(m.v) }}</span></div>
              }
            </div></div>
        </div>
      }
      @default {
        @if (s.activeChild(); as k) {
          <div class="page-head"><div><h1>{{ s.role() === 'eleve' ? 'Bonjour, ' + k.prenoms : k.prenoms + ' ' + k.nom }}</h1>
            <p>{{ s.className(k.classId) }} · matricule {{ k.matricule }} · {{ s.term().label }}</p></div>
            @if (s.role() === 'parent') { <button class="btn primary" (click)="s.go('payer')">Scolarité et paiement</button> }</div>
          @if (s.role() === 'parent' && s.apiMode()) { <app-push-cta place="accueil" /> }
          @if (k.classId.startsWith('placer:')) {
            @if (k.reinscription === 'attente') {
              <div class="banner warn"><app-icon name="alert" [size]="18" /><span class="grow"><b>Réinscription à faire</b> : {{ s.role() === 'eleve' ? 'tu passes' : k.prenoms + ' passe' }} en <b>{{ k.classId.slice(7) }}</b> pour la nouvelle année.
                Réglez un premier paiement de scolarité (même partiel), puis présentez le reçu au secrétariat, qui valide la réinscription.</span>
                @if (s.role() === 'parent') { <button class="btn sm accent" (click)="s.go('payer')">Payer</button> }</div>
            } @else if (k.reinscription === 'paye') {
              <div class="banner info"><app-icon name="check" [size]="18" /><span class="grow"><b>Paiement reçu.</b> Présentez le reçu au secrétariat pour valider la réinscription de {{ s.role() === 'eleve' ? 'ton dossier' : k.prenoms }} en <b>{{ k.classId.slice(7) }}</b>.</span></div>
            } @else {
              <div class="banner info"><app-icon name="users" [size]="18" /><span class="grow">{{ s.role() === 'eleve' ? 'Tu es réinscrit(e)' : k.prenoms + ' est réinscrit(e)' }} en <b>{{ k.classId.slice(7) }}</b> pour la nouvelle année.
                La classe sera bientôt attribuée par l’école : vous serez prévenu(e).</span></div>
            }
          }
          @if (s.role() === 'parent' && bal().overdue > 0) {
            <div class="banner warn"><app-icon name="alert" [size]="18" /><span class="grow"><b>{{ fcfa(bal().overdue) }}</b> de frais de scolarité sont échus pour {{ k.prenoms }}.</span>
              <button class="btn sm accent" (click)="s.go('payer')">Payer maintenant</button></div>
          }
          <div class="grid kpi">
            <div class="card kpi-card"><span class="label">Moyenne générale</span><span class="value">{{ res() ? fnum(res()!.moyenne) : '—' }}<span class="muted small"> /20</span></span>
              <span class="hint">{{ mention(res()?.moyenne ?? null, s.school().seuils) }}</span><app-spark [values]="sp().kid" label="Évolution de la moyenne" /></div>
            <div class="card kpi-card"><span class="label">Rang</span><span class="value">{{ rangLabel(res()?.rang ?? null) }}</span><span class="hint">@if (k.classId.startsWith('placer:')) { en attente de classe } @else { sur {{ effectif() }} élèves }</span></div>
            <div class="card kpi-card"><span class="label">Assiduité</span><span class="value">{{ fnum(s.attendanceRate(k.id), 0) }} %</span><span class="hint">{{ abs().a }} absence(s), {{ abs().r }} retard(s)</span></div>
            @if (s.role() === 'parent') {
              <div class="card kpi-card"><span class="label">Reste à payer</span><span class="value">{{ fcfa(bal().solde) }}</span><span class="hint">sur {{ fcfa(bal().total) }}</span></div>
            }
          </div>
          <div class="grid two">
            <div class="card"><div class="card-head"><h2>Dernières notifications</h2></div>
              <div class="table-wrap"><table class="table"><tbody>
                @for (n of s.myNotices().slice(0, 5); track n.id) { <tr><td>{{ n.text }}<div class="tiny muted">{{ dateLong(n.date) }}</div></td></tr> }
                @empty { <tr><td class="muted">Aucune notification.</td></tr> }
              </tbody></table></div></div>
            <div class="card"><div class="card-head"><h2>Annonces de l’école</h2><button class="link small" (click)="full.set('annonces')">Tout voir</button></div>
              <div class="card-body stack">
                @for (a of s.myAnnouncements().slice(0, 3); track a.id) { <div><b>{{ a.title }}</b><div class="small muted">{{ a.body }}</div></div> }
              </div></div>
          </div>
        } @else { <div class="card pad" style="max-width:560px"><h2>Aucun dossier rattaché</h2><p class="muted">Aucun élève n’est rattaché à ce compte. Contactez le secrétariat de l’école.</p></div> }
      }
    }
  </div>

  <!-- « Tout voir » : la liste complète dans une fenêtre -->
  <ng-template #logHead><tr><th>Date</th><th>Action</th><th>Détail</th><th>Par</th></tr></ng-template>
  <ng-template #logRow let-l><tr><td class="nowrap tiny">{{ dateFr(l.ts) }} {{ l.ts.slice(11, 16) }}</td><td><span class="pill brand">{{ l.action }}</span></td><td>{{ l.detail }}</td><td class="muted">{{ who(l) }}</td></tr></ng-template>
  <ng-template #incHead><tr><th>Date</th><th>Élève</th><th>Incident</th><th>Gravité</th><th>Sanction</th><th>Statut</th></tr></ng-template>
  <ng-template #incRow let-i><tr style="cursor:pointer" (click)="openStudent(i.studentId)"><td class="nowrap">{{ dateFr(i.date) }}</td><td class="cell-main">{{ s.studentName(i.studentId) }}<div class="tiny muted">{{ classOf(i) }}</div></td>
    <td>{{ incLabel(i) }}<div class="tiny muted">{{ i.description }}</div></td><td><span class="pill" [class.bad]="i.gravite === 'grave'" [class.warn]="i.gravite === 'moyenne'">{{ gravLabel(i) }}</span></td><td>{{ sancLabel(i) }}</td>
    <td>@if (i.status === 'a_valider') { <span class="pill warn">À valider</span> } @else if (i.status === 'refuse') { <span class="pill bad">Refusé</span> } @else { <span class="pill ok">Validé</span> }</td></tr></ng-template>
  <ng-template #annHead><tr><th>Date</th><th>Annonce</th><th>Destinataires</th></tr></ng-template>
  <ng-template #annRow let-a><tr><td class="nowrap">{{ dateFr(a.date) }}</td><td><b>{{ a.title }}</b><div class="small muted" style="white-space:pre-line">{{ a.body }}</div></td><td class="small">{{ audience(a) }}</td></tr></ng-template>
  @switch (full()) {
    @case ('journal') { <app-list-modal title="Activité récente" [items]="s.log()" [head]="logHead" [row]="logRow" [text]="logText" [cols]="4"
        placeholder="Action, personne ou détail" [pageLabel]="canOpen('journal') ? 'Journal d’activité' : ''" (openPage)="goFull('journal')" (closed)="full.set(null)" /> }
    @case ('discipline') { <app-list-modal title="Incidents" [items]="s.incidents()" [head]="incHead" [row]="incRow" [text]="incText" [cols]="6" [hover]="true"
        placeholder="Élève, classe, incident ou sanction" [pageLabel]="canOpen('discipline') ? 'Discipline' : ''" (openPage)="goFull('discipline')" (closed)="full.set(null)" /> }
    @case ('annonces') { <app-list-modal title="Annonces de l’école" [items]="s.myAnnouncements()" [head]="annHead" [row]="annRow" [text]="annText" [cols]="3"
        placeholder="Titre ou contenu de l’annonce" [pageLabel]="canOpen('annonces') ? 'Annonces' : ''" (openPage)="goFull('annonces')" (closed)="full.set(null)" /> }
  }`,
  styles: `
    .bar-row { display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items: center; }
    .bar-label { font-size: 13px; font-weight: 600; } .bar-label.wide { min-width: 96px; }
    .bar-val { min-width: 44px; text-align: right; font-size: 13px; } .bar-val.wide { min-width: 110px; }
    .bar-row:has(.bar-label.wide) { grid-template-columns: 110px 1fr auto; }
    .todo { gap: 0; }
    .todo-item { display: flex; align-items: center; gap: 12px; text-align: left; background: none; border: 0; border-top: 1px solid var(--line); padding: 12px 18px; cursor: pointer; }
    .todo-item:first-child { border-top: 0; } .todo-item:hover { background: var(--surface-2); }
    .todo-item app-icon:first-child { color: var(--accent); }
  `,
})
export class Dashboard {
  readonly s = inject(Store);
  // --- « Tout voir » : fenêtres de liste complète ---
  readonly full = signal<'journal' | 'discipline' | 'annonces' | null>(null);
  who = (l: LogEntry) => l.userName ?? (l.userId === 'u-system' ? 'Système' : this.s.userName(l.userId));
  logText = (l: LogEntry) => `${l.action} ${l.detail} ${this.who(l)} ${dateFr(l.ts)}`;
  classOf = (i: Incident) => this.s.className(this.s.studentById().get(i.studentId)?.classId ?? '');
  incLabel = (i: Incident) => INCIDENT_LABEL[i.type];
  gravLabel = (i: Incident) => GRAVITE_LABEL[i.gravite];
  sancLabel = (i: Incident) => SANCTION_LABEL[i.sanction];
  incText = (i: Incident) => `${this.s.studentName(i.studentId)} ${this.classOf(i)} ${this.incLabel(i)} ${this.sancLabel(i)} ${i.description} ${dateFr(i.date)}`;
  audience = (a: Announcement) => a.audience.length ? a.audience.map((r) => ROLE_LABEL[r] ?? r).join(', ') : 'Toute l’école';
  annText = (a: Announcement) => `${a.title} ${a.body} ${dateFr(a.date)}`;
  /** La page complète n'est proposée que si le compte y a accès (mêmes droits que le menu). */
  canOpen = (p: PageId) => p === 'annonces' || (p === 'journal' ? this.s.can('journal') || this.s.can('journal.sys') : this.s.can('discipline'));
  goFull(p: PageId): void { this.full.set(null); this.s.go(p); }
  openStudent(id: string): void { this.full.set(null); this.s.go('eleve', id); }
  readonly plan = inject(Planning);
  readonly tt = inject(Timetable);
  /** Avec le serveur et un emploi du temps, les appels à faire sont les cours du jour sans appel. */
  readonly lessonsToday = signal<Lesson[]>([]);
  readonly byLesson = computed(() => this.s.apiMode() && this.tt.cells().length > 0);
  constructor() { void this.s.loadLog(); void this.loadLessons(); }
  private async loadLessons(): Promise<void> {
    if (!this.s.apiMode()) return;
    await this.tt.load();
    if (this.tt.cells().length && ['educateur', 'enseignant'].includes(this.s.role() ?? '')) this.lessonsToday.set(await this.plan.lessons(this.s.today));
  }
  readonly dateFr = dateFr; readonly dateLong = dateLong; readonly fcfa = fcfa; readonly fnum = fnum; readonly rangLabel = rangLabel; readonly mention = mention;

  /** Raccourcis d'un rôle créé par l'école : les pages que ses droits ouvrent. */
  shortcuts = computed(() => { const me = this.s.me(); return me?.perms ? adaptNav(me.role, [], me.perms) : []; });
  firstName = computed(() => {
    const n = this.s.me()?.name ?? '';
    return n;
  });
  todo = computed(() => {
    const out: { text: string; icon: string; page: 'discipline' | 'notes' | 'presences' }[] = [];
    const u = this.s.evals().filter((e) => !e.published && e.termId === this.s.termId() && this.s.gradeCount(e.id, e.classId) > 0).length;
    if (u) out.push({ text: `${u} évaluation(s) saisie(s) à publier aux familles`, icon: 'clipboard', page: 'notes' });
    const d = this.s.pendingIncidents().length;
    if (d) out.push({ text: `${d} sanction(s) grave(s) à valider`, icon: 'shield', page: 'discipline' });
    const j = this.s.pendingJustifs().length;
    if (j) out.push({ text: `${j} justificatif(s) d’absence en attente`, icon: 'calendar', page: 'presences' });
    return out;
  });
  schoolAvg = computed(() => { const v = this.classAvgs().map((c) => c.avg).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
  levels = computed(() => {
    const m = new Map<string, number>();
    for (const c of this.s.classes()) m.set(c.level, (m.get(c.level) ?? 0) + (this.s.studentsByClass().get(c.id)?.length ?? 0));
    const e = [...m.entries()]; const max = Math.max(1, ...e.map((x) => x[1]));
    return e.map(([name, n]) => ({ name, n, pct: (n / max) * 100 }));
  });
  activeAccounts = computed(() => this.s.users().filter((u) => u.active).length);
  tempAccounts = computed(() => this.s.users().filter((u) => u.mustChange).length);
  appelsLeft = computed(() => (this.byLesson() ? this.lessonsToday().filter((l) => !l.done && !l.replacedOut).length : this.s.classes().filter((c) => !this.s.isAppelDone(c.id, this.s.today, 'Matin')).length));
  topAbsent = computed(() => {
    const m = new Map<string, number>();
    for (const a of this.s.absences()) if (a.status === 'A' && a.justif !== 'acceptee') m.set(a.studentId, (m.get(a.studentId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n, name: this.s.studentName(id), cls: this.s.className(this.s.studentById().get(id)?.classId ?? '') }));
  });
  classAvgs = computed(() => this.s.classes().map((c) => ({ name: c.name, avg: this.s.classStats(c.id, true)?.avg ?? null })));
  principalNames = computed(() => this.s.myPrincipalClasses().map((c) => c.name).join(', '));
  appelTodo = computed(() => (this.byLesson()
    ? this.lessonsToday().filter((l) => !l.done && !l.replacedOut).map((l) => `${l.className} (${l.start})`)
    : this.s.myClassIds().filter((c) => !this.s.isAppelDone(c, this.s.today, 'Matin')).map((c) => this.s.className(c))));
  pending(classId: string, subjectId: string): string {
    const evs = this.s.evalsFor(classId, subjectId);
    const empty = evs.filter((e) => this.s.gradeCount(e.id, classId) === 0).length;
    const draft = evs.filter((e) => !e.published && this.s.gradeCount(e.id, classId) > 0).length;
    if (empty) return `${empty} évaluation(s) sans notes`;
    if (draft) return `${draft} évaluation(s) en attente de publication`;
    return 'Tout est à jour';
  }
  /** Tendances affichées sous les indicateurs. */
  sp = computed(() => {
    const evs = new Map(this.s.evals().map((e) => [e.id, e]));
    const kid = this.s.activeChild();
    const all = new Map<string, number[]>(), mine = new Map<string, number[]>();
    for (const [k, g] of Object.entries(this.s.grades())) {
      const [eid, sid] = k.split('|');
      const e = evs.get(eid);
      if (!e || !e.published) continue;
      const m = e.date.slice(0, 7), n = sur20(g, e.bareme);
      (all.get(m) ?? all.set(m, []).get(m)!).push(n);
      if (kid && sid === kid.id) (mine.get(m) ?? mine.set(m, []).get(m)!).push(n);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const wk = new Map<string, number>();
    for (const a of this.s.absences()) {
      if (a.status !== 'A') continue;
      const dow = new Date(a.date + 'T12:00:00Z').getUTCDay();
      const w = addDays(a.date, -((dow + 6) % 7));
      wk.set(w, (wk.get(w) ?? 0) + 1);
    }
    return {
      avg: [...all.keys()].sort().map((m) => mean(all.get(m)!)),
      kid: [...mine.keys()].sort().map((m) => mean(mine.get(m)!)),
      cash: [...this.s.finance().byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1]),
      abs: [...wk.keys()].sort().slice(-12).map((w) => wk.get(w)!),
    };
  });
  rate = computed(() => { const f = this.s.finance(); return f.dueToDate ? (f.collected / f.dueToDate) * 100 : 0; });
  months = computed(() => {
    const e = [...this.s.finance().byMonth.entries()].sort();
    const max = Math.max(1, ...e.map((x) => x[1]));
    return e.map(([k, v]) => ({ k, label: monthLabel(k), v, pct: (v / max) * 100 }));
  });
  modes = computed(() => {
    const e = [...this.s.finance().byMode.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...e.map((x) => x[1]));
    return e.map(([k, v]) => ({ k, label: MODE_LABEL[k as PayMode], v, pct: (v / max) * 100 }));
  });
  res = computed(() => { const k = this.s.activeChild(); return k ? this.s.resultOf(k.id, true) : undefined; });
  effectif = computed(() => { const k = this.s.activeChild(); return k ? this.s.classStats(k.classId, true)?.effectif ?? this.s.studentsByClass().get(k.classId)?.length ?? 0 : 0; });
  abs = computed(() => { const k = this.s.activeChild(); return (k && this.s.absByStudent().get(k.id)) || { a: 0, r: 0, aJust: 0, pending: 0 }; });
  bal = computed(() => { const k = this.s.activeChild(); return k ? this.s.balance(k.id) : { total: 0, paid: 0, solde: 0, overdue: 0 }; });
}
