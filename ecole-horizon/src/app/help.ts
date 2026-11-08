import { Component, computed, effect, ElementRef, HostListener, inject, Injectable, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PAGE_TITLE, PAGES, GUIDES, TOUR, faqFor, helpFor, searchHelp, seeAlso } from './help-content';
import { PageId, ROLE_LABEL } from './models';
import { Store } from './store';
import { Icon } from './ui';

type Tab = 'page' | 'espace' | 'faq';

const seenKey = (id: string) => `ecole.visite.${id}`;
const wasSeen = (id: string): boolean => { try { return globalThis.localStorage?.getItem(seenKey(id)) === '1'; } catch { return false; } };
const markSeen = (id: string): void => { try { globalThis.localStorage?.setItem(seenKey(id), '1'); } catch { /* sans effet */ } };

/**
 * Aide intégrée : bouton « ? » dans l’en-tête, panneau contextuel (page, guide du rôle, questions)
 * et visite guidée à la première connexion. Les textes sont dans help-content.ts.
 */
/** État partagé entre le bouton de l’en-tête et le panneau (qui doit vivre hors de l’en-tête : son flou d’arrière-plan piège les éléments « fixed »). */
@Injectable({ providedIn: 'root' })
export class HelpState {
  readonly open = signal(false);
  readonly tab = signal<Tab>('page');
  readonly viewPage = signal<PageId | null>(null);
  readonly query = signal('');
  readonly tourOpen = signal(false);
  readonly tourIdx = signal(0);
  toggle(): void {
    if (this.open()) { this.open.set(false); return; }
    this.tab.set('page'); this.viewPage.set(null); this.query.set('');
    this.open.set(true);
  }
  close(): void { this.open.set(false); }
  openPage(p: PageId): void { this.query.set(''); this.viewPage.set(p); this.tab.set('page'); }
  startTour(): void { this.open.set(false); this.tourIdx.set(0); this.tourOpen.set(true); }
}

/** Bouton « ? » de l’en-tête. */
@Component({
  selector: 'app-help',
  imports: [Icon],
  template: `<button type="button" class="icon-btn help-btn" (click)="h.toggle()" aria-label="Aide" title="Aide" [attr.aria-expanded]="h.open()"><app-icon name="help" /></button>`,
})
export class HelpButton { readonly h = inject(HelpState); }

