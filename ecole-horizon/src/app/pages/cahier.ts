import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { Icon, Modal } from '../ui';
import { dateFr, dateLong } from '../format';
import { Textbook, TextEntry } from '../modules/textbook';
import { Timetable } from '../modules/timetable';
import { Planning } from '../modules/planning';
import { Lesson, Replacement } from '../api-map';
import { addDays } from '../format';

const HUES: Record<string, number> = { fr: 20, ma: 215, an: 280, hg: 40, sv: 130, pc: 190, eps: 5, edhc: 330, ph: 255, lv2: 160, ar: 95 };

interface Form { classId: string; subjectId: string; date: string; content: string; homework: string; due: string; }

@Component({
  selector: 'app-cahier',
  imports: [FormsModule, Icon, Modal],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Cahier de textes</h1><p>{{ intro() }}</p></div>
      @if (canWrite()) { <button type="button" class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Nouvelle séance</button> }</div>

    <div class="card pad"><div class="row">
      @if (kid(); as k) {
        <div class="field"><span>Classe</span><b>{{ s.className(k.classId) }}</b></div>
      } @else {
        <label class="field"><span>Classe</span><select [ngModel]="cid()" (ngModelChange)="cidSel.set($event); subj.set('')">@for (c of classChoices(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
      }
      <div class="field grow"><span>Matière</span><div class="chips" role="group" aria-label="Filtrer par matière">
        <button type="button" class="chip" [class.on]="!subj()" (click)="subj.set('')">Toutes</button>
        @for (sb of subjects(); track sb.id) { <button type="button" class="chip" [class.on]="subj() === sb.id" (click)="subj.set(sb.id)">{{ sb.name }}</button> }</div></div>
    </div></div>

    <div class="grid kpi">
      <div class="card kpi-card"><span class="label">Séances renseignées</span><span class="value">{{ filtered().length }}</span></div>
      <div class="card kpi-card" [class.alert]="todo().length > 0"><span class="label">Devoirs à rendre</span><span class="value">{{ todo().length }}</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>À faire pour les prochains jours</h2></div>
      @if (todo().length) {
        <ul class="todo">
          @for (e of todo(); track e.id) {
            <li [style.--h]="hue(e.subjectId)">
              <div class="when"><span class="tiny muted">Pour le</span><b>{{ dateFr(e.due) }}</b>@if (e.due === s.today) { <span class="pill warn">Aujourd’hui</span> }</div>
              <div class="grow"><div class="row" style="gap:8px"><span class="pill subj">{{ subjName(e.subjectId) }}</span><span class="tiny muted">{{ e.teacherName || teacherName(e.teacherId) }}</span></div>
                <p>{{ e.homework }}</p></div>
            </li>
          }
        </ul>
      } @else { <div class="empty">Aucun travail à faire pour les prochains jours.</div> }
    </div>

    <div class="stack-lg">
      <h2>Séances de cours</h2>
      @for (g of groups(); track g.date) {
        <section class="card" [attr.aria-label]="dateLong(g.date)">
          <div class="card-head"><h3>{{ dateLong(g.date) }}</h3></div>
          <ul class="sessions">
            @for (e of g.items; track e.id) {
              <li [style.--h]="hue(e.subjectId)">
                <div class="row" style="gap:8px"><span class="pill subj">{{ subjName(e.subjectId) }}</span><span class="tiny muted grow">{{ e.teacherName || teacherName(e.teacherId) }}</span>
                  @if (mine(e)) { <button type="button" class="btn sm" (click)="openEdit(e)">Modifier</button><button type="button" class="btn sm danger" (click)="askDelete(e)" [attr.aria-label]="'Supprimer la séance de ' + subjName(e.subjectId)">Supprimer</button> }</div>
                <p class="lesson">{{ e.content }}</p>
                @if (e.homework) { <div class="hw"><b>À faire pour le {{ dateFr(e.due) }}</b><span>{{ e.homework }}</span></div> }
              </li>
            }
          </ul>
        </section>
      } @empty {
        <div class="card"><div class="empty">Aucune séance renseignée pour cette sélection.</div></div>
      }
    </div>
  </div>

  @if (form(); as f) {
    <app-modal [title]="editingId() ? 'Modifier la séance' : 'Nouvelle séance'" size="wide" (closed)="form.set(null)">
      <div class="stack">
        <div class="form-grid">
          <label class="field"><span>Classe</span><select [ngModel]="f.classId" (ngModelChange)="setClass($event)" name="cl" [disabled]="!!editingId()">@for (c of writeClasses(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></label>
          <label class="field"><span>Matière</span><select [ngModel]="f.subjectId" (ngModelChange)="f.subjectId = $event; refreshDue(); onFormChange()" name="sb" [disabled]="!!editingId()">@for (sb of mySubjects(); track sb.id) { <option [value]="sb.id">{{ sb.name }}</option> }</select></label>
          <label class="field"><span>Date de la séance</span><input type="date" [ngModel]="f.date" (ngModelChange)="f.date = $event; refreshDue(); onFormChange()" [max]="s.today" name="dt" />
            @if (touched() && (!f.date || f.date > s.today)) { <span class="err">Choisissez une date passée ou du jour</span> }</label>
        </div>
        @if (!editingId() && formLessons().length) {
          <div class="field"><span>Mes cours ce jour-là</span><div class="chips" role="group" aria-label="Mes cours ce jour-là">
            @for (l of formLessons(); track l.classId + l.slot) { <button type="button" class="chip" [class.on]="f.classId === l.classId && f.subjectId === l.subjectId" (click)="pickLesson(l)">{{ l.start }} · {{ l.className }} · {{ l.subjectName }}{{ l.entryId ? ' ✓' : '' }}</button> }</div></div>
        }
        @if (!editingId() && last(); as l) {
          <div class="card flat pad resume" role="region" aria-label="Séance précédente">
            <div class="row" style="gap:8px"><b class="grow">Séance précédente · {{ dateFr(l.date) }}</b><span class="tiny muted">{{ l.teacherName || teacherName(l.teacherId) }}</span></div>
            <p>{{ l.content }}</p>
            @if (l.homework) { <p class="small muted">Travail donné : {{ l.homework }}</p> }
            <div><button type="button" class="btn sm" (click)="resume(l)">Reprendre à partir de cette séance</button></div>
          </div>
        }
        @if (f.date && f.subjectId && !tt.hasSessionOn(f.classId, f.subjectId, f.date)) { <div class="banner warn"><app-icon name="alert" [size]="18" /> Cette matière n’est pas prévue ce jour-là dans l’emploi du temps de la classe.</div> }
        <label class="field"><span>Contenu de la leçon</span><textarea rows="3" [ngModel]="f.content" (ngModelChange)="f.content = $event" name="ct" placeholder="Titre et points abordés pendant la séance"></textarea>
          @if (touched() && f.content.trim().length < 5) { <span class="err">Décrivez le contenu de la séance</span> }</label>
        <label class="field"><span>Travail à faire (facultatif)</span><textarea rows="2" [ngModel]="f.homework" (ngModelChange)="f.homework = $event" name="hw" placeholder="Exercices, leçon à apprendre, lecture"></textarea></label>
        @if (f.homework.trim()) {
          <label class="field" style="max-width:260px"><span>À rendre pour le</span><input type="date" [ngModel]="f.due" (ngModelChange)="f.due = $event; dueAuto = false" [min]="minDue()" name="du" />
            @if (touched() && (!f.due || f.due <= f.date)) { <span class="err">La date de remise doit suivre la séance</span> }</label>
          <div class="banner info"><app-icon name="bell" [size]="18" /> Les parents de la classe recevront une notification.</div>
        }
      </div>
      <div footer><button type="button" class="btn ghost" (click)="form.set(null)">Annuler</button><button type="button" class="btn primary" (click)="save()">Enregistrer</button></div>
    </app-modal>
  }
  @if (deleting(); as d) {
    <app-modal title="Supprimer la séance" (closed)="deleting.set(null)">
      <p>{{ subjName(d.subjectId) }} · {{ dateFr(d.date) }}</p>
      <div footer><button type="button" class="btn ghost" (click)="deleting.set(null)">Annuler</button><button type="button" class="btn danger" (click)="confirmDelete()">Supprimer</button></div>
    </app-modal>
  }`,
  styles: `
    .pill.subj { background: color-mix(in srgb, hsl(var(--h, 155) 60% 50%) 18%, var(--surface)); color: var(--ink); border: 1px solid color-mix(in srgb, hsl(var(--h, 155) 50% 42%) 40%, var(--line)); }
    ul.todo, ul.sessions { list-style: none; margin: 0; padding: 0; }
    ul.todo li, ul.sessions li { display: flex; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--line); border-inline-start: 4px solid hsl(var(--h, 155) 50% 42%); }
    ul.sessions li { flex-direction: column; gap: 6px; }
    ul.todo li:last-child, ul.sessions li:last-child { border-bottom: 0; }
    .when { display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
    ul.todo p { margin-top: 4px; }
    .lesson { font-weight: 550; }
    .hw { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 8px; background: var(--accent-tint); color: var(--accent-ink); font-size: 14px; }
    .resume { background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; }
    @media (max-width: 640px) { ul.todo li { flex-direction: column; gap: 6px; } .when { flex-direction: row; align-items: center; gap: 8px; } }
  `,
})
export class CahierPage {
  readonly s = inject(Store);
  readonly book = inject(Textbook);
  readonly tt = inject(Timetable);
  readonly dateFr = dateFr; readonly dateLong = dateLong;
  readonly plan = inject(Planning);
  constructor() { void this.book.load(); void this.tt.load(); void this.loadSubs(); }

  // --- Remplacements : un remplaçant écrit dans le cahier de la séance qu'il tient ---
  readonly subs = signal<Replacement[]>([]);
  private async loadSubs(): Promise<void> {
    if (!this.s.apiMode() || this.s.role() !== 'enseignant') return;
    this.subs.set(await this.plan.replacements(addDays(this.s.today, -7), this.s.today));
  }
  private subOf(classId: string, subjectId: string, date: string): boolean {
    const me = this.s.myTeacher()?.id;
    return this.subs().some((r) => r.teacherId === me && r.classId === classId && r.subjectId === subjectId && r.date === date);
  }
  private allowed(classId: string, subjectId: string, date: string): boolean {
    return this.s.myAssignments().some((a) => a.classId === classId && a.subjectId === subjectId) || this.subOf(classId, subjectId, date);
  }
  readonly writeClasses = computed(() => {
    const base = this.s.scopeClasses();
    const extra = this.subs().filter((r) => !base.some((c) => c.id === r.classId)).map((r) => this.s.classes().find((c) => c.id === r.classId)).filter((c): c is NonNullable<typeof c> => !!c);
    return [...base, ...extra.filter((c, i, a) => a.indexOf(c) === i)];
  });

  // --- Reprendre le cahier : cours du jour (emploi du temps) et séance précédente ---
  readonly formLessons = signal<Lesson[]>([]);
  readonly last = signal<TextEntry | null>(null);
  async onFormChange(): Promise<void> {
    const f = this.form();
    if (!f || !this.s.apiMode()) return;
    if (this.s.role() === 'enseignant') this.formLessons.set(f.date ? await this.plan.lessons(f.date) : []);
    this.last.set(f.classId && f.subjectId ? await this.book.lastAsync(f.classId, f.subjectId, f.date) : null);
  }
  pickLesson(l: Lesson): void {
    const f = this.form();
    if (!f) return;
    this.form.set({ ...f, classId: l.classId, subjectId: l.subjectId });
    this.refreshDue(); void this.onFormChange();
  }
  resume(l: TextEntry): void {
    const f = this.form();
    if (f) this.form.set({ ...f, content: l.content });
  }

  readonly kid = computed(() => (this.s.role() === 'parent' || this.s.role() === 'eleve' ? this.s.activeChild() : null));
  /** Un enseignant ne voit que son propre cahier : ses matières dans ses classes, et les séances qu'il a écrites en remplacement
   * (même règle que le serveur). Le reste du personnel, les parents et les élèves voient toute la classe. */
  readonly teacher = computed(() => this.s.role() === 'enseignant');
  own = (e: TextEntry) => !this.teacher() || this.s.myAssignments().some((a) => a.classId === e.classId && a.subjectId === e.subjectId)
    || (!!e.teacherId && e.teacherId === this.s.myTeacher()?.id);
  readonly classChoices = computed(() => {
    const base = this.s.scopeClasses();
    if (!this.teacher()) return base;
    const me = this.s.myTeacher()?.id;
    const extra = new Set([...this.subs().map((r) => r.classId), ...this.book.entries().filter((e) => me && e.teacherId === me).map((e) => e.classId)]);
    return [...base, ...this.s.classes().filter((c) => extra.has(c.id) && !base.some((b) => b.id === c.id))];
  });
  readonly cidSel = signal(this.s.scopeClasses()[0]?.id ?? '');
  readonly cid = computed(() => this.kid()?.classId ?? this.cidSel());
  readonly subj = signal('');
  readonly subjects = computed(() => {
    const all = this.s.subjectsOfClass(this.cid());
    if (!this.teacher()) return all;
    const ids = new Set([...this.s.myAssignments().filter((a) => a.classId === this.cid()).map((a) => a.subjectId),
      ...this.book.forClass(this.cid()).filter(this.own).map((e) => e.subjectId)]);
    return all.filter((x) => ids.has(x.id));
  });
  readonly canWrite = computed(() => this.s.can('cahier.write') && (this.s.myAssignments().length > 0 || this.subs().length > 0));

  readonly intro = computed(() => {
    const r = this.s.role();
    if (r === 'parent' || r === 'eleve') return 'Le contenu des cours et le travail à faire, jour après jour.';
    if (r === 'enseignant') return 'Votre cahier de textes : le contenu de vos séances et le travail à faire, pour vos matières dans vos classes.';
    return 'Consultation du contenu des séances et des devoirs de chaque classe.';
  });

  readonly filtered = computed(() => this.book.forClass(this.cid()).filter((e) => this.own(e) && (!this.subj() || e.subjectId === this.subj())));
  readonly todo = computed(() => this.book.upcoming(this.cid(), this.s.today).filter((e) => this.own(e) && (!this.subj() || e.subjectId === this.subj())));
  readonly groups = computed(() => {
    const m = new Map<string, TextEntry[]>();
    for (const e of this.filtered()) (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => ({ date, items: items.sort((x, y) => this.subjName(x.subjectId).localeCompare(this.subjName(y.subjectId))) }));
  });

  hue = (id: string) => HUES[id] ?? 155;
  subjName = (id: string) => this.s.subjectById().get(id)?.name ?? '—';
  teacherName = (id: string) => this.s.teacherById().get(id)?.name ?? '—';
  mine = (e: TextEntry) => this.s.can('cahier.write') && ((this.s.myTeacher()?.id === e.teacherId && this.s.myAssignments().some((a) => a.classId === e.classId && a.subjectId === e.subjectId)) || this.subOf(e.classId, e.subjectId, e.date));

  // --- Saisie ---
  readonly form = signal<Form | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly touched = signal(false);
  readonly deleting = signal<TextEntry | null>(null);
  dueAuto = true;
  readonly mySubjects = computed(() => {
    const f = this.form();
    if (!f) return [];
    const ids = new Set([...this.s.myAssignments().filter((a) => a.classId === f.classId).map((a) => a.subjectId), ...this.subs().filter((r) => r.classId === f.classId).map((r) => r.subjectId)]);
    return this.s.subjects().filter((x) => ids.has(x.id));
  });
  minDue = () => { const f = this.form(); return f ? this.book.nextDay(f.date || this.s.today) : ''; };

  openNew(): void {
    const mineIds = [...this.s.myClassIds(), ...this.subs().map((r) => r.classId)];
    const classId = mineIds.includes(this.cid()) ? this.cid() : mineIds[0];
    const subjectId = this.s.myAssignments().find((a) => a.classId === classId)?.subjectId ?? this.subs().find((r) => r.classId === classId)?.subjectId ?? '';
    this.editingId.set(null); this.touched.set(false); this.dueAuto = true;
    this.form.set({ classId, subjectId, date: this.s.today, content: '', homework: '', due: '' });
    this.last.set(null); this.formLessons.set([]);
    this.refreshDue(); void this.onFormChange();
  }
  openEdit(e: TextEntry): void {
    this.editingId.set(e.id); this.touched.set(false); this.dueAuto = false;
    this.form.set({ classId: e.classId, subjectId: e.subjectId, date: e.date, content: e.content, homework: e.homework, due: e.due });
  }
  setClass(id: string): void {
    const f = this.form();
    if (!f) return;
    this.form.set({ ...f, classId: id, subjectId: this.s.myAssignments().find((a) => a.classId === id)?.subjectId ?? this.subs().find((r) => r.classId === id)?.subjectId ?? '' });
    this.refreshDue(); void this.onFormChange();
  }
  refreshDue(): void {
    const f = this.form();
    if (!f || !this.dueAuto || !f.subjectId) return;
    f.due = this.tt.nextSession(f.classId, f.subjectId, f.date || this.s.today) ?? '';
  }
  async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.touched.set(true);
    const hw = f.homework.trim();
    if (!f.date || f.date > this.s.today || f.content.trim().length < 5 || !f.subjectId || (hw && (!f.due || f.due <= f.date))) return;
    const t = this.s.myTeacher();
    if (!t || !this.allowed(f.classId, f.subjectId, f.date)) { this.s.toast('Vous ne pouvez renseigner que vos propres classes et matières.', 'err'); return; }
    const data = { content: f.content.trim(), homework: hw, due: hw ? f.due : '' };
    const label = `${this.s.className(f.classId)} · ${this.subjName(f.subjectId)} · ${dateFr(f.date)}`;
    let notified = 0;
    if (this.s.apiMode()) {
      const err = await this.book.saveAsync(this.editingId(), this.editingId() ? data : { classId: f.classId, subjectId: f.subjectId, date: f.date, ...data });
      if (err) { this.s.toast(err, 'err'); return; }
      this.form.set(null); this.s.toast(hw ? 'Séance enregistrée. Les familles sont prévenues.' : 'Séance enregistrée.'); return;
    }
    if (this.editingId()) {
      this.book.update(this.editingId()!, data);
      this.s.addLog('Cahier de textes', `Séance modifiée : ${label}`);
    } else {
      this.book.add({ classId: f.classId, subjectId: f.subjectId, teacherId: t.id, date: f.date, ...data });
      this.s.addLog('Cahier de textes', `Séance ajoutée : ${label}`);
    }
    if (hw) notified = this.book.parentUserIds(f.classId).length;
    this.form.set(null);
    this.s.toast(hw ? `Séance enregistrée. ${notified} famille(s) prévenue(s).` : 'Séance enregistrée.');
  }
  askDelete(e: TextEntry): void { this.deleting.set(e); }
  async confirmDelete(): Promise<void> {
    const d = this.deleting();
    if (!d) return;
    if (this.s.apiMode()) {
      const err = await this.book.removeAsync(d.id);
      if (err) { this.s.toast(err, 'err'); return; }
      this.deleting.set(null); this.s.toast('Séance supprimée.'); return;
    }
    this.book.remove(d.id);
    this.s.addLog('Cahier de textes', `Séance supprimée : ${this.s.className(d.classId)} · ${this.subjName(d.subjectId)} · ${dateFr(d.date)}`);
    this.deleting.set(null);
    this.s.toast('Séance supprimée.');
  }
}
