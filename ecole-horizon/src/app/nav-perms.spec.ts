import { adaptNav, pagesOpenedBy } from './nav-perms';
import { PERMS } from './models';

const base = [{ page: 'dashboard' as const, label: 'Accueil', icon: 'home' }, { page: 'paiements' as const, label: 'Finances', icon: 'card' }, { page: 'tarifs' as const, label: 'Tarifs', icon: 'tag' }, { page: 'messages' as const, label: 'Messagerie', icon: 'message' }];

describe('Menu selon les droits du rôle', () => {
  it('ne change pas avec les droits par défaut', () => {
    expect(adaptNav('comptable', base, PERMS.comptable).map((n) => n.page)).toEqual(['dashboard', 'paiements', 'tarifs', 'messages']);
  });
  it('retire une page dont le droit a été retiré', () => {
    const pages = adaptNav('comptable', base, ['tarifs.write']).map((n) => n.page);
    expect(pages).toContain('tarifs');
    expect(pages).not.toContain('paiements');
  });
  it('ouvre les pages d’un droit accordé en plus', () => {
    const pages = adaptNav('informatique', [{ page: 'dashboard', label: 'Accueil', icon: 'home' }], ['accounts', 'journal.sys', 'settings.tech', 'roles.manage', 'pay.read']).map((n) => n.page);
    expect(pages).toContain('roles');
    expect(pages).toContain('paiements');
    expect(pages).toContain('impayes');
  });
  it('un rôle créé par l’école reçoit seulement les pages de ses droits', () => {
    const pages = adaptNav('personnel', [{ page: 'dashboard', label: 'Accueil', icon: 'home' }], ['students.write']).map((n) => n.page);
    expect(pages).toEqual(['dashboard', 'eleves']);
  });
  it('les parents et les élèves n’ont jamais de page ajoutée', () => {
    expect(adaptNav('parent', [{ page: 'dashboard', label: 'Accueil', icon: 'home' }], []).length).toBe(1);
  });
  it('ouvre appel, notes et statistiques aux rôles créés par l’école', () => {
    const pages = adaptNav('personnel', [{ page: 'dashboard', label: 'Accueil', icon: 'home' }], ['appel', 'publish', 'stats.vie']).map((n) => n.page);
    expect(pages).toEqual(expect.arrayContaining(['appel', 'notes', 'stats']));
  });
  it('indique les pages ouvertes par un droit', () => {
    expect(pagesOpenedBy('pay.read')).toEqual(expect.arrayContaining(['Finances', 'Impayés']));
    expect(pagesOpenedBy('cahier.write')).toEqual([]);
  });
});
