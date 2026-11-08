import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Chart, Serie } from '../charts';
import { DECISION_LABEL, DecisionValue, mention, proposeDecision, sur20 } from '../engine';
import { DEMO_TODAY, addDays, fcfa, fnum, monthLabel } from '../format';
import { GRAVITE_LABEL, INCIDENT_LABEL, MODE_LABEL, PayMode } from '../models';

const pct0 = (n: number) => `${Math.round(n)} %`;
const pct1 = (n: number) => `${fnum(n, 1)} %`;
const int = (n: number) => String(Math.round(n));
const note = (n: number) => fnum(n, 1);
const short = (n: number) => (n >= 1e6 ? `${fnum(n / 1e6, 1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(Math.round(n)));
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function bins(values: number[], edges: number[]): { labels: string[]; counts: number[] } {
  const labels: string[] = [], counts: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    labels.push(`${edges[i]}–${edges[i + 1]}`);
    counts.push(values.filter((v) => v >= edges[i] && (v < edges[i + 1] || (i === edges.length - 2 && v <= edges[i + 1]))).length);
  }
  return { labels, counts };
}
const weekStart = (iso: string): string => {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
};

@Component({
  selector: 'app-stats',
  imports: [FormsModule, Chart],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>{{ family() ? 'Progression' : 'Statistiques' }}</h1><p>{{ intro() }}</p></div></div>

    @if (family()) {
      @if (s.myChildren().length > 1) {
        <div class="card pad row"><label class="field"><span>Enfant</span>
          <select [ngModel]="s.activeChild().id" (ngModelChange)="s.pickChild($event)">@for (k of s.myChildren(); track k.id) { <option [value]="k.id">{{ k.prenoms }} {{ k.nom }}</option> }</select></label></div>
      }
      <div class="grid kpi">
        @for (k of kidKpis(); track k.l) { <div class="card kpi-card"><span class="label">{{ k.l }}</span><span class="value">{{ k.v }}</span><span class="hint">{{ k.h }}</span></div> }
      </div>
      <div class="grid two">
        <div class="card pad stack"><div><h3>Notes par matière</h3><p class="small muted">Votre moyenne comparée à celle de la classe (notes publiées).</p></div>
          <app-chart type="bar" [labels]="kidSubj().labels" [series]="kidSubj().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Notes par matière" /></div>
        <div class="card pad stack"><div><h3>Évolution dans l’année</h3><p class="small muted">Moyenne mensuelle des notes publiées, comparée à la classe.</p></div>
          <app-chart type="line" [labels]="kidMonthly().labels" [series]="kidMonthly().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Évolution dans l’année" /></div>
      </div>
    }

    @if (dir() || role() === 'comptable') {
      <div class="grid kpi">
        @for (k of kpis(); track k.l) { <div class="card kpi-card"><span class="label">{{ k.l }}</span><span class="value">{{ k.v }}</span><span class="hint">{{ k.h }}</span></div> }
      </div>
    }

    @if (dir()) {
      <h2 class="sec">Résultats scolaires</h2>
      <div class="grid two">
        <div class="card pad stack"><div><h3>Moyenne par classe</h3><p class="small muted">Moyenne générale pondérée de chaque classe. Trait pointillé : 10/20.</p></div>
          <app-chart type="hbar" [labels]="classAvg().labels" [series]="classAvg().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Moyenne par classe" /></div>
        <div class="card pad stack"><div><h3>Taux de réussite par classe</h3><p class="small muted">Part des élèves ayant 10/20 ou plus de moyenne.</p></div>
          <app-chart type="hbar" [labels]="classPass().labels" [series]="classPass().series" [yMax]="100" [fmt]="pct0" label="Taux de réussite par classe" /></div>
        <div class="card pad stack"><div><h3>Répartition des moyennes</h3><p class="small muted">Nombre d’élèves par tranche de moyenne générale.</p></div>
          <app-chart type="bar" [labels]="distrib().labels" [series]="distrib().series" [fmt]="int" label="Répartition des moyennes" /></div>
        <div class="card pad stack"><div><h3>Mentions</h3><p class="small muted">Selon les seuils définis dans les paramètres.</p></div>
          <app-chart type="bar" [labels]="mentions().labels" [series]="mentions().series" [fmt]="int" label="Mentions" /></div>
        <div class="card pad stack"><div><h3>Moyenne par matière</h3><p class="small muted">Moyenne de tous les élèves de l’établissement.</p></div>
          <app-chart type="hbar" [labels]="subjAvg().labels" [series]="subjAvg().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Moyenne par matière" /></div>
        <div class="card pad stack"><div><h3>Évolution des notes dans l’année</h3><p class="small muted">Moyenne mensuelle de toutes les notes saisies.</p></div>
          <app-chart type="line" [labels]="monthlyAll().labels" [series]="monthlyAll().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Évolution des notes dans l’année" /></div>
        <div class="card pad stack"><div><h3>Décisions de fin d’année</h3><p class="small muted">Décisions validées, ou propositions pour les élèves sans décision.</p></div>
          <app-chart type="bar" [labels]="decis().labels" [series]="decis().series" [fmt]="int" label="Décisions de fin d’année" /></div>
        <div class="card pad stack"><div><h3>Effectifs par niveau</h3><p class="small muted">Filles et garçons.</p></div>
          <app-chart type="bar" [stacked]="true" [labels]="levels().labels" [series]="levels().series" [fmt]="int" label="Effectifs par niveau" /></div>
      </div>
    }

    @if (role() === 'enseignant') {
      <div class="card pad row"><label class="field"><span>Classe et matière</span>
        <select [ngModel]="curAsg()?.id" (ngModelChange)="asgId.set($event)">@for (a of teacherAsg(); track a.id) { <option [value]="a.id">{{ a.label }}</option> }</select></label></div>
      <div class="grid two">
        <div class="card pad stack"><div><h3>Moyenne de la matière par classe</h3><p class="small muted">Toutes vos classes. Trait pointillé : 10/20.</p></div>
          <app-chart type="hbar" [labels]="tClassAvg().labels" [series]="tClassAvg().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Moyenne de la matière par classe" /></div>
        <div class="card pad stack"><div><h3>Répartition des notes</h3><p class="small muted">Toutes les notes de la classe sélectionnée.</p></div>
          <app-chart type="bar" [labels]="tHisto().labels" [series]="tHisto().series" [fmt]="int" label="Répartition des notes" /></div>
        <div class="card pad stack"><div><h3>Évolution par évaluation</h3><p class="small muted">Moyenne de la classe sélectionnée à chaque évaluation.</p></div>
          <app-chart type="line" [labels]="tEval().labels" [series]="tEval().series" [yMax]="20" [refLine]="10" [fmt]="note" label="Évolution par évaluation" /></div>
      </div>
    }

    @if (showFin()) {
      <h2 class="sec">Finances</h2>
      <div class="grid two">
        <div class="card pad stack"><div><h3>Encaissements cumulés et montants attendus</h3><p class="small muted">Cumul mensuel des échéances arrivées à terme et des paiements confirmés.</p></div>
          <app-chart type="line" [labels]="cumul().labels" [series]="cumul().series" [fmt]="short" [tipFmt]="fcfa" label="Encaissements cumulés et montants attendus" /></div>
        <div class="card pad stack"><div><h3>Encaissements par mois</h3><p class="small muted">Paiements confirmés.</p></div>
          <app-chart type="bar" [labels]="byMonth().labels" [series]="byMonth().series" [fmt]="short" [tipFmt]="fcfa" label="Encaissements par mois" /></div>
        <div class="card pad stack"><div><h3>Modes de paiement</h3><p class="small muted">Montants encaissés selon le moyen utilisé.</p></div>
          <app-chart type="hbar" [labels]="byMode().labels" [series]="byMode().series" [fmt]="short" [tipFmt]="fcfa" label="Modes de paiement" /></div>
        <div class="card pad stack"><div><h3>Impayés par classe</h3><p class="small muted">Montants en retard à ce jour.</p></div>
          <app-chart type="hbar" [labels]="overdue().labels" [series]="overdue().series" [fmt]="short" [tipFmt]="fcfa" label="Impayés par classe" /></div>
        <div class="card pad stack"><div><h3>Taux de recouvrement par classe</h3><p class="small muted">Part du montant total de l’année déjà payée.</p></div>
          <app-chart type="hbar" [labels]="recov().labels" [series]="recov().series" [yMax]="100" [fmt]="pct0" label="Taux de recouvrement par classe" /></div>
      </div>
    }

    @if (showVie()) {
      <h2 class="sec">Vie scolaire</h2>
      <div class="grid two">
        <div class="card pad stack"><div><h3>Absences et retards par semaine</h3><p class="small muted">Nombre d’absences et de retards enregistrés à l’appel.</p></div>
          <app-chart type="line" [labels]="weekly().labels" [series]="weekly().series" [fmt]="int" label="Absences et retards par semaine" /></div>
        <div class="card pad stack"><div><h3>Taux d’absence par classe</h3><p class="small muted">Absences rapportées au nombre de séances d’appel.</p></div>
          <app-chart type="hbar" [labels]="absRate().labels" [series]="absRate().series" [fmt]="pct1" label="Taux d’absence par classe" /></div>
        <div class="card pad stack"><div><h3>Justificatifs d’absence</h3><p class="small muted">Situation des absences enregistrées.</p></div>
          <app-chart type="bar" [labels]="justifs().labels" [series]="justifs().series" [fmt]="int" label="Justificatifs d’absence" /></div>
        <div class="card pad stack"><div><h3>Incidents par type</h3><p class="small muted">Incidents validés ou en attente de validation.</p></div>
          <app-chart type="hbar" [labels]="incTypes().labels" [series]="incTypes().series" [fmt]="int" label="Incidents par type" /></div>
        <div class="card pad stack"><div><h3>Incidents par gravité et par mois</h3><p class="small muted">Répartition mensuelle selon la gravité.</p></div>
          <app-chart type="bar" [stacked]="true" [labels]="incMonthly().labels" [series]="incMonthly().series" [fmt]="int" label="Incidents par gravité et par mois" /></div>
      </div>
    }
  </div>`,
  styles: `.sec { margin-top: 6px; } .wide { grid-column: 1 / -1; }`,
})
export class StatsPage {
  readonly s = inject(Store);
  readonly note = note; readonly int = int; readonly pct0 = pct0; readonly pct1 = pct1; readonly short = short; readonly fcfa = fcfa;
  readonly asgId = signal('');

