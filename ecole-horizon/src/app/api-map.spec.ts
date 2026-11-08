import { describe, it, expect } from 'vitest';
import { mapAbsence, mapIncident, mapNotice, sessionKey, ApiOverview, ApiStudent, mapDecision, mapOverview, mapPayment, mapYear, mapCashDay, mapStatementOf, mapStatement, mapTarifs, mapFeeDates, mapLog, mapMockResult, mapMockSession, mapExamKind, marksOf, mapCell, mapEntry, mapAnnouncement, mapThread, mapRecipient, mapAssignment, mapCoefs, mapParents, mapStudent, mapSubject, mapUser, settingsPatch, mapRoom, mapLesson, mapReplacement, mapClass, mapTeacher, slotLabel, mapEval, mapConduct, mapEducator, mapSettings } from './api-map';

const st = (over: Partial<ApiStudent> = {}): ApiStudent => ({
  id: 7, matricule: 'HZ26-0007', username: 'hz26-0007', user_id: 21, parent_user_id: 22, nom: 'AKA', prenoms: 'Léa', sexe: 'F', naissance: '2013-05-01',
  lieu: 'Bouaké', school_class: 3, parent_id: 5, parent_name: 'M. Aka', parent_phone: '07 01 02 03 04', urgence: '', active: true, ...over,
});

