import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal, FitHeight } from '../ui';
import { Planning } from '../modules/planning';
import { ROOM_KIND_LABEL, RoomKind, Room } from '../api-map';

interface RoomForm { id: string | null; name: string; capacity: number; kind: RoomKind; }

/** Salles de l'école, et salle principale de chaque classe. Sert à l'emploi du temps : salle libre à chaque créneau, avertissement si trop petite. */
@Component({
  selector: 'app-salles',
  imports: [FitHeight, FormsModule, Icon, Modal],
  template: `
  <div class="card pad stack" appFitHeight><h2>Salles</h2>
    <p class="small muted">Les salles de l’école. Chaque classe a sa salle principale ; le laboratoire, la salle informatique et le terrain se réservent par créneau dans l’emploi du temps.</p>
    @if (p.rooms().length) {
      <div class="table-wrap"><table class="table"><thead><tr><th>Salle</th><th>Type</th><th class="num">Places</th><th>Classe</th><th></th></tr></thead><tbody>
        @for (r of p.rooms(); track r.id) {
          <tr><td class="cell-main">{{ r.name }}</td><td>{{ kinds[r.kind] }}</td><td class="num">{{ r.capacity }}</td><td>{{ r.classes.join(', ') || '—' }}</td>
            <td class="nowrap"><button type="button" class="btn sm" (click)="edit(r)">Modifier</button> <button type="button" class="btn sm danger" (click)="remove(r)" [attr.aria-label]="'Supprimer ' + r.name">Supprimer</button></td></tr>
        }</tbody></table></div>
    } @else { <div class="empty">Aucune salle enregistrée : l’emploi du temps utilise « Salle 1, Salle 2… » par défaut.</div> }
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button type="button" class="btn primary" (click)="add()"><app-icon name="plus" [size]="16" /> Ajouter une salle</button>
      <button type="button" class="btn" [disabled]="!hasClassRooms()" (click)="auto(false)">Placer les classes dans les salles</button>
      <button type="button" class="btn ghost" [disabled]="!hasClassRooms()" (click)="auto(true)">Refaire toute la répartition</button>
    </div>
    @if (info()) { <div class="banner info" role="status"><app-icon name="check" [size]="18" /> {{ info() }}</div> }
    @if (p.rooms().length) {
      <b>Salle principale de chaque classe</b>
      <div class="class-rooms">
        @for (c of s.classes(); track c.id) {
          <label class="field"><span>{{ c.name }}</span>
            <select [ngModel]="c.roomId || ''" (ngModelChange)="setRoom(c.id, $event)" [attr.aria-label]="'Salle de ' + c.name">
              <option value="">Aucune</option>
              @for (r of classRooms(); track r.id) { <option [value]="r.id" [disabled]="r.classes.length > 0 && r.id !== c.roomId">{{ r.name }} ({{ r.capacity }} places){{ r.classes.length && r.id !== c.roomId ? ' — prise' : '' }}</option> }
            </select></label>
        }
      </div>
    }
  </div>

  @if (form(); as f) {
    <app-modal [title]="f.id ? 'Modifier la salle' : 'Nouvelle salle'" (closed)="form.set(null)">
      <div class="stack">
        <label class="field"><span>Nom</span><input [ngModel]="f.name" (ngModelChange)="f.name = $event" name="rn" placeholder="Salle 12, Laboratoire de SVT…" /></label>
        <label class="field"><span>Type</span><select [ngModel]="f.kind" (ngModelChange)="f.kind = $event" name="rk">@for (k of kindList; track k) { <option [value]="k">{{ kinds[k] }}</option> }</select></label>
        <label class="field" style="max-width:200px"><span>Nombre de places</span><input type="number" min="1" max="500" [ngModel]="f.capacity" (ngModelChange)="f.capacity = $event" name="rc" /></label>
        @if (err()) { <div class="banner bad" role="alert">{{ err() }}</div> }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="form.set(null)">Annuler</button><button type="button" class="btn primary" (click)="save()">Enregistrer</button></div>
    </app-modal>
  }
  @if (deleting(); as d) {
    <app-modal title="Supprimer la salle" (closed)="deleting.set(null)">
      <p>{{ d.room.name }}</p>
      @if (d.cours) { <div class="banner warn"><app-icon name="alert" [size]="18" /> {{ d.cours }} cours sont placés dans cette salle. Ils garderont son nom dans l’emploi du temps.</div> }
      <div footer><button type="button" class="btn ghost" (click)="deleting.set(null)">Annuler</button><button type="button" class="btn danger" (click)="confirmDelete()">Supprimer</button></div>
    </app-modal>
  }`,
  styles: `.class-rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }`,
})
export class SallesCard {
  readonly s = inject(Store);
  readonly p = inject(Planning);
  readonly kinds = ROOM_KIND_LABEL;
  readonly kindList: RoomKind[] = ['classe', 'labo', 'info', 'sport', 'autre'];
  readonly form = signal<RoomForm | null>(null);
  readonly err = signal('');
  readonly info = signal('');
  readonly deleting = signal<{ room: Room; cours: number } | null>(null);
  readonly classRooms = computed(() => this.p.rooms().filter((r) => r.kind === 'classe'));
  readonly hasClassRooms = computed(() => this.classRooms().length > 0 && this.s.classes().length > 0);

  add(): void { this.err.set(''); this.form.set({ id: null, name: '', capacity: 45, kind: 'classe' }); }
  edit(r: Room): void { this.err.set(''); this.form.set({ id: r.id, name: r.name, capacity: r.capacity, kind: r.kind }); }
  async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    if (!f.name.trim()) { this.err.set('Donnez un nom à la salle.'); return; }
    const e = await this.p.saveRoom(f.id, { name: f.name.trim(), capacity: Number(f.capacity) || 1, kind: f.kind });
    if (e) { this.err.set(e); return; }
    this.form.set(null); this.s.toast('Salle enregistrée.');
  }
  async remove(r: Room): Promise<void> {
    const res = await this.p.removeRoom(r.id);
    if (res.ok) { this.s.toast('Salle supprimée.'); return; }
    if (res.cours) { this.deleting.set({ room: r, cours: res.cours }); return; }
    this.s.toast(res.error ?? 'Suppression impossible.', 'err');
  }
  async confirmDelete(): Promise<void> {
    const d = this.deleting();
    if (!d) return;
    const res = await this.p.removeRoom(d.room.id, true);
    this.deleting.set(null);
    this.s.toast(res.ok ? 'Salle supprimée.' : (res.error ?? 'Suppression impossible.'), res.ok ? 'info' : 'err');
  }
  async auto(reset: boolean): Promise<void> {
    const r = await this.p.autoAssign(reset);
    if (typeof r === 'string') { this.s.toast(r, 'err'); return; }
    this.info.set(`${r.assigned.length} classe(s) placée(s) dans une salle.` + (r.left.length ? ` Sans salle faute de place : ${r.left.join(', ')}.` : ''));
  }
  async setRoom(classId: string, roomId: string): Promise<void> {
    const e = await this.p.setClassRoom(classId, roomId || null);
    if (e) this.s.toast(e, 'err');
  }
}
