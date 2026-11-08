import {
  ClassStats, Classe, Evaluation, FeeItem, FeeLine, Groupe, Payment, PaymentDetail, SchoolSettings, Student,
  StudentResult, Subject, SubjectResult, Tarif, Term, TermId,
} from './models';

/** Dernier jour (AAAA-MM-JJ) où la famille peut justifier une absence ; null quand l'école n'a pas fixé de délai. */
export function justifDeadline(date: string, delai: number | undefined): string | null {
  if (!delai) return null;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delai);
  return d.toISOString().slice(0, 10);
}

/** Période qui contient la date (aucune pendant les vacances). */
export function termOfDate(terms: Term[], date: string): Term | undefined {
  return terms.find((t) => t.start && t.end && t.start <= date && date <= t.end);
}

/** L'année est terminée quand sa dernière période est verrouillée (notes figées) ou que sa date de fin est passée. */
export function yearClosedOf(terms: Term[], today: string): boolean {
  const last = terms.filter((t) => t.end).sort((a, b) => a.end.localeCompare(b.end)).at(-1);
  return !!last && (last.locked || last.end < today);
}

/** Période en cours à la date du jour (AAAA-MM-JJ). Pendant les vacances, la dernière période terminée ;
 *  avant la rentrée, la première. Sans dates saisies : la première période non verrouillée. */
export function currentTermOf(terms: Term[], today: string): TermId | undefined {
  const dated = terms.filter((t) => t.start && t.end).sort((a, b) => a.start.localeCompare(b.start));
  if (!dated.length) return (terms.find((t) => !t.locked) ?? terms[0])?.id;
  return (dated.find((t) => t.start <= today && today <= t.end) ?? dated.filter((t) => t.end < today).at(-1) ?? dated[0]).id;
}

export const coefKey = (g: Groupe, subjectId: string) => `${g}|${subjectId}`;

export function mention(avg: number | null, seuils: SchoolSettings['seuils']): string {
  if (avg === null) return '—';
  if (avg >= seuils[0]) return 'Très bien';
  if (avg >= seuils[1]) return 'Bien';
  if (avg >= seuils[2]) return 'Assez bien';
  if (avg >= seuils[3]) return 'Passable';
  return 'Insuffisant';
}

/** Moyenne pondérée par le coefficient de chaque évaluation : [note, coef]. */
const wmean = (xs: [number, number][]): number | null => {
  const t = xs.reduce((a, [, w]) => a + w, 0);
  return xs.length && t ? xs.reduce((a, [v, w]) => a + v * w, 0) / t : null;
};
/** Barèmes proposés à l'enseignant ; « Autre » permet toute note maximale de 1 à BAREME_MAX. */
export const BAREMES = [10, 20, 30] as const;
export const BAREME_MAX = 100;
/** Note ramenée sur 20 depuis le barème de son évaluation (15 sur 30 → 10). Même règle que le serveur (calc.sur20). */
export const sur20 = (value: number, bareme: number | undefined): number => (value * 20) / (bareme || 20);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface ComputeInput {
  classes: Classe[];
  students: Student[];
  subjects: Subject[];
  coefs: Record<string, number>;
  evals: Evaluation[];
  grades: Record<string, number>;
  termId: TermId;
  compoWeight: number;
  onlyPublished: boolean;
  /** Conduite (absente : non calculée, par exemple conduite non publiée pour une famille). removed : points retirés par élève. */
  conduct?: { max: number; coef: number; inAverage: boolean; removed: Record<string, number> };
}

