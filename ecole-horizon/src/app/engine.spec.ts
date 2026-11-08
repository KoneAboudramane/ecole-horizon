import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { nombreEnLettres, fcfa, parseNote, toCsv, waLink } from './format';
import { allocate, computeTerm, coefKey, currentTermOf, justifDeadline, discountedTarif, feeItems, mention, paymentDetail, proposeDecision, siblingPct, splitTranches, sur20, proposeFor, termCoef, weightedAnnual } from './engine';
import { Store } from './store';
import { Dispo } from './modules/dispo';

describe('Montant en lettres', () => {
  it('écrit les montants usuels', () => {
    expect(nombreEnLettres(65000)).toBe('soixante-cinq mille');
    expect(nombreEnLettres(195000)).toBe('cent quatre-vingt-quinze mille');
    expect(nombreEnLettres(180000)).toBe('cent quatre-vingt mille');
    expect(nombreEnLettres(80)).toBe('quatre-vingts');
    expect(nombreEnLettres(200)).toBe('deux cents');
    expect(nombreEnLettres(71)).toBe('soixante et onze');
    expect(nombreEnLettres(91000)).toBe('quatre-vingt-onze mille');
    expect(nombreEnLettres(1250000)).toBe('un million deux cent cinquante mille');
    expect(nombreEnLettres(21)).toBe('vingt et un');
    expect(nombreEnLettres(1000)).toBe('mille');
  });
  it('formate les francs CFA', () => {
    expect(fcfa(1250000)).toBe('1 250 000 FCFA');
  });
  it('génère un CSV compatible Excel', () => {
    expect(toCsv(['a', 'b'], [['x;y', 2]])).toBe('﻿a;b\r\n"x;y";2');
  });
});

describe('Frais de scolarité', () => {
  it('répartit les paiements dans l\'ordre des échéances', () => {
    const items = feeItems({ ins: 50000, sco: 195000 }, { INS: '2026-09-07', T1: '2026-09-30', T2: '2027-01-10', T3: '2027-04-05' });
    expect(items.map((i) => i.amount)).toEqual([50000, 65000, 65000, 65000]);
    const lines = allocate(items, 90000, '2026-12-14');
    expect(lines[0].remaining).toBe(0);
    expect(lines[1].paid).toBe(40000);
    expect(lines[1].overdue).toBe(true);
    expect(lines[2].overdue).toBe(false);
  });
  it('donne la mention selon les seuils', () => {
    expect(mention(16.2, [16, 14, 12, 10])).toBe('Très bien');
    expect(mention(9.9, [16, 14, 12, 10])).toBe('Insuffisant');
  });
});