describe('Correspondances API → interface', () => {
  it("identifie une matière par son code et traduit les numéros du serveur", () => {
    expect(mapSubject({ id: 4, code: 'ma', name: 'Mathématiques', short: 'Maths' }).id).toBe('ma');
    const codeOf = new Map([[4, 'ma']]);
    expect(mapAssignment({ id: 1, teacher: 9, subject: 4, school_class: 3 }, codeOf)).toEqual({ id: '1', teacherId: '9', subjectId: 'ma', classId: '3' });
    expect(mapAssignment({ id: 2, teacher: 9, subject: 99, school_class: 3 }, codeOf)).toBeNull();
    expect(mapCoefs([{ groupe: '6e', subject: 4, value: 4 }, { groupe: '6e', subject: 99, value: 2 }] as never, codeOf)).toEqual({ '6e|ma': 4 });
  });
  it("relie l'élève à son compte réel", () => {
    expect(mapStudent(st()).userId).toBe('21');
    expect(mapStudent(st({ user_id: null })).userId).toBe('u-s7');
  });
  it("déduit les parents des élèves visibles quand la liste est interdite", () => {
    const ps = mapParents(null, [st(), st({ id: 8 })]);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ id: '5', userId: '22', studentIds: ['7', '8'] });
  });
  it("n'expose jamais de mot de passe", () => {
    const u = mapUser({ id: 3, username: 'x', role: 'admin', name: 'X', phone: '', email: '', is_active: true, must_change_password: false, photo: null, lang: 'fr' } as never);
    expect(u.password).toBe('');
    expect(u.id).toBe('3');
  });
  it('ne renvoie que les réglages modifiés', () => {
    expect(settingsPatch({ hue: 215 })).toEqual({ hue: 215 });
  });

  it("convertit la synthèse du serveur : matières par code, rangs, appréciations", () => {
    const codeOf = new Map([[4, 'ma']]);
    const res = { student: 7, moyenne: 16.5, rang: 1, total_points: 66, total_coef: 4, subjects: [
      { subject: 4, coef: 4, mc: 15, compo: 18, moy: 16.5, rang: 1, class_moy: 12.9, class_max: 16.5, class_min: 9 },
      { subject: 99, coef: 1, mc: null, compo: null, moy: null, rang: null, class_moy: null, class_max: null, class_min: null }] };
    const o: ApiOverview = {
      term: 'T1', locked: false,
      evaluations: [{ id: 1, school_class: 3, subject: 4, term: 'T1', type: 'devoir', title: 'D1', date: '2026-10-10', published: true, teacher: 9 }],
      grades: { '1|7': 15 }, appreciations: [{ student: 7, subject: 4, text: 'Bien' }], council: [{ student: 7, text: 'Ok' }],
      stats: { '3': { pub: { effectif: 3, avg: 12.9, max: 16.5, min: 9, results: { '7': res } } } },
    };
    const m = mapOverview(o, codeOf);
    expect(m.evals[0]).toMatchObject({ id: '1', classId: '3', subjectId: 'ma', teacherId: '9', published: true });
    expect(m.grades['1|7']).toBe(15);
    expect(m.apprec['7|T1|ma']).toBe('Bien');
    expect(m.conseil['7|T1']).toBe('Ok');
    const r = m.pub.get('3')!.results.get('7')!;
    expect(r.rang).toBe(1);
    expect(r.subjects).toHaveLength(1);                  // la matière inconnue est ignorée
    expect(r.subjects[0]).toMatchObject({ subjectId: 'ma', classMoy: 12.9 });
    expect(m.pub.get('3')!.effectif).toBe(3);
    expect(m.all.get('3')).toBeDefined();                // la famille n'a que le publié : « tout » = publié
  });
  it("ignore les élèves sans décision", () => {
    expect(mapDecision({ student: 1, class: 1, annual_avg: 12, terms: 1, decision: null })).toBeNull();
    expect(mapDecision({ student: 1, class: 1, annual_avg: 12, terms: 1, decision: { value: 'admis', comment: '' } })).toMatchObject({ studentId: '1', value: 'admis' });
  });

  it("convertit absences, appels, incidents et notifications", () => {
    expect(mapAbsence({ id: 5, student: 7, school_class: 3, date: '2026-10-05', slot: 'Matin', status: 'A', justif: 'en_attente', motif: 'Médecin' }))
      .toEqual({ id: '5', studentId: '7', classId: '3', date: '2026-10-05', slot: 'Matin', status: 'A', justif: 'en_attente', motif: 'Médecin' });
    expect(mapAbsence({ id: 6, student: 7, school_class: 3, date: '2026-10-06', slot: 'Matin', status: 'R', justif: 'aucune', motif: '' }).motif).toBeUndefined();
    expect(sessionKey({ school_class: 3, date: '2026-10-05', slot: 'Après-midi' })).toBe('3|2026-10-05|Après-midi');
    const i = mapIncident({ id: 1, student: 7, date: '2026-10-05', type: 'bagarre', gravite: 'grave', sanction: 'exclusion_temp', description: 'x', status: 'a_valider', by: 4, decided_by: null, decision_note: '' });
    expect(i).toMatchObject({ id: '1', studentId: '7', byUserId: '4', status: 'a_valider' });
    expect(i.decidedBy).toBeUndefined();
    const n = mapNotice({ id: 9, text: 't', kind: 'inconnu', page: '', read: false, created: '2026-10-05T10:00:00Z' }, '12');
    expect(n).toMatchObject({ id: '9', userId: '12', kind: 'systeme', date: '2026-10-05', read: false });
    expect(n.page).toBeUndefined();
  });

  it("convertit paiements, relevé, tarifs et échéances", () => {
    const p = mapPayment({ id: 3, student: 7, amount: 50000, mode: 'orange', ref: '', date: '2026-10-05', receipt_no: 'REC-2026-00003', status: 'confirme', by: null, by_name: 'Système', note: '' });
    expect(p).toMatchObject({ id: '3', studentId: '7', byUserId: 'u-system', byName: 'Système' });
    expect(p.ref).toBeUndefined(); expect(p.note).toBeUndefined();
    expect(mapPayment({ id: 4, student: 7, amount: 1, mode: 'especes', ref: 'X', date: '2026-10-05', receipt_no: 'R', status: 'annule', by: 9, by_name: 'Compta', note: 'n' }).byUserId).toBe('9');
    expect(mapStatement({ id: 1, ref: 'OM1', date: '2026-10-04', mode: 'orange', amount: 40000, phone: '07', payment: null }).paymentId).toBeUndefined();
    expect(mapStatement({ id: 2, ref: 'OM2', date: '2026-10-04', mode: 'orange', amount: 40000, phone: '07', payment: 5 }).paymentId).toBe('5');
    expect(mapTarifs([{ level: '6e', ins: 50000, sco: 300000 }])).toEqual({ '6e': { ins: 50000, sco: 300000, complement: null } });
    expect(mapTarifs([{ level: '1', ins: 10000, sco: 50000, complement: 40000 }])['1'].complement).toBe(40000);   // tarif en complément d'un autre cursus
    const prev = { INS: 'a', T1: 'b', T2: 'c', T3: 'd' };
    expect(mapFeeDates([{ key: 'T1', date: '2026-10-01' }, { key: 'T2', date: null }, { key: 'ZZ', date: 'x' }], prev)).toEqual({ INS: 'a', T1: '2026-10-01', T2: 'c', T3: 'd', ZZ: 'x' });   // les clés viennent des tranches de l'école
  });

  it("convertit le journal du serveur", () => {
    expect(mapLog({ id: 4, ts: '2026-10-05T06:54:12Z', user: 9, user_name: 'Mme X', action: 'Connexion', detail: 'directeur' }))
      .toEqual({ id: '4', ts: '2026-10-05T06:54', userId: '9', userName: 'Mme X', action: 'Connexion', detail: 'directeur' });
    expect(mapLog({ id: 5, ts: '2026-10-05T07:00:00Z', user: null, user_name: '', action: 'Paiement', detail: 'd' })).toMatchObject({ userId: 'u-system', userName: 'Système' });
  });

  it("convertit annonces, conversations et destinataires", () => {
    expect(mapAnnouncement({ id: 2, title: 'T', body: 'B', audience: ['parent'], author: 4, author_name: 'D', created: '2026-10-05T10:00:00Z' }))
      .toEqual({ id: '2', title: 'T', body: 'B', date: '2026-10-05', audience: ['parent'], authorId: '4', cursusNoms: [] });
    expect(mapAnnouncement({ id: 3, title: 'T', body: 'B', audience: ['parent'], author: 4, author_name: 'D', created: '2026-10-05T10:00:00Z', cursus: [2], cursus_noms: ['Cursus arabe'] }).cursusNoms).toEqual(['Cursus arabe']);
    const th = mapThread({ id: 7, subject: 'S', creator: 3, participants: [{ id: 3, name: 'Parent' }, { id: 4, name: 'Directeur' }], last_message: null, unread: 1, updated: '',
      messages: [{ id: 1, sender: 3, sender_name: 'Parent', text: 'Bonjour', created: '2026-10-05T23:48:10Z' }] }, '4');
    expect(th).toMatchObject({ id: '7', creatorId: '3', participantIds: ['3', '4'], unread: 1, names: { '3': 'Parent', '4': 'Directeur' } });
    expect(th.messages).toEqual([{ id: '1', fromId: '3', text: 'Bonjour', ts: '2026-10-05T23:48' }]);
    expect(mapRecipient({ user: 9, name: 'M. X', sub: 'Parent de Y (6e A)', group: 'Parents', is_parent: true })).toEqual({ userId: '9', name: 'M. X', sub: 'Parent de Y (6e A)', group: 'Parents', classIds: [], isParent: true });
  });

  it("convertit emploi du temps et cahier de textes", () => {
    const codes = new Map([[3, 'ma']]);
    expect(mapCell({ id: 1, school_class: 2, day: 0, slot: 1, subject: 3, room: 'Salle 1' }, codes)).toEqual({ classId: '2', day: 0, slot: 1, subjectId: 'ma', room: 'Salle 1' });
    expect(mapCell({ id: 1, school_class: 2, day: 0, slot: 1, subject: 99, room: 'x' }, codes)).toBeNull();
    const e = mapEntry({ id: 5, school_class: 2, subject: 3, teacher: 7, teacher_name: 'Mme K', date: '2026-10-05', content: 'c', homework: 'h', due: '2026-10-07' }, codes);
    expect(e).toEqual({ id: '5', classId: '2', subjectId: 'ma', teacherId: '7', teacherName: 'Mme K', date: '2026-10-05', content: 'c', homework: 'h', due: '2026-10-07' });
    expect(mapEntry({ id: 6, school_class: 2, subject: 3, teacher: null, date: '2026-10-05', content: 'c', homework: '', due: null }, codes)).toMatchObject({ teacherId: '', due: '' });
  });

  it("convertit les examens blancs", () => {
    const r = { class: 4, effectif: 2, complete: 1, avg: 11.43, max: 11.43, min: 11.43, admis: 1, rate: 100,
      subjects: [{ id: 1, code: 'fr', name: 'Français', short: 'FRAN.', coef: 3 }, { id: 2, code: 'ma', name: 'Mathématiques', short: 'MATHS', coef: 3 }],
      rows: [{ student: 9, name: 'A B', marks: [8, 9.5], filled: 2, avg: 8.75, mention: 'Insuffisant', admissible: false, rank: 1 }, { student: 10, name: 'C D', marks: [null, 12], filled: 1, avg: null, mention: '—', admissible: null, rank: null }] };
    const res = mapMockResult(r);
    expect(res.subjects[0]).toEqual({ id: 'fr', name: 'Français', short: 'FRAN.', coef: 3 });
    expect(res.rows[0]).toMatchObject({ studentId: '9', avg: 8.75, rank: 1 });
    expect(marksOf(r)).toEqual({ '9|fr': 8, '9|ma': 9.5, '10|ma': 12 });
    expect(mapMockSession({ id: 3, name: 'BEPC', type: 'BEPC', exam_type: 7, per_serie: false, start: 'a', end: 'b', classes: [4], coefs: { '*': { fr: 3 } }, published: true }, {}))
      .toMatchObject({ id: '3', classIds: ['4'], status: 'publié', kindId: '7', perSerie: false });
    expect(mapExamKind({ id: 2, name: 'DEF', levels: ['9e'], per_serie: false, coefs: { '*': { fr: 4 } }, active: true, sessions: 1 }))
      .toEqual({ id: '2', name: 'DEF', levels: ['9e'], perSerie: false, coefs: { '*': { fr: 4 } }, active: true, sessions: 1 });
  });

  it("transmet le logo de l'école au serveur", () => {
    expect(settingsPatch({ logo: 'data:image/png;base64,AA==' })).toEqual({ logo: 'data:image/png;base64,AA==' });
    expect(settingsPatch({ logo: undefined })).toEqual({ logo: '' });
  });

  it("convertit les salles, les cours du jour et les remplacements", () => {
    expect(mapRoom({ id: 3, name: 'Salle 12', capacity: 50, kind: 'classe', classes: ['6e A'] })).toEqual({ id: '3', name: 'Salle 12', capacity: 50, kind: 'classe', classes: ['6e A'] });
    expect(mapClass({ id: 2, name: '6e A', level: '6e', serie: '', groupe: '6e', max_students: 45, cycle: 'college', effectif: 30, room: 3 }).roomId).toBe('3');
    expect(mapClass({ id: 2, name: '6e A', level: '6e', serie: '', groupe: '6e', max_students: 45, cycle: 'college', effectif: 30, room: null }).roomId).toBeUndefined();
    expect(mapTeacher({ id: 1, user_id: 9, name: 'M. K', phone: '', subject_ids: [4], max_hours: 18 }, new Map([[4, 'ma']])).maxHours).toBe(18);
    const codeOf = new Map([[4, 'ma']]);
    const l = mapLesson({ school_class: 2, class_name: '6e A', subject: 4, subject_name: 'Mathématiques', slots: [0, 1], slot: 0, code: 'C1', room: 'Salle 1', teacher: 9, titular: 8,
      replacement: 5, replacement_name: 'M. K', replaced_out: false, start: '07h30', end: '09h30', done: false, entry: null }, codeOf);
    expect(l).toMatchObject({ classId: '2', subjectId: 'ma', code: 'C1', teacherId: '9', titularId: '8', replacementId: '5', start: '07h30', end: '09h30' });
    expect(l?.entryId).toBeUndefined();
    expect(mapLesson({ subject: 99 } as never, codeOf)).toBeNull();
    expect(mapReplacement({ id: 1, school_class: 2, class_name: '6e A', subject: 4, subject_name: 'Maths', date: '2026-10-05', slot: 0, teacher: 9, teacher_name: 'M. K', absent: null, absent_name: '' }, codeOf)).toMatchObject({ subjectId: 'ma', teacherId: '9' });
  });

  it("nomme les séances d'appel", () => {
    expect(slotLabel('C3')).toBe('Cours 3');
    expect(slotLabel('Matin')).toBe('Matin');
  });
});