/** Moyennes de matière, moyennes générales pondérées par les coefficients et rangs, pour toutes les classes. */
export function computeTerm(inp: ComputeInput): Map<string, ClassStats> {
  const out = new Map<string, ClassStats>();
  const evalsBy = new Map<string, Evaluation[]>();
  for (const e of inp.evals) {
    if (e.termId !== inp.termId) continue;
    if (inp.onlyPublished && !e.published) continue;
    const k = `${e.classId}|${e.subjectId}`;
    const arr = evalsBy.get(k);
    if (arr) arr.push(e);
    else evalsBy.set(k, [e]);
  }

  for (const cl of inp.classes) {
    const students = inp.students.filter((s) => s.classId === cl.id);
    const subs = inp.subjects.filter((sb) => (inp.coefs[coefKey(cl.groupe, sb.id)] ?? 0) > 0);
    const results = new Map<string, StudentResult>();

    for (const st of students) {
      const sr: SubjectResult[] = [];
      let points = 0;
      let totalCoef = 0;
      for (const sb of subs) {
        const coef = inp.coefs[coefKey(cl.groupe, sb.id)];
        const evs = evalsBy.get(`${cl.id}|${sb.id}`) ?? [];
        const classNotes: [number, number][] = [];
        const compos: [number, number][] = [];
        for (const e of evs) {
          const g = inp.grades[`${e.id}|${st.id}`];
          if (g === undefined) continue;
          (e.type === 'composition' ? compos : classNotes).push([sur20(g, e.bareme), e.coef ?? 1]);
        }
        const mc = wmean(classNotes);
        const compo = wmean(compos);
        let moy: number | null;
        if (mc !== null && compo !== null) moy = mc * (1 - inp.compoWeight) + compo * inp.compoWeight;
        else moy = mc ?? compo;
        if (moy !== null) {
          points += moy * coef;
          totalCoef += coef;
        }
        sr.push({ subjectId: sb.id, coef, mc, compo, moy, rang: null, classMoy: null, classMax: null, classMin: null });
      }
      let conduite: StudentResult['conduite'] = null;
      if (inp.conduct) {
        const c = inp.conduct;
        const note = Math.max(0, c.max - (c.removed[st.id] ?? 0));
        conduite = { note, max: c.max, coef: c.coef, inAverage: c.inAverage };
        if (c.inAverage && totalCoef > 0) { points += note * c.coef; totalCoef += c.coef; }   // comme le serveur : dès qu'une matière est notée
      }
      results.set(st.id, {
        studentId: st.id,
        subjects: sr,
        moyenne: totalCoef > 0 ? points / totalCoef : null,
        rang: null,
        totalPoints: points,
        totalCoef,
        conduite,
      });
    }

    // Rangs et statistiques par matière
    subs.forEach((sb, idx) => {
      const vals = students
        .map((s) => results.get(s.id)!.subjects[idx].moy)
        .filter((v): v is number => v !== null);
      const cm = mean(vals);
      const mx = vals.length ? Math.max(...vals) : null;
      const mn = vals.length ? Math.min(...vals) : null;
      for (const s of students) {
        const r = results.get(s.id)!.subjects[idx];
        r.classMoy = cm;
        r.classMax = mx;
        r.classMin = mn;
        r.rang = r.moy === null ? null : 1 + vals.filter((v) => v > r.moy! + 1e-9).length;
      }
    });

    // Rang général
    const avgs = [...results.values()].map((r) => r.moyenne).filter((v): v is number => v !== null);
    for (const r of results.values()) {
      r.rang = r.moyenne === null ? null : 1 + avgs.filter((v) => v > r.moyenne! + 1e-9).length;
    }

    out.set(cl.id, {
      classId: cl.id,
      effectif: students.length,
      avg: mean(avgs),
      max: avgs.length ? Math.max(...avgs) : null,
      min: avgs.length ? Math.min(...avgs) : null,
      results,
    });
  }
  return out;
}

// --- Frais de scolarité ---
/** Dates d'échéance par clé : INS (inscription), T1, T2… (tranches de l'école). */
export type FeeDates = Record<string, string>;
/** Une tranche de scolarité : son nom et sa part relative (la scolarité est partagée au prorata des parts). */
export interface TrancheDef { label: string; part: number; }
export const ordinalTranche = (i: number): string => (i === 1 ? '1re tranche' : `${i}e tranche`);
export const DEFAULT_TRANCHES: TrancheDef[] = [1, 2, 3].map((i) => ({ label: ordinalTranche(i), part: 1 }));
const NO_DATE = '9999-12-31';

/** Partage la scolarité au prorata des parts ; la dernière tranche reçoit le reste (le total reste exact). */
export function splitTranches(sco: number, parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0) || 1;
  const out = parts.slice(0, -1).map((p) => Math.round((sco * p) / total));
  return [...out, sco - out.reduce((a, b) => a + b, 0)];
}

/** Pourcentage de remise fratrie applicable : à partir du 2e enfant d'un même parent (ordre de la liste des élèves). */
export function siblingPct(students: Student[], studentId: string, pct: number): number {
  const st = students.find((s) => s.id === studentId);
  if (!st || !(pct > 0)) return 0;
  const idx = students.filter((s) => s.parentId === st.parentId).findIndex((s) => s.id === studentId);
  return idx >= 1 ? Math.min(100, pct) : 0;
}

/** Applique la remise fratrie à la scolarité (l'inscription n'est pas remisée). */
export function discountedTarif(tarif: Tarif, pct: number): Tarif {
  return { ins: tarif.ins, sco: Math.round((tarif.sco * (1 - pct / 100)) / 100) * 100 };
}

export function feeItems(tarif: Tarif, dates: FeeDates, discountPct = 0, tranches: TrancheDef[] = DEFAULT_TRANCHES, report = 0, reportDate?: string): FeeItem[] {
  tarif = discountPct > 0 ? discountedTarif(tarif, discountPct) : tarif;
  const amounts = splitTranches(tarif.sco, tranches.map((t) => t.part));
  const carried: FeeItem[] = report > 0 ? [{ key: 'REP', label: 'Solde de l’année précédente', due: reportDate ?? dates['INS'] ?? dates['T1'] ?? NO_DATE, amount: report }] : [];
  return [
    ...carried,
    { key: 'INS', label: 'Inscription', due: dates['INS'] ?? NO_DATE, amount: tarif.ins },
    ...tranches.map((t, i): FeeItem => ({ key: `T${i + 1}`, label: t.label, due: dates[`T${i + 1}`] ?? NO_DATE, amount: amounts[i] })),
  ];
}

