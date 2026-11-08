import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal } from '../ui';
import { ResForm, ResKind, Resource, Resources, domainOf, livePhase } from '../modules/resources';
import { toInput } from '../modules/homework';

const p2 = (n: number) => String(n).padStart(2, '0');
const when = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} à ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

@Component({
  selector: 'app-cours',
  imports: [FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Supports de cours</h1><p>{{ intro() }}</p></div>
      @if (isTeacher()) {
        <div class="row" style="flex-wrap:wrap">
          <button type="button" class="btn" (click)="openNew('direct')"><app-icon name="calendar" [size]="16" /> Programmer un cours en direct</button>
          <button type="button" class="btn primary" (click)="openNew('support')"><app-icon name="plus" [size]="16" /> Nouveau support</button>
        </div>
      }</div>

    <div class="banner info"><app-icon name="globe" [size]="18" /> Les liens ouvrent des sites extérieurs à l’école (YouTube, Google Drive, Meet, Zoom…). Vérifiez le nom du site affiché avant de cliquer.</div>

    @if (classes().length > 1) {
      <div class="chips" role="group" aria-label="Filtrer par classe">
        <button type="button" class="chip" [class.on]="!cls()" [attr.aria-pressed]="!cls()" (click)="cls.set('')">Toutes les classes</button>
        @for (c of classes(); track c.id) { <button type="button" class="chip" [class.on]="cls() === c.id" [attr.aria-pressed]="cls() === c.id" (click)="cls.set(c.id)">{{ c.name }}</button> }
      </div>
    }

    <div class="card">
      <div class="card-head"><h2>Cours en direct</h2></div>
      <div class="card-body stack">
        @for (r of lives(); track r.id) {
          <div class="item-row">
            <div class="grow">
              <b>{{ r.title }}</b>
              <div class="small muted">{{ r.subjectName }} · {{ s.className(r.classId) }} · {{ when(r.startsAt) }} → {{ when(r.endsAt) }}</div>
              @if (r.description) { <div class="small">{{ r.description }}</div> }
            </div>
            @if (phase(r) === 'en_cours') { <span class="pill ok">En cours</span> }
            @else { <span class="pill">À venir</span> }
            <div class="row" style="flex-wrap:wrap">
              @for (l of r.links; track l.url) { <a class="btn primary" [href]="l.url" target="_blank" rel="noopener noreferrer"><app-icon name="globe" [size]="16" /> <span>Rejoindre</span> @if (l.label) { <span>{{ l.label }}</span> } <span class="tiny">({{ dom(l.url) }})</span></a> }
              @if (r.linksHidden && isStudent()) { <span class="small muted">Le lien apparaîtra 15 minutes avant le début.</span> }
              @if (isTeacher()) { <button type="button" class="btn ghost sm" (click)="openEdit(r)">Modifier</button><button type="button" class="btn ghost sm danger" (click)="askDelete.set(r)">Supprimer</button> }
            </div>
          </div>
        } @empty { <div class="empty">{{ res.loaded() ? 'Aucun cours en direct programmé.' : 'Chargement…' }}</div> }
      </div>
    </div>

    @for (g of groups(); track g.name) {
      <div class="card">
        <div class="card-head"><h2>{{ g.name }}</h2></div>
        <div class="card-body stack">
          @for (r of g.items; track r.id) {
            <div class="item-row">
              <div class="grow">
                <b>{{ r.title }}</b>
                <div class="small muted">{{ s.className(r.classId) }} · {{ r.teacherName }} · {{ when(r.createdAt) }}</div>
                @if (r.description) { <div class="small">{{ r.description }}</div> }
              </div>
              <div class="row" style="flex-wrap:wrap">
                @for (l of r.links; track l.url) { <a class="btn" [href]="l.url" target="_blank" rel="noopener noreferrer"><app-icon name="globe" [size]="16" /> {{ l.label || 'Ouvrir le lien' }} <span class="tiny muted">({{ dom(l.url) }})</span></a> }
                @if (r.hasFile) { <button type="button" class="btn" (click)="res.download(r)"><app-icon name="download" [size]="16" /> {{ r.fileName }}</button> }
                @if (isTeacher()) { <button type="button" class="btn ghost sm" (click)="openEdit(r)">Modifier</button><button type="button" class="btn ghost sm danger" (click)="askDelete.set(r)">Supprimer</button> }
              </div>
            </div>
          }
        </div>
      </div>
    } @empty {
      <div class="card"><div class="empty">{{ res.loaded() ? 'Aucun support de cours pour le moment.' : 'Chargement…' }}</div></div>
    }
  </div>

  @if (form(); as f) {
    <app-modal [title]="(editingId() ? 'Modifier' : f.kind === 'direct' ? 'Programmer un cours en direct' : 'Nouveau support de cours')" size="wide" (closed)="form.set(null)">
      <div class="stack">
        <div class="form-grid">
          <label class="field"><span>Classe</span><select [ngModel]="f.classId" (ngModelChange)="setForm({ classId: $event })" name="rc" [disabled]="!!editingId()">@for (c of s.scopeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
          <label class="field"><span>Matière</span><select [ngModel]="f.subjectId" (ngModelChange)="setForm({ subjectId: $event })" name="rs" [disabled]="!!editingId()">@for (m of mySubjects(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }</select></label>
        </div>
        <label class="field"><span>Titre</span><input [ngModel]="f.title" (ngModelChange)="setForm({ title: $event })" name="rt" maxlength="120" />
          @if (touched() && f.title.trim().length < 3) { <span class="err">Donnez un titre</span> }</label>
        <label class="field"><span>Description (facultatif)</span><textarea rows="3" [ngModel]="f.description" (ngModelChange)="setForm({ description: $event })" name="rd" maxlength="1000"></textarea></label>
        @if (f.kind === 'direct') {
          <div class="form-grid">
            <label class="field"><span>Début</span><input type="datetime-local" [ngModel]="f.startsAt" (ngModelChange)="setForm({ startsAt: $event })" name="rb" /></label>
            <label class="field"><span>Fin</span><input type="datetime-local" [ngModel]="f.endsAt" (ngModelChange)="setForm({ endsAt: $event })" name="re" />
              @if (touched() && (!f.startsAt || !f.endsAt || f.endsAt <= f.startsAt)) { <span class="err">La fin doit suivre le début</span> }</label>
          </div>
          <span class="tiny muted">Le lien n’est montré aux élèves de cette classe que 15 minutes avant le début, jusqu’à la fin. Les parents ne le voient pas.</span>
        }
        <div class="stack tight">
          <span class="label">{{ f.kind === 'direct' ? 'Lien de la salle (Meet, Zoom, Teams, WhatsApp)' : 'Liens (5 au plus, adresses en https)' }}</span>
          @for (l of f.links; track $index; let i = $index) {
            <div class="choice-row">
              <input class="inline-input grow" [ngModel]="l.url" (ngModelChange)="setLink(i, { url: $event })" [name]="'lu' + i" placeholder="https://…" [attr.aria-label]="'Adresse du lien ' + (i + 1)" />
              <input class="inline-input" [ngModel]="l.label" (ngModelChange)="setLink(i, { label: $event })" [name]="'ll' + i" placeholder="Nom (facultatif)" maxlength="80" [attr.aria-label]="'Nom du lien ' + (i + 1)" />
              @if (f.links.length > 1) { <button type="button" class="btn ghost sm" (click)="delLink(i)" aria-label="Retirer le lien"><app-icon name="x" [size]="14" /></button> }
            </div>
          }
          @if (f.links.length < (f.kind === 'direct' ? 1 : 5)) { <button type="button" class="btn ghost sm" (click)="addLink()"><app-icon name="plus" [size]="14" /> Ajouter un lien</button> }
        </div>
        @if (f.kind === 'support' && !editingId()) {
          <label class="field"><span>Fichier (PDF, image, Word… 5 Mo au plus, facultatif si vous mettez un lien)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.odt,.txt" (change)="onFile($event)" /></label>
        }
        @if (f.kind === 'support' && editingId(); as id) {
          @if (current(id); as cur) {
            <div class="row" style="flex-wrap:wrap">
              <label class="btn">{{ cur.hasFile ? 'Remplacer le fichier' : 'Joindre un fichier' }}<input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.odt,.txt" (change)="onReplace($event, id)" /></label>
              @if (cur.hasFile) { <span class="small">{{ cur.fileName }}</span><button type="button" class="btn ghost sm" (click)="detach(id)">Retirer le fichier</button> }
            </div>
          }
        }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="form.set(null)">Annuler</button><button type="button" class="btn primary" [disabled]="busy()" (click)="save()">{{ editingId() ? 'Enregistrer' : 'Publier à la classe' }}</button></div>
    </app-modal>
  }

  @if (askDelete(); as d) {
    <app-modal title="Supprimer ce support" (closed)="askDelete.set(null)">
      <p>Supprimer « {{ d.title }} » ?</p><p class="small muted">Les élèves ne le verront plus.</p>
      <div footer><button type="button" class="btn ghost" (click)="askDelete.set(null)">Annuler</button><button type="button" class="btn danger" [disabled]="busy()" (click)="remove(d)">Supprimer</button></div>
    </app-modal>
  }
  `,
})
export class CoursPage implements OnDestroy {
  readonly s = inject(Store);
  readonly res = inject(Resources);
  readonly when = when;
  readonly dom = domainOf;
  readonly now = signal(Date.now());
  private readonly timer = setInterval(() => this.now.set(Date.now()), 30000);
  readonly cls = signal('');
  readonly form = signal<ResForm | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly touched = signal(false);
  readonly busy = signal(false);
  readonly askDelete = signal<Resource | null>(null);
  private file: File | null = null;

  constructor() { if (this.s.apiMode()) void this.res.load(); }
  ngOnDestroy(): void { clearInterval(this.timer); }

  readonly isTeacher = computed(() => this.s.role() === 'enseignant');
  readonly isStudent = computed(() => this.s.role() === 'eleve');
  readonly kid = computed(() => (this.s.role() === 'parent' ? this.s.activeChild() : null));
  readonly intro = computed(() => this.isTeacher()
    ? 'Partagez des liens et des fichiers avec vos classes, ou programmez un cours en direct.'
    : this.s.role() === 'directeur' ? 'Les supports et cours en direct publiés par les enseignants (lecture seule).' : 'Les liens et fichiers donnés par tes enseignants, et les cours en direct.');
  private readonly visible = computed(() => {
    const k = this.kid(), c = this.cls();
    return this.res.list().filter((r) => (!k || r.classId === k.classId) && (!c || r.classId === c));
  });
  readonly classes = computed(() => {
    const ids = new Set(this.res.list().map((r) => r.classId));
    return this.s.scopeClasses().filter((c) => ids.has(c.id));
  });
  phase(r: Resource): 'a_venir' | 'en_cours' | 'termine' { return livePhase(r, this.now()); }
  readonly lives = computed(() => this.visible().filter((r) => r.kind === 'direct' && this.phase(r) !== 'termine')
    .sort((a, b) => Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? '')));
  readonly groups = computed(() => {
    const m = new Map<string, Resource[]>();
    for (const r of this.visible().filter((x) => x.kind === 'support')) m.set(r.subjectName, [...(m.get(r.subjectName) ?? []), r]);
    return [...m].map(([name, items]) => ({ name, items })).sort((a, b) => a.name.localeCompare(b.name));
  });
  readonly mySubjects = computed(() => {
    const f = this.form();
    const ids = new Set(this.s.myAssignments().filter((a) => !f || a.classId === f.classId).map((a) => a.subjectId));
    return this.s.subjects().filter((x) => ids.has(x.id));
  });
  current(id: string): Resource | undefined { return this.res.list().find((r) => r.id === id); }

  openNew(kind: ResKind): void {
    const a = this.s.myAssignments()[0];
    if (!a) { this.s.toast('Aucune classe ne vous est affectée : demandez à la direction de vous en confier.', 'err'); return; }
    const st = new Date(); st.setDate(st.getDate() + 1); st.setHours(10, 0, 0, 0);
    const en = new Date(st.getTime() + 3600000);
    this.file = null; this.editingId.set(null); this.touched.set(false);
    this.form.set({ classId: a.classId, subjectId: a.subjectId, kind, title: '', description: '', links: [{ url: '', label: '' }],
      startsAt: kind === 'direct' ? toInput(st.toISOString()) : '', endsAt: kind === 'direct' ? toInput(en.toISOString()) : '' });
  }
  openEdit(r: Resource): void {
    this.file = null; this.editingId.set(r.id); this.touched.set(false);
    this.form.set({ classId: r.classId, subjectId: r.subjectId, kind: r.kind, title: r.title, description: r.description,
      links: r.links.length ? r.links.map((l) => ({ ...l })) : [{ url: '', label: '' }], startsAt: r.startsAt ? toInput(r.startsAt) : '', endsAt: r.endsAt ? toInput(r.endsAt) : '' });
  }
  setForm(p: Partial<ResForm>): void {
    const f = this.form();
    if (!f) return;
    const next = { ...f, ...p };
    if (p.classId && p.classId !== f.classId) next.subjectId = this.s.myAssignments().find((a) => a.classId === p.classId)?.subjectId ?? '';
    this.form.set(next);
  }
  setLink(i: number, p: Partial<{ url: string; label: string }>): void {
    const f = this.form();
    if (f) this.form.set({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  }
  addLink(): void { const f = this.form(); if (f) this.form.set({ ...f, links: [...f.links, { url: '', label: '' }] }); }
  delLink(i: number): void { const f = this.form(); if (f) this.form.set({ ...f, links: f.links.filter((_, j) => j !== i) }); }
  onFile(e: Event): void { this.file = (e.target as HTMLInputElement).files?.[0] ?? null; }

  async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.touched.set(true);
    const hasLink = f.links.some((l) => l.url.trim());
    if (f.title.trim().length < 3 || !f.subjectId) return;
    if (f.kind === 'direct' && (!f.startsAt || !f.endsAt || f.endsAt <= f.startsAt)) return;
    if (f.kind === 'direct' && !hasLink) { this.s.toast('Collez le lien de la salle (Meet, Zoom, Teams…).', 'err'); return; }
    if (f.kind === 'support' && !hasLink && !this.file && !this.editingId()) { this.s.toast('Ajoutez au moins un lien ou un fichier.', 'err'); return; }
    this.busy.set(true);
    const id = this.editingId();
    const r = id ? await this.res.update(id, f) : await this.res.create(f, this.file);
    this.busy.set(false);
    if (r.error) { this.s.toast(r.error, 'err'); if (!r.res) return; }
    if (!r.error) { this.form.set(null); this.s.toast(id ? 'Modifié.' : 'Publié : les élèves et leurs parents sont prévenus.'); }
  }
  async onReplace(e: Event, id: string): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.busy.set(true);
    const err = await this.res.attach(id, file);
    this.busy.set(false);
    this.s.toast(err ?? 'Fichier enregistré.', err ? 'err' : undefined);
  }
  async detach(id: string): Promise<void> {
    const err = await this.res.detach(id);
    this.s.toast(err ?? 'Fichier retiré.', err ? 'err' : undefined);
  }
  async remove(r: Resource): Promise<void> {
    this.busy.set(true);
    const err = await this.res.remove(r.id);
    this.busy.set(false);
    this.askDelete.set(null);
    this.s.toast(err ?? 'Supprimé.', err ? 'err' : undefined);
  }
}
