import { Component, computed, effect, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Discipline } from './pages/discipline';
import { DecisionsPage } from './pages/decisions';
import { EdtPage } from './pages/edt';
import { CahierPage } from './pages/cahier';
import { DevoirsPage } from './pages/devoirs';
import { CoursPage } from './pages/cours';
import { RolesPage } from './pages/roles';
import { MaClassePage } from './pages/maclasse';
import { adaptNav } from './nav-perms';
import { ExamensPage } from './pages/examens';
import { MessagesPage } from './pages/messages';
import { ProfilPage } from './pages/profil';
import { Store } from './store';
import { Push } from './push';
import { PushCta } from './push-cta';
import { HelpButton, HelpOverlay } from './help';
import { PageId, ROLE_LABEL, Role } from './models';
import { VitrinePage } from './pages/vitrine';
import { Avatar, Icon, LangSwitch, SchoolLogo, ThemeToggle, startCountUp, startTableLabels } from './ui';
import { startTranslator } from './i18n/i18n';
import { dateLong } from './format';
import { Dashboard } from './pages/dashboard';
import { ElevesPage, FichePage } from './pages/eleves';
import { AnciensPage, AnneePage } from './pages/annee';
import { ArchivesPage } from './pages/archives';
import { RepartitionPage } from './pages/repartition';
import { ConduitePage, EducateursPage } from './pages/conduite';
import { AnnoncesPage, ClassesPage, ComptesPage, JournalPage, MatieresPage, ParametresPage } from './pages/admin';
import { NotesPage } from './pages/notes';
import { BulletinsPage } from './pages/bulletins';
import { AppelPage, PresencesPage } from './pages/presences';
import { StatsPage } from './pages/stats';
import { CaissePage, ImpayesPage, PaiementsPage, PayerPage, RapprochementPage, TarifsPage } from './pages/finance';

export interface NavItem { page: PageId; label: string; icon: string; }