describe('mapEval coefficient', () => {
  it('lit le coefficient du serveur et prend 1 par défaut', () => {
    const codeOf = new Map([[3, 'ma']]);
    const base = { id: 1, school_class: 2, subject: 3, term: 'T1', type: 'devoir', title: 'D', date: '2026-10-10', published: false, teacher: null } as never;
    expect(mapEval({ ...(base as object), coef: '2.5' } as never, codeOf)?.coef).toBe(2.5);
    expect(mapEval(base, codeOf)?.coef).toBe(1);
  });
});

describe('conduite', () => {
  it('lit la fiche de conduite d\'une classe', () => {
    const c = mapConduct({ class: 4, term: 'T1', locked: false, published: true, max: 20, in_average: true, coef: 1, rule: { tranche: 3, points: 1 },
      students: [{ student: 7, name: 'AKA Léa', max: 20, removed: 2.5, note: 17.5, halfdays: 4, due: 1, applied: 0,
        deductions: [{ id: 9, points: 2.5, reason: 'Retards', kind: 'autre', date: '2026-10-02', by_name: 'M. Yapo', pending: false, refused: false }] }] });
    expect(c.classId).toBe('4');
    expect(c.students[0]).toMatchObject({ studentId: '7', note: 17.5, due: 1, applied: 0 });
    expect(c.students[0].deductions[0]).toMatchObject({ id: '9', points: 2.5, byName: 'M. Yapo' });
  });
  it('lit les classes d\'un éducateur', () => { expect(mapEducator({ id: 3, name: 'M. Yapo', classes: [1, 2] })).toEqual({ id: '3', name: 'M. Yapo', classes: ['1', '2'] }); });
  it('règles de conduite : lues avec des valeurs par défaut, envoyées au serveur', () => {
    const cfg = mapSettings({ name: 'E', address: '', phone: '', email: '', director: '', hue: 150, template: 'classique', compo_weight: 0.5, remise_fratrie: 10, seuils: [16, 14, 12, 10] }, '2026-2027');
    expect(cfg).toMatchObject({ conduiteMax: 20, conduiteInAverage: true, conduiteCoef: 1, absenceTranche: 3, absencePoints: 1 });
    expect(settingsPatch({ conduiteMax: 10, conduiteInAverage: false, absenceTranche: 0, conduiteBaremes: { retenue: 2 } })).toEqual({ conduite_max: 10, conduite_in_average: false, absence_tranche: 0, conduite_baremes: { retenue: 2 } });
  });
});