  readonly role = this.s.role;
  readonly dir = computed(() => this.role() === 'fondateur' || this.role() === 'directeur');
  readonly family = computed(() => this.role() === 'parent' || this.role() === 'eleve');
  readonly showFin = computed(() => this.dir() || this.role() === 'comptable');
  readonly showVie = computed(() => this.dir() || this.role() === 'educateur');
  readonly intro = computed(() => ({
    fondateur: 'Vue d’ensemble de l’établissement : résultats, finances et vie scolaire.',
    directeur: 'Résultats, finances et vie scolaire de l’établissement.',
    comptable: 'Encaissements, impayés et recouvrement.',
    educateur: 'Absences, retards, justificatifs et discipline.',
    enseignant: 'Les résultats de vos classes et de votre matière.',
    parent: 'L’évolution des notes et de l’assiduité de votre enfant.',
    eleve: 'L’évolution de vos notes et de votre assiduité.',
  } as Record<string, string>)[this.role() ?? ''] ?? '');

  private readonly stats = computed(() => (this.family() ? this.s.statsPub() : this.s.statsAll()));
  private one(name: string, values: (number | null)[]): Serie[] { return [{ name, values }]; }

  // ---------- Résultats (direction) ----------
  readonly kpis = computed(() => {
    const f = this.s.finance();
    if (this.role() === 'comptable') {
      const rate = f.dueToDate ? (f.collected / f.dueToDate) * 100 : 0;
      return [
        { l: 'Encaissé', v: fcfa(f.collected), h: 'Paiements confirmés' },
        { l: 'Dû à ce jour', v: fcfa(f.dueToDate), h: 'Échéances arrivées à terme' },
        { l: 'Impayés', v: fcfa(f.overdue), h: `${f.overdueCount} élève(s) en retard` },
        { l: 'Taux de recouvrement', v: pct1(rate), h: 'Encaissé sur dû à ce jour' },
      ];
    }
    const avgs = [...this.stats().values()].map((c) => c.avg).filter((x): x is number => x !== null);
    const all = [...this.stats().values()].flatMap((c) => [...c.results.values()]).map((r) => r.moyenne).filter((x): x is number => x !== null);
    const pass = all.length ? (all.filter((v) => v >= 10).length / all.length) * 100 : null;
    const att = this.s.schoolAttendance();
    const rate = f.dueToDate ? (f.collected / f.dueToDate) * 100 : null;
    return [
      { l: 'Élèves', v: String(this.s.students().length), h: `${this.s.classes().length} classes` },
      { l: 'Moyenne générale', v: fnum(mean(avgs), 2), h: 'Moyenne des classes, sur 20' },
      { l: 'Taux de réussite', v: pass === null ? '—' : pct1(pass), h: 'Élèves à 10/20 ou plus' },
      { l: 'Assiduité', v: att === null ? '—' : pct1(att), h: 'Présence aux appels' },
      { l: 'Recouvrement', v: rate === null ? '—' : pct1(rate), h: 'Encaissé sur dû à ce jour' },
    ];
  });

