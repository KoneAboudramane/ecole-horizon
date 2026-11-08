/** Libellés du bulletin dans la langue du cursus (mêmes textes que le PDF du serveur : apps/grades/bulletin_i18n.py). */
import { fnum } from '../format';

type Labels = {
  year: string; title: string; band: string; bandYear: string; matricule: string; classe: string; ne: string; lieu: string; sexe: string; M: string; F: string;
  h: string[]; conduite: string; moygen: string; rang: string; mention: string; assid: string; absences: string; conseil: string; conseilCourt: string;
  fin: string; decision: string; avecmoy: string; bilan: string; cls: string; coef: string; moyan: string; rangan: string; pp: string; dir: string; parent: string;
  prov: string; rangClasse: string; moyClasse: string; vous: string; matiere: string; moy: string; moyenne: string; classeCourt: string; lieuSeul: string;
  mentions: Record<string, string>; decisions: Record<string, string>;
};

const MENTIONS = ['Très bien', 'Bien', 'Assez bien', 'Passable', 'Insuffisant'];
const zip = (vals: string[]) => Object.fromEntries(MENTIONS.map((m, i) => [m, vals[i]]));

const L: Record<string, Labels> = {
  fr: {
    year: 'Année scolaire {y}', title: 'BULLETIN DE NOTES · {t}', band: 'Bulletin du {t}', bandYear: 'Année {y}', matricule: 'Matricule : {m}', classe: 'Classe : {c} ({n} élèves)',
    ne: 'Né(e) le {d}', lieu: ' à {l}', lieuSeul: 'Lieu : {l}', sexe: 'Sexe : {s}', M: 'M', F: 'F',
    h: ['Matières', 'Coef.', 'Moy. cl.', 'Compo.', 'Moy./20', 'Points', 'Rang', 'Moy. classe', 'Appréciation'], conduite: 'Conduite',
    moygen: 'Moyenne générale', rang: 'Rang', mention: 'Mention', assid: 'Assiduité', absences: '{a} absence(s) dont {j} justifiée(s) · {r} retard(s)',
    conseil: 'Appréciation du conseil de classe', conseilCourt: 'Conseil de classe', fin: 'Fin d’année', decision: 'Décision du conseil de classe : ',
    avecmoy: ' avec une moyenne annuelle de {m} / 20', bilan: 'Bilan de l’année', cls: 'Classe : moy. {a} · max {b} · min {c}', coef: 'coef. {c}',
    moyan: 'Moyenne annuelle', rangan: 'Rang annuel', pp: 'Le professeur principal', dir: 'Le directeur', parent: 'Le parent ou tuteur', prov: 'PROVISOIRE',
    rangClasse: 'Rang dans la classe', moyClasse: 'Moyenne de la classe', vous: 'Vous / classe (trait orange)', matiere: 'Matière', moy: 'Moy.', moyenne: 'Moyenne', classeCourt: 'Classe',
    mentions: zip(MENTIONS), decisions: { admis: 'Admis(e)', redouble: 'Redouble', exclu: 'Exclu(e)', conseil: 'Conseil à réunir' },
  },
  ar: {
    year: 'السنة الدراسية {y}', title: 'كشف النقاط · {t}', band: 'كشف نقاط {t}', bandYear: 'السنة {y}', matricule: 'رقم التسجيل: {m}', classe: 'القسم: {c} ({n} تلميذ)',
    ne: 'تاريخ الميلاد: {d}', lieu: ' في {l}', lieuSeul: 'مكان الميلاد: {l}', sexe: 'الجنس: {s}', M: 'ذكر', F: 'أنثى',
    h: ['المواد', 'المعامل', 'معدل الفروض', 'الامتحان', 'المعدل/20', 'النقاط', 'الرتبة', 'معدل القسم', 'الملاحظة'], conduite: 'السلوك',
    moygen: 'المعدل العام', rang: 'الرتبة', mention: 'التقدير', assid: 'المواظبة', absences: '{a} غياب منها {j} مبرر · {r} تأخر',
    conseil: 'ملاحظة مجلس القسم', conseilCourt: 'مجلس القسم', fin: 'نهاية السنة', decision: 'قرار مجلس القسم: ',
    avecmoy: ' بمعدل سنوي قدره {m} / 20', bilan: 'حصيلة السنة', cls: 'القسم: المعدل {a} · الأعلى {b} · الأدنى {c}', coef: 'المعامل {c}',
    moyan: 'المعدل السنوي', rangan: 'الرتبة السنوية', pp: 'الأستاذ الرئيسي', dir: 'المدير', parent: 'الولي', prov: 'مؤقت',
    rangClasse: 'الرتبة في القسم', moyClasse: 'معدل القسم', vous: 'التلميذ / القسم (الخط البرتقالي)', matiere: 'المادة', moy: 'المعدل', moyenne: 'المعدل', classeCourt: 'القسم',
    mentions: zip(['حسن جدا', 'حسن', 'مستحسن', 'مقبول', 'غير كاف']), decisions: { admis: 'ناجح(ة)', redouble: 'يعيد السنة', exclu: 'مفصول(ة)', conseil: 'يعرض على مجلس القسم' },
  },
  en: {
    year: 'School year {y}', title: 'REPORT CARD · {t}', band: 'Report card · {t}', bandYear: 'Year {y}', matricule: 'Student no.: {m}', classe: 'Class: {c} ({n} students)',
    ne: 'Born on {d}', lieu: ' in {l}', lieuSeul: 'Place of birth: {l}', sexe: 'Sex: {s}', M: 'M', F: 'F',
    h: ['Subjects', 'Coef.', 'Coursework', 'Exam', 'Avg./20', 'Points', 'Rank', 'Class avg.', 'Comments'], conduite: 'Conduct',
    moygen: 'Overall average', rang: 'Rank', mention: 'Grade', assid: 'Attendance', absences: '{a} absence(s), {j} excused · {r} late arrival(s)',
    conseil: 'Class council comments', conseilCourt: 'Class council', fin: 'End of year', decision: 'Class council decision: ',
    avecmoy: ' with a yearly average of {m} / 20', bilan: 'Year summary', cls: 'Class: avg. {a} · max {b} · min {c}', coef: 'coef. {c}',
    moyan: 'Yearly average', rangan: 'Yearly rank', pp: 'Form teacher', dir: 'Head teacher', parent: 'Parent or guardian', prov: 'DRAFT',
    rangClasse: 'Rank in class', moyClasse: 'Class average', vous: 'You / class (orange line)', matiere: 'Subject', moy: 'Avg.', moyenne: 'Average', classeCourt: 'Class',
    mentions: zip(['Very good', 'Good', 'Fairly good', 'Pass', 'Insufficient']), decisions: { admis: 'Promoted', redouble: 'Repeats the year', exclu: 'Excluded', conseil: 'Council to meet' },
  },
  es: {
    year: 'Curso escolar {y}', title: 'BOLETÍN DE NOTAS · {t}', band: 'Boletín · {t}', bandYear: 'Curso {y}', matricule: 'Matrícula: {m}', classe: 'Clase: {c} ({n} alumnos)',
    ne: 'Nacido(a) el {d}', lieu: ' en {l}', lieuSeul: 'Lugar: {l}', sexe: 'Sexo: {s}', M: 'M', F: 'F',
    h: ['Asignaturas', 'Coef.', 'Prom. clase', 'Examen', 'Media/20', 'Puntos', 'Puesto', 'Media clase', 'Observación'], conduite: 'Conducta',
    moygen: 'Media general', rang: 'Puesto', mention: 'Calificación', assid: 'Asistencia', absences: '{a} falta(s), {j} justificada(s) · {r} retraso(s)',
    conseil: 'Observación del consejo de clase', conseilCourt: 'Consejo de clase', fin: 'Fin de curso', decision: 'Decisión del consejo de clase: ',
    avecmoy: ' con una media anual de {m} / 20', bilan: 'Balance del curso', cls: 'Clase: media {a} · máx. {b} · mín. {c}', coef: 'coef. {c}',
    moyan: 'Media anual', rangan: 'Puesto anual', pp: 'El profesor tutor', dir: 'El director', parent: 'El padre, la madre o el tutor', prov: 'PROVISIONAL',
    rangClasse: 'Puesto en la clase', moyClasse: 'Media de la clase', vous: 'Usted / clase (línea naranja)', matiere: 'Asignatura', moy: 'Media', moyenne: 'Media', classeCourt: 'Clase',
    mentions: zip(['Sobresaliente', 'Notable', 'Bien', 'Aprobado', 'Insuficiente']), decisions: { admis: 'Promociona', redouble: 'Repite curso', exclu: 'Expulsado(a)', conseil: 'Consejo por reunir' },
  },
  de: {
    year: 'Schuljahr {y}', title: 'ZEUGNIS · {t}', band: 'Zeugnis · {t}', bandYear: 'Schuljahr {y}', matricule: 'Schülernummer: {m}', classe: 'Klasse: {c} ({n} Schüler)',
    ne: 'Geboren am {d}', lieu: ' in {l}', lieuSeul: 'Geburtsort: {l}', sexe: 'Geschlecht: {s}', M: 'M', F: 'W',
    h: ['Fächer', 'Koef.', 'Mitarbeit', 'Prüfung', 'Schnitt/20', 'Punkte', 'Rang', 'Klassenschnitt', 'Bemerkung'], conduite: 'Betragen',
    moygen: 'Gesamtdurchschnitt', rang: 'Rang', mention: 'Prädikat', assid: 'Anwesenheit', absences: '{a} Fehltag(e), davon {j} entschuldigt · {r} Verspätung(en)',
    conseil: 'Bemerkung der Klassenkonferenz', conseilCourt: 'Klassenkonferenz', fin: 'Schuljahresende', decision: 'Beschluss der Klassenkonferenz: ',
    avecmoy: ' mit einem Jahresdurchschnitt von {m} / 20', bilan: 'Jahresbilanz', cls: 'Klasse: Schnitt {a} · max. {b} · min. {c}', coef: 'Koef. {c}',
    moyan: 'Jahresdurchschnitt', rangan: 'Jahresrang', pp: 'Klassenlehrer(in)', dir: 'Schulleitung', parent: 'Erziehungsberechtigte(r)', prov: 'VORLÄUFIG',
    rangClasse: 'Rang in der Klasse', moyClasse: 'Klassenschnitt', vous: 'Du / Klasse (orange Linie)', matiere: 'Fach', moy: 'Schnitt', moyenne: 'Durchschnitt', classeCourt: 'Klasse',
    mentions: zip(['Sehr gut', 'Gut', 'Befriedigend', 'Ausreichend', 'Ungenügend']), decisions: { admis: 'Versetzt', redouble: 'Wiederholt das Jahr', exclu: 'Ausgeschlossen', conseil: 'Konferenz einzuberufen' },
  },
};

