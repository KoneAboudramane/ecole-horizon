import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { PageId } from './models';

/**
 * Alertes sur le téléphone (Web Push, gratuit) : les notifications de l'école arrivent comme un SMS, même application fermée.
 * - « indisponible » : navigateur sans alertes, ou serveur sans clés ;
 * - « iphone » : sur iPhone, l'application doit d'abord être ajoutée à l'écran d'accueil ;
 * - « bloque » : la personne a refusé les alertes dans les réglages du navigateur.
 */
export type PushState = 'indisponible' | 'iphone' | 'bloque' | 'off' | 'on';

const SW = 'sw-push.js';

@Injectable({ providedIn: 'root' })
export class Push {
  private readonly api = inject(Api);
  readonly state = signal<PushState>('indisponible');
  readonly busy = signal(false);
  private key = '';
  private reg: ServiceWorkerRegistration | null = null;

  private get supported(): boolean {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined'
      && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  }
  private get iphoneBrowser(): boolean {
    const n = typeof navigator !== 'undefined' ? navigator : null;
    const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
    return !!n && /iPhone|iPad|iPod/.test(n.userAgent) && !standalone;
  }

  /** À l'ouverture d'une session : état des alertes de cet appareil ; un appareil déjà activé est rattaché au compte connecté. */
  async init(onOpen: (page: PageId | '') => void): Promise<void> {
    if (!this.supported) { this.state.set(this.iphoneBrowser ? 'iphone' : 'indisponible'); return; }
    try {
      const cfg = await this.api.get<{ enabled: boolean; public_key: string }>('notifications/push/');
      if (!cfg.enabled) { this.state.set('indisponible'); return; }
      this.key = cfg.public_key;
      this.reg = await navigator.serviceWorker.register(SW);
      this.listen(onOpen);
      const sub = await this.reg.pushManager.getSubscription();
      if (Notification.permission === 'denied') this.state.set('bloque');
      else if (sub) { await this.save(sub); this.state.set('on'); }
      else this.state.set('off');
    } catch { this.state.set('indisponible'); }
  }

  /** Demande l'autorisation puis active les alertes sur cet appareil. */
  async enable(): Promise<boolean> {
    if (!this.reg || this.busy()) return false;
    this.busy.set(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { this.state.set(perm === 'denied' ? 'bloque' : 'off'); return false; }
      const sub = (await this.reg.pushManager.getSubscription())
        ?? await this.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(this.key) });
      await this.save(sub);
      this.state.set('on');
      return true;
    } catch { return false; } finally { this.busy.set(false); }
  }

  /** Désactive les alertes de cet appareil. */
  async disable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await this.forget(); this.state.set('off'); } finally { this.busy.set(false); }
  }

  /** À la déconnexion : l'appareil ne reçoit plus les alertes de ce compte (téléphone partagé). */
  async forget(): Promise<void> {
    try {
      const sub = await this.reg?.pushManager.getSubscription();
      if (!sub) return;
      try { await this.api.post('notifications/push/unsubscribe/', { endpoint: sub.endpoint }); } catch { /* le serveur l'oubliera au prochain envoi */ }
      await sub.unsubscribe();
    } catch { /* navigateur sans alertes */ }
  }

  private async save(sub: PushSubscription): Promise<void> {
    const j = sub.toJSON();
    await this.api.post('notifications/push/subscribe/', { endpoint: j.endpoint, keys: j.keys, app_url: location.origin + location.pathname + location.search });
  }

  private listening = false;
  private listen(onOpen: (page: PageId | '') => void): void {
    if (this.listening) return;
    this.listening = true;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'ecole-notification') onOpen((e.data.page ?? '') as PageId | '');
    });
  }
}

/** Clé publique du serveur (base64 « url ») en octets, comme l'attend le navigateur. */
export function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
