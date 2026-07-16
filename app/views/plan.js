// views/plan.js — écran d'accueil (lot L2). Priorité n°1 : trouver une bouteille, la boire.
//
// Référence normative : PRD §6.1 + prototype-plan-cave.html variantes A (grille) et C (adresse).
// Sont normatifs : dimensions, 6 états visuels du casier, geste tap → feuille, bascule Plan↔Adresse,
// persistance de la recherche. Le CSS/DOM du prototype est indicatif — ceci est du code de production.
//
// Aucune logique métier ici : toute mutation passe par ctx.store.dispatch → ops.js (les 12 opérations).
// Aucun barème de garde n'est calculé (c'est le lot L3) : le statut affiché LIT les champs déjà stockés.

import { slotKey, slotLabel, wineLabel, matchWine, normalise } from '../format.js';

const CELL_KEY = 'macave.cellSize';
const CELL_MIN = 24;
const CELL_MAX = 46;
const CELL_DEFAULT = 30;

const COULEURS = ['Rouge', 'Blanc', 'Rosé', 'Effervescent', 'Liquoreux', 'Jaune'];

// État de vue, persistant entre navigations (le container #view est vidé à chaque rendu).
const ui = { query: '', mode: 'plan', zoneId: null, colorFilter: null, placing: null };

// Overlay (feuille) monté sur document.body pour survivre à un re-rendu de #view.
let overlayEl = null;
let navHooked = false;

// ---------------------------------------------------------------------------
// Helpers purs.
// ---------------------------------------------------------------------------

const colorSlug = (couleur) => normalise(couleur).replace(/\s+/g, '-'); // « Rosé » → « rose »
const clampSize = (v) => Math.min(CELL_MAX, Math.max(CELL_MIN, Number(v) || CELL_DEFAULT));
const readCellSize = () => clampSize(localStorage.getItem(CELL_KEY));

const sortedZones = (data) =>
  data.zones.slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));

const rowLabels = (z) => z.rowLabels ?? Array.from({ length: z.rows }, (_, i) => String.fromCharCode(65 + i));
const colLabels = (z) => z.colLabels ?? Array.from({ length: z.cols }, (_, i) => String(i + 1));

// Bouteille rangée sur ce casier (zone/row/col), s'il y en a une.
const bottleAt = (data, zone, row, col) =>
  data.bottles.find(
    (b) => b.slot && b.slot.zone === zone && b.slot.row === row && b.slot.col === col,
  );

const placedInZone = (data, zoneId) => data.bottles.filter((b) => b.slot && b.slot.zone === zoneId);

const freeCount = (data, z) =>
  z.rows * z.cols - (z.disabledSlots?.length ?? 0) - placedInZone(data, z.id).length;

// Statut de garde COARSE, lu des champs stockés (gardeDe/apogee/gardeA). Pas de moteur (lot L3).
function gardeStatus(wine) {
  const year = new Date().getFullYear();
  if (wine.gardeA != null && year > wine.gardeA) return { label: 'à boire vite', kind: 'urgent' };
  if (wine.apogee != null && year >= wine.apogee) return { label: 'à l’apogée', kind: 'apogee' };
  if (wine.gardeDe != null && year < wine.gardeDe) return { label: 'encore jeune', kind: 'jeune' };
  if (wine.gardeA != null || wine.apogee != null || wine.gardeDe != null) return { label: 'en garde', kind: 'garde' };
  return null;
}

// Provenance affichable seulement si c'est un cadeau / un héritage (PRD §6.1 : « provenance si cadeau »).
function provenanceLine(bottle) {
  const a = bottle.acquisition;
  if (!a) return null;
  if (a.type === 'cadeau') return `Offert par ${a.source || '—'}${a.occasion ? ` · ${a.occasion}` : ''}`;
  if (a.type === 'heritage') return `Héritage — ${a.source || '—'}`;
  return null;
}

// ---------------------------------------------------------------------------
// Overlay bas de page (feuille) — sur document.body.
// ---------------------------------------------------------------------------

