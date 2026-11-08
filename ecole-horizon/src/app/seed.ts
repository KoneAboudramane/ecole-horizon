import {
  Absence, Announcement, Assignment, Classe, Decision, Evaluation, Groupe, Incident, LogEntry, Notice, Parent, Payment,
  PayMode, SchoolSettings, Slot, StatementLine, Student, Subject, Teacher, Term, Tarif, User,
} from './models';
import { addDays, clamp, DEMO_TODAY, weekdaysBetween } from './format';
import { computeTerm, coefKey, feeItems, FeeDates, siblingPct } from './engine';

export interface SeedData {
  incidents: Incident[];
  school: SchoolSettings;
  users: User[];
  classes: Classe[];
  subjects: Subject[];
  coefs: Record<string, number>;
  teachers: Teacher[];
  parents: Parent[];
  students: Student[];
  assignments: Assignment[];
  terms: Term[];
  evals: Evaluation[];
  grades: Record<string, number>;
  apprec: Record<string, string>;
  conseil: Record<string, string>;
  absences: Absence[];
  sessions: string[];
  tarifs: Record<string, Tarif>;
  feeDates: FeeDates;
  payments: Payment[];
  statement: StatementLine[];
  notices: Notice[];
  log: LogEntry[];
  announcements: Announcement[];
  decisions: Decision[];
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

const SURNAMES = ['Kouassi', 'Koné', 'Traoré', 'Coulibaly', 'Ouattara', 'Yao', 'Konan', "N'Guessan", 'Kouadio', 'Bamba', 'Diabaté', 'Soro', 'Touré', 'Diomandé', 'Gnagne', 'Aka', 'Tano', 'Kra', 'Zadi', 'Séka', 'Assi', 'Doumbia', 'Cissé', 'Fofana', 'Sangaré', 'Yéo', 'Gbané', 'Dosso', 'Koffi', 'Ahoua', 'Amani', 'Tapé', 'Diallo', 'Bakayoko', 'Silué', 'Meité', 'Camara', 'Beugré', 'Ettien', 'Lago', 'Boni', 'Djè', 'Zoungrana', 'Ballo'];
const FEM = ['Aïcha', 'Fatou', 'Awa', 'Mariam', 'Aminata', 'Salimata', 'Rokia', 'Nadège', 'Christelle', 'Estelle', 'Prisca', 'Grâce', 'Esther', 'Ruth', 'Sika', 'Affoué', 'Adjoua', 'Amenan', 'Mélissa', 'Josiane', 'Axelle', 'Laetitia', 'Inès', 'Eunice', 'Chantal', 'Nathalie'];
const MAS = ['Yao', 'Ibrahim', 'Mamadou', 'Souleymane', 'Kévin', 'Hervé', 'Franck', 'Arnaud', 'Cédric', 'Wilfried', 'Romaric', 'Elvis', 'Junior', 'Serge', 'Eric', 'Abdoulaye', 'Moussa', 'Seydou', 'Lassina', 'Aboubacar', 'Boris', 'Stéphane', 'Landry', 'Daniel', 'Samuel', 'Fabrice'];
const LIEUX = ['Abidjan', 'Bouaké', 'Yamoussoukro', 'Daloa', 'San-Pédro', 'Korhogo', 'Man', 'Abengourou', 'Gagnoa', 'Divo'];

export const SUBJECTS: Subject[] = [
  { id: 'fr', name: 'Français', short: 'Fran.' },
  { id: 'ma', name: 'Mathématiques', short: 'Maths' },
  { id: 'an', name: 'Anglais', short: 'Angl.' },
  { id: 'hg', name: 'Histoire-Géographie', short: 'HG' },
  { id: 'sv', name: 'SVT', short: 'SVT' },
  { id: 'pc', name: 'Physique-Chimie', short: 'PC' },
  { id: 'eps', name: 'EPS', short: 'EPS' },
  { id: 'edhc', name: 'EDHC', short: 'EDHC' },
  { id: 'ph', name: 'Philosophie', short: 'Philo' },
  { id: 'lv2', name: 'Espagnol (LV2)', short: 'LV2' },
  { id: 'ar', name: 'Arabe', short: 'Arabe' },
];

// Coefficients de démonstration, à confirmer avec l'école
const COEF: Record<Groupe, Record<string, number>> = {
  '6e': { fr: 4, ma: 4, an: 2, hg: 2, sv: 2, pc: 2, eps: 1, edhc: 1, ar: 2 },
  '5e': { fr: 4, ma: 4, an: 2, hg: 2, sv: 2, pc: 2, eps: 1, edhc: 1, ar: 2 },
  '4e': { fr: 4, ma: 4, an: 3, hg: 2, sv: 2, pc: 2, eps: 1, edhc: 1, ar: 2 },
  '3e': { fr: 4, ma: 4, an: 3, hg: 2, sv: 2, pc: 2, eps: 1, edhc: 1, ar: 2 },
  '2nde A': { fr: 4, an: 3, hg: 3, ma: 2, pc: 2, sv: 2, lv2: 2, eps: 1, ar: 1 },
  '2nde C': { ma: 5, pc: 4, sv: 2, fr: 3, an: 2, hg: 2, lv2: 1, eps: 1, ar: 1 },
  '1ère A': { fr: 4, ph: 4, hg: 3, an: 3, lv2: 2, ma: 2, sv: 1, eps: 1, ar: 1 },
  '1ère C': { ma: 5, pc: 4, sv: 2, fr: 2, ph: 2, an: 2, hg: 2, eps: 1, ar: 1 },
  '1ère D': { ma: 4, pc: 4, sv: 4, fr: 2, ph: 2, an: 2, hg: 2, eps: 1, ar: 1 },
  'Tle A': { ph: 5, fr: 4, hg: 3, an: 3, lv2: 2, ma: 2, eps: 1, ar: 1 },
  'Tle C': { ma: 5, pc: 4, sv: 2, ph: 2, fr: 2, an: 2, hg: 2, eps: 1, ar: 1 },
  'Tle D': { ma: 4, pc: 4, sv: 4, ph: 2, fr: 2, an: 2, hg: 2, eps: 1, ar: 1 },
};

interface ClassDef { id: string; name: string; level: string; serie?: string; groupe: Groupe; size: number; }
const CLASS_DEFS: ClassDef[] = [
  { id: 'c6a', name: '6e A', level: '6e', groupe: '6e', size: 16 },
  { id: 'c6b', name: '6e B', level: '6e', groupe: '6e', size: 15 },
  { id: 'c5a', name: '5e A', level: '5e', groupe: '5e', size: 15 },
  { id: 'c4a', name: '4e A', level: '4e', groupe: '4e', size: 14 },
  { id: 'c3a', name: '3e A', level: '3e', groupe: '3e', size: 16 },
  { id: 'c3b', name: '3e B', level: '3e', groupe: '3e', size: 14 },
  { id: 'c2a', name: '2nde A', level: '2nde', serie: 'A', groupe: '2nde A', size: 12 },
  { id: 'c2c', name: '2nde C', level: '2nde', serie: 'C', groupe: '2nde C', size: 15 },
  { id: 'c1a', name: '1ère A', level: '1ère', serie: 'A', groupe: '1ère A', size: 12 },
  { id: 'c1c', name: '1ère C', level: '1ère', serie: 'C', groupe: '1ère C', size: 13 },
  { id: 'c1d', name: '1ère D', level: '1ère', serie: 'D', groupe: '1ère D', size: 14 },
  { id: 'cta', name: 'Tle A', level: 'Tle', serie: 'A', groupe: 'Tle A', size: 11 },
  { id: 'ctc', name: 'Tle C', level: 'Tle', serie: 'C', groupe: 'Tle C', size: 13 },
  { id: 'ctd', name: 'Tle D', level: 'Tle', serie: 'D', groupe: 'Tle D', size: 14 },
];

interface TeacherDef { id: string; name: string; subj: string; cycle: 'college' | 'lycee' | 'both'; username?: string; }
const TEACHER_DEFS: TeacherDef[] = [
  { id: 't-fr1', name: 'M. Yao Kouamé', subj: 'fr', cycle: 'college' },
  { id: 't-ma1', name: 'Mme Konan Aya', subj: 'ma', cycle: 'college', username: 'enseignant' },
  { id: 't-an1', name: 'Mme Doumbia Salimata', subj: 'an', cycle: 'college' },
  { id: 't-hg1', name: 'M. Gnagne Roland', subj: 'hg', cycle: 'college' },
  { id: 't-sv1', name: 'Mme Tano Estelle', subj: 'sv', cycle: 'college' },
  { id: 't-pc1', name: 'M. Ouédraogo Issa', subj: 'pc', cycle: 'college' },
  { id: 't-eps', name: 'M. Bamba Lassina', subj: 'eps', cycle: 'both' },
  { id: 't-edhc', name: 'Mme Aka Christelle', subj: 'edhc', cycle: 'college' },
  { id: 't-fr2', name: 'Mme Kouadio Brigitte', subj: 'fr', cycle: 'lycee' },
  { id: 't-ma2', name: 'M. Zadi Hervé', subj: 'ma', cycle: 'lycee' },
  { id: 't-an2', name: 'M. Kra Philippe', subj: 'an', cycle: 'lycee' },
  { id: 't-hg2', name: 'M. Séka Amani', subj: 'hg', cycle: 'lycee' },
  { id: 't-sv2', name: 'Mme Coulibaly Rokia', subj: 'sv', cycle: 'lycee' },
  { id: 't-pc2', name: "M. N'Dri Mathias", subj: 'pc', cycle: 'lycee' },
  { id: 't-ph', name: 'M. Assi Kévin', subj: 'ph', cycle: 'lycee' },
  { id: 't-lv2', name: 'Mme Mensah Cécile', subj: 'lv2', cycle: 'lycee' },
  { id: 't-ar', name: 'M. Sylla Abdoulaye', subj: 'ar', cycle: 'both' },
];

const BIAS: Record<string, number> = { ma: -0.7, pc: -0.5, fr: -0.3, an: 0, hg: 0.2, sv: 0.3, eps: 2.5, edhc: 1.5, ph: -0.4, lv2: 0.4, ar: 0.6 };
const ASSIGN_APPR = (m: number, h: number): string => {
  const sets: [number, string[]][] = [
    [16, ['Excellent travail, félicitations.', 'Résultats remarquables, continuez ainsi.']],
    [14, ['Très bon trimestre.', 'Bon travail, des résultats encourageants.']],
    [12, ['Résultats satisfaisants, peut mieux faire.', 'Travail sérieux, à poursuivre.']],
    [10, ['Résultats passables, des efforts à poursuivre.', 'Peut mieux faire avec plus de régularité.']],
    [0, ['Résultats insuffisants, un travail régulier est indispensable.', 'Doit redoubler d\'efforts.']],
  ];
  const set = sets.find((s) => m >= s[0])!;
  return set[1][h % set[1].length];
};
const ASSIGN_CONSEIL = (m: number): string =>
  m >= 16 ? 'Félicitations du conseil de classe. Excellent trimestre.'
    : m >= 14 ? 'Encouragements du conseil de classe. Bon trimestre.'
    : m >= 12 ? 'Tableau d\'honneur. Continuez vos efforts.'
    : m >= 10 ? 'Trimestre passable. Un travail plus régulier est attendu.'
    : 'Avertissement de travail. Un sursaut est nécessaire au prochain trimestre.';

export function buildSeed(): SeedData {
  const r = rng(20261214);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)];
  const phone = (): string => `${pick(['01', '05', '07'])} ${String(Math.floor(r() * 90) + 10)} ${String(Math.floor(r() * 90) + 10)} ${String(Math.floor(r() * 90) + 10)} ${String(Math.floor(r() * 90) + 10)}`;

  const school: SchoolSettings = {
    name: 'Collège-Lycée Horizon',
    address: 'Riviera 3, Cocody, Abidjan',
    phone: '27 22 00 00 00',
    email: 'contact@ecole-horizon.example',
    director: 'Mme Diarrassouba Fatoumata',
    year: '2026-2027',
    hue: 155,
    template: 'classique',
    compoWeight: 0.5,
    seuils: [16, 14, 12, 10],
    remiseFratrie: 10,
  };

  const classes: Classe[] = CLASS_DEFS.map((c) => ({
    id: c.id, name: c.name, level: c.level, serie: c.serie, groupe: c.groupe, max: 45,
    cycle: c.level === '6e' || c.level === '5e' || c.level === '4e' || c.level === '3e' ? 'college' : 'lycee',
  }));

  const coefs: Record<string, number> = {};
  (Object.keys(COEF) as Groupe[]).forEach((g) => {
    for (const [sid, v] of Object.entries(COEF[g])) coefs[coefKey(g, sid)] = v;
  });

  // --- Utilisateurs fixes ---
  const users: User[] = [];
  const mkUser = (id: string, username: string, role: User['role'], name: string, phoneNo: string, refId?: string): User => {
    const u: User = { id, username, password: 'demo', role, name, phone: phoneNo, active: true, mustChange: false, refId };
    users.push(u);
    return u;
  };
  mkUser('u-fond', 'fondateur', 'fondateur', 'M. Ouattara Lanciné', '01 02 03 04 05');
  mkUser('u-admin', 'directeur', 'directeur', 'Mme Diarrassouba Fatoumata', '07 11 22 33 44');
  mkUser('u-secr', 'secretariat', 'admin', 'Mme Bakayoko Aminata', '05 77 88 99 00');
  mkUser('u-educ', 'educateur', 'educateur', 'M. Yapo Serge', '07 55 66 77 88');
  mkUser('u-compta', 'comptable', 'comptable', 'M. Soro Ibrahim', '05 44 55 66 77');
  mkUser('u-info', 'informatique', 'informatique', 'M. Tano Désiré', '05 22 33 44 55');

  // --- Enseignants ---
  const teachers: Teacher[] = TEACHER_DEFS.map((t) => {
    const uid = 'u-' + t.id;
    const surname = t.name.split(' ')[1].toLowerCase().replace(/[^a-z]/g, '');
    const ph = phone();
    mkUser(uid, t.username ?? `prof.${surname}`, 'enseignant', t.name, ph, t.id);
    return { id: t.id, userId: uid, name: t.name, phone: ph, subjectIds: [t.subj] };
  });
  const teacherFor = (subj: string, cycle: 'college' | 'lycee') =>
    TEACHER_DEFS.find((t) => t.subj === subj && (t.cycle === cycle || t.cycle === 'both'))!;

  // --- Élèves et parents ---
  const students: Student[] = [];
  const parents: Parent[] = [];
  const ability = new Map<string, number>();
  let seq = 0;

  const makeParent = (title: string, nom: string, prenom: string, ph: string, forced?: { id: string; username: string }): Parent => {
    const pid = forced?.id ?? `p-${parents.length + 1}`;
    const uid = 'u-' + pid;
    mkUser(uid, forced?.username ?? ph.replace(/\s/g, ''), 'parent', `${title} ${nom} ${prenom}`, ph, pid);
    const p: Parent = { id: pid, userId: uid, name: `${title} ${nom} ${prenom}`, phone: ph, studentIds: [] };
    parents.push(p);
    return p;
  };

  const makeStudent = (classId: string, nom: string, prenoms: string, sexe: 'M' | 'F', parent: Parent, ab: number, forcedUsername?: string, forcedId?: string): Student => {
    seq++;
    const cl = CLASS_DEFS.find((c) => c.id === classId)!;
    const levelAge: Record<string, number> = { '6e': 11, '5e': 12, '4e': 13, '3e': 14, '2nde': 15, '1ère': 16, Tle: 17 };
    const year = 2026 - levelAge[cl.level] - (r() < 0.4 ? 1 : 0);
    const matricule = `HZ26-${String(seq).padStart(4, '0')}`;
    const id = forcedId ?? `s-${String(seq).padStart(4, '0')}`;
    const uid = 'u-' + id;
    mkUser(uid, forcedUsername ?? matricule.toLowerCase(), 'eleve', `${prenoms} ${nom}`, '', id);
    const st: Student = {
      id, matricule, nom, prenoms, sexe,
      naissance: `${year}-${String(Math.floor(r() * 12) + 1).padStart(2, '0')}-${String(Math.floor(r() * 27) + 1).padStart(2, '0')}`,
      lieu: pick(LIEUX), classId, parentId: parent.id, userId: uid, urgence: parent.phone,
    };
    parent.studentIds.push(id);
    students.push(st);
    ability.set(id, ab);
    return st;
  };

  // Famille de démonstration
  const brou = makeParent('M.', 'Brou', 'Kouassi', '07 08 11 22 33', { id: 'p-brou', username: 'parent' });
  makeStudent('c3a', 'Brou', 'Marie-Ange', 'F', brou, 14.4, 'eleve', 's-marie');
  makeStudent('c6b', 'Brou', 'Jean-Luc', 'M', brou, 11.2, undefined, 's-jeanluc');

  for (const cd of CLASS_DEFS) {
    const already = students.filter((s) => s.classId === cd.id).length;
    for (let i = already; i < cd.size; i++) {
      const sexe: 'M' | 'F' = r() < 0.5 ? 'F' : 'M';
      const prenoms = sexe === 'F' ? pick(FEM) : pick(MAS);
      let nom = pick(SURNAMES);
      let parent: Parent;
      if (students.length > 40 && r() < 0.06) {
        // frère ou sœur d'un élève déjà inscrit
        const others = parents.filter((p) => p.id !== 'p-brou' && p.studentIds.length === 1);
        parent = others[Math.floor(r() * others.length)];
        nom = parent.name.split(' ')[1];
      } else {
        const father = r() < 0.55;
        parent = makeParent(father ? 'M.' : 'Mme', nom, pick(father ? MAS : FEM), phone());
      }
      const ab = clamp(11.6 + (r() + r() + r() - 1.5) * 3.4, 6, 17.5);
      makeStudent(cd.id, nom, prenoms, sexe, parent, ab);
    }
  }

  // --- Affectations ---
  const assignments: Assignment[] = [];
  for (const cl of classes) {
    for (const sb of SUBJECTS) {
      if (!coefs[coefKey(cl.groupe, sb.id)]) continue;
      const t = teacherFor(sb.id, cl.cycle);
      assignments.push({ id: `a-${cl.id}-${sb.id}`, teacherId: t.id, subjectId: sb.id, classId: cl.id });
    }
  }

  // --- Trimestres ---
  const terms: Term[] = [
    { id: 'T1', label: '1er trimestre', start: '2026-09-07', end: '2026-12-18', locked: false, coef: 1 },
    { id: 'T2', label: '2e trimestre', start: '2027-01-04', end: '2027-03-26', locked: false, coef: 2 },
    { id: 'T3', label: '3e trimestre', start: '2027-04-12', end: '2027-06-25', locked: false, coef: 2 },
  ];

  // --- Évaluations et notes (1er trimestre) ---
  const evals: Evaluation[] = [];
  const grades: Record<string, number> = {};
  const EV = [
    { type: 'interro' as const, title: 'Interrogation 1', date: '2026-10-08' },
    { type: 'interro' as const, title: 'Interrogation 2', date: '2026-11-05' },
    { type: 'devoir' as const, title: 'Devoir 1', date: '2026-11-19' },
    { type: 'composition' as const, title: 'Composition', date: '2026-12-07' },
  ];
  const unpublished = new Set(['c3a|ma|3', 'c4a|sv|2', 'c2c|pc|1']);
  const empty = new Set(['c3a|ma|3']);

  for (const as of assignments) {
    const cl = classes.find((c) => c.id === as.classId)!;
    const studs = students.filter((s) => s.classId === cl.id);
    EV.forEach((e, k) => {
      const id = `ev-${as.classId}-${as.subjectId}-T1-${k}`;
      const key = `${as.classId}|${as.subjectId}|${k}`;
      evals.push({
        id, classId: as.classId, subjectId: as.subjectId, termId: 'T1', type: e.type, title: e.title,
        date: e.date, published: !unpublished.has(key), teacherId: as.teacherId,
      });
      if (empty.has(key)) return;
      for (const st of studs) {
        if (r() < 0.015) continue; // élève non noté
        const aff = ((hash(st.id + as.subjectId) % 1000) / 1000 - 0.5) * 3.6;
        const base = ability.get(st.id)! + aff + (BIAS[as.subjectId] ?? 0) + (e.type === 'composition' ? -0.4 : 0);
        const v = clamp(base + (r() + r() - 1) * 3, 2, 19.5);
        grades[`${id}|${st.id}`] = Math.round(v * 4) / 4;
      }
    });
  }

  // --- Appréciations (calculées à partir des moyennes) ---
  const stats = computeTerm({ classes, students, subjects: SUBJECTS, coefs, evals, grades, termId: 'T1', compoWeight: school.compoWeight, onlyPublished: false });
  const apprec: Record<string, string> = {};
  const conseil: Record<string, string> = {};
  for (const cs of stats.values()) {
    for (const res of cs.results.values()) {
      if (res.moyenne !== null) conseil[`${res.studentId}|T1`] = ASSIGN_CONSEIL(res.moyenne);
      for (const sr of res.subjects) {
        if (sr.moy !== null) apprec[`${res.studentId}|T1|${sr.subjectId}`] = ASSIGN_APPR(sr.moy, hash(res.studentId + sr.subjectId));
      }
    }
  }

  // --- Présences (10 jours d'école : 30 novembre au 11 décembre) ---
  const days = weekdaysBetween('2026-11-30', '2026-12-11');
  const slots: Slot[] = ['Matin', 'Après-midi'];
  const sessions: string[] = [];
  const absences: Absence[] = [];
  for (const cl of classes) for (const d of days) for (const sl of slots) sessions.push(`${cl.id}|${d}|${sl}`);
  let aSeq = 0;
  const motifs = ['Maladie', 'Rendez-vous médical', 'Décès dans la famille', 'Problème de transport'];
  for (const st of students) {
    if (st.id === 's-marie' || st.id === 's-jeanluc') continue;
    for (const d of days) for (const sl of slots) {
      const x = r();
      if (x < 0.028) {
        const y = r();
        const justif = y < 0.45 ? 'acceptee' : y < 0.55 ? 'en_attente' : y < 0.65 ? 'refusee' : 'aucune';
        absences.push({ id: `ab-${++aSeq}`, studentId: st.id, classId: st.classId, date: d, slot: sl, status: 'A', justif, motif: justif === 'aucune' ? undefined : pick(motifs) });
      } else if (x < 0.05) {
        absences.push({ id: `ab-${++aSeq}`, studentId: st.id, classId: st.classId, date: d, slot: sl, status: 'R', justif: 'aucune' });
      }
    }
  }
  absences.push(
    { id: `ab-${++aSeq}`, studentId: 's-marie', classId: 'c3a', date: '2026-12-10', slot: 'Matin', status: 'A', justif: 'aucune' },
    { id: `ab-${++aSeq}`, studentId: 's-marie', classId: 'c3a', date: '2026-12-08', slot: 'Matin', status: 'R', justif: 'aucune' },
    { id: `ab-${++aSeq}`, studentId: 's-jeanluc', classId: 'c6b', date: '2026-12-03', slot: 'Après-midi', status: 'A', justif: 'en_attente', motif: 'Rendez-vous médical' },
  );

  // --- Discipline ---
  const inClass = (cid: string, i: number) => students.filter((s) => s.classId === cid)[i].id;
  const incidents: Incident[] = [
    { id: 'in-1', studentId: 's-jeanluc', date: '2026-11-20', type: 'bavardage', gravite: 'legere', sanction: 'observation', description: 'Bavardages répétés pendant le cours de mathématiques.', status: 'valide', byUserId: 'u-educ' },
    { id: 'in-2', studentId: inClass('c4a', 3), date: '2026-12-10', type: 'bagarre', gravite: 'grave', sanction: 'exclusion_temp', description: 'Bagarre dans la cour pendant la récréation, un élève légèrement blessé.', status: 'a_valider', byUserId: 'u-educ' },
    { id: 'in-3', studentId: inClass('c5a', 2), date: '2026-12-04', type: 'telephone', gravite: 'moyenne', sanction: 'convocation', description: 'Téléphone utilisé en classe malgré un premier rappel.', status: 'valide', byUserId: 'u-educ' },
    { id: 'in-4', studentId: inClass('c3b', 5), date: '2026-11-26', type: 'devoirs', gravite: 'legere', sanction: 'travail', description: 'Devoirs non faits trois fois de suite.', status: 'valide', byUserId: 'u-educ' },
    { id: 'in-5', studentId: inClass('c2c', 1), date: '2026-12-09', type: 'tenue', gravite: 'legere', sanction: 'avertissement', description: 'Tenue non conforme au règlement intérieur.', status: 'valide', byUserId: 'u-educ' },
    { id: 'in-6', studentId: inClass('c1d', 4), date: '2026-11-17', type: 'fraude', gravite: 'grave', sanction: 'exclusion_cours', description: 'Tentative de triche pendant une interrogation de sciences.', status: 'valide', byUserId: 'u-educ', decidedBy: 'u-admin', decisionNote: 'Sanction confirmée après entretien.' },
  ];

  // --- Frais et paiements ---
  const tarifs: Record<string, Tarif> = {
    '6e': { ins: 50000, sco: 180000 }, '5e': { ins: 50000, sco: 180000 },
    '4e': { ins: 50000, sco: 195000 }, '3e': { ins: 50000, sco: 195000 },
    '2nde': { ins: 60000, sco: 240000 }, '1ère': { ins: 60000, sco: 255000 }, Tle: { ins: 60000, sco: 270000 },
  };
  const feeDates: FeeDates = { INS: '2026-09-07', T1: '2026-09-30', T2: '2027-01-10', T3: '2027-04-05' };
  const rawPays: Omit<Payment, 'id' | 'receiptNo'>[] = [];
  const modes: PayMode[] = ['especes', 'especes', 'especes', 'especes', 'virement', 'virement', 'orange', 'orange', 'mtn', 'mtn', 'wave', 'wave', 'moov', 'cheque'];
  const refCode = (d: string) => `CP-${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${String(Math.floor(r() * 9000) + 1000)}`;
  const payDay = (from: string, to: string): string => {
    const ds = weekdaysBetween(from, to);
    return ds[Math.floor(r() * ds.length)];
  };
  const add = (studentId: string, amount: number, mode: PayMode, date: string) => {
    const online = mode === 'orange' || mode === 'mtn' || mode === 'moov' || mode === 'wave';
    rawPays.push({ studentId, amount, mode, date, status: 'confirme', byUserId: online ? 'u-system' : 'u-compta', ref: online ? refCode(date) : undefined });
  };
  for (const st of students) {
    const cl = classes.find((c) => c.id === st.classId)!;
    const items = feeItems(tarifs[cl.level], feeDates, siblingPct(students, st.id, school.remiseFratrie));
    if (st.id === 's-marie') {
      add(st.id, 50000, 'especes', '2026-09-03');
      add(st.id, 40000, 'mtn', '2026-10-12');
      continue;
    }
    if (st.id === 's-jeanluc') {
      add(st.id, 50000, 'wave', '2026-09-05');
      continue;
    }
    if (r() < 0.93) add(st.id, items[0].amount, pick(modes), payDay('2026-09-01', '2026-09-11'));
    const x = r();
    if (x < 0.6) add(st.id, items[1].amount, pick(modes), payDay('2026-09-15', '2026-12-10'));
    else if (x < 0.72) add(st.id, Math.round((items[1].amount * pick([0.4, 0.5, 0.6, 0.75])) / 1000) * 1000, pick(modes), payDay('2026-10-01', '2026-12-10'));
  }
  rawPays.sort((a, b) => a.date.localeCompare(b.date));
  const payments: Payment[] = rawPays.map((p, i) => ({ ...p, id: `pay-${String(i + 1).padStart(4, '0')}`, receiptNo: `REC-2026-${String(i + 1).padStart(5, '0')}` }));

  // Relevé de l'agrégateur (simulé) avec deux anomalies
  const statement: StatementLine[] = payments
    .filter((p) => p.ref)
    .map((p, i) => ({ id: `st-${String(i + 1).padStart(3, '0')}`, ref: p.ref!, date: p.date, mode: p.mode, amount: p.amount, phone: phone(), paymentId: p.id }));
  const anomalyPay = payments.find((p) => p.ref && p.amount >= 50000 && p.studentId !== 's-marie');
  if (anomalyPay) {
    const line = statement.find((l) => l.paymentId === anomalyPay.id)!;
    // le paiement enregistré a un montant erroné, la ligne du relevé garde le montant d'origine
    anomalyPay.amount = Math.round(anomalyPay.amount / 10);
    anomalyPay.note = `Écart avec le relevé (${line.ref})`;
  }
  statement.push({ id: `st-${String(statement.length + 1).padStart(3, '0')}`, ref: 'CP-261203-4418', date: '2026-12-03', mode: 'wave', amount: 60000, phone: '05 61 20 77 18' });
  statement.sort((a, b) => a.date.localeCompare(b.date));

  // --- Annonces, notifications, journal ---
  const announcements: Announcement[] = [
    { id: 'an-1', title: 'Compositions du 1er trimestre terminées', body: 'Les compositions du 1er trimestre sont terminées. Les enseignants disposent jusqu\'au 16 décembre pour saisir les dernières notes. Les bulletins seront disponibles après les conseils de classe.', date: '2026-12-11', audience: ['fondateur', 'directeur', 'educateur', 'admin', 'enseignant', 'parent', 'eleve', 'comptable'], authorId: 'u-admin' },
    { id: 'an-2', title: 'Réunion parents-professeurs', body: 'Une réunion avec les parents d\'élèves aura lieu le samedi 19 décembre à 9 h, à l\'école. La présence d\'au moins un parent par élève est souhaitée.', date: '2026-12-09', audience: ['parent', 'enseignant', 'admin', 'directeur', 'fondateur', 'educateur'], authorId: 'u-admin' },
    { id: 'an-3', title: 'Rappel : 1re tranche de scolarité', body: 'Les parents dont le solde de la 1re tranche n\'est pas réglé sont invités à passer à la comptabilité ou à payer en ligne depuis leur espace, par mobile money.', date: '2026-12-04', audience: ['parent', 'comptable', 'admin', 'directeur', 'fondateur', 'educateur'], authorId: 'u-compta' },
    { id: 'an-4', title: 'Vacances de Noël', body: 'Les cours reprendront le lundi 4 janvier 2027. Bonnes fêtes de fin d\'année à tous.', date: '2026-12-02', audience: ['fondateur', 'directeur', 'educateur', 'admin', 'enseignant', 'parent', 'eleve', 'comptable'], authorId: 'u-admin' },
  ];
  const nid = (() => { let n = 0; return () => `n-${++n}`; })();
  const notices: Notice[] = [
    { id: nid(), userId: 'u-p-brou', text: 'Marie-Ange a été absente le jeudi 10 décembre (matin). Absence non justifiée.', date: '2026-12-10', read: false, kind: 'absence', page: 'presences' },
    { id: nid(), userId: 'u-p-brou', text: 'Observation écrite pour Jean-Luc (bavardages en classe).', date: '2026-11-20', read: true, kind: 'discipline', page: 'presences' },
    { id: nid(), userId: 'u-p-brou', text: 'Nouvelle annonce : Réunion parents-professeurs.', date: '2026-12-09', read: false, kind: 'annonce', page: 'annonces' },
    { id: nid(), userId: 'u-s-marie', text: 'Nouvelles notes publiées en Français.', date: '2026-12-08', read: true, kind: 'note', page: 'notes' },
    { id: nid(), userId: 'u-educ', text: 'Des justificatifs d\'absence attendent votre décision.', date: '2026-12-11', read: false, kind: 'absence', page: 'presences' },
    { id: nid(), userId: 'u-admin', text: 'Une sanction grave (4e A) attend votre validation.', date: '2026-12-10', read: false, kind: 'discipline', page: 'discipline' },
    { id: nid(), userId: 'u-admin', text: 'Des notes saisies attendent votre publication.', date: '2026-12-11', read: false, kind: 'note', page: 'notes' },
    { id: nid(), userId: 'u-t-ma1', text: 'La composition de Mathématiques de la 3e A est à saisir.', date: '2026-12-08', read: false, kind: 'note', page: 'notes' },
    { id: nid(), userId: 'u-compta', text: 'Une ligne du relevé de l\'agrégateur n\'a pas de paiement associé.', date: '2026-12-04', read: false, kind: 'paiement', page: 'rapprochement' },
  ];
  const log: LogEntry[] = [
    { id: 'l-1', ts: '2026-12-11T16:20', userId: 'u-admin', action: 'Publication', detail: 'Notes publiées : 3e B, Français, Composition' },
    { id: 'l-2', ts: '2026-12-10T09:05', userId: 'u-compta', action: 'Paiement', detail: 'Paiement enregistré au guichet' },
    { id: 'l-3', ts: '2026-12-08T11:42', userId: 'u-t-fr1', action: 'Saisie de notes', detail: '6e A, Français, Composition' },
    { id: 'l-4', ts: '2026-09-04T08:30', userId: 'u-admin', action: 'Année scolaire', detail: 'Ouverture de l\'année 2026-2027' },
  ];

  const c3 = students.filter((s) => s.classId === 'c3a' && s.id !== 's-marie');
  const decisions: Decision[] = [
    { studentId: c3.at(0)!.id, value: 'admis', comment: 'Bon trimestre, passage accordé.', byUserId: 'u-admin', date: '2026-12-12' },
    { studentId: c3.at(1)!.id, value: 'conseil', comment: 'Résultats fragiles, situation à examiner au conseil.', byUserId: 'u-admin', date: '2026-12-12' },
  ];

  return {
    school, users, classes, subjects: SUBJECTS, coefs, teachers, parents, students, assignments, terms, evals, grades,
    apprec, conseil, absences, sessions, incidents, tarifs, feeDates, payments, statement, notices, log, announcements, decisions,
  };
}

export const SEED_TODAY = DEMO_TODAY;
export const SEED_DAY_BEFORE = addDays(DEMO_TODAY, -1);
