// sw.js — service worker (PWA, lot L5). Couche de CACHE hors-ligne, JAMAIS une source de vérité.
//
// À l'exécution, l'app lit toujours data.json par l'API GitHub (D8) via app/github.js ; ce SW ne
// fait qu'en garder une copie pour la consultation hors-ligne. Il ne rejoue aucune écriture : les
// mutations partent au réseau et sont refusées hors-ligne (PRD §7.2 — pas de file d'attente).
//
// Stratégies :
//   • data.json (GET api.github.com/.../contents/…) → network-first, repli sur le dernier cache.
//   • app-shell + kb/*.json + navigations (même origine) → cache-first (precache), repli réseau.
//
// La copie servie par GitHub Pages n'est JAMAIS utilisée comme source (D8) : l'app ne la fetch pas.

const VERSION = 'v1';
const SHELL = `macave-shell-${VERSION}`;
const DATA = `macave-data-${VERSION}`;

// App-shell + KB effectivement chargés à l'exécution (pas les *.seed.json, jamais fetchés).
const PRECACHE = [
  './', './index.html', './manifest.json', './assets/styles.css', './assets/icon.svg',
  './app/main.js', './app/store.js', './app/github.js', './app/ops.js', './app/kb.js',
  './app/garde.js', './app/accords.js', './app/format.js', './app/stats.js',
  './app/views/plan.js', './app/views/vins.js', './app/views/fiche.js', './app/views/a-boire.js',
  './app/views/accords.js', './app/views/reglages.js', './app/views/zones.js',
  './app/views/plus.js', './app/views/degustations.js', './app/views/stats.js',
  './kb/garde.json', './kb/cepages.json', './kb/regions.json', './kb/accords.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // les PUT (mutations) partent au réseau, jamais en cache/file.

  const url = new URL(req.url);

  // data.json, lu via l'API GitHub (D8) : network-first, repli sur le dernier instantané en cache.
  if (url.hostname === 'api.github.com' && url.pathname.includes('/contents/')) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (url.origin === self.location.origin) {
    // Une navigation hors-ligne sert la coquille : l'app se recharge depuis le cache.
    if (req.mode === 'navigate') {
      event.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
      return;
    }
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(SHELL);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}