  readonly classAvg = computed(() => {
    const cl = this.s.classes();
    return { labels: cl.map((c) => c.name), series: this.one('Moyenne', cl.map((c) => this.stats().get(c.id)?.avg ?? null)) };
  });
  readonly classPass = computed(() => {
    const cl = this.s.classes();
    const v = cl.map((c) => {
      const r = [...(this.stats().get(c.id)?.results.values() ?? [])].map((x) => x.moyenne).filter((x): x is number => x !== null);
      return r.length ? (r.filter((x) => x >= 10).length / r.length) * 100 : null;
    });
    return { labels: cl.map((c) => c.name), series: this.one('Réussite', v) };
  });
  private allAverages = computed(() => [...this.stats().values()].flatMap((c) => [...c.results.values()]).map((r) => r.moyenne).filter((x): x is number => x !== null));
  readonly distrib = computed(() => {
    const b = bins(this.allAverages(), [0, 6, 8, 10, 12, 14, 16, 20]);
    return { labels: b.labels, series: this.one('Élèves', b.counts) };
  });
  readonly mentions = computed(() => {
    const names = ['Très bien', 'Bien', 'Assez bien', 'Passable', 'Insuffisant'];
    const counts = names.map(() => 0);
    for (const v of this.allAverages()) counts[names.indexOf(mention(v, this.s.school().seuils))]++;
    return { labels: names, series: this.one('Élèves', counts) };
  });
  readonly subjAvg = computed(() => {
    const m = new Map<string, number[]>();
    for (const c of this.stats().values()) for (const r of c.results.values()) for (const x of r.subjects) if (x.moy !== null) { const a = m.get(x.subjectId) ?? []; a.push(x.moy); m.set(x.subjectId, a); }
    const rows = this.s.subjects().map((sj) => ({ n: sj.name, v: mean(m.get(sj.id) ?? []) })).filter((r) => r.v !== null).sort((a, b) => (b.v as number) - (a.v as number));
    return { labels: rows.map((r) => r.n), series: this.one('Moyenne', rows.map((r) => r.v)) };
  });

