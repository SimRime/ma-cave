// views/a-boire.js — écran « À boire » (PRD §6.4). Route #/a-boire.
//
// Trois sections fondées sur les DRAPEAUX de garde (D4), évalués sur la fenêtre EFFECTIVE de chaque
// bouteille (app/garde.js) : « À boire vite » (urgent), « À l'apogée » (apogee), « Encore trop
// jeune » (tropJeune, repliée par défaut). Une bouteille portant plusieurs drapeaux apparaît dans
// chaque section concernée. Chaque ligne montre l'emplacement (cliquable → plan). Filtre couleur.

import { wineLabel, slotLabel } from '../format.js';
import { gardeEffective, statutsGarde } from '../garde.js';

const COULEURS = ['Rouge', 'Blanc', 'Rosé', 'Effervescent', 'Liquoreux', 'Jaune'];

const ui = { colorFilter: null, showJeune: false };

export function renderABoire(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();
  const kb = ctx.kb;

  container.append(el('h1', { text: 'À boire' }));

  if (!s.loaded) {
    container.append(el('p', { class: 'muted', text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }
  if (!kb) {
    container.append(el('p', { class: 'muted', text: 'Base de connaissances en cours de chargement…' }));
    return;
  }

  const data = s.data;
  const annee = new Date().getFullYear();
  const wineById = new Map(data.wines.map((w) => [w.id, w]));

  // Une entrée par bouteille placée en cave, avec sa fenêtre effective et ses drapeaux.
  const entries = [];
  for (const b of data.bottles) {
    const w = wineById.get(b.wineId);
    if (!w || w.archive) continue;
    const eff = gardeEffective(w, b, kb);
    entries.push({ b, w, eff, flags: statutsGarde(eff, annee) });
  }

  // — Filtre couleur ——————————————————————————————————————————————————————————
  const presentColors = COULEURS.filter((c) => entries.some((e) => e.w.couleur === c));
  if (presentColors.length > 1) {
    const chip = (c, label) => el('button', {
      class: ui.colorFilter === c ? 'chip chip--on' : 'chip',
      'aria-pressed': ui.colorFilter === c ? 'true' : 'false',
      onclick: () => { ui.colorFilter = c; ctx.onChange(); }, text: label,
    });
    container.append(el('div', { class: 'filters' }, chip(null, 'Toutes'), ...presentColors.map((c) => chip(c, c))));
  }

  const shown = ui.colorFilter ? entries.filter((e) => e.w.couleur === ui.colorFilter) : entries;
  const byUrgency = (a, b) => (a.eff.gardeA ?? Infinity) - (b.eff.gardeA ?? Infinity);

  const urgent = shown.filter((e) => e.flags.includes('urgent') || e.flags.includes('depasse')).sort(byUrgency);
  const apogee = shown.filter((e) => e.flags.includes('apogee')).sort(byUrgency);
  const jeune = shown.filter((e) => e.flags.includes('tropJeune')).sort(byUrgency);

  container.append(section(ctx, 'À boire vite', urgent, kb, { open: true, empty: 'Rien d’urgent — la cave respire.' }));
  container.append(section(ctx, 'À l’apogée', apogee, kb, { open: true, empty: 'Aucune bouteille à son apogée pour l’instant.' }));
  container.append(section(ctx, 'Encore trop jeune', jeune, kb, { open: ui.showJeune, collapsible: true, empty: 'Rien qui dorme encore.' }));

  if (!urgent.length && !apogee.length && !jeune.length) {
    container.append(el('p', { class: 'muted', text: 'Aucune bouteille placée à évaluer.' }));
  }
}

function section(ctx, titre, entries, kb, { open = true, collapsible = false, empty }) {
  const { el } = ctx;
  const card = el('section', { class: 'card' });
  const head = el('div', { class: 'aboire__head' },
    el('h2', { text: `${titre} (${entries.length})` }));

  if (collapsible) {
    const btn = el('button', { class: 'btn', text: ui.showJeune ? 'Masquer' : 'Afficher',
      onclick: () => { ui.showJeune = !ui.showJeune; ctx.onChange(); } });
    head.append(btn);
  }
  card.append(head);

  if (collapsible && !open) return card;

  if (!entries.length) {
    card.append(el('p', { class: 'muted', text: empty }));
    return card;
  }

  const ul = el('ul', { class: 'aboire' });
  for (const e of entries) {
    const addr = e.b.slot
      ? el('button', { class: 'btn btn--link', onclick: () => ctx.navigate('/plan'), text: slotLabel(e.b.slot), title: 'Voir sur le plan' })
      : el('span', { class: 'tag tag--empty', text: 'à ranger' });
    ul.append(el('li', { class: 'aboire__row', role: 'button', tabindex: '0',
      onclick: () => ctx.navigate(`/fiche/${e.w.id}`),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ctx.navigate(`/fiche/${e.w.id}`); } },
    },
      el('div', { class: 'aboire__title' },
        el('span', { class: 'tag', text: e.w.couleur }),
        el('span', { text: `${wineLabel(e.w)}${e.b.format !== 'standard' ? ` (${e.b.format})` : ''}` })),
      el('div', { class: 'aboire__meta' },
        addr,
        ...e.flags.map((f) => el('span', { class: `tag garde garde--${f}`, text: kb.garde.statuts[f]?.libelle ?? f })),
        el('span', { class: 'muted', text: `→ ${e.eff.gardeA ?? '—'}` }))));
  }
  card.append(ul);
  return card;
}
