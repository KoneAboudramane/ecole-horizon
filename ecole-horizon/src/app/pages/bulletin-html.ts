import { lang, trHtml } from '../i18n/i18n';
import { Store } from '../store';
import { AnnualSummary, MODE_LABEL, Payment, StudentStatement, TemplateId } from '../models';
import { dateFr, fnum, rangLabel } from '../format';
import { DECISION_LABEL, mention } from '../engine';
import { BulletinLang, bulletinLang } from './bulletin-lang';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const BULLETIN_CSS = `
.bl { --b: hsl(var(--hue, 155) 75% 22%); --bt: hsl(var(--hue, 155) 40% 93%); --ink: #16211b; --mu: #55605a; --ln: #c9d1cc; --ac: hsl(30 100% 38%);
  background: #fff; color: var(--ink); font-family: 'Figtree', system-ui, sans-serif; font-size: 12.5px; line-height: 1.4; padding: 28px 30px; border: 1px solid var(--ln); max-width: 800px; margin: 0 auto; }
.bl * { box-sizing: border-box; }
.bl table { width: 100%; border-collapse: collapse; }
.bl .num { text-align: right; font-variant-numeric: tabular-nums; }
.bl .c { text-align: center; }
.bl .mu { color: var(--mu); }
.bl .mark { font-size: 10.5px; color: var(--mu); text-align: center; margin-top: 10px; }
.bl .prov { display: inline-block; border: 1.5px solid #b04a12; color: #b04a12; padding: 1px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; letter-spacing: .06em; }
.bl .sign { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-top: 20px; font-size: 11.5px; }
.bl .sign div { border-top: 1px solid var(--ln); padding-top: 4px; min-height: 54px; color: var(--mu); }
.bl .sign b { color: var(--ink); font-weight: 600; }
.bl .box { border: 1px solid var(--ln); padding: 8px 10px; margin-top: 12px; }
.bl .box b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--mu); margin-bottom: 3px; }
.bl .an-t { width: 100%; border-collapse: collapse; margin: 4px 0; } .bl .an-t th { font-size: 10.5px; font-weight: 600; } .bl .an-t td { text-align: center; } .bl .an-t strong { font-size: 15px; }

/* Classique */
.bl-classique { font-family: 'Source Serif 4', Georgia, serif; font-size: 13px; }
.bl-classique .head { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; border-bottom: 2px solid var(--ink); padding-bottom: 10px; }
.bl-classique .head .r { text-align: right; }
.bl-classique h1 { font-size: 19px; text-align: center; letter-spacing: .08em; margin: 14px 0 10px; font-weight: 700; }
.bl-classique .id { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 4px 16px; border: 1px solid var(--ink); padding: 8px 10px; margin-bottom: 10px; }
.bl-classique th, .bl-classique td { border: 1px solid var(--ink); padding: 4px 6px; }
.bl-classique th { background: #eceeed; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
.bl-classique .sum { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--ink); border-top: 0; }
.bl-classique .sum div { padding: 6px 8px; border-right: 1px solid var(--ink); } .bl-classique .sum div:last-child { border-right: 0; }
.bl-classique .sum b { display: block; font-size: 17px; }

/* Moderne */
.bl-moderne .band { background: var(--b); color: #fff; margin: -28px -30px 16px; padding: 20px 30px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 5px solid var(--ac); }
.bl-moderne .band h1 { font-family: 'Bricolage Grotesque', 'Figtree', sans-serif; font-size: 22px; margin: 0; line-height: 1.15; }
.bl-moderne .band .mu { color: rgba(255,255,255,.8); }
.bl-moderne .who { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.bl-moderne .who h2 { font-family: 'Bricolage Grotesque', 'Figtree', sans-serif; font-size: 20px; margin: 0; }
.bl-moderne .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.bl-moderne .tile { background: var(--bt); border-radius: 8px; padding: 8px 10px; } .bl-moderne .tile b { display: block; font-family: 'Bricolage Grotesque', 'Figtree', sans-serif; font-size: 21px; color: var(--b); } .bl-moderne .tile span { font-size: 11px; color: var(--mu); }
.bl-moderne th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--mu); padding: 5px 6px; border-bottom: 2px solid var(--b); }
.bl-moderne td { padding: 5px 6px; border-bottom: 1px solid var(--ln); }
.bl-moderne .bar { position: relative; display: block; height: 7px; background: var(--bt); border-radius: 4px; min-width: 70px; }
.bl-moderne .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--b); border-radius: 4px; }
.bl-moderne .bar b { position: absolute; top: -3px; width: 2px; height: 13px; background: var(--ac); }

/* Compact */
.bl-compact { font-size: 11px; padding: 16px 18px; max-width: 700px; }
.bl-compact .head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; border-bottom: 2px solid var(--b); padding-bottom: 5px; margin-bottom: 6px; }
.bl-compact h1 { font-size: 13px; margin: 0; color: var(--b); text-transform: uppercase; letter-spacing: .05em; }
.bl-compact .id { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-bottom: 6px; }
.bl-compact th { background: var(--bt); text-align: left; font-size: 10px; padding: 3px 5px; }
.bl-compact td { padding: 2px 5px; border-bottom: 1px solid var(--ln); }
.bl-compact .sumline { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 6px; padding: 5px 7px; background: var(--bt); border-radius: 4px; font-weight: 600; }
.bl-compact .sign { margin-top: 10px; } .bl-compact .sign div { min-height: 30px; }
[dir=rtl] .bl th, [dir=rtl] .bl-moderne th, [dir=rtl] .bl-compact th { text-align: right; }
[dir=rtl] .bl .num { text-align: left; }
[dir=rtl] .bl-classique .head .r { text-align: left; }
`;