describe('Données de démonstration', () => {
  const store = TestBed.inject(Store);

  it('crée 14 classes et environ 190 élèves', () => {
    expect(store.classes().length).toBe(14);
    expect(store.students().length).toBeGreaterThan(180);
  });

  it('calcule moyennes et rangs cohérents', () => {
    const cs = store.classStats('c3a', false)!;
    expect(cs.effectif).toBe(16);
    const ranks = [...cs.results.values()].map((r) => r.rang!).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    const marie = store.resultOf('s-marie', false)!;
    console.log('Marie-Ange', marie.moyenne?.toFixed(2), 'rang', marie.rang, '/', cs.effectif, 'classe', cs.avg?.toFixed(2), cs.min?.toFixed(2), cs.max?.toFixed(2));
    const jl = store.resultOf('s-jeanluc', false)!;
    console.log('Jean-Luc', jl.moyenne?.toFixed(2), 'rang', jl.rang);
    expect(marie.moyenne).toBeGreaterThan(10);
    for (const c of store.classes()) {
      const s = store.classStats(c.id, false)!;
      expect(s.avg).not.toBeNull();
      expect(s.avg!).toBeGreaterThan(8);
      expect(s.avg!).toBeLessThan(16);
    }
  });

  it('ne montre aux familles que les notes publiées', () => {
    const pub = store.resultOf('s-marie', true)!;
    const all = store.resultOf('s-marie', false)!;
    const maPub = pub.subjects.find((s) => s.subjectId === 'ma')!;
    expect(maPub.compo).toBeNull(); // composition de maths non publiée
    expect(all.subjects.find((s) => s.subjectId === 'ma')!.compo).toBeNull(); // et pas encore saisie
  });

  it('applique le verrouillage de trimestre', () => {
    store.userId.set('u-t-ma1');
    const ev = store.evals().find((e) => e.classId === 'c3a' && e.subjectId === 'ma' && e.type === 'composition')!;
    expect(store.saveGrades(ev.id, { 's-marie': 15 }).ok).toBe(true);
    store.userId.set('u-admin');
    store.lockTerm('T1', true);
    store.userId.set('u-t-ma1');
    expect(store.saveGrades(ev.id, { 's-marie': 12 }).ok).toBe(false);
    store.userId.set('u-admin');
    expect(store.saveGrades(ev.id, { 's-marie': 12 }).ok).toBe(false);   // la direction ne touche jamais aux notes
    store.lockTerm('T1', false);
    store.userId.set('u-t-ma1');
    expect(store.saveGrades(ev.id, { 's-marie': 12 }).ok).toBe(true);    // déverrouillé : l'enseignant corrige
  });

  it('supprime une évaluation en brouillon avec ses notes, jamais une évaluation publiée', () => {
    store.userId.set('u-t-ma1');
    const ev = store.createEval({ classId: 'c3a', subjectId: 'ma', type: 'interro', title: 'À retirer', date: '2026-10-09' });
    store.saveGrades(ev.id, { 's-marie': 11 });
    expect(store.deleteEval(ev.id).ok).toBe(true);
    expect(store.evals().some((e) => e.id === ev.id)).toBe(false);
    expect(Object.keys(store.grades()).some((k) => k.startsWith(ev.id + '|'))).toBe(false);
    const pub = store.evals().find((e) => e.published)!;
    expect(store.deleteEval(pub.id).ok).toBe(false);
    expect(store.evals().some((e) => e.id === pub.id)).toBe(true);
    const autre = store.createEval({ classId: 'c3a', subjectId: 'ma', type: 'interro', title: 'Pas à la direction', date: '2026-10-09' });
    store.userId.set('u-admin');
    expect(store.deleteEval(autre.id).ok).toBe(false);          // seul l'enseignant de l'évaluation la retire
    store.userId.set('u-t-ma1');
    expect(store.deleteEval(autre.id).ok).toBe(true);
  });

  it('professeur principal : attribué par l’administration, il voit toute sa classe', () => {
    store.userId.set('u-t-ma1');
    expect(store.setPrincipal('c3a', store.myTeacher()!.id).ok).toBe(false);          // un enseignant ne se désigne pas
    const me = store.myTeacher()!.id;
    store.userId.set('u-secr');
    expect(store.setPrincipal('c3a', me).ok).toBe(true);
    store.userId.set('u-t-ma1');
    expect(store.myPrincipalClasses().map((c) => c.id)).toEqual(['c3a']);
    return store.principalClassAsync('c3a').then((r) => {
      expect(r.data!.students.length).toBe(store.studentsByClass().get('c3a')!.length);
      expect(r.data!.subjects.length).toBeGreaterThan(1);                                 // toutes les matières, pas seulement les siennes
      store.userId.set('u-secr');
      store.setPrincipal('c3a', null);
      store.userId.set('u-t-ma1');
      expect(store.myPrincipalClasses()).toEqual([]);
    });
  });

  it('prend en compte la composition après saisie et publication', () => {
    const ev = store.evals().find((e) => e.classId === 'c3a' && e.subjectId === 'ma' && e.type === 'composition')!;
    expect(store.resultOf('s-marie', true)!.subjects.find((s) => s.subjectId === 'ma')!.compo).toBeNull();
    store.userId.set('u-secr');
    store.setPublished([ev.id], true); // le secrétariat ne peut pas publier
    expect(store.evals().find((e) => e.id === ev.id)!.published).toBe(false);
    store.userId.set('u-admin');
    store.setPublished([ev.id], true);
    expect(store.resultOf('s-marie', true)!.subjects.find((s) => s.subjectId === 'ma')!.compo).toBe(12);
  });

  it('calcule le solde de la famille de démonstration', () => {
    expect(store.balance('s-marie').overdue).toBe(25000);
    expect(store.balance('s-jeanluc').overdue).toBe(54000); // remise fratrie de 10 %
  });

  it('enregistre un paiement et numérote le reçu', () => {
    const n = store.payments().length;
    const p = store.recordPayment({ studentId: 's-jeanluc', amount: 60000, mode: 'wave', ref: 'CP-TEST-0001' });
    expect(store.payments().length).toBe(n + 1);
    expect(p.receiptNo).toMatch(/^REC-2026-\d{5}$/);
    expect(store.balance('s-jeanluc').overdue).toBe(0);
  });

  it('crée un élève avec comptes à mot de passe temporaire', () => {
    const { student, creds } = store.addStudent({
      nom: 'Test', prenoms: 'Eva', sexe: 'F', naissance: '2013-04-02', lieu: 'Abidjan', classId: 'c6a',
      parentName: 'Test Paul', parentPhone: '07 00 11 22 33', parentTitle: 'M.',
    });
    expect(student.matricule).toMatch(/^HZ26-\d{4}$/);
    expect(creds.length).toBe(2);
    const u = store.users().find((x) => x.username === student.matricule.toLowerCase())!;
    expect(u.mustChange).toBe(true);
  });

  it('signale les anomalies du relevé de l\'agrégateur', () => {
    expect(store.statementIssues().length).toBeGreaterThanOrEqual(2);
  });

  it('assiduité : calcule un taux par classe', () => {
    const rate = store.classAttendance('c3a')!;
    expect(rate).toBeGreaterThan(90);
    expect(rate).toBeLessThanOrEqual(100);
  });

  it('applique la matrice des permissions', () => {
    store.userId.set('u-fond'); expect(store.can('pay.read')).toBe(true); expect(store.can('publish')).toBe(false);
    store.userId.set('u-educ'); expect(store.can('justifs')).toBe(true); expect(store.can('pay.read')).toBe(false);
    store.userId.set('u-compta'); expect(store.can('pay.write')).toBe(true); expect(store.can('discipline')).toBe(false);
    store.userId.set('u-admin'); expect(store.can('publish')).toBe(true); expect(store.can('students.write')).toBe(false);
  });

  it('inclut la matière Arabe dans les bulletins', () => {
    const r = store.resultOf('s-marie', false)!;
    expect(r.subjects.some((s) => s.subjectId === 'ar' && s.moy !== null)).toBe(true);
  });

  it('soumet les sanctions graves à la validation du directeur', () => {
    store.userId.set('u-educ');
    const inc = store.addIncident({ studentId: 's-jeanluc', type: 'bagarre', gravite: 'grave', sanction: 'exclusion_temp', description: 'Bagarre dans la cour.' });
    expect(inc.status).toBe('a_valider');
    const before = store.myNotices().length;
    store.userId.set('u-p-brou');
    const parentBefore = store.myNotices().length;
    store.userId.set('u-educ');
    store.decideIncident(inc.id, true, ''); // l'éducateur ne peut pas valider
    expect(store.incidents().find((i) => i.id === inc.id)!.status).toBe('a_valider');
    store.userId.set('u-admin');
    store.decideIncident(inc.id, true, 'ok');
    expect(store.incidents().find((i) => i.id === inc.id)!.status).toBe('valide');
    store.userId.set('u-p-brou');
    expect(store.myNotices().length).toBe(parentBefore + 1);
    expect(before).toBeGreaterThanOrEqual(0);
  });
});