export const NAV: Record<Role, NavItem[]> = {
  fondateur: [
    { page: 'dashboard', label: 'Tableau de bord', icon: 'home' },
    { page: 'stats', label: 'Statistiques', icon: 'chart' },
    { page: 'eleves', label: 'Élèves', icon: 'users' },
    { page: 'classes', label: 'Classes', icon: 'grid' },
    { page: 'notes', label: 'Résultats', icon: 'clipboard' },
    { page: 'presences', label: 'Assiduité', icon: 'calendar' },
    { page: 'paiements', label: 'Finances', icon: 'card' },
    { page: 'caisse', label: 'Caisse du jour', icon: 'file' },
    { page: 'impayes', label: 'Impayés', icon: 'alert' },
    { page: 'tarifs', label: 'Tarifs et échéances', icon: 'tag' },
    { page: 'decisions', label: 'Bilan de fin d’année', icon: 'layers' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'examens', label: 'Examens blancs', icon: 'file' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
    { page: 'journal', label: 'Journal d’activité', icon: 'activity' },
    { page: 'roles', label: 'Rôles et accès', icon: 'shield' },
  ],
  directeur: [
    { page: 'dashboard', label: 'Tableau de bord', icon: 'home' },
    { page: 'stats', label: 'Statistiques', icon: 'chart' },
    { page: 'notes', label: 'Notes et publication', icon: 'clipboard' },
    { page: 'bulletins', label: 'Bulletins', icon: 'file' },
    { page: 'discipline', label: 'Discipline', icon: 'shield' },
    { page: 'conduite', label: 'Conduite', icon: 'shield' },
    { page: 'educateurs', label: 'Éducateurs et leurs classes', icon: 'users' },
    { page: 'presences', label: 'Présences', icon: 'calendar' },
    { page: 'eleves', label: 'Élèves', icon: 'users' },
    { page: 'classes', label: 'Classes', icon: 'grid' },
    { page: 'matieres', label: 'Matières et coefficients', icon: 'layers' },
    { page: 'repartition', label: 'Répartition des enseignants', icon: 'users' },
    { page: 'paiements', label: 'Finances', icon: 'card' },
    { page: 'caisse', label: 'Caisse du jour', icon: 'file' },
    { page: 'annee', label: 'Fin d’année et nouvelle année', icon: 'refresh' },
    { page: 'anciens', label: 'Anciens élèves et exclus', icon: 'users' },
    { page: 'archives', label: 'Années précédentes', icon: 'file' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'devoirs', label: 'Devoirs et épreuves', icon: 'clipboard' },
    { page: 'cours', label: 'Supports de cours', icon: 'globe' },
    { page: 'examens', label: 'Examens blancs', icon: 'file' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
    { page: 'journal', label: 'Journal d’activité', icon: 'activity' },
    { page: 'parametres', label: 'Paramètres', icon: 'sliders' },
  ],
  admin: [
    { page: 'dashboard', label: 'Tableau de bord', icon: 'home' },
    { page: 'eleves', label: 'Élèves', icon: 'users' },
    { page: 'classes', label: 'Classes', icon: 'grid' },
    { page: 'matieres', label: 'Matières et coefficients', icon: 'layers' },
    { page: 'repartition', label: 'Répartition des enseignants', icon: 'users' },
    { page: 'educateurs', label: 'Éducateurs et leurs classes', icon: 'users' },
    { page: 'comptes', label: 'Comptes', icon: 'key' },
    { page: 'notes', label: 'Contrôle des notes', icon: 'clipboard' },
    { page: 'bulletins', label: 'Bulletins', icon: 'file' },
    { page: 'annee', label: 'Répartition des élèves', icon: 'refresh' },
    { page: 'decisions', label: 'Bilan de fin d’année', icon: 'layers' },
    { page: 'anciens', label: 'Anciens élèves et exclus', icon: 'users' },
    { page: 'archives', label: 'Années précédentes', icon: 'file' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'examens', label: 'Examens blancs', icon: 'file' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
    { page: 'journal', label: 'Journal d’activité', icon: 'activity' },
    { page: 'parametres', label: 'Paramètres', icon: 'sliders' },
  ],
  enseignant: [
    { page: 'dashboard', label: 'Accueil', icon: 'home' },
    { page: 'stats', label: 'Statistiques', icon: 'chart' },
    { page: 'notes', label: 'Saisie des notes', icon: 'clipboard' },
    { page: 'bulletins', label: 'Appréciations', icon: 'file' },
    { page: 'appel', label: 'Appel', icon: 'calendar' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'cahier', label: 'Cahier de textes', icon: 'file' },
    { page: 'devoirs', label: 'Devoirs et épreuves', icon: 'clipboard' },
    { page: 'cours', label: 'Supports de cours', icon: 'globe' },
    { page: 'examens', label: 'Examens blancs', icon: 'clipboard' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
  educateur: [
    { page: 'dashboard', label: 'Accueil', icon: 'home' },
    { page: 'stats', label: 'Statistiques', icon: 'chart' },
    { page: 'appel', label: 'Appel', icon: 'calendar' },
    { page: 'presences', label: 'Présences', icon: 'clipboard' },
    { page: 'discipline', label: 'Discipline', icon: 'shield' },
    { page: 'conduite', label: 'Conduite', icon: 'shield' },
    { page: 'eleves', label: 'Élèves', icon: 'users' },
    { page: 'classes', label: 'Classes', icon: 'grid' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'cahier', label: 'Cahier de textes', icon: 'file' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
  comptable: [
    { page: 'dashboard', label: 'Tableau de bord', icon: 'home' },
    { page: 'stats', label: 'Statistiques', icon: 'chart' },
    { page: 'paiements', label: 'Paiements', icon: 'card' },
    { page: 'caisse', label: 'Caisse du jour', icon: 'file' },
    { page: 'impayes', label: 'Impayés', icon: 'alert' },
    { page: 'tarifs', label: 'Tarifs et échéances', icon: 'tag' },
    { page: 'rapprochement', label: 'Rapprochement', icon: 'refresh' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
  informatique: [
    { page: 'dashboard', label: 'Tableau de bord', icon: 'home' },
    { page: 'comptes', label: 'Comptes', icon: 'key' },
    { page: 'journal', label: 'Journal d’activité', icon: 'activity' },
    { page: 'parametres', label: 'Identité de l’école', icon: 'sliders' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
  parent: [
    { page: 'dashboard', label: 'Accueil', icon: 'home' },
    { page: 'stats', label: 'Progression', icon: 'chart' },
    { page: 'notes', label: 'Notes', icon: 'clipboard' },
    { page: 'bulletins', label: 'Bulletins', icon: 'file' },
    { page: 'archives', label: 'Années précédentes', icon: 'file' },
    { page: 'presences', label: 'Absences et discipline', icon: 'calendar' },
    { page: 'payer', label: 'Scolarité et paiement', icon: 'card' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'cahier', label: 'Cahier de textes', icon: 'file' },
    { page: 'devoirs', label: 'Devoirs et épreuves', icon: 'clipboard' },
    { page: 'cours', label: 'Supports de cours', icon: 'globe' },
    { page: 'examens', label: 'Examens blancs', icon: 'clipboard' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
  personnel: [
    { page: 'dashboard', label: 'Accueil', icon: 'home' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'messages', label: 'Messagerie', icon: 'message' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
  eleve: [
    { page: 'dashboard', label: 'Accueil', icon: 'home' },
    { page: 'stats', label: 'Ma progression', icon: 'chart' },
    { page: 'notes', label: 'Mes notes', icon: 'clipboard' },
    { page: 'bulletins', label: 'Mes bulletins', icon: 'file' },
    { page: 'archives', label: 'Années précédentes', icon: 'file' },
    { page: 'presences', label: 'Mes absences', icon: 'calendar' },
    { page: 'edt', label: 'Emploi du temps', icon: 'calendar' },
    { page: 'cahier', label: 'Cahier de textes', icon: 'file' },
    { page: 'devoirs', label: 'Devoirs et épreuves', icon: 'clipboard' },
    { page: 'cours', label: 'Supports de cours', icon: 'globe' },
    { page: 'examens', label: 'Examens blancs', icon: 'clipboard' },
    { page: 'annonces', label: 'Annonces', icon: 'message' },
  ],
};

/** Pages déjà reliées au serveur (mode API). Les autres sont masquées pour ne rien afficher de faux. */
/** Pages qui n'existent qu'avec le serveur (pas dans la démonstration). */
const API_ONLY: PageId[] = ['annee', 'anciens', 'archives', 'repartition', 'devoirs', 'cours', 'roles'];
const API_PAGES: PageId[] = ['dashboard', 'notes', 'bulletins', 'decisions', 'appel', 'presences', 'discipline', 'paiements', 'caisse', 'impayes', 'tarifs', 'rapprochement', 'payer', 'journal', 'stats', 'annonces', 'messages', 'edt', 'cahier', 'examens', 'eleves', 'eleve', 'classes', 'matieres', 'comptes', 'parametres', 'profil', 'annee', 'anciens', 'archives', 'repartition', 'conduite', 'educateurs', 'devoirs', 'cours', 'roles', 'maclasse'];

const DEMOS: { username: string; role: Role; who: string; what: string }[] = [
  { username: 'fondateur', role: 'fondateur', who: 'M. Ouattara', what: 'Vue d’ensemble : effectifs, finances, résultats' },
  { username: 'directeur', role: 'directeur', who: 'Mme Diarrassouba', what: 'Publie les notes, valide les sanctions, signe les bulletins' },
  { username: 'secretariat', role: 'admin', who: 'Mme Bakayoko', what: 'Inscriptions, classes, comptes, matières' },
  { username: 'enseignant', role: 'enseignant', who: 'Mme Konan', what: 'Mathématiques : notes, appel, appréciations' },
  { username: 'educateur', role: 'educateur', who: 'M. Yapo', what: 'Appel, retards, justificatifs, discipline' },
  { username: 'comptable', role: 'comptable', who: 'M. Soro', what: 'Paiements, impayés, rapprochement' },
  { username: 'informatique', role: 'informatique', who: 'M. Tano', what: 'Comptes, journal, identité de l’école' },
  { username: 'parent', role: 'parent', who: 'M. Brou', what: 'Deux enfants, bulletins, scolarité et reçus' },
  { username: 'eleve', role: 'eleve', who: 'Marie-Ange', what: 'Notes publiées, absences, bulletin de la 3e A' },
];

const IDLE_MS = 20 * 60 * 1000;

@Component({
  selector: 'app-root',
  imports: [FormsModule, PushCta, HelpButton, HelpOverlay, MaClassePage, VitrinePage, Icon, Avatar, SchoolLogo, LangSwitch, ThemeToggle, Dashboard, ElevesPage, FichePage, ClassesPage, MatieresPage, ComptesPage, ParametresPage,
    AnnoncesPage, JournalPage, NotesPage, BulletinsPage, AppelPage, PresencesPage, PaiementsPage, CaissePage, ImpayesPage, TarifsPage, RapprochementPage, PayerPage, Discipline, DecisionsPage, EdtPage, CahierPage, ExamensPage, MessagesPage, ProfilPage, StatsPage, AnneePage, AnciensPage, ArchivesPage, RepartitionPage, ConduitePage, EducateursPage, DevoirsPage, CoursPage, RolesPage],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly store = inject(Store);
  private readonly push = inject(Push);
  readonly roleLabel = ROLE_LABEL;
  readonly demos = DEMOS;
  readonly dateLong = dateLong;

  /** Avant la connexion : page d'accueil publique, puis écran de connexion (adresse #connexion pour y aller directement). */
  private readonly resetLink = /^#reinitialiser\/([^/]+)\/(.+)$/.exec(location.hash);
  showLogin = signal(location.hash === '#connexion' || !!this.resetLink);
  /** Écran de connexion : connexion, mot de passe oublié, ou choix du nouveau mot de passe (lien reçu par e-mail). */
  authView = signal<'login' | 'forgot' | 'reset'>(this.resetLink ? 'reset' : 'login');
  captchaAnswer = ''; forgotId = ''; forgotMsg = signal(''); forgotErr = signal('');
  resetPw = ''; resetPw2 = ''; resetErr = signal(''); resetOk = signal('');
  async sendForgot(): Promise<void> {
    if (this.busy()) return;
    this.forgotErr.set(''); this.forgotMsg.set('');
    if (!this.forgotId.trim()) return void this.forgotErr.set('Saisissez votre identifiant ou votre adresse e-mail.');
    this.busy.set(true);
    try {
      if (this.store.captcha() && !this.captchaAnswer.trim()) return void this.forgotErr.set('Répondez au calcul anti-robot.');
      const r = await this.store.forgotPasswordAsync(this.forgotId, this.captchaAnswer);
      this.captchaAnswer = '';
      if (r.ok) this.forgotMsg.set(r.message ?? ''); else this.forgotErr.set(r.error ?? '');
    } finally { this.busy.set(false); }
  }
  async saveReset(): Promise<void> {
    if (this.busy() || !this.resetLink) return;
    this.resetErr.set('');
    this.busy.set(true);
    try {
      const r = await this.store.resetWithLinkAsync(this.resetLink[1], this.resetLink[2], this.resetPw, this.resetPw2);
      if (!r.ok) return void this.resetErr.set(r.error ?? '');
      this.resetOk.set(r.message ?? 'Mot de passe modifié.');
      this.resetPw = ''; this.resetPw2 = '';
      history.replaceState(null, '', location.pathname + location.search + '#connexion');
      this.authView.set('login');
    } finally { this.busy.set(false); }
  }
  goForgot(): void { this.forgotMsg.set(''); this.forgotErr.set(''); this.authView.set('forgot'); }
  openLogin(): void { this.showLogin.set(true); history.replaceState(null, '', location.pathname + location.search + '#connexion'); window.scrollTo(0, 0); }
  closeLogin(): void { this.showLogin.set(false); history.replaceState(null, '', location.pathname + location.search); }
  showPw = signal(false);
  username = '';
  password = '';
  loginError = signal('');
  newPw = '';
  newPw2 = '';
  pwError = signal('');

  menuOpen = signal(false);
  userMenu = signal(false);
  bellOpen = signal(false);
  query = signal('');
  searchOpen = signal(false);

  readonly connected = computed(() => !this.store.apiMode() || API_PAGES.includes(this.store.page()));
  nav = computed(() => {
    const r = this.store.role();
    if (!r) return [];
    const me = this.store.me();
    const adapted = this.store.apiMode() && me?.perms ? adaptNav(r, NAV[r], me.perms) : NAV[r];
    const base = this.store.apiMode() ? adapted.filter((n) => API_PAGES.includes(n.page)) : adapted.filter((n) => !API_ONLY.includes(n.page));
    const open = this.store.school();
    const items = base.filter((n) => (n.page !== 'cahier' || r !== 'eleve' || open.eleveVoitCahier) && ((n.page !== 'devoirs' && n.page !== 'cours') || open.devoirsActifs));   // choix de l'école
    // Professeur principal : sa classe apparaît dans le menu dès que la direction ou le secrétariat la lui attribue
    if (r === 'enseignant' && this.store.myPrincipalClasses().length) items.splice(1, 0, { page: 'maclasse', label: 'Ma classe (prof. principal)', icon: 'users' });
    return items;
  });
  /** Pages du rôle courant, pour l’aide intégrée (le profil est toujours accessible par le menu du nom). */
  navPages = computed<PageId[]>(() => [...this.nav().map((n) => n.page), 'profil']);
  title = computed(() => {
    const p = this.store.page();
    if (p === 'eleve') return 'Fiche élève';
    if (p === 'profil') return 'Mon profil';
    return this.nav().find((n) => n.page === p)?.label ?? '';
  });
  activeNav = computed(() => (this.store.page() === 'eleve' ? 'eleves' : this.store.page()));
  results = computed(() => this.store.search(this.query()));
  showTerm = computed(() => ['notes', 'bulletins', 'dashboard', 'stats', 'maclasse'].includes(this.store.page()) && !['comptable', 'educateur'].includes(this.store.role() ?? ''));
  school = this.store.school;

  private idle: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (this.store.canResume) this.store.resuming.set(true);
    void this.store.resume().then((ok) => {
      if (ok) {
        const p = this.savedPage();
        if (p && this.navPages().includes(p)) this.store.page.set(p);
      } else { void this.store.loadPublicSchool(); void this.store.loadCaptcha(); }
    });
    startTranslator();
    startTableLabels();
    startCountUp();
    effect(() => {
      document.documentElement.style.setProperty('--hue', String(this.store.school().hue));
    });
    effect(() => {
      const p = this.store.page();
      if (this.store.userId()) { try { sessionStorage.setItem('ecole.page', p); } catch { /* sans effet */ } }
    });
    effect(() => {
      if (this.store.userId()) this.resetIdle();
      else clearTimeout(this.idle);
    });
    // Alertes sur le téléphone : état de cet appareil à chaque ouverture de session ; toucher une alerte ouvre sa page
    effect(() => {
      if (this.store.userId() && this.store.apiMode()) void this.push.init((p) => {
        void this.store.loadNotices();
        if (p && this.navPages().includes(p)) this.go(p);
      });
    });
  }

  @HostListener('document:click')
  @HostListener('document:keydown')
  onActivity(): void {
    if (this.store.userId()) this.resetIdle();
  }
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (!t.closest('.pop-host')) {
      this.userMenu.set(false);
      this.bellOpen.set(false);
      this.searchOpen.set(false);
    }
  }

  private savedPage(): PageId | null {
    try { return (sessionStorage.getItem('ecole.page') as PageId | null); } catch { return null; }
  }
  private resetIdle(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.store.logout();
      this.loginError.set('Session fermée après 20 minutes d’inactivité.');
    }, IDLE_MS);
  }

  readonly busy = signal(false);
  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.store.captcha() && !this.captchaAnswer.trim()) return void this.loginError.set('Répondez au calcul anti-robot.');
      const r = await this.store.loginAsync(this.username, this.password, this.captchaAnswer);
      this.captchaAnswer = '';
      if (!r.ok) this.loginError.set(r.error ?? '');
      else {
        this.loginError.set('');
        this.password = '';
      }
    } finally { this.busy.set(false); }
  }
  quick(username: string): void {
    this.store.login(username, 'demo');
    this.userMenu.set(false);
    this.menuOpen.set(false);
  }
  async savePw(): Promise<void> {
    if (this.newPw !== this.newPw2) return void this.pwError.set('Les deux mots de passe ne sont pas identiques.');
    const r = await this.store.changePasswordAsync(this.newPw);
    if (!r.ok) return void this.pwError.set(r.error ?? '');
    this.pwError.set('');
    this.newPw = this.newPw2 = '';
    this.store.toast('Mot de passe enregistré. Bienvenue !');
  }
  go(p: PageId): void {
    this.store.go(p);
    this.menuOpen.set(false);
  }
  pick(r: { kind: string; id: string }): void {
    this.query.set('');
    this.searchOpen.set(false);
    if (r.kind === 'eleve') this.store.go('eleve', r.id);
    else if (r.kind === 'classe') this.store.go(this.store.role() === 'enseignant' ? 'notes' : 'classes', r.id);
    else this.store.go('comptes', r.id);
  }
  openNotice(n: { id: string; page?: PageId }): void {
    void this.store.markReadAsync(n.id);
    this.bellOpen.set(false);
    if (n.page) this.go(n.page);
  }
}
