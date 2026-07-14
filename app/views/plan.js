// views/plan.js — APERÇU PROVISOIRE (lot L0). Le vrai écran Plan (grille interactive, gestes,
// bascule Plan↔Adresse, états visuels du casier) est le lot L2 : NE PAS l'implémenter ici.
// Ce fichier ne fait qu'afficher, en lecture seule, ce que le chargement a ramené — la preuve
// que « on ouvre l'app et on voit la cave graine ».

import { slotLabel, wineLabel } from '../format.js';

export function renderPlan(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();

  container.append(
    el('h1', { text: 'Plan' }),
    el('p', { class: 'muted', text: 'Aperçu provisoire — l’écran interactif arrive au lot L2.' }),
  );

  if (!s.loaded) {
    container.append(el('p', { text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }

  const data = s.data;
  const wineById = new Map(data.wines.map((w) => [w.id, w]));

  for (const zone of data.zones) {
    const placed = data.bottles.filter((b) => b.slot && b.slot.zone === zone.id);
    const capacity = zone.rows * zone.cols - (zone.disabledSlots?.length ?? 0);

    const rows = placed
      .slice()
      .sort((a, b) => slotLabel(a.slot).localeCompare(slotLabel(b.slot), 'fr', { numeric: true }))
      .map((b) => {
        const w = wineById.get(b.wineId);
        return el('tr', {},
          el('td', { text: slotLabel(b.slot) }),
          el('td', { text: w ? wineLabel(w) : b.wineId }),
          el('td', { text: b.format === 'standard' ? '' : b.format }));
      });

    container.append(
      el('section', { class: 'card' },
        el('h2', { text: zone.nom }),
        el('p', { class: 'muted', text: `${zone.rows} × ${zone.cols} — ${placed.length} occupé(s) sur ${capacity} casiers` }),
        rows.length
          ? el('table', { class: 'grid-list' },
              el('thead', {}, el('tr', {}, el('th', { text: 'Casier' }), el('th', { text: 'Vin' }), el('th', { text: 'Format' }))),
              el('tbody', {}, rows))
          : el('p', { class: 'muted', text: 'Aucune bouteille rangée.' })),
    );
  }

  const aRanger = data.bottles.filter((b) => !b.slot);
  if (aRanger.length) {
    container.append(el('p', { class: 'muted', text: `${aRanger.length} bouteille(s) à ranger.` }));
  }
}
