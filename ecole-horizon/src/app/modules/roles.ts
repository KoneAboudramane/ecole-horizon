import { Injectable, inject, signal } from '@angular/core';
import { Api } from '../api';
import { Store } from '../store';

export interface RoleRow { id: number; key: string; label: string; base: string; perms: string[]; locked: boolean; builtin: boolean; members: number; }
export interface CatalogItem { perm: string; group: string; label: string; }
export interface RoleTemplate { label: string; scope: 'personnel' | 'enseignant' | 'educateur'; perms: string[]; }
export interface RoleChoice { id: number; key: string; label: string; base: string; }
export interface RoleForm { label: string; scope: 'personnel' | 'enseignant' | 'educateur'; perms: string[]; }

/** Regroupe le catalogue des droits par domaine, dans l'ordre du serveur. */
export const groupCatalog = (c: CatalogItem[]): { group: string; items: CatalogItem[] }[] => {
  const out: { group: string; items: CatalogItem[] }[] = [];
  for (const it of c) {
    const g = out.find((x) => x.group === it.group);
    if (g) g.items.push(it); else out.push({ group: it.group, items: [it] });
  }
  return out;
};

/** Rôles et droits de l'école. Fonction du serveur : lui seul garde les droits et vérifie les garde-fous. */
@Injectable({ providedIn: 'root' })
export class Roles {
  private readonly s = inject(Store);
  private readonly api = inject(Api);
  readonly roles = signal<RoleRow[]>([]);
  readonly catalog = signal<CatalogItem[]>([]);
  readonly grantable = signal<string[]>([]);
  readonly templates = signal<RoleTemplate[]>([]);
  readonly choices = signal<RoleChoice[]>([]);
  readonly loaded = signal(false);

  async load(): Promise<void> {
    try {
      const r = await this.api.get<{ roles: RoleRow[]; catalog: CatalogItem[]; grantable: string[]; templates: RoleTemplate[] }>('roles/');
      this.roles.set(r.roles); this.catalog.set(r.catalog); this.grantable.set(r.grantable); this.templates.set(r.templates); this.loaded.set(true);
    } catch (e) { this.s.toast(this.s.errorMessage(e), 'err'); }
  }
  async loadChoices(): Promise<void> {
    try { this.choices.set(await this.api.get<RoleChoice[]>('roles/choices/')); } catch { /* on garde la liste précédente */ }
  }
  async create(f: RoleForm): Promise<string | null> {
    try { await this.api.post('roles/', f); await this.load(); return null; } catch (e) { return this.s.errorMessage(e); }
  }
  async update(id: number, f: Partial<RoleForm>): Promise<string | null> {
    try { await this.api.patch(`roles/${id}/`, f); await this.load(); return null; } catch (e) { return this.s.errorMessage(e); }
  }
  async remove(id: number): Promise<string | null> {
    try { await this.api.delete(`roles/${id}/`); await this.load(); return null; } catch (e) { return this.s.errorMessage(e); }
  }
}
