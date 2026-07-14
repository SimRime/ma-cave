// store.js — état en mémoire, application des opérations, abonnements.
//
// Le store ne parle jamais au réseau directement : il passe par github.pushOperation, qui
// applique l'opération (ops.js) sur l'état FRAIS du serveur et gère le 409. Le store se contente
// d'adopter l'état renvoyé et de notifier les vues.

import * as github from './github.js';
import { OpAbortError } from './ops.js';

const state = {
  data: null,
  sha: null,
  loaded: false,
  canWrite: false, // token présent → mutations proposées. Sans token : lecture seule.
  loadError: null,
};

const subscribers = new Set();
const journal = []; // 20 dernières opérations, pour l'écran Diagnostic (PRD §6.8, D11).

export function subscribe(fn) {
  subscribers.add(fn);
  fn(state);
  return () => subscribers.delete(fn);
}

function notify() {
  for (const fn of subscribers) fn(state);
}

export const getState = () => state;
export const getJournal = () => journal.slice();

export function setCanWrite(value) {
  state.canWrite = !!value;
  notify();
}

// Charge data.json depuis l'API. Ne lève jamais : range l'erreur dans state.loadError
// (l'app reste affichée — pas d'écran blanc, PRD §7.3).
export async function load() {
  try {
    const { data, sha } = await github.readData();
    state.data = data;
    state.sha = sha;
    state.loaded = true;
    state.loadError = null;
  } catch (e) {
    state.loadError = e;
    state.loaded = false;
  }
  notify();
  return state;
}

// Applique une opération. Renvoie le résultat de github.pushOperation ; relance en cas d'échec
// (l'appelant affiche le message et fait son rollback optimiste).
export async function dispatch(op) {
  const at = new Date().toISOString();
  try {
    const res = await github.pushOperation(op);
    if (!res.noop) {
      state.data = res.data;
      state.sha = res.sha;
    }
    record({
      type: op.type,
      at,
      result: res.noop ? `no-op (${res.message})` : 'ok',
      retries: res.retries ?? 0,
    });
    notify();
    return res;
  } catch (e) {
    const kind = e instanceof OpAbortError ? 'abandon' : 'échec';
    record({ type: op.type, at, result: `${kind} : ${e.message}`, retries: e.retries ?? 0 });
    notify();
    throw e;
  }
}

function record(entry) {
  journal.unshift(entry);
  if (journal.length > 20) journal.length = 20;
}
