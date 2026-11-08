import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal } from '../ui';
import { Level, Serie } from '../models';

interface SerieForm { id?: string; level: string; code: string; name: string; copyFrom: string; }
interface LevelForm { id?: string; name: string; cycle: 'college' | 'lycee'; hasSeries: boolean; after: string; classes: number; }

/** Niveaux de l'école (ordre du cursus, cycle, séries) et séries de chaque niveau : ajouter, modifier, réordonner, retirer.
 * Chaque niveau sans séries, et chaque série, a ses propres coefficients. */
@Component({
  selector: 'app-series-card',
  imports: [FormsModule, Modal, Icon],
  template: `
  <div class="card pad stack"><div class="row" style="justify-content:space-between"><h2>Niveaux et séries</h2>
    @if (edit()) { <button class="btn sm primary" (click)="openLevel(null)"><app-icon name="plus" [size]="14" /> Ajouter un niveau</button> }</div>
    <p class="small muted" style="margin:0">Les niveaux de votre école, dans l’ordre du cursus : le passage mène au niveau suivant, le dernier au diplôme. Un niveau « à séries » (2nde, 10e…) demande une série à chaque classe. Chaque niveau sans séries, et chaque série, a ses propres coefficients.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Ordre</th><th>Niveau</th><th>Cycle</th><th>Séries</th>@if (edit()) { <th></th> }</tr></thead><tbody>
      @for (l of s.levelsView(); track l.id; let i = $index, last = $last) {
        <tr><td class="nowrap">@if (edit()) { <button class="btn sm ghost" [disabled]="i === 0" (click)="move(i, -1)" [attr.aria-label]="'Monter ' + l.name">↑</button><button class="btn sm ghost" [disabled]="last" (click)="move(i, 1)" [attr.aria-label]="'Descendre ' + l.name">↓</button> } @else { {{ i + 1 }} }</td>
          <td class="cell-main">{{ l.name }}<div class="tiny muted">{{ l.classes }} classe{{ l.classes > 1 ? 's' : '' }}@if (last) { · fin de cursus }</div></td>
          <td>{{ l.cycle === 'college' ? 'Collège' : 'Lycée' }}</td>
          <td>@if (!l.hasSeries) { <span class="tiny muted">Sans séries</span> } @else { <div class="row-gap" style="flex-wrap:wrap">
            @for (sr of byLevel().get(l.name) ?? []; track sr.id) {
              <span class="serie-tag" [title]="sr.classes.length ? 'Classes : ' + sr.classes.join(', ') : 'Aucune classe'">
                <b>{{ sr.code }}</b>@if (sr.name) { <span class="muted"> · {{ sr.name }}</span> }
                <span class="tiny muted"> ({{ sr.classes.length }} classe{{ sr.classes.length > 1 ? 's' : '' }})</span>
                @if (edit()) { <button class="link tiny" (click)="openEdit(sr)">Modifier</button>
                  @if (!sr.classes.length) { <button class="link tiny danger" title="Retirer la série" (click)="askRemove.set(sr)">Retirer</button> } }
              </span>
            } @empty { <span class="tiny muted">Aucune série</span> }
            @if (edit()) { <button class="btn sm ghost" (click)="openAdd(l.name)">+ série</button> }
          </div> }</td>
          @if (edit()) { <td class="right nowrap"><button class="btn sm" (click)="openLevel(l)">Modifier</button>
            @if (!l.classes) { <button class="btn sm danger" (click)="askRemoveLevel.set(l)">Retirer</button> }</td> }</tr>
      }
    </tbody></table></div>
    <p class="tiny muted" style="margin:0">Passage : {{ s.levelNames().join(' → ') }} → diplôme.</p>
  </div>

  @if (lform(); as f) {
    <app-modal [title]="f.id ? 'Modifier le niveau ' + lorig : 'Nouveau niveau'" (closed)="lform.set(null)">
      <div class="form-grid">
        <label class="field"><span>Nom</span><input [(ngModel)]="f.name" name="ln" maxlength="10" placeholder="7e, 9e année, 10e…" [disabled]="f.classes > 0" />
          @if (f.classes > 0) { <span class="tiny muted">Ce niveau a des classes : seul son cycle peut changer.</span> }</label>
        <label class="field"><span>Cycle</span><select [(ngModel)]="f.cycle" name="lc"><option value="college">Collège</option><option value="lycee">Lycée</option></select></label>
        @if (!f.id) { <label class="field"><span>Place dans le cursus</span><select [(ngModel)]="f.after" name="la"><option value="">À la fin</option>@for (n of s.levelNames(); track n) { <option [value]="n">Après {{ n }}</option> }</select></label> }
        <label class="field" style="grid-column:1/-1"><span><input type="checkbox" [(ngModel)]="f.hasSeries" name="ls" [disabled]="f.classes > 0" /> Niveau à séries (chaque classe a une série : A, C, D, TSE…)</span></label>
      </div>
      @if (err()) { <div class="banner bad" style="margin-top:10px">{{ err() }}</div> }
      <div footer><button class="btn ghost" (click)="lform.set(null)">Annuler</button><button class="btn primary" [disabled]="busy()" (click)="saveLevel(f)">{{ f.id ? 'Enregistrer' : 'Ajouter' }}</button></div>
    </app-modal>
  }
  @if (askRemoveLevel(); as l) {
    <app-modal [title]="'Retirer le niveau ' + l.name" (closed)="askRemoveLevel.set(null)">
      <p>Le niveau <b>{{ l.name }}</b>, ses séries et ses coefficients seront retirés. Il n’a aucune classe.</p>
      @if (err()) { <div class="banner bad">{{ err() }}</div> }
      <div footer><button class="btn ghost" (click)="askRemoveLevel.set(null)">Annuler</button><button class="btn danger" [disabled]="busy()" (click)="removeLevel(l)">Retirer</button></div>
    </app-modal>
  }

  @if (form(); as f) {
    <app-modal [title]="f.id ? 'Modifier la série ' + f.level + ' ' + orig : 'Nouvelle série'" (closed)="form.set(null)">
      <div class="form-grid">
        <label class="field"><span>Niveau</span><select [(ngModel)]="f.level" name="lv" [disabled]="!!f.id">@for (lv of levels(); track lv) { <option [value]="lv">{{ lv }}</option> }</select></label>
        <label class="field"><span>Code</span><input [(ngModel)]="f.code" name="cd" maxlength="10" placeholder="A1, E, G2, TSExp…" style="text-transform:uppercase" [disabled]="locked()" />
          @if (locked()) { <span class="tiny muted">Utilisée par {{ usedBy() }} : seul le nom peut changer.</span> }</label>
        <label class="field" style="grid-column:1/-1"><span>Nom (facultatif)</span><input [(ngModel)]="f.name" name="nm" maxlength="40" placeholder="Littéraire, Mathématiques…" /></label>
        @if (!f.id) {
          <label class="field" style="grid-column:1/-1"><span>Coefficients de départ</span><select [(ngModel)]="f.copyFrom" name="cp">
            <option value="">Aucun : je les saisis moi-même</option>
            @for (g of s.groupes(); track g) { <option [value]="g">Copier ceux de {{ g }}</option> }</select></label>
        }
      </div>
      @if (err()) { <div class="banner bad" style="margin-top:10px">{{ err() }}</div> }
      <div footer><button class="btn ghost" (click)="form.set(null)">Annuler</button><button class="btn primary" [disabled]="busy()" (click)="save()">{{ f.id ? 'Enregistrer' : 'Ajouter' }}</button></div>
    </app-modal>
  }
  @if (askRemove(); as sr) {
    <app-modal [title]="'Retirer la série ' + sr.groupe" (closed)="askRemove.set(null)">
      <p>La série <b>{{ sr.groupe }}</b> et ses coefficients seront retirés. Aucune classe ne l’utilise.</p>
      @if (err()) { <div class="banner bad">{{ err() }}</div> }
      <div footer><button class="btn ghost" (click)="askRemove.set(null)">Annuler</button><button class="btn danger" [disabled]="busy()" (click)="remove(sr)">Retirer</button></div>
    </app-modal>
  }
  `,
  styles: `:host { display: block; margin-top: 16px; }
    .serie-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2, transparent); }
    .serie-tag .link { padding: 0; }`,
})
export class SeriesCard {
  readonly s = inject(Store);
  /** Niveaux à séries. */
  readonly levels = computed(() => this.s.levels().filter((l) => l.hasSeries).map((l) => l.name));
  readonly form = signal<SerieForm | null>(null);
  readonly askRemove = signal<Serie | null>(null);
  readonly lform = signal<LevelForm | null>(null);
  readonly askRemoveLevel = signal<Level | null>(null);
  readonly err = signal('');
  readonly busy = signal(false);
  orig = '';
  lorig = '';
  edit = () => this.s.can('settings') || this.s.can('classes.write');
  byLevel = computed(() => {
    const m = new Map<string, Serie[]>();
    for (const sr of this.s.seriesView()) m.set(sr.level, [...(m.get(sr.level) ?? []), sr]);
    return m;
  });
  private current = () => { const f = this.form(); return f?.id ? this.s.seriesView().find((x) => x.id === f.id) : undefined; };
  locked = () => (this.current()?.classes.length ?? 0) > 0;
  usedBy = () => this.current()?.classes.join(', ') ?? '';