interface Line { name: string; coef: number; mc: number | null; compo: number | null; moy: number | null; rang: number | null; cm: number | null; app: string; teacher: string; }

function build(s: Store, studentId: string, published: boolean, T: BulletinLang) {
  const st = s.studentById().get(studentId)!;
  const cl = s.classById().get(st.classId)!;
  const stats = s.classStats(cl.id, published);
  const res = stats?.results.get(studentId);
  const termId = s.termId();
  const lines: Line[] = (res?.subjects ?? []).map((r) => ({
    name: s.subjectById().get(r.subjectId)?.name ?? '', coef: r.coef, mc: r.mc, compo: r.compo, moy: r.moy, rang: r.rang, cm: r.classMoy,
    app: s.apprec()[`${studentId}|${termId}|${r.subjectId}`] ?? '', teacher: s.teacherOf(cl.id, r.subjectId)?.name ?? '',
  }));
  const cd = res?.conduite;
  if (cd) lines.push({ name: T.code === 'fr' ? (cd.inAverage ? 'Conduite' : 'Conduite (hors moyenne)') : T.t('conduite'), coef: cd.inAverage ? cd.coef : 0, mc: null, compo: null, moy: cd.note, rang: null, cm: null, app: T.code === 'fr' ? `Sur ${fnum(cd.max, 0)}` : `/ ${T.num(cd.max, 0)}`, teacher: '' });
  const abs = s.absByStudent().get(studentId) ?? { a: 0, r: 0, aJust: 0, pending: 0 };
  return {
    st, cl, lines, res, stats, eff: stats?.effectif ?? s.studentsByClass().get(cl.id)?.length ?? 0, abs,
    moy: res?.moyenne ?? null, rang: res?.rang ?? null, ment: T.mention(mention(res?.moyenne ?? null, s.school().seuils)),
    conseil: s.conseil()[`${studentId}|${termId}`] ?? '', decision: s.decisionOf(studentId), term: s.term().label, sc: s.school(),
    pp: cl.principalId ? s.teacherById().get(cl.principalId)?.name ?? '' : '',
    // nom de l'école dans la langue du cursus (école à plusieurs cursus), sinon son nom
    school: s.currentCursus()?.nom_ecole?.trim() || s.school().name,
  };
}

/** « avec une moyenne annuelle de <b>12,00 / 20</b> » (la valeur en gras), dans la langue du bulletin. */
function withAnnual(T: BulletinLang, m: number): string {
  const [pre, post] = T.t('avecmoy', { m: '\u0000' }).split('\u0000');
  return `${esc(pre)}<strong>${T.num(m)}${esc(post ?? '')}</strong>`;
}

