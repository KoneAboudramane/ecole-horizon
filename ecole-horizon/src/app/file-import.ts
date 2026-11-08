import { Component, inject, input, output, signal } from '@angular/core';
import { Icon, Modal } from './ui';
import { Credential, ImportKind, ImportReport, Store } from './store';
import { toCsv } from './format';

/** Import d'un fichier Excel (.xlsx) ou CSV : modèle à télécharger, vérification avec erreurs ligne par ligne, puis confirmation. */
@Component({
  selector: 'app-file-import',
  imports: [Modal, Icon],
  template: `
  <app-modal [title]="title()" size="xl" (closed)="closed.emit()">
    @if (done()) {
      <div class="banner ok">{{ doneCount() }} {{ noun() }} créé(s).@if (creds().length) { Téléchargez la liste des identifiants provisoires avant de fermer cette fenêtre : ils ne seront plus affichés. }</div>
      @if (creds().length) {
        <div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>Compte</th><th>Identifiant</th><th>Mot de passe provisoire</th></tr></thead><tbody>
          @for (c of creds().slice(0, 12); track c.username) { <tr><td>{{ c.label }}</td><td><code>{{ c.username }}</code></td><td><code>{{ c.password }}</code></td></tr> }
        </tbody></table></div>
        @if (creds().length > 12) { <p class="tiny muted">… et {{ creds().length - 12 }} autres dans le fichier.</p> }
      }
    } @else {
      <p class="small muted">{{ intro() }} Le site vérifie d’abord le fichier et liste les erreurs ligne par ligne : rien n’est enregistré avant votre confirmation.</p>
      <div class="row" style="margin:10px 0"><button class="btn sm" (click)="s.downloadImportTemplate(kind())"><app-icon name="download" [size]="16" /> Télécharger le modèle Excel</button></div>
      <label class="field"><span>Fichier à importer (.xlsx ou .csv)</span><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pick($event)" /></label>
      @if (err()) { <div class="banner bad" role="alert" style="margin-top:8px">{{ err() }}</div> }
      @if (report(); as r) {
        <div class="row" style="margin:12px 0"><span class="pill ok">{{ r.valid }} valide(s)</span> @if (r.errors.length) { <span class="pill bad">{{ r.errors.length }} à corriger</span> } <span class="tiny muted">sur {{ r.total }} ligne(s)</span></div>
        @if (r.errors.length) {
          <div class="table-wrap"><table class="table"><thead><tr><th>Ligne</th><th>Nom</th><th>Problème</th></tr></thead><tbody>
            @for (e of r.errors.slice(0, 50); track e.line) { <tr><td class="num">{{ e.line }}</td><td>{{ e.nom }}</td><td><span class="pill bad" style="white-space:normal">{{ e.errors.join(' · ') }}</span></td></tr> }
          </tbody></table></div>
          @if (r.errors.length > 50) { <p class="tiny muted">… et {{ r.errors.length - 50 }} autre(s) erreur(s).</p> }
          <p class="small muted" style="margin-top:8px">Les lignes en erreur seront ignorées. Corrigez-les dans le fichier puis choisissez-le à nouveau, ou importez seulement les lignes valides.</p>
        }
      }
    }
    <div footer>
      @if (done()) { @if (creds().length) { <button class="btn" (click)="downloadCreds()"><app-icon name="download" [size]="16" /> Télécharger les identifiants</button> } <button class="btn primary" (click)="closed.emit()">Terminer</button> }
      @else { <button class="btn ghost" (click)="closed.emit()">Annuler</button><button class="btn primary" [disabled]="!report()?.valid || busy()" (click)="run()">{{ busy() ? 'Import…' : 'Importer ' + (report()?.valid ?? 0) + ' ' + noun() }}</button> }
    </div>
  </app-modal>`,
})
export class FileImport {
  readonly s = inject(Store);
  kind = input.required<ImportKind>();
  title = input.required<string>();
  noun = input('élément(s)');
  intro = input('Importez un fichier Excel (.xlsx) ou CSV.');
  closed = output<void>();
  report = signal<ImportReport | null>(null); err = signal(''); busy = signal(false);
  done = signal(false); doneCount = signal(0); creds = signal<Credential[]>([]);
  private file: File | null = null;

  async pick(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.report.set(null); this.err.set(''); this.file = f;
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return void this.err.set('Choisissez un fichier .xlsx (Excel) ou .csv.');
    if (f.size > 2_000_000) return void this.err.set('Fichier trop volumineux (2 Mo au maximum).');
    const r = await this.s.importStudentsFile(f, false, this.kind());
    if (r.ok) this.report.set(r.res ?? null); else this.err.set(r.error ?? 'Fichier illisible.');
  }
  async run(): Promise<void> {
    if (this.busy() || !this.file) return;
    this.busy.set(true);
    const r = await this.s.importStudentsFile(this.file, true, this.kind());
    this.busy.set(false);
    if (!r.ok) return void this.err.set(r.error ?? 'Import impossible.');
    this.creds.set(r.creds ?? []); this.doneCount.set(r.res?.created.length ?? 0); this.done.set(true);
    const bad = r.res?.errors.length ?? 0;
    this.s.toast(`${this.doneCount()} ${this.noun()} créé(s)${bad ? `, ${bad} ligne(s) ignorée(s)` : ''}.`, bad ? 'err' : 'ok');
  }
  downloadCreds(): void {
    void this.s.download('identifiants-provisoires.csv', toCsv(['Compte', 'Identifiant', 'Mot de passe provisoire'], this.creds().map((c) => [c.label, c.username, c.password])));
  }
}