@Component({
  selector: 'app-help-overlay',
  imports: [FormsModule, Icon],
  template: `

  @if (open()) {
    <div class="help-scrim" (click)="close()"></div>
    <aside class="help-panel" lang="fr" dir="ltr" role="dialog" aria-modal="true" aria-label="Aide">
      <header class="help-head">
        <div class="grow"><b>Aide</b><div class="tiny muted">{{ roleLabel }}</div></div>
        <button #closeBtn type="button" class="icon-btn" (click)="close()" aria-label="Fermer l’aide"><app-icon name="x" /></button>
      </header>
      <div class="help-search">
        <app-icon name="search" [size]="16" />
        <input type="search" placeholder="Rechercher dans l’aide…" [ngModel]="query()" (ngModelChange)="query.set($event)" aria-label="Rechercher dans l’aide" />
      </div>

      @if (query().trim().length >= 2) {
        <div class="help-body">
          @for (r of results(); track r.kind + r.id) {
            @if (r.kind === 'page') {
              <button type="button" class="help-hit" (click)="openPage($any(r.id))"><b>{{ r.title }}</b><span class="tiny muted">{{ r.extrait }}</span></button>
            } @else {
              <details class="help-hit faq" open><summary><b>{{ r.title }}</b></summary><p class="small">{{ r.extrait }}</p></details>
            }
          } @empty {
            <p class="muted small">Aucun résultat. Essayez un autre mot, ou contactez {{ guide().contact }}.</p>
          }
        </div>
      } @else {
        <div class="help-tabs" role="tablist">
          <button type="button" role="tab" [class.on]="tab() === 'page'" (click)="tab.set('page'); viewPage.set(null)">Cette page</button>
          <button type="button" role="tab" [class.on]="tab() === 'espace'" (click)="tab.set('espace')">Mon espace</button>
          <button type="button" role="tab" [class.on]="tab() === 'faq'" (click)="tab.set('faq')">Questions</button>
        </div>

        <div class="help-body">
          @switch (tab()) {
            @case ('page') {
              @if (viewPage() && viewPage() !== store.page()) { <button type="button" class="link small" (click)="viewPage.set(null)">← Revenir à la page où je suis</button> }
              <h3>{{ pageTitle() }}</h3>
              <p>{{ content().but }}</p>
              <h4>Comment faire</h4>
              <ol>@for (e of content().etapes; track $index) { <li>{{ e }}</li> }</ol>
              @if (content().erreurs?.length) {
                <h4>Si ça ne marche pas</h4>
                <ul>@for (e of content().erreurs; track $index) { <li>{{ e }}</li> }</ul>
              }
              @if (content().astuce) { <div class="help-tip"><b>Astuce.</b> {{ content().astuce }}</div> }
              @if (related().length) {
                <h4>Voir aussi</h4>
                <div class="help-index">@for (p of related(); track p) { <button type="button" class="chip" (click)="openPage(p)">{{ titles[p] }}</button> }</div>
              }
            }
            @case ('espace') {
              <p>{{ guide().resume }}</p>
              <h4>Ce que vous pouvez faire</h4>
              <ul class="ok">@for (e of guide().peut; track $index) { <li>{{ e }}</li> }</ul>
              <h4>Ce que vous ne pouvez pas faire</h4>
              <ul class="no">@for (e of guide().nePeutPas; track $index) { <li>{{ e }}</li> }</ul>
              @for (p of guide().parcours; track p.titre) {
                <h4>{{ p.titre }}</h4>
                <ol>@for (e of p.etapes; track $index) { <li>{{ e }}</li> }</ol>
              }
              <h4>Les pages de votre espace</h4>
              <div class="help-index">
                @for (p of pages(); track p) { <button type="button" class="chip" (click)="openPage(p)">{{ titles[p] }}</button> }
              </div>
              <p class="small muted">Une difficulté ? Contactez {{ guide().contact }}.</p>
              <button type="button" class="btn" (click)="startTour()">Revoir la visite guidée</button>
            }
            @case ('faq') {
              @for (f of faq(); track f.q) {
                <details class="faq"><summary>{{ f.q }}</summary><p class="small">{{ f.r }}</p></details>
              }
            }
          }
        </div>
      }
    </aside>
  }

  @if (tourOpen()) {
    <div class="help-scrim tour-scrim"></div>
    <section class="tour" lang="fr" dir="ltr" role="dialog" aria-modal="true" aria-label="Visite guidée">
      <div class="tiny muted">Visite guidée · {{ tourIdx() + 1 }} / {{ steps().length }}</div>
      <h3>{{ step().titre }}</h3>
      <p>{{ step().texte }}</p>
      <div class="dots" aria-hidden="true">@for (s of steps(); track $index) { <span [class.on]="$index === tourIdx()"></span> }</div>
      <div class="tour-actions">
        <button type="button" class="link small" (click)="endTour()">Passer la visite</button>
        <span class="grow"></span>
        @if (tourIdx() > 0) { <button type="button" class="btn" (click)="tourIdx.set(tourIdx() - 1)">Précédent</button> }
        @if (tourIdx() < steps().length - 1) { <button type="button" class="btn primary" (click)="tourIdx.set(tourIdx() + 1)">Suivant</button> }
        @else { <button type="button" class="btn primary" (click)="endTour()">Terminer</button> }
      </div>
    </section>
  }
  `,
  styles: `
    .help-scrim { position: fixed; inset: 0; background: var(--overlay); z-index: 70; }
    .help-panel { position: fixed; top: 0; inset-inline-end: 0; bottom: 0; width: min(440px, 100vw); z-index: 71; background: var(--surface); border-inline-start: 1px solid var(--line);
      box-shadow: var(--shadow); display: flex; flex-direction: column; animation: slide .18s ease-out; }
    @keyframes slide { from { transform: translateX(var(--slide, 24px)); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .help-panel { animation: none; } }
    .help-panel, .help-panel *, .tour, .tour * { text-align: left; }
    .help-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .help-search { display: flex; align-items: center; gap: 8px; margin: 12px 16px 0; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); color: var(--muted); }
    .help-search input { flex: 1; border: 0; background: none; height: 40px; color: var(--ink); font: inherit; outline: none; min-width: 0; }
    .help-tabs { display: flex; gap: 4px; padding: 12px 16px 0; border-bottom: 1px solid var(--line); }
    .help-tabs button { background: none; border: 0; padding: 8px 12px; font: inherit; font-size: 14px; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .help-tabs button.on { color: var(--brand); border-bottom-color: var(--brand); font-weight: 700; }
    .help-body { padding: 16px; overflow-y: auto; flex: 1; line-height: 1.5; }
    .help-body h3 { margin: 4px 0 8px; font-size: 18px; }
    .help-body h4 { margin: 18px 0 6px; font-size: 14px; color: var(--brand); text-transform: none; }
    .help-body ol, .help-body ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
    .help-body ul.ok { list-style: '✓  '; }
    .help-body ul.no { list-style: '✕  '; }
    .help-tip { margin-top: 16px; padding: 10px 12px; border-radius: 10px; background: var(--brand-tint); font-size: 14px; }
    .help-index { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .chip { border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
    .chip:hover { border-color: var(--brand); }
    .help-hit { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; font: inherit; color: var(--ink); cursor: pointer; }
    .help-hit:hover { border-color: var(--brand); }
    details.faq { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: var(--surface); }
    details.faq summary { cursor: pointer; font-weight: 600; }
    details.faq p { margin: 8px 0 0; }
    .tour-scrim { z-index: 80; }
    .tour { position: fixed; z-index: 81; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100vw - 32px)); background: var(--surface);
      border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); padding: 22px; }
    .tour h3 { margin: 6px 0 8px; font-size: 20px; }
    .tour p { margin: 0 0 16px; line-height: 1.55; }
    .dots { display: flex; gap: 6px; margin-bottom: 16px; }
    .dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
    .dots span.on { background: var(--brand); }
    .tour-actions { display: flex; align-items: center; gap: 8px; }
    .grow { flex: 1; }
  `,
})
export class HelpOverlay {
  readonly store = inject(Store);
  readonly h = inject(HelpState);
  /** Pages proposées au rôle courant (le menu de gauche) : limite la recherche et l’index. */
  readonly pages = input<PageId[]>([]);
  readonly titles = PAGE_TITLE;
  readonly open = this.h.open; readonly tab = this.h.tab; readonly viewPage = this.h.viewPage; readonly query = this.h.query;
  readonly tourOpen = this.h.tourOpen; readonly tourIdx = this.h.tourIdx;
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  private readonly role = computed(() => this.store.role());
  get roleLabel(): string { const r = this.role(); return this.store.me()?.roleLabel || (r ? ROLE_LABEL[r] : ''); }
  readonly guide = computed(() => GUIDES[this.role() ?? 'parent']);
  readonly shownPage = computed<PageId>(() => this.viewPage() ?? this.store.page());
  readonly pageTitle = computed(() => PAGE_TITLE[this.shownPage()]);
  readonly content = computed(() => helpFor(this.role(), this.shownPage()));
  readonly faq = computed(() => faqFor(this.role()));
  readonly related = computed(() => seeAlso(this.shownPage(), this.pages()));
  readonly results = computed(() => searchHelp(this.role(), this.query(), this.pages().length ? this.pages() : undefined));
  readonly steps = computed(() => TOUR[this.role() ?? 'parent']);
  readonly step = computed(() => this.steps()[Math.min(this.tourIdx(), this.steps().length - 1)]);

