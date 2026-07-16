// views/zones.js — éditeur de zones (lot L2), monté dans Réglages (PRD §6.8).
// Créer, renommer, dimensionner, désactiver des casiers, réordonner, supprimer.
//
// Invariant 5 : jamais de perte silencieuse de bouteille. On ne recopie PAS la logique d'orphelinage
// (elle vit dans ops.js) : on TENTE l'opération et on lit le refus (OpAbortError.details.bottleIds)
// pour afficher la liste des bouteilles concernées. ops.js reste la seule autorité.

import { slotKey, wineLabel } from '../format.js';

export function renderZones(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();
  const data = s.data;
  const canWrite = s.canWrite;

  const card = el('section', { class: 'card' }, el('h2', { text: 'Éditeur de zones' }));
  container.append(card);

  if (!data) {
    card.append(el('p', { class: 'muted', text: 'Cave non chargée.' }));
    return;
  }
  if (!canWrite) {
    card.append(el('p', { class: 'muted', text: 'Ajoutez un token dans Réglages pour modifier les zones.' }));
  }

  const wineById = new Map(data.wines.map((w) => [w.id, w]));
  const zones = data.zones.slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const zoneName = (id) => data.zones.find((z) => z.id === id)?.nom ?? id;
  const rowLabels = (z) => z.rowLabels ?? Array.from({ length: z.rows }, (_, i) => String.fromCharCode(65 + i));
  const colLabels = (z) => z.colLabels ?? Array.from({ length: z.cols }, (_, i) => String(i + 1));
  const bottleAt = (zoneId, row, col) =>
    data.bottles.find((b) => b.slot && b.slot.zone === zoneId && b.slot.row === row && b.slot.col === col);

  const status = el('p', { class: 'status', role: 'status' });

  const bottleAddr = (id) => {
    const b = data.bottles.find((x) => x.id === id);
    if (!b) return id;
    const w = wineById.get(b.wineId);
    const loc = b.slot ? `${zoneName(b.slot.zone)} ${b.slot.row}${b.slot.col}` : 'à ranger';
    return `${w ? wineLabel(w) : b.wineId} (${loc})`;
  };

  // Toute mutation de zone passe par ici : dispatch, message clair, re-rendu.
  async function run(op, okMsg) {
    status.textContent = '…';
    status.className = 'status';
    try {
      await store.dispatch(op);
      status.textContent = okMsg || 'Enregistré.';
      status.className = 'status status--ok';
      ctx.onChange();
    } catch (e) {
      const ids = e.details?.bottleIds || [];
      const list = ids.length ? ` : ${ids.map(bottleAddr).join(', ')}` : '';
      status.textContent = `${e.message}${list}`;
      status.className = 'status status--warn';
    }
  }

  for (const z of zones) {
    card.append(renderZoneCard(z));
  }

  // — Création ————————————————————————————————————————————————————————————————
  if (canWrite) {
    const nom = el('input', { type: 'text', maxlength: '60', placeholder: 'Nom de la zone' });
    const rows = el('input', { type: 'number', min: '1', max: '60', value: '7', 'aria-label': 'Rangées' });
    const cols = el('input', { type: 'number', min: '1', max: '60', value: '12', 'aria-label': 'Colonnes' });
    const create = () => {
      const payload = { nom: nom.value.trim() || 'Nouvelle zone', rows: clampDim(rows.value), cols: clampDim(cols.value) };
      run({ type: 'UPSERT_ZONE', payload }, 'Zone créée.');
    };
    card.append(el('div', { class: 'zone-edit zone-edit--new' },
      el('h3', { text: 'Nouvelle zone' }),
      el('label', { text: 'Nom' }), nom,
      el('div', { class: 'row' },
        el('span', { class: 'muted', text: 'Rangées' }), rows,
        el('span', { class: 'muted', text: 'Colonnes' }), cols),
      el('div', { class: 'row' }, el('button', { class: 'btn btn--primary', onclick: create, text: 'Créer la zone' }))));
  }

  card.append(status);

  // — Carte d'une zone ————————————————————————————————————————————————————————
  function renderZoneCard(z) {
    const box = el('div', { class: 'zone-edit' });

    // En-tête : nom éditable + réordonner.
    const nameI = el('input', { type: 'text', value: z.nom, maxlength: '60', disabled: !canWrite, 'aria-label': 'Nom de la zone' });
    const idx = zones.indexOf(z);
    const move = (dir) => {
      const neighbour = zones[idx + dir];
      if (!neighbour) return;
      // Échange des rangs : deux écritures sérialisées (une seule requête PUT en vol, cf. github.js).
      run({ type: 'UPSERT_ZONE', payload: { id: z.id, ordre: neighbour.ordre ?? 0 } }, 'Ordre modifié.');
      store.dispatch({ type: 'UPSERT_ZONE', payload: { id: neighbour.id, ordre: z.ordre ?? 0 } }).then(ctx.onChange).catch(() => {});
    };

    box.append(el('div', { class: 'zone-edit__head' },
      nameI,
      canWrite ? el('button', { class: 'btn', onclick: () => run({ type: 'UPSERT_ZONE', payload: { id: z.id, nom: nameI.value.trim() || z.nom } }, 'Renommée.'), text: 'Renommer' }) : null,
      zones.length > 1 && canWrite ? el('button', { class: 'btn', disabled: idx === 0, onclick: () => move(-1), text: '↑', 'aria-label': 'Monter' }) : null,
      zones.length > 1 && canWrite ? el('button', { class: 'btn', disabled: idx === zones.length - 1, onclick: () => move(1), text: '↓', 'aria-label': 'Descendre' }) : null,
    ));

    // Dimensions.
    const rowsI = el('input', { type: 'number', min: '1', max: '60', value: String(z.rows), disabled: !canWrite, 'aria-label': 'Rangées' });
    const colsI = el('input', { type: 'number', min: '1', max: '60', value: String(z.cols), disabled: !canWrite, 'aria-label': 'Colonnes' });
    box.append(el('div', { class: 'row' },
      el('span', { class: 'muted', text: 'Rangées' }), rowsI,
      el('span', { class: 'muted', text: 'Colonnes' }), colsI,
      canWrite ? el('button', { class: 'btn', onclick: () => run({ type: 'UPSERT_ZONE', payload: { id: z.id, rows: clampDim(rowsI.value), cols: clampDim(colsI.value) } }, 'Dimensions modifiées.'), text: 'Redimensionner' }) : null));

    // Mini-grille : désactiver / réactiver des casiers.
    box.append(el('p', { class: 'muted zone-edit__hint', text: 'Touchez un casier libre pour le désactiver (hachuré) ou le réactiver. Un casier occupé ne peut pas être désactivé.' }));
    const disabled = new Set(z.disabledSlots ?? []);
    const mini = el('div', { class: 'zonegrid' });
    mini.style.gridTemplateColumns = `repeat(${z.cols}, 1fr)`;
    for (const row of rowLabels(z)) {
      for (const col of colLabels(z)) {
        const key = slotKey(row, col);
        const occupied = !!bottleAt(z.id, row, col);
        const isOff = disabled.has(key);
        const cls = ['zonecell'];
        if (occupied) cls.push('zonecell--occ');
        else if (isOff) cls.push('zonecell--off');
        const btn = el('button', {
          class: cls.join(' '),
          disabled: !canWrite || occupied,
          title: `${row}${col}${occupied ? ' — occupé' : isOff ? ' — désactivé' : ' — libre'}`,
          'aria-label': `casier ${row}${col} ${occupied ? 'occupé' : isOff ? 'désactivé' : 'libre'}`,
          text: isOff ? '×' : '',
        });
        if (canWrite && !occupied) {
          btn.addEventListener('click', () => {
            const next = new Set(disabled);
            if (next.has(key)) next.delete(key); else next.add(key);
            run({ type: 'UPSERT_ZONE', payload: { id: z.id, disabledSlots: [...next] } }, isOff ? 'Casier réactivé.' : 'Casier désactivé.');
          });
        }
        mini.append(btn);
      }
    }
    box.append(mini);

    // Suppression.
    if (canWrite) {
      box.append(el('div', { class: 'row' },
        el('button', { class: 'btn btn--danger', onclick: () => run({ type: 'DELETE_ZONE', payload: { id: z.id } }, 'Zone supprimée.'), text: 'Supprimer la zone' })));
    }
    return box;
  }
}

const clampDim = (v) => Math.min(60, Math.max(1, Math.round(Number(v) || 1)));