  /** Moyenne mensuelle des notes, pour les évaluations et élèves retenus. */
  private monthly(keep: (evalId: string, studentId: string) => boolean): { months: string[]; vals: Map<string, number[]> } {
    const ev = new Map(this.s.evals().map((e) => [e.id, e]));
    const vals = new Map<string, number[]>();
    for (const [k, g] of Object.entries(this.s.grades())) {
      const [eid, sid] = k.split('|');
      const e = ev.get(eid);
      if (!e || !keep(eid, sid)) continue;
      const mth = e.date.slice(0, 7);
      const a = vals.get(mth) ?? []; a.push(sur20(g, e.bareme)); vals.set(mth, a);
    }
    return { months: [...vals.keys()].sort(), vals };
  }
  readonly monthlyAll = computed(() => {
    const m = this.monthly(() => true);
    return { labels: m.months.map(monthLabel), series: this.one('Moyenne des notes', m.months.map((x) => mean(m.vals.get(x)!))) };
  });
  readonly decis = computed(() => {
    const keys: DecisionValue[] = ['admis', 'conseil', 'redouble', 'exclu'];
    const counts = keys.map(() => 0);
    for (const st of this.s.students()) {
      const v = this.s.decisionOf(st.id)?.value ?? proposeDecision(this.s.annualAverage(st.id).value, this.s.school(), this.s.classById().get(st.classId)?.level).value;
      if (v) counts[keys.indexOf(v)]++;
    }
    return { labels: keys.map((k) => DECISION_LABEL[k]), series: this.one('Élèves', counts) };
  });
  readonly levels = computed(() => {
    const order: string[] = [];
    for (const c of this.s.classes()) if (!order.includes(c.level)) order.push(c.level);
    const count = (lvl: string, sx: 'M' | 'F') => this.s.students().filter((st) => st.sexe === sx && this.s.levelOf(st.id) === lvl).length;
    return { labels: order, series: [{ name: 'Filles', values: order.map((l) => count(l, 'F')) }, { name: 'Garçons', values: order.map((l) => count(l, 'M')) }] as Serie[] };
  });

