import { LANGS, Lang, lang, setLang } from './i18n/i18n';
import { AfterViewInit, Component, Directive, ElementRef, OnDestroy, TemplateRef, inject, input, output, viewChild, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

const ICONS: Record<string, string[]> = {
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  monitor: ['M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M8 21h8M12 17v4'],
  star: ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'],
  camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  layers: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  key: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
  globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  book: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  clipboard: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 2h6v4H9z'],
  calendar: ['M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  card: ['M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M1 10h22'],
  alert: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
  tag: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
  refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
  phone: ['M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
  menu: ['M3 12h18', 'M3 6h18', 'M3 18h18'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  chart: ['M12 20V10', 'M18 20V4', 'M6 20v-4'],
  check: ['M20 6L9 17l-5-5'],
  lock: ['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  chevron: ['M9 18l6-6-6-6'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  swap: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
};

@Component({
  selector: 'app-icon',
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    @for (d of paths(); track $index) { <path [attr.d]="d" /> }
  </svg>`,
  styles: ':host { display: inline-flex; flex: none; } svg { display: block; }',
})
export class Icon {
  name = input.required<string>();
  size = input(20);
  paths = computed(() => ICONS[this.name()] ?? []);
}

@Component({
  selector: 'app-avatar',
  template: `@if (photo()) { <img [src]="photo()" alt="" /> } @else { {{ initials() }} }`,
  host: {
    class: 'avatar',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.38',
    '[style.--h]': 'hue()',
  },
  styles: ':host { overflow: hidden; } img { width: 100%; height: 100%; object-fit: cover; display: block; }',
})
export class Avatar {
  name = input.required<string>();
  photo = input<string | null | undefined>(null);
  size = input(36);
  initials = computed(() => {
    const parts = this.name().replace(/^(M\.|Mme|Mlle|Dr)\s+/i, '').split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  });
  hue = computed(() => {
    let h = 0;
    for (const c of this.name()) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h % 2 ? 155 + (h % 40) : 20 + (h % 40);
  });
}

/**
 * Sur grand écran (1100 px et plus), donne à l'élément toute la hauteur restante de la fenêtre : la page ne défile plus,
 * c'est son contenu (tableau, aperçu) qui défile à l'intérieur. Ajoute la classe `fit-h` (styles globaux). En dessous,
 * la page défile normalement. Recalculé au redimensionnement et quand le haut de la page change (bandeau, onglet…).
 * Sans effet si l'élément n'est pas le dernier bloc de la page : ce qui le suit resterait sinon hors de l'écran.
 */
@Directive({ selector: '[appFitHeight]', host: { '[class.fit-h]': 'h() !== null', '[style.height.px]': 'h()', '(window:resize)': 'fit()' } })
export class FitHeight implements AfterViewInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly h = signal<number | null>(null);
  private ro?: ResizeObserver;
  ngAfterViewInit(): void {
    setTimeout(() => this.fit());
    const page = this.el.nativeElement.parentElement;
    if (page && typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(page); }
  }
  ngOnDestroy(): void { this.ro?.disconnect(); }
  /** Vrai si rien ne suit l'élément jusqu'au bas de la page (les fenêtres modales ne comptent pas). */
  private isLastBlock(): boolean {
    let n: HTMLElement | null = this.el.nativeElement;
    while (n && !n.classList.contains('page')) {
      for (let x = n.nextElementSibling; x; x = x.nextElementSibling) if (x.tagName !== 'APP-MODAL' && x.tagName !== 'APP-LIST-MODAL') return false;
      n = n.parentElement;
    }
    return !!n;
  }
  fit(): void {
    const el = this.el.nativeElement;
    if (typeof window === 'undefined' || window.innerWidth < 1100 || !this.isLastBlock()) { if (this.h() !== null) this.h.set(null); return; }
    const top = el.getBoundingClientRect().top + window.scrollY;
    const next = Math.max(360, Math.floor(window.innerHeight - top - 20));
    if (next !== this.h()) this.h.set(next);
  }
}

@Component({
  selector: 'app-modal',
  imports: [Icon],
  template: `
    <div class="overlay" (mousedown)="onBackdrop($event)" (keydown.escape)="closed.emit()">
      <div #box class="dialog" [class.wide]="size() === 'wide'" [class.xl]="size() === 'xl'" role="dialog" aria-modal="true" [attr.aria-label]="title()" tabindex="-1">
        <div class="dialog-head">
          <h2>{{ title() }}</h2>
          <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Fermer"><app-icon name="x" /></button>
        </div>
        <div class="dialog-body"><ng-content /></div>
        <div class="dialog-foot"><ng-content select="[footer]" /></div>
      </div>
    </div>
  `,
  styles: '.dialog-foot:empty { display: none; }',
})
export class Modal implements AfterViewInit {
  title = input.required<string>();
  size = input<'normal' | 'wide' | 'xl'>('normal');
  closed = output<void>();
  private box = viewChild<ElementRef<HTMLElement>>('box');

  ngAfterViewInit(): void {
    this.box()?.nativeElement.focus();
  }
  onBackdrop(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('overlay')) this.closed.emit();
  }
}

/** Texte comparable : sans accents ni majuscules (« Élève » trouve « eleve »). */
const plain = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Fenêtre « liste complète » derrière les boutons « Afficher la suite » : titre avec le nombre, recherche (sans accents),
 * tableau entier avec en-tête toujours visible, export facultatif. La page fournit l'en-tête et le modèle de ligne
 * (`<ng-template>`), les mêmes que son propre tableau : les lignes et leurs boutons sont identiques.
 */
@Component({
  selector: 'app-list-modal',
  imports: [Modal, Icon, NgTemplateOutlet],
  template: `
  <app-modal [title]="title() + ' · ' + items().length" size="xl" (closed)="closed.emit()">
    <div class="lm-bar">
      <input type="search" [placeholder]="placeholder()" [value]="q()" (input)="q.set($any($event.target).value)" aria-label="Rechercher dans la liste" />
      <span class="small muted">{{ shown().length === items().length ? 'Tous les éléments' : shown().length + ' sur ' + items().length }}</span>
    </div>
    <div class="table-wrap lm-scroll"><table class="table" [class.hover]="hover()">
      <thead><ng-container [ngTemplateOutlet]="head()" /></thead>
      <tbody>
        @for (x of shown(); track $index) { <ng-container [ngTemplateOutlet]="row()" [ngTemplateOutletContext]="{ $implicit: x }" /> }
        @empty { <tr><td [attr.colspan]="cols()" class="empty">Aucun résultat pour « {{ q() }} ».</td></tr> }
      </tbody>
    </table></div>
    <div footer class="lm-foot">
      <span class="small muted grow">{{ shown().length }} {{ shown().length > 1 ? 'lignes' : 'ligne' }}</span>
      @if (pageLabel()) { <button type="button" class="btn ghost" (click)="openPage.emit()">Ouvrir la page {{ pageLabel() }}</button> }
      @if (exportable()) { <button type="button" class="btn" (click)="exported.emit()"><app-icon name="download" [size]="16" /> Exporter</button> }
      <button type="button" class="btn primary" (click)="closed.emit()">Fermer</button>
    </div>
  </app-modal>`,
})
export class ListModal<T> {
  readonly title = input.required<string>();
  readonly items = input.required<T[]>();
  readonly head = input.required<TemplateRef<unknown>>();
  readonly row = input.required<TemplateRef<{ $implicit: T }>>();
  /** Texte d'une ligne pour la recherche. */
  readonly text = input<(x: T) => string>(() => '');
  readonly placeholder = input('Rechercher dans la liste…');
  readonly cols = input(5);
  readonly hover = input(false);
  readonly exportable = input(false);
  /** Libellé de la page complète (« Journal d’activité »…) : affiche un bouton pour s'y rendre. */
  readonly pageLabel = input('');
  readonly closed = output<void>();
  readonly exported = output<void>();
  readonly openPage = output<void>();
  readonly q = signal('');
  readonly shown = computed(() => {
    const t = plain(this.q().trim());
    return t ? this.items().filter((x) => plain(this.text()(x)).includes(t)) : this.items();
  });
}

@Component({
  selector: 'app-lang',
  imports: [Icon],
  template: `<label class="lang-sel"><app-icon name="globe" [size]="16" />
    <select [value]="lang()" (change)="pick($any($event.target).value)" aria-label="Langue">
      @for (l of langs; track l.id) { <option [value]="l.id" [selected]="l.id === lang()">{{ l.label }}</option> }
    </select></label>`,
})
export class LangSwitch {
  readonly langs = LANGS;
  readonly lang = lang;
  pick(v: Lang): void { setLang(v); }
}

export type ThemeMode = 'auto' | 'light' | 'dark' | 'night';
export const THEME_MODES: { id: ThemeMode; label: string; icon: string }[] = [
  { id: 'auto', label: 'Automatique', icon: 'monitor' },
  { id: 'light', label: 'Clair', icon: 'sun' },
  { id: 'dark', label: 'Sombre', icon: 'moon' },
  { id: 'night', label: 'Nuit', icon: 'star' },
];

const themeMode = signal<ThemeMode>('light');
const themeEff = signal<'light' | 'dark' | 'night'>('light');
let themeReady = false;
function applyTheme(m: ThemeMode, save: boolean): void {
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  themeMode.set(m);
  const eff = m === 'auto' ? (mq?.matches ? 'dark' : 'light') : m;
  themeEff.set(eff);
  document.documentElement.dataset['theme'] = eff;
  if (save) { try { localStorage.setItem('horizon-theme', m); } catch { /* ignoré */ } }
}

@Component({
  selector: 'app-theme',
  imports: [Icon],
  template: `
  <div class="pop-host">
    <button type="button" class="icon-btn" (click)="open.set(!open())" aria-label="Changer de thème" title="Changer de thème" aria-haspopup="menu" [attr.aria-expanded]="open()"><app-icon [name]="current().icon" [size]="18" /></button>
    @if (open()) {
      <div class="scrim-clear" (click)="open.set(false)"></div>
      <div class="pop theme-pop" role="menu">
        @for (m of modes; track m.id) {
          <button type="button" class="pop-item theme-item" role="menuitemradio" [attr.aria-checked]="mode() === m.id" [class.on]="mode() === m.id" (click)="pick(m.id)">
            <app-icon [name]="m.icon" [size]="16" /><span class="grow">{{ m.label }}</span>@if (mode() === m.id) { <app-icon name="check" [size]="16" /> }
          </button>
        }
      </div>
    }
  </div>`,
  styles: `.pop-host { position: relative; } .pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 50; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; } .pop-item { display: flex; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); padding: 10px 14px; cursor: pointer; font-size: 14px; color: var(--ink); } .pop-item:last-child { border-bottom: 0; } .pop-item:hover { background: var(--surface-2); } :host-context(html[dir=rtl]) .pop { right: auto; left: 0; } :host-context(.side-tools) .pop { top: auto; bottom: calc(100% + 6px); left: 0; right: auto; } .theme-pop { width: 190px; } .theme-item { flex-direction: row !important; align-items: center; gap: 10px !important; } .theme-item.on { color: var(--brand); font-weight: 600; } .scrim-clear { position: fixed; inset: 0; z-index: 49; }`,
})
export class ThemeToggle {
  readonly modes = THEME_MODES;
  readonly mode = themeMode;
  readonly open = signal(false);
  readonly current = computed(() => THEME_MODES.find((m) => m.id === (themeMode() === 'auto' ? (themeEff() === 'light' ? 'light' : 'dark') : themeMode()))!);
  constructor() {
    if (themeReady) return;
    themeReady = true;
    let t: string | null = null;
    try { t = localStorage.getItem('horizon-theme'); } catch { /* indisponible */ }
    applyTheme(t === 'light' || t === 'dark' || t === 'night' || t === 'auto' ? t : 'light', false);
    if (typeof matchMedia !== 'undefined') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (themeMode() === 'auto') applyTheme('auto', false); });
  }
  pick(m: ThemeMode): void { applyTheme(m, true); this.open.set(false); }
}

@Component({
  selector: 'app-logo',
  template: `@if (src()) { <img [src]="src()" alt="Logo de l’école" /> } @else { <span class="ph"><b>H</b>@if (size() >= 80) { <small>Logo de l’école</small> }</span> }`,
  host: { class: 'school-logo', '[class.blank]': '!src()', '[style.width.px]': 'size()', '[style.height.px]': 'size()', '[style.--sz.px]': 'size()' },
  styles: `:host { display: grid; place-items: center; border-radius: 22%; overflow: hidden; background: #fff; border: 1px solid var(--line); flex: none; }
    :host(.blank) { background: var(--brand); border-color: transparent; box-shadow: inset 0 -4px 0 var(--accent); }
    img { width: 86%; height: 86%; object-fit: contain; display: block; }
    .ph { display: grid; place-items: center; gap: 2px; color: var(--on-brand); text-align: center; }
    .ph b { font-family: var(--font-display); font-size: calc(var(--sz) * 0.46); line-height: 1; }
    .ph small { font-size: 10px; opacity: .8; line-height: 1.1; padding: 0 6px; }
    :host { font-size: 14px; }`,
})
export class SchoolLogo {
  readonly src = input<string | undefined>();
  readonly size = input(56);
}


/** Ajoute à chaque cellule le titre de sa colonne : sur mobile, les tableaux deviennent des fiches lisibles. */
export function startTableLabels(): void {
  if (typeof MutationObserver === 'undefined') return;
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('table.table').forEach((t) => {
      const heads = Array.from(t.tHead?.rows[t.tHead.rows.length - 1]?.cells ?? []).map((h) => (h.textContent ?? '').trim());
      if (!heads.length) return;
      t.tBodies[0] && Array.from(t.tBodies[0].rows).forEach((r) => {
        Array.from(r.cells).forEach((c, i) => {
          if (c.colSpan > 1) return;
          const l = heads[i] ?? '';
          if (c.dataset['label'] !== l) c.dataset['label'] = l;
        });
      });
    });
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
}


/** Les chiffres des indicateurs comptent jusqu'à leur valeur quand ils apparaissent (« 1 250 000 FCFA », « 85,5 % »…).
 *  Le texte final est exactement celui de la page ; si la page change la valeur entre-temps, l'animation s'arrête. */
export function startCountUp(): void {
  if (typeof MutationObserver === 'undefined' || typeof IntersectionObserver === 'undefined') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const NUM = /\d[\d\s  ]*(?:[,.]\d+)?/;
  const seen = new WeakSet<Element>();
  const play = (el: Element) => {
    const node = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && NUM.test(n.nodeValue ?? '')) as Text | undefined;
    if (!node) return;
    const orig = node.nodeValue ?? '';
    const raw = (orig.match(NUM) ?? [''])[0], core = raw.trimEnd(), tail = raw.slice(core.length);
    const dec = /[,.](\d+)$/.exec(core)?.[1].length ?? 0, sep = core.includes(',') ? ',' : '.';
    const group = /[\s  ]/.exec(core)?.[0] ?? '';
    const target = Number(core.replace(/[\s  ]/g, '').replace(',', '.'));
    if (!isFinite(target) || target === 0) return;
    const fmt = (v: number) => {
      const [i, d] = v.toFixed(dec).split('.');
      const ig = group ? i.replace(/\B(?=(\d{3})+(?!\d))/g, group) : i;
      return (d ? ig + sep + d : ig) + tail;
    };
    let last = orig;
    const t0 = performance.now();
    const step = (t: number) => {
      if (node.nodeValue !== last) return;                       // la page a mis à jour la valeur : on la laisse
      const p = Math.min(1, (t - t0) / 1100);
      last = p < 1 ? orig.replace(raw, fmt(target * (1 - Math.pow(1 - p, 3)))) : orig;
      node.nodeValue = last;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { io.unobserve(x.target); play(x.target); } }), { threshold: 0.5 });
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll('.kpi-card .value').forEach((el) => { if (!seen.has(el)) { seen.add(el); io.observe(el); } });
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
  run();
}
