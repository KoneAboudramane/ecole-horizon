import { FitHeight } from '../ui';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store, ArchiveData } from '../store';
import { fnum } from '../format';
import { DECISION_LABEL, DecisionValue } from '../engine';

@Component({
  selector: 'app-archives',
  imports: [FitHeight, FormsModule],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Années précédentes</h1>
      <p>Retrouvez les résultats et les bulletins des années passées, tels qu’ils étaient à l’époque : classe d’alors, moyennes, décision. Consultation seulement.</p></div></div>
    @if (err()) { <div class="banner bad">{{ err() }}</div> }
    @if (data(); as d) {
      @if (!d.years.length) { <div class="card pad empty">Aucune année précédente pour le moment. Elles apparaissent après le premier passage à l’année suivante.</div> }
      @else {
        <div class="card pad row">
          <label class="field"><span>Année</span><select [ngModel]="d.year" (ngModelChange)="load($event)">@for (y of d.years; track y) { <option [value]="y">{{ y }}</option> }</select></label>
          @if (!family()) { <label class="field grow"><span>Rechercher</span><input name="q" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Nom, matricule ou classe" /></label> }
        </div>
        <div class="card" appFitHeight><div class="table-wrap"><table class="table">
          <thead><tr><th>Élève</th><th>Classe</th><th class="num">Moyenne annuelle</th><th>Décision</th><th>Bulletins</th></tr></thead>
          <tbody>
            @for (r of rows(); track r.student) {
              <tr>
                <td class="cell-main">{{ r.name }}<div class="tiny muted">{{ r.matricule }}</div></td>
                <td>{{ r.class_name }}</td>
                <td class="num"><b>{{ fnum(r.annual_avg) }}</b></td>
                <td>@if (r.decision) { <span class="pill">{{ lbl(r.decision) }}</span> } @else { <span class="muted">—</span> }
                  @if (r.sortie) { <span class="pill bad">{{ r.sortie === 'exclu' ? 'Exclu(e)' : r.sortie === 'ancien' ? 'Ancien élève' : 'Parti(e)' }}</span> }</td>
                <td><div class="row">@for (t of d.terms; track t.code) { <button class="btn sm" [disabled]="busy()" (click)="pdf(r.student, r.name, t.code)" [attr.aria-label]="'Bulletin ' + t.label + ' de ' + r.name">{{ t.label }}</button> }</div></td>
              </tr>
            } @empty { <tr><td colspan="5" class="empty">Aucun résultat pour cette année.</td></tr> }
          </tbody></table></div></div>
      }
    } @else if (!err()) { <div class="card pad muted">Chargement…</div> }
  </div>`,
})
export class ArchivesPage {
  readonly s = inject(Store); readonly fnum = fnum;
  data = signal<ArchiveData | null>(null); err = signal(''); q = signal(''); busy = signal(false);
  family = computed(() => this.s.role() === 'parent' || this.s.role() === 'eleve');
  constructor() { void this.load(); }
  lbl(v: string): string { return DECISION_LABEL[v as DecisionValue] ?? v; }
  async load(year?: string): Promise<void> {
    const r = await this.s.archives(year);
    if (!r.data) return void this.err.set(r.error ?? 'Consultation impossible.');
    this.err.set(''); this.data.set(r.data);
  }
  rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return (this.data()?.rows ?? []).filter((r) => !q || `${r.name} ${r.matricule} ${r.class_name}`.toLowerCase().includes(q));
  });
  async pdf(id: number, name: string, term: string): Promise<void> {
    this.busy.set(true);
    await this.s.archivePdf(String(id), this.data()!.year!, term, `bulletin-${name.toLowerCase().replace(/\s+/g, '-')}-${this.data()!.year}-${term}.pdf`);
    this.busy.set(false);
  }
}