/** Bilan de l'année, sur le bulletin de la dernière période. */
function annualBox(an: AnnualSummary | null, seuils: Parameters<typeof mention>[1], T: BulletinLang): string {
  if (!an) return '';
  const head = an.periodes.map((p) => `<th>${esc(p.label)}<br><span class="mu">${esc(T.t('coef', { c: p.coef }))}</span></th>`).join('');
  const vals = an.periodes.map((p) => `<td>${T.num(p.moy)}</td>`).join('');
  return `<div class="box"><b>${esc(T.t('bilan'))}</b><table class="an-t"><tr>${head}<th>${esc(T.t('moyan'))}</th><th>${esc(T.t('rangan'))}</th><th>${esc(T.t('mention'))}</th></tr>`
    + `<tr>${vals}<td><strong>${T.num(an.moyenne)} / 20</strong></td><td><strong>${esc(T.rang(an.rang, an.effectif))}</strong></td><td><strong>${esc(T.mention(mention(an.moyenne, seuils)))}</strong></td></tr></table>`
    + `<span class="mu" style="font-size:10.5px">${esc(T.t('cls', { a: T.num(an.avg), b: T.num(an.max), c: T.num(an.min) }))}</span></div>`;
}

/** `annual` : bilan de l'année fourni par l'appelant (mode serveur) ; non fourni, il est calculé localement sur le bulletin de la dernière période.
 *  Le bulletin est rédigé dans la langue du cursus (en arabe : de droite à gauche). */
export function bulletinHtml(s: Store, studentId: string, tpl: TemplateId, published: boolean, annual?: AnnualSummary | null): string {
  const st = s.studentById().get(studentId);
  if (!st || !s.classById().get(st.classId)) return `<div class="bl"><p>${esc(st ? st.prenoms : 'Cet élève')} n’a pas encore de classe pour cette année : le bulletin sera disponible quand la classe lui sera attribuée.</p></div>`;
  const T = bulletinLang(s.currentCursus()?.langue);
  const html = bulletinBody(s, studentId, tpl, published, annual, T);
  return T.rtl ? `<div dir="rtl" lang="ar">${html}</div>` : html;
}