describe('reçu détaillé', () => {
  it('lit le détail figé par le serveur', () => {
    const p = mapPayment({ id: 4, student: 2, amount: 80000, mode: 'especes', ref: '', date: '2026-12-14', receipt_no: 'REC-2026-00004', status: 'confirme', by: 1, by_name: 'C', note: '', advance: 0, year_label: '2026-2027',
      detail: { lines: [{ key: 'INS', label: 'Inscription', due: '2026-09-01', amount: 50000, paid_before: 0, paid_now: 50000, remaining: 0 }, { key: 'T1', label: 'Tranche 1', due: null, amount: 60000, paid_before: 0, paid_now: 30000, remaining: 30000 }],
        total: 110000, paid_before: 0, paid_after: 80000, remaining: 30000, credit: 0, discount_pct: 0, discount_amount: 0, next: { label: 'Tranche 1', due: null, remaining: 30000 } } });
    expect(p.yearLabel).toBe('2026-2027');
    expect(p.detail?.lines[1]).toMatchObject({ paidBefore: 0, paidNow: 30000, remaining: 30000, due: undefined });
    expect(p.detail?.next).toMatchObject({ label: 'Tranche 1', remaining: 30000 });
  });
  it('lit les années, la caisse et le relevé', () => {
    expect(mapYear({ label: '2025-2026', current: false, collected: 10, count: 2, cancelled: 1, advances: 0, carried_over: 5, carried_credit: null })).toMatchObject({ carriedOver: 5, carriedCredit: null });
    expect(mapCashDay({ date: '2026-12-14', total: 5, count: 1, expected_cash: 5, by_mode: [], cancelled: [{ receipt_no: 'R', student: 'A', amount: 1, note: 'x' }], closing: null }).cancelled[0].receiptNo).toBe('R');
    const st = mapStatementOf({ student: 3, name: 'A B', matricule: 'M1', class: '6e A', years: [{ label: '2025-2026', report: 0, credit: 2, paid: 7, payments: [{ id: 9, receipt_no: 'R9', date: '2026-01-01', amount: 7, mode: 'wave', status: 'confirme', advance: 0 }] }] });
    expect(st.years[0].payments[0]).toMatchObject({ id: '9', receiptNo: 'R9' });
  });
});

