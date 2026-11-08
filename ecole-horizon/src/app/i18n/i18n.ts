import { signal } from '@angular/core';
import { AR } from './ar';
import { DE } from './de';
import { EN } from './en';
import { ES } from './es';

export type Lang = 'fr' | 'en' | 'ar' | 'es' | 'de';
export const LANGS: { id: Lang; label: string; dir: 'ltr' | 'rtl'; locale: string }[] = [
  { id: 'fr', label: 'Français', dir: 'ltr', locale: 'fr-FR' },
  { id: 'en', label: 'English', dir: 'ltr', locale: 'en-GB' },
  { id: 'ar', label: 'العربية', dir: 'rtl', locale: 'ar-u-nu-latn' },
  { id: 'es', label: 'Español', dir: 'ltr', locale: 'es-ES' },
  { id: 'de', label: 'Deutsch', dir: 'ltr', locale: 'de-DE' },
];

const DICTS: Record<Lang, Record<string, string>> = { fr: {}, en: EN, ar: AR, es: ES, de: DE };

function stored(): Lang {
  try {
    const v = localStorage.getItem('horizon-lang');
    if (v && LANGS.some((l) => l.id === v)) return v as Lang;
  } catch { /* stockage indisponible */ }
  return 'fr';
}

export const lang = signal<Lang>('fr');
export const isRtl = () => lang() === 'ar';
export const localeOf = () => LANGS.find((l) => l.id === lang())!.locale;

interface Compiled { dict: Record<string, string>; lower: Map<string, string>; patterns: { re: RegExp; out: string }[]; cache: Map<string, string> }
const compiled = new Map<Lang, Compiled>();

function compile(l: Lang): Compiled {
  let c = compiled.get(l);
  if (c) return c;
  const dict = DICTS[l];
  const lower = new Map<string, string>();
  const patterns: { re: RegExp; out: string; weight: number }[] = [];
  for (const k of Object.keys(dict)) {
    if (/\{\d+\}/.test(k)) {
      const re = new RegExp('^' + k.split(/(\{\d+\})/).map((p) => (/^\{\d+\}$/.test(p) ? '([\\s\\S]*?)' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$');
      patterns.push({ re, out: dict[k], weight: k.replace(/\{\d+\}/g, '').length });
    } else lower.set(k.toLowerCase(), dict[k]);
  }
  patterns.sort((a, b) => b.weight - a.weight);
  c = { dict, lower, patterns, cache: new Map() };
  compiled.set(l, c);
  return c;
}

function lookupWord(c: Compiled, s: string): string | undefined {
  if (c.dict[s] !== undefined && !/\{\d+\}/.test(s)) return c.dict[s];
  const lo = c.lower.get(s.toLowerCase());
  if (lo === undefined) return undefined;
  return s.length > 1 && s === s.toUpperCase() && s !== s.toLowerCase() ? lo.toUpperCase() : lo;
}

function translateCore(c: Compiled, s: string, depth = 0): string {
  const w = lookupWord(c, s);
  if (w !== undefined) return w;
  const pm = /^(.*[^\s.:;,!?…])\s*([.:;,!?…]+)$/.exec(s);
  if (pm && depth < 2) {
    const w2 = lookupWord(c, pm[1]);
    if (w2 !== undefined) return w2 + pm[2];
  }
  const hit = c.cache.get(s);
  if (hit !== undefined) return hit;
  let res = s;
  for (const p of c.patterns) {
    const m = p.re.exec(s);
    if (m) {
      res = p.out.replace(/\{(\d+)\}/g, (_x, i) => {
        const a = m[+i + 1] ?? '';
        return depth < 1 && a.trim() ? translateCore(c, a, depth + 1) : a;
      });
      break;
    }
  }
  if (c.cache.size > 4000) c.cache.clear();
  c.cache.set(s, res);
  return res;
}

/** Traduit une chaîne française (texte complet, espaces de bord conservés). */
export function tr(s: string, l: Lang = lang()): string {
  if (l === 'fr' || !s) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  if (!m[2]) return s;
  const core = m[2].replace(/\s+/g, ' ');
  const out = translateCore(compile(l), core);
  return out === core ? s : m[1] + out + m[3];
}

/** Traduit les textes d'un fragment HTML (entre balises) : bulletins et reçus. */
export function trHtml(html: string, l: Lang = lang()): string {
  if (l === 'fr') return html;
  return html.replace(/>([^<>]+)</g, (_x, t: string) => '>' + tr(t, l) + '<');
}

// --- Traducteur du DOM : l'interface est écrite en français, on traduit à l'affichage ---
const TEXT = new WeakMap<Text, { src: string; out: string }>();
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const ATTR = new WeakMap<Element, Map<string, { src: string; out: string }>>();
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);

/** Une zone marquée `data-i18n-skip` n'est jamais traduite (page d'accueil, rédigée en français). */
const skipped = (el: Element | null): boolean => !!el?.closest('[data-i18n-skip]');

function doText(n: Text): void {
  const p = n.parentElement;
  if (p && (SKIP.has(p.tagName) || skipped(p))) return;
  const rec = TEXT.get(n);
  const cur = n.data;
  const src = rec && rec.out === cur ? rec.src : cur;
  const out = tr(src);
  if (out !== cur) n.data = out;
  TEXT.set(n, { src, out });
}

function doAttr(el: Element, name: string): void {
  if (skipped(el)) return;
  const cur = el.getAttribute(name);
  if (cur === null) return;
  let m = ATTR.get(el);
  if (!m) ATTR.set(el, (m = new Map()));
  const rec = m.get(name);
  const src = rec && rec.out === cur ? rec.src : cur;
  const out = tr(src);
  if (out !== cur) el.setAttribute(name, out);
  m.set(name, { src, out });
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (SKIP.has(el.tagName) || el.hasAttribute('data-i18n-skip')) return;
  for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
}

let observer: MutationObserver | undefined;

export function startTranslator(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
      else if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttr(m.target as Element, m.attributeName!);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const saved = stored();
  if (saved !== 'fr') setLang(saved);
}

export function setLang(l: Lang): void {
  lang.set(l);
  const def = LANGS.find((x) => x.id === l)!;
  document.documentElement.lang = l;
  document.documentElement.dir = def.dir;
  try { localStorage.setItem('horizon-lang', l); } catch { /* ignoré */ }
  if (typeof document !== 'undefined' && document.body) walk(document.body);
}