describe('Remise fratrie', () => {
  it('réduit la scolarité sans toucher à l\'inscription', () => {
    expect(discountedTarif({ ins: 50000, sco: 180000 }, 10)).toEqual({ ins: 50000, sco: 162000 });
    const items = feeItems({ ins: 50000, sco: 180000 }, { INS: 'a', T1: 'b', T2: 'c', T3: 'd' }, 10);
    expect(items.map((i) => i.amount)).toEqual([50000, 54000, 54000, 54000]);
  });
  it('s\'applique au 2e enfant et suivants uniquement', () => {
    const st = (id: string, parentId: string) => ({ id, parentId }) as never;
    const list = [st('a', 'p1'), st('b', 'p2'), st('c', 'p1'), st('d', 'p1')];
    expect(siblingPct(list, 'a', 10)).toBe(0);
    expect(siblingPct(list, 'b', 10)).toBe(0);
    expect(siblingPct(list, 'c', 10)).toBe(10);
    expect(siblingPct(list, 'd', 10)).toBe(10);
    expect(siblingPct(list, 'c', 0)).toBe(0);
  });
  it('se reflète dans le solde et suit le réglage', () => {
    const store = TestBed.inject(Store);
    expect(store.siblingDiscount('s-marie').pct).toBe(0);
    expect(store.siblingDiscount('s-jeanluc')).toEqual({ pct: 10, amount: 18000 });
    expect(store.balance('s-jeanluc').total).toBe(50000 + 162000);
    store.updateSchool({ remiseFratrie: 0 });
    expect(store.balance('s-jeanluc').total).toBe(50000 + 180000);
    store.updateSchool({ remiseFratrie: 10 });
  });
});