  // ---------- Finances ----------
  private months(from: string, to: string): string[] {
    const out: string[] = [];
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }
  readonly cumul = computed(() => {
    const pays = this.s.payments().filter((p) => p.status === 'confirme');
    const dues = this.s.students().flatMap((st) => this.s.feeLines(st.id));
    const keys = [...pays.map((p) => p.date.slice(0, 7)), ...dues.map((d) => d.due.slice(0, 7))].filter((k) => k <= DEMO_TODAY.slice(0, 7)).sort();
    if (!keys.length) return { labels: [], series: [] as Serie[] };
    const ms = this.months(keys[0], DEMO_TODAY.slice(0, 7));
    const exp = ms.map((m) => dues.filter((d) => d.due.slice(0, 7) <= m).reduce((a, d) => a + d.amount, 0));
    const col = ms.map((m) => pays.filter((p) => p.date.slice(0, 7) <= m).reduce((a, p) => a + p.amount, 0));
    return { labels: ms.map(monthLabel), series: [{ name: 'Attendu', values: exp }, { name: 'Encaissé', values: col }] as Serie[] };
  });
  readonly byMonth = computed(() => {
    const e = [...this.s.finance().byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { labels: e.map((x) => monthLabel(x[0])), series: this.one('Encaissé', e.map((x) => x[1])) };
  });
  readonly byMode = computed(() => {
    const e = [...this.s.finance().byMode.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: e.map((x) => MODE_LABEL[x[0] as PayMode]), series: this.one('Encaissé', e.map((x) => x[1])) };
  });
  readonly overdue = computed(() => {
    const e = this.s.classes().map((c) => ({ n: c.name, v: this.s.finance().overdueByClass.get(c.id) ?? 0 })).sort((a, b) => b.v - a.v);
    return { labels: e.map((x) => x.n), series: this.one('Impayés', e.map((x) => x.v)) };
  });
  readonly recov = computed(() => {
    const e = this.s.classes().map((c) => {
      let t = 0, p = 0;
      for (const st of this.s.studentsByClass().get(c.id) ?? []) { const b = this.s.balance(st.id); t += b.total; p += Math.min(b.paid, b.total); }
      return { n: c.name, v: t ? (p / t) * 100 : null };
    }).sort((a, b) => (a.v ?? 0) - (b.v ?? 0));
    return { labels: e.map((x) => x.n), series: this.one('Recouvrement', e.map((x) => x.v)) };
  });

  // ---------- Vie scolaire ----------
  readonly weekly = computed(() => {
    const a = new Map<string, number>(), r = new Map<string, number>();
    for (const x of this.s.absences()) {
      const w = weekStart(x.date);
      (x.status === 'A' ? a : r).set(w, ((x.status === 'A' ? a : r).get(w) ?? 0) + 1);
    }
    const ws = [...new Set([...a.keys(), ...r.keys()])].sort().slice(-14);
    return {
      labels: ws.map((w) => `${w.slice(8)}/${w.slice(5, 7)}`),
      series: [{ name: 'Absences', values: ws.map((w) => a.get(w) ?? 0) }, { name: 'Retards', values: ws.map((w) => r.get(w) ?? 0) }] as Serie[],
    };
  });
  readonly absRate = computed(() => {
    const e = this.s.classes().map((c) => { const v = this.s.classAttendance(c.id); return { n: c.name, v: v === null ? null : 100 - v }; }).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
    return { labels: e.map((x) => x.n), series: this.one('Taux d’absence', e.map((x) => x.v)) };
  });
  readonly justifs = computed(() => {
    const keys = ['aucune', 'en_attente', 'acceptee', 'refusee'] as const;
    const names = ['Non justifiée', 'En attente', 'Acceptée', 'Refusée'];
    const abs = this.s.absences().filter((x) => x.status === 'A');
    return { labels: names, series: this.one('Absences', keys.map((k) => abs.filter((x) => x.justif === k).length)) };
  });
  private incs = computed(() => this.s.incidents().filter((i) => i.status !== 'refuse'));
  readonly incTypes = computed(() => {
    const m = new Map<string, number>();
    for (const i of this.incs()) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    const e = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: e.map((x) => INCIDENT_LABEL[x[0] as keyof typeof INCIDENT_LABEL]), series: this.one('Incidents', e.map((x) => x[1])) };
  });
  readonly incMonthly = computed(() => {
    const ms = [...new Set(this.incs().map((i) => i.date.slice(0, 7)))].sort();
    const g = (['legere', 'moyenne', 'grave'] as const);
    return {
      labels: ms.map(monthLabel),
      series: g.map((k) => ({ name: GRAVITE_LABEL[k], values: ms.map((m) => this.incs().filter((i) => i.date.slice(0, 7) === m && i.gravite === k).length) })) as Serie[],
    };
  });

