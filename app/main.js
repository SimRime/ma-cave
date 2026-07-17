// main.js — bootstrap + routeur par hash. Câble le store, la config réseau et les vues.
// Ne contient aucune logique métier ni aucun accès réseau : il orchestre.

import * as store from './store.js';
import * as github from './github.js';
import { loadKb } from './kb.js';
import { renderPlan } from './views/plan.js';
import { renderVins } from './views/vins.js';
import { renderFiche } from './views/fiche.js';
import { renderABoire } from './views/a-boire.js';
import { renderAccords } from './views/accords.js';
import { renderReglages } from './views/reglages.js';
import { renderPlus } from './views/plus.js';
import { renderDegustations } from './views/degustations.js';
import { renderStats } from './views/stats.js';

const LS = { token: 'macave.token', user: 'macave.user' };

// Onglets visibles (dans l'ordre). « Plus » regroupe Dégustations, Stats, Réglages (PRD §6).
// La fiche n'est pas un onglet : on l'atteint depuis Vins/Plan.
const TABS = [
  { route: '/plan', label: 'Plan' },
  { route: '/vins', label: 'Vins' },
  { route: '/a-boire', label: 'À boire' },
  { route: '/accords', label: 'Accords' },
  { route: '/plus', label: 'Plus' },
];

// Vues, indexées par leur segment de base. `/fiche/<id>` reçoit l'id en paramètre.
const VIEWS = {
  '/plan': renderPlan,
  '/vins': renderVins,
  '/a-boire': renderABoire,
  '/accords': renderAccords,
  '/plus': renderPlus,
  '/degustations': renderDegustations,
  '/stats': renderStats,
  '/reglages': renderReglages,
  '/fiche': renderFiche,
};

// Écrans sans onglet propre : on éclaire leur onglet parent. Fiche → Vins ; les écrans
// regroupés sous « Plus » → Plus.
const TAB_FOR_BASE = {
  '/fiche': '/vins',
  '/degustations': '/plus',
  '/stats': '/plus',
  '/reglages': '/plus',
};

// --- Réglages persistés (token, nom) : localStorage, jamais les données (CLAUDE.md) ----------

function readSettings() {
  return {
    token: localStorage.getItem(LS.token) || '',
    user: localStorage.getItem(LS.user) || '',
  };
}

function saveSettings({ token, user }) {
  if (token !== undefined) localStorage.setItem(LS.token, token);
  if (user !== undefined) localStorage.setItem(LS.user, user);
  applySettings();
}

function applySettings() {
  const { token, user } = readSettings();
  github.configure({ token: token || null, user: user || 'inconnu' });
  store.setCanWrite(!!token); // sans token : lecture seule (pas une erreur).
}

// --- Petit helper DOM. `text` = textContent (champs libres sûrs) ; pas d'innerHTML libre. ----

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

// --- Routage -------------------------------------------------------------------------------

// Parse le hash en { base, param } : « #/fiche/w_3 » → { base: '/fiche', param: 'w_3' }.
function currentRoute() {
  const raw = location.hash.replace(/^#/, '') || '/plan';
  const [seg, param = null] = raw.replace(/^\//, '').split('/');
  const base = `/${seg}`;
  return VIEWS[base] ? { base, param } : { base: '/plan', param: null };
}

const navigate = (route) => { location.hash = route; };

const ctx = {
  store,
  github,
  el,
  clear,
  navigate,
  kb: null, // résolution du KB (appellations, cépages, plats) — chargée au boot, cf. loadKb().
  settings: { read: readSettings, save: saveSettings },
  onChange: () => render(),
};

function renderTabs() {
  const nav = document.getElementById('tabs');
  clear(nav);
  const { base } = currentRoute();
  const active = TAB_FOR_BASE[base] ?? base;
  for (const { route, label } of TABS) {
    nav.append(
      el('a', { href: `#${route}`, class: route === active ? 'tab tab--active' : 'tab', text: label }),
    );
  }
}

function renderBanner() {
  const banner = document.getElementById('banner');
  clear(banner);
  const s = store.getState();

  if (s.loadError) {
    banner.className = 'banner banner--error';
    banner.append(
      el('span', { text: s.loadError.message || 'Erreur de chargement.' }),
      el('button', { class: 'btn', onclick: () => store.load().then(render), text: 'Réessayer' }),
    );
    return;
  }

  // Hors-ligne : la cave reste consultable (service worker), mais aucune mutation n'est possible
  // — pas de file d'attente offline (PRD §7.2). Le message prime sur « lecture seule ».
  if (!navigator.onLine) {
    banner.className = 'banner banner--info';
    banner.append(el('span', { text: 'Hors ligne. La cave reste consultable ; les modifications sont indisponibles.' }));
    return;
  }

  if (!s.canWrite) {
    banner.className = 'banner banner--info';
    banner.append(
      el('span', { text: 'Lecture seule. ' }),
      el('a', { href: '#/reglages', text: 'Ajoutez votre token GitHub dans Réglages pour modifier la cave.' }),
    );
    return;
  }

  banner.className = 'banner banner--hidden';
}

function render() {
  renderTabs();
  renderBanner();
  const view = document.getElementById('view');
  clear(view);
  const { base, param } = currentRoute();
  VIEWS[base](view, ctx, param);
}

// --- Démarrage -----------------------------------------------------------------------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Servi à la racine de l'app (scope « ./ ») : chemin résolu relativement au document.
  // Best-effort — sans SW, l'app fonctionne normalement, sans cache hors-ligne.
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function boot() {
  applySettings();
  window.addEventListener('hashchange', render);
  window.addEventListener('online', renderBanner); // reflète l'état réseau sans recharger la vue
  window.addEventListener('offline', renderBanner);
  render(); // coquille immédiate (état « chargement… »)
  store.load().then(render); // puis les données, par l'API GitHub
  loadKb().then((kb) => { ctx.kb = kb; render(); }); // puis le KB (garde, accords, résolution)
  registerServiceWorker(); // PWA (lot L5) : cache hors-ligne + statut « actif » dans Diagnostic
}

boot();
