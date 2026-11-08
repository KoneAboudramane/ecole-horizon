import { describe, expect, it } from 'vitest';
import { FAQ, GUIDES, PAGES, SEE_ALSO, TOUR, faqFor, helpFor, searchHelp, seeAlso, PAGE_TITLE } from './help-content';
import { NAV } from './app';
import { PageId, Role } from './models';

const ROLES = Object.keys(GUIDES) as Role[];

describe('aide intégrée', () => {
  it('chaque page proposée à chaque rôle possède une aide complète', () => {
    for (const role of ROLES) {
      for (const n of NAV[role]) {
        const h = helpFor(role, n.page);
        expect(h.but.length, `${role}/${n.page} : but`).toBeGreaterThan(10);
        expect(h.etapes.length, `${role}/${n.page} : étapes`).toBeGreaterThan(0);
        expect(PAGE_TITLE[n.page], `${n.page} : titre`).toBeTruthy();
      }
      expect(helpFor(role, 'profil').etapes.length).toBeGreaterThan(0);
    }
  });

  it('chaque page de l’application a une entrée d’aide', () => {
    const pages = Object.keys(PAGES) as PageId[];
    expect(pages.length).toBeGreaterThanOrEqual(26);
    for (const p of pages) expect(PAGES[p].etapes.length, p).toBeGreaterThan(0);
  });

  it('chaque rôle a un guide et une visite guidée', () => {
    for (const role of ROLES) {
      const g = GUIDES[role];
      expect(g.resume.length, role).toBeGreaterThan(20);
      expect(g.peut.length, role).toBeGreaterThan(0);
      expect(g.nePeutPas.length, role).toBeGreaterThan(0);
      expect(g.parcours.length, role).toBeGreaterThan(0);
      expect(TOUR[role].length, role).toBeGreaterThanOrEqual(3);
    }
  });

  it('la variante d’un rôle remplace le général sans perdre les autres champs', () => {
    const base = helpFor('admin', 'matieres');
    expect(base.astuce).toBeTruthy();
    const ens = helpFor('enseignant', 'notes');
    const par = helpFor('parent', 'notes');
    expect(ens.etapes.join(' ')).toContain('Nouvelle évaluation');
    expect(par.etapes.join(' ')).not.toContain('Nouvelle évaluation');
  });

  it('les questions sont filtrées par rôle', () => {
    expect(faqFor('parent').some((f) => f.q.includes('mobile money'))).toBe(true);
    expect(faqFor('comptable').some((f) => f.q.includes('mobile money'))).toBe(false);
    expect(faqFor('comptable').some((f) => f.q.includes('erreur sur un paiement'))).toBe(true);
    expect(FAQ.filter((f) => !f.roles).length).toBeGreaterThan(3);
  });

  it('la recherche ignore accents et casse, et respecte les pages du rôle', () => {
    const r = searchHelp('parent', 'JUSTIFIER absence');
    expect(r.length).toBeGreaterThan(0);
    expect(searchHelp('parent', 'x').length).toBe(0);
    const limited = searchHelp('parent', 'rapprochement', ['dashboard']);
    expect(limited.some((x) => x.kind === 'page' && x.id === 'rapprochement')).toBe(false);
  });

  it('« Voir aussi » ne propose que des pages qui existent et que le rôle peut ouvrir', () => {
    for (const [from, list] of Object.entries(SEE_ALSO)) {
      expect(PAGES[from as PageId], from).toBeTruthy();
      for (const to of list ?? []) { expect(PAGES[to], `${from} → ${to}`).toBeTruthy(); expect(to).not.toBe(from); }
    }
    expect(seeAlso('comptes', ['comptes', 'roles'])).toEqual(['roles']);
    expect(seeAlso('comptes', [])).toEqual([]);
  });

  it('les accès par e-mail, la connexion et les droits sont expliqués', () => {
    const q = (r: Role) => faqFor(r).map((f) => f.q).join(' | ');
    expect(q('enseignant')).toContain('accès par e-mail');
    expect(q('parent')).not.toContain('accès par e-mail');
    expect(q('parent')).toContain('Avec quoi me connecter');
    expect(helpFor('admin', 'comptes').etapes.join(' ')).toContain('par e-mail');
    expect(helpFor('fondateur', 'roles').etapes.join(' ')).toContain('portée');
    expect(searchHelp('fondateur', 'portée').some((r) => r.id === 'roles')).toBe(true);
  });
});