describe('Décisions de fin d\'année', () => {
  it('propose une décision selon la moyenne', () => {
    expect(proposeDecision(12).label).toBe('Admis(e)');
    expect(proposeDecision(10).value).toBe('admis');
    expect(proposeDecision(9.99).label).toBe('À examiner par le conseil');
    expect(proposeDecision(8).value).toBe('conseil');
    expect(proposeDecision(7.9).label).toBe('Redoublement proposé');
    expect(proposeDecision(null).label).toBe('En attente de notes');
    const own = { passageAdmission: 12, passageRedoublement: 9, passageExclusion: 5 };
    expect(proposeDecision(11, own).value).toBe('conseil');
    expect(proposeDecision(12, own).value).toBe('admis');
    expect(proposeDecision(8.9, own).value).toBe('redouble');
    expect(proposeDecision(4.9, own).value).toBe('exclu');
    expect(proposeDecision(4.9).value).toBe('redouble');
    const lv = { passageNiveaux: { '3e': { admission: 11, redoublement: 9, exclusion: null } } };
    expect(proposeDecision(10, lv, '3e').value).toBe('conseil');
    expect(proposeDecision(10, lv, '4e').value).toBe('admis');
    expect(proposeDecision(10, lv).value).toBe('admis');
  });
  it('réserve l\'enregistrement à la direction et prévient la famille', () => {
    const store = TestBed.inject(Store);
    store.userId.set('u-secr');
    expect(store.setDecision('s-marie', 'admis', '')).toBe(false);
    expect(store.decisionOf('s-marie')).toBeUndefined();
    store.userId.set('u-admin');
    expect(store.setDecision('s-marie', 'admis', 'Félicitations')).toBe(false);   // année en cours
    store.terms.update((l) => l.map((t, i) => (i === l.length - 1 ? { ...t, locked: true } : t)));
    expect(store.setDecision('s-marie', 'admis', 'Félicitations')).toBe(true);
    expect(store.decisionOf('s-marie')?.value).toBe('admis');
    store.userId.set('u-p-brou');
    expect(store.myNotices().some((n) => n.text.includes('Décision du conseil') && n.page === 'bulletins')).toBe(true);
  });
});

describe('Profil utilisateur', () => {
  it('modifie les informations après validation', () => {
    const store = TestBed.inject(Store);
    store.userId.set('u-p-brou');
    expect(store.updateProfile({ phone: '12' }).ok).toBe(false);
    expect(store.updateProfile({ email: 'pas-un-mail' }).ok).toBe(false);
    expect(store.updateProfile({ name: 'M. Brou Kouassi Paul', phone: '07 08 09 10 11', email: 'brou@example.ci' }).ok).toBe(true);
    expect(store.me()?.name).toBe('M. Brou Kouassi Paul');
    expect(store.me()?.email).toBe('brou@example.ci');
  });
  it('enregistre et retire la photo', () => {
    const store = TestBed.inject(Store);
    store.userId.set('u-p-brou');
    store.setPhoto('data:image/jpeg;base64,AAAA');
    expect(store.me()?.photo).toContain('data:image');
    store.setPhoto(null);
    expect(store.me()?.photo).toBeUndefined();
  });
  it('change le mot de passe seulement avec le bon mot de passe actuel', () => {
    const store = TestBed.inject(Store);
    store.userId.set('u-p-brou');
    expect(store.changeOwnPassword('faux', 'nouveau1', 'nouveau1').ok).toBe(false);
    expect(store.changeOwnPassword('demo', 'nouveau1', 'autre').ok).toBe(false);
    expect(store.changeOwnPassword('demo', 'abc', 'abc').ok).toBe(false);
    expect(store.changeOwnPassword('demo', 'nouveau1', 'nouveau1').ok).toBe(true);
    store.logout();
    expect(store.login('parent', 'demo').ok).toBe(false);
    expect(store.login('parent', 'nouveau1').ok).toBe(true);
  });
});

describe('Lien WhatsApp', () => {
  it('normalise un numéro ivoirien à 10 chiffres', () => {
    expect(waLink('07 01 02 03 04', 'Salut')).toBe('https://wa.me/2250701020304?text=Salut');
  });
  it('accepte +225 et 00225', () => {
    expect(waLink('+225 07 01 02 03 04', 'a')).toContain('wa.me/2250701020304');
    expect(waLink('00225 0701020304', 'a')).toContain('wa.me/2250701020304');
  });
  it('refuse un numéro trop court et encode le texte', () => {
    expect(waLink('1234', 'a')).toBeNull();
    expect(waLink('0701020304', 'a b&c')).toContain('a%20b%26c');
  });
});

describe('tranches de scolarité propres à l’école', () => {
  it('trois tranches égales par défaut, comme avant', () => {
    expect(feeItems({ ins: 50000, sco: 195000 }, {}).map((i) => i.amount)).toEqual([50000, 65000, 65000, 65000]);
    expect(splitTranches(100000, [1, 1, 1])).toEqual([33333, 33333, 33334]);
  });
  it('nombre, noms et parts libres ; le total reste exact', () => {
    const items = feeItems({ ins: 10000, sco: 180000 }, { T2: '2027-01-10' }, 0, [{ label: '1er semestre', part: 1 }, { label: '2e semestre', part: 1 }]);
    expect(items.map((i) => [i.key, i.label, i.amount])).toEqual([['INS', 'Inscription', 10000], ['T1', '1er semestre', 90000], ['T2', '2e semestre', 90000]]);
    expect(items[2].due).toBe('2027-01-10');
    expect(items[1].due).toBe('9999-12-31');                       // échéance non datée : jamais en retard
    const t = [{ label: 'a', part: 50 }, { label: 'b', part: 30 }, { label: 'c', part: 20 }];
    expect(splitTranches(250000, t.map((x) => x.part))).toEqual([125000, 75000, 50000]);
    expect(splitTranches(100001, [1, 2, 3]).reduce((a, b) => a + b, 0)).toBe(100001);
  });
});