describe('cahier de textes et élève', () => {
  it('est fermé à l\'élève par défaut, réglable par l\'école', () => {
    const base = { name: 'E', address: '', phone: '', email: '', director: '', hue: 150, template: 'classique', compo_weight: 0.5, remise_fratrie: 10, seuils: [16, 14, 12, 10] } as never;
    expect(mapSettings(base, '2026-2027').eleveVoitCahier).toBe(false);
    expect(mapSettings({ ...(base as object), eleve_voit_cahier: true } as never, '2026-2027').eleveVoitCahier).toBe(true);
    expect(settingsPatch({ eleveVoitCahier: true })).toEqual({ eleve_voit_cahier: true });
    expect(mapSettings(base, '2026-2027').bulletinBlocage).toBe('retard');
    expect(settingsPatch({ bulletinBlocage: 'total' })).toEqual({ bulletin_blocage: 'total' });
    expect(mapSettings(base, '2026-2027').devoirsActifs).toBe(false);
    expect(settingsPatch({ devoirsActifs: true })).toEqual({ devoirs_actifs: true });
  });
});

describe('Élève à placer (sans classe)', () => {
  it('reçoit une classe « placer:niveau » et garde son nouveau niveau', () => {
    const x = mapStudent(st({ school_class: null, level: '5e', active: false, sortie: 'placer' }));
    expect(x.classId).toBe('placer:5e');
    expect(x.level).toBe('5e');
    expect(x.sortie).toBe('placer');
  });
  it('garde sa classe quand il en a une', () => { expect(mapStudent(st()).classId).toBe('3'); });
});