/** Les paiements confirmés couvrent les échéances dans l'ordre, de la plus ancienne à la plus récente. */
export function allocate(items: FeeItem[], paidTotal: number, today: string): FeeLine[] {
  let left = paidTotal;
  return items.map((it) => {
    const paid = Math.min(it.amount, Math.max(0, left));
    left -= paid;
    const remaining = it.amount - paid;
    return { ...it, paid, remaining, overdue: remaining > 0 && it.due <= today };
  });
}

/** Ce qu'un paiement règle, échéance par échéance (les versements couvrent les échéances de la plus ancienne à la plus récente), et ce qui reste. Figé sur le reçu. */
export function paymentDetail(items: FeeItem[], fullTotal: number, paidBefore: number, amount: number, today: string, discountPct = 0): PaymentDetail {
  const a0 = allocate(items, paidBefore, today), a1 = allocate(items, paidBefore + amount, today);
  const lines = a1.map((l, i) => ({ key: l.key, label: l.label, due: l.due && l.due !== NO_DATE ? l.due : undefined, amount: l.amount, paidBefore: a0[i].paid, paidNow: l.paid - a0[i].paid, remaining: l.remaining }));
  const total = items.reduce((a, l) => a + l.amount, 0), after = paidBefore + amount;
  const nx = lines.find((l) => l.remaining > 0);
  return { lines, total, paidBefore, paidAfter: after, remaining: Math.max(0, total - after), credit: Math.max(0, after - total), discountPct, discountAmount: Math.max(0, fullTotal - total),
    next: nx ? { label: nx.label, due: nx.due, remaining: nx.remaining } : undefined };
}

export function paidSum(payments: Payment[]): number {
  return payments.filter((p) => p.status === 'confirme').reduce((a, p) => a + p.amount, 0);
}

// --- Décisions de fin d'année ---
export type DecisionValue = 'admis' | 'redouble' | 'exclu' | 'conseil';
export const DECISION_LABEL: Record<DecisionValue, string> = { admis: 'Admis(e)', redouble: 'Redouble', exclu: 'Exclu(e)', conseil: 'Conseil à réunir' };

/** Proposition automatique à partir de la moyenne annuelle. */
export interface PassageRule { passageAdmission?: number; passageRedoublement?: number; passageExclusion?: number | null; passageNiveaux?: Record<string, { admission: number; redoublement: number; exclusion: number | null }>; }
/** Règle applicable à un niveau : l'exception du niveau si l'école en a prévu une, sinon sa règle générale (10 et 8, sans exclusion, par défaut). */
export function ruleFor(rule: PassageRule, level?: string): { admission: number; redoublement: number; exclusion: number | null } {
  const own = level ? rule.passageNiveaux?.[level] : undefined;
  return own ?? { admission: rule.passageAdmission ?? 10, redoublement: rule.passageRedoublement ?? 8, exclusion: rule.passageExclusion ?? null };
}
/** Les moyennes d'admission, de redoublement et d'exclusion sont celles choisies par l'école (10 et 8 par défaut, pas d'exclusion automatique). */
/** Proposition de fin d'année d'un élève : celle des moyennes, sauf qu'un élève qui devrait redoubler un niveau qu'il a déjà
 * redoublé est proposé à l'exclusion (même règle que le serveur, rollover.proposal_for). */
export function proposeFor(avg: number | null, rule: PassageRule, level: string | undefined, redoubles: readonly string[] = []): { value: DecisionValue | null; label: string; reason: string } {
  const p = proposeDecision(avg, rule, level);
  if (p.value === 'redouble' && level && redoubles.includes(level)) return { value: 'exclu', label: 'Exclusion proposée', reason: `A déjà redoublé la ${level}` };
  return { ...p, reason: '' };
}
export function proposeDecision(avg: number | null, rule: PassageRule = {}, level?: string): { value: DecisionValue | null; label: string } {
  if (avg === null) return { value: null, label: 'En attente de notes' };
  const { admission: adm, redoublement: red, exclusion: exc } = ruleFor(rule, level);
  if (exc !== null && avg < exc) return { value: 'exclu', label: 'Exclusion proposée' };
  if (avg >= adm) return { value: 'admis', label: 'Admis(e)' };
  if (avg >= red) return { value: 'conseil', label: 'À examiner par le conseil' };
  return { value: 'redouble', label: 'Redoublement proposé' };
}

/** Coefficient d'une période dans la moyenne annuelle : celui choisi par l'école, sinon l'usage ivoirien (1re période 1, les suivantes 2). */
export const termCoef = (t: { coef?: number }, i: number): number => t.coef ?? (i === 0 ? 1 : 2);

/** Moyenne annuelle : moyenne des périodes pondérée par leur coefficient ; une période sans moyenne est ignorée. */
export function weightedAnnual(ps: { moy: number | null; coef: number }[]): number | null {
  const done = ps.filter((p) => p.moy !== null);
  const tot = done.reduce((a, p) => a + p.coef, 0);
  return tot ? done.reduce((a, p) => a + (p.moy as number) * p.coef, 0) / tot : null;
}
