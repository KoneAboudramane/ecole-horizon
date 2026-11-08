import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal, FitHeight } from '../ui';
import { dateFr, fnum } from '../format';
import { DEFAULT_BAREMES, GRAVITE_LABEL, Gravite, INCIDENT_LABEL, Incident, IncidentType, SANCTION_LABEL, Sanction } from '../models';

@Component({
  selector: 'app-discipline',
  imports: [FitHeight, FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Discipline</h1><p>Incidents et sanctions. Les sanctions graves et les exclusions temporaires sont soumises à la validation de la direction avant d’être communiquées aux familles.</p></div>
      @if (s.can('discipline')) { <button class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Signaler un incident</button> }</div>
    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Incidents enregistrés</span><span class="value">{{ s.incidents().length }}</span></div>
      <div class="card kpi-card" [class.alert]="s.pendingIncidents().length > 0"><span class="label">À valider par la direction</span><span class="value">{{ s.pendingIncidents().length }}</span></div>
      <div class="card kpi-card"><span class="label">Élèves concernés</span><span class="value">{{ concerned() }}</span></div>
    </div>
    @if (s.pendingIncidents().length) {
      <div class="card">
        <div class="card-head"><h2>Sanctions en attente de validation</h2></div>
        <div class="table-wrap"><table class="table"><tbody>
          @for (i of s.pendingIncidents(); track i.id) {
            <tr><td class="cell-main">{{ s.studentName(i.studentId) }}<div class="tiny muted">{{ s.className(s.studentById().get(i.studentId)?.classId ?? '') }} · {{ dateFr(i.date) }}</div></td>
              <td>{{ incLabel[i.type] }}<div class="small muted">{{ i.description }}</div></td>
              <td><span class="pill bad">{{ sancLabel[i.sanction] }}</span><div class="tiny muted">proposée par {{ s.userName(i.byUserId) }}</div></td>
              <td class="right nowrap">@if (s.can('discipline.validate')) { <button class="btn sm primary" (click)="decide(i, true)">Valider</button> <button class="btn sm danger" (click)="decide(i, false)">Refuser</button> } @else { <span class="pill warn">En attente</span> }</td></tr>
          }</tbody></table></div>
      </div>
    }
    <div class="card" appFitHeight>
      <div class="card-head"><div class="row">
        <select [ngModel]="cls()" (ngModelChange)="cls.set($event)" style="width:auto" aria-label="Classe"><option value="">Toutes les classes</option>@for (c of s.scopeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
        <select [ngModel]="stat()" (ngModelChange)="stat.set($event)" style="width:auto" aria-label="Statut"><option value="">Tous les statuts</option><option value="valide">Validées</option><option value="a_valider">À valider</option><option value="refuse">Refusées</option></select></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Élève</th><th>Incident</th><th>Gravité</th><th>Sanction</th><th>Statut</th></tr></thead><tbody>
        @for (i of list(); track i.id) {
          <tr><td class="nowrap">{{ dateFr(i.date) }}</td><td class="cell-main">{{ s.studentName(i.studentId) }}<div class="tiny muted">{{ s.className(s.studentById().get(i.studentId)?.classId ?? '') }}</div></td>
            <td>{{ incLabel[i.type] }}<div class="small muted">{{ i.description }}</div></td>
            <td><span class="pill" [class.bad]="i.gravite === 'grave'" [class.warn]="i.gravite === 'moyenne'">{{ gravLabel[i.gravite] }}</span></td>
            <td>{{ sancLabel[i.sanction] }}</td>
            <td>@switch (i.status) { @case ('valide') { <span class="pill ok">Validée</span> } @case ('a_valider') { <span class="pill warn">À valider</span> } @default { <span class="pill">Refusée</span> } }
              @if (i.decisionNote) { <div class="tiny muted">{{ i.decisionNote }}</div> }</td></tr>
        } @empty { <tr><td colspan="6" class="empty">Aucun incident.</td></tr> }</tbody></table></div>
    </div>
  </div>

  @if (adding()) {
    <app-modal title="Signaler un incident" size="wide" (closed)="adding.set(false)">
      <div class="stack">
        <div class="field"><span>Élève</span>
          @if (picked(); as p) { <div class="row card flat pad"><b class="grow">{{ s.studentName(p) }}</b><span class="muted small">{{ s.className(s.studentById().get(p)?.classId ?? '') }}</span><button class="link small" (click)="picked.set(null)">Changer</button></div> }
          @else {
            <input type="search" [ngModel]="sq()" (ngModelChange)="sq.set($event)" placeholder="Tapez un nom ou un matricule" />
            @for (r of found(); track r.id) { <button type="button" class="btn ghost block" style="justify-content:flex-start" (click)="picked.set(r.id)">{{ r.nom }} {{ r.prenoms }} <span class="muted small">· {{ s.className(r.classId) }}</span></button> }
            @if (touched() && !picked()) { <span class="err" style="color:var(--bad);font-size:12.5px">Choisissez un élève</span> }
          }
        </div>
        <div class="form-grid">
          <label class="field"><span>Incident</span><select [(ngModel)]="f.type" name="ty">@for (k of incTypes; track k) { <option [value]="k">{{ incLabel[k] }}</option> }</select></label>
          <label class="field"><span>Gravité</span><select [(ngModel)]="f.gravite" name="gr"><option value="legere">Légère</option><option value="moyenne">Moyenne</option><option value="grave">Grave</option></select></label>
          <label class="field"><span>Sanction proposée</span><select [ngModel]="f.sanction" (ngModelChange)="pickSanction($event)" name="sa">@for (k of sancTypes; track k) { <option [value]="k">{{ sancLabel[k] }}</option> }</select></label>
          <label class="field"><span>Date</span><input type="date" [(ngModel)]="f.date" [max]="s.today" name="dt" /></label>
          @if (s.can('conduite')) {
            <label class="field"><span>Points retirés de la conduite</span><input type="number" min="0" max="20" step="0.5" [(ngModel)]="f.retrait" name="rt" />
              <span class="tiny muted">À votre appréciation (suggestion : {{ fnum(bareme(f.sanction), 1) }}). 0 : aucun retrait.</span></label>
          }
        </div>
        <label class="field"><span>Description des faits</span><textarea rows="3" [(ngModel)]="f.description" name="de" placeholder="Que s’est-il passé ? Restez factuel."></textarea>@if (touched() && f.description.trim().length < 5) { <span class="err">Décrivez les faits</span> }</label>
        @if (needsValidation()) { <div class="banner warn"><app-icon name="shield" [size]="18" /> Cette sanction sera transmise à la direction. La famille ne sera informée qu’après sa validation.</div> }
      </div>
      <div footer><button class="btn ghost" (click)="adding.set(false)">Annuler</button><button class="btn primary" (click)="save()">Enregistrer</button></div>
    </app-modal>
  }
  @if (deciding(); as d) {
    <app-modal [title]="d.accept ? 'Valider la sanction' : 'Refuser la sanction'" (closed)="deciding.set(null)">
      <p>{{ s.studentName(d.inc.studentId) }} · {{ sancLabel[d.inc.sanction] }}</p>
      <label class="field" style="margin-top:12px"><span>Note de la direction (facultatif)</span><input [(ngModel)]="note" name="nt" /></label>
      <div footer><button class="btn ghost" (click)="deciding.set(null)">Annuler</button><button class="btn" [class.primary]="d.accept" [class.danger]="!d.accept" (click)="confirm()">{{ d.accept ? 'Valider et informer la famille' : 'Refuser' }}</button></div>
    </app-modal>
  }`,
})
export class Discipline {
  readonly s = inject(Store); readonly dateFr = dateFr;
  readonly incLabel = INCIDENT_LABEL; readonly sancLabel = SANCTION_LABEL; readonly gravLabel = GRAVITE_LABEL;
  readonly incTypes = Object.keys(INCIDENT_LABEL) as IncidentType[]; readonly sancTypes = Object.keys(SANCTION_LABEL) as Sanction[];
  cls = signal(''); stat = signal('');
  adding = signal(false); touched = signal(false); picked = signal<string | null>(null); sq = signal('');
  f = { type: 'bavardage' as IncidentType, gravite: 'legere' as Gravite, sanction: 'observation' as Sanction, date: this.s.today, description: '', retrait: 0 };
  deciding = signal<{ inc: Incident; accept: boolean } | null>(null); note = '';
  concerned = computed(() => new Set(this.s.incidents().map((i) => i.studentId)).size);
  list = computed(() => this.s.incidents().filter((i) => (!this.cls() || this.s.studentById().get(i.studentId)?.classId === this.cls()) && (!this.stat() || i.status === this.stat()))
    .sort((a, b) => b.date.localeCompare(a.date)));
  found = computed(() => { const t = this.sq().trim().toLowerCase(); return t.length < 2 ? [] : this.s.students().filter((x) => `${x.nom} ${x.prenoms} ${x.matricule}`.toLowerCase().includes(t)).slice(0, 6); });
  needsValidation = () => (this.f.gravite === 'grave' || this.f.sanction === 'exclusion_temp') && !this.s.can('discipline.validate');
  readonly fnum = fnum;
  bareme = (k: string) => this.s.school().conduiteBaremes?.[k] ?? DEFAULT_BAREMES[k] ?? 1;
  pickSanction(k: Sanction): void { this.f.sanction = k; this.f.retrait = this.bareme(k); }
  openNew(): void { this.f = { type: 'bavardage', gravite: 'legere', sanction: 'observation', date: this.s.today, description: '', retrait: this.bareme('observation') }; this.picked.set(null); this.sq.set(''); this.touched.set(false); this.adding.set(true); }
  async save(): Promise<void> {
    this.touched.set(true);
    if (!this.picked() || this.f.description.trim().length < 5) return;
    const pending = this.needsValidation();
    const r = await this.s.addIncidentAsync({ studentId: this.picked()!, type: this.f.type, gravite: this.f.gravite, sanction: this.f.sanction, date: this.f.date, description: this.f.description.trim(), retrait: this.s.can('conduite') && Number(this.f.retrait) > 0 ? Number(this.f.retrait) : undefined });
    if (!r.ok) return void this.s.toast(r.error ?? 'Enregistrement impossible.', 'err');
    this.adding.set(false);
    this.s.toast(pending ? 'Incident enregistré. La direction doit valider la sanction.' : 'Incident enregistré, la famille est informée.');
  }
  decide(inc: Incident, accept: boolean): void { this.note = ''; this.deciding.set({ inc, accept }); }
  async confirm(): Promise<void> { const d = this.deciding()!; if (!(await this.s.decideIncidentAsync(d.inc.id, d.accept, this.note.trim()))) return; this.deciding.set(null); this.s.toast(d.accept ? 'Sanction validée, famille informée.' : 'Sanction refusée.'); }
}
