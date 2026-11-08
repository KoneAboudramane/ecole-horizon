import { AfterViewInit, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, output, signal } from '@angular/core';
import { ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../store';
import { ThemeToggle } from '../ui';

/** Ce que chaque profil trouve après connexion, regroupé en trois familles de comptes. */
interface Role { t: string; l: string[]; n: string; }
interface Group { k: string; t: string; w: string; roles: Role[]; }
const GROUPS: Group[] = [
  {
    k: 'familles', t: 'Familles', w: 'Parents, tuteurs et élèves suivent la scolarité depuis leur téléphone.',
    roles: [
      { t: 'Parents et tuteurs', l: ['Notes publiées et bulletins de chaque enfant', 'Absences du jour et justificatifs à envoyer en ligne', 'Solde de la scolarité, reçus, paiement par mobile money', 'Emploi du temps, devoirs, messages aux enseignants'], n: 'Vous ne voyez que vos propres enfants.' },
      { t: 'Élèves', l: ['Ses notes et son bulletin', 'Son emploi du temps et ses devoirs', 'Les annonces de l’école', 'Ses résultats aux examens blancs'], n: 'Un élève ne voit ni les autres élèves, ni les paiements.' },
    ],
  },
  {
    k: 'classes', t: 'Enseignants et vie scolaire', w: 'Les équipes pédagogiques saisissent une fois, au bon endroit.',
    roles: [
      { t: 'Enseignants', l: ['L’appel en quelques gestes', 'Les notes de leurs classes et matières', 'Le cahier de textes', 'Les messages aux parents'], n: 'Un enseignant ne voit que ses classes.' },
      { t: 'Éducateurs', l: ['Le suivi des absences et des retards', 'Les justificatifs à instruire', 'Les incidents et sanctions', 'Les statistiques de vie scolaire'], n: 'Les sanctions graves sont validées par la direction.' },
    ],
  },
  {
    k: 'administration', t: 'Administration', w: 'La direction pilote, le secrétariat et la comptabilité tiennent les dossiers.',
    roles: [
      { t: 'Direction', l: ['Publication des notes et clôture des trimestres', 'Conseils de classe et décisions de fin d’année', 'Statistiques pédagogiques et financières'], n: 'Seule la direction modifie une note verrouillée.' },
      { t: 'Secrétariat', l: ['Inscriptions, classes et matières', 'Comptes du personnel et des familles', 'Bulletins et annonces'], n: 'Le secrétariat ne publie pas les notes.' },
      { t: 'Comptabilité et fondateur', l: ['Paiements et reçus numérotés', 'Impayés et relances', 'Tarifs, échéances et encaissements'], n: 'Seule la comptabilité enregistre un paiement.' },
    ],
  },
];

/** Bulletin d'exemple (modèle Classique) : l'année d'une élève fictive, qui progresse d'un trimestre à l'autre. */
const SUBJECTS = [{ n: 'Mathématiques', c: 4 }, { n: 'Français', c: 4 }, { n: 'Anglais', c: 2 }, { n: 'SVT', c: 2 }];
const TERMS = [
  { t: '1ER TRIMESTRE', v: [15.0, 12.5, 13.75, 14.2], r: 6, m: 'Assez bien', stamp: 'Bulletin disponible' },
  { t: '2E TRIMESTRE', v: [16.25, 13.0, 14.5, 15.0], r: 3, m: 'Bien', stamp: 'Bulletin disponible' },
  { t: '3E TRIMESTRE', v: [17.0, 14.25, 15.0, 16.5], r: 2, m: 'Bien', stamp: 'Admise en 3e' },
];
/** Démonstration « saisie des notes » : un devoir de mathématiques en 4e B (données fictives). */
const NOTES = [['AKA Léa', 14], ['BAMBA Issa', 9.5], ['COULIBALY Fanta', 16], ['DIALLO Moussa', 12], ['KONAN Grâce', 17.5], ['KOUASSI Awa', 15], ['OUATTARA Ali', 11], ['YAO Esther', 13]] as const;
/** Démonstration « emploi du temps » : la semaine de la 4e B (jour 0 = lundi, créneau 0 = 7 h 30). */
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const SLOTS = ['7 h 30', '9 h 45', '14 h 00', '16 h 00'];
const COURSES = [
  { d: 0, s: 0, n: 'Maths', h: 155, room: 'Salle 12' }, { d: 1, s: 0, n: 'Français', h: 220, room: 'Salle 12' }, { d: 2, s: 0, n: 'Anglais', h: 30, room: 'Salle 8' },
  { d: 3, s: 0, n: 'Maths', h: 155, room: 'Salle 12' }, { d: 4, s: 0, n: 'SVT', h: 95, room: 'Laboratoire' }, { d: 0, s: 1, n: 'Hist.-géo', h: 15, room: 'Salle 12' },
  { d: 1, s: 1, n: 'Phys.-chimie', h: 265, room: 'Laboratoire' }, { d: 3, s: 1, n: 'Français', h: 220, room: 'Salle 12' }, { d: 4, s: 1, n: 'EDHC', h: 330, room: 'Salle 12' },
  { d: 0, s: 2, n: 'EPS', h: 50, room: 'Terrain' }, { d: 1, s: 2, n: 'Anglais', h: 30, room: 'Salle 8' }, { d: 3, s: 2, n: 'Arabe', h: 185, room: 'Salle 5' },
];
/** « Vous dirigez une école ? » : les atouts, chacun illustré par une petite scène animée. */
const FEATS = [
  { k: 'scolarite', t: 'La scolarité rentre à temps', d: 'Échéancier par tranches, relances aux familles, paiement par mobile money et reçus numérotés. L’école peut réserver le bulletin aux familles à jour.' },
  { k: 'bulletins', t: 'Des bulletins sans rien recopier', d: 'Moyennes, rangs et mentions calculés avec vos coefficients, moyenne annuelle pondérée, trois modèles de bulletin et un code QR contre les faux.' },
  { k: 'cursus', t: 'Une école franco-arabe sous un seul toit', d: 'Un cursus français et un cursus arabe, ou un autre : chacun ses classes, ses enseignants, son directeur et son bulletin, en arabe s’il le faut. La famille garde un seul compte et paie un forfait.' },
  { k: 'roles', t: 'Chacun à sa place', d: 'Direction, secrétariat, comptabilité, enseignants, éducateurs : chaque rôle a ses droits, et les actions sensibles sont inscrites au journal.' },
  { k: 'installer', t: 'Rien à installer', d: 'Tout passe par le navigateur du téléphone ou de l’ordinateur, en français, en arabe ou en anglais. Élèves et personnel s’importent depuis un fichier Excel.' },
];
const FEAT_MS = 7000;
const DEMO_HOLD = 9;                  // étapes (de 450 ms) pendant lesquelles le résultat reste affiché
const PROFILE_MS = 6000;              // durée d'affichage de chaque profil tant que le visiteur n'a rien choisi
const NOW = { d: 1, s: 1 };           // le cours « en ce moment »
const REPLACED = { d: 3, s: 1 };      // le cours remplacé

const MARQUEE = ['Notes et bulletins', 'Absences du jour', 'Scolarité par tranches', 'Paiement mobile money', 'Reçus numérotés', 'Emploi du temps', 'Cahier de textes',
  'Messages et annonces', 'Cursus franco-arabe', 'Bulletin en arabe', 'Code QR anti-fraude', 'Examens blancs'];

/** Page d'accueil publique : présente la plateforme aux familles (se connecter) et aux écoles (demander une démonstration). */
@Component({
  selector: 'app-vitrine',
  imports: [ThemeToggle, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `<div class="vt" data-i18n-skip lang="fr" dir="ltr">
<header class="vt-top" [class.scrolled]="scrolled()"><div class="vt-bar">
  <a class="vt-brand" href="#" (click)="scroll($event, 'top')">@if (site().logo) { <img [src]="site().logo" alt="" /> } @else { <span class="vt-mark">{{ initial() }}</span> }<span>{{ site().name }}</span></a>
  <nav class="vt-nav" aria-label="Sections de la page" [class.open]="menu()">
    @for (l of navLinks; track l.id) { <a [href]="'#' + l.id" [class.on]="active() === l.id" [attr.aria-current]="active() === l.id ? 'true' : null" (click)="menu.set(false); scroll($event, l.id)">{{ l.t }}</a> }
  </nav>
  <span class="vt-tools"><app-theme /></span>
  <button type="button" class="vt-btn vt-login" aria-label="Se connecter" title="Se connecter" (click)="go()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg><span class="lg">Se connecter</span><span class="sm">Connexion</span></button>
  <button type="button" class="vt-burger" [attr.aria-expanded]="menu()" aria-label="Menu" (click)="menu.update((m) => !m)"><i></i><i></i><i></i></button>
</div><i class="vt-progress" aria-hidden="true" [style.--sp]="progress()"></i></header>

<main>
<section class="vt-hero" id="top" [class.photos]="slides().length > 0">
@if (slides().length) {
  <div class="vt-slides" aria-hidden="true">@for (p of slides(); track p.id; let i = $index) { <img [src]="p.url" alt="" [class.cur]="i === slide()" [attr.loading]="i ? 'lazy' : 'eager'" /> }</div>
  @if (slides()[slide()].caption) { @for (k of [slide()]; track k) { <p class="vt-cap">{{ slides()[slide()].caption }}</p> } }
}
<div class="vt-wrap vt-hero-grid" [class.solo]="!carte()">
  <div class="vt-hero-text">
    <h1><span class="vt-l" style="--i:0">Le bulletin de votre</span> <span class="vt-l" style="--i:1">enfant arrive sur</span> <span class="vt-l" style="--i:2">votre téléphone.</span></h1>
    <p class="vt-lead vt-in" style="--i:3">Notes, absences, scolarité et messages de l’école, au même endroit. Les familles suivent, les équipes saisissent une seule fois.</p>
    <div class="vt-doors vt-in" style="--i:4">
      <button type="button" class="vt-door main" (click)="go()"><b><em>J’ai un compte</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></b><span>Parent, élève ou personnel : se connecter</span></button>
      <a class="vt-door" href="#ecoles" (click)="scroll($event, 'ecoles')"><b><em>Je dirige une école</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></b><span>Découvrir la plateforme et demander une démonstration</span></a>
    </div>
  </div>
  @if (carte()) {
  <figure class="vt-paper vt-in" style="--i:2" aria-label="Exemple de bulletin au modèle Classique, avec des données fictives">
    <div class="vt-bl-head"><div><b>Collège moderne de Bouaké</b><span>BP 120 Bouaké</span></div>
      <div class="r"><span>République de Côte d’Ivoire</span><i>Union – Discipline – Travail</i><span>Année scolaire 2026-2027</span></div></div>
    <p class="vt-bl-title">BULLETIN DE NOTES · @for (k of [term()]; track k) { <span class="vt-swap">{{ cur3().t }}</span> }</p>
    <div class="vt-bl-id"><b>KOUASSI Awa</b><span>Classe : 4e B (41 élèves)</span><span>Matricule : CMB26-0412</span></div>
    <table class="vt-bl-table">
      <thead><tr><th>Matières</th><th>Coef.</th><th>Moy./20</th><th>Points</th><th>Rang</th></tr></thead>
      <tbody>
        @for (sb of subjects; track sb.n; let i = $index) {
          <tr [style.--r]="i"><td>{{ sb.n }}</td><td class="c">{{ sb.c }}</td><td class="n"><b>{{ num(vals()[i]) }}</b></td><td class="n">{{ num(vals()[i] * sb.c, 1) }}</td><td class="c">{{ i === 0 ? cur3().r : i + cur3().r }}e</td></tr>
        }
      </tbody>
    </table>
    <div class="vt-bl-sum"><div><span>Moyenne générale</span><b>{{ num(avg()) }} / 20</b></div><div><span>Rang</span><b>{{ cur3().r }}e / 41</b></div><div><span>Mention</span>@for (k of [term()]; track k) { <b class="vt-swap">{{ cur3().m }}</b> }</div></div>
    <div class="vt-bl-foot"><span class="vt-qr" aria-hidden="true"></span><span>Le directeur</span></div>
    @for (k of [term()]; track k) { <span class="vt-stamp" aria-hidden="true">{{ cur3().stamp }}</span> }
    <div class="vt-bl-dots" aria-hidden="true">@for (x of terms; track $index; let i = $index) { <i [class.on]="i === term()"></i> }</div>
    <figcaption>Exemple, données fictives</figcaption>
  </figure>
  }
</div></section>

<div class="vt-marquee" aria-hidden="true"><div class="vt-track">@for (w of marqueeTwice; track $index) { <span>{{ w }}</span> }</div></div>

@if (figures().length || visits().length) {
<section class="vt-figures" aria-label="La plateforme en chiffres"><div class="vt-wrap">
  <div class="vt-fig-head"><h3 class="vt-fig-title">La plateforme en chiffres</h3><span class="vt-fig-live"><i class="vt-dot" aria-hidden="true"></i>Chiffres réels, mis à jour en continu</span></div>
  @if (figures().length) { <div class="vt-fig-grid" [style.--n]="figures().length">
    @for (f of figures(); track f.k; let i = $index) {
      <div class="vt-fig" [style.--k]="i">
        <div class="vt-fig-top"><span class="vt-fig-ic" aria-hidden="true"><svg viewBox="0 0 24 24">
          @switch (f.k) {
            @case ('ecoles') { <path pathLength="1" d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5M12 9.5v.01" /> }
            @case ('eleves') { <path pathLength="1" d="M2 9l10-5 10 5-10 5-10-5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v5" /> }
            @case ('connectes') { <path pathLength="1" d="M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6" /> }
            @default { <path pathLength="1" d="M6 2h12v20l-3-2-3 2-3-2-3 2V2zM9 7h6M9 11h6M9 15h4" /> }
          }
        </svg></span>
        <b [attr.data-to]="f.v">{{ f.v }}</b></div><span class="vt-fig-l">{{ f.l }}</span><i class="vt-fig-bar" aria-hidden="true"></i>
      </div>
    }
  </div> }
  @if (visits().length) { <div class="vt-visits">
    <span class="vt-visits-t"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>Visiteurs de cette page</span>
    @for (v of visits(); track v.k) { <span class="vt-visit"><b [attr.data-to]="v.v">{{ v.v }}</b><small>{{ v.l }}</small></span> }
  </div> }
</div></section>
}


<section class="vt-sec vt-demo" id="equipes"><div class="vt-wrap vt-demo-grid">
  <div class="vt-demo-text">
    <h2>Pour les équipes&nbsp;: tout se fait en quelques gestes</h2>
    <p class="vt-sub">Ce que l’enseignant saisit en classe arrive aussitôt dans le bulletin et chez les familles. Personne ne recopie rien.</p>
    <div class="vt-demo-tabs" role="tablist" aria-label="Démonstrations" [style.--ti]="demo() === 'notes' ? 0 : 1">
      <span class="vt-demo-pill" aria-hidden="true"><i [style.--p]="demoProgress()"></i></span>
      <button type="button" role="tab" [attr.aria-selected]="demo() === 'notes'" (click)="showDemo('notes')">Saisie des notes</button>
      <button type="button" role="tab" [attr.aria-selected]="demo() === 'edt'" (click)="showDemo('edt')">Emploi du temps</button>
    </div>
    @if (demo() === 'notes') {
      <ul class="vt-demo-points"><li>L’enseignant saisit les notes de sa classe, sur téléphone ou ordinateur.</li><li>Moyennes, rangs et appréciations se calculent avec vos coefficients et vos seuils.</li><li>La direction publie : les familles sont prévenues le jour même.</li></ul>
    } @else {
      <ul class="vt-demo-points"><li>La semaine de chaque classe, avec ses salles et ses enseignants.</li><li>Un remplacement s’affiche aussitôt pour la classe et les familles.</li><li>Chaque enseignant voit son propre emploi du temps.</li></ul>
    }
  </div>
  <div class="vt-app" (mouseenter)="demoPaused.set(true)" (mouseleave)="demoPaused.set(false)" aria-label="Démonstration animée de l’application, données fictives">
    <aside class="vt-app-side" aria-hidden="true">
      <span class="vt-app-logo">{{ initial() }}</span>
      <span class="vt-app-nav">Accueil</span>
      <span class="vt-app-nav" [class.on]="demo() === 'notes'">Notes</span>
      <span class="vt-app-nav" [class.on]="demo() === 'edt'">Emploi du temps</span>
      <span class="vt-app-nav">Bulletins</span>
      <span class="vt-app-nav">Élèves</span>
    </aside>
    <div class="vt-app-main">
      <div class="vt-app-top">
        <span class="vt-crumb">@if (demo() === 'notes') { Notes <i>›</i> 4e B <i>›</i> <b>Mathématiques</b> } @else { Emploi du temps <i>›</i> <b>4e B</b> }</span>
        <span class="vt-app-chips"><span class="vt-chip">1er trimestre</span>
          @if (demo() === 'notes') { <span class="vt-status" [class.ok]="step() > notes.length + 1">{{ step() > notes.length + 1 ? 'Publié' : 'Brouillon' }}</span> }
          @else { <span class="vt-chip">Semaine du 12 octobre</span> }</span>
      </div>
      @if (demo() === 'notes') {
        <div class="vt-notes">
          <div class="vt-notes-head"><b>Devoir n° 2</b>@if (step() > notes.length + 1) { <span class="vt-done-msg" role="status">Notes publiées : les familles sont prévenues.</span> } @else { <span>Coefficient 1, barème sur 20, 8 élèves</span> }</div>
          <table>
            <thead><tr><th>Élève</th><th class="m">Matricule</th><th>Note /20</th><th class="m">Appréciation</th></tr></thead>
            <tbody>
              @for (r of notes; track r[0]; let i = $index) {
                <tr [class.cur]="i === step() && step() < notes.length"><td>{{ r[0] }}</td><td class="m mono">CMB26-04{{ 10 + i }}</td>
                  <td><span class="vt-cell">@if (i < step()) { <b class="vt-typed">{{ num(r[1], 2) }}</b> }@if (i === step() && step() < notes.length) { <i class="vt-caret"></i> }</span></td>
                  <td class="m appr">@if (i < step()) { <span class="vt-typed-in">{{ appreciation(r[1]) }}</span> }</td></tr>
              }
            </tbody>
          </table>
          <div class="vt-notes-foot">
            <div class="vt-kpis"><span>Moyenne <b>{{ notesAvg() === null ? '—' : num(notesAvg()!, 2) }}</b></span><span>Plus haute <b>{{ notesMax() === null ? '—' : num(notesMax()!, 2) }}</b></span><span>Plus basse <b>{{ notesMin() === null ? '—' : num(notesMin()!, 2) }}</b></span></div>
            <span class="vt-publish" [class.pressed]="step() === notes.length + 1" [class.done]="step() > notes.length + 1">{{ step() > notes.length + 1 ? 'Publié aux familles' : 'Publier aux familles' }}</span>
          </div>
        </div>
      } @else {
        <div class="vt-edt">
          <span></span>@for (d of days; track d; let di = $index) { <span class="vt-edt-day" [class.today]="di === now.d">{{ d }}</span> }
          @for (sl of slots; track sl; let si = $index) {
            <span class="vt-edt-slot">{{ sl }}</span>
            @for (d of days; track d; let di = $index) {
              <span class="vt-edt-cell" [class.today]="di === now.d">
                @if (course(di, si); as c) { @if (c.i < step()) {
                  <span class="vt-course" [style.--h]="c.h" [class.live]="step() > courses.length && di === now.d && si === now.s">
                    <b>{{ c.n }}</b><small>{{ c.room }}</small>
                    @if (step() > courses.length && di === now.d && si === now.s) { <em class="now">En cours</em> }
                    @if (step() > courses.length + 1 && di === replaced.d && si === replaced.s) { <em class="rep">Remplacé par M. Koné</em> }
                  </span>
                } }
              </span>
            }
          }
        </div>
      }
      <span class="vt-screen-cap">Démonstration, données fictives</span>
    </div>
  </div>
</div></section>

<section class="vt-sec" id="familles"><div class="vt-wrap">
  <h2>Ce qui arrive sur le téléphone des familles</h2>
  <p class="vt-sub">Pas de carnet perdu, pas de déplacement pour un reçu : l’information part de l’école et arrive le jour même.</p>
  <div class="vt-objects">
    <figure class="vt-obj"><div class="vt-notif"><b>Absence signalée</b><span>Awa n’était pas en cours de 8 h à 10 h. Vous pouvez envoyer un justificatif depuis l’application.</span><i>Aujourd’hui, 10 h 05</i></div>
      <figcaption>Les absences, le jour même</figcaption></figure>
    <figure class="vt-obj"><div class="vt-receipt"><b>Reçu n° REC-2026-00029</b><span>Scolarité, 2e tranche</span><strong>75 000 FCFA</strong><span>Reste à payer : 0 FCFA</span></div>
      <figcaption>Un reçu pour chaque paiement</figcaption></figure>
    <figure class="vt-obj"><div class="vt-check"><span class="vt-qr big" aria-hidden="true"></span><div><b>Bulletin authentique</b><span>Ce document correspond aux notes enregistrées par l’école.</span></div></div>
      <figcaption>Un bulletin qu’on ne peut pas falsifier</figcaption></figure>
    <figure class="vt-obj"><div class="vt-annonce"><b>Réunion des parents</b><span>Samedi à 9 h, dans la cour de l’école. Présence souhaitée.</span></div>
      <figcaption>Les annonces de l’école</figcaption></figure>
  </div>

  <div class="vt-space">
  <div class="vt-space-head"><h3 class="vt-h3">Un espace pour chacun</h3><p>Chaque compte ouvre sur ce qui le concerne, et seulement cela.</p></div>
  <div class="vt-tabs" role="tablist" aria-label="Profils" (keydown)="key($event)" (mouseenter)="profPaused.set(true)" (mouseleave)="profPaused.set(false)">
    @for (g of groups; track g.k; let i = $index) {
      <button type="button" role="tab" [id]="'vt-tab-' + i" aria-controls="vt-panel" [attr.aria-selected]="sel() === i" [tabindex]="sel() === i ? 0 : -1" (click)="pickProfile(i)">{{ g.t }}</button>
    }
    <span class="vt-ink" aria-hidden="true" [style.left.px]="inkL()" [style.width.px]="inkW()"><i [style.--p]="profProgress()"></i></span>
  </div>
  @for (g of [cur()]; track g.k) {
  <div class="vt-panel" id="vt-panel" role="tabpanel" tabindex="0" [attr.aria-labelledby]="'vt-tab-' + sel()" (mouseenter)="profPaused.set(true)" (mouseleave)="profPaused.set(false)">
    <div class="vt-space-body">
      <div>
        <p class="vt-panel-w">{{ g.w }}</p>
        <div class="vt-roles" [style.--cols]="g.roles.length">
          @for (r of g.roles; track r.t) { <div><h4>{{ r.t }}</h4><ul>@for (x of r.l; track x) { <li>{{ x }}</li> }</ul><p class="vt-note">{{ r.n }}</p></div> }
        </div>
      </div>
      <div class="vt-phone" aria-hidden="true"><div class="vt-phone-screen">
        @switch (g.k) {
          @case ('familles') {
            <div class="vt-ph-top"><span>Bonjour</span><b>KOUASSI Awa, 4e B</b></div>
            <div class="vt-ph-hero"><span>Moyenne du 1er trimestre</span><b>13,83</b><small>6e sur 41, Assez bien</small></div>
            <div class="vt-ph-row"><i class="ok"></i><span>Aucune absence aujourd’hui</span></div>
            <div class="vt-ph-row"><i class="ok"></i><span>Scolarité soldée</span><b>0 FCFA</b></div>
            <div class="vt-ph-row"><i class="info"></i><span>Prochain cours : Maths</span><b>9 h 45</b></div>
            <div class="vt-ph-row"><i class="warn"></i><span>Réunion des parents samedi</span></div>
          }
          @case ('classes') {
            <div class="vt-ph-top"><span>Appel, 7 h 30</span><b>4e B, Mathématiques</b></div>
            @for (e of appel; track e[0]; let i = $index) {
              <div class="vt-ph-call" [style.--d]="i"><span>{{ e[0] }}</span><em [class]="e[1]">{{ e[1] === 'p' ? 'Présent' : e[1] === 'a' ? 'Absent' : 'Retard' }}</em></div>
            }
            <div class="vt-ph-done">Appel envoyé : les parents de l’élève absent sont prévenus.</div>
          }
          @default {
            <div class="vt-ph-top"><span>Tableau de bord</span><b>Collège, 1er trimestre</b></div>
            <div class="vt-ph-kpis"><div><span>Scolarité encaissée</span><b>82 %</b><i style="--w:82%"></i></div><div><span>Bulletins publiés</span><b>41 sur 41</b><i style="--w:100%"></i></div></div>
            <div class="vt-ph-chart"><span>Absences de la semaine</span>
              <div class="vt-ph-bars">@for (b of absences; track $index) { <i [style.--v]="b" [style.--d]="$index"></i> }</div>
              <div class="vt-ph-days"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span></div></div>
            <div class="vt-ph-row"><i class="warn"></i><span>12 familles à relancer</span></div>
          }
        }
      </div></div>
    </div>
  </div>
  }
  </div>

  <h3 class="vt-h3">Se connecter en trois étapes</h3>
  <ol class="vt-steps">
    <li><b>Recevez vos accès</b><span>L’école vous remet un identifiant et un mot de passe provisoire. Il n’y a pas d’inscription en ligne.</span></li>
    <li><b>Connectez-vous</b><span>Saisissez vos accès, puis choisissez votre propre mot de passe.</span></li>
    <li><b>Suivez la scolarité</b><span>Notes, absences, paiements et messages, quand vous voulez.</span></li>
  </ol>
</div></section>

<section class="vt-schools" id="ecoles"><div class="vt-wrap">
  <h2>Vous dirigez une école&nbsp;?</h2>
  <p class="vt-sub">La plateforme réunit la scolarité, les notes, les bulletins et la vie scolaire. Vos équipes saisissent une fois, les familles suivent en direct.</p>
  <div class="vt-feats" (mouseenter)="featPaused.set(true)" (mouseleave)="featPaused.set(false)">
    <div class="vt-feat-list" role="tablist" aria-label="Ce que la plateforme apporte à l’école">
      @for (x of feats; track x.k; let i = $index) {
        <button type="button" role="tab" [attr.aria-selected]="feat() === i" [class.star]="x.k === 'cursus'" (click)="pickFeat(i)">
          <b>{{ x.t }}</b><span>{{ x.d }}</span><i class="vt-feat-bar" [style.--p]="feat() === i ? featProgress() : 0"></i>
        </button>
      }
    </div>
    <div class="vt-stage" aria-hidden="true">
      @for (k of [feats[feat()].k]; track k) {
      <div class="vt-stage-in">
        @switch (k) {
          @case ('scolarite') {
            <div class="vt-sc-card">
              <div class="vt-sc-head"><b>Échéancier de KOUASSI Awa</b><span>4e B, année 2026-2027</span></div>
              <div class="vt-sc-row"><span>1re tranche, octobre</span><b>75 000 FCFA</b><em class="ok">Payée</em></div>
              <div class="vt-sc-row"><span>2e tranche, janvier</span><b>60 000 FCFA</b><em class="flip"><i>À venir</i><i>Payée</i></em></div>
              <div class="vt-sc-row"><span>3e tranche, avril</span><b>45 000 FCFA</b><em>À venir</em></div>
              <div class="vt-sc-total"><span>Réglé : 135 000 sur 180 000 FCFA</span><i></i></div>
            </div>
            <div class="vt-sc-toast"><b>Paiement mobile money reçu</b><span>60 000 FCFA, reçu n° R-2026-0412 envoyé à la famille</span></div>
          }
          @case ('bulletins') {
            <div class="vt-bu-card">
              <div class="vt-bu-head"><b>Bulletin du 3e trimestre</b><span>KOUASSI Awa, 4e B</span></div>
              @for (m of bulletinBars; track m.n; let i = $index) {
                <div class="vt-bu-row" [style.--d]="i"><span>{{ m.n }}</span><small>coef. {{ m.c }}</small><i [style.--w]="m.v * 5 + '%'"></i><b>{{ num(m.v, 2) }}</b></div>
              }
              <div class="vt-bu-foot"><div><span>Moyenne annuelle</span><b>15,21</b><small>2e sur 41, admise en 3e</small></div><span class="vt-bu-qr"></span></div>
            </div>
          }
          @case ('cursus') {
            <div class="vt-cu-pair">
              <div class="vt-cu-doc"><small>Cursus français</small><b>Bulletin de notes</b><span>Moyenne : 14,80</span></div>
              <div class="vt-cu-doc" dir="rtl" lang="ar"><small>المسار العربي</small><b>كشف النقاط</b><span>المعدل : 15,40</span></div>
            </div>
            <div class="vt-cu-link"><i></i><i></i></div>
            <div class="vt-cu-family"><b>Un seul compte famille</b><span>Un forfait pour les deux cursus : tarif principal et complément</span></div>
          }
          @case ('roles') {
            <div class="vt-ro-grid">
              @for (r of rights; track $index; let i = $index) {
                <div class="vt-ro-row" [style.--d]="i"><b>{{ r[0] }}</b><span>{{ r[1] }}</span><em [class.no]="!r[2]">{{ r[2] ? 'Autorisé' : 'Non' }}</em></div>
              }
            </div>
            <div class="vt-ro-log"><small>Journal</small>
              <div [style.--d]="0"><time>08 h 14</time>La direction a publié les notes de la 4e B</div>
              <div [style.--d]="1"><time>08 h 20</time>La comptabilité a enregistré le reçu R-2026-0412</div>
            </div>
          }
          @default {
            <div class="vt-in-laptop"><div class="vt-in-screen">
              <div class="vt-in-file"><b>eleves-2026.xlsx</b><span>Importation des élèves</span></div>
              <div class="vt-in-bar"><i></i></div>
              <div class="vt-in-done"><b>312 élèves importés</b><span>dans 14 classes, avec leurs parents</span></div>
            </div></div>
            <div class="vt-in-langs"><span>Français</span><span lang="ar">العربية</span><span>English</span></div>
          }
        }
      </div>
      }
    </div>
  </div>

  <div class="vt-deal">
    <div class="vt-deal-side">
      <div class="vt-price">
        @if (prix(); as p) { <b>{{ fcfa(p.inscription) }}</b><span>à l’inscription, puis {{ fcfa(p.renouvellement) }} par an, pour toute l’école. Paiement possible en plusieurs fois.</span> }
        @else { <b>Tarif sur demande</b><span>Un abonnement par école, pour tous ses élèves et tous ses comptes.</span> }
      </div>
      <ul class="vt-deal-list">
        <li>Tous les élèves et tous les comptes de l’école</li>
        <li>Tous vos cursus : français, arabe ou autre</li>
        <li>Rien à installer : un navigateur suffit</li>
        <li>Vos élèves et votre personnel importés depuis Excel</li>
      </ul>
      @if (wa() || tel() || contact().email) { <p class="vt-deal-contact">Une question&nbsp;? @if (wa()) { <a [href]="wa()" target="_blank" rel="noopener">WhatsApp</a> }@if (wa() && tel()) { , } @if (tel()) { <a [href]="'tel:' + tel()">{{ contact().telephone }}</a> }@if ((wa() || tel()) && contact().email) { , } @if (contact().email) { <a [href]="'mailto:' + contact().email">{{ contact().email }}</a> }</p> }
    </div>
    <div class="vt-offer">
      @if (sent()) {
        <div class="vt-done" role="status"><b>Merci, votre demande est envoyée.</b><span>Nous vous appelons très vite pour convenir d’une démonstration.</span>
          @if (wa()) { <a class="vt-btn" [href]="wa()" target="_blank" rel="noopener">Écrire sur WhatsApp</a> }</div>
      } @else {
      <form class="vt-form" (ngSubmit)="send()" novalidate>
        <h3>Demander une démonstration</h3>
        <label><span>Nom de l’école</span><input name="ecole" [(ngModel)]="f.ecole" autocomplete="organization" required />@if (err()['ecole']) { <em>{{ err()['ecole'] }}</em> }</label>
        <label><span>Ville</span><input name="ville" [(ngModel)]="f.ville" autocomplete="address-level2" /></label>
        <label><span>Votre nom</span><input name="nom" [(ngModel)]="f.nom" autocomplete="name" required />@if (err()['nom']) { <em>{{ err()['nom'] }}</em> }</label>
        <label><span>Téléphone ou WhatsApp</span><input name="telephone" [(ngModel)]="f.telephone" type="tel" autocomplete="tel" required />@if (err()['telephone']) { <em>{{ err()['telephone'] }}</em> }</label>
        <label class="wide"><span>E-mail (facultatif)</span><input name="email" [(ngModel)]="f.email" type="email" autocomplete="email" />@if (err()['email']) { <em>{{ err()['email'] }}</em> }</label>
        <label class="wide"><span>Votre besoin (facultatif)</span><textarea name="message" rows="3" [(ngModel)]="f.message" placeholder="Nombre d’élèves, cursus franco-arabe…"></textarea></label>
        <label class="vt-hp" aria-hidden="true"><span>Site</span><input name="site" [(ngModel)]="f.site" tabindex="-1" autocomplete="off" /></label>
        @if (err()['_']) { <p class="vt-err" role="alert">{{ err()['_'] }}</p> }
        <button type="submit" class="vt-btn wide" [disabled]="busy()">{{ busy() ? 'Envoi…' : 'Demander une démonstration' }}</button>
        @if (wa() || tel() || contact().email) { <p class="vt-alt">Ou contactez-nous directement : @if (wa()) { <a [href]="wa()" target="_blank" rel="noopener">WhatsApp</a> }@if (wa() && tel()) { , } @if (tel()) { <a [href]="'tel:' + tel()">{{ contact().telephone }}</a> }@if ((wa() || tel()) && contact().email) { , } @if (contact().email) { <a [href]="'mailto:' + contact().email">{{ contact().email }}</a> }</p> }
      </form>
      }
    </div>
  </div>
</div></section>

<section class="vt-sec vt-trust"><div class="vt-wrap vt-trust-grid">
  <div class="vt-trust-text">
    <h2>Vos données restent à l’école</h2>
    <p class="vt-sub">Notes, paiements et dossiers des élèves ne sont visibles que par les personnes qui en ont besoin.</p>
    <div class="vt-vault" aria-hidden="true">
      <svg class="vt-shield" viewBox="0 0 120 140">
        <path class="sh" pathLength="1" d="M60 6l46 16v38c0 32-20 58-46 72C34 118 14 92 14 60V22z" />
        <path class="lk" pathLength="1" d="M45 66V54a15 15 0 0130 0v12" />
        <rect class="bd" x="38" y="64" width="44" height="34" rx="7" />
        <path class="ck" pathLength="1" d="M50 81l7 7 13-14" />
      </svg>
      <span class="vt-orbit o1">Ses enfants</span><span class="vt-orbit o2">Ses classes</span><span class="vt-orbit o3">Journal</span>
    </div>
  </div>
  <ul class="vt-promises">
    <li><span class="vt-pr-ic"><svg viewBox="0 0 24 24"><path pathLength="1" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z" /></svg></span>
      <div><b>Chacun ne voit que ce qui le concerne</b><span>Une famille voit ses enfants, un enseignant ses classes. Chaque école a ses données séparées des autres.</span></div></li>
    <li><span class="vt-pr-ic"><svg viewBox="0 0 24 24"><path pathLength="1" d="M15 7a4 4 0 11-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0115 7zM16 10v.01" /></svg></span>
      <div><b>Un mot de passe personnel</b><span>Le mot de passe remis par l’école doit être changé à la première connexion.</span></div></li>
    <li><span class="vt-pr-ic"><svg viewBox="0 0 24 24"><path pathLength="1" d="M3 12h4l3-8 4 16 3-8h4" /></svg></span>
      <div><b>Des accès surveillés</b><span>Le compte se bloque après plusieurs essais ratés, et les actions sensibles sont inscrites au journal.</span></div></li>
  </ul>
</div></section>

<section class="vt-sec" id="faq"><div class="vt-wrap">
  <h2>Questions fréquentes</h2>
  <div class="vt-faq">
    <div><h3 class="vt-h3">Pour les familles</h3>
      <details><summary>J’ai oublié mon mot de passe.</summary><p>Adressez-vous à l’école : elle vous remet un nouveau mot de passe provisoire, à changer à la connexion.</p></details>
      <details><summary>Un parent peut-il suivre plusieurs enfants ?</summary><p>Oui. Tous vos enfants inscrits dans l’école apparaissent dans le même espace, même s’ils suivent deux cursus.</p></details>
      <details><summary>Faut-il installer une application ?</summary><p>Non. Le site s’ouvre dans le navigateur du téléphone ou de l’ordinateur.</p></details>
      <details><summary>Les notes sont-elles visibles tout de suite ?</summary><p>Non. Elles apparaissent quand la direction les publie, après contrôle.</p></details>
    </div>
    <div><h3 class="vt-h3">Pour les écoles</h3>
      <details><summary>Comment démarrer ?</summary><p>Nous créons votre école et les comptes de la direction. Vous importez ensuite les élèves et le personnel depuis un fichier Excel, et chacun reçoit ses accès.</p></details>
      <details><summary>Gérez-vous les écoles franco-arabes ?</summary><p>Oui. Chaque cursus a ses classes, ses enseignants, son directeur et son bulletin, en arabe pour le cursus arabe. Un élève peut suivre les deux, avec un forfait unique.</p></details>
      <details><summary>Comment les familles paient-elles ?</summary><p>À la caisse de l’école, avec un reçu numéroté, ou par mobile money selon l’opérateur activé par l’école.</p></details>
      <details><summary>Qui voit les données de notre école ?</summary><p>Uniquement vos équipes et vos familles, chacun selon son rôle. Les données de chaque école sont séparées.</p></details>
    </div>
  </div>
</div></section>
</main>

<footer class="vt-foot">
  <div class="vt-wrap"><div class="vt-foot-cta">
    <div><b>Prêt à mettre votre école en ligne&nbsp;?</b><span>Une démonstration avec vos classes, vos tarifs et vos bulletins.</span></div>
    <div class="vt-foot-cta-btns"><a class="vt-btn alt" href="#ecoles" (click)="scroll($event, 'ecoles')">Demander une démonstration</a>
      @if (wa()) { <a class="vt-btn ghost" [href]="wa()" target="_blank" rel="noopener">Écrire sur WhatsApp</a> }</div>
  </div></div>
  <div class="vt-wrap vt-foot-grid">
    <div class="vt-foot-brand">
      <a class="vt-brand" href="#" (click)="scroll($event, 'top')">@if (site().logo) { <img [src]="site().logo" alt="" /> } @else { <span class="vt-mark">{{ initial() }}</span> }<span>{{ site().name }}</span></a>
      <p>La scolarité, les notes, les bulletins et la vie de l’école, en ligne. Pour les écoles privées, laïques et confessionnelles, y compris franco-arabes.</p>
      <div class="vt-foot-langs"><span>Français</span><span lang="ar">العربية</span><span>English</span></div>
    </div>
    <nav class="vt-foot-col" aria-label="Plateforme"><h4>Plateforme</h4>
      <a href="#equipes" (click)="scroll($event, 'equipes')">Pour les équipes</a>
      <a href="#familles" (click)="scroll($event, 'familles')">Pour les familles</a>
      <a href="#ecoles" (click)="scroll($event, 'ecoles')">Pour les écoles</a>
      <a href="#faq" (click)="scroll($event, 'faq')">Questions fréquentes</a>
      <button type="button" (click)="go()">Se connecter</button>
    </nav>
    <div class="vt-foot-col"><h4>Fonctions</h4>
      <span>Notes et bulletins</span><span>Scolarité et paiements</span><span>Absences et discipline</span><span>Emploi du temps</span><span>Cursus franco-arabe</span>
    </div>
    <div class="vt-foot-col"><h4>Contact</h4>
      @if (wa()) { <a class="ic" [href]="wa()" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4-1.1z" /></svg>WhatsApp : {{ contact().whatsapp }}</a> }
      @if (tel()) { <a class="ic" [href]="'tel:' + tel()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>{{ contact().telephone }}</a> }
      @if (contact().email) { <a class="ic" [href]="'mailto:' + contact().email"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" /></svg>{{ contact().email }}</a> }
      @if (!wa() && !tel() && !contact().email) { <a href="#ecoles" (click)="scroll($event, 'ecoles')">Écrivez-nous avec le formulaire de démonstration</a> }
    </div>
  </div>
  <div class="vt-wrap vt-foot-word" aria-hidden="true" [style.--len]="site().name.length || 10">{{ site().name }}</div>
  <div class="vt-wrap vt-foot-bottom"><span>© {{ year }} {{ site().name }}. Tous droits réservés.</span><span>Conçu pour les écoles d’Afrique de l’Ouest.</span>
    <a class="vt-totop" href="#top" (click)="scroll($event, 'top')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>Haut de page</a></div>
</footer>
</div>`,
  styles: `
.vt{--slate:hsl(var(--hue) 32% 15%);--slate-2:hsl(var(--hue) 28% 21%);--chalk:#f1efe6;--ink-stamp:#4338a8;--craie:#f2c14e;--paper:#fffdf7;--paper-ink:#1d2421;
  --vt-muted:color-mix(in srgb,var(--ink) 62%,var(--bg));background:var(--bg);color:var(--ink);font:18px/1.6 var(--font);min-height:100vh;text-align:left;overflow-x:clip}
.vt *{box-sizing:border-box}
.vt a{color:inherit}
.vt h1,.vt h2,.vt h3,.vt h4{font-family:var(--font-display);letter-spacing:-.02em;margin:0;text-wrap:balance}
.vt .vt-wrap{max-width:1180px;margin:0 auto;padding:0 16px}
.vt :focus-visible{outline:3px solid var(--craie);outline-offset:3px;border-radius:6px}

/* En-tête */
.vt .vt-top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid transparent;transition:box-shadow .3s,border-color .3s,background .3s}
.vt .vt-top.scrolled{border-bottom-color:var(--line);box-shadow:0 10px 30px -22px rgba(0,0,0,.45);background:color-mix(in srgb,var(--bg) 96%,transparent)}
.vt .vt-bar{display:flex;align-items:center;gap:22px;min-height:68px;padding:0 clamp(16px,3.2vw,48px);transition:min-height .3s}
.vt .vt-top.scrolled .vt-bar{min-height:58px}
.vt .vt-brand{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none;font-family:var(--font-display);font-size:19px}
.vt .vt-brand img{width:36px;height:36px;object-fit:contain;border-radius:8px}
.vt .vt-mark{width:36px;height:36px;border-radius:10px;background:var(--slate);color:var(--chalk);display:grid;place-items:center;font-weight:800}
.vt .vt-bar nav{margin-inline-start:auto;display:flex;gap:4px;padding:4px;border-radius:99px;background:color-mix(in srgb,var(--ink) 5%,transparent)}
.vt .vt-bar nav a{text-decoration:none;color:var(--vt-muted);font-weight:600;font-size:15.5px;position:relative;padding:7px 16px;border-radius:99px;transition:color .25s,background .3s}
.vt .vt-bar nav a:hover{color:var(--ink)}
.vt .vt-bar nav a.on{color:var(--ink);background:var(--surface);box-shadow:0 4px 12px -8px rgba(0,0,0,.45)}
.vt .vt-bar nav a.on:before{content:"";position:absolute;left:50%;bottom:3px;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:var(--craie);animation:vt-pop .35s cubic-bezier(.2,1.4,.4,1) both}
.vt .vt-progress{position:absolute;left:0;bottom:-1px;height:3px;width:100%;background:var(--craie);transform:scaleX(var(--sp,0));transform-origin:left;transition:transform .1s linear}
.vt .vt-btn.vt-login{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;flex:none;position:relative;overflow:hidden;transition:transform .2s,box-shadow .3s}
.vt .vt-login svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .25s}
.vt .vt-login:hover{transform:translateY(-1px);box-shadow:0 10px 22px -12px var(--brand)}
.vt .vt-login:hover svg{transform:translateX(3px)}
.vt .vt-login:after{content:none}
@keyframes vt-shine{0%,70%{left:-60%}100%{left:130%}}
.vt .vt-burger{display:none;width:42px;height:42px;border-radius:11px;border:1px solid var(--line);background:var(--surface);cursor:pointer;flex-direction:column;justify-content:center;align-items:center;gap:4px}
.vt .vt-burger i{display:block;width:18px;height:2px;border-radius:2px;background:var(--ink);transition:transform .3s,opacity .3s}
.vt .vt-burger[aria-expanded=true] i:nth-child(1){transform:translateY(6px) rotate(45deg)}
.vt .vt-burger[aria-expanded=true] i:nth-child(2){opacity:0}
.vt .vt-burger[aria-expanded=true] i:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
@media(max-width:1100px){
  .vt .vt-burger{display:flex}
  .vt .vt-bar{position:relative}
  .vt .vt-bar nav.vt-nav{display:flex;position:absolute;top:calc(100% + 8px);left:12px;right:12px;flex-direction:column;gap:2px;padding:8px;border-radius:16px;background:var(--surface);border:1px solid var(--line);
    box-shadow:0 24px 50px -24px rgba(0,0,0,.5);opacity:0;transform:translateY(-8px);pointer-events:none;transition:opacity .25s,transform .25s;margin:0}
  .vt .vt-bar nav.vt-nav.open{opacity:1;transform:none;pointer-events:auto}
  .vt .vt-bar nav.vt-nav a{padding:12px 14px;border-radius:10px;font-size:17px}
  .vt .vt-bar nav.vt-nav a.on:before{left:auto;right:14px;bottom:50%;margin:0 0 -2.5px}
  .vt .vt-tools{margin-inline-start:auto}
  .vt .vt-bar .vt-btn.vt-login{height:40px;padding:0 16px;font-size:15px;white-space:nowrap}
  .vt .vt-login svg{width:16px;height:16px}
  .vt .vt-burger{width:40px;height:40px}
}
.vt .vt-login .sm{display:none}
@media(max-width:520px){.vt .vt-bar{gap:8px}.vt .vt-brand{font-size:15.5px;min-width:0}
  .vt .vt-brand span:last-child{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:1.15;overflow-wrap:anywhere}
  .vt .vt-bar .vt-btn.vt-login{height:36px;padding:0 12px;font-size:13.5px;gap:6px;border-radius:9px;flex:none}.vt .vt-tools{flex:none}.vt .vt-login .lg{display:none}.vt .vt-login .sm{display:inline}.vt .vt-burger{flex:none;width:36px;height:36px;border-radius:9px}}
@media(max-width:420px){.vt .vt-bar .vt-btn.vt-login{width:36px;padding:0;justify-content:center}.vt .vt-login .sm{display:none}}
.vt .vt-tools{display:flex}
.vt .vt-btn{display:inline-block;font:inherit;font-weight:600;padding:11px 20px;border-radius:10px;background:var(--brand);color:var(--on-brand);border:0;text-decoration:none;cursor:pointer}
.vt .vt-btn:disabled{opacity:.6;cursor:default}
.vt .vt-btn.wide{width:100%}
.vt .vt-link{font:inherit;background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;padding:0}

/* Bannière : le tableau de la classe, et le bulletin posé dessus */
.vt .vt-hero{background:var(--slate);color:var(--chalk);padding:72px 0 88px;position:relative;isolation:isolate}
.vt .vt-hero:before{content:"";position:absolute;inset:0;z-index:-1;opacity:.5;background:none}
.vt .vt-hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:56px;align-items:center}
.vt .vt-hero-grid.solo{grid-template-columns:minmax(0,820px)}
.vt .vt-hero h1{font-size:clamp(38px,5.4vw,66px);line-height:1.04;font-weight:700;letter-spacing:-.03em}
.vt .vt-lead{font-size:clamp(18px,1.6vw,21px);color:color-mix(in srgb,var(--chalk) 82%,transparent);max-width:46ch;margin:22px 0 32px}
.vt .vt-doors{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:660px;container-type:inline-size}
.vt .vt-door{font:inherit;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:18px 16px;border-radius:14px;cursor:pointer;text-decoration:none;
  position:relative;overflow:hidden;isolation:isolate;
  background:transparent;color:var(--chalk);border:1.5px solid color-mix(in srgb,var(--chalk) 35%,transparent)}
.vt .vt-door b{font-family:var(--font-display);font-size:clamp(18px,calc(5cqi - 6px),27px);line-height:1.15;white-space:nowrap;letter-spacing:-.015em;display:inline-block;
  position:relative;padding-bottom:4px;animation:vt-door-in .7s cubic-bezier(.2,1.2,.4,1) both;animation-delay:calc(var(--d,0) * 140ms + .5s)}
.vt .vt-door:not(.main) b{--d:1}
.vt .vt-door b:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2.5px;border-radius:2px;background:var(--craie);transform:scaleX(0);transform-origin:left;transition:transform .35s ease}
.vt .vt-door:hover b:after,.vt .vt-door:focus-visible b:after{transform:none}
.vt .vt-door b svg{position:absolute;left:100%;top:0;bottom:4px;margin:auto 0 auto 8px;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;
  animation:vt-nudge 1.8s ease-in-out 1.4s infinite;transition:transform .3s cubic-bezier(.2,1.4,.4,1)}
.vt .vt-door:hover b svg,.vt .vt-door:focus-visible b svg{animation:none}
.vt .vt-door b em{font-style:normal;--tc:var(--chalk);--ta:var(--craie);
  background:linear-gradient(100deg,var(--tc) 0 40%,var(--ta) 50%,var(--tc) 60% 100%) 0 0/250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:vt-text-shine 3.2s ease-in-out 1.2s infinite}
.vt .vt-door.main b em{--tc:var(--slate);--ta:var(--brand)}
.vt .vt-door:not(.main) b em{animation-delay:2.8s}
@keyframes vt-text-shine{0%{background-position:100% 0}60%,100%{background-position:0 0}}
@media(max-width:640px){.vt .vt-door b{font-size:24px}}
@keyframes vt-door-in{from{opacity:0;transform:translateY(12px) scale(.94)}to{opacity:1;transform:none}}
@keyframes vt-nudge{0%,60%,100%{transform:none}30%{transform:translateX(5px)}}
.vt .vt-door span{font-size:16px;font-weight:500;line-height:1.45;color:color-mix(in srgb,var(--chalk) 94%,transparent);max-width:30ch;text-wrap:balance}
.vt .vt-door.main{background:var(--chalk);color:var(--slate);border-color:var(--chalk)}
.vt .vt-door.main span{color:color-mix(in srgb,var(--slate) 90%,transparent)}
.vt .vt-door:hover{border-color:var(--craie)}
.vt .vt-door:hover b svg,.vt .vt-door:focus-visible b svg{transform:translateX(5px)}
.vt .vt-door.vt-door:active{transform:translateY(0) scale(.98)}
.vt .vt-door:not(.main):before{content:"";position:absolute;inset:0;z-index:-1;background:color-mix(in srgb,var(--chalk) 10%,transparent);transform:scaleY(0);transform-origin:bottom;transition:transform .35s ease}
.vt .vt-door:not(.main):hover:before{transform:none}
.vt .vt-door.main:after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;z-index:-1;pointer-events:none;
  background:linear-gradient(100deg,transparent,color-mix(in srgb,var(--craie) 35%,transparent),transparent);transform:skewX(-20deg);animation:vt-shine 4.5s ease-in-out 1.5s infinite}

.vt .vt-paper{margin:0;position:relative;background:var(--paper);color:var(--paper-ink);font-family:'Source Serif 4',Georgia,serif;padding:26px 28px 22px;border-radius:4px;
  transform:rotate(-2deg);box-shadow:0 30px 60px -28px rgba(0,0,0,.65),0 2px 0 rgba(0,0,0,.06);max-width:470px;justify-self:end;width:100%}
.vt .vt-paper-head{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:#59615d;border-bottom:1.5px solid var(--paper-ink);padding-bottom:8px}
.vt .vt-paper-title{font-size:20px;font-weight:700;text-align:center;margin:14px 0 2px}
.vt .vt-paper-who{text-align:center;margin:0 0 14px;font-size:15px;color:#3d4542}
.vt .vt-paper table{width:100%;border-collapse:collapse;font-size:16px}
.vt .vt-paper td{padding:6px 0;border-bottom:1px solid #e3e0d6}
.vt .vt-paper td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;width:110px}
.vt .vt-paper tr.tot td{border-bottom:0;padding-top:10px;font-weight:700;font-size:17px}
.vt .vt-paper-mention{margin:6px 0 16px;font-size:15px;color:#3d4542}
.vt .vt-paper-foot{display:flex;align-items:center;gap:10px;font-size:12px;color:#6b726f}
.vt .vt-paper figcaption{position:absolute;inset-inline-end:12px;bottom:-30px;font-family:var(--font);font-size:13px;color:color-mix(in srgb,var(--chalk) 70%,transparent)}
.vt .vt-qr{width:38px;height:38px;flex:none;background:
  conic-gradient(from 90deg at 30% 30%,#1d2421 25%,transparent 0) 0 0/12px 12px,linear-gradient(#1d2421,#1d2421) 0 0/12px 12px no-repeat,
  linear-gradient(#1d2421,#1d2421) 100% 0/12px 12px no-repeat,linear-gradient(#1d2421,#1d2421) 0 100%/12px 12px no-repeat;border:3px solid #fff;outline:1px solid #cfccc2}
.vt .vt-qr.big{width:64px;height:64px;background-size:16px 16px,20px 20px,20px 20px,20px 20px}
.vt .vt-stamp{position:absolute;right:20px;bottom:14px;font-family:var(--font-display);font-weight:700;font-size:17px;line-height:1.1;text-align:center;text-transform:none;
  color:var(--ink-stamp);border:3px solid var(--ink-stamp);border-radius:12px;padding:9px 14px;transform:rotate(-11deg);opacity:.88;mix-blend-mode:multiply;
  animation:vt-stamp .5s cubic-bezier(.2,1.4,.4,1) 2.4s both}
.vt .vt-ink{animation:vt-ink .45s ease var(--d,0s) both}
@keyframes vt-ink{from{opacity:0;filter:blur(3px)}to{opacity:1;filter:none}}
@keyframes vt-stamp{from{opacity:0;transform:rotate(-11deg) scale(1.9)}to{opacity:.88;transform:rotate(-11deg) scale(1)}}

/* Photos de la plateforme */
.vt .vt-photos{padding:28px 0 0}
.vt .vt-strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px}
.vt .vt-strip figure{margin:0;scroll-snap-align:start}
.vt .vt-strip img{width:100%;height:220px;object-fit:cover;border-radius:12px;display:block}
.vt .vt-strip figcaption{font-size:15px;color:var(--vt-muted);margin-top:6px}

/* Sections */
.vt section{scroll-margin-top:72px}
.vt .vt-sec{padding:80px 0}
.vt h2{font-size:clamp(34px,4.4vw,56px);line-height:1.05;font-weight:800;letter-spacing:-.03em}
.vt h2.rv{opacity:1;transform:none;position:relative;padding-bottom:20px}
.vt h2.rv:after{content:"";position:absolute;inset-inline-start:0;bottom:0;width:76px;height:5px;border-radius:3px;background:var(--craie);transform:scaleX(0);transform-origin:left;transition:transform .9s cubic-bezier(.2,.8,.2,1) calc(var(--n,4) * 70ms + .2s)}
.vt h2.rv.in:after{transform:scaleX(1)}
.vt h2 .vt-w{display:inline-block;opacity:0;transform:translateY(.55em) rotate(2deg);filter:blur(4px);transition:opacity .6s ease,transform .75s cubic-bezier(.2,.9,.2,1),filter .6s ease;transition-delay:calc(var(--i) * 70ms)}
.vt h2.in .vt-w{opacity:1;transform:none;filter:none}
.vt .vt-sub{color:var(--vt-muted);max-width:60ch;margin:14px 0 40px;font-size:19px}
.vt .vt-h3{font-size:24px;font-weight:700;margin:64px 0 18px}

/* Objets reçus par les familles : chacun a la forme de ce qu'il est */
.vt .vt-objects{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;align-items:start}
.vt .vt-obj{margin:0;display:flex;flex-direction:column;gap:12px}
.vt .vt-obj figcaption{font-family:var(--font-display);font-weight:600;font-size:18px;letter-spacing:-.01em}
.vt .vt-notif{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:6px;font-size:15px;line-height:1.45;
  box-shadow:0 12px 26px -20px rgba(0,0,0,.5)}
.vt .vt-notif b{font-size:16px}
.vt .vt-notif i{font-style:normal;font-size:13px;color:var(--vt-muted)}
.vt .vt-receipt{background:var(--paper);color:var(--paper-ink);font-family:'Source Serif 4',Georgia,serif;padding:18px 18px 22px;display:flex;flex-direction:column;gap:4px;font-size:15px;
  border:1px solid #e3e0d6;-webkit-mask:radial-gradient(6px at 50% 100%,#0000 98%,#000) 50% 100%/14px 51% repeat-x,linear-gradient(#000 0 0) top/100% 51% no-repeat;
  mask:radial-gradient(6px at 50% 100%,#0000 98%,#000) 50% 100%/14px 51% repeat-x,linear-gradient(#000 0 0) top/100% 51% no-repeat}
.vt .vt-receipt strong{font-size:24px;margin:6px 0;font-variant-numeric:tabular-nums}
.vt .vt-check{display:flex;gap:14px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;font-size:15px;line-height:1.45}
.vt .vt-check b{display:block;color:hsl(var(--hue) 60% 32%);font-size:16px}
.vt .vt-annonce{background:var(--surface);border:1px solid var(--line);border-inline-start:5px solid var(--craie);border-radius:6px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;font-size:15px;line-height:1.45}
.vt .vt-annonce b{font-size:16px}

/* Profils */
.vt .vt-tabs{position:relative;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.vt .vt-tabs button{font:inherit;font-weight:600;padding:10px 16px;background:none;border:0;color:var(--vt-muted);cursor:pointer;transition:color .3s}
.vt .vt-tabs button:hover{color:var(--ink)}
.vt .vt-tabs button[aria-selected=true]{color:var(--ink)}
.vt .vt-ink{position:absolute;bottom:-1px;height:3px;border-radius:3px;background:color-mix(in srgb,var(--brand) 28%,transparent);transition:left .45s cubic-bezier(.3,1.2,.4,1),width .45s cubic-bezier(.3,1.2,.4,1);overflow:hidden}
.vt .vt-ink i{display:block;height:100%;width:calc(var(--p,1) * 100%);background:var(--brand);transition:width .12s linear}
.vt .vt-panel{padding:22px 0 0;animation:vt-swap .45s ease both}
.vt .vt-panel .vt-roles > div{animation:vt-rise .55s cubic-bezier(.2,.8,.2,1) both}
.vt .vt-panel .vt-roles > div:nth-child(2){animation-delay:.08s}.vt .vt-panel .vt-roles > div:nth-child(3){animation-delay:.16s}.vt .vt-panel .vt-roles > div:nth-child(4){animation-delay:.24s}
.vt .vt-panel-w{margin:0 0 20px;color:var(--vt-muted)}
.vt .vt-roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:30px}
.vt .vt-roles h4{font-size:19px;margin-bottom:8px}
.vt .vt-roles ul{margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:4px;font-size:17px}
.vt .vt-note{font-size:15px;color:var(--vt-muted);margin:10px 0 0}

/* Un espace pour chacun : une ardoise, les rôles à gauche, ce que voit le profil à droite */
.vt .vt-space{--muted-chalk:color-mix(in srgb,var(--chalk) 68%,transparent);margin-top:64px;background:var(--slate);color:var(--chalk);border-radius:22px;padding:clamp(22px,3.4vw,44px);position:relative;overflow:hidden;
  background-image:none}
.vt .vt-space-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px 24px;flex-wrap:wrap;margin-bottom:18px}
.vt .vt-space .vt-h3{margin:0;font-size:clamp(26px,3vw,36px);color:var(--chalk)}
.vt .vt-space-head p{margin:0;color:var(--muted-chalk)}
.vt .vt-space .vt-tabs{border-bottom-color:color-mix(in srgb,var(--chalk) 16%,transparent)}
.vt .vt-space .vt-tabs button{color:var(--muted-chalk);font-size:17px;padding:12px 18px}
.vt .vt-space .vt-tabs button:hover,.vt .vt-space .vt-tabs button[aria-selected=true]{color:var(--chalk)}
.vt .vt-space .vt-ink{background:color-mix(in srgb,var(--craie) 30%,transparent)}
.vt .vt-space .vt-ink i{background:var(--craie)}
.vt .vt-space-body{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:40px;align-items:center;height:576px}
.vt .vt-space .vt-roles > div:nth-child(3):last-child{grid-column:1 / -1}
.vt .vt-space .vt-roles > div:nth-child(3):last-child ul{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
.vt .vt-space .vt-panel-w{font-family:var(--font-display);font-size:clamp(20px,2vw,25px);line-height:1.3;color:var(--chalk);max-width:34ch}
.vt .vt-space .vt-roles{grid-template-columns:repeat(min(var(--cols,2),2),minmax(0,1fr));gap:14px}
.vt .vt-space .vt-roles > div{background:color-mix(in srgb,var(--chalk) 6%,transparent);border:1px solid color-mix(in srgb,var(--chalk) 12%,transparent);border-radius:14px;padding:16px 18px;transition:background .3s,transform .3s}
.vt .vt-space .vt-roles > div:hover{background:color-mix(in srgb,var(--chalk) 10%,transparent);transform:translateY(-3px)}
.vt .vt-space .vt-roles h4{color:var(--craie);font-size:18px}
.vt .vt-space .vt-roles ul{list-style:none;padding:0;font-size:15.5px;gap:6px}
.vt .vt-space .vt-roles li{position:relative;padding-inline-start:22px}
.vt .vt-space .vt-roles li:before{content:"";position:absolute;inset-inline-start:2px;top:.45em;width:10px;height:5px;border-left:2px solid var(--craie);border-bottom:2px solid var(--craie);transform:rotate(-45deg)}
.vt .vt-space .vt-note{color:var(--muted-chalk);font-size:13.5px;border-top:1px dashed color-mix(in srgb,var(--chalk) 18%,transparent);padding-top:10px}
.vt .vt-phone{justify-self:center;width:256px;height:500px;border-radius:38px;padding:10px;background:#0d1110;box-shadow:0 0 0 2px color-mix(in srgb,var(--chalk) 18%,transparent),0 40px 70px -30px rgba(0,0,0,.8);animation:vt-float 6s ease-in-out infinite}
@keyframes vt-float{50%{transform:translateY(-8px)}}
.vt .vt-phone-screen{height:100%;border-radius:29px;background:var(--bg);color:var(--ink);padding:30px 14px 14px;display:flex;flex-direction:column;gap:9px;overflow:hidden;position:relative}
.vt .vt-phone-screen:before{content:"";position:absolute;top:9px;left:50%;width:70px;height:18px;margin-left:-35px;border-radius:12px;background:#0d1110}
.vt .vt-phone-screen > *{animation:vt-rise .5s cubic-bezier(.2,.8,.2,1) both}
.vt .vt-phone-screen > :nth-child(2){animation-delay:.08s}.vt .vt-phone-screen > :nth-child(3){animation-delay:.16s}.vt .vt-phone-screen > :nth-child(4){animation-delay:.24s}
.vt .vt-phone-screen > :nth-child(5){animation-delay:.32s}.vt .vt-phone-screen > :nth-child(6){animation-delay:.4s}.vt .vt-phone-screen > :nth-child(7){animation-delay:.48s}
.vt .vt-ph-top{display:flex;flex-direction:column}
.vt .vt-ph-top span{font-size:12px;color:var(--vt-muted)}
.vt .vt-ph-top b{font-size:14.5px}
.vt .vt-ph-hero{background:var(--brand);color:var(--on-brand);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column}
.vt .vt-ph-hero span,.vt .vt-ph-hero small{font-size:11.5px;opacity:.85}
.vt .vt-ph-hero b{font-family:var(--font-display);font-size:34px;line-height:1.1}
.vt .vt-ph-row{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 10px;font-size:12.5px}
.vt .vt-ph-row span{flex:1}
.vt .vt-ph-row b{font-size:12.5px}
.vt .vt-ph-row i{width:8px;height:8px;border-radius:50%;flex:none}
.vt .vt-ph-row i.ok{background:#2f8a5b}.vt .vt-ph-row i.info{background:var(--ink-stamp)}.vt .vt-ph-row i.warn{background:#d9971e}
.vt .vt-ph-call{display:flex;justify-content:space-between;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:8px 10px;font-size:12.5px}
.vt .vt-ph-call em{font-style:normal;font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;animation:vt-pop .4s cubic-bezier(.2,1.4,.4,1) calc(var(--d) * .35s + .5s) both}
.vt .vt-ph-call em.p{background:color-mix(in srgb,#2f8a5b 16%,transparent);color:#1f6a43}
.vt .vt-ph-call em.a{background:color-mix(in srgb,#c0392b 15%,transparent);color:#a1281b}
.vt .vt-ph-call em.r{background:color-mix(in srgb,#d9971e 18%,transparent);color:#8a5d06}
@keyframes vt-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
.vt .vt-ph-done{margin-top:auto;font-size:12px;font-weight:600;color:#1f6a43;background:color-mix(in srgb,#2f8a5b 12%,transparent);border-radius:11px;padding:10px;animation:vt-rise .5s ease 2.4s both !important}
.vt .vt-ph-kpis{display:grid;gap:8px}
.vt .vt-ph-kpis > div{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.vt .vt-ph-kpis span,.vt .vt-ph-chart > span{font-size:11.5px;color:var(--vt-muted)}
.vt .vt-ph-kpis b{font-family:var(--font-display);font-size:22px}
.vt .vt-ph-kpis i{display:block;height:6px;border-radius:3px;background:color-mix(in srgb,var(--ink) 8%,transparent);position:relative;overflow:hidden}
.vt .vt-ph-kpis i:after{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);background:var(--brand);border-radius:3px;animation:vt-grow 1.2s cubic-bezier(.2,.8,.2,1) .4s both;transform-origin:left}
@keyframes vt-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.vt .vt-ph-chart{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.vt .vt-ph-bars{display:flex;align-items:flex-end;gap:10px;height:84px;margin-top:8px}
.vt .vt-ph-bars i{flex:1;height:calc(var(--v) * 1%);border-radius:5px 5px 2px 2px;background:var(--craie);transform-origin:bottom;animation:vt-grow-y .8s cubic-bezier(.2,1.2,.4,1) calc(var(--d) * .1s + .5s) both}
@keyframes vt-grow-y{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.vt .vt-ph-days{display:flex;gap:10px;margin-top:4px}
.vt .vt-ph-days span{flex:1;text-align:center;font-size:10.5px;color:var(--vt-muted)}
@media(max-width:900px){.vt .vt-space-body{grid-template-columns:1fr;height:auto}.vt .vt-phone{display:none}}
@media(max-width:640px){.vt .vt-space .vt-roles{grid-template-columns:1fr}.vt .vt-space .vt-roles > div:nth-child(3):last-child ul{grid-template-columns:1fr}.vt .vt-space .vt-tabs button{font-size:15px;padding:10px 12px}}
@media (prefers-reduced-motion:reduce){.vt .vt-phone{animation:none}}

/* Étapes (une vraie suite : numérotées) */
.vt .vt-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;counter-reset:s}
.vt .vt-steps li{counter-increment:s;display:flex;flex-direction:column;gap:6px;padding-top:14px;border-top:2px solid var(--ink)}
.vt .vt-steps li:before{content:counter(s);font-family:var(--font-display);font-weight:700;font-size:36px;line-height:1}
.vt .vt-steps b{font-size:19px}
.vt .vt-steps span{color:var(--vt-muted);font-size:17px}

/* Démonstrations pour les équipes : un écran d'application, saisie des notes et emploi du temps */
.vt .vt-demo{background:color-mix(in srgb,var(--ink) 3.5%,var(--bg));border-block:1px solid var(--line)}
.vt .vt-demo-grid{display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);gap:56px;align-items:center}
.vt .vt-demo .vt-sub{margin-bottom:24px}
.vt .vt-demo-tabs{position:relative;display:inline-grid;grid-template-columns:1fr 1fr;padding:4px;border-radius:12px;background:color-mix(in srgb,var(--ink) 7%,transparent)}
.vt .vt-demo-tabs button{position:relative;z-index:1;font:inherit;font-weight:600;font-size:16px;padding:9px 18px;border-radius:9px;border:0;background:none;color:var(--vt-muted);cursor:pointer;transition:color .3s}
.vt .vt-demo-tabs button:hover,.vt .vt-demo-tabs button[aria-selected=true]{color:var(--ink)}
.vt .vt-demo-pill{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:9px;background:var(--surface);box-shadow:0 4px 12px -8px rgba(0,0,0,.45);overflow:hidden;
  transform:translateX(calc(var(--ti,0) * 100%));transition:transform .5s cubic-bezier(.3,1.25,.4,1)}
.vt .vt-demo-pill i{position:absolute;left:0;bottom:0;height:3px;width:calc(var(--p,0) * 100%);background:var(--brand);transition:width .45s linear}
.vt .vt-demo-points{margin:22px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:12px}
.vt .vt-demo-points li{padding-inline-start:28px;position:relative;animation:vt-rise .5s ease both}
.vt .vt-demo-points li:nth-child(2){animation-delay:.1s}.vt .vt-demo-points li:nth-child(3){animation-delay:.2s}
.vt .vt-demo-points li:before{content:"";position:absolute;inset-inline-start:0;top:.5em;width:14px;height:8px;border-left:2.5px solid var(--brand);border-bottom:2.5px solid var(--brand);transform:rotate(-45deg)}

.vt .vt-app{display:grid;grid-template-columns:150px minmax(0,1fr);background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;
  box-shadow:0 40px 80px -48px rgba(0,0,0,.6),0 2px 6px -2px rgba(0,0,0,.08);min-height:470px;font-size:14px}
.vt .vt-app-side{background:var(--slate);color:color-mix(in srgb,var(--chalk) 78%,transparent);display:flex;flex-direction:column;gap:2px;padding:14px 10px}
.vt .vt-app-logo{width:30px;height:30px;border-radius:8px;background:var(--chalk);color:var(--slate);display:grid;place-items:center;font-weight:800;font-family:var(--font-display);margin:0 0 14px 6px}
.vt .vt-app-nav{padding:8px 10px;border-radius:8px;font-size:13.5px;transition:background .3s,color .3s}
.vt .vt-app-nav.on{background:color-mix(in srgb,var(--chalk) 14%,transparent);color:var(--chalk);font-weight:600}
.vt .vt-app-main{position:relative;display:flex;flex-direction:column;min-width:0}
.vt .vt-app-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--line)}
.vt .vt-crumb{color:var(--vt-muted);font-size:14px}
.vt .vt-crumb i{font-style:normal;margin:0 4px;opacity:.6}
.vt .vt-crumb b{color:var(--ink)}
.vt .vt-app-chips{display:flex;gap:6px;align-items:center}
.vt .vt-chip{font-size:12.5px;padding:3px 9px;border-radius:99px;border:1px solid var(--line);color:var(--vt-muted)}
.vt .vt-status{font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:99px;background:color-mix(in srgb,#c58b1c 16%,transparent);color:#8a5d06;transition:background .3s,color .3s}
.vt .vt-status.ok{background:color-mix(in srgb,#2f8a5b 16%,transparent);color:#1f6a43}
.vt .vt-screen-cap{position:absolute;inset-inline-end:14px;bottom:8px;font-size:11.5px;color:var(--vt-muted)}

.vt .vt-notes{padding:14px 18px 34px;position:relative;animation:vt-swap .4s ease both}
.vt .vt-notes-head{display:flex;align-items:baseline;gap:12px;margin-bottom:8px}
.vt .vt-notes-head b{font-family:var(--font-display);font-size:17px}
.vt .vt-notes-head span{color:var(--vt-muted);font-size:13px}
.vt .vt-notes-head .vt-done-msg{color:#1f6a43;font-weight:600;padding-inline-start:20px;position:relative;animation:vt-swap .45s ease both}
.vt .vt-notes-head .vt-done-msg:before{content:"";position:absolute;inset-inline-start:2px;top:.35em;width:10px;height:5px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg)}
.vt .vt-notes table{width:100%;border-collapse:collapse}
.vt .vt-notes th{text-align:left;font-size:12px;color:var(--vt-muted);font-weight:600;padding:7px 8px;background:color-mix(in srgb,var(--ink) 4%,transparent)}
.vt .vt-notes td{padding:6px 8px;border-bottom:1px solid var(--line);transition:background .3s}
.vt .vt-notes td.mono{font-variant-numeric:tabular-nums;color:var(--vt-muted);font-size:13px}
.vt .vt-notes td.appr{color:var(--vt-muted);font-size:13px}
.vt .vt-notes tr.cur td{background:color-mix(in srgb,var(--brand) 9%,transparent)}
.vt .vt-cell{display:inline-flex;align-items:center;min-width:70px;height:28px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font-variant-numeric:tabular-nums}
.vt .vt-notes tr.cur .vt-cell{border-color:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 18%,transparent)}
.vt .vt-typed{animation:vt-type .35s steps(5,end) both;display:inline-block;overflow:hidden;white-space:nowrap}
.vt .vt-typed-in{animation:vt-swap .4s ease .2s both;display:inline-block}
.vt .vt-caret{width:2px;height:16px;background:var(--brand);animation:vt-blink .8s steps(2) infinite}
@keyframes vt-type{from{max-width:0}to{max-width:5ch}}
@keyframes vt-blink{50%{opacity:0}}
.vt .vt-notes-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}
.vt .vt-kpis{display:flex;gap:18px;color:var(--vt-muted);font-size:13px}
.vt .vt-kpis b{display:block;color:var(--ink);font-family:var(--font-display);font-size:18px;font-variant-numeric:tabular-nums}
.vt .vt-publish{padding:9px 16px;border-radius:8px;background:var(--brand);color:var(--on-brand);font-weight:600;transition:transform .15s,background .3s}
.vt .vt-publish.pressed{transform:scale(.95)}
.vt .vt-publish.done{background:#2f8a5b}
.vt .vt-toast{position:absolute;right:16px;top:10px;background:var(--slate);color:var(--chalk);padding:10px 16px;border-radius:10px;font-size:14px;white-space:nowrap;
  box-shadow:0 14px 30px -14px rgba(0,0,0,.6);animation:vt-toast .45s cubic-bezier(.2,1.3,.4,1) both}
@keyframes vt-toast{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}

.vt .vt-edt{display:grid;grid-template-columns:54px repeat(5,minmax(0,1fr));gap:4px;padding:14px 16px 34px;animation:vt-swap .4s ease both}
.vt .vt-edt-day{font-size:12.5px;font-weight:600;color:var(--vt-muted);text-align:center;padding:4px 0;border-radius:6px}
.vt .vt-edt-day.today{background:color-mix(in srgb,var(--brand) 12%,transparent);color:var(--ink)}
.vt .vt-edt-slot{font-size:12px;color:var(--vt-muted);padding-top:8px;font-variant-numeric:tabular-nums}
.vt .vt-edt-cell{min-height:78px;border-radius:7px;background:color-mix(in srgb,var(--ink) 3%,transparent)}
.vt .vt-edt-cell.today{background:color-mix(in srgb,var(--brand) 5%,transparent)}
.vt .vt-course{position:relative;display:flex;flex-direction:column;gap:2px;height:100%;padding:7px 8px;border-radius:7px;line-height:1.25;
  background:var(--surface);border:1px solid var(--line);border-inline-start:3px solid hsl(var(--h) 55% 45%);box-shadow:0 2px 6px -4px rgba(0,0,0,.3);animation:vt-drop .45s cubic-bezier(.2,1.2,.4,1) both;transition:box-shadow .3s}
.vt .vt-course b{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vt .vt-course small{font-size:11px;color:var(--vt-muted)}
.vt .vt-course.live{box-shadow:0 0 0 2px #2f8a5b}
.vt .vt-course em{font-style:normal;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:5px;width:fit-content;margin-top:2px;animation:vt-swap .4s ease both}
.vt .vt-course em.now{background:#2f8a5b;color:#fff}
.vt .vt-course em.rep{background:var(--ink-stamp);color:#fff}
@keyframes vt-drop{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}
@media(max-width:1100px){.vt .vt-app{grid-template-columns:118px minmax(0,1fr)}}
@media(max-width:980px){.vt .vt-demo-grid{grid-template-columns:1fr}}
@media(max-width:640px){.vt .vt-app{grid-template-columns:1fr}.vt .vt-app-side{display:none}.vt .vt-notes .m{display:none}
  .vt .vt-edt{grid-template-columns:40px repeat(5,minmax(0,1fr));gap:2px;padding:10px 8px 30px}.vt .vt-course{padding:4px}.vt .vt-course b{font-size:10px}.vt .vt-course small{display:none}
  .vt .vt-course em{font-size:9px}.vt .vt-edt-day{font-size:10.5px}.vt .vt-edt-slot{font-size:10px}.vt .vt-toast{white-space:normal;left:12px;right:12px;text-align:center}.vt .vt-kpis{gap:12px}}

/* Formats fixes : les cartes d'un même groupe ont la même taille, et rien ne déborde */
.vt .vt-app{height:520px;min-height:0}
.vt .vt-app-main{min-height:0}
.vt .vt-notes,.vt .vt-edt{flex:1;min-height:0;overflow:hidden}
.vt .vt-notes{display:flex;flex-direction:column}
.vt .vt-notes table{table-layout:fixed}
.vt .vt-notes th:nth-child(1){width:34%}.vt .vt-notes th:nth-child(2){width:22%}.vt .vt-notes th:nth-child(3){width:18%}.vt .vt-notes th:nth-child(4){width:26%}
.vt .vt-notes td,.vt .vt-notes th{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vt .vt-notes-head{white-space:nowrap;overflow:hidden;min-height:26px}
.vt .vt-notes-head span{overflow:hidden;text-overflow:ellipsis}
.vt .vt-notes-foot{margin-top:auto;padding-top:12px}
.vt .vt-edt{grid-template-rows:auto repeat(4,minmax(0,1fr));align-content:stretch}
.vt .vt-edt-cell{min-height:0;overflow:hidden}
.vt .vt-course{overflow:hidden}
.vt .vt-course small,.vt .vt-course em{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vt .vt-objects{align-items:stretch}
.vt .vt-obj > div{flex:1;min-height:168px}
.vt .vt-obj figcaption{line-height:1.35;min-height:2.7em}
.vt .vt-notes{padding:12px 18px 26px}
.vt .vt-notes td{padding:4px 8px}
.vt .vt-notes th{padding:5px 8px}
.vt .vt-cell{height:25px}
.vt .vt-notes-head{margin-bottom:6px}
.vt .vt-promises{align-items:stretch}
@media(max-width:640px){.vt .vt-app{height:640px}.vt .vt-notes th:nth-child(1){width:60%}.vt .vt-notes th:nth-child(3){width:40%}.vt .vt-obj > div{min-height:0}.vt .vt-obj figcaption{min-height:0}}

/* Pour les écoles */
.vt .vt-schools{background:var(--slate);color:var(--chalk);padding:88px 0}
.vt .vt-schools .vt-sub{color:color-mix(in srgb,var(--chalk) 80%,transparent)}
.vt .vt-schools-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:56px;align-items:start}
.vt .vt-benefits{margin:0;display:flex;flex-direction:column}
.vt .vt-benefits > div{padding:20px 0;border-top:1px solid color-mix(in srgb,var(--chalk) 22%,transparent)}
.vt .vt-benefits dt{font-family:var(--font-display);font-weight:700;font-size:23px;letter-spacing:-.01em;margin-bottom:6px}
.vt .vt-benefits dd{margin:0;color:color-mix(in srgb,var(--chalk) 80%,transparent);max-width:58ch}
.vt .vt-benefits .star dt{color:var(--craie)}
.vt .vt-twins{display:flex;gap:10px;margin-top:14px}
.vt .vt-twins span{background:var(--paper);color:var(--paper-ink);font-family:'Source Serif 4',Georgia,serif;font-weight:700;font-size:15px;padding:8px 14px;border-radius:3px;box-shadow:0 10px 20px -14px rgba(0,0,0,.7)}
.vt .vt-twins span[lang=ar]{font-family:'Noto Naskh Arabic','Amiri',serif;font-size:17px}
.vt .vt-offer{position:sticky;top:88px;display:flex;flex-direction:column;gap:14px}
.vt .vt-price{background:var(--slate-2);border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:2px}
.vt .vt-price b{font-family:var(--font-display);font-size:28px;letter-spacing:-.02em}
.vt .vt-price span{color:color-mix(in srgb,var(--chalk) 78%,transparent);font-size:16px}
.vt .vt-form,.vt .vt-done{background:var(--surface);color:var(--ink);border-radius:14px;padding:22px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.vt .vt-form h3,.vt .vt-done b{grid-column:1/-1;font-family:var(--font-display);font-size:22px}
.vt .vt-done{grid-template-columns:1fr}
.vt .vt-form label{display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600}
.vt .vt-form label.wide,.vt .vt-form .wide,.vt .vt-form .vt-alt,.vt .vt-form .vt-err{grid-column:1/-1}
.vt .vt-form input,.vt .vt-form textarea{font:inherit;font-weight:400;font-size:16px;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.vt .vt-form em{font-style:normal;font-weight:500;font-size:14px;color:#c23b2a}
.vt .vt-err{margin:0;color:#c23b2a;font-size:15px}
.vt .vt-alt{margin:0;font-size:15px;color:var(--vt-muted)}
.vt .vt-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}

/* Vous dirigez une école : atouts interactifs, scène animée et offre */
.vt .vt-feats{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr);gap:44px;align-items:stretch;margin-top:8px}
.vt .vt-feat-list{display:flex;flex-direction:column;gap:6px}
.vt .vt-feat-list button{position:relative;text-align:left;font:inherit;color:inherit;background:none;border:0;border-radius:14px;padding:14px 18px 16px;cursor:pointer;overflow:hidden;
  display:flex;flex-direction:column;gap:4px;transition:background .35s}
.vt .vt-feat-list button b{font-family:var(--font-display);font-size:21px;letter-spacing:-.01em;color:color-mix(in srgb,var(--chalk) 62%,transparent);transition:color .35s}
.vt .vt-feat-list button span{font-size:15.5px;line-height:1.5;color:color-mix(in srgb,var(--chalk) 75%,transparent);display:grid;grid-template-rows:0fr;overflow:hidden;transition:grid-template-rows .45s ease,opacity .35s;opacity:0}
.vt .vt-feat-list button:hover b{color:var(--chalk)}
.vt .vt-feat-list button[aria-selected=true]{background:color-mix(in srgb,var(--chalk) 8%,transparent)}
.vt .vt-feat-list button[aria-selected=true] b{color:var(--chalk)}
.vt .vt-feat-list button.star b{color:color-mix(in srgb,var(--craie) 75%,transparent)}
.vt .vt-feat-list button.star[aria-selected=true] b{color:var(--craie)}
.vt .vt-feat-list button[aria-selected=true] span{opacity:1;max-height:9em}
.vt .vt-feat-list button:not([aria-selected=true]) span{max-height:0}
.vt .vt-feat-list button span{transition:max-height .45s ease,opacity .35s}
.vt .vt-feat-bar{position:absolute;left:18px;right:18px;bottom:6px;height:2px;border-radius:2px;background:color-mix(in srgb,var(--chalk) 10%,transparent);opacity:0;transition:opacity .3s}
.vt .vt-feat-bar:after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--p,0) * 100%);background:var(--craie);border-radius:2px;transition:width .12s linear}
.vt .vt-feat-list button[aria-selected=true] .vt-feat-bar{opacity:1}
.vt .vt-stage{position:relative;height:440px;border-radius:22px;overflow:hidden;background:var(--slate-2);
  background-image:radial-gradient(color-mix(in srgb,var(--chalk) 9%,transparent) 1px,transparent 1px);background-size:18px 18px}
.vt .vt-stage-in{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;animation:vt-swap .45s ease both}
.vt .vt-stage-in > *{animation:vt-rise .6s cubic-bezier(.2,.8,.2,1) both}
.vt .vt-stage-in > :nth-child(2){animation-delay:.15s}.vt .vt-stage-in > :nth-child(3){animation-delay:.3s}
.vt .vt-stage em{font-style:normal}

/* scène : scolarité */
.vt .vt-sc-card,.vt .vt-bu-card{width:min(400px,100%);background:var(--paper);color:var(--paper-ink);border-radius:12px;padding:18px 20px;box-shadow:0 30px 50px -30px rgba(0,0,0,.8)}
.vt .vt-sc-head,.vt .vt-bu-head{display:flex;flex-direction:column;margin-bottom:10px}
.vt .vt-sc-head b,.vt .vt-bu-head b{font-family:var(--font-display);font-size:18px}
.vt .vt-sc-head span,.vt .vt-bu-head span{font-size:13px;opacity:.65}
.vt .vt-sc-row{display:grid;grid-template-columns:1fr auto 74px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid rgba(0,0,0,.08);font-size:14px}
.vt .vt-sc-row b{font-variant-numeric:tabular-nums;font-size:14px}
.vt .vt-sc-row em{justify-self:end;font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:99px;background:rgba(0,0,0,.07);color:rgba(0,0,0,.6);position:relative;overflow:hidden}
.vt .vt-sc-row em.ok{background:#d8efe2;color:#1f6a43}
.vt .vt-sc-row em.flip{display:grid;padding:0;background:none}
.vt .vt-sc-row em.flip i{grid-area:1/1;font-style:normal;padding:3px 8px;border-radius:99px;text-align:center}
.vt .vt-sc-row em.flip i:first-child{background:rgba(0,0,0,.07);color:rgba(0,0,0,.6);animation:vt-out .35s ease 1.6s both}
.vt .vt-sc-row em.flip i:last-child{background:#d8efe2;color:#1f6a43;animation:vt-pop .45s cubic-bezier(.2,1.4,.4,1) 1.7s both}
@keyframes vt-out{to{opacity:0;transform:scale(.6)}}
.vt .vt-sc-total{margin-top:10px;font-size:13px;display:flex;flex-direction:column;gap:6px}
.vt .vt-sc-total i{height:8px;border-radius:4px;background:rgba(0,0,0,.08);position:relative;overflow:hidden}
.vt .vt-sc-total i:after{content:"";position:absolute;inset:0 auto 0 0;width:75%;background:#2f8a5b;border-radius:4px;transform-origin:left;animation:vt-grow-75 2.2s cubic-bezier(.2,.8,.2,1) .4s both}
@keyframes vt-grow-75{0%{transform:scaleX(0)}55%{transform:scaleX(.555)}75%{transform:scaleX(.555)}100%{transform:scaleX(1)}}
.vt .vt-sc-toast{display:flex;flex-direction:column;background:var(--surface);color:var(--ink);border-radius:14px;padding:12px 16px;border-inline-start:4px solid #2f8a5b;box-shadow:0 20px 40px -20px rgba(0,0,0,.8);
  width:min(360px,100%);animation:vt-push .6s cubic-bezier(.2,1.3,.4,1) 1.8s both !important}
.vt .vt-sc-toast b{font-size:14.5px}.vt .vt-sc-toast span{font-size:13px;color:var(--vt-muted)}

/* scène : bulletins */
.vt .vt-bu-card{font-family:'Source Serif 4',Georgia,serif}
.vt .vt-bu-row{display:grid;grid-template-columns:104px 52px 1fr 46px;gap:10px;align-items:center;padding:7px 0;border-top:1px solid rgba(0,0,0,.08);font-size:14px}
.vt .vt-bu-row small{font-size:11.5px;opacity:.6}
.vt .vt-bu-row i{height:7px;border-radius:4px;background:rgba(0,0,0,.07);position:relative;overflow:hidden}
.vt .vt-bu-row i:after{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);background:var(--ink-stamp);border-radius:4px;transform-origin:left;animation:vt-grow .9s cubic-bezier(.2,.8,.2,1) calc(var(--d) * .15s + .4s) both}
.vt .vt-bu-row b{text-align:right;font-variant-numeric:tabular-nums}
.vt .vt-bu-foot{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:12px;border-top:2px solid var(--paper-ink)}
.vt .vt-bu-foot div{display:flex;flex-direction:column}
.vt .vt-bu-foot span{font-size:12.5px;opacity:.7}
.vt .vt-bu-foot b{font-family:var(--font-display);font-size:30px;line-height:1.1;animation:vt-pop .5s cubic-bezier(.2,1.4,.4,1) 1.2s both}
.vt .vt-bu-foot small{font-size:12.5px;color:#1f6a43;font-weight:600}
.vt .vt-bu-qr{width:58px;height:58px;position:relative;overflow:hidden;border-radius:4px;
  background:conic-gradient(var(--paper-ink) 25%,transparent 0 50%,var(--paper-ink) 0 75%,transparent 0) 0 0/14px 14px,var(--paper);box-shadow:inset 0 0 0 4px var(--paper)}
.vt .vt-bu-qr:after{content:"";position:absolute;left:-4px;right:-4px;height:3px;background:#2fbf71;box-shadow:0 0 10px #2fbf71;animation:vt-scan 1.6s ease-in-out 1.4s 2 both}

/* scène : franco-arabe */
.vt .vt-cu-pair{display:flex;gap:16px}
.vt .vt-cu-doc{width:170px;background:var(--paper);color:var(--paper-ink);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 24px 40px -26px rgba(0,0,0,.8);font-family:'Source Serif 4',Georgia,serif;animation:vt-flip .9s ease both}
.vt .vt-cu-doc + .vt-cu-doc{animation-delay:.3s}
.vt .vt-cu-doc[lang=ar]{font-family:'Noto Naskh Arabic','Amiri',serif}
.vt .vt-cu-doc[lang=ar] small{font-size:14px}.vt .vt-cu-doc[lang=ar] b{font-size:22px}.vt .vt-cu-doc[lang=ar] span{font-size:16px}
.vt .vt-cu-doc small{font-size:12px;opacity:.65}
.vt .vt-cu-doc b{font-size:18px}
.vt .vt-cu-doc span{font-size:14px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.12)}
.vt .vt-cu-link{display:flex;gap:150px;height:34px}
.vt .vt-cu-link i{width:2px;background:repeating-linear-gradient(var(--craie) 0 5px,transparent 5px 9px);transform-origin:top;animation:vt-grow-y .6s ease .9s both}
.vt .vt-cu-link i{animation-name:vt-grow-down}
@keyframes vt-grow-down{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.vt .vt-cu-family{background:var(--craie);color:#2b2204;border-radius:14px;padding:12px 18px;display:flex;flex-direction:column;align-items:center;text-align:center;animation:vt-pop .5s cubic-bezier(.2,1.4,.4,1) 1.3s both !important}
.vt .vt-cu-family b{font-family:var(--font-display);font-size:18px}.vt .vt-cu-family span{font-size:13px}

/* scène : rôles */
.vt .vt-ro-grid{width:min(420px,100%);display:flex;flex-direction:column;gap:7px}
.vt .vt-ro-row{display:grid;grid-template-columns:110px 1fr auto;gap:10px;align-items:center;background:var(--surface);color:var(--ink);border-radius:11px;padding:10px 12px;font-size:13.5px;
  animation:vt-slide .5s cubic-bezier(.2,.8,.2,1) calc(var(--d) * .15s) both}
.vt .vt-ro-row b{font-size:13.5px}
.vt .vt-ro-row span{color:var(--vt-muted)}
.vt .vt-ro-row em{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:99px;background:#d8efe2;color:#1f6a43;animation:vt-pop .4s cubic-bezier(.2,1.4,.4,1) calc(var(--d) * .15s + .5s) both}
.vt .vt-ro-row em.no{background:#f6dcd8;color:#a1281b}
.vt .vt-ro-log{width:min(420px,100%);font-size:13px;color:color-mix(in srgb,var(--chalk) 85%,transparent);display:flex;flex-direction:column;gap:6px}
.vt .vt-ro-log small{color:var(--craie);font-weight:700;font-size:12px}
.vt .vt-ro-log div{display:flex;gap:10px;animation:vt-rise .5s ease calc(var(--d) * .5s + 1.4s) both}
.vt .vt-ro-log time{font-variant-numeric:tabular-nums;opacity:.6;flex:none}

/* scène : rien à installer */
.vt .vt-in-laptop{width:min(400px,100%);padding:12px 12px 0;background:#0d1110;border-radius:14px 14px 4px 4px;box-shadow:0 30px 50px -30px rgba(0,0,0,.9);position:relative}
.vt .vt-in-laptop:after{content:"";position:absolute;left:-26px;right:-26px;bottom:-12px;height:12px;border-radius:0 0 14px 14px;background:color-mix(in srgb,var(--chalk) 30%,#0d1110)}
.vt .vt-in-screen{background:var(--bg);color:var(--ink);border-radius:6px 6px 0 0;padding:20px;display:flex;flex-direction:column;gap:12px;min-height:190px}
.vt .vt-in-file{display:flex;flex-direction:column;padding-inline-start:44px;position:relative}
.vt .vt-in-file:before{content:"X";position:absolute;inset-inline-start:0;top:0;width:34px;height:38px;border-radius:6px;background:#1f7a46;color:#fff;font-weight:800;display:grid;place-items:center}
.vt .vt-in-file b{font-size:15px}.vt .vt-in-file span{font-size:12.5px;color:var(--vt-muted)}
.vt .vt-in-bar{height:9px;border-radius:5px;background:color-mix(in srgb,var(--ink) 8%,transparent);overflow:hidden}
.vt .vt-in-bar i{display:block;height:100%;background:var(--brand);border-radius:5px;transform-origin:left;animation:vt-grow 2s cubic-bezier(.4,0,.2,1) .5s both}
.vt .vt-in-done{display:flex;flex-direction:column;animation:vt-rise .5s ease 2.5s both}
.vt .vt-in-done b{font-family:var(--font-display);font-size:22px;color:#1f6a43}.vt .vt-in-done span{font-size:13px;color:var(--vt-muted)}
.vt .vt-in-langs{display:flex;gap:8px;margin-top:18px}
.vt .vt-in-langs span{padding:6px 14px;border-radius:99px;border:1px solid color-mix(in srgb,var(--chalk) 25%,transparent);font-size:14px;animation:vt-lang 3s ease-in-out infinite}
.vt .vt-in-langs span:nth-child(2){animation-delay:1s;font-family:'Noto Naskh Arabic','Amiri',serif}.vt .vt-in-langs span:nth-child(3){animation-delay:2s}
@keyframes vt-lang{0%,100%{background:transparent;color:inherit}15%,30%{background:var(--chalk);color:var(--slate)}}

/* l'offre : une carte, le prix d'un côté, le formulaire de l'autre */
.vt .vt-deal{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);margin-top:56px;border-radius:22px;overflow:hidden;background:var(--slate-2);box-shadow:0 40px 80px -50px rgba(0,0,0,.9);
  border:1px solid color-mix(in srgb,var(--chalk) 12%,transparent)}
.vt .vt-deal-side{padding:clamp(22px,3vw,36px);display:flex;flex-direction:column;gap:20px}
.vt .vt-deal .vt-price{background:none;padding:0}
.vt .vt-deal .vt-price b{font-size:clamp(30px,3.4vw,42px);color:var(--craie)}
.vt .vt-deal-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.vt .vt-deal-list li{position:relative;padding-inline-start:28px;color:color-mix(in srgb,var(--chalk) 88%,transparent)}
.vt .vt-deal-list li:before{content:"";position:absolute;inset-inline-start:2px;top:.42em;width:12px;height:6px;border-left:2.5px solid var(--craie);border-bottom:2.5px solid var(--craie);transform:rotate(-45deg)}
.vt .vt-deal-contact{margin:auto 0 0;font-size:15px;color:color-mix(in srgb,var(--chalk) 75%,transparent)}
.vt .vt-deal-contact a{color:var(--chalk);font-weight:600}
.vt .vt-deal .vt-offer{position:static;padding:10px}
.vt .vt-deal .vt-form,.vt .vt-deal .vt-done{height:100%;border-radius:16px}
@media(max-width:980px){.vt .vt-feats,.vt .vt-deal{grid-template-columns:1fr}.vt .vt-stage{height:420px}}
@media(max-width:640px){.vt .vt-feat-list button b{font-size:18px}.vt .vt-stage{height:400px}.vt .vt-stage-in{padding:16px}.vt .vt-cu-doc{width:140px}.vt .vt-cu-link{gap:120px}
  .vt .vt-bu-row{grid-template-columns:86px 0 1fr 42px}.vt .vt-bu-row small{display:none}.vt .vt-ro-row{grid-template-columns:90px 1fr auto}.vt .vt-deal .vt-form{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.vt .vt-in-langs span{animation:none}}

/* Confiance */
.vt .vt-trust{padding:96px 0}
.vt .vt-trust h2{margin-bottom:16px}
.vt .vt-trust-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px;align-items:center}
.vt .vt-vault{position:relative;width:min(360px,100%);height:230px;margin-top:22px}
.vt .vt-shield{position:absolute;left:50%;top:50%;width:150px;height:175px;transform:translate(-50%,-50%);overflow:visible;filter:drop-shadow(0 20px 30px rgba(0,0,0,.18))}
.vt .vt-shield .sh{fill:color-mix(in srgb,var(--brand) 12%,var(--surface));stroke:var(--brand);stroke-width:3;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.6s ease .2s}
.vt .vt-shield .lk{fill:none;stroke:var(--ink);stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transform:translateY(-10px);transition:stroke-dashoffset .8s ease 1.2s,transform .5s cubic-bezier(.3,1.6,.5,1) 2.1s}
.vt .vt-shield .bd{fill:var(--ink);opacity:0;transform-origin:60px 81px;transform:scale(.6);transition:opacity .4s ease 1.4s,transform .5s cubic-bezier(.2,1.4,.4,1) 1.4s}
.vt .vt-shield .ck{fill:none;stroke:var(--craie);stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .6s ease 2.5s}
.vt .vt-trust-text.in .vt-shield .sh,.vt .vt-trust-text.in .vt-shield .lk,.vt .vt-trust-text.in .vt-shield .ck{stroke-dashoffset:0}
.vt .vt-trust-text.in .vt-shield .lk{transform:none}
.vt .vt-trust-text.in .vt-shield .bd{opacity:1;transform:none}
.vt .vt-orbit{position:absolute;padding:6px 12px;border-radius:99px;background:var(--surface);border:1px solid var(--line);font-size:13.5px;font-weight:600;box-shadow:0 10px 24px -16px rgba(0,0,0,.5);opacity:0;transition:opacity .6s ease}
.vt .vt-trust-text.in .vt-orbit{opacity:1;animation:vt-float 5s ease-in-out infinite}
.vt .vt-orbit.o1{left:0;top:20px;transition-delay:2.8s}
.vt .vt-orbit.o2{right:0;top:70px;transition-delay:3s;animation-delay:1.2s !important}
.vt .vt-orbit.o3{left:20px;bottom:10px;transition-delay:3.2s;animation-delay:2.4s !important}
.vt .vt-promises{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.vt .vt-promises li{display:flex;gap:18px;align-items:flex-start;padding:20px 22px;border-radius:18px;background:var(--surface);border:1px solid var(--line);box-shadow:0 18px 40px -34px rgba(0,0,0,.5);
  transition:opacity .8s ease,transform .8s cubic-bezier(.2,.8,.2,1),border-color .3s,box-shadow .3s}
.vt .vt-promises li.in:hover{transform:translateX(6px);border-color:color-mix(in srgb,var(--brand) 40%,var(--line));box-shadow:0 22px 44px -30px rgba(0,0,0,.5)}
.vt .vt-promises li > div{display:flex;flex-direction:column;gap:4px}
.vt .vt-promises b{font-family:var(--font-display);font-size:20px;letter-spacing:-.01em}
.vt .vt-promises li > div > span{color:var(--vt-muted)}
.vt .vt-pr-ic{flex:none;width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,var(--brand) 13%,transparent);color:var(--brand)}
.vt .vt-promises li:nth-child(2) .vt-pr-ic{background:color-mix(in srgb,var(--craie) 28%,transparent);color:color-mix(in srgb,var(--craie) 40%,var(--ink))}
.vt .vt-pr-ic svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.vt .vt-pr-ic path{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.3s ease calc(var(--k,0) * 90ms + .4s)}
.vt .vt-promises li.in .vt-pr-ic path{stroke-dashoffset:0}
@media(max-width:900px){.vt .vt-trust-grid{grid-template-columns:1fr;gap:28px}.vt .vt-trust{padding:64px 0}.vt .vt-vault{margin-inline:auto}}
@media (prefers-reduced-motion:reduce){.vt .vt-shield *,.vt .vt-pr-ic path{stroke-dashoffset:0 !important;opacity:1 !important;transform:none !important}.vt .vt-orbit{opacity:1;animation:none !important}}

/* Questions */
.vt .vt-faq{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.vt .vt-faq .vt-h3{margin-top:24px}
.vt details{border-bottom:1px solid var(--line);padding:14px 0}
.vt summary{cursor:pointer;font-weight:600;font-size:18px}
.vt details p{margin:10px 0 0;color:var(--vt-muted)}

/* Pied de page */
.vt .vt-foot{background:var(--slate);color:var(--chalk);padding:0;margin-top:120px;position:relative;
  background-image:none}
.vt .vt-foot-cta{display:flex;justify-content:space-between;align-items:center;gap:20px 32px;flex-wrap:wrap;padding:30px clamp(22px,3vw,40px);border-radius:22px;transform:translateY(-50%);margin-bottom:-20px;
  background:var(--brand);color:var(--on-brand);box-shadow:0 30px 60px -30px rgba(0,0,0,.6);position:relative;overflow:hidden}
.vt .vt-foot-cta:before{content:"";position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;border:30px solid color-mix(in srgb,var(--craie) 35%,transparent);animation:vt-float 7s ease-in-out infinite}
.vt .vt-foot-cta > div:first-child{display:flex;flex-direction:column;gap:4px;position:relative}
.vt .vt-foot-cta b{font-family:var(--font-display);font-size:clamp(22px,2.4vw,30px);letter-spacing:-.02em}
.vt .vt-foot-cta span{opacity:.88}
.vt .vt-foot-cta-btns{display:flex;gap:10px;flex-wrap:wrap;position:relative}
.vt .vt-btn.ghost{background:transparent;color:inherit;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,currentColor 60%,transparent)}
.vt .vt-btn.ghost:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.vt .vt-foot-cta .vt-btn{transition:transform .2s}
.vt .vt-foot-cta .vt-btn:hover{transform:translateY(-2px)}
.vt .vt-foot-grid{padding-top:20px}
.vt .vt-foot-langs{display:flex;gap:8px;flex-wrap:wrap}
.vt .vt-foot-langs span{font-size:13.5px;padding:5px 12px;border-radius:99px;border:1px solid color-mix(in srgb,var(--chalk) 22%,transparent);color:color-mix(in srgb,var(--chalk) 85%,transparent)}
.vt .vt-foot-langs span[lang=ar]{font-size:15px;font-family:'Noto Naskh Arabic','Amiri',serif}
.vt .vt-foot-col a.ic{display:inline-flex;align-items:center;gap:10px}
.vt .vt-foot-col a.ic svg{width:18px;height:18px;flex:none;fill:none;stroke:var(--craie);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.vt .vt-foot-col a{position:relative;width:fit-content}
.vt .vt-foot-word{font-family:var(--font-display);font-weight:800;font-size:min(170px,calc(min(1200px,100vw - 48px) / (var(--len) * .6)));line-height:.95;letter-spacing:-.05em;margin-top:56px;white-space:nowrap;overflow:hidden;text-overflow:clip;
  color:transparent;-webkit-text-stroke:1px color-mix(in srgb,var(--chalk) 22%,transparent);user-select:none}
.vt .vt-totop{margin-inline-start:auto;display:inline-flex;align-items:center;gap:6px;color:var(--chalk);text-decoration:none;font-weight:600;padding:6px 12px;border-radius:99px;border:1px solid color-mix(in srgb,var(--chalk) 22%,transparent);transition:background .25s}
.vt .vt-totop svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .25s}
.vt .vt-totop:hover{background:color-mix(in srgb,var(--chalk) 10%,transparent)}
.vt .vt-totop:hover svg{transform:translateY(-3px)}
@media(max-width:640px){.vt .vt-foot{margin-top:100px}.vt .vt-foot-cta{transform:translateY(-40%)}.vt .vt-totop{margin-inline-start:0}}
@media (prefers-reduced-motion:reduce){.vt .vt-foot-cta:before,.vt .vt-login:after{animation:none}}
.vt .vt-foot-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr 1.2fr;gap:40px}
.vt .vt-foot .vt-brand{color:var(--chalk)}
.vt .vt-foot .vt-mark{background:var(--chalk);color:var(--slate)}
.vt .vt-foot-brand p{color:color-mix(in srgb,var(--chalk) 75%,transparent);font-size:16px;max-width:38ch;margin:14px 0 20px}
.vt .vt-btn.alt{background:var(--chalk);color:var(--slate)}
.vt .vt-foot-col{display:flex;flex-direction:column;gap:10px;margin:0;font-size:16px}
.vt .vt-foot-col h4{font-size:15px;color:var(--craie);margin-bottom:4px;letter-spacing:0}
.vt .vt-foot-col a,.vt .vt-foot-col button,.vt .vt-foot-col span{color:color-mix(in srgb,var(--chalk) 80%,transparent);text-decoration:none;font:inherit;background:none;border:0;padding:0;text-align:left}
.vt .vt-foot-col a,.vt .vt-foot-col button{cursor:pointer;transition:color .2s,transform .2s}
.vt .vt-foot-col a:hover,.vt .vt-foot-col button:hover{color:var(--chalk);transform:translateX(3px)}
.vt .vt-foot-bottom{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px;padding-top:20px;padding-bottom:28px;border-top:1px solid color-mix(in srgb,var(--chalk) 18%,transparent);font-size:14px;color:color-mix(in srgb,var(--chalk) 65%,transparent)}

/* Bulletin modèle Classique */
.vt .vt-paper{font-family:'Source Serif 4',Georgia,serif;padding:20px 22px 18px;max-width:500px;animation:vt-float 7s ease-in-out 3s infinite}
.vt .vt-bl-head{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;line-height:1.35;border-bottom:2px solid var(--paper-ink);padding-bottom:8px}
.vt .vt-bl-head b{display:block;font-size:13px}
.vt .vt-bl-head span{display:block;color:#59615d}
.vt .vt-bl-head .r{text-align:right}
.vt .vt-bl-head .r i{display:block;color:#59615d}
.vt .vt-bl-title{text-align:center;font-weight:700;font-size:15.5px;letter-spacing:.06em;margin:12px 0 8px}
.vt .vt-bl-id{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;border:1px solid var(--paper-ink);padding:6px 9px;font-size:12.5px;margin-bottom:8px}
.vt .vt-bl-table{width:100%;border-collapse:collapse;font-size:13px}
.vt .vt-bl-table th,.vt .vt-bl-table td{border:1px solid var(--paper-ink);padding:4px 6px}
.vt .vt-bl-table th{background:#eceeed;font-size:11px;text-align:left;letter-spacing:.02em}
.vt .vt-bl-table td.c{text-align:center}
.vt .vt-bl-table td.n{text-align:right;font-variant-numeric:tabular-nums}
.vt .vt-bl-table tbody tr{animation:vt-row .5s ease calc(.9s + var(--r) * .18s) both}
.vt .vt-bl-sum{display:grid;grid-template-columns:1.3fr 1fr 1fr;border:1px solid var(--paper-ink);border-top:0}
.vt .vt-bl-sum div{padding:6px 8px;border-right:1px solid var(--paper-ink);font-size:11.5px;color:#59615d}
.vt .vt-bl-sum div:last-child{border-right:0}
.vt .vt-bl-sum b{display:block;font-size:16px;color:var(--paper-ink);font-variant-numeric:tabular-nums}
.vt .vt-bl-foot{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:12px;color:#6b726f}
.vt .vt-bl-dots{position:absolute;left:4px;bottom:-24px;display:flex;gap:6px}
.vt .vt-bl-dots i{width:7px;height:7px;border-radius:50%;background:#cfccc2;transition:background .3s,width .3s}
.vt .vt-bl-dots i.on{background:var(--ink-stamp);width:18px;border-radius:4px}
.vt .vt-bl-foot{padding-left:0}
.vt .vt-paper .vt-qr{margin-left:auto;order:2}
.vt .vt-stamp{right:auto;left:50%;bottom:16px;margin-left:30px}
.vt .vt-swap{display:inline-block;animation:vt-swap .5s ease both}
@keyframes vt-row{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
@keyframes vt-swap{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes vt-float{50%{transform:rotate(-2deg) translateY(-8px)}}

/* Titre et contenu de la bannière : entrée orchestrée */
.vt .vt-l{display:inline-block;animation:vt-rise .8s cubic-bezier(.2,.8,.2,1) calc(var(--i) * .12s) both}
.vt .vt-in{animation:vt-rise .8s cubic-bezier(.2,.8,.2,1) calc(var(--i) * .12s + .1s) both}
.vt .vt-paper.vt-in{animation:vt-paper-in 1s cubic-bezier(.2,.8,.2,1) .3s both,vt-float 7s ease-in-out 3s infinite}
@keyframes vt-rise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
@keyframes vt-paper-in{from{opacity:0;transform:rotate(6deg) translateY(40px) scale(.94)}to{opacity:1;transform:rotate(-2deg)}}
.vt .vt-hero:after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.35;
  background:none}

/* Photos des écoles en fond de bannière : fondu lent, léger zoom, voile ardoise pour la lisibilité */
.vt .vt-slides{position:absolute;inset:0;z-index:-3;overflow:hidden}
.vt .vt-slides img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.6s ease}
.vt .vt-slides img.cur{opacity:1;animation:vt-zoom 9s ease-out both}
@keyframes vt-zoom{from{transform:scale(1.1)}to{transform:scale(1)}}
.vt .vt-hero.photos:before{z-index:-2;opacity:1;background:color-mix(in srgb,var(--slate) 80%,transparent)}
.vt .vt-cap{position:absolute;left:clamp(16px,3.2vw,48px);bottom:18px;margin:0;font-size:14px;color:color-mix(in srgb,var(--chalk) 85%,transparent);background:rgba(0,0,0,.28);padding:3px 12px;border-radius:99px;animation:vt-swap .6s ease both}
@media(max-width:980px){.vt .vt-hero.photos:before{background:color-mix(in srgb,var(--slate) 82%,transparent)}}

/* La plateforme en chiffres : de vrais totaux, qui défilent jusqu'à leur valeur */
.vt .vt-figures{padding:60px 0 56px;border-bottom:1px solid var(--line);position:relative;overflow:hidden;
}
.vt .vt-fig-head{display:flex;justify-content:space-between;align-items:center;gap:10px 24px;flex-wrap:wrap;margin-bottom:26px}
.vt .vt-fig-title{font-size:clamp(24px,2.6vw,32px);font-weight:800}
.vt .vt-fig-live{display:inline-flex;align-items:center;gap:10px;padding:7px 14px;border-radius:99px;background:var(--surface);border:1px solid var(--line);font-size:14.5px;color:var(--vt-muted)}
.vt .vt-fig-grid{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));gap:18px}
.vt .vt-fig{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:22px 22px 26px;border-radius:18px;background:var(--surface);border:1px solid var(--line);overflow:hidden;
  box-shadow:0 18px 40px -32px rgba(0,0,0,.45);transition:opacity .8s ease,transform .8s cubic-bezier(.2,.8,.2,1),box-shadow .3s,border-color .3s}
.vt .vt-fig.in:hover{transform:translateY(-4px);box-shadow:0 26px 50px -30px rgba(0,0,0,.5);border-color:color-mix(in srgb,var(--brand) 40%,var(--line))}
.vt .vt-fig-ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--craie) 28%,transparent);color:color-mix(in srgb,var(--craie) 40%,var(--ink));flex:none}
.vt .vt-fig-top{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px}
.vt .vt-fig:nth-child(2n) .vt-fig-ic{background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand)}
.vt .vt-fig-ic svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.vt .vt-fig-ic path{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.4s ease calc(var(--k,0) * 120ms + .2s)}
.vt .vt-fig.in .vt-fig-ic path{stroke-dashoffset:0}
.vt .vt-fig b{font-family:var(--font-display);font-size:clamp(40px,4.6vw,60px);line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.vt .vt-fig-l{color:var(--vt-muted);font-size:15.5px;line-height:1.4}
.vt .vt-fig-bar{position:absolute;left:0;bottom:0;height:4px;width:100%;background:var(--brand);transform:scaleX(0);transform-origin:left;transition:transform 1.4s cubic-bezier(.2,.8,.2,1) calc(var(--k,0) * 120ms + .3s)}
.vt .vt-fig.in .vt-fig-bar{transform:scaleX(1)}
.vt .vt-visits{display:flex;flex-wrap:wrap;justify-content:center;align-items:stretch;gap:12px;margin-top:18px}
.vt .vt-visits-t{display:inline-flex;align-items:center;gap:10px;font-weight:600;padding:0 6px 0 0;color:var(--vt-muted)}
.vt .vt-visits-t svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
.vt .vt-visit{display:flex;justify-content:center;align-items:baseline;gap:10px;padding:12px 18px;border-radius:14px;background:var(--surface);border:1px solid var(--line)}
.vt .vt-visit b{font-family:var(--font-display);font-size:26px;font-variant-numeric:tabular-nums;color:var(--ink)}
.vt .vt-visit small{font-size:14px;color:var(--vt-muted)}
@media(max-width:980px){.vt .vt-fig-grid{grid-template-columns:repeat(min(var(--n,4),2),minmax(0,1fr))}}
@media(max-width:520px){.vt .vt-fig-grid{grid-template-columns:1fr}.vt .vt-visit{flex:1 1 100%}}
@media (prefers-reduced-motion:reduce){.vt .vt-fig-ic path{stroke-dashoffset:0}.vt .vt-fig-bar{transform:none}}
.vt .vt-dot{width:10px;height:10px;border-radius:50%;background:#2fbf71;box-shadow:0 0 0 0 rgba(47,191,113,.6);animation:vt-pulse 2s infinite}
@keyframes vt-pulse{70%{box-shadow:0 0 0 10px rgba(47,191,113,0)}100%{box-shadow:0 0 0 0 rgba(47,191,113,0)}}


/* Bande défilante */
.vt .vt-marquee{overflow:hidden;background:var(--craie);color:var(--slate);padding:13px 0;font-family:var(--font-display);font-weight:600;font-size:17px;white-space:nowrap}
.vt .vt-track{display:inline-flex;gap:0;animation:vt-marq 38s linear infinite}
.vt .vt-track span{padding:0 22px;position:relative}
.vt .vt-track span:after{content:"";position:absolute;right:-4px;top:50%;width:8px;height:8px;border-radius:2px;background:var(--slate);transform:translateY(-50%) rotate(45deg)}
.vt .vt-marquee:hover .vt-track{animation-play-state:paused}
@keyframes vt-marq{to{transform:translateX(-50%)}}

/* Apparition au défilement */
.vt .rv{opacity:0;transform:translateY(30px);transition:opacity .8s ease,transform .8s cubic-bezier(.2,.8,.2,1);transition-delay:calc(var(--k,0) * 90ms)}
.vt .rv.in{opacity:1;transform:none}

/* Les objets des familles s'animent chacun à leur façon */
.vt .vt-objects .vt-notif,.vt .vt-objects .vt-receipt,.vt .vt-objects .vt-check,.vt .vt-objects .vt-annonce{opacity:0}
.vt .vt-objects.in .vt-notif{animation:vt-push .7s cubic-bezier(.2,1.3,.4,1) .1s both}
.vt .vt-objects.in .vt-receipt{animation:vt-print 1.1s steps(9,end) .45s both}
.vt .vt-objects.in .vt-check{animation:vt-rise .7s ease .8s both}
.vt .vt-objects.in .vt-check .vt-qr{position:relative;overflow:hidden}
.vt .vt-objects.in .vt-check .vt-qr:after{content:"";position:absolute;left:-4px;right:-4px;height:3px;background:#2fbf71;box-shadow:0 0 10px #2fbf71;animation:vt-scan 1.6s ease-in-out 1s 2 both}
.vt .vt-objects.in .vt-check b{animation:vt-rise .5s ease 2.6s both}
.vt .vt-objects.in .vt-annonce{animation:vt-slide .7s cubic-bezier(.2,.8,.2,1) 1.2s both}
@keyframes vt-push{from{opacity:0;transform:translateY(-30px) scale(.92)}to{opacity:1;transform:none}}
@keyframes vt-print{from{opacity:1;clip-path:inset(0 0 100% 0)}to{opacity:1;clip-path:inset(0 0 0 0)}}
@keyframes vt-scan{0%{top:0}50%{top:calc(100% - 3px)}100%{top:0}}
@keyframes vt-slide{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
.vt .vt-obj{transition:transform .3s}
.vt .vt-obj:hover{transform:translateY(-6px)}

/* Étapes : le trait se dessine */
.vt .vt-steps li{border-top-color:transparent;background:linear-gradient(var(--ink),var(--ink)) top left/0 2px no-repeat;transition:background-size 1s ease calc(var(--k,0) * 200ms)}
.vt .vt-steps li.in{background-size:100% 2px}

/* Écoles : les deux bulletins se retournent, les arguments s'illuminent */
.vt .vt-twins span{transition:transform .5s}
.vt .vt-benefits .star.in .vt-twins span{animation:vt-flip .9s ease both}
.vt .vt-benefits .star.in .vt-twins span + span{animation-delay:.25s}
@keyframes vt-flip{from{transform:rotateY(90deg)}to{transform:none}}
.vt .vt-benefits > div{transition:opacity .8s ease,transform .8s cubic-bezier(.2,.8,.2,1),background .3s;border-radius:4px}
.vt .vt-benefits > div:hover{background:color-mix(in srgb,var(--chalk) 5%,transparent)}
.vt .vt-btn{transition:transform .2s,box-shadow .2s,filter .2s}
.vt .vt-btn:hover{transform:translateY(-2px);box-shadow:0 10px 20px -12px rgba(0,0,0,.55)}
.vt .vt-door{transition:transform .25s,border-color .25s,box-shadow .25s}
.vt .vt-door:hover{transform:translateY(-3px);box-shadow:0 16px 30px -18px rgba(0,0,0,.6)}

@media(max-width:980px){
  .vt .vt-foot-grid{grid-template-columns:1fr 1fr}
  .vt .vt-hero-grid,.vt .vt-schools-grid{grid-template-columns:minmax(0,1fr)}
  .vt .vt-paper{justify-self:center;transform:rotate(-1.5deg)}
  .vt .vt-objects{grid-template-columns:1fr 1fr}
  .vt .vt-offer{position:static}
}
@media(max-width:640px){
  .vt nav:not(.vt-nav){display:none}
  .vt .vt-bar{gap:10px}
  .vt .vt-brand span:last-child{font-size:16px;line-height:1.2}
  .vt .vt-tools{margin-inline-start:auto}
  .vt .vt-bar .vt-btn{padding:9px 14px;font-size:15px;white-space:nowrap}
  .vt .vt-hero{padding:48px 0 72px}
  .vt .vt-doors,.vt .vt-objects,.vt .vt-steps,.vt .vt-promises,.vt .vt-faq,.vt .vt-form,.vt .vt-foot-grid{grid-template-columns:1fr}
  .vt .vt-bl-table{font-size:12px}
  .vt .vt-bl-head{font-size:10.5px}
  .vt .vt-sec{padding:56px 0}
  .vt .vt-schools{padding:64px 0}
  .vt .vt-paper{padding:20px 18px 18px}
  .vt .vt-stamp{right:12px;bottom:12px;font-size:15px}
}
@media(prefers-reduced-motion:reduce){.vt *,.vt *:before,.vt *:after{animation:none!important;transition:none!important}
  .vt .rv{opacity:1;transform:none}
  .vt h2 .vt-w{opacity:1;transform:none;filter:none}.vt h2.rv:after{transform:scaleX(1)}
  .vt .vt-objects .vt-notif,.vt .vt-objects .vt-receipt,.vt .vt-objects .vt-check,.vt .vt-objects .vt-annonce{opacity:1}
  .vt .vt-steps li{background-size:100% 2px}}
`,
})
export class VitrinePage implements AfterViewInit {
  private readonly store = inject(Store);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroy = inject(DestroyRef);
  readonly year = new Date().getFullYear();
  readonly subjects = SUBJECTS;
  readonly terms = TERMS;
  readonly marqueeTwice = [...MARQUEE, ...MARQUEE];
  /** Bulletin d'exemple : le trimestre affiché et les moyennes, qui défilent jusqu'à leur nouvelle valeur. */
  readonly term = signal(0);
  readonly cur3 = computed(() => TERMS[this.term()]);
  readonly vals = signal<number[]>(TERMS[0].v.map(() => 0));
  readonly avg = computed(() => { const v = this.vals(); return v.reduce((a, x, i) => a + x * SUBJECTS[i].c, 0) / SUBJECTS.reduce((a, x) => a + x.c, 0); });
  readonly scrolled = signal(false);
  // Démonstrations « saisie des notes » et « emploi du temps » : une étape toutes les 450 ms quand la section est visible
  readonly notes = NOTES;
  readonly days = DAYS;
  readonly slots = SLOTS;
  readonly courses = COURSES;
  readonly now = NOW;
  readonly replaced = REPLACED;
  readonly demo = signal<'notes' | 'edt'>('notes');
  readonly step = signal(0);
  readonly demoPaused = signal(false);
  private demoVisible = false;
  readonly demoProgress = computed(() => Math.min(1, this.step() / (this.demoEnd(this.demo()) + DEMO_HOLD)));
  readonly notesAvg = computed(() => { const n = Math.min(this.step(), NOTES.length); return n ? NOTES.slice(0, n).reduce((a, r) => a + r[1], 0) / n : null; });
  readonly notesMax = computed(() => { const n = Math.min(this.step(), NOTES.length); return n ? Math.max(...NOTES.slice(0, n).map((r) => r[1])) : null; });
  readonly notesMin = computed(() => { const n = Math.min(this.step(), NOTES.length); return n ? Math.min(...NOTES.slice(0, n).map((r) => r[1])) : null; });
  /** Appréciation d'après les seuils habituels des bulletins (16, 14, 12, 10). */
  appreciation(v: number): string { return v >= 16 ? 'Très bien' : v >= 14 ? 'Bien' : v >= 12 ? 'Assez bien' : v >= 10 ? 'Passable' : 'Insuffisant'; }
  course(d: number, s: number): { n: string; h: number; room: string; i: number } | null {
    const i = COURSES.findIndex((c) => c.d === d && c.s === s);
    return i < 0 ? null : { n: COURSES[i].n, h: COURSES[i].h, room: COURSES[i].room, i };
  }
  showDemo(k: 'notes' | 'edt'): void { this.demo.set(k); this.step.set(this.calm() ? this.demoEnd(k) : 0); }
  private demoEnd(k: 'notes' | 'edt'): number { return k === 'notes' ? NOTES.length + 2 : COURSES.length + 2; }
  private demoTick(): void {
    if (!this.demoVisible || this.demoPaused() || document.hidden) return;
    const k = this.demo();                             // le résultat reste affiché quelques secondes avant la démonstration suivante
    if (this.step() < this.demoEnd(k) + DEMO_HOLD) this.step.update((n) => n + 1);
    else this.showDemo(k === 'notes' ? 'edt' : 'notes');
  }

  /** Fréquentation de la page d'accueil (réglage de l'administration) ; un total nul n'est pas affiché. */
  readonly visits = computed(() => {
    const v = this.store.accueil().visiteurs;
    if (!v) return [];
    return [{ k: 'j', v: v.aujourdhui, l: 'Visiteurs aujourd’hui' }, { k: 'm', v: v.mois, l: 'Ces 30 derniers jours' }, { k: 't', v: v.total, l: 'Depuis le lancement' }].filter((x) => x.v > 0);
  });
  /** Chiffres réels de la plateforme (réglage de l'administration) ; un total nul n'est pas affiché. */
  readonly figures = computed(() => {
    const c = this.store.accueil().chiffres;
    if (!c) return [];
    return [{ k: 'ecoles', v: c.ecoles, l: c.ecoles > 1 ? 'écoles utilisent la plateforme' : 'école utilise la plateforme' },
      { k: 'eleves', v: c.eleves, l: 'élèves suivis' },
      { k: 'connectes', v: c.connectes, l: 'parents, élèves et membres du personnel connectés ce mois-ci' },
      { k: 'paiements', v: c.paiements, l: 'paiements de scolarité enregistrés' }].filter((f) => f.v > 0);
  });
  /** Photos des écoles qui défilent en fond de la bannière. */
  readonly idx = signal(0);
  readonly slide = computed(() => (this.slides().length ? this.idx() % this.slides().length : 0));
  num(v: number, d = 2): string { return v.toFixed(d).replace('.', ','); }
  readonly navLinks = [{ id: 'equipes', t: 'Équipes' }, { id: 'familles', t: 'Familles' }, { id: 'ecoles', t: 'Écoles' }, { id: 'faq', t: 'Questions' }];
  /** Section en cours (repérée dans le menu), avancement de la lecture et menu du téléphone. */
  readonly active = signal('');
  readonly progress = signal(0);
  readonly menu = signal(false);
  @HostListener('window:scroll') onScroll(): void {
    this.scrolled.set(window.scrollY > 12);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    this.progress.set(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    let cur = '';
    for (const l of this.navLinks) { const el = document.getElementById(l.id); if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.35) cur = l.id; }
    this.active.set(cur);
  }
  readonly login = output<void>();
  readonly school = this.store.school;
  readonly groups = GROUPS;
  readonly sel = signal(0);
  readonly cur = computed(() => GROUPS[this.sel()]);
  // Atouts pour les écoles : défilent seuls jusqu'à ce que le visiteur en choisisse un
  readonly feats = FEATS;
  readonly feat = signal(0);
  readonly featPaused = signal(false);
  readonly featAuto = signal(true);
  private readonly featT = signal(0);
  private featVisible = false;
  readonly featProgress = computed(() => this.featAuto() ? this.featT() / FEAT_MS : 1);
  pickFeat(i: number): void { this.featAuto.set(false); this.feat.set(i); }
  readonly bulletinBars = [{ n: 'Mathématiques', c: 4, v: 17 }, { n: 'Français', c: 4, v: 14.25 }, { n: 'Anglais', c: 2, v: 15 }, { n: 'SVT', c: 2, v: 16.5 }];
  readonly rights = [['Direction', 'Publier les notes', true], ['Secrétariat', 'Publier les notes', false], ['Comptabilité', 'Enregistrer un paiement', true], ['Enseignant', 'Voir les autres classes', false]] as const;
  /** Écrans d'exemple du téléphone (données fictives) : l'appel d'une classe et les absences de la semaine. */
  readonly appel = [['AKA Léa', 'p'], ['BAMBA Issa', 'p'], ['COULIBALY Fanta', 'a'], ['DIALLO Moussa', 'r'], ['KONAN Grâce', 'p'], ['KOUASSI Awa', 'p']] as const;
  readonly absences = [62, 38, 80, 45, 28];
  // Profils : défilent seuls (barre de progression sous l'onglet) jusqu'à ce que le visiteur en choisisse un
  readonly profPaused = signal(false);
  readonly profAuto = signal(true);
  private readonly profT = signal(0);
  private profVisible = false;
  readonly profProgress = computed(() => this.profAuto() ? this.profT() / PROFILE_MS : 1);
  readonly inkL = signal(0);
  readonly inkW = signal(0);
  private readonly inkFx = effect(() => { this.sel(); setTimeout(() => this.measureInk(), 0); });
  pickProfile(i: number): void { this.profAuto.set(false); this.sel.set(i); }
  @HostListener('window:resize') measureInk(): void {
    const b = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.vt-tabs [aria-selected=true]');
    if (b) { this.inkL.set(b.offsetLeft); this.inkW.set(b.offsetWidth); }
  }
  readonly initial = computed(() => (this.site().name || 'É').trim().charAt(0).toUpperCase());
  /** Photos réglées dans l'administration de la plateforme (page d'accueil), ou `window.ECOLE_PHOTOS` dans config.js. */
  readonly slides = computed(() => this.store.accueil().photos);
  /** Bulletin d'exemple dans la bannière (réglage « carte d'exemple » de l'administration). */
  readonly carte = computed(() => this.store.accueil().carte);
  /** Nom et logo affichés : ceux de la plateforme, sinon ceux de l'école (installation à une seule école). */
  readonly site = computed(() => ({ name: this.store.accueil().nom || this.school().name, logo: this.store.accueil().logo || this.school().logo }));
  readonly contact = computed(() => this.store.accueil().contact ?? { whatsapp: '', telephone: '', email: '' });
  readonly prix = computed(() => this.store.accueil().prix ?? null);
  readonly wa = computed(() => { const d = this.contact().whatsapp.replace(/\D/g, ''); return d ? `https://wa.me/${d}` : ''; });
  readonly tel = computed(() => this.contact().telephone.replace(/[^\d+]/g, ''));

  // Demande de démonstration
  f = { ecole: '', ville: '', nom: '', telephone: '', email: '', message: '', site: '' };
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly err = signal<Record<string, string>>({});

  fcfa(n: number): string { return `${n.toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`; }
  go(): void { this.login.emit(); }

  async send(): Promise<void> {
    const e: Record<string, string> = {};
    if (this.f.ecole.trim().length < 2) e['ecole'] = 'Indiquez le nom de l’école.';
    if (this.f.nom.trim().length < 2) e['nom'] = 'Indiquez votre nom.';
    if (!/^\+?[0-9 .-]{8,30}$/.test(this.f.telephone.trim())) e['telephone'] = 'Indiquez un numéro joignable.';
    this.err.set(e);
    if (Object.keys(e).length) return;
    this.busy.set(true);
    const r = await this.store.requestDemoAsync({ ...this.f, ecole: this.f.ecole.trim(), nom: this.f.nom.trim(), telephone: this.f.telephone.trim() });
    this.busy.set(false);
    if (r.ok) this.sent.set(true);
    else this.err.set({ _: r.error ?? 'L’envoi n’a pas abouti. Réessayez dans un instant.' });
  }

  private counters: IntersectionObserver | null = null;
  private readonly figuresShown = effect(() => { if (this.figures().length || this.visits().length) this.watchFigures(); });
  private watchFigures(): void {
    setTimeout(() => (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.vt-fig b:not([data-seen]), .vt-visit b:not([data-seen])').forEach((b) => {
      b.dataset['seen'] = '1';
      this.counters?.observe(b);
    }));
  }
  private calm(): boolean { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  /** Les moyennes du bulletin défilent de leur valeur actuelle à celles du trimestre (chaque matière un peu après la précédente). */
  private tween(to: number[], delay = 900): void {
    if (this.calm()) { this.vals.set(to); return; }
    const from = this.vals(), t0 = performance.now() + delay;
    const step = (t: number) => {
      const out = to.map((v, i) => { const p = Math.min(1, Math.max(0, (t - t0 - i * 180) / 900)); return from[i] + (v - from[i]) * (1 - Math.pow(1 - p, 3)); });
      this.vals.set(out);
      if (t < t0 + 900 + to.length * 180) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  ngAfterViewInit(): void {
    const root = this.host.nativeElement as HTMLElement;
    this.store.recordVisit();
    this.tween(TERMS[0].v);
    // Titres de section : chaque mot apparaît à son tour
    root.querySelectorAll<HTMLElement>('h2').forEach((h) => {
      let i = 0;
      const words = (node: Node): void => [...node.childNodes].forEach((c) => {
        if (c.nodeType !== Node.TEXT_NODE) { words(c); return; }
        const parts = (c.textContent ?? '').split(/( +)/);
        const frag = document.createDocumentFragment();
        parts.forEach((t) => {
          if (!t) return;
          if (/^ +$/.test(t)) { frag.appendChild(document.createTextNode(t)); return; }
          const w = document.createElement('span'); w.className = 'vt-w'; w.style.setProperty('--i', String(i++)); w.textContent = t; frag.appendChild(w);
        });
        c.replaceWith(frag);
      });
      words(h);
      h.style.setProperty('--n', String(i));
    });
    this.measureInk();
    void document.fonts?.ready.then(() => this.measureInk());
    const tabsEl = root.querySelector('.vt-tabs');
    if (!this.calm() && tabsEl && 'IntersectionObserver' in window) {
      const seenTabs = new IntersectionObserver((es) => es.forEach((x) => { this.profVisible = x.isIntersecting; }), { threshold: 0.5 });
      seenTabs.observe(tabsEl);
      const ptick = setInterval(() => {
        if (!this.profAuto() || !this.profVisible || this.profPaused() || document.hidden) return;
        if (this.profT() + 100 < PROFILE_MS) { this.profT.update((t) => t + 100); return; }
        this.profT.set(0); this.sel.update((n) => (n + 1) % GROUPS.length);
      }, 100);
      this.destroy.onDestroy(() => { clearInterval(ptick); seenTabs.disconnect(); });
    } else this.profAuto.set(false);
    const featsEl = root.querySelector('.vt-feats');
    if (!this.calm() && featsEl && 'IntersectionObserver' in window) {
      const seenFeats = new IntersectionObserver((es) => es.forEach((x) => { this.featVisible = x.isIntersecting; }), { threshold: 0.4 });
      seenFeats.observe(featsEl);
      const ftick = setInterval(() => {
        if (!this.featAuto() || !this.featVisible || this.featPaused() || document.hidden) return;
        if (this.featT() + 100 < FEAT_MS) { this.featT.update((t) => t + 100); return; }
        this.featT.set(0); this.feat.update((n) => (n + 1) % FEATS.length);
      }, 100);
      this.destroy.onDestroy(() => { clearInterval(ftick); seenFeats.disconnect(); });
    } else this.featAuto.set(false);
    const screen = root.querySelector('.vt-app');
    if (this.calm()) this.step.set(this.demoEnd('notes'));
    else if (screen && 'IntersectionObserver' in window) {
      const seen = new IntersectionObserver((es) => es.forEach((x) => { this.demoVisible = x.isIntersecting; }), { threshold: 0.35 });
      seen.observe(screen);
      const tick = setInterval(() => this.demoTick(), 450);
      this.destroy.onDestroy(() => { clearInterval(tick); seen.disconnect(); });
    }
    if (!this.calm()) {   // un trimestre toutes les 7 secondes, à l'arrêt quand la page n'est pas visible
      const timer = setInterval(() => {
        if (document.hidden) return;
        const n = (this.term() + 1) % TERMS.length;
        this.term.set(n);
        this.tween(TERMS[n].v, 200);
      }, 7000);
      this.destroy.onDestroy(() => clearInterval(timer));
      const photos = setInterval(() => { if (!document.hidden && this.slides().length > 1) this.idx.set((this.slide() + 1) % this.slides().length); }, 6000);
      this.destroy.onDestroy(() => clearInterval(photos));
      const hero = root.querySelector<HTMLElement>('.vt-hero');
      hero?.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); hero.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`); hero.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`); });
    }
    // Apparition au défilement : sections, objets, arguments, étapes (chaque élément un peu après son voisin)
    // Les chiffres défilent de 0 à leur valeur quand on arrive dessus (ils arrivent du serveur après l'affichage : voir watchFigures)
    const counters = this.counters = new IntersectionObserver((es) => es.forEach((x) => {
      if (!x.isIntersecting) return;
      counters.unobserve(x.target);
      (x.target as HTMLElement).closest('.vt-fig')?.classList.add('in');   // l'icône se dessine et le trait se remplit avec le compteur
      const el = x.target as HTMLElement, to = Number(el.dataset['to'] ?? 0), fmt = (v: number) => Math.round(v).toLocaleString('fr-FR');
      if (this.calm()) { el.textContent = fmt(to); return; }
      const t0 = performance.now();
      const step = (t: number) => { const p = Math.min(1, (t - t0) / 1600); el.textContent = fmt(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }), { threshold: 0.4 });
    this.watchFigures();
    this.destroy.onDestroy(() => counters.disconnect());
    const sel = '.vt-trust-text, .vt-app, .vt-feats, .vt-deal, .vt-fig, .vt-sec h2, .vt-schools h2, .vt-sub, .vt-objects, .vt-obj, .vt-h3, .vt-steps li, .vt-benefits > div, .vt-offer, .vt-promises li, .vt-faq > div, .vt-strip figure';
    const els = Array.from(root.querySelectorAll<HTMLElement>(sel));
    els.forEach((e) => { e.classList.add('rv'); e.style.setProperty('--k', String(Array.from(e.parentElement?.children ?? []).indexOf(e) % 6)); });
    if (this.calm() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    els.forEach((e) => io.observe(e));
    this.destroy.onDestroy(() => io.disconnect());
  }

  /** Flèches, début et fin : navigation clavier entre les profils. */
  key(ev: KeyboardEvent): void {
    const n = GROUPS.length; let i = this.sel();
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') i = (i + 1) % n;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') i = (i + n - 1) % n;
    else if (ev.key === 'Home') i = 0;
    else if (ev.key === 'End') i = n - 1;
    else return;
    ev.preventDefault(); this.profAuto.set(false); this.sel.set(i);
    setTimeout(() => document.getElementById('vt-tab-' + i)?.focus());
  }
  scroll(ev: Event, id: string): void {
    ev.preventDefault();
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (id === 'top') return void window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    document.getElementById(id)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth' });
  }
}
