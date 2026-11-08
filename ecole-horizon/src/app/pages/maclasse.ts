import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { FitHeight, Icon, Modal } from '../ui';
import { dateFr, fnum, rangLabel } from '../format';
import { mention, sur20 } from '../engine';
import { EVAL_LABEL, PrincipalClass } from '../models';

type Tab = 'res' | 'notes' | 'assiduite' | 'discipline' | 'conseil';

// ---------- Professeur principal : sa classe ----------
@Component({
  selector: 'app-maclasse',
  imports: [FormsModule, Icon, Modal, FitHeight],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Ma classe</h1><p>Professeur principal{{ d() ? ' de la ' + d()!.className + ' · ' + d()!.termLabel : '' }}. Toutes les notes sont en lecture seule : elles restent à leur enseignant.</p></div>
      @if (s.myPrincipalClasses().length > 1) {
        <label class="field" style="min-width:160px"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cid.set($event)">@for (c of s.myPrincipalClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      }</div>

    @if (!s.myPrincipalClasses().length) {
      <div class="card"><div class="empty">Vous n’êtes professeur principal d’aucune classe. La direction ou le secrétariat l’attribue depuis la page « Classes ».</div></div>
    } @else if (err()) {
      <div class="banner bad" role="alert">{{ err() }}</div>
    } @else if (d(); as x) {
      <div class="grid kpi">
        <div class="card kpi-card"><span class="label">Élèves</span><span class="value">{{ x.students.length }}</span></div>
        <div class="card kpi-card"><span class="label">Moyenne de la classe</span><span class="value">{{ fnum(x.stats?.avg ?? null) }}<span class="muted small"> /20</span></span><span class="hint">toutes notes saisies</span></div>
        <div class="card kpi-card" [class.alert]="totalNj() > 0"><span class="label">Absences non justifiées</span><span class="value">{{ totalNj() }}</span></div>
        <div class="card kpi-card" [class.alert]="x.incidents.length > 0"><span class="label">Incidents</span><span class="value">{{ x.incidents.length }}</span></div>
      </div>

      <div class="tabs" role="tablist">
        <button class="tab" [class.on]="tab() === 'res'" (click)="tab.set('res')">Résultats</button>
        <button class="tab" [class.on]="tab() === 'notes'" (click)="tab.set('notes')">Notes par matière</button>
        <button class="tab" [class.on]="tab() === 'assiduite'" (click)="tab.set('assiduite')">Assiduité</button>
        <button class="tab" [class.on]="tab() === 'discipline'" (click)="tab.set('discipline')">Discipline</button>
        <button class="tab" [class.on]="tab() === 'conseil'" (click)="tab.set('conseil')">Avis du conseil</button>
      </div>

      @switch (tab()) {
        @case ('res') {
          <div class="card" appFitHeight><div class="table-wrap"><table class="table hover">
            <thead><tr><th>Rang</th><th>Élève</th><th class="num">Moyenne</th><th>Mention</th><th class="num">Abs. non just.</th><th class="num">Retards</th><th class="num">Incidents</th></tr></thead>
            <tbody>@for (r of ranking(); track r.id) {
              <tr style="cursor:pointer" (click)="open.set(r.id)"><td>{{ rangLabel(r.rang) }}</td><td class="cell-main">{{ r.name }}</td><td class="num"><b>{{ fnum(r.moy) }}</b></td>
                <td>{{ mention(r.moy, s.school().seuils) }}</td><td class="num">{{ r.nj }}</td><td class="num">{{ r.ret }}</td><td class="num">{{ r.inc }}</td></tr>
            }</tbody></table></div></div>
        }
        @case ('notes') {
          <div class="chips" role="group" aria-label="Matière">@for (sb of x.subjects; track sb.id) { <button class="chip" [class.on]="subj() === sb.id" (click)="subj.set(sb.id)">{{ sb.name }}</button> }</div>
          <div class="card" appFitHeight><div class="table-wrap"><table class="table">
            <thead><tr><th>Élève</th>@for (e of subjEvals(); track e.id) { <th class="num" [title]="e.teacherName">{{ e.title }}<div class="tiny muted">{{ evalLabel[e.type] }} · /{{ e.bareme }}{{ e.published ? '' : ' · brouillon' }}</div></th> }<th class="num">Moyenne</th></tr></thead>
            <tbody>@for (st of x.students; track st.id) {
              <tr><td class="cell-main">{{ st.nom }} {{ st.prenoms }}</td>
                @for (e of subjEvals(); track e.id) { <td class="num">{{ note(e.id, st.id) }}</td> }
                <td class="num"><b>{{ fnum(subjMoy(st.id)) }}</b></td></tr>
            } @empty { <tr><td class="empty">Aucun élève.</td></tr> }</tbody></table></div>
            @if (!subjEvals().length) { <div class="empty">Aucune évaluation dans cette matière pour cette période.</div> }
          </div>
        }
        @case ('assiduite') {
          <div class="card" appFitHeight><div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Élève</th><th>Demi-journée</th><th>Type</th><th>Justificatif</th></tr></thead>
            <tbody>@for (a of x.absences; track $index) {
              <tr><td>{{ dateFr(a.date) }}</td><td class="cell-main">{{ name(a.studentId) }}</td><td>{{ a.slot }}</td><td>{{ a.status === 'R' ? 'Retard' : 'Absence' }}</td>
                <td>@if (a.status === 'R') { — } @else { <span class="pill" [class.ok]="a.justif === 'acceptee'" [class.warn]="a.justif !== 'acceptee'">{{ justifLabel[a.justif] ?? a.justif }}</span> }</td></tr>
            } @empty { <tr><td colspan="5" class="empty">Aucune absence ni retard cette période.</td></tr> }</tbody></table></div></div>
        }
        @case ('discipline') {
          <div class="card" appFitHeight><div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Élève</th><th>Motif</th><th>Sanction</th><th>Description</th></tr></thead>
            <tbody>@for (i of x.incidents; track $index) {
              <tr><td>{{ dateFr(i.date) }}</td><td class="cell-main">{{ name(i.studentId) }}</td><td>{{ i.type }}@if (i.status === 'a_valider') { <span class="pill warn">à valider</span> }</td><td>{{ i.sanction }}</td><td class="small">{{ i.description }}</td></tr>
            } @empty { <tr><td colspan="5" class="empty">Aucun incident cette période.</td></tr> }</tbody></table></div></div>
        }
        @case ('conseil') {
          @if (x.locked) { <div class="banner warn"><app-icon name="lock" [size]="18" /> Cette période est verrouillée : les avis ne peuvent plus être modifiés.</div> }
          <div class="card" appFitHeight><div class="table-wrap"><table class="table">
            <thead><tr><th>Élève</th><th class="num">Moyenne</th><th class="num">Rang</th><th>Avis du conseil de classe</th><th></th></tr></thead>
            <tbody>@for (r of ranking(); track r.id) {
              <tr><td class="cell-main">{{ r.name }}</td><td class="num">{{ fnum(r.moy) }}</td><td class="num">{{ rangLabel(r.rang) }}</td>
                <td style="min-width:280px"><input class="inline-input" style="width:100%" maxlength="300" [disabled]="x.locked" [ngModel]="drafts[r.id] ?? ''" (ngModelChange)="drafts[r.id] = $event" [attr.aria-label]="'Avis du conseil pour ' + r.name" placeholder="Ex. Encouragements du conseil" /></td>
                <td class="right"><button class="btn sm" [disabled]="x.locked || saving() === r.id || (drafts[r.id] ?? '') === (x.council[r.id] ?? '')" (click)="saveCouncil(r.id)">Enregistrer</button></td></tr>
            }</tbody></table></div></div>
        }
      }
    } @else {
      <div class="card"><div class="empty">Chargement…</div></div>
    }
  </div>

  @if (open(); as sid) {
    <app-modal [title]="name(sid)" size="wide" (closed)="open.set(null)">
      <div class="table-wrap"><table class="table"><thead><tr><th>Matière</th><th>Notes</th><th class="num">Moyenne</th><th class="num">Rang</th></tr></thead><tbody>
        @for (l of studentLines(sid); track l.id) {
          <tr><td class="cell-main">{{ l.name }}<div class="tiny muted">coef. {{ l.coef }}</div></td>
            <td><div class="chips">@for (g of l.grades; track g.t) { <span class="pill" [class.ok]="g.n20 >= 10" [class.bad]="g.n20 < 10" [title]="g.t">{{ g.t }} : {{ fnum(g.v) }}@if (g.b !== 20) {/{{ g.b }}}</span> } @empty { <span class="muted small">—</span> }</div></td>
            <td class="num"><b>{{ fnum(l.moy) }}</b></td><td class="num">{{ rangLabel(l.rang) }}</td></tr>
        }</tbody></table></div>
      <div footer><button class="btn ghost" (click)="open.set(null)">Fermer</button><button class="btn" (click)="s.go('eleve', sid)">Fiche de l’élève</button></div>
    </app-modal>
  }`,
})
export class MaClassePage {
  readonly s = inject(Store);
  readonly fnum = fnum; readonly dateFr = dateFr; readonly rangLabel = rangLabel; readonly mention = mention; readonly evalLabel = EVAL_LABEL;
  readonly justifLabel: Partial<Record<string, string>> = { aucune: 'Aucun', en_attente: 'En attente', acceptee: 'Accepté', refusee: 'Refusé' };
  readonly cid = signal(this.s.myPrincipalClasses()[0]?.id ?? '');
  readonly tab = signal<Tab>('res');
  readonly d = signal<PrincipalClass | null>(null);
  readonly err = signal('');
  readonly subj = signal('');
  readonly open = signal<string | null>(null);
  readonly saving = signal<string | null>(null);
  drafts: Partial<Record<string, string>> = {};

  constructor() {
    // Recharge à chaque changement de classe ou de période (sélecteur du haut).
    effect(() => {
      const id = this.cid(); this.s.termId();
      if (id) untracked(() => void this.load(id));
    });
  }
  private async load(id: string): Promise<void> {
    this.err.set('');
    const r = await this.s.principalClassAsync(id);
    if (r.error) { this.err.set(r.error); return; }
    this.d.set(r.data ?? null);
    this.drafts = { ...(r.data?.council ?? {}) };
    if (!r.data?.subjects.some((x) => x.id === this.subj())) this.subj.set(r.data?.subjects[0]?.id ?? '');
  }

  name = (sid: string) => { const st = this.d()?.students.find((x) => x.id === sid); return st ? `${st.nom} ${st.prenoms}` : '—'; };
  readonly totalNj = computed(() => Object.values(this.d()?.assiduite ?? {}).reduce((a, v) => a + v.nonJustifiees, 0));
  readonly ranking = computed(() => {
    const x = this.d(); if (!x) return [];
    const inc = new Map<string, number>(); for (const i of x.incidents) inc.set(i.studentId, (inc.get(i.studentId) ?? 0) + 1);
    return x.students.map((st) => {
      const r = x.stats?.results.get(st.id), a = x.assiduite[st.id];
      return { id: st.id, name: `${st.nom} ${st.prenoms}`, moy: r?.moyenne ?? null, rang: r?.rang ?? null, nj: a?.nonJustifiees ?? 0, ret: a?.retards ?? 0, inc: inc.get(st.id) ?? 0 };
    }).sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999) || a.name.localeCompare(b.name));
  });
  readonly subjEvals = computed(() => (this.d()?.evals ?? []).filter((e) => e.subjectId === this.subj()));
  note(evalId: string, sid: string): string { const v = this.d()?.grades[`${evalId}|${sid}`]; return v === undefined ? '—' : fnum(v); }
  subjMoy(sid: string): number | null { return this.d()?.stats?.results.get(sid)?.subjects.find((x) => x.subjectId === this.subj())?.moy ?? null; }
  studentLines(sid: string) {
    const x = this.d(); if (!x) return [];
    const res = x.stats?.results.get(sid);
    return x.subjects.map((sb) => {
      const r = res?.subjects.find((y) => y.subjectId === sb.id);
      const grades = x.evals.filter((e) => e.subjectId === sb.id).flatMap((e) => {
        const v = x.grades[`${e.id}|${sid}`];
        return v === undefined ? [] : [{ t: e.title, v, b: e.bareme, n20: sur20(v, e.bareme) }];
      });
      return { id: sb.id, name: sb.name, coef: sb.coef, grades, moy: r?.moy ?? null, rang: r?.rang ?? null };
    });
  }
  async saveCouncil(sid: string): Promise<void> {
    const x = this.d(); if (!x) return;
    const text = (this.drafts[sid] ?? '').trim();
    this.saving.set(sid);
    const ok = await this.s.setConseilAsync(sid, this.s.termId(), text);
    this.saving.set(null);
    if (!ok) return;
    this.d.set({ ...x, council: { ...x.council, [sid]: text } });
    this.s.toast(text ? `Avis enregistré pour ${this.name(sid)}.` : `Avis retiré pour ${this.name(sid)}.`);
  }
}
