// views/degustations.js — historique des dégustations (PRD §6.6). Route #/degustations.
//
// Liste complète (plus récente d'abord), recherche plein texte, filtres par vin / année / note,
// et édition a posteriori d'une note (UPDATE_TASTING, champ par champ — seuls les champs modifiés
// sont poussés, dernier écrivain gagne). Aucun nouvel op : ADD/UPDATE_TASTING existent déjà.
//
// Pattern maison (cf. vins.js) : les contrôles de filtre sont construits UNE fois, et un
// renderList() ne re-rend que la liste — l'input de recherche garde ainsi le focus à la frappe.

import { wineLabel, normalise } from '../format.js';

const ui = { q: '', wineId: '', annee: '', noteMin: '', editingId: null };

const NOTE_OPTS = [
  ['', 'Toutes notes'], ['16', '≥ 16'], ['14', '≥ 14'], ['12', '≥ 12'], ['none', 'Non notées'],
];

export function renderDegustations(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();

  container.append(el('h1', { text: 'Dégustations' }));

  if (!s.loaded) {
    container.append(el('p', { class: 'muted', text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }

  const data = s.data;
  const canWrite = s.canWrite;
  const wineById = new Map(data.wines.map((w) => [w.id, w]));
  const all = data.tastings.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!all.length) {
    container.append(el('p', { class: 'muted', text: 'Aucune dégustation enregistrée. Notez-en une après avoir bu une bouteille.' }));
    return;
  }

  // — Options de filtre, dérivées des dégustations existantes ——————————————————
  const winesWithTastings = [...new Set(all.map((t) => t.wineId))]
    .map((id) => wineById.get(id)).filter(Boolean)
    .sort((a, b) => wineLabel(a).localeCompare(wineLabel(b)));
  const annees = [...new Set(all.map((t) => (t.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();

  // — Barre de recherche + filtres (construits une seule fois) ——————————————————
  const searchInput = el('input', {
    type: 'search', class: 'search__input', value: ui.q,
    placeholder: 'Chercher : vin, commentaire, personne…', autocomplete: 'off', 'aria-label': 'Rechercher une dégustation',
  });
  searchInput.addEventListener('input', () => { ui.q = searchInput.value; renderList(); });
  container.append(el('div', { class: 'search' }, searchInput));

  const wineSel = el('select', { class: 'select', 'aria-label': 'Filtrer par vin' },
    el('option', { value: '', selected: ui.wineId === '' ? true : null }, 'Tous les vins'),
    ...winesWithTastings.map((w) => el('option', { value: w.id, selected: ui.wineId === w.id ? true : null }, wineLabel(w))));
  wineSel.addEventListener('change', () => { ui.wineId = wineSel.value; renderList(); });

  const anneeSel = el('select', { class: 'select', 'aria-label': 'Filtrer par année' },
    el('option', { value: '', selected: ui.annee === '' ? true : null }, 'Toutes les années'),
    ...annees.map((a) => el('option', { value: a, selected: ui.annee === a ? true : null }, a)));
  anneeSel.addEventListener('change', () => { ui.annee = anneeSel.value; renderList(); });

  const noteSel = el('select', { class: 'select', 'aria-label': 'Filtrer par note' },
    ...NOTE_OPTS.map(([v, label]) => el('option', { value: v, selected: ui.noteMin === v ? true : null }, label)));
  noteSel.addEventListener('change', () => { ui.noteMin = noteSel.value; renderList(); });

  container.append(el('div', { class: 'filters filters--wrap' }, wineSel, anneeSel, noteSel));

  // — Liste ————————————————————————————————————————————————————————————————————
  const countEl = el('p', { class: 'muted' });
  const listHost = el('ul', { class: 'tastings' });
  container.append(countEl, listHost);

  function renderList() {
    while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
    const q = normalise(ui.q);
    const shown = all.filter((t) => {
      if (ui.wineId && t.wineId !== ui.wineId) return false;
      if (ui.annee && (t.date || '').slice(0, 4) !== ui.annee) return false;
      if (ui.noteMin === 'none') { if (t.note != null) return false; }
      else if (ui.noteMin) { if (t.note == null || t.note < Number(ui.noteMin)) return false; }
      if (q) {
        const w = wineById.get(t.wineId);
        const hay = normalise([w ? wineLabel(w) : '', t.commentaire, t.avecQui, t.occasion].filter(Boolean).join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    countEl.textContent = `${shown.length} dégustation${shown.length > 1 ? 's' : ''}${shown.length !== all.length ? ` sur ${all.length}` : ''}.`;

    if (!shown.length) {
      listHost.append(el('li', { class: 'muted', text: 'Aucune dégustation ne correspond à ces filtres.' }));
      return;
    }
    for (const t of shown) {
      listHost.append(ui.editingId === t.id
        ? renderEditRow(ctx, t, wineById.get(t.wineId))
        : renderRow(ctx, t, wineById.get(t.wineId), canWrite, renderList));
    }
  }

  renderList();
}

// — Une ligne de dégustation ————————————————————————————————————————————————————
function renderRow(ctx, t, wine, canWrite, refresh) {
  const { el } = ctx;
  const titre = wine
    ? el('button', { class: 'btn btn--link', onclick: () => ctx.navigate(`/fiche/${wine.id}`), text: wineLabel(wine), title: 'Voir la fiche' })
    : el('span', { class: 'muted', text: 'Vin inconnu' });

  return el('li', { class: 'tasting' },
    el('div', { class: 'tasting__head' },
      el('strong', { text: t.date || '—' }),
      t.note != null ? el('span', { class: 'tag', text: `${t.note}/20` }) : el('span', { class: 'muted', text: 'sans note' }),
      titre),
    t.avecQui ? el('div', { class: 'muted', text: `avec ${t.avecQui}` }) : null,
    t.occasion ? el('div', { class: 'muted', text: t.occasion }) : null,
    t.commentaire ? el('div', { text: t.commentaire }) : null,
    t.par ? el('div', { class: 'help', text: `noté par ${t.par}` }) : null,
    canWrite
      ? el('div', { class: 'row' }, el('button', {
          class: 'btn', text: 'Modifier', onclick: () => { ui.editingId = t.id; refresh(); },
        }))
      : null);
}

// — Édition en place (UPDATE_TASTING, seulement les champs modifiés) ——————————————
function renderEditRow(ctx, t, wine) {
  const { el } = ctx;
  const dateI = el('input', { type: 'date', value: t.date || '', 'aria-label': 'Date' });
  const noteI = el('input', { type: 'number', min: '0', max: '20', step: '0.5', value: t.note ?? '', 'aria-label': 'Note sur 20' });
  const withI = el('input', { type: 'text', value: t.avecQui || '', maxlength: '200', 'aria-label': 'Avec qui' });
  const occI = el('input', { type: 'text', value: t.occasion || '', maxlength: '120', 'aria-label': 'Occasion' });
  const comI = el('textarea', { rows: '3', maxlength: '2000', 'aria-label': 'Commentaire' });
  comI.value = t.commentaire || '';

  const status = el('p', { class: 'status', text: '' });
  const btn = el('button', { class: 'btn btn--primary', text: 'Enregistrer' });

  btn.addEventListener('click', async () => {
    // Ne pousser QUE les champs réellement modifiés (dernier écrivain gagne, champ par champ).
    const num = (v) => (v === '' ? null : Number(v));
    const candidats = {
      date: dateI.value || t.date,
      note: num(noteI.value),
      avecQui: withI.value.trim() || null,
      occasion: occI.value.trim() || null,
      commentaire: comI.value.trim() || null,
    };
    const fields = {};
    for (const [k, v] of Object.entries(candidats)) {
      if (v !== (t[k] ?? null)) fields[k] = v;
    }
    if (!Object.keys(fields).length) { ui.editingId = null; ctx.onChange(); return; }

    btn.disabled = true;
    btn.textContent = 'Enregistrement…';
    status.textContent = '';
    try {
      await ctx.store.dispatch({ type: 'UPDATE_TASTING', payload: { id: t.id, fields } });
      ui.editingId = null;
      ctx.onChange();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Enregistrer';
      status.textContent = e.message || 'Enregistrement impossible.';
      status.className = 'status status--warn';
    }
  });

  return el('li', { class: 'tasting tasting--edit' },
    el('div', { class: 'tasting__head' }, el('strong', { text: wine ? wineLabel(wine) : 'Dégustation' })),
    field(el, 'Date', dateI), field(el, 'Note /20', noteI), field(el, 'Avec qui', withI),
    field(el, 'Occasion', occI), field(el, 'Commentaire', comI),
    el('div', { class: 'row' },
      btn,
      el('button', { class: 'btn', text: 'Annuler', onclick: () => { ui.editingId = null; ctx.onChange(); } })),
    status);
}

const field = (el, label, input) => el('div', { class: 'field' }, el('label', { text: label }), input);