function closeOverlay() {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
}

function openOverlay(el, sheet) {
  closeOverlay();
  const veil = el('div', { class: 'veil', onclick: closeOverlay });
  overlayEl = el('div', { class: 'overlay' }, veil, sheet);
  document.body.append(overlayEl);
  requestAnimationFrame(() => sheet.classList.add('sheet--open'));
}

// ---------------------------------------------------------------------------
// Rendu principal.
// ---------------------------------------------------------------------------

export function renderPlan(container, ctx) {
  const { el, store } = ctx;

  // Un overlay resté ouvert doit se fermer quand on quitte l'écran (une seule fois).
  if (!navHooked) {
    navHooked = true;
    window.addEventListener('hashchange', () => { closeOverlay(); ui.placing = null; });
  }
  closeOverlay(); // repart propre à chaque rendu de #view

  const s = store.getState();
  const root = el('div', { class: 'plan' });
  root.style.setProperty('--cell', readCellSize() + 'px');
  container.append(root);

  if (!s.loaded) {
    root.append(el('p', { class: 'muted', text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }

  const data = s.data;
  const wineById = new Map(data.wines.map((w) => [w.id, w]));
  const zones = sortedZones(data);
  if (!zones.find((z) => z.id === ui.zoneId)) ui.zoneId = zones[0]?.id ?? null;

  const canWrite = s.canWrite;
  const refresh = () => ctx.onChange();

  // — Recherche partagée (persiste à la bascule Plan ↔ Adresse) ——————————————
  const hitsEl = el('div', { class: 'hits', role: 'status' });
  const searchInput = el('input', {
    type: 'search',
    class: 'search__input',
    value: ui.query,
    placeholder: 'Chercher un vin, un cépage, une appellation…',
    autocomplete: 'off',
    enterkeyhint: 'search',
    'aria-label': 'Rechercher une bouteille',
  });
  searchInput.addEventListener('input', () => {
    ui.query = searchInput.value;
    applySearch();
  });
  root.append(el('div', { class: 'search' }, searchInput, hitsEl));

  // — Bascule Plan ↔ Adresse (permanente) ————————————————————————————————————
  const mkToggle = (mode, label) =>
    el('button', {
      class: ui.mode === mode ? 'toggle__btn toggle__btn--on' : 'toggle__btn',
      'aria-pressed': ui.mode === mode ? 'true' : 'false',
      onclick: () => { if (ui.mode !== mode) { ui.mode = mode; renderContent(); } },
      text: label,
    });
  root.append(el('div', { class: 'toggle', role: 'group', 'aria-label': 'Mode d’affichage' },
    mkToggle('plan', 'Plan'), mkToggle('adresse', 'Adresse')));

  // — Filtre couleur (chips) ——————————————————————————————————————————————————
  const presentColors = COULEURS.filter((c) => data.wines.some((w) => w.couleur === c));
  if (presentColors.length > 1) {
    const chip = (c, label) =>
      el('button', {
        class: ui.colorFilter === c ? 'chip chip--on' : 'chip',
        'aria-pressed': ui.colorFilter === c ? 'true' : 'false',
        onclick: () => { ui.colorFilter = c; renderContent(); },
        text: label,
      });
    root.append(el('div', { class: 'filters' },
      chip(null, 'Toutes'),
      ...presentColors.map((c) => chip(c, c))));
  }

  // — Contenu (grille ou adresse), reconstruit sans toucher à la recherche ————
  const contentEl = el('div', { class: 'plan__content' });
  root.append(contentEl);

  // Références de casiers pour le surlignage de recherche in-place (pas de re-rendu).
  let cellRefs = [];

  function applySearch() {
    const q = ui.query.trim();
    const n = q ? data.wines.filter((w) => matchWine(w, q)).length : 0;
    hitsEl.textContent = q ? (n ? `${n} vin${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''}` : 'aucun vin') : '';

    if (ui.mode === 'plan') {
      const grid = contentEl.querySelector('.grid');
      if (grid) grid.classList.toggle('grid--searching', !!q);
      for (const { btn, wineId } of cellRefs) {
        const w = wineById.get(wineId);
        btn.classList.toggle('cell--hit', !!q && !!w && matchWine(w, q));
      }
    } else {
      renderAddress();
    }
  }

  // — Grille ————————————————————————————————————————————————————————————————
  function renderGrid() {
    cellRefs = [];
    if (!ui.zoneId) {
      contentEl.append(el('p', { class: 'muted', text: 'Aucune zone — créez-en une dans Réglages.' }));
      return;
    }

    // Onglets de zone (si plusieurs) + compteur de places libres.
    if (zones.length > 1) {
      const tabs = el('div', { class: 'zonetabs', role: 'tablist' });
      for (const z of zones) {
        tabs.append(el('button', {
          class: z.id === ui.zoneId ? 'zonetab zonetab--on' : 'zonetab',
          role: 'tab',
          'aria-selected': z.id === ui.zoneId ? 'true' : 'false',
          onclick: () => { ui.zoneId = z.id; renderContent(); },
          text: z.nom,
        }));
      }
      contentEl.append(tabs);
    }

    const zone = zones.find((z) => z.id === ui.zoneId);
    contentEl.append(el('div', { class: 'zonehead' },
      el('h2', { text: zone.nom }),
      el('span', { class: 'muted', text: `${freeCount(data, zone)} place(s) libre(s)` })));

    if (ui.placing) {
      const w = wineById.get(ui.placing.wineId);
      contentEl.append(el('div', { class: 'placing' },
        el('span', { text: `Placer ${w ? wineLabel(w) : 'la bouteille'} : touchez un casier libre.` }),
        el('button', { class: 'btn', onclick: () => { ui.placing = null; renderContent(); }, text: 'Annuler' })));
    }

    const rows = rowLabels(zone);
    const cols = colLabels(zone);
    const grid = el('div', { class: 'grid' });
    grid.style.gridTemplateColumns = `repeat(${zone.cols}, var(--cell))`;
    const frag = document.createDocumentFragment();

    for (const row of rows) {
      for (const col of cols) {
        frag.append(buildCell(zone, row, col));
      }
    }
    grid.append(frag);
    contentEl.append(el('div', { class: 'gridpane' }, grid));
    contentEl.append(el('p', { class: 'legende muted', text:
      'Disque plein = bouteille (couleur du vin) · pointillé = libre · hachuré = désactivé · anneau = magnum.' }));

    function buildCell(zone, row, col) {
      const disabled = (zone.disabledSlots ?? []).includes(slotKey(row, col));
      const bottle = bottleAt(data, zone.id, row, col);
      const addr = `${zone.nom} · ${row}${col}`;

      if (disabled) {
        return el('button', {
          class: 'cell cell--disabled',
          disabled: true,
          'aria-label': `casier désactivé ${row}${col}`,
          title: `${row}${col} — désactivé`,
        });
      }

      if (!bottle) {
        const btn = el('button', {
          class: 'cell cell--empty',
          'aria-label': `casier libre ${row}${col}`,
          title: `${row}${col} — libre`,
        });
        if (ui.placing) btn.addEventListener('click', () => doPlaceHere(zone.id, row, col));
        return btn;
      }

      const w = wineById.get(bottle.wineId);
      const classes = ['cell', 'cell--wine', `cell--${colorSlug(w?.couleur || '')}`];
      if (bottle.format === 'magnum') classes.push('cell--magnum');
      const btn = el('button', {
        class: classes.join(' '),
        'aria-label': `${w ? wineLabel(w) : bottle.wineId}${bottle.format !== 'standard' ? ` (${bottle.format})` : ''} — ${addr}`,
        title: addr,
      });
      btn.addEventListener('click', () => {
        if (ui.placing) return doOccupiedTarget(zone.id, row, col);
        openSheet(bottle, zone, row, col);
      });
      cellRefs.push({ btn, wineId: bottle.wineId });
      return btn;
    }
  }

  // — Adresse ————————————————————————————————————————————————————————————————
  function renderAddress() {
    const list = contentEl.querySelector('.address');
    const host = list || el('div', { class: 'address' });
    if (!list) contentEl.append(host);
    while (host.firstChild) host.removeChild(host.firstChild);

    const q = ui.query.trim();
    if (!q) {
      const examples = [...new Set(data.wines.map((w) => w.appellation || w.producteur).filter(Boolean))].slice(0, 5);
      host.append(el('div', { class: 'empty-state' },
        el('p', { text: 'Tapez un nom, un cépage, une appellation. L’adresse arrive.' }),
        el('div', { class: 'chips' },
          ...examples.map((s) => el('button', {
            class: 'chip', onclick: () => { searchInput.value = s; ui.query = s; applySearch(); }, text: s,
          })))));
      return;
    }

    const refs = data.wines
      .filter((w) => matchWine(w, q) && (!ui.colorFilter || w.couleur === ui.colorFilter))
      .filter((w) => data.bottles.some((b) => b.wineId === w.id));
    if (!refs.length) {
      host.append(el('div', { class: 'empty-state' }, el('p', { text: 'Rien sous ce nom dans la cave.' })));
      return;
    }

    for (const w of refs) {
      const bottles = data.bottles.filter((b) => b.wineId === w.id);
      const placed = bottles.filter((b) => b.slot);
      const gs = gardeStatus(w);
      const card = el('div', { class: 'adcard' });
      const swatch = el('div', { class: 'adcard__swatch' });
      swatch.style.background = `var(--wine-${colorSlug(w.couleur)})`;

      const first = placed[0];
      const addrBig = first
        ? el('div', { class: 'adcard__addr' },
            el('span', { class: 'adcard__zone', text: (zones.find((z) => z.id === first.slot.zone)?.nom) || first.slot.zone }),
            el('span', { text: slotLabel(first.slot) }))
        : el('div', { class: 'adcard__addr adcard__addr--none' }, el('span', { text: 'à ranger' }));

      const others = placed.slice(1).map((b) => slotLabel(b.slot));
      const body = el('div', { class: 'adcard__body' },
        el('div', { class: 'adcard__prod', text: w.producteur || '' }),
        el('div', { class: 'adcard__nom', text: `${w.nom || ''}${w.millesime ? ` ${w.millesime}` : ''}` }),
        el('div', { class: 'adcard__meta muted', text: [w.appellation, gs && gs.label].filter(Boolean).join(' · ') }),
        addrBig,
        others.length ? el('div', { class: 'adcard__plus muted', text: `${bottles.length} bouteilles · aussi en ${others.join(', ')}` }) : null,
      );

      // Mini-carte de la zone de la première bouteille.
      if (first) {
        const z = zones.find((zz) => zz.id === first.slot.zone);
        if (z) {
          const mine = new Set(placed.filter((b) => b.slot.zone === z.id).map((b) => `${b.slot.row}|${b.slot.col}`));
          const mini = el('div', { class: 'mini' });
          mini.style.gridTemplateColumns = `repeat(${z.cols}, 6px)`;
          for (const row of rowLabels(z)) {
            for (const col of colLabels(z)) {
              const occupied = !!bottleAt(data, z.id, row, col);
              const cls = mine.has(`${row}|${col}`) ? 'mini__c mini__c--me' : occupied ? 'mini__c mini__c--on' : 'mini__c';
              mini.append(el('i', { class: cls }));
            }
          }
          body.append(mini);
        }
      }

      if (first) card.addEventListener('click', () => openSheet(first, zones.find((z) => z.id === first.slot.zone), first.slot.row, first.slot.col));
      card.append(swatch, body);
      host.append(card);
    }
  }

  // — Bandeau « à ranger » —————————————————————————————————————————————————————
  function renderAranger() {
    const unplaced = data.bottles.filter((b) => !b.slot);
    if (!unplaced.length) return;
    const box = el('div', { class: 'aranger' },
      el('strong', { text: `${unplaced.length} bouteille(s) à ranger` }));
    for (const b of unplaced) {
      const w = wineById.get(b.wineId);
      box.append(el('div', { class: 'aranger__row' },
        el('span', { text: `${w ? wineLabel(w) : b.wineId}${b.format !== 'standard' ? ` (${b.format})` : ''}` }),
        canWrite
          ? el('button', { class: 'btn', onclick: () => startPlacing(b), text: 'Ranger' })
          : null));
    }
    contentEl.append(box);
  }

  function renderContent() {
    while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
    renderAranger();               // bandeau « à ranger » en tête
    if (ui.mode === 'plan') renderGrid();
    applySearch();                 // Plan : surligne ; Adresse : rend les cartes + compteur
    // refléter l'état de la bascule
    root.querySelectorAll('.toggle__btn').forEach((b) => {
      const on = b.textContent === (ui.mode === 'plan' ? 'Plan' : 'Adresse');
      b.classList.toggle('toggle__btn--on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    syncSizer();
  }

  // — Curseur de taille (agrément) : applique --cell en direct, pas de re-rendu ——
  const slider = el('input', {
    type: 'range', class: 'sizer__range', min: String(CELL_MIN), max: String(CELL_MAX),
    value: String(readCellSize()), 'aria-label': 'Taille des casiers',
  });
  slider.addEventListener('input', () => {
    const v = clampSize(slider.value);
    localStorage.setItem(CELL_KEY, String(v));
    root.style.setProperty('--cell', v + 'px');
  });
  const sizer = el('div', { class: 'sizer' }, el('span', { class: 'muted', text: 'Taille' }), slider);
  // Placé après le contenu pour ne pas gêner le pouce ; visible seulement en mode Plan.
  root.append(sizer);
  const syncSizer = () => { sizer.style.display = ui.mode === 'plan' ? '' : 'none'; };

  // — Placement (Déplacer / Ranger) ——————————————————————————————————————————
  function startPlacing(bottle) {
    if (!canWrite) return;
    closeOverlay();
    ui.placing = { bottleId: bottle.id, wineId: bottle.wineId, type: bottle.slot ? 'MOVE_BOTTLE' : 'PLACE_BOTTLE' };
    ui.mode = 'plan';
    renderContent();
    syncSizer();
  }

  async function doPlaceHere(zoneId, row, col) {
    const p = ui.placing;
    if (!p) return;
    try {
      await store.dispatch({ type: p.type, payload: { bottleId: p.bottleId, slot: { zone: zoneId, row, col } } });
      ui.placing = null;
      refresh();
    } catch (e) {
      toast(el, e.message || 'Placement impossible.');
    }
  }

  // Option A (plan L2) : pas d'échange en L2 — on invite à choisir un casier libre.
  function doOccupiedTarget(zoneId, row, col) {
    const occ = bottleAt(data, zoneId, row, col);
    const w = occ && wineById.get(occ.wineId);
    toast(el, `Casier ${row}${col} occupé${w ? ` par ${wineLabel(w)}` : ''} — choisissez un casier libre.`);
  }

  // — Feuille (tap casier) ————————————————————————————————————————————————————
  function openSheet(bottle, zone, row, col) {
    const w = wineById.get(bottle.wineId);
    const gs = gardeStatus(w || {});
    const prov = provenanceLine(bottle);
    const addr = `${zone?.nom || bottle.slot?.zone || ''} · ${row}${col}${bottle.format !== 'standard' ? ` · ${bottle.format}` : ''}`;

    const dot = el('span', { class: 'sheet__dot' });
    dot.style.background = `var(--wine-${colorSlug(w?.couleur || '')})`;

    const dl = el('dl', { class: 'sheet__dl' },
      el('dt', { text: 'Casier' }), el('dd', { text: addr }),
      el('dt', { text: 'Appellation' }), el('dd', { text: w?.appellation || '—' }),
      el('dt', { text: 'Cépages' }), el('dd', { text: (w?.cepages || []).join(', ') || '—' }),
      el('dt', { text: 'Garde' }), el('dd', { text: gs ? gs.label : 'non renseignée' }),
      prov ? el('dt', { text: 'Provenance' }) : null, prov ? el('dd', { text: prov }) : null,
    );

    const actions = el('div', { class: 'sheet__acts' },
      el('button', {
        class: 'btn sheet__act sheet__act--primary', disabled: !canWrite,
        title: canWrite ? '' : 'Ajoutez un token pour modifier la cave.',
        onclick: (ev) => doDrink(bottle, w, ev.currentTarget),
        text: 'Boire',
      }),
      el('button', { class: 'btn sheet__act', disabled: !canWrite, onclick: () => startPlacing(bottle), text: 'Déplacer' }),
      el('button', { class: 'btn sheet__act', onclick: () => { closeOverlay(); ctx.navigate('/vins'); }, text: 'Fiche' }),
    );

    const sheet = el('div', { class: 'sheet' },
      el('div', { class: 'sheet__grip' }),
      el('div', { class: 'sheet__top' }, dot, el('div', {},
        el('div', { class: 'sheet__prod muted', text: w?.producteur || '' }),
        el('h3', { class: 'sheet__nom', text: `${w?.nom || '—'}${w?.millesime ? ` ${w.millesime}` : ''}` }))),
      dl, actions,
    );
    openOverlay(el, sheet);
  }

  async function doDrink(bottle, w, btn) {
    btn.disabled = true;
    btn.textContent = 'Ouverture…';
    try {
      await store.dispatch({ type: 'DRINK_BOTTLE', payload: { bottleId: bottle.id } });
      refresh();                    // le casier se libère (re-rendu de la grille)
      openTastingSheet(bottle, w);  // feuille de dégustation optionnelle (sur body, survit au re-rendu)
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Boire';
      toast(el, e.message || 'Impossible de boire cette bouteille.');
    }
  }

  // — Feuille de dégustation optionnelle après « Boire » ——————————————————————
  function openTastingSheet(bottle, w) {
    const today = new Date().toISOString().slice(0, 10);
    const dateI = el('input', { type: 'date', value: today, 'aria-label': 'Date' });
    const noteI = el('input', { type: 'number', min: '0', max: '20', step: '0.5', placeholder: 'sur 20', 'aria-label': 'Note sur 20' });
    const withI = el('input', { type: 'text', placeholder: 'Marc, Julie…', 'aria-label': 'Avec qui' });

    const enregistrer = async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Enregistrement…';
      const note = noteI.value === '' ? null : Number(noteI.value);
      try {
        await store.dispatch({ type: 'ADD_TASTING', payload: {
          wineId: bottle.wineId, bottleId: bottle.id, date: dateI.value || today,
          note, avecQui: withI.value.trim() || null, par: ctx.settings.read().user || null,
        } });
        closeOverlay();
        refresh();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
        toast(el, e.message || 'Enregistrement impossible.');
      }
    };

    const sheet = el('div', { class: 'sheet' },
      el('div', { class: 'sheet__grip' }),
      el('h3', { class: 'sheet__nom', text: 'Dégustation' }),
      el('p', { class: 'muted', text: `${w ? wineLabel(w) : ''} — bue. Une note, ou passez.` }),
      el('label', { text: 'Date' }), dateI,
      el('label', { text: 'Note (sur 20)' }), noteI,
      el('label', { text: 'Avec qui' }), withI,
      el('div', { class: 'sheet__acts' },
        el('button', { class: 'btn sheet__act sheet__act--primary', onclick: (ev) => enregistrer(ev.currentTarget), text: 'Enregistrer' }),
        el('button', { class: 'btn sheet__act', onclick: () => { closeOverlay(); }, text: 'Passer' })),
    );
    openOverlay(el, sheet);
  }

  // Premier rendu du contenu.
  renderContent();
  syncSizer();
}

// Petit message éphémère (non bloquant).
function toast(el, message) {
  const t = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('toast--on'));
  setTimeout(() => { t.classList.remove('toast--on'); setTimeout(() => t.remove(), 250); }, 2600);
}
