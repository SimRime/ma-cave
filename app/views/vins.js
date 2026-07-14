// views/vins.js — APERÇU PROVISOIRE (lot L0). Le vrai catalogue (recherche, tri, fiche, ajout)
// est le lot L3 : NE PAS l'implémenter ici. Simple liste en lecture seule.

import { wineLabel } from '../format.js';

export function renderVins(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();

  container.append(
    el('h1', { text: 'Vins' }),
    el('p', { class: 'muted', text: 'Aperçu provisoire — le catalogue arrive au lot L3.' }),
  );

  if (!s.loaded) {
    container.append(el('p', { text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }

  const data = s.data;
  const wines = data.wines.filter((w) => !w.archive);

  const items = wines.map((w) => {
    // Stock DÉRIVÉ, jamais stocké (invariant 1) : on compte les bouteilles, on ne lit aucun champ.
    const stock = data.bottles.filter((b) => b.wineId === w.id).length;
    return el('li', { class: 'wine' },
      el('div', { class: 'wine__title', text: wineLabel(w) }),
      el('div', { class: 'wine__meta' },
        el('span', { class: 'tag', text: w.couleur }),
        w.appellation ? el('span', { text: w.appellation }) : null,
        el('span', { class: stock ? 'muted' : 'tag tag--empty', text: stock ? `${stock} en cave` : 'épuisé' })));
  });

  container.append(
    el('p', { class: 'muted', text: `${wines.length} vin(s) au catalogue.` }),
    el('ul', { class: 'wines' }, items),
  );
}
