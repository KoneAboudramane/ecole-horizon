import { Injectable, effect, inject, signal } from '@angular/core';
import { Store } from '../store';
import { Api } from '../api';
import { ApiRecipient, ApiThread, ApiThreadFull, mapRecipient, mapThread } from '../api-map';
import { Role, User } from '../models';

export interface Msg { id: string; fromId: string; text: string; ts: string; }
export interface Thread {
  id: string;
  subject: string;
  creatorId: string;
  participantIds: string[];
  messages: Msg[];
  /** Nombre de messages déjà vus par chaque participant. */
  read: Record<string, number>;
  /** Mode serveur : noms des participants et nombre de messages non lus fournis par le serveur. */
  names?: Record<string, string>;
  unread?: number;
}
export interface Candidate {
  userId: string;
  name: string;
  sub: string;
  group: 'Direction' | 'Vie scolaire' | 'Enseignants' | 'Personnel' | 'Parents';
  classIds: string[];
  isParent: boolean;
}

const STAFF_ROLES: Role[] = ['fondateur', 'directeur', 'admin', 'educateur', 'comptable', 'informatique', 'enseignant'];
const GROUP_ORDER: Candidate['group'][] = ['Direction', 'Vie scolaire', 'Enseignants', 'Personnel', 'Parents'];

