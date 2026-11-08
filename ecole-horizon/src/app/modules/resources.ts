import { Injectable, effect, inject, signal } from '@angular/core';
import { Api } from '../api';
import { Store } from '../store';

export type ResKind = 'support' | 'direct';
export interface ResLink { url: string; label: string; }
export interface Resource {
  id: string; classId: string; subjectId: string; subjectName: string; teacherName: string; kind: ResKind; title: string; description: string;
  links: ResLink[]; linksHidden: boolean; hasFile: boolean; fileName: string; startsAt: string | null; endsAt: string | null; createdAt: string;
}
export interface ResForm {
  classId: string; subjectId: string; kind: ResKind; title: string; description: string; links: ResLink[]; startsAt: string; endsAt: string;
}
export interface ApiResource {
  id: number; school_class: number; subject: number; subject_name: string; teacher_name: string; kind: ResKind; title: string; description: string;
  links: ResLink[]; links_hidden: boolean; has_file: boolean; file_name: string; starts_at: string | null; ends_at: string | null; created_at: string;
}

export const mapResource = (a: ApiResource, codeOf: (pk: number) => string | undefined): Resource => ({
  id: String(a.id), classId: String(a.school_class), subjectId: codeOf(a.subject) ?? String(a.subject), subjectName: a.subject_name, teacherName: a.teacher_name,
  kind: a.kind, title: a.title, description: a.description, links: a.links ?? [], linksHidden: !!a.links_hidden, hasFile: !!a.has_file, fileName: a.file_name,
  startsAt: a.starts_at, endsAt: a.ends_at, createdAt: a.created_at,
});

/** Nom du site d'une adresse (sans « www. »), affiché à côté de chaque lien pour que l'on sache où l'on va. */
export const domainOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
/** Un cours en direct est « en cours » entre son début et sa fin. */
export const livePhase = (r: Pick<Resource, 'startsAt' | 'endsAt'>, now = Date.now()): 'a_venir' | 'en_cours' | 'termine' => {
  const s = r.startsAt ? Date.parse(r.startsAt) : 0, e = r.endsAt ? Date.parse(r.endsAt) : 0;
  return now < s ? 'a_venir' : now <= e ? 'en_cours' : 'termine';
};

/** Supports de cours (liens et fichier) et cours en direct. Fonction du serveur uniquement : il garde les fichiers et ne livre le lien d'un cours en direct qu'à l'heure. */
@Injectable({ providedIn: 'root' })
export class Resources {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  readonly list = signal<Resource[]>([]);
  readonly loaded = signal(false);

  constructor() {
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode() || !me) { this.list.set([]); this.loaded.set(false); return; }
      if (this.s.school().devoirsActifs) void this.load();
    });
  }
  private fail(e: unknown): string { return this.s.errorMessage(e); }
  private map(a: ApiResource): Resource { return mapResource(a, (pk) => this.s.subjectCode(pk)); }
  async load(): Promise<void> {
    try { this.list.set((await this.api.get<ApiResource[]>('resources/')).map((a) => this.map(a))); this.loaded.set(true); } catch { /* état précédent conservé */ }
  }
  private put(a: ApiResource): Resource {
    const r = this.map(a);
    this.list.update((l) => (l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [r, ...l]));
    return r;
  }
  private body(f: Partial<ResForm>, willAttach = false): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    if (f.classId !== undefined) o['school_class'] = Number(f.classId);
    if (f.subjectId !== undefined) o['subject'] = this.s.subjectPkOf(f.subjectId);
    if (f.kind !== undefined) o['kind'] = f.kind;
    if (f.title !== undefined) o['title'] = f.title.trim();
    if (f.description !== undefined) o['description'] = f.description.trim();
    if (f.links !== undefined) o['links'] = f.links.filter((l) => l.url.trim()).map((l) => ({ url: l.url.trim(), label: l.label.trim() }));
    if (f.kind === 'direct') { if (f.startsAt) o['starts_at'] = f.startsAt; if (f.endsAt) o['ends_at'] = f.endsAt; }
    if (willAttach) o['will_attach'] = true;
    return o;
  }
  async create(f: ResForm, file: File | null): Promise<{ res?: Resource; error?: string }> {
    try {
      let r = await this.api.post<ApiResource>('resources/', this.body(f, !!file));
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        try { r = await this.api.post<ApiResource>(`resources/${r.id}/file/`, fd); }
        catch (e) { this.put(r); return { error: this.fail(e) }; }
      }
      return { res: this.put(r) };
    } catch (e) { return { error: this.fail(e) }; }
  }
  async update(id: string, f: Partial<ResForm>): Promise<{ res?: Resource; error?: string }> {
    try { return { res: this.put(await this.api.patch<ApiResource>(`resources/${id}/`, this.body(f))) }; } catch (e) { return { error: this.fail(e) }; }
  }
  async remove(id: string): Promise<string | null> {
    try { await this.api.delete(`resources/${id}/`); this.list.update((l) => l.filter((x) => x.id !== id)); return null; } catch (e) { return this.fail(e); }
  }
  async attach(id: string, file: File): Promise<string | null> {
    const fd = new FormData(); fd.append('file', file);
    try { this.put(await this.api.post<ApiResource>(`resources/${id}/file/`, fd)); return null; } catch (e) { return this.fail(e); }
  }
  async detach(id: string): Promise<string | null> {
    try { await this.api.delete(`resources/${id}/file/`); await this.load(); return null; } catch (e) { return this.fail(e); }
  }
  async download(r: Resource): Promise<void> {
    try { this.s.saveBlob(r.fileName || 'support', await this.api.blob(`resources/${r.id}/file/`)); } catch (e) { this.s.toast(this.fail(e), 'err'); }
  }
}
