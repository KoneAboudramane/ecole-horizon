import { Component, computed, inject, input, signal } from '@angular/core';
import { Push } from './push';
import { Store } from './store';
import { Icon } from './ui';

const HIDE = 'ecole.push.masque';

/** Proposition d'activer les alertes sur le téléphone. « accueil » : bandeau du tableau de bord, masquable ; « cloche » : état détaillé. */
@Component({
  selector: 'app-push-cta',
  imports: [Icon],
  template: `
    @if (place() === 'accueil') {
      @if (show()) {
        <div class="banner info push-banner"><app-icon name="bell" [size]="18" />
          <div class="grow">
            <p>
              @if (p.state() === 'iphone') {
                <b>Recevez les alertes de l’école sur votre iPhone</b> : touchez <b>Partager</b> puis <b>« Sur l’écran d’accueil »</b>,
                ouvrez l’application depuis l’écran d’accueil, puis activez les alertes.
              } @else {
                <b>Soyez prévenu sur ce téléphone</b> des absences, des notes, des bulletins et des paiements, même application fermée. Gratuit.
              }
            </p>
            <div class="push-actions">
              @if (p.state() === 'off') { <button type="button" class="btn sm primary" [disabled]="p.busy()" (click)="enable()">Activer les alertes</button> }
              <button type="button" class="link small" (click)="hide()">Plus tard</button>
            </div>
          </div>
        </div>
      }
    } @else {
      @switch (p.state()) {
        @case ('off') {
          <div class="push-cta"><span>Recevoir ces notifications sur ce téléphone, même application fermée.</span>
            <button type="button" class="btn sm primary" [disabled]="p.busy()" (click)="enable()">Activer</button></div>
        }
        @case ('on') {
          <div class="push-cta"><span class="tiny muted"><app-icon name="check" [size]="14" /> Alertes activées sur cet appareil.</span>
            <button type="button" class="link small" [disabled]="p.busy()" (click)="p.disable()">Désactiver</button></div>
        }
        @case ('bloque') { <div class="push-cta tiny muted">Alertes bloquées : autorisez les notifications de ce site dans les réglages du navigateur.</div> }
        @case ('iphone') { <div class="push-cta tiny muted">Sur iPhone : ajoutez l’application à l’écran d’accueil (Partager, « Sur l’écran d’accueil ») pour recevoir les alertes.</div> }
      }
    }
  `,
  styles: [`
    .push-cta { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; background: var(--surface-2); }
    .push-cta > span { flex: 1; display: inline-flex; align-items: center; gap: 6px; }
    .push-banner { align-items: flex-start; margin-bottom: 16px; }
    .push-banner p { margin: 0; }
    .push-actions { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
  `],
})
export class PushCta {
  readonly p = inject(Push);
  private readonly s = inject(Store);
  readonly place = input<'accueil' | 'cloche'>('cloche');
  private readonly hidden = signal(readHidden());
  readonly show = computed(() => !this.hidden() && (this.p.state() === 'off' || this.p.state() === 'iphone'));

  async enable(): Promise<void> {
    if (await this.p.enable()) this.s.toast('Alertes activées : vous serez prévenu sur ce téléphone.');
    else if (this.p.state() === 'bloque') this.s.toast('Alertes refusées. Vous pouvez les autoriser dans les réglages du navigateur.', 'info');
  }
  hide(): void {
    this.hidden.set(true);
    try { localStorage.setItem(HIDE, '1'); } catch { /* stockage indisponible : masqué jusqu'au prochain chargement */ }
  }
}

function readHidden(): boolean {
  try { return localStorage.getItem(HIDE) === '1'; } catch { return false; }
}