@Injectable({ providedIn: 'root' })
export class Messaging {
  private readonly s = inject(Store);
  private n = 0;
  readonly threads = signal<Thread[]>(this.seed());
  readonly groupOrder = GROUP_ORDER;
  private readonly api = inject(Api);
  private readonly apiCandidates = signal<Candidate[]>([]);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // Mode serveur : les conversations viennent du serveur, rafraîchies chaque minute
    effect(() => {
      const me = this.s.me();
      clearInterval(this.timer);
      if (!this.s.apiMode()) return;
      if (!me) { this.threads.set([]); this.apiCandidates.set([]); return; }
      void this.load();
      this.timer = setInterval(() => void this.load(), 60000);
    });
  }

  /** Charge mes conversations (liste puis détail), mode serveur uniquement. */
  async load(): Promise<void> {
    const me = this.s.userId();
    if (!this.s.apiMode() || !me) return;
    try {
      const list = await this.api.get<ApiThread[]>('messages/threads/');
      const full = await Promise.all(list.slice(0, 60).map((t) => this.api.get<ApiThreadFull>(`messages/threads/${t.id}/`)));
      if (this.s.userId() === me) this.threads.set(full.map((t) => mapThread(t, me)));
    } catch { /* hors ligne : on garde l'état précédent */ }
  }
  async loadRecipients(): Promise<void> {
    if (!this.s.apiMode()) return;
    try { this.apiCandidates.set((await this.api.get<ApiRecipient[]>('messages/recipients/')).map(mapRecipient)); } catch { this.apiCandidates.set([]); }
  }
  async sendAsync(recipientIds: string[], subject: string, text: string): Promise<{ count: number; firstId: string | null; error?: string }> {
    try {
      const r = await this.api.post<{ threads: number[] }>('messages/threads/', { recipients: recipientIds.map(Number), subject, text });
      await this.load();
      return { count: r.threads.length, firstId: r.threads[0] ? String(r.threads[0]) : null };
    } catch (e) { return { count: 0, firstId: null, error: this.s.errorMessage(e) }; }
  }
  async replyAsync(threadId: string, text: string): Promise<boolean> {
    try { await this.api.post(`messages/threads/${threadId}/reply/`, { text }); await this.load(); return true; }
    catch (e) { this.s.toast(this.s.errorMessage(e), 'err'); return false; }
  }
  nameOf(t: Thread, id: string): string { return t.names?.[id] ?? this.s.userName(id); }

  private seed(): Thread[] {
    const s = this.s;
    const out: Thread[] = [];
    const has = (...ids: string[]) => ids.every((i) => s.userById().has(i));
    const mk = (subject: string, creator: string, parts: string[], msgs: [string, string, string][], read: Record<string, number>): void => {
      if (!has(creator, ...parts)) return;
      out.push({
        id: `th-${++this.n}`, subject, creatorId: creator, participantIds: [...new Set([creator, ...parts])],
        messages: msgs.map(([from, ts, text], i) => ({ id: `m-${this.n}-${i}`, fromId: from, ts, text })), read,
      });
    };
    const jl = s.studentById().get('s-jeanluc'); const ma = s.studentById().get('s-marie');
    const tm = s.teacherOf('c6b', 'ma')?.userId ?? 'u-t-ma1';
    mk(`Difficultés en mathématiques de ${jl?.prenoms ?? 'Jean-Luc'}`, 'u-p-brou', [tm], [
      ['u-p-brou', '2026-12-08T18:42', 'Bonjour Madame, Jean-Luc dit avoir du mal à suivre les équations en classe. Pourriez-vous nous indiquer comment l’aider à la maison ? Merci d’avance.'],
      [tm, '2026-12-09T07:55', 'Bonjour Monsieur Brou. Jean-Luc est sérieux mais manque de pratique. Je vous conseille 20 minutes d’exercices chaque soir, je lui donnerai une fiche dès demain.'],
      ['u-p-brou', '2026-12-09T19:10', 'Merci beaucoup, nous allons suivre vos conseils.'],
      [tm, '2026-12-11T14:20', 'Bonne nouvelle : Jean-Luc a bien réussi l’exercice de ce matin. Je propose aussi une séance de soutien le mercredi à 11h45, si vous êtes d’accord.'],
    ], { 'u-p-brou': 3, [tm]: 3 });
    mk(`Retard de ${ma?.prenoms ?? 'Marie-Ange'} le 11 décembre`, 'u-educ', ['u-p-brou'], [
      ['u-educ', '2026-12-11T08:20', `Bonjour, ${ma?.prenoms ?? 'Marie-Ange'} est arrivée à 8h15 ce matin. Merci de veiller à la ponctualité. Un justificatif peut être déposé auprès de la vie scolaire.`],
    ], { 'u-educ': 1 });
    const staffTeachers = s.teachers().map((t) => t.userId);
    const fr = s.teachers().find((t) => t.id === 't-fr1')?.userId ?? staffTeachers[0];
    mk('Conseil de classe du 1er trimestre', 'u-admin', ['u-educ', 'u-secr', ...staffTeachers], [
      ['u-admin', '2026-12-10T08:30', 'Chers collègues, les conseils de classe du 1er trimestre auront lieu du 16 au 18 décembre. Merci de saisir toutes vos notes et appréciations avant lundi prochain.'],
      [fr, '2026-12-10T12:15', 'Bien reçu. Mes notes sont complètes pour toutes mes classes, j’ajoute les appréciations ce week-end.'],
    ], { 'u-admin': 2, [fr]: 2, [tm]: 1 });
    const c3b = s.studentsByClass().get('c3b')?.[0];
    const p3b = c3b ? s.parentById().get(c3b.parentId) : undefined;
    if (c3b && p3b) {
      mk('Cahier de français à régulariser', fr, [p3b.userId], [
        [fr, '2026-12-10T16:05', `Bonjour, le cahier de français de ${c3b.prenoms} n’est pas à jour depuis deux semaines. Merci de vérifier avec lui. Cordialement.`],
      ], { [fr]: 1 });
    }
    const c3a = s.studentsByClass().get('c3a')?.find((x) => x.id !== 's-marie');
    const p3a = c3a ? s.parentById().get(c3a.parentId) : undefined;
    if (c3a && p3a) {
      mk('Demande de rendez-vous', p3a.userId, ['u-admin'], [
        [p3a.userId, '2026-12-11T17:05', `Bonjour Madame la Directrice, je souhaiterais vous rencontrer au sujet de l’orientation de ${c3a.prenoms} après le BEPC. Quels sont vos créneaux disponibles ?`],
      ], { [p3a.userId]: 1 });
    }
    return out;
  }

  unreadCount(t: Thread, uid: string): number {
    if (t.unread !== undefined) return t.unread;
    return t.messages.slice(t.read[uid] ?? 0).filter((m) => m.fromId !== uid).length;
  }
  lastTs(t: Thread): string {
    return t.messages[t.messages.length - 1]?.ts ?? '';
  }
  threadsOf(uid: string): Thread[] {
    return this.threads().filter((t) => t.participantIds.includes(uid)).sort((a, b) => this.lastTs(b).localeCompare(this.lastTs(a)));
  }
  totalUnread(uid: string): number {
    return this.threadsOf(uid).filter((t) => this.unreadCount(t, uid) > 0).length;
  }

  markRead(threadId: string, uid: string): void {
    if (this.s.apiMode()) {
      this.threads.update((l) => l.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)));
      void this.api.post(`messages/threads/${threadId}/read/`).catch(() => undefined);
      return;
    }
    this.threads.update((l) => l.map((t) => (t.id === threadId && (t.read[uid] ?? 0) < t.messages.length ? { ...t, read: { ...t.read, [uid]: t.messages.length } } : t)));
  }

  /** Les élèves ne peuvent pas écrire. */
  canSend(role: Role | null): boolean {
    return !!role && role !== 'eleve';
  }

  /** Destinataires autorisés pour l'utilisateur donné. */
  recipientOptions(me: User | null): Candidate[] {
    const s = this.s;
    if (!me || !this.canSend(me.role)) return [];
    if (s.apiMode()) return this.apiCandidates();
    const out: Candidate[] = [];
    const active = (u: User) => u.active && u.id !== me.id;
    const addRole = (role: Role, group: Candidate['group'], sub: string) => {
      for (const u of s.users().filter((x) => x.role === role && active(x))) out.push({ userId: u.id, name: u.name, sub, group, classIds: [], isParent: false });
    };
    const parentsOf = (classIds: Set<string>) => {
      const map = new Map<string, Candidate>();
      for (const st of s.students()) {
        if (!classIds.has(st.classId)) continue;
        const p = s.parentById().get(st.parentId);
        const u = p ? s.userById().get(p.userId) : undefined;
        if (!p || !u || !u.active) continue;
        const kid = `${st.prenoms} (${s.className(st.classId)})`;
        const ex = map.get(p.userId);
        if (ex) { ex.sub = `${ex.sub}, ${kid}`; ex.classIds.push(st.classId); }
        else map.set(p.userId, { userId: p.userId, name: p.name, sub: `Parent de ${kid}`, group: 'Parents', classIds: [st.classId], isParent: true });
      }
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    };

    if (me.role === 'parent') {
      const kids = s.myChildren();
      const classes = new Set(kids.map((k) => k.classId));
      const byTeacher = new Map<string, string[]>();
      for (const a of s.assignments()) {
        if (!classes.has(a.classId)) continue;
        (byTeacher.get(a.teacherId) ?? byTeacher.set(a.teacherId, []).get(a.teacherId)!).push(`${s.subjectById().get(a.subjectId)?.short} · ${s.className(a.classId)}`);
      }
      for (const [tid, subs] of byTeacher) {
        const t = s.teacherById().get(tid);
        const u = t ? s.userById().get(t.userId) : undefined;
        if (t && u?.active) out.push({ userId: t.userId, name: t.name, sub: subs.join(', '), group: 'Enseignants', classIds: [], isParent: false });
      }
      addRole('directeur', 'Direction', 'Directeur');
      addRole('educateur', 'Vie scolaire', 'Éducateur');
      const order = (c: Candidate) => GROUP_ORDER.indexOf(c.group);
      return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
    }

    // Personnel : tout le personnel, et les parents des classes suivies
    for (const role of STAFF_ROLES) {
      const label: Record<string, string> = { fondateur: 'Fondateur', directeur: 'Directeur', admin: 'Secrétariat', educateur: 'Éducateur', comptable: 'Comptable', informatique: 'Informatique', enseignant: 'Enseignant' };
      for (const u of s.users().filter((x) => x.role === role && active(x))) {
        out.push({ userId: u.id, name: u.name, sub: label[role], group: role === 'directeur' ? 'Direction' : role === 'educateur' ? 'Vie scolaire' : 'Personnel', classIds: [], isParent: false });
      }
    }
    const classes = me.role === 'enseignant' ? new Set(s.myClassIds()) : new Set(s.classes().map((c) => c.id));
    out.push(...parentsOf(classes));
    const order = (c: Candidate) => GROUP_ORDER.indexOf(c.group);
    return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  }

  private nowTs(): string {
    const d = new Date();
    return `${this.s.today}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Envoie un message. Si un destinataire est un parent, chacun reçoit sa propre conversation
   * (les familles ne voient pas les autres destinataires). Renvoie le nombre de conversations créées.
   */
  send(from: User, recipientIds: string[], subject: string, text: string): { count: number; firstId: string | null } {
    const allowed = new Map(this.recipientOptions(from).map((c) => [c.userId, c]));
    const targets = [...new Set(recipientIds)].filter((id) => allowed.has(id));
    if (!targets.length || !this.canSend(from.role)) return { count: 0, firstId: null };
    const groups = targets.some((id) => allowed.get(id)!.isParent) ? targets.map((id) => [id]) : [targets];
    const created: Thread[] = groups.map((g) => ({
      id: `th-${Date.now().toString(36)}${++this.n}`, subject, creatorId: from.id, participantIds: [from.id, ...g],
      messages: [{ id: `m-${Date.now().toString(36)}${++this.n}`, fromId: from.id, text, ts: this.nowTs() }], read: { [from.id]: 1 },
    }));
    this.threads.update((l) => [...l, ...created]);
    for (const t of created) this.s.notify(t.participantIds.filter((x) => x !== from.id), `Nouveau message de ${from.name} : ${subject}`, 'annonce', 'messages');
    this.s.addLog('Messagerie', `Message envoyé à ${targets.length} destinataire(s) : ${subject}`);
    return { count: created.length, firstId: created[0].id };
  }

  reply(threadId: string, from: User, text: string): boolean {
    const t = this.threads().find((x) => x.id === threadId);
    if (!t || !t.participantIds.includes(from.id) || !this.canSend(from.role)) return false;
    const msg: Msg = { id: `m-${Date.now().toString(36)}${++this.n}`, fromId: from.id, text, ts: this.nowTs() };
    this.threads.update((l) => l.map((x) => (x.id === threadId ? { ...x, messages: [...x.messages, msg], read: { ...x.read, [from.id]: x.messages.length + 1 } } : x)));
    this.s.notify(t.participantIds.filter((x) => x !== from.id), `${from.name} a répondu : ${t.subject}`, 'annonce', 'messages');
    return true;
  }
}
