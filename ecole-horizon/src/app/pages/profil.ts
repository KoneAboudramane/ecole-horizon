import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Avatar, Icon } from '../ui';
import { ROLE_LABEL } from '../models';
import { LANGS, lang, setLang } from '../i18n/i18n';

const MAX_FILE = 6 * 1024 * 1024;

@Component({
  selector: 'app-profil',
  imports: [FormsModule, Icon, Avatar],
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 18px; align-items: start; }
    @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
    .id-card { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
    .photo-wrap { position: relative; margin-bottom: 6px; }
    .photo-btn { position: absolute; inset-inline-end: -2px; bottom: -2px; width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--surface); background: var(--brand); color: var(--on-brand); display: grid; place-items: center; cursor: pointer; }
    .photo-btn:hover { background: var(--brand-strong); }
    .facts { width: 100%; margin-top: 10px; display: grid; gap: 8px; text-align: start; }
    .facts div { display: flex; justify-content: space-between; gap: 12px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 13.5px; }
    .facts span:first-child { color: var(--muted); }
    .facts span:last-child { font-weight: 550; text-align: end; overflow-wrap: anywhere; }
    .meter { display: flex; gap: 4px; margin-top: 2px; }
    .meter i { flex: 1; height: 5px; border-radius: 3px; background: var(--line); }
    .meter i.on { background: var(--bad); } .meter.m2 i.on { background: var(--warn); } .meter.m3 i.on { background: var(--ok); }
    .pw-row { position: relative; }
    .pw-row input { padding-inline-end: 80px; }
    .pw-row button { position: absolute; inset-inline-end: 8px; top: 50%; transform: translateY(-50%); }
    .stack-form { display: grid; gap: 14px; max-width: 520px; }
  `,
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Mon profil</h1><p>Votre photo, vos informations personnelles et votre mot de passe.</p></div></div>
    @if (me(); as u) {
    <div class="layout">
      <div class="card pad id-card">
        <div class="photo-wrap">
          <app-avatar [name]="u.name" [photo]="u.photo" [size]="112" />
          <button type="button" class="photo-btn" (click)="file.click()" aria-label="Changer la photo" title="Changer la photo"><app-icon name="camera" [size]="16" /></button>
        </div>
        <input #file type="file" accept="image/png,image/jpeg,image/webp" hidden (change)="onFile($event)" />
        <h2>{{ u.name }}</h2>
        <span class="pill">{{ u.roleLabel || roleLabel[u.role] }}</span>
        <div class="row" style="justify-content:center;margin-top:8px">
          <button class="btn sm" (click)="file.click()"><app-icon name="camera" [size]="15" /> {{ u.photo ? 'Changer la photo' : 'Ajouter une photo' }}</button>
          @if (u.photo) { <button class="btn sm ghost" (click)="removePhoto()">Retirer</button> }
        </div>
        @if (photoError()) { <div class="banner bad" role="alert" style="width:100%">{{ photoError() }}</div> }
        <p class="tiny muted">JPG, PNG ou WebP, 6 Mo au maximum. La photo est recadrée en carré.</p>
        <div class="facts">
          <div><span>Identifiant</span><span>{{ u.username }}</span></div>
          @for (f of extra(); track f.k) { <div><span>{{ f.k }}</span><span>{{ f.v }}</span></div> }
        </div>
      </div>

      <div class="stack">
        <form class="card pad" (ngSubmit)="saveInfo()">
          <h2 style="margin-bottom:12px">Informations personnelles</h2>
          <div class="stack-form">
            <label class="field"><span>Nom complet</span>
              <input name="nm" [(ngModel)]="name" [readonly]="u.role === 'eleve'" autocomplete="name" />
              @if (u.role === 'eleve') { <span class="tiny muted">Le nom de l’élève est celui de son dossier scolaire ; il est modifié par le secrétariat.</span> }
            </label>
            <label class="field"><span>Téléphone</span><input name="ph" type="tel" [(ngModel)]="phone" autocomplete="tel" inputmode="tel" /></label>
            <label class="field"><span>{{ staff() ? 'Adresse e-mail' : 'Adresse e-mail (facultatif)' }}</span><input name="em" type="email" [(ngModel)]="email" autocomplete="email" [readonly]="staff()" />@if (staff()) { <span class="tiny muted">Cette adresse est gérée par l’administration de l’école (elle sert à réinitialiser votre mot de passe). Pour la changer, adressez-vous au secrétariat.</span> }</label>
            <label class="field"><span>Langue préférée</span>
              <select name="lg" [(ngModel)]="pref">@for (l of langs; track l.id) { <option [value]="l.id">{{ l.label }}</option> }</select>
            </label>
            @if (infoError()) { <div class="banner bad" role="alert">{{ infoError() }}</div> }
            <div class="row"><button class="btn primary" type="submit" [disabled]="!infoDirty()">Enregistrer les modifications</button>
              @if (infoDirty()) { <button class="btn ghost" type="button" (click)="reset()">Annuler</button> }</div>
          </div>
        </form>

        <form class="card pad" (ngSubmit)="savePw()">
          <h2 style="margin-bottom:12px">Mot de passe</h2>
          <div class="stack-form">
            <label class="field"><span>Mot de passe actuel</span>
              <span class="pw-row"><input name="cur" [type]="show() ? 'text' : 'password'" [(ngModel)]="cur" autocomplete="current-password" style="width:100%" /></span></label>
            <label class="field"><span>Nouveau mot de passe</span>
              <span class="pw-row"><input name="new" [type]="show() ? 'text' : 'password'" [(ngModel)]="next" autocomplete="new-password" style="width:100%" />
                <button type="button" class="link tiny" (click)="show.set(!show())">{{ show() ? 'Masquer' : 'Afficher' }}</button></span>
              <span class="meter" [class.m2]="strength() === 2" [class.m3]="strength() >= 3"><i [class.on]="strength() >= 1"></i><i [class.on]="strength() >= 2"></i><i [class.on]="strength() >= 3"></i></span>
              <span class="tiny muted">{{ strengthText() }}</span>
            </label>
            <label class="field"><span>Confirmer le nouveau mot de passe</span><input name="cf" [type]="show() ? 'text' : 'password'" [(ngModel)]="again" autocomplete="new-password" /></label>
            @if (pwError()) { <div class="banner bad" role="alert">{{ pwError() }}</div> }
            <div><button class="btn primary" type="submit" [disabled]="!cur || !next || !again">Changer le mot de passe</button></div>
          </div>
        </form>
      </div>
    </div>
    }
  </div>`,
})
export class ProfilPage {
  readonly s = inject(Store);
  readonly roleLabel = ROLE_LABEL;
  readonly langs = LANGS;
  readonly me = this.s.me;