function bulletinBody(s: Store, studentId: string, tpl: TemplateId, published: boolean, annual: AnnualSummary | null | undefined, T: BulletinLang): string {
  const d = build(s, studentId, published, T);
  const fr = T.code === 'fr';
  const last = s.isLastTerm();
  const anData = annual !== undefined ? annual : last ? s.annualSummary(studentId, published) ?? null : null;
  const an = annualBox(anData, d.sc.seuils, T);
  const prov = published ? '' : ` <span class="prov">${esc(T.t('prov'))}</span>`;
  const id = `${esc(d.st.nom)} ${esc(d.st.prenoms)}`;
  const rang = esc(T.rang(d.rang, d.eff));
  const absTxt = T.t('absences', { a: d.abs.a, j: d.abs.aJust, r: d.abs.r });
  const born = T.t('ne', { d: dateFr(d.st.naissance) });
  // Décision de fin d'année : seulement sur le bulletin de la dernière période, avec la moyenne annuelle
  const anMoy = anData?.moyenne ?? null;
  const dec = last && d.decision ? `<div class="box"><b>${esc(T.t('fin'))}</b>${esc(T.t('decision'))}<strong>${esc(T.decision(d.decision.value))}</strong>${anMoy !== null ? withAnnual(T, anMoy) : ''}${d.decision.comment ? ' · ' + esc(d.decision.comment) : ''}</div>` : '';
  const who = (title: string, name: string) => `<div>${esc(title)}${name ? `<br><b>${esc(name)}</b>` : ''}</div>`;
  const sign = `<div class="sign">${who(T.t('pp'), d.pp)}${who(T.t('dir'), d.sc.directorName || d.sc.director)}${who(T.t('parent'), '')}</div>`;
  const foot = `<p class="mark">${esc(d.school)} · ${esc(d.sc.address)} · ${esc(d.sc.phone)}</p>`;
  const conseilBox = (label: string, style = '') => `<div class="box"${style}><b>${esc(label)}</b>${esc(d.conseil) || '—'}</div>`;

  if (tpl === 'classique') {
    // En-tête officiel choisi par l'école pour ce cursus (pays, devise) ; une ligne vide est omise
    const pays = (d.sc.entetePays ?? 'République de Côte d’Ivoire').trim(), devise = (d.sc.enteteDevise ?? 'Union – Discipline – Travail').trim();
    const head = [esc(pays), devise ? `<i>${esc(devise)}</i>` : '', esc(T.t('year', { y: d.sc.year }))].filter(Boolean).join('<br>');
    const rows = d.lines.map((l) => `<tr><td>${esc(l.name)}<div class="mu" style="font-size:10.5px">${esc(l.teacher)}</div></td><td class="c">${l.coef}</td><td class="num">${T.num(l.mc)}</td><td class="num">${T.num(l.compo)}</td><td class="num"><b>${T.num(l.moy)}</b></td><td class="num">${l.moy === null ? '—' : T.num(l.moy * l.coef, 1)}</td><td class="c">${esc(T.rang(l.rang))}</td><td class="num mu">${T.num(l.cm)}</td><td>${esc(l.app)}</td></tr>`).join('');
    const th = T.h.map((h, i) => `<th${i === 0 ? ' style="text-align:start"' : i === 8 ? ' style="text-align:start"' : ''}>${esc(h)}</th>`).join('');
    const sexe = T.t(d.st.sexe === 'F' ? 'F' : 'M');
    return `<div class="bl bl-classique"><div class="head"><div>${d.sc.logo ? `<img src="${d.sc.logo}" alt="" style="height:54px;float:${T.rtl ? 'right' : 'left'};margin-${T.rtl ? 'left' : 'right'}:10px">` : ''}<b>${esc(d.school)}</b><br>${esc(d.sc.address)}<br>${esc(d.sc.phone)}</div><div class="r">${head}</div></div>
<h1>${esc(T.t('title', { t: fr ? d.term.toUpperCase() : d.term }))}${prov}</h1>
<div class="id"><div><b>${id}</b></div><div>${esc(T.t('matricule', { m: d.st.matricule }))}</div><div>${esc(T.t('classe', { c: d.cl.name, n: d.eff }))}</div><div>${esc(born)}</div><div>${esc(T.t('lieuSeul', { l: d.st.lieu }))}</div><div>${esc(T.t('sexe', { s: sexe }))}</div></div>
<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>
<div class="sum"><div>${esc(T.t('moygen'))}<b>${T.num(d.moy)} / 20</b></div><div>${esc(T.t('rang'))}<b>${rang}</b></div><div>${esc(T.t('mention'))}<b style="font-size:14px">${esc(d.ment)}</b></div><div>${esc(T.t('cls', { a: T.num(d.stats?.avg ?? null), b: T.num(d.stats?.max ?? null), c: T.num(d.stats?.min ?? null) })).replace(' · max', '<br>max')}</div></div>
<div class="box"><b>${esc(T.t('assid'))}</b>${esc(absTxt)}</div>${conseilBox(T.t('conseil'))}${an}${dec}${sign}${foot}</div>`;
  }

  if (tpl === 'moderne') {
    const rows = d.lines.map((l) => {
      const w = l.moy === null ? 0 : (l.moy / 20) * 100, m = l.cm === null ? 0 : (l.cm / 20) * 100;
      return `<tr><td><b>${esc(l.name)}</b><div class="mu" style="font-size:10.5px">${esc(l.teacher)} · ${esc(T.t('coef', { c: l.coef }))}</div></td><td class="num"><b>${T.num(l.moy)}</b></td><td style="width:26%"><span class="bar"><i style="width:${w}%"></i><b style="left:${m}%"></b></span></td><td class="c">${esc(T.rang(l.rang))}</td><td>${esc(l.app)}</td></tr>`;
    }).join('');
    return `<div class="bl bl-moderne"><div class="band"><div><h1>${esc(d.school)}</h1><div class="mu">${esc(T.t('band', { t: fr ? d.term.toLowerCase() : d.term }))} · ${esc(T.t('bandYear', { y: d.sc.year }))}${prov}</div></div><div class="mu" style="text-align:${T.rtl ? 'left' : 'right'}">${esc(d.sc.address)}<br>${esc(d.sc.phone)}</div></div>
<div class="who"><div><h2>${id}</h2><div class="mu">${esc(d.cl.name)} · ${esc(fr ? `matricule ${d.st.matricule}` : T.t('matricule', { m: d.st.matricule }))} · ${esc(fr ? `né(e) le ${dateFr(d.st.naissance)}` : born)}</div></div><div class="mu">${esc(absTxt)}</div></div>
<div class="tiles"><div class="tile"><b>${T.num(d.moy)}</b><span>${esc(T.t('moygen'))} /20</span></div><div class="tile"><b>${rang}</b><span>${esc(T.t('rangClasse'))}</span></div><div class="tile"><b style="font-size:16px;padding:3px 0">${esc(d.ment)}</b><span>${esc(T.t('mention'))}</span></div><div class="tile"><b>${T.num(d.stats?.avg ?? null)}</b><span>${esc(T.t('moyClasse'))}</span></div></div>
<table><thead><tr><th>${esc(T.t('matiere'))}</th><th class="num">${esc(T.t('moy'))}</th><th>${esc(T.t('vous'))}</th><th class="c">${esc(T.t('rang'))}</th><th>${esc(T.h[8])}</th></tr></thead><tbody>${rows}</tbody></table>
${conseilBox(T.t('conseilCourt'))}${an}${dec}${sign}${foot}</div>`;
  }

  const rows = d.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="c">${l.coef}</td><td class="num"><b>${T.num(l.moy)}</b></td><td class="c">${esc(T.rang(l.rang))}</td><td>${esc(l.app)}</td></tr>`).join('');
  return `<div class="bl bl-compact"><div class="head"><h1>${esc(d.school)} · ${esc(fr ? `Bulletin ${d.term.toLowerCase()}` : T.t('band', { t: d.term }))}${prov}</h1><span class="mu">${esc(d.sc.year)}</span></div>
<div class="id"><b>${id}</b><span>${esc(d.cl.name)}</span><span>${esc(d.st.matricule)}</span><span>${esc(born)}</span></div>
<table><thead><tr><th>${esc(T.t('matiere'))}</th><th class="c">${esc(T.h[1])}</th><th class="num">${esc(T.t('moy'))}</th><th class="c">${esc(T.t('rang'))}</th><th>${esc(T.h[8])}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sumline"><span>${esc(T.t('moyenne'))} : ${T.num(d.moy)}/20</span><span>${esc(T.t('rang'))} : ${rang}</span><span>${esc(d.ment)}</span><span>${esc(T.t('classeCourt'))} : ${T.num(d.stats?.avg ?? null)}</span><span>${esc(absTxt)}</span></div>
${conseilBox(T.t('conseilCourt'), ' style="margin-top:6px"')}${an}${dec}${sign}</div>`;
}

export function fullHtml(title: string, bodies: string[], hue: number): string {
  const L = lang();
  return trHtml(`<!doctype html><html lang="${L}" dir="${L === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Figtree:wght@400;600;700&family=Source+Serif+4:wght@400;600;700&display=swap" rel="stylesheet">
<style>:root{--hue:${hue}}body{margin:0;background:#e9ecea;padding:16px}${BULLETIN_CSS}.page{page-break-after:always;margin-bottom:16px}.noprint{text-align:center;margin-bottom:12px;font-family:sans-serif}
@media print{body{background:#fff;padding:0}.noprint{display:none}.bl{border:0;max-width:none}.page{margin:0}@page{size:A4;margin:12mm}}</style></head><body>
<div class="noprint"><button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">Imprimer ou enregistrer en PDF</button></div>
${bodies.map((b) => `<div class="page">${b}</div>`).join('\n')}</body></html>`, L);
}

const n = (v: number) => v.toLocaleString('fr-FR');
/** Tableau « ce qui est payé / ce qui reste » du reçu, échéance par échéance. */
function detailHtml(p: Payment): string {
  const d = p.detail;
  if (!d) return '';
  const rows = d.lines.filter((l) => l.amount > 0).map((l) => `<tr${l.paidNow > 0 ? ' style="font-weight:700"' : ''}><td>${esc(l.label)}${l.remaining > 0 && l.due ? ` <span class="mu">(${dateFr(l.due)})</span>` : ''}</td><td style="text-align:right">${n(l.amount)}</td><td style="text-align:right">${n(l.paidBefore)}</td><td style="text-align:right">${n(l.paidNow)}</td><td style="text-align:right">${n(l.remaining)}</td></tr>`).join('');
  return `<table style="margin-top:14px;width:100%;border-collapse:collapse"><thead><tr class="mu"><th style="text-align:left">Échéance</th><th style="text-align:right">Dû</th><th style="text-align:right">Déjà payé</th><th style="text-align:right">Ce reçu</th><th style="text-align:right">Reste</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin:10px 0 2px">Total de l’année : <b>${n(d.total)} FCFA</b> · payé à ce jour : <b>${n(d.paidAfter)} FCFA</b>${d.discountAmount > 0 ? ` · dont remise fratrie : −${n(d.discountAmount)} FCFA` : ''}</p>
<p style="margin:2px 0;font-size:15px"><b>${d.remaining > 0 ? `Reste à payer : ${n(d.remaining)} FCFA` : 'Scolarité soldée'}</b></p>
${d.next?.due ? `<p class="mu" style="margin:2px 0">Prochaine échéance : ${esc(d.next.label)} le ${dateFr(d.next.due)} (${n(d.next.remaining)} FCFA)</p>` : ''}
${p.advance ? `<p class="mu" style="margin:2px 0">Dont ${n(p.advance)} FCFA gardés en avance (déduits de l’année suivante).</p>` : ''}`;
}

export function receiptHtml(s: Store, paymentId: string, amountWords: string, modeLabel: string, duplicata = false, payment?: Payment): string {
  const p = payment ?? s.payments().find((x) => x.id === paymentId)!;
  const st = s.studentById().get(p.studentId)!;
  const sc = s.school();
  const body = `<div class="bl" style="max-width:640px"><div style="display:flex;justify-content:space-between;border-bottom:2px solid var(--b);padding-bottom:8px"><div><b style="font-size:16px">${esc(sc.name)}</b><br><span class="mu">${esc(sc.address)} · ${esc(sc.phone)}</span></div><div style="text-align:right"><b>REÇU DE PAIEMENT</b><br>N° ${esc(p.receiptNo)}</div></div>
<table style="margin-top:14px"><tbody>
<tr><td class="mu" style="width:34%;padding:5px 0">Date</td><td>${dateFr(p.date)}</td></tr>
<tr><td class="mu" style="padding:5px 0">Élève</td><td><b>${esc(st.nom)} ${esc(st.prenoms)}</b> · ${esc(s.className(st.classId))} · ${esc(st.matricule)}</td></tr>
<tr><td class="mu" style="padding:5px 0">Mode de paiement</td><td>${esc(modeLabel)}${p.ref ? ' · réf. ' + esc(p.ref) : ''}</td></tr>
<tr><td class="mu" style="padding:5px 0">Montant</td><td><b style="font-size:18px">${p.amount.toLocaleString('fr-FR')} FCFA</b></td></tr>
${lang() === 'fr' ? `<tr><td class="mu" style="padding:5px 0">Arrêté la somme de</td><td><i>${esc(amountWords)} francs CFA</i></td></tr>` : ''}
${p.status === 'annule' ? '<tr><td colspan="2" style="padding:8px 0"><span class="prov">ANNULÉ</span></td></tr>' : ''}
${duplicata ? '<tr><td colspan="2" style="padding:8px 0"><span class="prov">DUPLICATA</span></td></tr>' : ''}
</tbody></table>${detailHtml(p)}
<div class="sign" style="grid-template-columns:1fr 1fr"><div>Le comptable</div><div>Le parent ou tuteur</div></div><p class="mark">Reçu édité par ${esc(sc.name)}</p></div>`;
  return fullHtml(`Reçu ${p.receiptNo}`, [body], sc.hue);
}

/** Relevé de paiements d'un élève sur toutes les années, à remettre aux parents. */
export function statementHtml(s: Store, st: StudentStatement): string {
  const sc = s.school();
  const lines = s.feeLines(st.studentId), bal = s.balance(st.studentId);
  const years = st.years.map((y) => `<h3 style="margin:16px 0 4px">Année ${esc(y.label)}</h3>
<p class="mu" style="margin:0 0 4px">${y.report > 0 ? `Solde reporté de l’année précédente : ${n(y.report)} FCFA. ` : ''}${y.credit > 0 ? `Avance reportée : ${n(y.credit)} FCFA. ` : ''}Total payé : <b>${n(y.paid)} FCFA</b></p>
<table style="width:100%;border-collapse:collapse"><thead><tr class="mu"><th style="text-align:left">Date</th><th style="text-align:left">Reçu</th><th style="text-align:left">Moyen</th><th style="text-align:right">Montant</th></tr></thead><tbody>${y.payments.map((p) =>
    `<tr${p.status === 'annule' ? ' style="text-decoration:line-through;color:#888"' : ''}><td>${dateFr(p.date)}</td><td>${esc(p.receiptNo)}${p.status === 'annule' ? ' (annulé)' : ''}</td><td>${esc(MODE_LABEL[p.mode])}</td><td style="text-align:right">${n(p.amount)}</td></tr>`).join('')}</tbody></table>`).join('');
  const body = `<div class="bl" style="max-width:640px"><div style="display:flex;justify-content:space-between;border-bottom:2px solid var(--b);padding-bottom:8px"><div><b style="font-size:16px">${esc(sc.name)}</b><br><span class="mu">${esc(sc.address)} · ${esc(sc.phone)}</span></div><div style="text-align:right"><b>RELEVÉ DE PAIEMENTS</b><br>${dateFr(s.today)}</div></div>
<p style="margin:12px 0 4px"><b>${esc(st.name)}</b> · ${esc(st.className)} · ${esc(st.matricule)}</p>
<h3 style="margin:12px 0 4px">Situation de l’année en cours</h3>
<table style="width:100%;border-collapse:collapse"><thead><tr class="mu"><th style="text-align:left">Échéance</th><th style="text-align:right">Dû</th><th style="text-align:right">Payé</th><th style="text-align:right">Reste</th></tr></thead><tbody>${lines.filter((l) => l.amount > 0).map((l) =>
    `<tr><td>${esc(l.label)}${l.remaining > 0 && l.due < '9999' ? ` <span class="mu">(${dateFr(l.due)})</span>` : ''}</td><td style="text-align:right">${n(l.amount)}</td><td style="text-align:right">${n(l.paid)}</td><td style="text-align:right">${n(l.remaining)}</td></tr>`).join('')}</tbody></table>
<p style="margin:8px 0"><b>${bal.solde > 0 ? `Reste à payer : ${n(bal.solde)} FCFA` : 'Scolarité soldée'}</b></p>${years || '<p class="mu">Aucun paiement enregistré.</p>'}
<p class="mark">Relevé édité par ${esc(sc.name)}</p></div>`;
  return fullHtml(`Relevé ${st.name}`, [body], sc.hue);
}

/** Fiche d'accès à remettre à la famille : identifiants et code provisoire, à changer à la première connexion. */
export function accessSheetHtml(s: Store, title: string, items: { label: string; username: string; password: string }[], address = ''): string {
  const sc = s.school();
  const rows = items.map((c) => `<div style="border:1.5px solid var(--ln);border-radius:10px;padding:12px 14px;margin:10px 0"><b>${esc(c.label)}</b>
<table style="margin-top:6px"><tbody><tr><td class="mu" style="width:46%;padding:3px 0">Identifiant</td><td style="font-size:16px"><b>${esc(c.username)}</b></td></tr>
<tr><td class="mu" style="padding:3px 0">Code provisoire</td><td style="font-size:20px;letter-spacing:2px"><b>${esc(c.password)}</b></td></tr></tbody></table></div>`).join('');
  const body = `<div class="bl" style="max-width:560px"><div style="border-bottom:2px solid var(--b);padding-bottom:8px"><b style="font-size:16px">${esc(sc.name)}</b><br><span class="mu">${esc(sc.address)} · ${esc(sc.phone)}</span></div>
<p style="margin:14px 0 2px;font-size:15px"><b>FICHE D’ACCÈS</b> · ${esc(title)}</p>${rows || '<p class="mu">Le compte du parent existe déjà : il se connecte avec son numéro de téléphone et son mot de passe habituel.</p>'}
<ol style="line-height:1.7"><li>Ouvrez ${address ? esc(address) : 'l’application de l’école'} et choisissez « Se connecter ».</li><li>Saisissez l’identifiant et le code provisoire ci-dessus.</li><li>L’application vous demande de choisir votre propre mot de passe : faites-le tout de suite.</li></ol>
<p class="mu">Ce code ne doit être connu que de vous. En cas d’oubli, le secrétariat de l’école peut en donner un nouveau.</p><p class="mark">Fiche remise par ${esc(sc.name)}</p></div>`;
  return fullHtml(`Fiche d’accès ${title}`, [body], sc.hue);
}
