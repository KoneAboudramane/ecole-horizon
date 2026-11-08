import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Avatar, Icon, Modal } from '../ui';
import { dateFr } from '../format';
import { Candidate, Messaging, Thread } from '../modules/messaging';

type Box = 'recus' | 'envoyes';

@Component({
  selector: 'app-messages',
  imports: [FormsModule, Icon, Modal, Avatar],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Messagerie</h1><p>{{ intro() }}</p></div>
      @if (canSend()) { <button type="button" class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Nouveau message</button> }</div>

    @if (!canSend()) { <div class="banner info"><app-icon name="lock" [size]="18" /> Les élèves peuvent lire leurs messages mais ne peuvent pas en envoyer.</div> }

    <div class="layout" [class.reading]="!!thread()">
      <section class="card list" aria-label="Conversations">
        <div class="tabs" role="tablist">
          <button type="button" class="tab" role="tab" [class.on]="box() === 'recus'" [attr.aria-selected]="box() === 'recus'" (click)="box.set('recus')">Reçus @if (unreadTotal() > 0) { <span class="pill warn">{{ unreadTotal() }}</span> }</button>
          <button type="button" class="tab" role="tab" [class.on]="box() === 'envoyes'" [attr.aria-selected]="box() === 'envoyes'" (click)="box.set('envoyes')">Envoyés</button>
        </div>
        <div class="searchbar"><input type="search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Rechercher une conversation" aria-label="Rechercher une conversation" /></div>
        <ul class="threads">
          @for (t of shown(); track t.id) {
            <li><button type="button" class="thread" [class.sel]="thread()?.id === t.id" [class.unread]="mm.unreadCount(t, uid()) > 0" (click)="open(t)">
              <app-avatar [name]="otherName(t)" [size]="38" />
              <span class="grow"><span class="row-top"><b class="who">{{ otherName(t) }}</b><span class="tiny muted nowrap">{{ shortDate(mm.lastTs(t)) }}</span></span>
                <span class="subj">{{ t.subject }}</span>
                <span class="prev tiny muted">{{ preview(t) }}</span></span>
              @if (mm.unreadCount(t, uid()) > 0) { <span class="dot" role="img" aria-label="Non lu"></span> }
            </button></li>
          } @empty { <li class="empty">{{ q() ? 'Aucune conversation ne correspond.' : box() === 'recus' ? 'Aucun message reçu.' : 'Aucun message envoyé.' }}</li> }
        </ul>
      </section>

      <section class="card view" aria-label="Conversation">
        @if (thread(); as t) {
          <div class="card-head"><div class="row" style="gap:8px;flex-wrap:nowrap">
              <button type="button" class="icon-btn back" (click)="sel.set(null)" aria-label="Retour aux conversations"><app-icon name="chevron" [size]="18" /></button>
              <div><h2>{{ t.subject }}</h2><div class="small muted">{{ participants(t) }}</div></div></div></div>
          <div class="msgs" aria-live="polite">
            @for (m of t.messages; track m.id) {
              <article class="msg" [class.mine]="m.fromId === uid()">
                <div class="meta"><b>{{ m.fromId === uid() ? 'Vous' : mm.nameOf(t, m.fromId) }}</b><span class="tiny muted">{{ fullDate(m.ts) }}</span></div>
                <p>{{ m.text }}</p>
              </article>
            }
          </div>
          @if (canSend()) {
            <form class="reply" (ngSubmit)="sendReply()">
              <label class="field grow"><span class="sr">Votre réponse</span><textarea rows="2" name="rp" [ngModel]="reply()" (ngModelChange)="reply.set($event)" placeholder="Écrire une réponse"></textarea></label>
              <button type="submit" class="btn primary" [disabled]="!reply().trim()">Répondre</button>
            </form>
          }
        } @else {
          <div class="empty"><app-icon name="message" [size]="28" /><p>Sélectionnez une conversation pour la lire.</p></div>
        }
      </section>
    </div>
  </div>

  @if (composing()) {
    <app-modal title="Nouveau message" size="wide" (closed)="composing.set(false)">
      <div class="stack">
        <div class="field"><span>Destinataires</span>
          @if (picked().length) { <div class="chips">@for (c of pickedList(); track c.userId) { <button type="button" class="chip on" (click)="toggle(c.userId)" [attr.aria-label]="'Retirer ' + c.name">{{ c.name }} ×</button> }</div> }
          <div class="row">
            <input class="grow" type="search" [ngModel]="cq()" (ngModelChange)="cq.set($event)" placeholder="Rechercher un nom, une classe, une matière" aria-label="Rechercher un destinataire" name="cq" />
            @if (classChoices().length > 1) { <select style="width:auto" [ngModel]="cf()" (ngModelChange)="cf.set($event)" aria-label="Filtrer par classe" name="cf"><option value="">Toutes les classes</option>@for (c of classChoices(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select> }
          </div>
          <div class="picker" role="group" aria-label="Liste des destinataires">
            @for (g of groups(); track g.name) {
              <div class="ghead">{{ g.name }}</div>
              @for (c of g.items; track c.userId) {
                <label class="opt"><input type="checkbox" [checked]="picked().includes(c.userId)" (change)="toggle(c.userId)" /><span class="grow"><b>{{ c.name }}</b><span class="tiny muted"> {{ c.sub }}</span></span></label>
              }
            } @empty { <div class="empty">Aucun destinataire ne correspond.</div> }
            @if (more() > 0) { <div class="tiny muted" style="padding:8px 12px">D’autres destinataires existent : affinez la recherche.</div> }
          </div>
          @if (canBulk()) { <div class="row"><button type="button" class="btn sm" (click)="addAllShown()">Ajouter tous les parents affichés</button>@if (picked().length) { <button type="button" class="btn sm ghost" (click)="picked.set([])">Tout désélectionner</button> }</div> }
          @if (touched() && !picked().length) { <span class="err" style="color:var(--bad);font-size:12.5px">Choisissez au moins un destinataire</span> }
          @if (pickedHasParent() && picked().length > 1) { <div class="banner info"><app-icon name="shield" [size]="18" /> Chaque parent recevra une conversation individuelle : les familles ne voient pas les autres destinataires.</div> }
        </div>
        <label class="field"><span>Objet</span><input [ngModel]="subject()" (ngModelChange)="subject.set($event)" name="sj" maxlength="120" />
          @if (touched() && subject().trim().length < 3) { <span class="err">Indiquez l’objet du message</span> }</label>
        <label class="field"><span>Message</span><textarea rows="5" [ngModel]="body()" (ngModelChange)="body.set($event)" name="bd"></textarea>
          @if (touched() && body().trim().length < 2) { <span class="err">Écrivez votre message</span> }</label>
      </div>
      <div footer><button type="button" class="btn ghost" (click)="composing.set(false)">Annuler</button><button type="button" class="btn primary" (click)="send()">Envoyer</button></div>
    </app-modal>
  }`,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 14px; align-items: start; }
    .list { overflow: hidden; }
    .searchbar { padding: 10px 12px; border-bottom: 1px solid var(--line); }
    ul.threads { list-style: none; margin: 0; padding: 0; max-height: 560px; overflow-y: auto; }
    .thread { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 14px; border: 0; border-bottom: 1px solid var(--line); background: transparent; text-align: start; cursor: pointer; }
    .thread:hover { background: var(--surface-2); }
    .thread.sel { background: var(--brand-tint); }
    .thread .row-top { display: flex; justify-content: space-between; gap: 8px; }
    .thread .who, .thread .subj, .thread .prev { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .thread .who { font-weight: 550; }
    .thread .subj { font-size: 13.5px; }
    .thread.unread .who, .thread.unread .subj { font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex: none; }
    .view { display: flex; flex-direction: column; min-height: 420px; }
    .msgs { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; max-height: 460px; overflow-y: auto; }
    .msg { max-width: 82%; padding: 10px 14px; border-radius: 12px; background: var(--surface-2); align-self: flex-start; border: 1px solid var(--line); }
    .msg.mine { align-self: flex-end; background: var(--brand-tint); border-color: transparent; }
    .msg .meta { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 2px; }
    .msg p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .reply { display: flex; gap: 10px; align-items: flex-end; padding: 12px 18px; border-top: 1px solid var(--line); margin-top: auto; }
    .view .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: auto; }
    .back { display: none; transform: scaleX(-1); }
    .picker { border: 1px solid var(--line); border-radius: 9px; max-height: 260px; overflow-y: auto; background: var(--surface); }
    .ghead { position: sticky; top: 0; padding: 6px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); background: var(--surface-2); font-weight: 600; }
    .opt { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); cursor: pointer; }
    .opt:hover { background: var(--surface-2); }
    @media (max-width: 800px) {
      .layout { grid-template-columns: 1fr; }
      .layout.reading .list { display: none; }
      .layout:not(.reading) .view { display: none; }
      .back { display: inline-grid; }
      .msg { max-width: 94%; }
      .reply { flex-direction: column; align-items: stretch; }
    }
    html[dir=rtl] .back { transform: none; }
  `,
})
export class MessagesPage {
  readonly s = inject(Store);
  readonly mm = inject(Messaging);

  readonly uid = computed(() => this.s.userId() ?? '');
  readonly canSend = computed(() => this.mm.canSend(this.s.role()));
  readonly intro = computed(() => {
    const r = this.s.role();
    if (r === 'parent') return 'Écrivez aux enseignants de vos enfants, à la direction ou à la vie scolaire.';
    if (r === 'eleve') return 'Les messages que l’établissement vous adresse apparaissent ici.';
    if (r === 'enseignant') return 'Échangez avec les parents de vos classes et avec le personnel de l’établissement.';
    return 'Échangez avec les parents et avec le personnel de l’établissement.';
  });

  readonly box = signal<Box>('recus');
  readonly q = signal('');
  readonly sel = signal<string | null>(null);
  readonly reply = signal('');

  readonly mine = computed(() => this.mm.threadsOf(this.uid()));
  readonly unreadTotal = computed(() => this.mine().filter((t) => this.mm.unreadCount(t, this.uid()) > 0).length);
  readonly shown = computed(() => {
    const me = this.uid();
    const term = this.q().trim().toLowerCase();
    return this.mine()
      .filter((t) => (this.box() === 'recus' ? t.messages.some((m) => m.fromId !== me) : t.messages.some((m) => m.fromId === me)))
      .filter((t) => !term || `${t.subject} ${this.participants(t)} ${t.messages.map((m) => m.text).join(' ')}`.toLowerCase().includes(term));
  });
  readonly thread = computed(() => this.mm.threads().find((t) => t.id === this.sel() && t.participantIds.includes(this.uid())) ?? null);

  constructor() {
    void this.mm.load();
    // Ouverture directe d'une conversation (lien depuis une notification)
    const p = this.s.param();
    if (p && this.mm.threads().some((t) => t.id === p)) this.sel.set(p);
    effect(() => {
      const t = this.thread();
      if (t && this.mm.unreadCount(t, this.uid()) > 0) queueMicrotask(() => this.mm.markRead(t.id, this.uid()));
    });
  }

  open(t: Thread): void {
    this.sel.set(t.id);
    this.reply.set('');
  }
  others(t: Thread): string[] {
    return t.participantIds.filter((x) => x !== this.uid()).map((x) => this.mm.nameOf(t, x));
  }
  otherName(t: Thread): string {
    const o = this.others(t);
    return o.length === 0 ? 'Vous' : o.length === 1 ? o[0] : `${o[0]} et ${o.length - 1} autre(s)`;
  }
  participants(t: Thread): string {
    const o = this.others(t);
    return o.length <= 4 ? o.join(', ') : `${o.slice(0, 3).join(', ')} et ${o.length - 3} autres`;
  }
  preview(t: Thread): string {
    const m = t.messages[t.messages.length - 1];
    return m ? m.text : '';
  }
  shortDate(ts: string): string {
    return ts.slice(0, 10) === this.s.today ? ts.slice(11, 16) : dateFr(ts);
  }
  fullDate(ts: string): string {
    return `${dateFr(ts)} ${ts.slice(11, 16)}`;
  }

  async sendReply(): Promise<void> {
    const t = this.thread(); const me = this.s.me();
    if (!t || !me || !this.reply().trim()) return;
    if (this.s.apiMode()) { if (await this.mm.replyAsync(t.id, this.reply().trim())) { this.reply.set(''); this.s.toast('Réponse envoyée.'); } return; }
    if (this.mm.reply(t.id, me, this.reply().trim())) { this.reply.set(''); this.s.toast('Réponse envoyée.'); }
  }

  // --- Nouveau message ---
  readonly composing = signal(false);
  readonly touched = signal(false);
  readonly picked = signal<string[]>([]);
  readonly cq = signal('');
  readonly cf = signal('');
  readonly subject = signal('');
  readonly body = signal('');
  readonly candidates = computed<Candidate[]>(() => this.mm.recipientOptions(this.s.me()));
  readonly classChoices = computed(() => {
    const ids = new Set(this.candidates().flatMap((c) => c.classIds));
    return this.s.classes().filter((c) => ids.has(c.id));
  });
  private readonly filtered = computed(() => {
    const t = this.cq().trim().toLowerCase();
    const cf = this.cf();
    return this.candidates().filter((c) => (!cf || c.classIds.includes(cf)) && (!t || `${c.name} ${c.sub}`.toLowerCase().includes(t)));
  });
  private readonly LIMIT = 60;
  readonly more = computed(() => Math.max(0, this.filtered().length - this.LIMIT));
  readonly groups = computed(() => {
    const items = this.filtered().slice(0, this.LIMIT);
    return this.mm.groupOrder.map((name) => ({ name, items: items.filter((c) => c.group === name) })).filter((g) => g.items.length);
  });
  readonly pickedList = computed(() => this.candidates().filter((c) => this.picked().includes(c.userId)));
  readonly pickedHasParent = computed(() => this.pickedList().some((c) => c.isParent));
  readonly canBulk = computed(() => this.filtered().some((c) => c.isParent));

  openNew(): void {
    this.picked.set([]); this.cq.set(''); this.cf.set(''); this.subject.set(''); this.body.set(''); this.touched.set(false);
    this.composing.set(true);
    void this.mm.loadRecipients();
  }
  toggle(id: string): void {
    this.picked.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
  addAllShown(): void {
    const ids = this.filtered().filter((c) => c.isParent).map((c) => c.userId);
    this.picked.update((l) => [...new Set([...l, ...ids])]);
  }
  async send(): Promise<void> {
    this.touched.set(true);
    const me = this.s.me();
    if (!me || !this.picked().length || this.subject().trim().length < 3 || this.body().trim().length < 2) return;
    const r = this.s.apiMode() ? await this.mm.sendAsync(this.picked(), this.subject().trim(), this.body().trim()) : this.mm.send(me, this.picked(), this.subject().trim(), this.body().trim());
    if (!r.count) { this.s.toast((('error' in r ? r.error : '') as string) || 'Aucun destinataire autorisé.', 'err'); return; }
    this.composing.set(false);
    this.box.set('envoyes');
    this.sel.set(r.firstId);
    this.s.toast(r.count > 1 ? `${r.count} conversations envoyées.` : 'Message envoyé.');
  }
}