  constructor() {
    // Changer de page ramène l’aide sur la page courante.
    effect(() => { this.store.page(); untracked(() => this.viewPage.set(null)); });
    // Visite guidée à la première connexion de chaque utilisateur.
    effect(() => {
      const id = this.store.userId();
      if (!id) return;
      untracked(() => {
        if (!wasSeen(id) && !this.tourOpen()) setTimeout(() => { if (this.store.userId() === id && !wasSeen(id)) this.startTour(); }, 600);
      });
    });
    // Place le focus sur le bouton de fermeture à l’ouverture.
    effect(() => { if (this.open()) setTimeout(() => this.closeBtn()?.nativeElement.focus(), 0); });
  }

  toggle(): void { this.h.toggle(); }
  close(): void { this.h.close(); }
  openPage(p: PageId): void { this.h.openPage(p); }
  startTour(): void { this.h.startTour(); }
  endTour(): void {
    this.tourOpen.set(false);
    const id = this.store.userId();
    if (id) markSeen(id);
  }

  /** La touche « ? » ouvre l’aide, sauf pendant la saisie dans un champ. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || this.tourOpen() || !this.store.userId()) return;
    const t = e.target as HTMLElement | null;
    if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    this.h.toggle();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.tourOpen()) this.endTour();
    else if (this.open()) this.close();
  }
}

export const HELP_PAGES = Object.keys(PAGES) as PageId[];