describe('solde de l’année précédente', () => {
  it('apparaît en première ligne et se paie en premier', () => {
    const items = feeItems({ ins: 50000, sco: 180000 }, { INS: '2027-09-07', T1: '2027-10-01' }, 0, undefined, 30000, '2027-09-05');
    expect(items[0]).toMatchObject({ key: 'REP', amount: 30000, due: '2027-09-05' });
    const lines = allocate(items, 30000, '2027-12-01');
    expect(lines[0].remaining).toBe(0);
    expect(lines[1].paid).toBe(0);
  });
  it('rien si aucun solde', () => {
    expect(feeItems({ ins: 1, sco: 3 }, {}, 0, undefined, 0).some((i) => i.key === 'REP')).toBe(false);
  });
});

describe('Coefficient d\'une évaluation', () => {
  const base = (coef: number | undefined) => computeTerm({
    classes: [{ id: 'c', groupe: 'college' } as never], students: [{ id: 's', classId: 'c' } as never], subjects: [{ id: 'ma' } as never],
    coefs: { [coefKey('college' as never, 'ma')]: 2 },
    evals: [
      { id: 'e1', classId: 'c', subjectId: 'ma', termId: 'T1', type: 'interro', published: true } as never,
      { id: 'e2', classId: 'c', subjectId: 'ma', termId: 'T1', type: 'devoir', published: true, coef } as never,
    ],
    grades: { 'e1|s': 10, 'e2|s': 18 }, termId: 'T1', compoWeight: 0.5, onlyPublished: false,
  }).get('c')!.results.get('s')!.subjects[0].mc;
  it('pondère la moyenne de la matière', () => { expect(base(3)).toBe(16); });
  it('vaut 1 par défaut (moyenne simple)', () => { expect(base(undefined)).toBe(14); expect(base(1)).toBe(14); });
});

describe('Barème d\'une évaluation (sur 10, 20, 30 ou autre)', () => {
  const mc = (b1: number | undefined, b2: number | undefined, g1: number, g2: number) => computeTerm({
    classes: [{ id: 'c', groupe: 'college' } as never], students: [{ id: 's', classId: 'c' } as never], subjects: [{ id: 'ma' } as never],
    coefs: { [coefKey('college' as never, 'ma')]: 2 },
    evals: [
      { id: 'e1', classId: 'c', subjectId: 'ma', termId: 'T1', type: 'interro', published: true, bareme: b1 } as never,
      { id: 'e2', classId: 'c', subjectId: 'ma', termId: 'T1', type: 'devoir', published: true, bareme: b2 } as never,
    ],
    grades: { 'e1|s': g1, 'e2|s': g2 }, termId: 'T1', compoWeight: 0.5, onlyPublished: false,
  }).get('c')!.results.get('s')!.subjects[0].mc;
  it('ramène chaque note sur 20 avant la moyenne, comme le serveur', () => { expect(mc(30, 10, 15, 8)).toBe(13); });   // 10/20 et 16/20
  it('vaut 20 par défaut', () => { expect(mc(undefined, undefined, 10, 18)).toBe(14); });
  it('ramène une note sur 20', () => { expect(sur20(15, 30)).toBe(10); expect(sur20(7.5, 10)).toBe(15); expect(sur20(12, undefined)).toBe(12); });
  it('borne la saisie au barème', () => { expect(parseNote('28', 30)).toBe(28); expect(parseNote('31', 30)).toBe('err'); expect(parseNote('21')).toBe('err'); expect(parseNote('9,5', 10)).toBe(9.5); });
});

describe('Note de conduite (démonstration)', () => {
  const inp = (conduct: { max: number; coef: number; inAverage: boolean; removed: Record<string, number> } | undefined) => computeTerm({
    classes: [{ id: 'c', groupe: 'college' } as never], students: [{ id: 's', classId: 'c' } as never, { id: 't', classId: 'c' } as never], subjects: [{ id: 'ma' } as never],
    coefs: { [coefKey('college' as never, 'ma')]: 2 },
    evals: [{ id: 'e1', classId: 'c', subjectId: 'ma', termId: 'T1', type: 'devoir', published: true } as never],
    grades: { 'e1|s': 10 }, termId: 'T1', compoWeight: 0.5, onlyPublished: false, conduct,
  }).get('c')!.results;
  it('entre dans la moyenne avec son coefficient, dès qu\'une matière est notée', () => {
    const r = inp({ max: 20, coef: 1, inAverage: true, removed: { s: 3 } });
    expect(r.get('s')!.conduite?.note).toBe(17);
    expect(r.get('s')!.moyenne).toBeCloseTo((10 * 2 + 17) / 3);
    expect(r.get('t')!.moyenne).toBeNull();                 // sans note de matière, la conduite seule ne donne pas de moyenne
  });
  it('reste affichée mais hors moyenne si l\'école le décide, et absente sans conduite', () => {
    expect(inp({ max: 20, coef: 1, inAverage: false, removed: {} }).get('s')!.moyenne).toBe(10);
    expect(inp(undefined).get('s')!.conduite).toBeNull();
  });
});

