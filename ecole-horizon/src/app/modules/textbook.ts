import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api } from '../api';
import { ApiEntry, mapEntry } from '../api-map';
import { Store } from '../store';
import { Timetable, dayIndex } from './timetable';
import { addDays, dateFr, weekdaysBetween } from '../format';

export interface TextEntry {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  teacherName?: string;
  date: string;
  content: string;
  homework: string;
  due: string; // date de remise ('' si pas de devoir)
}

type Topic = [string, string]; // [contenu de la séance, travail à faire]
const BANK: Record<string, { c: Topic[]; l: Topic[] }> = {
  fr: {
    c: [['Étude de texte : le portrait physique et moral.', 'Rédiger le portrait d’un voisin en 10 lignes.'], ['Grammaire : la phrase complexe, propositions indépendantes et subordonnées.', 'Exercices 3 et 4, page 58.'], ['Conjugaison : le passé simple et l’imparfait dans un récit.', 'Conjuguer les verbes de l’exercice 2 au passé simple.'], ['Lecture suivie : chapitres 3 et 4 du roman au programme.', 'Résumer le chapitre 4 en 5 lignes.'], ['Orthographe : l’accord du participe passé.', '']],
    l: [['Étude de texte : le registre lyrique chez les poètes romantiques.', 'Rédiger le commentaire de la 2e strophe.'], ['Dissertation : construire un plan en trois parties.', 'Établir le plan détaillé du sujet distribué.'], ['Lecture analytique : l’incipit du roman étudié.', 'Relire l’extrait et relever les procédés d’écriture.'], ['Argumentation : thèse, arguments et exemples.', 'Rédiger un paragraphe argumenté de 15 lignes.'], ['Histoire littéraire : la littérature africaine d’expression française.', '']],
  },
  ma: {
    c: [['Calcul littéral : développer et factoriser.', 'Exercices 5, 6 et 7, page 41.'], ['Équations du premier degré à une inconnue.', 'Résoudre les cinq équations de la fiche.'], ['Théorème de Thalès : énoncé et applications.', 'Exercice 9, page 112.'], ['Fonctions linéaires et affines : représentation graphique.', 'Tracer les droites demandées dans l’exercice 3.'], ['Statistiques : moyenne, médiane et étendue.', '']],
    l: [['Dérivation : nombre dérivé et tangente à une courbe.', 'Exercices 12 et 13, page 87.'], ['Limites de fonctions : formes indéterminées.', 'Calculer les limites de la fiche (série 2).'], ['Suites numériques : suites arithmétiques et géométriques.', 'Exercice 6, page 63.'], ['Probabilités : variables aléatoires et espérance.', 'Terminer l’exercice 4 du TD.'], ['Géométrie dans l’espace : produit scalaire.', '']],
  },
  an: {
    c: [['Grammar: the simple past, regular and irregular verbs.', 'Learn the list of irregular verbs (1 to 15).'], ['Reading comprehension: “A day in the life of a student”.', 'Answer questions 1 to 5 in your copybook.'], ['Vocabulary: jobs and professions.', 'Write 8 sentences using the new words.'], ['Writing: how to write an informal letter.', 'Write a letter to a friend (80 words).'], ['Listening and speaking: giving directions.', '']],
    l: [['Grammar: the present perfect versus the simple past.', 'Exercise 4, page 74.'], ['Reading: an article on climate change.', 'Summarise the text in 6 lines.'], ['Essay writing: giving your opinion.', 'Write a 150-word essay on school uniforms.'], ['Vocabulary: expressing cause and consequence.', 'Learn the linking words list.'], ['Oral expression: debate on social media.', '']],
  },
  hg: {
    c: [['Histoire : les grandes civilisations africaines (empire du Mali).', 'Répondre aux questions du document 2.'], ['Géographie : le relief et les fleuves de la Côte d’Ivoire.', 'Réaliser le croquis du réseau hydrographique.'], ['Histoire : la traite négrière et ses conséquences.', 'Apprendre la leçon pour l’interrogation.'], ['Géographie : la population ivoirienne, répartition et densité.', ''], ['Histoire : la colonisation de l’Afrique de l’Ouest.', 'Compléter la frise chronologique.']],
    l: [['Histoire : les causes de la Première Guerre mondiale.', 'Rédiger la synthèse du chapitre.'], ['Géographie : la mondialisation et les échanges.', 'Commenter le graphique du document 3.'], ['Histoire : les indépendances africaines.', 'Apprendre les dates clés.'], ['Géographie : les enjeux du développement durable.', 'Préparer l’exposé de la semaine prochaine.'], ['Histoire : la guerre froide.', '']],
  },
  sv: {
    c: [['La digestion : des aliments aux nutriments.', 'Schématiser l’appareil digestif et légender.'], ['La reproduction chez les plantes à fleurs.', 'Dessiner une fleur et nommer ses parties.'], ['L’alimentation équilibrée et les maladies de carence.', 'Établir un menu équilibré pour une journée.'], ['La respiration chez l’être humain.', ''], ['Les microbes et l’hygiène.', 'Apprendre la leçon.']],
    l: [['Génétique : transmission des caractères héréditaires.', 'Exercice sur les croisements, fiche TD.'], ['Immunité : les défenses de l’organisme.', 'Faire le schéma-bilan de la réponse immunitaire.'], ['Géologie : la tectonique des plaques.', 'Répondre aux questions du document.'], ['Physiologie : la contraction musculaire.', ''], ['Écologie : les chaînes alimentaires et les flux d’énergie.', 'Construire un réseau trophique.']],
  },
  pc: {
    c: [['Les mélanges et les corps purs.', 'Répondre aux questions 1 à 4, page 30.'], ['Électricité : circuit en série et en dérivation.', 'Schématiser les deux circuits étudiés.'], ['La masse et le poids.', 'Exercices 2 et 3 du manuel.'], ['Les réactions chimiques, la combustion.', ''], ['La lumière : propagation et ombres.', 'Apprendre le cours.']],
    l: [['Mécanique : les lois de Newton.', 'Exercices 5 et 6 de la série.'], ['Chimie : la quantité de matière et la mole.', 'Calculer les masses molaires de la fiche.'], ['Électricité : le dipôle RLC en régime sinusoïdal.', 'Terminer le compte rendu du TP.'], ['Chimie organique : les alcools.', 'Écrire les formules semi-développées demandées.'], ['Optique : lentilles minces.', '']],
  },
  eps: {
    c: [['Athlétisme : course de vitesse, départ et relais.', ''], ['Football : passes et jeu collectif.', ''], ['Gymnastique au sol : roulades et équilibres.', ''], ['Handball : l’attaque placée.', ''], ['Endurance : course longue à allure régulière.', '']],
    l: [['Athlétisme : course de demi-fond.', ''], ['Basket-ball : défense en zone.', ''], ['Volley-ball : service et réception.', ''], ['Musculation : renforcement du tronc.', ''], ['Handball : match arbitré par les élèves.', '']],
  },
  edhc: {
    c: [['Les droits et les devoirs de l’élève.', 'Citer cinq droits de l’enfant.'], ['La citoyenneté et la vie en société.', ''], ['Le respect de l’environnement.', 'Proposer trois gestes écologiques pour l’école.'], ['La paix et la cohésion sociale.', '']],
    l: [['Les institutions de la République de Côte d’Ivoire.', ''], ['Les droits de l’homme.', 'Préparer l’exposé.'], ['Citoyenneté et civisme fiscal.', '']],
  },
  ph: {
    c: [['Introduction à la philosophie.', ''], ['La conscience.', ''], ['Le travail.', '']],
    l: [['La conscience et l’inconscient : définitions et enjeux.', 'Lire l’extrait de Freud et répondre aux questions.'], ['Le langage : outil de communication ou de pensée ?', 'Rédiger l’introduction de la dissertation.'], ['La liberté et le déterminisme.', 'Fiche de lecture sur le texte de Sartre.'], ['La vérité : peut-on tout démontrer ?', ''], ['L’État et la justice.', 'Plan détaillé du sujet distribué.']],
  },
  lv2: {
    c: [['Presentarse y saludar.', '']],
    l: [['Gramática: el pretérito indefinido.', 'Hacer los ejercicios 1 y 2, página 52.'], ['Comprensión de texto: la vida en la ciudad.', 'Contestar a las preguntas del texto.'], ['Vocabulario: la familia y las relaciones.', 'Aprender el vocabulario.'], ['Expresión escrita: describir un lugar.', 'Escribir un párrafo de 8 líneas.']],
  },
  ar: {
    c: [['Lecture et écriture : les lettres de l’alphabet.', 'Copier la page 12 deux fois.'], ['Vocabulaire : l’école et la famille.', 'Apprendre les dix mots du jour.'], ['Grammaire : la phrase nominale.', ''], ['Récitation : la sourate au programme.', 'Réviser la récitation.']],
    l: [['Lecture d’un texte court et compréhension.', 'Répondre aux questions du texte.'], ['Grammaire : le verbe au passé.', 'Conjuguer les verbes de la liste.'], ['Expression écrite : décrire sa journée.', ''], ['Vocabulaire : la vie quotidienne.', 'Apprendre le vocabulaire.']],
  },
};

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100000;
};