export interface BulletinLang {
  code: string; rtl: boolean;
  t(key: Exclude<keyof Labels, 'h' | 'mentions' | 'decisions'>, vars?: Record<string, string | number>): string;
  h: string[];
  num(v: number | null | undefined, digits?: number): string;
  rang(r: number | null, of?: number): string;
  mention(m: string): string;
  decision(v: string): string;
}

/** Libellés, nombres et sens d'écriture du bulletin dans une langue (français par défaut). */
export function bulletinLang(code: string | undefined): BulletinLang {
  const c = code && L[code] ? code : 'fr';
  const x = L[c];
  return {
    code: c, rtl: c === 'ar', h: x.h,
    t: (key, vars = {}) => (x[key] as string).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')),
    num: (v, digits = 2) => { const s = fnum(v ?? null, digits); return c === 'en' ? s.replace(',', '.') : s; },
    rang: (r, of) => {
      if (r === null) return '—';
      const s = c === 'fr' ? (r === 1 ? '1er' : `${r}e`) : c === 'en' ? `${r}${r % 100 >= 10 && r % 100 <= 20 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th'}`
        : c === 'es' ? `${r}.º` : c === 'de' ? `${r}.` : String(r);
      return of ? (c === 'ar' ? `${s} من ${of}` : `${s}/${of}`) : s;
    },
    mention: (m) => x.mentions[m] ?? m,
    decision: (v) => x.decisions[v] ?? v,
  };
}
