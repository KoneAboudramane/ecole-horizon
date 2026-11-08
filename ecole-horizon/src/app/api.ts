import { Injectable, signal } from '@angular/core';

/** Erreur renvoyée par le serveur : `message` est lisible tel quel par l'utilisateur. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors?: Record<string, unknown>) {
    super(message);
  }
}

/** Adresse du serveur : `?api=http://127.0.0.1:8000` dans l'URL (mémorisée pour la session), ou `window.ECOLE_API`. Vide = prototype simulé. */
function initialBase(): string {
  const g = globalThis as unknown as { ECOLE_API?: string; location?: Location; sessionStorage?: Storage };
  let v = g.ECOLE_API ?? '';
  if (v) return v.replace(/\/+$/, ''); // adresse imposée par config.js (production) : non modifiable par ?api=
  try {
    const q = new URLSearchParams(g.location?.search ?? '').get('api');
    if (q !== null) {
      if (q) g.sessionStorage?.setItem('ecole.api', q);
      else g.sessionStorage?.removeItem('ecole.api');
      v = q;
    } else v = g.sessionStorage?.getItem('ecole.api') ?? v;
  } catch { /* stockage indisponible : on garde la valeur trouvée */ }
  return v.replace(/\/+$/, '');
}

interface Page<T> { results: T[]; next: string | null; }

@Injectable({ providedIn: 'root' })
export class Api {
  readonly base = signal(initialBase());
  /** Jeton d'accès gardé en mémoire seulement. Le jeton de renouvellement est gardé le temps de l'onglet (recharger la page ne déconnecte pas ; fermer l'onglet, si). */
  private access = '';
  private refreshToken = '';
  private refreshing: Promise<boolean> | null = null;

  private static readonly KEY = 'ecole.rt';
  private keep(): void {
    try {
      const s = (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage;
      if (this.refreshToken) s?.setItem(Api.KEY, this.refreshToken); else s?.removeItem(Api.KEY);
    } catch { /* stockage indisponible : la session reste valable tant que la page n'est pas rechargée */ }
  }
  /** Y a-t-il une session à reprendre après un rechargement de la page ? */
  get resumable(): boolean {
    try { return !!(globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.getItem(Api.KEY); } catch { return false; }
  }
  /** Reprend la session de l'onglet (après un rechargement) : renouvelle l'accès avec le jeton gardé. */
  async resume(): Promise<boolean> {
    try { this.refreshToken = (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.getItem(Api.KEY) ?? ''; } catch { this.refreshToken = ''; }
    if (!this.refreshToken) return false;
    return this.refreshAccess();
  }

  /** Cursus choisi (école à plusieurs cursus : français, arabe…) : envoyé avec chaque requête, gardé le temps de l'onglet. */
  private static readonly CURSUS = 'ecole.cursus';
  cursus = '';
  setCursus(id: string): void {
    this.cursus = id;
    try { (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.setItem(Api.CURSUS, id); } catch { /* stockage indisponible */ }
  }
  savedCursus(): string {
    try { return (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.getItem(Api.CURSUS) ?? ''; } catch { return ''; }
  }
  private auth(headers: Record<string, string>): Record<string, string> {
    if (this.access) headers['Authorization'] = `Bearer ${this.access}`;
    if (this.cursus) headers['X-Cursus'] = this.cursus;
    return headers;
  }

  get enabled(): boolean { return !!this.base(); }
  get hasSession(): boolean { return !!this.access; }

  private url(path: string): string {
    return path.startsWith('http') ? path : `${this.base()}/api/v1/${path.replace(/^\/+/, '')}`;
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    this.auth(headers);
    let res: Response;
    try {
      res = await fetch(this.url(path), { method, headers, body: payload });
    } catch {
      throw new ApiError('Serveur injoignable. Vérifiez votre connexion ou réessayez dans un instant.', 0);
    }
    if (res.status === 401 && retry && this.refreshToken && !path.startsWith('auth/')) {
      if (await this.refreshAccess()) return this.request<T>(method, path, body, false);
    }
    if (res.status === 204) return undefined as T;
    let data: unknown = null;
    try { data = await res.json(); } catch { /* corps vide ou non JSON */ }
    if (!res.ok) {
      const d = (data ?? {}) as { detail?: string; errors?: Record<string, unknown> };
      throw new ApiError(d.detail ?? 'Une erreur est survenue. Réessayez.', res.status, d.errors);
    }
    return data as T;
  }

  /** Télécharge un fichier binaire (PDF…) avec le jeton de session. */
  async blob(path: string, retry = true): Promise<Blob> {
    const headers = this.auth({});
    let res: Response;
    try { res = await fetch(this.url(path), { headers }); } catch { throw new ApiError('Serveur injoignable. Vérifiez votre connexion ou réessayez dans un instant.', 0); }
    if (res.status === 401 && retry && this.refreshToken && (await this.refreshAccess())) return this.blob(path, false);
    if (!res.ok) {
      let detail = 'Le fichier n’a pas pu être généré.';
      try { detail = ((await res.json()) as { detail?: string }).detail ?? detail; } catch { /* corps non JSON */ }
      throw new ApiError(detail, res.status);
    }
    return res.blob();
  }

  /** Renouvelle le jeton d'accès ; une seule demande à la fois même si plusieurs requêtes expirent ensemble. */
  private refreshAccess(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const r = await fetch(this.url('auth/refresh/'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: this.refreshToken }) });
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { access: string; refresh?: string };
        this.access = d.access;
        if (d.refresh) this.refreshToken = d.refresh;
        this.keep();
        return true;
      } catch {
        this.access = this.refreshToken = '';
        this.keep();
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  get<T>(path: string): Promise<T> { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>('POST', path, body); }
  put<T>(path: string, body?: unknown): Promise<T> { return this.request<T>('PUT', path, body); }
  patch<T>(path: string, body?: unknown): Promise<T> { return this.request<T>('PATCH', path, body); }
  delete<T>(path: string): Promise<T> { return this.request<T>('DELETE', path); }

  /** Toutes les pages d'une liste paginée. */
  async all<T>(path: string): Promise<T[]> {
    const first = await this.get<Page<T> | T[]>(path);
    if (Array.isArray(first)) return first;
    const out = [...first.results];
    let next = first.next;
    while (next) {
      const p = await this.request<Page<T>>('GET', next);
      out.push(...p.results);
      next = p.next;
    }
    return out;
  }

  async login<U>(username: string, password: string, ecole = '', extra: Record<string, string> = {}): Promise<U> {
    const d = await this.request<{ access: string; refresh: string; user: U }>('POST', 'auth/login/', { ...(ecole ? { ecole } : {}), username, password, ...extra });
    this.access = d.access;
    this.refreshToken = d.refresh;
    this.keep();
    return d.user;
  }

  async logout(): Promise<void> {
    const refresh = this.refreshToken;
    try { if (refresh && this.access) await this.request('POST', 'auth/logout/', { refresh }, false); } catch { /* la session locale est fermée dans tous les cas */ }
    this.access = this.refreshToken = '';
    this.keep();
    this.setCursus('');   // le compte suivant repart du premier cursus
  }
}