  // --- Niveaux ---
  openLevel(l: Level | null): void {
    this.err.set(''); this.lorig = l?.name ?? '';
    this.lform.set(l ? { id: l.id, name: l.name, cycle: l.cycle, hasSeries: l.hasSeries, after: '', classes: l.classes } : { name: '', cycle: 'college', hasSeries: false, after: '', classes: 0 });
  }
  async saveLevel(f: LevelForm): Promise<void> {
    this.busy.set(true);
    const r = f.id ? await this.s.updateLevelAsync(f.id, f) : await this.s.addLevelAsync(f);
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Enregistrement impossible.');
    this.lform.set(null);
    this.s.toast(f.id ? 'Niveau modifié.' : `Niveau ${f.name.trim()} ajouté.` + (f.hasSeries ? ' Ajoutez ses séries.' : ' Fixez ses coefficients dans Matières et coefficients.'));
  }
  async removeLevel(l: Level): Promise<void> {
    this.busy.set(true);
    const r = await this.s.removeLevelAsync(l.id);
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Retrait impossible.');
    this.askRemoveLevel.set(null); this.s.toast(`Niveau ${l.name} retiré.`);
  }
  async move(i: number, d: number): Promise<void> {
    const n = [...this.s.levelNames()];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    const r = await this.s.reorderLevelsAsync(n);
    if (!r.ok) this.s.toast(r.error ?? 'Ordre non enregistré.', 'err');
  }

  // --- Séries ---
  openAdd(level: string): void { this.err.set(''); this.orig = ''; this.form.set({ level: level || this.levels()[0] || '', code: '', name: '', copyFrom: '' }); }
  openEdit(sr: Serie): void { this.err.set(''); this.orig = sr.code; this.form.set({ id: sr.id, level: sr.level, code: sr.code, name: sr.name, copyFrom: '' }); }
  async save(): Promise<void> {
    const f = this.form(); if (!f) return;
    this.busy.set(true);
    const r = f.id ? await this.s.updateSerieAsync(f.id, { code: f.code, name: f.name }) : await this.s.addSerieAsync(f.level, f.code, f.name, f.copyFrom);
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Enregistrement impossible.');
    this.form.set(null);
    this.s.toast(f.id ? 'Série modifiée.' : `Série ${f.level} ${f.code.trim().toUpperCase()} ajoutée.` + (f.copyFrom ? '' : ' Fixez ses coefficients dans Matières et coefficients.'));
  }
  async remove(sr: Serie): Promise<void> {
    this.busy.set(true);
    const r = await this.s.removeSerieAsync(sr.id);
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Retrait impossible.');
    this.askRemove.set(null); this.s.toast(`Série ${sr.groupe} retirée.`);
  }
}
