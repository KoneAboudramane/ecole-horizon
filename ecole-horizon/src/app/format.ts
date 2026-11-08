import { lang, localeOf } from './i18n/i18n';

// Date fictive de la démonstration : un lundi, en fin de 1er trimestre
export const DEMO_TODAY = '2026-12-14';

export const nbsp = ' ';

export function fcfa(n: number): string {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  return s + nbsp + 'FCFA';
}

export function fnum(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const t = n.toFixed(d);
  return lang() === 'en' || lang() === 'ar' ? t : t.replace('.', ',');
}

export function dateFr(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function dateLong(iso: string): string {
  const dt = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  if (lang() !== 'fr') return new Intl.DateTimeFormat(localeOf(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dt);
  return `${JOURS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MOIS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  if (lang() !== 'fr') return new Intl.DateTimeFormat(localeOf(), { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${y}-${m}-15T12:00:00Z`));
  return MOIS[+m - 1].slice(0, 4) + (MOIS[+m - 1].length > 4 ? '.' : '') + ' ' + y.slice(2);
}

export function addDays(iso: string, n: number): string {
  const dt = new Date(iso + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function isWeekday(iso: string): boolean {
  const d = new Date(iso + 'T12:00:00Z').getUTCDay();
  return d !== 0 && d !== 6;
}

export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) out.push(d);
  return out;
}

export function initials(name: string): string {
  const parts = name.replace(/^(M\.|Mme|Mlle|Dr)\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function rangLabel(r: number | null, of?: number): string {
  if (r === null) return '—';
  const l = lang();
  const s = l === 'en' ? `${r}${r % 100 >= 11 && r % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10 > 3 ? 0 : r % 10]}` : l === 'es' ? `${r}.º` : l === 'de' ? `${r}.` : l === 'ar' ? `${r}` : r === 1 ? '1er' : `${r}e`;
  return of ? `${s}/${of}` : s;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Note saisie (virgule acceptée), entre 0 et `max` (le barème de l'évaluation, 20 par défaut). */
export function parseNote(text: string, max = 20): number | null | 'err' {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > max) return 'err';
  return Math.round(n * 100) / 100;
}

// --- Montant en lettres (reçus) ---
const U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const T = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number, final: boolean): string {
  if (n < 20) return U[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    if (d === 7 && u === 1) return 'soixante et onze';
    return (d === 7 ? 'soixante' : 'quatre-vingt') + '-' + U[10 + u];
  }
  if (d === 8) return u === 0 ? (final ? 'quatre-vingts' : 'quatre-vingt') : 'quatre-vingt-' + U[u];
  const t = T[d];
  if (u === 0) return t;
  if (u === 1) return t + ' et un';
  return t + '-' + U[u];
}

function below1000(n: number, final: boolean): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  let s = '';
  if (c > 0) {
    s = c === 1 ? 'cent' : U[c] + ' cent';
    if (r === 0 && c > 1 && final) s += 's';
  }
  if (r > 0) s += (s ? ' ' : '') + below100(r, final);
  return s;
}

export function nombreEnLettres(value: number): string {
  const n = Math.round(value);
  if (n === 0) return 'zéro';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? 'un million' : below1000(millions, true) + ' millions');
  if (thousands) parts.push(thousands === 1 ? 'mille' : below1000(thousands, false) + ' mille');
  if (rest) parts.push(below1000(rest, true));
  return parts.join(' ');
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // Point-virgule et BOM : s'ouvre correctement dans Excel en français
  return '﻿' + [headers, ...rows].map((r) => r.map(csvEscape).join(';')).join('\r\n');
}

/** Lien WhatsApp « cliquer pour discuter » (gratuit, envoi manuel par l'agent). Numéros ivoiriens à 10 chiffres → indicatif 225. */
export function waLink(phone: string, text: string): string | null {
  let d = (phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 10) d = '225' + d;
  if (!/^\d{11,15}$/.test(d)) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