  // ---------- Enseignant ----------
  readonly teacherAsg = computed(() => this.s.myAssignments().map((a) => ({
    id: a.id, classId: a.classId, subjectId: a.subjectId,
    label: `${this.s.className(a.classId)} · ${this.s.subjectById().get(a.subjectId)?.short ?? ''}`,
  })));
  readonly curAsg = computed(() => { const l = this.teacherAsg(); return l.find((a) => a.id === this.asgId()) ?? (l.length ? l[0] : undefined); });
  readonly tClassAvg = computed(() => {
    const rows = this.teacherAsg().map((a) => {
      const rs = [...(this.stats().get(a.classId)?.results.values() ?? [])].map((r) => r.subjects.find((x) => x.subjectId === a.subjectId)?.moy ?? null).filter((x): x is number => x !== null);
      return { n: a.label, v: mean(rs) };
    });
    return { labels: rows.map((r) => r.n), series: this.one('Moyenne', rows.map((r) => r.v)) };
  });
  private asgEvals = computed(() => {
    const a = this.curAsg();
    return a ? this.s.evals().filter((e) => e.classId === a.classId && e.subjectId === a.subjectId).sort((x, y) => x.date.localeCompare(y.date)) : [];
  });
  readonly tHisto = computed(() => {
    const evs = new Map(this.asgEvals().map((e) => [e.id, e]));
    const vals = Object.entries(this.s.grades()).filter(([k]) => evs.has(k.split('|')[0])).map(([k, g]) => sur20(g, evs.get(k.split('|')[0])!.bareme));
    const b = bins(vals, [0, 5, 8, 10, 12, 15, 20]);
    return { labels: b.labels, series: this.one('Notes', b.counts) };
  });
  readonly tEval = computed(() => {
    const g = this.s.grades();
    const ev = this.asgEvals();
    const studs = this.s.studentsByClass().get(this.curAsg()?.classId ?? '') ?? [];
    const vals = ev.map((e) => mean(studs.map((st) => g[`${e.id}|${st.id}`]).filter((x): x is number => x !== undefined).map((x) => sur20(x, e.bareme))));
    return { labels: ev.map((e) => e.title), series: this.one('Moyenne de la classe', vals) };
  });

