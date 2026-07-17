// views/stats.js — écran Stats (PRD §6.7). Route #/stats.
//
// Deux agrégats monétaires DISTINCTS, affichés séparément (PRD §4.2, raison d'être du projet) :
//   « Montant dépensé » (Σ prix payés) ≠ « Valeur de la cave » (Σ valeurs, cadeaux inclus).
// Quatre graphiques en SVG, SANS bibliothèque, PAS de camembert (illisible à 380 px) :
//   1. bouteilles par région → barres horizontales
//   2. par millésime → histogramme
//   3. consommation sur 24 mois → barres
//   4. répartition par couleur → barres empilées
// Les agrégats viennent d'app/stats.js (module pur, partagé avec les tests et — plus tard — les
// skills). L'année d'apogée réutilise le moteur de garde via stats.parApogee (jamais réimplémenté).

import { normalise } from '../format.js';
import {
  montantDepense, valeurCave, parRegion, parCouleur, parMillesime,
  parApogee, consommationParMois, provenance,
} from '../stats.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Petit helper SVG — le helper `el` de main.js crée des éléments HTML, pas SVG. `text` = textNode
// (sûr : les libellés libres, région/producteur, ne sont jamais interprétés comme du balisage).
function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const fmtCHF = (n) => `${new Intl.NumberFormat('fr-CH').format(Math.round(n))} CHF`;
const moisLabel = (mois) => `${mois.slice(5, 7)}.${mois.slice(2, 4)}`; // « 2026-07 » → « 07.26 »

