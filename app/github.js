// github.js — LE SEUL module réseau du projet.
//
// Le jour où le dépôt passe en privé (Cloudflare Pages + lecture authentifiée), c'est le seul
// fichier qui change. Toute lecture ET toute écriture de data.json passent par ici, via l'API
// GitHub `contents` — JAMAIS par la copie servie par Pages, en retard de 20 s à plusieurs
// minutes (DECISIONS.md D8).
//
// Écriture : cycle GET → applyOp → PUT → (409 → recharge → réapplique). Les écritures sont
// SÉRIALISÉES : un seul PUT en vol. Les ids sont alloués par ops.js, jamais ici.

import { applyOp, OpAbortError } from './ops.js';

const cfg = {
  apiBase: 'https://api.github.com',
  owner: 'SimRime',
  repo: 'ma-cave',
  path: 'data.json',
  token: null,
  user: 'inconnu',
  backoffMs: 500, // matrice PRD §7.3 ; mis à 0 par les tests.
  fetchImpl: (...args) => globalThis.fetch(...args),
};

export function configure(patch = {}) {
  Object.assign(cfg, patch);
}

export function getConfig() {
  return { owner: cfg.owner, repo: cfg.repo, path: cfg.path, hasToken: !!cfg.token };
}

// Erreur réseau prête à afficher (messages de la matrice PRD §7.3).
export class GithubError extends Error {
  constructor(message, { status, code, remaining, retryAfterMin } = {}) {
    super(message);
    this.name = 'GithubError';
    this.status = status ?? null;
    this.code = code ?? 'HTTP_ERROR';
    this.remaining = remaining ?? null;
    this.retryAfterMin = retryAfterMin ?? null;
  }
}

// ---------------------------------------------------------------------------
// base64 UTF-8 — ICI, et nulle part ailleurs (DECISIONS.md D14).
// `btoa(JSON.stringify(data))` lève une exception dès « Côte Rôtie » : interdit.
// ---------------------------------------------------------------------------

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const CHUNK = 0x8000; // 32 Ko : au-delà, String.fromCharCode(...spread) sature la pile.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Requêtes bas niveau.
// ---------------------------------------------------------------------------

