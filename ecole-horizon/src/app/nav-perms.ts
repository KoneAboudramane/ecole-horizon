import { PageId, PERMS, Perm, Role } from './models';

/**
 * Les droits d'un rôle sont choisis par chaque école (Paramètres > Rôles et accès). Le menu suit ces droits :
 * - une page que le rôle ne peut plus utiliser disparaît (seulement si le rôle l'avait par défaut) ;
 * - un droit accordé en plus ouvre les pages qui vont avec (seulement les pages qui ne dépendent pas d'un type de rôle).
 * Avec les droits par défaut, le menu ne change pas. Le serveur reste le seul juge de ce qui est permis.
 */
export const PAGE_PERMS: Partial<Record<PageId, Perm[]>> = {
  eleves: ['students.write'], classes: ['classes.write'], matieres: ['subjects.write'], comptes: ['accounts'],
  parametres: ['settings', 'settings.tech'], appel: ['appel'], presences: ['appel', 'justifs', 'discipline'], discipline: ['discipline'],
  conduite: ['conduite'], educateurs: ['educateurs.write'], paiements: ['pay.read', 'pay.write'], caisse: ['pay.write'], impayes: ['pay.read'],
  tarifs: ['tarifs.write'], rapprochement: ['rapprochement.write'], journal: ['journal', 'journal.sys'], bulletins: ['bulletins.gen'],
  decisions: ['decisions.write'], examens: ['examens.write'], devoirs: ['devoirs.write', 'devoirs.read'], cours: ['devoirs.write', 'devoirs.read'],
  annee: ['rollover', 'classes.write'], roles: ['roles.manage'], notes: ['publish'], stats: ['stats.academic', 'stats.finance', 'stats.vie'],
};
/** Pages qu'un droit accordé en plus peut ouvrir à un rôle qui ne les avait pas. */
const OPENABLE: PageId[] = ['eleves', 'classes', 'matieres', 'comptes', 'parametres', 'presences', 'discipline', 'conduite', 'educateurs', 'paiements', 'caisse', 'impayes', 'tarifs',
  'rapprochement', 'journal', 'bulletins', 'decisions', 'examens', 'devoirs', 'cours', 'annee', 'roles', 'appel', 'notes', 'stats'];
const ICON: Partial<Record<PageId, string>> = { eleves: 'users', classes: 'grid', matieres: 'layers', comptes: 'users', parametres: 'sliders', presences: 'calendar', discipline: 'shield',
  conduite: 'shield', educateurs: 'users', paiements: 'card', caisse: 'file', impayes: 'alert', tarifs: 'tag', rapprochement: 'file', journal: 'activity', bulletins: 'file',
  decisions: 'layers', examens: 'clipboard', devoirs: 'clipboard', cours: 'globe', annee: 'refresh', roles: 'shield', appel: 'calendar', notes: 'clipboard', stats: 'chart' };
export const PAGE_LABEL: Partial<Record<PageId, string>> = { eleves: 'Élèves', classes: 'Classes', matieres: 'Matières et coefficients', comptes: 'Comptes', parametres: 'Réglages de l’école',
  presences: 'Absences et discipline', discipline: 'Discipline', conduite: 'Conduite', educateurs: 'Éducateurs et leurs classes', paiements: 'Finances', caisse: 'Caisse du jour', impayes: 'Impayés',
  tarifs: 'Tarifs et échéances', rapprochement: 'Rapprochement', journal: 'Journal d’activité', bulletins: 'Bulletins', decisions: 'Bilan de fin d’année', examens: 'Examens blancs',
  devoirs: 'Devoirs et épreuves', cours: 'Supports de cours', annee: 'Fin d’année et nouvelle année', roles: 'Rôles et accès', appel: 'Appel', notes: 'Notes et publication', stats: 'Statistiques' };

export interface NavLike { page: PageId; label: string; icon: string; }

/** Menu d'un rôle, adapté à ses droits réels (`held`) par rapport aux droits par défaut de ce type de rôle. */
export function adaptNav(role: Role, base: NavLike[], held: readonly string[]): NavLike[] {
  const def = new Set<string>(PERMS[role] ?? []);
  const has = (p: string) => held.includes(p);
  const kept = base.filter((n) => {
    const need = PAGE_PERMS[n.page];
    if (!need) return true;
    const hadByDefault = need.some((p) => def.has(p));
    return !hadByDefault || need.some(has);
  });
  const present = new Set(kept.map((n) => n.page));
  const extra: NavLike[] = [];
  for (const page of OPENABLE) {
    if (present.has(page)) continue;
    const need = PAGE_PERMS[page] ?? [];
    if (need.some((p) => has(p) && !def.has(p))) extra.push({ page, label: PAGE_LABEL[page] ?? page, icon: ICON[page] ?? 'file' });
  }
  return [...kept, ...extra];
}

/** Pages qu'un droit ouvre (pour l'éditeur de rôles : on voit l'effet de chaque case). */
export function pagesOpenedBy(perm: string): string[] {
  return (Object.keys(PAGE_PERMS) as PageId[]).filter((p) => OPENABLE.includes(p) && (PAGE_PERMS[p] ?? []).includes(perm as Perm)).map((p) => PAGE_LABEL[p] ?? p);
}