export function renderStats(container, ctx) {
  const { el, store } = ctx;
  const s0 = store.getState();
  const kb = ctx.kb;

  container.append(el('h1', { text: 'Stats' }));

  if (!s0.loaded) {
    container.append(el('p', { class: 'muted', text: s0.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }
  const data = s0.data;
  const nBouteilles = data.bottles.length;

  if (!nBouteilles) {
    container.append(el('p', { class: 'muted', text: 'Aucune bouteille en cave : rien à compter pour l’instant.' }));
    return;
  }

  // — Les deux chiffres, séparés et jamais confondus ————————————————————————————
  container.append(el('section', { class: 'card' },
    el('h2', { text: 'La cave en chiffres' }),
    el('div', { class: 'stat-tiles' },
      tile(el, 'Montant dépensé', fmtCHF(montantDepense(data)), 'Somme des prix réellement payés. Les cadeaux et héritages ne comptent pas.'),
      tile(el, 'Valeur de la cave', fmtCHF(valeurCave(data)), 'Somme des valeurs estimées des bouteilles en stock, cadeaux compris.'),
    ),
    el('p', { class: 'help', text: `${nBouteilles} bouteille${nBouteilles > 1 ? 's' : ''} en stock · ${data.wines.filter((w) => data.bottles.some((b) => b.wineId === w.id)).length} vin(s) présent(s).` }),
  ));

  // — Provenance ————————————————————————————————————————————————————————————————
  container.append(renderProvenance(ctx, data));

  // — 4 graphiques ——————————————————————————————————————————————————————————————
  container.append(chartCard(ctx, 'Bouteilles par région', null,
    barresH(parRegion(data)), false));

  container.append(chartCard(ctx, 'Bouteilles par millésime', 'Sans millésime exclus de l’axe.',
    barresV(parMillesime(data).filter((x) => x.cle !== 'Sans millésime'), { labelDe: (it) => it.cle }), true));

  container.append(chartCard(ctx, 'Consommation sur 24 mois', 'Une dégustation enregistrée = une bouteille bue (invariant 1 : boire supprime la bouteille).',
    barresV(consommationParMois(data, 24), { labelDe: (it) => moisLabel(it.mois), labelEvery: 3 }), true));

  container.append(chartCouleurs(ctx, parCouleur(data)));

  // — Année d'apogée (réutilise le moteur de garde) —————————————————————————————
  const apogeeCard = el('section', { class: 'card' }, el('h2', { text: 'Par année d’apogée' }));
  if (!kb) {
    apogeeCard.append(el('p', { class: 'muted', text: 'Base de connaissances en cours de chargement…' }));
  } else {
    const ap = parApogee(data, kb);
    apogeeCard.append(el('div', { class: 'apogee-list' },
      ...ap.map((x) => el('span', { class: 'tag', text: `${x.cle} · ${x.n}` }))));
  }
  container.append(apogeeCard);

  // Les graphiques défilants (24 mois) sont plus utiles cadrés sur le présent : on les amène à
  // droite (mois récents) après la mise en page.
  requestAnimationFrame(() => {
    container.querySelectorAll('.chart--scroll').forEach((c) => { c.scrollLeft = c.scrollWidth; });
  });
}

// — Tuiles chiffres —————————————————————————————————————————————————————————————
function tile(el, label, valeur, aide) {
  return el('div', { class: 'stat-tile' },
    el('span', { class: 'stat-tile__label', text: label }),
    el('strong', { class: 'stat-tile__value', text: valeur }),
    el('span', { class: 'stat-tile__help', text: aide }));
}

// — Provenance ——————————————————————————————————————————————————————————————————
const TYPE_LABEL = { achat: 'Achat', cadeau: 'Cadeau', heritage: 'Héritage', echange: 'Échange', production: 'Production' };

function renderProvenance(ctx, data) {
  const { el } = ctx;
  const p = provenance(data);
  const card = el('section', { class: 'card' },
    el('h2', { text: 'Provenance' }),
    el('div', { class: 'filters' },
      ...p.parType.map((t) => el('span', { class: 'tag', text: `${TYPE_LABEL[t.cle] ?? t.cle} · ${t.n}` }))));

  if (p.cadeaux.length) {
    card.append(el('h3', { text: 'Offert par' }),
      el('ul', { class: 'prov-list' }, ...p.cadeaux.map((c) => el('li', { text: `${c.cle} — ${c.n} bouteille${c.n > 1 ? 's' : ''}` }))));
  }
  if (p.heritages.length) {
    card.append(el('h3', { text: 'Ce qui reste de' }),
      el('ul', { class: 'prov-list' }, ...p.heritages.map((h) => el('li', { text: `${h.cle} — ${h.n} bouteille${h.n > 1 ? 's' : ''}` }))));
  }
  return card;
}

// — Ossature d'un graphique ————————————————————————————————————————————————————
function chartCard(ctx, titre, aide, svgNode, scroll) {
  const { el } = ctx;
  return el('section', { class: 'card' },
    el('h2', { text: titre }),
    aide ? el('p', { class: 'help', text: aide }) : null,
    el('div', { class: scroll ? 'chart chart--scroll' : 'chart' }, svgNode));
}

// — Barres horizontales (libellé au-dessus de chaque barre : jamais tronqué) ——————
function barresH(items) {
  const W = 320, rowH = 40, padTop = 6, barH = 14, gutterR = 40;
  const max = Math.max(1, ...items.map((i) => i.n));
  const H = padTop + Math.max(1, items.length) * rowH;
  const g = [];
  if (!items.length) g.push(s('text', { x: 0, y: 20, class: 'chart__lbl', text: '—' }));
  items.forEach((it, k) => {
    const y = padTop + k * rowH;
    const w = Math.max(2, ((W - gutterR) * it.n) / max);
    g.push(
      s('text', { x: 0, y: y + 12, class: 'chart__lbl', text: it.cle }),
      s('rect', { x: 0, y: y + 17, width: w, height: barH, rx: 3, class: 'chart__bar' }),
      s('text', { x: w + 6, y: y + 17 + 11, class: 'chart__val', text: it.n }),
    );
  });
  return s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart__svg', role: 'img' }, ...g);
}

// — Barres verticales (histogramme / série mensuelle) —————————————————————————————
function barresV(items, { labelDe, labelEvery = 1 } = {}) {
  const slot = 26, H = 150, padTop = 16, padBot = 30, padX = 4;
  const barW = 16;
  const max = Math.max(1, ...items.map((i) => i.n));
  const W = Math.max(300, padX * 2 + items.length * slot);
  const plotH = H - padTop - padBot;
  const g = [s('line', { x1: padX, y1: padTop + plotH, x2: W - padX, y2: padTop + plotH, class: 'chart__axis' })];
  items.forEach((it, k) => {
    const x = padX + k * slot + (slot - barW) / 2;
    const h = Math.max(it.n > 0 ? 2 : 0, (plotH * it.n) / max);
    const y = padTop + plotH - h;
    if (it.n > 0) {
      g.push(s('rect', { x, y, width: barW, height: h, rx: 2, class: 'chart__bar' }));
      g.push(s('text', { x: x + barW / 2, y: y - 3, 'text-anchor': 'middle', class: 'chart__val', text: it.n }));
    }
    if (k % labelEvery === 0) {
      g.push(s('text', { x: x + barW / 2, y: H - 10, 'text-anchor': 'middle', class: 'chart__lbl', text: labelDe(it) }));
    }
  });
  return s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart__svg', role: 'img' }, ...g);
}

// — Barres empilées par couleur (pas de camembert) + légende texte ————————————————
function chartCouleurs(ctx, items) {
  const { el } = ctx;
  const W = 320, H = 30, barH = 24;
  const total = items.reduce((sum, i) => sum + i.n, 0) || 1;
  let x = 0;
  const g = [];
  items.forEach((it) => {
    const w = (W * it.n) / total;
    const slug = normalise(it.cle).replace(/\s+/g, '-');
    // fill via `style` : var() se résout dans un attribut style, pas dans un attribut de présentation.
    g.push(s('rect', { x, y: 3, width: w, height: barH, style: `fill: var(--wine-${slug})`, stroke: 'var(--line)', 'stroke-width': '0.5' }));
    x += w;
  });
  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart__svg', role: 'img' }, ...g);

  // Légende : la couleur ne porte JAMAIS seule l'info (CLAUDE.md) → chaque segment est étiqueté.
  const legende = el('ul', { class: 'legend' },
    ...items.map((it) => {
      const slug = normalise(it.cle).replace(/\s+/g, '-');
      return el('li', { class: 'legend__item' },
        el('span', { class: 'legend__swatch', style: `background: var(--wine-${slug})` }),
        el('span', { text: `${it.cle} · ${it.n}` }));
    }));

  return el('section', { class: 'card' },
    el('h2', { text: 'Répartition par couleur' }),
    el('div', { class: 'chart' }, svg),
    legende);
}