  // ---------- Parent / élève ----------
  readonly kidSubj = computed(() => {
    const k = this.s.activeChild();
    const res = k ? this.s.resultOf(k.id, true) : undefined;
    const rows = (res?.subjects ?? []).filter((x) => x.moy !== null);
    const nm = (id: string) => this.s.subjectById().get(id)?.short ?? '';
    return { labels: rows.map((x) => nm(x.subjectId)), series: [{ name: 'Élève', values: rows.map((x) => x.moy) }, { name: 'Classe', values: rows.map((x) => x.classMoy) }] as Serie[] };
  });
  readonly kidMonthly = computed(() => {
    const k = this.s.activeChild();
    if (!k) return { labels: [], series: [] as Serie[] };
    const pub = new Set(this.s.evals().filter((e) => e.published).map((e) => e.id));
    const mates = new Set((this.s.studentsByClass().get(k.classId) ?? []).map((x) => x.id));
    const mine = this.monthly((e, sid) => pub.has(e) && sid === k.id);
    const cls = this.monthly((e, sid) => pub.has(e) && mates.has(sid));
    return { labels: cls.months.map(monthLabel), series: [{ name: 'Élève', values: cls.months.map((m) => (mine.vals.has(m) ? mean(mine.vals.get(m)!) : null)) }, { name: 'Classe', values: cls.months.map((m) => mean(cls.vals.get(m)!)) }] as Serie[] };
  });
  readonly kidKpis = computed(() => {
    const k = this.s.activeChild();
    if (!k) return [];
    const res = this.s.resultOf(k.id, true);
    const att = this.s.attendanceRate(k.id);
    const eff = this.s.classStats(k.classId, true)?.effectif ?? this.s.studentsByClass().get(k.classId)?.length ?? 0;
    const ab = this.s.absByStudent().get(k.id);
    return [
      { l: 'Moyenne générale', v: res?.moyenne == null ? '—' : `${fnum(res.moyenne, 2)} / 20`, h: res?.moyenne == null ? 'Aucune note publiée' : mention(res.moyenne, this.s.school().seuils) },
      { l: 'Rang', v: res?.rang == null ? '—' : `${res.rang} / ${eff}`, h: this.s.className(k.classId) },
      { l: 'Assiduité', v: att === null ? '—' : pct1(att), h: `${ab?.a ?? 0} absence(s), ${ab?.r ?? 0} retard(s)` },
    ];
  });
}