const contentsUrl = () => `${cfg.apiBase}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;

function authHeaders() {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}

async function toGithubError(res) {
  const remaining = res.headers?.get?.('x-ratelimit-remaining');
  if (res.status === 401) {
    return new GithubError('Votre token GitHub n’est plus valide.', { status: 401, code: 'AUTH_INVALID' });
  }
  if (res.status === 403) {
    if (remaining === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const min = Math.max(1, Math.ceil((reset - Date.now()) / 60000) || 1);
      return new GithubError(`Limite GitHub atteinte, réessayez dans ${min} min.`, {
        status: 403, code: 'RATE_LIMIT', remaining: 0, retryAfterMin: min,
      });
    }
    return new GithubError('Ce token n’a pas la permission d’écrire (Contents: Read and write).', {
      status: 403, code: 'FORBIDDEN',
    });
  }
  if (res.status === 404) {
    return new GithubError('Dépôt ou fichier introuvable.', { status: 404, code: 'NOT_FOUND' });
  }
  if (res.status === 409 || res.status === 422) {
    return new GithubError('Conflit de version.', { status: res.status, code: 'CONFLICT' });
  }
  if (res.status >= 500) {
    return new GithubError('GitHub est injoignable.', { status: res.status, code: 'UNREACHABLE' });
  }
  return new GithubError(`Erreur GitHub (${res.status}).`, { status: res.status, code: 'HTTP_ERROR' });
}

// ---------------------------------------------------------------------------
// Lecture — toujours par l'API (D8).
// ---------------------------------------------------------------------------

export async function readData() {
  let res;
  try {
    res = await cfg.fetchImpl(contentsUrl(), { method: 'GET', headers: authHeaders(), cache: 'no-store' });
  } catch {
    throw new GithubError('GitHub est injoignable.', { code: 'UNREACHABLE' });
  }
  if (!res.ok) throw await toGithubError(res);
  const body = await res.json();
  let data;
  try {
    // Le champ `content` de l'API est du base64 coupé toutes les 60 colonnes : retirer les blancs.
    data = JSON.parse(fromBase64(String(body.content).replace(/\s/g, '')));
  } catch {
    throw new GithubError('Les données de la cave sont illisibles.', { code: 'CORRUPT' });
  }
  return { data, sha: body.sha };
}

// ---------------------------------------------------------------------------
// Écriture — sérialisée, une opération rejouable, retry sur 409.
// ---------------------------------------------------------------------------

let writeChain = Promise.resolve(); // file : un seul PUT en vol à la fois.

export function pushOperation(op) {
  const run = () => attemptPush(op);
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {}); // la file survit à un échec.
  return p;
}

async function attemptPush(op) {
  if (!cfg.token) {
    throw new GithubError('Ajoutez votre token GitHub dans Réglages pour modifier la cave.', {
      code: 'READ_ONLY',
    });
  }
  let { data, sha } = await readData();
  let retries = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    // applyOp est PUR : il peut lever OpAbortError (abandon) ou signaler un no-op idempotent.
    const result = applyOp(data, op); // OpAbortError remonte → rollback UI.
    if (result.noop) {
      return { data, sha, ids: result.ids, noop: true, message: result.message, retries };
    }

    const next = withMeta(result.data);
    const content = toBase64(JSON.stringify(next, null, 2) + '\n');

    let res;
    try {
      res = await cfg.fetchImpl(contentsUrl(), {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage(op, result.ids), content, sha }),
      });
    } catch {
      throw new GithubError('GitHub est injoignable.', { code: 'UNREACHABLE' });
    }

    if (res.ok) {
      const body = await res.json();
      return { data: next, sha: body.content.sha, ids: result.ids, retries };
    }

    // Conflit de sha : recharger, RÉAPPLIQUER l'opération sur l'état frais, réessayer.
    if ((res.status === 409 || res.status === 422) && attempt < 2) {
      retries++;
      await sleep(cfg.backoffMs * (attempt + 1));
      ({ data, sha } = await readData());
      continue;
    }
    throw await toGithubError(res);
  }
  throw new GithubError('Conflit persistant après 3 tentatives.', { code: 'CONFLICT' });
}

function withMeta(data) {
  data.updatedAt = new Date().toISOString();
  data.updatedBy = String(cfg.user || 'inconnu').slice(0, 60);
  return data;
}

const COMMIT_VERBS = {
  ADD_WINE: (ids) => `ajoute le vin ${ids.wineId}`,
  ADD_BOTTLES: (ids) => `ajoute ${ids.bottleIds?.length ?? 0} bouteille(s)`,
  ADD_TASTING: (ids) => `enregistre la dégustation ${ids.tastingId}`,
  DRINK_BOTTLE: (_ids, p) => `boit la bouteille ${p.bottleId}`,
  PLACE_BOTTLE: (_ids, p) => `range la bouteille ${p.bottleId}`,
  MOVE_BOTTLE: (_ids, p) => `déplace la bouteille ${p.bottleId}`,
  UPDATE_WINE: (_ids, p) => `modifie le vin ${p.id}`,
  UPDATE_BOTTLE: (_ids, p) => `modifie la bouteille ${p.id}`,
  UPDATE_TASTING: (_ids, p) => `modifie la dégustation ${p.id}`,
  DELETE_WINE: (_ids, p) => `supprime le vin ${p.id}`,
  UPSERT_ZONE: (ids) => `met à jour la zone ${ids.zoneId}`,
  DELETE_ZONE: (_ids, p) => `supprime la zone ${p.id}`,
};

function commitMessage(op, ids) {
  const verb = COMMIT_VERBS[op.type];
  const text = verb ? verb(ids ?? {}, op.payload ?? {}) : `applique ${op.type}`;
  return `${text} (via l'app)`;
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// ---------------------------------------------------------------------------
// Test de connexion (Réglages) — vérifie le token et le droit d'écriture.
// ---------------------------------------------------------------------------

export async function testConnection() {
  if (!cfg.token) {
    return { ok: false, canWrite: false, message: 'Aucun token : la cave est en lecture seule.' };
  }
  let res;
  try {
    res = await cfg.fetchImpl(`${cfg.apiBase}/repos/${cfg.owner}/${cfg.repo}`, {
      method: 'GET', headers: authHeaders(), cache: 'no-store',
    });
  } catch {
    return { ok: false, canWrite: false, message: 'GitHub est injoignable.' };
  }
  if (res.status === 401) return { ok: false, canWrite: false, message: 'Token invalide ou expiré.' };
  if (res.status === 404) return { ok: false, canWrite: false, message: 'Dépôt introuvable, ou token sans accès à ce dépôt.' };
  if (!res.ok) return { ok: false, canWrite: false, message: `Erreur GitHub (${res.status}).` };
  const repo = await res.json();
  const canWrite = !!repo?.permissions?.push;
  return {
    ok: true,
    canWrite,
    message: canWrite
      ? 'Connecté — écriture autorisée.'
      : 'Connecté, mais ce token ne peut pas écrire (il faut « Contents: Read and write »).',
  };
}

export { OpAbortError };