describe('Conduite : règle des absences et classes de l\'éducateur (démonstration)', () => {
  it('applique la règle une seule fois par tranche, relançable', async () => {
    const store = TestBed.inject(Store);
    const cl = store.classes()[0].id;
    const st = (store.studentsByClass().get(cl) ?? [])[0];
    store.absences.update((l) => [...l.filter((a) => a.studentId !== st.id), ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 'z' + n, studentId: st.id, classId: cl, date: store.term().start.slice(0, 8) + String(10 + n), slot: 'Matin' as const, status: 'A' as const, justif: 'aucune' as const }))]);
    const a = await store.applyAbsencesAsync(cl);
    expect(a.updated).toBe(1);
    expect((await store.applyAbsencesAsync(cl)).updated).toBe(0);
    let row = (await store.conductAsync(cl)).sheet!.students.find((r) => r.studentId === st.id)!;
    expect(row).toMatchObject({ halfdays: 6, due: 2, applied: 2, note: 18 });
    await store.addDeductionAsync({ studentId: st.id, points: 1.5, reason: 'Retards' });
    row = (await store.conductAsync(cl)).sheet!.students.find((r) => r.studentId === st.id)!;
    expect(row.note).toBe(16.5);
    await store.removeDeductionAsync(row.deductions.find((d) => d.kind === 'autre')!.id);
    expect((await store.conductAsync(cl)).sheet!.students.find((r) => r.studentId === st.id)!.note).toBe(18);
  });
  it('un justificatif saisi par l\'école met à jour le retrait déjà appliqué', async () => {
    const store = TestBed.inject(Store);
    store.userId.set('u-admin');
    const cl = store.classes()[0].id;
    const st = (store.studentsByClass().get(cl) ?? [])[0];
    store.absences.update((l) => [...l.filter((a) => a.studentId !== st.id), ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 'z' + n, studentId: st.id, classId: cl, date: store.term().start.slice(0, 8) + String(10 + n), slot: 'Matin' as const, status: 'A' as const, justif: 'aucune' as const }))]);
    await store.applyAbsencesAsync(cl);
    expect((await store.recordJustifAsync('z1', 'Certificat médical')).ok).toBe(true);
    expect(store.absences().find((a) => a.id === 'z1')?.justif).toBe('acceptee');
    expect((await store.conductAsync(cl)).sheet!.students.find((r) => r.studentId === st.id)).toMatchObject({ halfdays: 5, applied: 1, note: 19 });
  });
  it('la famille ne justifie plus après le délai fixé par l\'école', async () => {
    expect(justifDeadline('2026-10-10', 3)).toBe('2026-10-13');
    expect(justifDeadline('2026-12-30', 5)).toBe('2027-01-04');
    expect(justifDeadline('2026-10-10', 0)).toBeNull();
    const store = TestBed.inject(Store);
    const ab = store.absences().find((a) => a.status === 'A')!;
    const late = { ...ab, date: '2026-01-05', justif: 'aucune' as const };
    store.absences.update((l) => l.map((a) => (a.id === ab.id ? late : a)));
    expect(store.familyJustifBlock(late)).toBeNull();                      // sans délai : toujours possible
    store.school.update((c) => ({ ...c, justifDelai: 3 }));
    expect(store.familyJustifBlock(late)).toContain('Délai');
    expect((await store.submitJustifAsync(ab.id, 'Consultation médicale')).ok).toBe(false);
  });
  it('limite l\'éducateur à ses classes', async () => {
    const store = TestBed.inject(Store);
    const edu = store.users().find((u) => u.role === 'educateur')!;
    const [c1, c2] = store.classes();
    await store.setEducatorClassesAsync(edu.id, [c1.id]);
    store.userId.set(edu.id);
    expect(store.scopeClasses().map((c) => c.id)).toEqual([c1.id]);
    expect((await store.conductAsync(c2.id)).error).toMatch(/vos classes/);
    store.userId.set(null);
  });
});