@Injectable({ providedIn: 'root' })
export class Textbook {
  private readonly s = inject(Store);
  private readonly tt = inject(Timetable);
  private n = 0;

  private readonly api = inject(Api);
  readonly entries = signal<TextEntry[]>(this.s.apiMode() ? [] : this.seed());

  constructor() {
    // Mode serveur : le cahier de textes vient du serveur
    effect(() => {
      const me = this.s.me();
      if (!this.s.apiMode()) return;
      if (!me) { this.entries.set([]); return; }
      void this.load();
    });
  }
  async load(): Promise<void> {
    if (!this.s.apiMode() || !this.s.me()) return;
    try {
      const rows = await this.api.all<ApiEntry>('textbook/?page_size=1000');
      const codeOf = new Map(this.s.subjects().map((x) => [this.s.subjectPkOf(x.id) ?? -1, x.id] as [number, string]));
      this.entries.set(rows.map((e) => mapEntry(e, codeOf)).filter((e): e is TextEntry => !!e));
    } catch { /* on garde l'état précédent */ }
  }
  private body(e: Partial<TextEntry>): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    if (e.classId !== undefined) o['school_class'] = Number(e.classId);
    if (e.subjectId !== undefined) o['subject'] = this.s.subjectPkOf(e.subjectId);
    if (e.date !== undefined) o['date'] = e.date;
    if (e.content !== undefined) o['content'] = e.content;
    if (e.homework !== undefined) o['homework'] = e.homework;
    if (e.due !== undefined) o['due'] = e.due || null;
    return o;
  }
  /** Enregistre sur le serveur ; renvoie un message d'erreur ou null. */
  async saveAsync(id: string | null, e: Partial<TextEntry>): Promise<string | null> {
    try {
      if (id) await this.api.patch(`textbook/${id}/`, this.body({ content: e.content, homework: e.homework, due: e.due }));
      else await this.api.post('textbook/', this.body(e));
      await this.load(); return null;
    } catch (err) { return this.s.errorMessage(err); }
  }
  /** Dernière séance saisie pour cette classe et cette matière (avant `before`) : de quoi reprendre le cahier là où il s'est arrêté. */
  async lastAsync(classId: string, subjectId: string, before = ''): Promise<TextEntry | null> {
    const pk = this.s.subjectPkOf(subjectId);
    if (!this.s.apiMode() || pk === undefined) return null;
    try {
      const e = await this.api.get<ApiEntry | null>(`textbook/last/?class=${classId}&subject=${pk}${before ? `&before=${before}` : ''}`);
      const codeOf = new Map(this.s.subjects().map((x) => [this.s.subjectPkOf(x.id) ?? -1, x.id] as [number, string]));
      return e ? mapEntry(e, codeOf) : null;
    } catch { return null; }
  }
  async removeAsync(id: string): Promise<string | null> {
    try { await this.api.request('DELETE', `textbook/${id}/`); await this.load(); return null; } catch (err) { return this.s.errorMessage(err); }
  }

  private seed(): TextEntry[] {
    const out: TextEntry[] = [];
    const days = weekdaysBetween('2026-12-01', '2026-12-12').concat(['2026-12-05']).filter((d, i, a) => a.indexOf(d) === i).sort().filter((d) => d < this.s.today);
    const counter = new Map<string, number>();
    for (const cl of this.s.classes()) {
      for (const d of days) {
        const di = dayIndex(d);
        const subs = [...new Set(this.tt.cells().filter((c) => c.classId === cl.id && c.day === di && this.tt.isOpen(c.day, c.slot)).map((c) => c.subjectId))];
        for (const sb of subs) {
          const k = `${cl.id}|${sb}`;
          const n = counter.get(k) ?? 0;
          counter.set(k, n + 1);
          if (hash(`${k}|${d}`) % 100 >= 82) continue; // quelques séances non renseignées
          const bank = BANK[sb]?.[cl.cycle === 'college' ? 'c' : 'l'];
          const t = this.s.teacherOf(cl.id, sb);
          if (!bank || !t) continue;
          const [content, hw] = bank[(n + hash(k)) % bank.length];
          const due = hw ? this.tt.nextSession(cl.id, sb, d) ?? '' : '';
          out.push({ id: `tx-${++this.n}`, classId: cl.id, subjectId: sb, teacherId: t.id, date: d, content, homework: due ? hw : '', due: due ? due : '' });
        }
      }
    }
    return out;
  }

  /** Une séance par matière et par jour et par classe : renvoie l'entrée existante le cas échéant. */
  forClass(classId: string): TextEntry[] {
    return this.entries().filter((e) => e.classId === classId);
  }

  add(e: Omit<TextEntry, 'id'>): TextEntry {
    const entry = { ...e, id: `tx-${Date.now().toString(36)}${++this.n}` };
    this.entries.update((l) => [...l, entry]);
    this.notifyHomework(entry);
    return entry;
  }
  update(id: string, patch: Partial<TextEntry>): void {
    const before = this.entries().find((e) => e.id === id);
    if (!before) return;
    const next = { ...before, ...patch };
    this.entries.update((l) => l.map((e) => (e.id === id ? next : e)));
    if (next.homework && (next.homework !== before.homework || next.due !== before.due)) this.notifyHomework(next);
  }
  remove(id: string): void {
    this.entries.update((l) => l.filter((e) => e.id !== id));
  }

  /** Nombre de familles (parents) de la classe : un seul avis par famille. */
  parentUserIds(classId: string): string[] {
    const ids = new Set<string>();
    for (const st of this.s.studentsByClass().get(classId) ?? []) {
      const p = this.s.parentById().get(st.parentId);
      if (p) ids.add(p.userId);
    }
    return [...ids];
  }

  private notifyHomework(e: TextEntry): void {
    if (!e.homework || !e.due) return;
    const subject = this.s.subjectById().get(e.subjectId)?.name ?? '';
    const ids = this.parentUserIds(e.classId);
    this.s.notify(ids, `Nouveau travail à faire en ${subject} (${this.s.className(e.classId)}) pour le ${dateFr(e.due)}.`, 'annonce', 'cahier');
    this.lastNotified.set(ids.length);
  }
  readonly lastNotified = signal(0);

  /** Travail à faire à partir d'une date. */
  upcoming(classId: string, from: string): TextEntry[] {
    return this.forClass(classId).filter((e) => e.homework && e.due >= from).sort((a, b) => a.due.localeCompare(b.due) || a.subjectId.localeCompare(b.subjectId));
  }
  readonly nextDay = (iso: string) => addDays(iso, 1);
  readonly total = computed(() => this.entries().length);
}