  staff = () => { const r = this.s.me()?.role; return !!r && r !== 'parent' && r !== 'eleve'; };
  name = ''; phone = ''; email = ''; pref = lang();
  cur = ''; next = ''; again = '';
  readonly show = signal(false);
  readonly photoError = signal('');
  readonly infoError = signal('');
  readonly pwError = signal('');
  private readonly tick = signal(0);

  constructor() { this.reset(); }

  reset(): void {
    const u = this.s.me();
    if (!u) return;
    this.name = u.name; this.phone = u.phone; this.email = u.email ?? ''; this.pref = (u.lang as typeof this.pref) ?? lang();
    this.infoError.set('');
    this.tick.update((n) => n + 1);
  }
  infoDirty(): boolean {
    this.tick();
    const u = this.s.me();
    return !!u && (this.name.trim() !== u.name || this.phone.trim() !== u.phone || this.email.trim() !== (u.email ?? '') || this.pref !== ((u.lang as typeof this.pref) ?? lang()));
  }

  readonly extra = computed(() => {
    const u = this.s.me();
    const out: { k: string; v: string }[] = [];
    if (!u) return out;
    if (u.role === 'eleve') {
      const st = this.s.students().find((x) => x.userId === u.id);
      if (st) { out.push({ k: 'Matricule', v: st.matricule }); out.push({ k: 'Classe', v: this.s.className(st.classId) }); }
    } else if (u.role === 'parent') {
      const p = this.s.parents().find((x) => x.userId === u.id);
      const kids = this.s.students().filter((x) => p?.studentIds.includes(x.id));
      if (kids.length) out.push({ k: 'Enfants', v: kids.map((k) => `${k.prenoms} (${this.s.className(k.classId)})`).join(', ') });
    } else if (u.role === 'enseignant') {
      const t = this.s.teachers().find((x) => x.userId === u.id);
      const subs = (t?.subjectIds ?? []).map((id) => this.s.subjectById().get(id)?.name).filter(Boolean);
      if (subs.length) out.push({ k: 'Matières', v: subs.join(', ') });
    }
    return out;
  });

  async saveInfo(): Promise<void> {
    const r = await this.s.updateProfileAsync({ name: this.s.me()!.role === 'eleve' ? undefined : this.name, phone: this.phone, email: this.email, lang: this.pref });
    if (!r.ok) return void this.infoError.set(r.error ?? '');
    this.infoError.set('');
    if (this.pref !== lang()) setLang(this.pref);
    this.reset();
    this.s.toast('Vos informations ont été enregistrées.');
  }

  strength(): number {
    const p = this.next;
    if (!p) return 0;
    let n = 0;
    if (p.length >= 6) n++;
    if (p.length >= 9 && /[a-zA-Z]/.test(p) && /\d/.test(p)) n++;
    if (p.length >= 11 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) n++;
    return Math.max(n, 1);
  }
  strengthText(): string {
    const n = this.next ? this.strength() : 0;
    return n === 0 ? 'Au moins 6 caractères.' : n === 1 ? 'Mot de passe faible : ajoutez des chiffres et des lettres.' : n === 2 ? 'Mot de passe correct.' : 'Mot de passe solide.';
  }
  async savePw(): Promise<void> {
    const r = await this.s.changeOwnPasswordAsync(this.cur, this.next, this.again);
    if (!r.ok) return void this.pwError.set(r.error ?? '');
    this.pwError.set('');
    this.cur = this.next = this.again = '';
    this.s.toast('Votre mot de passe a été modifié.');
  }

  async removePhoto(): Promise<void> { const r = await this.s.setPhotoAsync(null); if (r.ok) this.s.toast('Photo retirée.', 'info'); else this.photoError.set(r.error ?? ''); }
  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.photoError.set('');
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) return void this.photoError.set('Format non pris en charge. Choisissez une image JPG, PNG ou WebP.');
    if (f.size > MAX_FILE) return void this.photoError.set('Image trop lourde (6 Mo au maximum).');
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => {
      try {
        const side = Math.min(img.width, img.height), SIZE = 256;
        const cv = document.createElement('canvas');
        cv.width = cv.height = SIZE;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
        const r = await this.s.setPhotoAsync(cv.toDataURL('image/jpeg', 0.85));
        if (!r.ok) this.photoError.set(r.error ?? ''); else this.s.toast('Photo enregistrée.');
      } catch { this.photoError.set('Impossible de lire cette image.'); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { this.photoError.set('Impossible de lire cette image.'); URL.revokeObjectURL(url); };
    img.src = url;
  }
}