describe('Reçu détaillé par échéance', () => {
  const dates = { INS: '2026-09-01', T1: '2026-10-15', T2: '2027-01-15', T3: '2027-04-15' };
  const items = feeItems({ ins: 50000, sco: 180000 }, dates);               // 50 000 / 60 000 / 60 000 / 60 000
  it('impute un paiement sur la plus ancienne échéance et indique ce qui reste', () => {
    const d = paymentDetail(items, 230000, 0, 80000, '2026-12-14');
    expect(d.lines.map((l) => [l.paidBefore, l.paidNow, l.remaining])).toEqual([[0, 50000, 0], [0, 30000, 30000], [0, 0, 60000], [0, 0, 60000]]);
    expect(d).toMatchObject({ total: 230000, paidAfter: 80000, remaining: 150000, credit: 0 });
    expect(d.next).toMatchObject({ label: items[1].label, remaining: 30000 });
  });
  it('tient compte des paiements précédents', () => {
    const d = paymentDetail(items, 230000, 80000, 50000, '2026-12-14');
    expect(d.lines.map((l) => [l.paidBefore, l.paidNow, l.remaining])).toEqual([[50000, 0, 0], [30000, 30000, 0], [0, 20000, 40000], [0, 0, 60000]]);
    expect(d.remaining).toBe(100000);
  });
  it('garde le surplus en avance et affiche la remise fratrie', () => {
    const d = paymentDetail(feeItems({ ins: 50000, sco: 180000 }, dates, 10), 230000, 200000, 50000, '2026-12-14', 10);
    expect(d).toMatchObject({ total: 212000, remaining: 0, credit: 38000, discountAmount: 18000, discountPct: 10 });
    expect(d.next).toBeUndefined();
  });
  it('le mode démo fige le détail sur le reçu et garde l\'avance', () => {
    const store = TestBed.inject(Store);
    const id = 's-marie';
    const solde = store.balance(id).solde;
    const p = store.recordPayment({ studentId: id, amount: solde + 5000, mode: 'especes', advance: true });
    expect(p.detail?.remaining).toBe(0);
    expect(p.advance).toBe(5000);
    expect(p.detail?.paidAfter).toBe(store.balance(id).paid);
  });
  it('clôture de caisse en démo : écart expliqué, une seule fois par jour', async () => {
    const store = TestBed.inject(Store);
    const day = store.today;
    store.recordPayment({ studentId: 's-marie', amount: 10000, mode: 'especes' });
    const d = (await store.cashDay(day))!;
    expect(d.expectedCash).toBeGreaterThan(0);
    expect((await store.cashClose(day, d.expectedCash - 1000, '')).ok).toBe(false);
    expect((await store.cashClose(day, d.expectedCash - 1000, 'monnaie rendue')).ok).toBe(true);
    expect((await store.cashClose(day, d.expectedCash, '')).ok).toBe(false);
    expect((await store.cashDay(day))!.closing?.gap).toBe(-1000);
  });
});

describe('Accès des familles', () => {
  it('donne un code provisoire de 6 chiffres au parent et à l\'élève, et en recrée un à la réinitialisation', () => {
    const store = TestBed.inject(Store);
    const r = store.addStudent({ nom: 'Test', prenoms: 'Pin', sexe: 'M', naissance: '2014-01-01', lieu: '', classId: store.classes()[0].id, parentTitle: 'M.', parentName: 'Pin', parentPhone: '0111223344' } as never);
    expect(r.creds.length).toBe(2);
    for (const c of r.creds) expect(c.password).toMatch(/^\d{6}$/);
    const parentUser = store.users().find((u) => u.username === '0111223344')!;
    const pw = store.resetPassword(parentUser.id);
    expect(pw).toMatch(/^\d{6}$/);
    expect(store.users().find((u) => u.id === parentUser.id)?.mustChange).toBe(true);
  });
});

describe('Bilan de fin d’année : un 2e redoublement du même niveau mène à l’exclusion', () => {
  const rule = { passageAdmission: 10, passageRedoublement: 8, passageExclusion: null };
  it('propose l’exclusion si le niveau a déjà été redoublé', () => {
    expect(proposeFor(7, rule as never, '5e', ['5e'])).toEqual({ value: 'exclu', label: 'Exclusion proposée', reason: 'A déjà redoublé la 5e' });
  });
  it('garde le redoublement si c’est un autre niveau, ou la première fois', () => {
    expect(proposeFor(7, rule as never, '5e', ['6e']).value).toBe('redouble');
    expect(proposeFor(7, rule as never, '5e').value).toBe('redouble');
  });
  it('ne change rien pour un élève admis', () => { expect(proposeFor(12, rule as never, '5e', ['5e']).value).toBe('admis'); });
});

