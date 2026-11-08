import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal, FitHeight } from '../ui';
import { RoleForm, RoleRow, Roles, groupCatalog } from '../modules/roles';
import { pagesOpenedBy } from '../nav-perms';

@Component({
  selector: 'app-roles',
  imports: [FitHeight, FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Rôles et accès</h1><p>Choisissez ce que chaque rôle de l’école peut faire. Les changements s’appliquent dès la prochaine action des personnes concernées.</p></div>
      <button type="button" class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Nouveau rôle</button></div>

    <div class="banner info"><app-icon name="shield" [size]="18" /> Les rôles <b>Parent</b> et <b>Élève</b> ne changent pas : ils protègent les données des enfants. Vous ne pouvez accorder que des droits que vous possédez vous-même{{ s.role() === 'fondateur' ? ' (en tant que fondateur, vous pouvez tous les accorder)' : '' }}. Chaque changement est écrit dans le journal.</div>

    <div class="card" appFitHeight><div class="table-wrap"><table class="table hover">
      <thead><tr><th>Rôle</th><th>Origine</th><th class="num">Comptes</th><th class="num">Droits</th><th></th></tr></thead><tbody>
        @for (r of rs.roles(); track r.id) {
          <tr>
            <td class="cell-main">{{ r.label }}@if (r.locked) { <span class="pill">Verrouillé</span> }</td>
            <td><span class="pill" [class.brand]="!r.builtin">{{ r.builtin ? 'Par défaut' : 'Créé par l’école' }}</span>
              <div class="tiny muted">{{ r.base === 'enseignant' ? 'Ses classes d’enseignement' : r.base === 'educateur' ? 'Les classes confiées par la direction' : r.locked ? 'Sa famille ou lui-même' : 'Toute l’école, selon ses droits' }}</div></td>
            <td class="num">{{ r.members }}</td>
            <td class="num">{{ r.perms.length }}</td>
            <td class="right nowrap">
              <button type="button" class="btn sm" (click)="openEdit(r)">{{ r.locked ? 'Voir' : 'Modifier' }}</button>
              @if (!r.locked && r.base !== 'fondateur') { <button type="button" class="btn sm ghost danger" [disabled]="r.members > 0" [attr.title]="r.members ? 'Des comptes ont ce rôle' : null" (click)="askDelete.set(r)">Supprimer</button> }
            </td>
          </tr>
        } @empty { <tr><td colspan="5" class="empty">{{ rs.loaded() ? 'Aucun rôle.' : 'Chargement…' }}</td></tr> }
      </tbody></table></div></div>
  </div>

  @if (form(); as f) {
    <app-modal [title]="editing() ? (editing()!.locked ? 'Droits du rôle ' + editing()!.label : 'Modifier le rôle') : 'Nouveau rôle'" size="wide" (closed)="form.set(null)">
      <div class="stack">
        @if (editing()?.locked) { <div class="banner info"><app-icon name="lock" [size]="18" /> Les droits des parents et des élèves ne changent pas.</div> }
        @if (!editing()) {
          <label class="field"><span>Partir d’un modèle (facultatif)</span><select [ngModel]="tpl()" (ngModelChange)="useTemplate($event)" name="rt">
            <option value="">Aucun : je choisis les droits</option>@for (t of rs.templates(); track t.label) { <option [value]="t.label">{{ t.label }}</option> }</select></label>
        }
        <div class="form-grid">
          <label class="field"><span>Nom du rôle</span><input [ngModel]="f.label" (ngModelChange)="set({ label: $event })" name="rn" maxlength="60" [disabled]="!!editing()?.locked" />
            @if (touched() && f.label.trim().length < 2) { <span class="err">Donnez un nom au rôle</span> }</label>
          @if (!editing()) {
            <label class="field"><span>Ce que la personne voit</span><select [ngModel]="f.scope" (ngModelChange)="set({ scope: $event })" name="rs">
              <option value="personnel">Toute l’école, selon les droits cochés</option><option value="enseignant">Seulement ses classes d’enseignement (comme un enseignant)</option><option value="educateur">Seulement les classes confiées par la direction (comme un éducateur)</option></select></label>
          }
        </div>
        @for (g of groups(); track g.group) {
          <fieldset class="qedit" [disabled]="!!editing()?.locked">
            <legend>{{ g.group }}</legend>
            @for (it of g.items; track it.perm) {
              <label class="row" [class.muted]="!can(it.perm)"><input type="checkbox" [checked]="f.perms.includes(it.perm)" [disabled]="!can(it.perm) && !f.perms.includes(it.perm) || !can(it.perm) && !!editing()" (change)="toggle(it.perm)" /> <span>{{ it.label }}@if (opens(it.perm); as o) { <span class="tiny muted"> · <span>ouvre :</span> {{ o }}</span> }</span></label>
            }
          </fieldset>
        }
        <span class="tiny muted">Les droits grisés sont ceux que vous ne possédez pas : vous ne pouvez ni les accorder ni les retirer.</span>
      </div>
      <div footer><button type="button" class="btn ghost" (click)="form.set(null)">{{ editing()?.locked ? 'Fermer' : 'Annuler' }}</button>
        @if (!editing()?.locked) { <button type="button" class="btn primary" [disabled]="busy()" (click)="save()">{{ editing() ? 'Enregistrer' : 'Créer le rôle' }}</button> }</div>
    </app-modal>
  }

  @if (askDelete(); as d) {
    <app-modal title="Supprimer ce rôle" (closed)="askDelete.set(null)">
      <p>Supprimer le rôle « {{ d.label }} » ? Il ne pourra plus être donné à un compte.</p>
      <div footer><button type="button" class="btn ghost" (click)="askDelete.set(null)">Annuler</button><button type="button" class="btn danger" [disabled]="busy()" (click)="remove(d)">Supprimer</button></div>
    </app-modal>
  }
  `,
})
export class RolesPage {
  readonly s = inject(Store);
  readonly rs = inject(Roles);
  readonly form = signal<RoleForm | null>(null);
  readonly editing = signal<RoleRow | null>(null);
  readonly touched = signal(false);
  readonly busy = signal(false);
  readonly askDelete = signal<RoleRow | null>(null);
  readonly tpl = signal('');
  readonly groups = computed(() => groupCatalog(this.rs.catalog()));

  constructor() { void this.rs.load(); }

  opens(perm: string): string { return pagesOpenedBy(perm).join(', '); }
  can(perm: string): boolean { return this.rs.grantable().includes(perm); }
  openNew(): void { this.editing.set(null); this.touched.set(false); this.tpl.set(''); this.form.set({ label: '', scope: 'personnel', perms: [] }); }
  openEdit(r: RoleRow): void { this.editing.set(r); this.touched.set(false); this.form.set({ label: r.label, scope: r.base === 'enseignant' || r.base === 'educateur' ? r.base : 'personnel', perms: [...r.perms] }); }
  set(p: Partial<RoleForm>): void { const f = this.form(); if (f) this.form.set({ ...f, ...p }); }
  toggle(perm: string): void {
    const f = this.form();
    if (!f) return;
    this.set({ perms: f.perms.includes(perm) ? f.perms.filter((x) => x !== perm) : [...f.perms, perm] });
  }
  useTemplate(label: string): void {
    this.tpl.set(label);
    const t = this.rs.templates().find((x) => x.label === label);
    const f = this.form();
    if (t && f) this.form.set({ label: t.label, scope: t.scope, perms: t.perms.filter((p) => this.can(p)) });
  }
  async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.touched.set(true);
    if (f.label.trim().length < 2) return;
    this.busy.set(true);
    const e = this.editing();
    const err = e ? await this.rs.update(e.id, { label: f.label, perms: f.perms }) : await this.rs.create(f);
    this.busy.set(false);
    if (err) { this.s.toast(err, 'err'); return; }
    this.form.set(null);
    this.s.toast(e ? 'Rôle enregistré.' : 'Rôle créé. Vous pouvez maintenant le donner à un compte.');
  }
  async remove(r: RoleRow): Promise<void> {
    this.busy.set(true);
    const err = await this.rs.remove(r.id);
    this.busy.set(false);
    this.askDelete.set(null);
    this.s.toast(err ?? 'Rôle supprimé.', err ? 'err' : undefined);
  }
}