describe('currentTermOf', () => {
  const terms = [
    { id: 'T1', label: '1er trimestre', start: '2026-09-07', end: '2026-12-18', locked: true },
    { id: 'T2', label: '2e trimestre', start: '2027-01-04', end: '2027-03-26', locked: false },
    { id: 'T3', label: '3e trimestre', start: '2027-04-12', end: '2027-06-25', locked: false },
  ];
  it('choisit la période qui contient la date du jour', () => {
    expect(currentTermOf(terms, '2026-10-13')).toBe('T1');
    expect(currentTermOf(terms, '2027-02-01')).toBe('T2');
    expect(currentTermOf(terms, '2027-06-25')).toBe('T3');
  });
  it('pendant les vacances, garde la période qui vient de se terminer', () => {
    expect(currentTermOf(terms, '2026-12-25')).toBe('T1');
    expect(currentTermOf(terms, '2027-04-01')).toBe('T2');
  });
  it('avant la rentrée la première, après la fin de l’année la dernière', () => {
    expect(currentTermOf(terms, '2026-08-01')).toBe('T1');
    expect(currentTermOf(terms, '2027-08-01')).toBe('T3');
  });
  it('sans dates, la première période non verrouillée', () => {
    expect(currentTermOf(terms.map((t) => ({ ...t, start: '', end: '' })), '2027-02-01')).toBe('T2');
    expect(currentTermOf([], '2027-02-01')).toBeUndefined();
  });
});

describe('Suivi des appels (démonstration)', () => {
  it('liste les appels faits de la période, limités aux classes de l\'éducateur', async () => {
    const store = TestBed.inject(Store);
    const [c1, c2] = store.classes();
    store.sessions.set(new Set([`${c1.id}|2026-12-07|Matin`, `${c1.id}|2026-12-07|Après-midi`, `${c2.id}|2026-12-08|Matin`, `${c1.id}|2026-11-02|Matin`]));
    const st = (store.studentsByClass().get(c1.id) ?? [])[0];
    store.absences.set([{ id: 'x1', studentId: st.id, classId: c1.id, date: '2026-12-07', slot: 'Matin', status: 'A', justif: 'aucune' }]);
    const all = (await store.appelSuiviAsync({ from: '2026-12-07', to: '2026-12-11' })).rows!;
    expect(all.map((r) => `${r.classId}|${r.date}|${r.slot}`)).toEqual([`${c2.id}|2026-12-08|Matin`, `${c1.id}|2026-12-07|Après-midi`, `${c1.id}|2026-12-07|Matin`]);
    expect(all.find((r) => r.slot === 'Matin' && r.classId === c1.id)).toMatchObject({ done: true, absents: 1, retards: 0 });
    const edu = store.users().find((u) => u.role === 'educateur')!;
    await store.setEducatorClassesAsync(edu.id, [c2.id]);
    store.userId.set(edu.id);
    expect((await store.appelSuiviAsync({ from: '2026-12-07', to: '2026-12-11' })).rows!.map((r) => r.classId)).toEqual([c2.id]);
  });
});

describe('Disponibilités des enseignants', () => {
  it('l\'enseignant garde un minimum de créneaux libres et ne modifie plus après la date limite', async () => {
    const store = TestBed.inject(Store);
    const d = TestBed.inject(Dispo);
    store.userId.set('u-t-ma1');
    const me = store.myTeacher()!;
    expect(d.state().teachers.map((t) => t.id)).toEqual([me.id]);           // il ne voit que la sienne
    expect((await d.saveAsync(me.id, { '0-0': 'x', '0-1': 'p' })).ok).toBe(true);
    expect(d.at(me.id, 0, 0)).toBe('x');
    expect(d.state().teachers[0]).toMatchObject({ avoid: 1, available: d.openKeys().length - 1 });
    const all = Object.fromEntries(d.openKeys().map((k) => [k, 'x' as const]));
    expect((await d.saveAsync(me.id, all)).error).toContain('au moins');
    store.userId.set('u-admin');
    await d.saveSettingsAsync('2026-12-01', 1.5);                            // avant la date du jour de la démonstration
    expect(d.state().teachers.length).toBe(store.teachers().length);
    store.userId.set('u-t-ma1');
    expect((await d.saveAsync(me.id, {})).error).toContain('close');
    store.userId.set('u-admin');
    const r = await d.saveAsync(me.id, all);                                 // la direction peut toujours, avec un avertissement
    expect(r.ok && r.warning).toBeTruthy();
  });
});

describe('moyenne annuelle pondérée', () => {
  it('suit l’usage ivoirien par défaut : 1re période coefficient 1, les suivantes 2', () => {
    expect([{}, {}, {}].map((t, i) => termCoef(t, i))).toEqual([1, 2, 2]);
    expect(termCoef({ coef: 1 }, 2)).toBe(1);                     // choix de l'école
    expect(weightedAnnual([{ moy: 8, coef: 1 }, { moy: 12, coef: 2 }, { moy: 14, coef: 2 }])).toBeCloseTo(12);
  });
  it('ignore les périodes sans moyenne', () => {
    expect(weightedAnnual([{ moy: 8, coef: 1 }, { moy: 14, coef: 2 }, { moy: null, coef: 2 }])).toBeCloseTo(12);
    expect(weightedAnnual([{ moy: null, coef: 1 }])).toBeNull();
  });
});
