// views/vins.js — catalogue des vins (PRD §6.2) + formulaire d'ajout (PRD §6.3) + recalcul global
// des gardes. Remplace la coquille L0.
//
// Aucune logique métier ici : la garde vient de app/garde.js, la résolution KB de app/kb.js, et
// toute mutation passe par ctx.store.dispatch → ops.js. Les ids/ref sont alloués par l'opération
// (D9) : le formulaire ne fournit JAMAIS d'id.

import { wineLabel, matchWine, normalise } from '../format.js';
import { calculerGardeVin, statutVin, recalculerGardes } from '../garde.js';

const COULEURS = ['Rouge', 'Blanc', 'Rosé', 'Effervescent', 'Liquoreux', 'Jaune'];
const FORMATS = ['standard', 'magnum', 'demi', 'clavelin'];
const ACQ_TYPES = ['achat', 'cadeau', 'heritage', 'echange', 'production'];
const SORTS = [
  { id: 'apogee', label: 'Apogée' },
  { id: 'millesime', label: 'Millésime' },
  { id: 'producteur', label: 'Producteur' },
  { id: 'stock', label: 'Quantité' },
];

const colorSlug = (c) => normalise(c).replace(/\s+/g, '-');

// Convention de saisie d'une garde manuelle : un nombre SOUS 100 est une durée en années après
// l'année de base (le millésime, ou l'acquisition à défaut) ; à partir de 100, c'est une année.
// Sans ambiguïté possible — aucun millésime n'est inférieur à 100, aucune durée ne l'atteint — et
// c'est la forme sous laquelle les contre-étiquettes s'expriment (« 3 à 6 ans », « 2-4 »).
// Exportée pour être testable : le formulaire est du DOM, cette règle n'en est pas.
export function anneeDeGarde(valeur, base) {
  if (valeur == null || String(valeur).trim() === '') return null;
  const n = Number(valeur);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 100) return Math.round(n);
  return base == null ? null : base + Math.round(n);
}

// État de vue, persistant entre rendus (le container #view est vidé à chaque rendu).
const ui = { query: '', colorFilter: null, stock: 'stock', sort: 'producteur', mode: 'list' };

export function renderVins(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();

  if (ui.mode === 'add') return renderAddForm(container, ctx);

  container.append(el('h1', { text: 'Vins' }));

  if (!s.loaded) {
    container.append(el('p', { class: 'muted', text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }

  const data = s.data;
  const kb = ctx.kb;
  const canWrite = s.canWrite;
  const annee = new Date().getFullYear();

  // — Actions ————————————————————————————————————————————————————————————————
  const actions = el('div', { class: 'row' },
    el('button', {
      class: 'btn btn--primary', disabled: !canWrite,
      title: canWrite ? '' : 'Ajoutez un token pour ajouter un vin.',
      onclick: () => { ui.mode = 'add'; ctx.onChange(); }, text: 'Ajouter un vin',
    }),
    el('button', {
      class: 'btn', disabled: !canWrite || !kb,
      title: !kb ? 'Base de connaissances en cours de chargement…' : (canWrite ? '' : 'Ajoutez un token pour recalculer.'),
      onclick: (ev) => recalcAll(ev.currentTarget), text: 'Recalculer les gardes',
    }),
  );
  container.append(actions);

  // — Recherche ——————————————————————————————————————————————————————————————
  const searchInput = el('input', {
    type: 'search', class: 'search__input', value: ui.query,
    placeholder: 'Chercher un vin, un cépage, une appellation…', autocomplete: 'off', 'aria-label': 'Rechercher un vin',
  });
  searchInput.addEventListener('input', () => { ui.query = searchInput.value; renderList(); });
  container.append(el('div', { class: 'search' }, searchInput));

  // — Filtre en stock / archivés / tout ——————————————————————————————————————
  // Les boutons sont construits une fois ; renderList() ne re-rend que la liste. Il faut donc
  // resynchroniser l'évidence à chaque clic, sinon le bouton actif reste figé sur l'état initial.
  const stockToggle = el('div', { class: 'toggle', role: 'group', 'aria-label': 'Portée du catalogue' });
  const stockBtns = [['stock', 'En stock'], ['archive', 'Archivés'], ['tout', 'Tout']].map(([v, label]) => {
    const b = el('button', {
      class: 'toggle__btn',
      onclick: () => { ui.stock = v; syncStock(); renderList(); }, text: label,
    });
    b.dataset.val = v;
    return b;
  });
  function syncStock() {
    for (const b of stockBtns) {
      const on = b.dataset.val === ui.stock;
      b.className = on ? 'toggle__btn toggle__btn--on' : 'toggle__btn';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  stockToggle.append(...stockBtns);
  syncStock();
  container.append(stockToggle);

  // — Filtre couleur ——————————————————————————————————————————————————————————
  const presentColors = COULEURS.filter((c) => data.wines.some((w) => w.couleur === c));
  if (presentColors.length > 1) {
    // colorFilter vaut null pour « Toutes » : on garde la valeur brute (pas de dataset, qui coerce
    // en chaîne) pour comparer sans ambiguïté.
    const colorBtns = [[null, 'Toutes'], ...presentColors.map((c) => [c, c])].map(([c, label]) => {
      const b = el('button', {
        class: 'chip',
        onclick: () => { ui.colorFilter = c; syncColors(); renderList(); }, text: label,
      });
      b._val = c;
      return b;
    });
    function syncColors() {
      for (const b of colorBtns) {
        const on = b._val === ui.colorFilter;
        b.className = on ? 'chip chip--on' : 'chip';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    syncColors();
    container.append(el('div', { class: 'filters' }, ...colorBtns));
  }

  // — Tri ————————————————————————————————————————————————————————————————————
  const sortSel = el('select', { class: 'select', 'aria-label': 'Trier par' },
    ...SORTS.map((o) => el('option', { value: o.id, selected: ui.sort === o.id ? true : null }, o.label)));
  sortSel.addEventListener('change', () => { ui.sort = sortSel.value; renderList(); });
  container.append(el('div', { class: 'sortrow' }, el('span', { class: 'muted', text: 'Trier par' }), sortSel));

  // — Liste ——————————————————————————————————————————————————————————————————
  const listHost = el('div', {});
  const countEl = el('p', { class: 'muted' });
  container.append(countEl, listHost);

  const stockOf = (w) => data.bottles.filter((b) => b.wineId === w.id).length;

  function renderList() {
    while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
    let wines = data.wines.slice();

    // Portée. « En stock » = au moins une bouteille et non archivé (invariant 6 : un vin à 0
    // bouteille reste dans wines mais est masqué des vues de stock).
    if (ui.stock === 'stock') wines = wines.filter((w) => !w.archive && stockOf(w) > 0);
    else if (ui.stock === 'archive') wines = wines.filter((w) => w.archive);

    if (ui.colorFilter) wines = wines.filter((w) => w.couleur === ui.colorFilter);
    const q = ui.query.trim();
    if (q) wines = wines.filter((w) => matchWine(w, q));

    wines.sort(comparator(ui.sort, stockOf));

    countEl.textContent = `${wines.length} vin${wines.length > 1 ? 's' : ''}`;
    if (!wines.length) {
      listHost.append(el('p', { class: 'empty-state', text: 'Aucun vin ne correspond.' }));
      return;
    }

    const ul = el('ul', { class: 'wines' });
    for (const w of wines) {
      const stock = stockOf(w);
      const badge = kb ? statusBadge(el, w, data.bottles, kb, annee) : null;
      ul.append(el('li', { class: 'wine wine--link', role: 'button', tabindex: '0',
        onclick: () => ctx.navigate(`/fiche/${w.id}`),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.navigate(`/fiche/${w.id}`); } },
      },
        el('div', { class: 'wine__title', text: wineLabel(w) }),
        el('div', { class: 'wine__meta' },
          el('span', { class: 'tag', 'data-color': w.couleur, text: w.couleur }),
          w.appellation ? el('span', { text: w.appellation }) : null,
          badge,
          el('span', { class: stock ? 'muted' : 'tag tag--empty', text: stock ? `${stock} en cave` : 'épuisé' }))));
    }
    listHost.append(ul);
  }

  async function recalcAll(btn) {
    if (!kb) return;
    const updates = recalculerGardes(data, kb);
    if (!updates.length) { toast(el, 'Toutes les gardes sont déjà à jour.'); return; }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Recalcul…';
    try {
      for (const u of updates) await store.dispatch(u);
      ctx.onChange();
      toast(el, `${updates.length} garde(s) recalculée(s).`);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = original;
      toast(el, e.message || 'Recalcul interrompu.');
    }
  }

  renderList();
}

// ---------------------------------------------------------------------------
// Tri déterministe.
// ---------------------------------------------------------------------------

function comparator(sort, stockOf) {
  const num = (v) => (v == null ? -Infinity : v);
  if (sort === 'millesime') return (a, b) => num(b.millesime) - num(a.millesime) || byName(a, b);
  if (sort === 'stock') return (a, b) => stockOf(b) - stockOf(a) || byName(a, b);
  if (sort === 'apogee') {
    // Apogée CANONIQUE persistée (la fenêtre effective par bouteille ne sert qu'au statut/affichage).
    const apo = (w) => (w.apogee == null ? Infinity : w.apogee); // les gardes inconnues en fin de liste
    return (a, b) => apo(a) - apo(b) || byName(a, b);
  }
  return byName; // producteur
}
const byName = (a, b) =>
  (a.producteur || '').localeCompare(b.producteur || '', 'fr') ||
  (a.nom || '').localeCompare(b.nom || '', 'fr');

// ---------------------------------------------------------------------------
// Badge de statut de garde (libellés depuis kb.garde.statuts — jamais en dur).
// ---------------------------------------------------------------------------

export function statusBadge(el, wine, allBottles, kb, annee) {
  const st = statutVin(wine, allBottles, kb, annee);
  const flags = st.flags.filter((f) => f !== 'aBoire'); // « dans sa fenêtre » est implicite si un autre drapeau parle
  const show = flags.length ? flags : st.flags;
  const primary = show.find((f) => f === 'urgent' || f === 'apogee' || f === 'depasse' || f === 'tropJeune' || f === 'inconnu') || show[0];
  if (!primary) return null;
  const libelle = kb.garde.statuts[primary]?.libelle ?? primary;
  return el('span', { class: `tag garde garde--${primary}`, text: libelle });
}

// ---------------------------------------------------------------------------
// Formulaire d'ajout — pays → région → appellation → cépages pré-remplis → garde + mets calculés.
// ---------------------------------------------------------------------------

function renderAddForm(container, ctx) {
  const { el, store } = ctx;
  const kb = ctx.kb;
  const today = new Date().toISOString().slice(0, 10);

  container.append(
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => { ui.mode = 'list'; ctx.onChange(); }, text: '← Catalogue' })),
    el('h1', { text: 'Ajouter un vin' }),
  );

  if (!kb) {
    container.append(el('p', { class: 'muted', text: 'Base de connaissances en cours de chargement…' }));
    return;
  }

  // Champs.
  const producteur = field(el, 'Producteur', el('input', { type: 'text', maxlength: '120', placeholder: 'Domaine…' }));
  const nom = field(el, 'Cuvée / nom', el('input', { type: 'text', maxlength: '160', placeholder: 'Nom du vin' }));

  const paysSel = el('select', {}, ...['FR', 'CH', 'IT', 'XX'].map((p) => el('option', { value: p }, p)));
  const regionSel = el('select', {});
  const appSel = el('select', {});
  const appLibre = el('input', { type: 'text', maxlength: '120', placeholder: 'Appellation (hors référentiel)' });
  const couleurSel = el('select', {}, ...COULEURS.map((c) => el('option', { value: c }, c)));
  const cepagesInput = el('input', { type: 'text', maxlength: '200', placeholder: 'Pinot Noir, Gamay…' });
  const millesimeInput = el('input', { type: 'number', min: '1900', max: '2100', placeholder: 'ex. 2021 (vide = non millésimé)' });
  const prixInput = el('input', { type: 'number', min: '0', step: '0.5', placeholder: 'CHF (référence garde)' });
  const valeurInput = el('input', { type: 'number', min: '0', step: '0.5', placeholder: 'CHF (valeur cave, défaut = prix réf.)' });

  const acqType = el('select', {}, ...ACQ_TYPES.map((t) => el('option', { value: t }, t)));
  const acqDate = el('input', { type: 'date', value: today });
  const acqPrix = el('input', { type: 'number', min: '0', step: '0.5', placeholder: 'CHF payé (vide si cadeau)' });
  const acqSource = el('input', { type: 'text', maxlength: '120', placeholder: 'Caviste, domaine, ou personne…' });
  const nbInput = el('input', { type: 'number', min: '1', max: '84', value: '1' });
  const formatSel = el('select', {}, ...FORMATS.map((f) => el('option', { value: f }, f)));

  const warn = el('p', { class: 'status status--warn', text: '' });
  const gardePreview = el('div', { class: 'garde-preview' });

  // — Garde : calculée, ou saisie à la main (elle PRIME alors sur le moteur) ——————————————
  // Ce que le producteur écrit au dos (« 3 à 6 ans », « apogée durant les cinq ans ») bat tout
  // barème. Une fois en `manuel`, l'invariant 4 interdit à tout recalcul de l'écraser.
  const gardeModeSel = el('select', {},
    el('option', { value: 'auto' }, 'Calculée par le référentiel'),
    el('option', { value: 'manuel' }, 'Saisie à la main (prime sur le calcul)'));
  const anInput = (ph) => el('input', { type: 'number', min: '0', max: '2150', placeholder: ph });
  const gardeDeInput = anInput('3  ou  2029');
  const gardeApogeeInput = anInput('facultatif');
  const gardeAInput = anInput('6  ou  2032');
  const gardeManuelBloc = el('div', {},
    el('p', { class: 'help', text: 'Un nombre sous 100 est lu comme des années après le millésime (« 3 » → millésime + 3) ; au-dessus, comme une année (« 2029 »). Sans millésime, la base est la date d’acquisition.' }),
    field(el, 'Garde — début', gardeDeInput).wrap,
    field(el, 'Garde — apogée', gardeApogeeInput).wrap,
    field(el, 'Garde — fin', gardeAInput).wrap,
  );
  gardeManuelBloc.style.display = 'none';

  // Année de base des durées : le millésime, sinon l'acquisition — même règle que le moteur (§1.2).
  const anneeBase = () =>
    (millesimeInput.value ? Number(millesimeInput.value) : null)
    ?? (acqDate.value ? Number(acqDate.value.slice(0, 4)) : null);

  const resoudreAnnee = (champ) => anneeDeGarde(champ.value, anneeBase());

  const gardeManuelle = () => ({
    gardeDe: resoudreAnnee(gardeDeInput),
    apogee: resoudreAnnee(gardeApogeeInput),
    gardeA: resoudreAnnee(gardeAInput),
  });

  // — Cascade pays → région → appellation ————————————————————————————————————
  function fillRegions() {
    const pays = kb.pays.find((p) => p.code === paysSel.value);
    clearOpts(regionSel);
    regionSel.append(el('option', { value: '' }, '—'));
    for (const r of pays?.regions ?? []) regionSel.append(el('option', { value: r.id }, r.nom));
    fillAppellations();
  }
  function fillAppellations() {
    const pays = kb.pays.find((p) => p.code === paysSel.value);
    const region = pays?.regions.find((r) => r.id === regionSel.value);
    clearOpts(appSel);
    appSel.append(el('option', { value: '' }, '— (choisir, ou saisir ci-dessous) —'));
    for (const a of region?.appellations ?? []) {
      appSel.append(el('option', { value: a.id }, `${a.nom} · ${(a.couleurs || []).join('/')}`));
    }
    syncAppLibre();
  }
  const syncAppLibre = () => { appLibre.style.display = appSel.value ? 'none' : ''; };

  // Sélection d'une appellation du KB → pré-remplit couleur + cépages.
  function onPickAppellation() {
    const a = appSel.value ? kb.appellation(appSel.value) : null;
    if (a) {
      if (a.couleurs?.length) couleurSel.value = a.couleurs.includes(couleurSel.value) ? couleurSel.value : a.couleurs[0];
      cepagesInput.value = (a.cepages || []).map((id) => kb.cepage(id)?.nom || id).join(', ');
    }
    syncAppLibre();
    refreshGarde();
  }

  // — Aperçu de garde en direct (démontre : fenêtre estimée + justification avant d'enregistrer) —
  function currentDraft() {
    const { appellationId, cepageIds, cepageDominantInconnu, cepagesDisplay } = resolve();
    const millesime = millesimeInput.value ? Number(millesimeInput.value) : null;
    const prixReference = prixInput.value ? Number(prixInput.value) : null;
    return {
      id: '_draft', couleur: couleurSel.value, appellationId, cepageIds, cepageDominantInconnu,
      cepages: cepagesDisplay, millesime, prixReference,
    };
  }
  function resolve() {
    const couleur = couleurSel.value;
    const appellationId = appSel.value || kb.resolveAppellation(appLibre.value.trim(), couleur);
    const cepagesDisplay = cepagesInput.value.split(',').map((t) => t.trim()).filter(Boolean);
    const cepageIds = [];
    const unresolved = [];
    for (const label of cepagesDisplay) {
      const id = kb.resolveCepage(label);
      if (id) { if (!cepageIds.includes(id)) cepageIds.push(id); } else unresolved.push(label);
    }
    // D17 : le premier libellé saisi est le cépage dominant. S'il ne résout pas, on ne laisse PAS
    // le suivant prendre sa place — on garde les secondaires, et on le signale.
    const cepageDominantInconnu = cepagesDisplay.length > 0 && !kb.resolveCepage(cepagesDisplay[0]);
    return { appellationId, cepageIds, cepageDominantInconnu, cepagesDisplay, unresolvedCepages: unresolved };
  }
  function refreshGarde() {
    while (gardePreview.firstChild) gardePreview.removeChild(gardePreview.firstChild);
    gardeManuelBloc.style.display = gardeModeSel.value === 'manuel' ? '' : 'none';

    if (gardeModeSel.value === 'manuel') {
      const m = gardeManuelle();
      if (m.gardeDe == null || m.gardeA == null) {
        gardePreview.append(el('p', { class: 'muted', text: 'Garde : renseignez au moins le début et la fin.' }));
        return;
      }
      const apo = m.apogee != null ? ` → apogée ${m.apogee}` : '';
      gardePreview.append(
        el('div', { class: 'garde-preview__win', text: `Fenêtre retenue : ${m.gardeDe}${apo} → ${m.gardeA}` }),
        el('p', { class: 'muted garde-preview__why', text: 'Saisie à la main — le référentiel ne la recalculera jamais.' }),
      );
      return;
    }

    const draft = currentDraft();
    const bottles = [{ acquisition: { date: acqDate.value || today } }]; // pour la base d'un non millésimé
    const g = calculerGardeVin(draft, bottles, kb);
    if (!g) {
      gardePreview.append(el('p', { class: 'muted', text: 'Garde : renseignez un millésime ou une date d’acquisition.' }));
      return;
    }
    gardePreview.append(
      el('div', { class: 'garde-preview__win', text: `Fenêtre estimée : ${g.gardeDe} → apogée ${g.apogee} → ${g.gardeA}` }),
      el('p', { class: 'muted garde-preview__why', text: g.gardeExplication }),
    );
  }

  for (const node of [couleurSel, cepagesInput, millesimeInput, prixInput, acqDate,
    gardeModeSel, gardeDeInput, gardeApogeeInput, gardeAInput]) {
    node.addEventListener('input', refreshGarde);
    node.addEventListener('change', refreshGarde);
  }
  paysSel.addEventListener('change', fillRegions);
  regionSel.addEventListener('change', fillAppellations);
  appSel.addEventListener('change', onPickAppellation);

  // — Enregistrement ————————————————————————————————————————————————————————
  const saveBtn = el('button', { class: 'btn btn--primary', text: 'Ajouter le vin' });
  saveBtn.addEventListener('click', () => submit(saveBtn));

  async function submit(btn) {
    warn.textContent = '';
    if (!producteur.input.value.trim()) { warn.textContent = 'Le producteur est requis.'; return; }
    const { appellationId, cepageIds, cepageDominantInconnu, cepagesDisplay, unresolvedCepages } = resolve();

    const appText = appSel.value ? kb.appellation(appSel.value)?.nom : (appLibre.value.trim() || null);
    const millesime = millesimeInput.value ? Number(millesimeInput.value) : null;
    const prixReference = prixInput.value ? Number(prixInput.value) : null;
    const valeur = valeurInput.value ? Number(valeurInput.value) : (prixReference ?? null);
    const region = kb.pays.find((p) => p.code === paysSel.value)?.regions.find((r) => r.id === regionSel.value)?.nom ?? null;

    const wineProto = {
      producteur: producteur.input.value.trim(),
      nom: nom.input.value.trim(),
      pays: paysSel.value, region,
      appellation: appText, appellationId,
      sousRegion: null, couleur: couleurSel.value, millesime,
      cepages: cepagesDisplay, cepageIds, cepageDominantInconnu,
      prixReference, valeur,
    };

    // Garde. Une fenêtre saisie à la main PRIME sur le moteur : on ne calcule même pas, et
    // `gardeSource: "manuel"` la met hors d'atteinte de tout recalcul ultérieur (invariant 4).
    const bottleDate = acqDate.value || today;
    let gardeFields;
    if (gardeModeSel.value === 'manuel') {
      const m = gardeManuelle();
      if (m.gardeDe == null || m.gardeA == null) {
        warn.textContent = 'Garde saisie à la main : le début et la fin sont requis.'; return;
      }
      if (m.gardeA < m.gardeDe) {
        warn.textContent = 'Garde saisie à la main : la fin ne peut pas précéder le début.'; return;
      }
      if (m.apogee != null && (m.apogee < m.gardeDe || m.apogee > m.gardeA)) {
        warn.textContent = 'Garde saisie à la main : l’apogée doit tomber dans la fenêtre.'; return;
      }
      gardeFields = { ...m, gardeSource: 'manuel', gardeExplication: 'Fenêtre saisie à la main.' };
    } else {
      const g = calculerGardeVin({ ...wineProto, id: '_draft' }, [{ acquisition: { date: bottleDate } }], kb);
      gardeFields = g
        ? { gardeDe: g.gardeDe, gardeA: g.gardeA, apogee: g.apogee, gardeExplication: g.gardeExplication, gardeSource: 'auto' }
        : { gardeDe: null, gardeA: null, apogee: null, gardeExplication: null, gardeSource: 'auto' };
    }
    const mets = kb.metsUnionKb(wineProto);

    // Acquisition par défaut, appliquée aux N bouteilles (éditable ensuite bouteille par bouteille).
    const acquisition = {
      type: acqType.value,
      source: acqSource.value.trim() || null,
      occasion: null,
      date: bottleDate,
      prix: acqType.value === 'achat' && acqPrix.value ? Number(acqPrix.value) : (acqPrix.value ? Number(acqPrix.value) : null),
      note: null,
    };
    const n = Math.max(1, Math.min(84, Number(nbInput.value) || 1));
    const bottles = Array.from({ length: n }, () => ({ format: formatSel.value, acquisition }));

    btn.disabled = true;
    btn.textContent = 'Ajout…';
    try {
      const res = await store.dispatch({ type: 'ADD_WINE', payload: { ...wineProto, ...gardeFields, mets, metsSource: 'auto' } });
      const wineId = res.ids.wineId;
      await store.dispatch({ type: 'ADD_BOTTLES', payload: { wineId, bottles } });
      ui.mode = 'list';
      if (unresolvedCepages.length) {
        // Saisie acceptée même en cas d'échec de résolution (D6) : on prévient après coup.
        // Le dominant non reconnu n'est pas un détail : c'est lui qui décidait de la garde (D17).
        toast(el, cepageDominantInconnu
          ? `Vin ajouté. Cépage dominant non reconnu (${cepagesDisplay[0]}) : garde et service estimés depuis la couleur.`
          : `Vin ajouté. Cépage(s) non reconnu(s) du KB : ${unresolvedCepages.join(', ')}.`);
      }
      ctx.navigate(`/fiche/${wineId}`);
      ctx.onChange();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Ajouter le vin';
      warn.textContent = e.message || 'Ajout impossible.';
    }
  }

  const card = el('section', { class: 'card' },
    producteur.wrap, nom.wrap,
    field(el, 'Pays', paysSel).wrap,
    field(el, 'Région', regionSel).wrap,
    field(el, 'Appellation', appSel).wrap,
    appLibre,
    field(el, 'Couleur', couleurSel).wrap,
    field(el, 'Cépages (le dominant en premier)', cepagesInput).wrap,
    field(el, 'Millésime', millesimeInput).wrap,
    field(el, 'Prix de référence', prixInput).wrap,
    field(el, 'Valeur (cave)', valeurInput).wrap,
    field(el, 'Garde', gardeModeSel).wrap,
    gardeManuelBloc,
    gardePreview,
    el('h3', { text: 'Acquisition (appliquée à toutes les bouteilles)' }),
    field(el, 'Type', acqType).wrap,
    field(el, 'Date', acqDate).wrap,
    field(el, 'Prix payé', acqPrix).wrap,
    field(el, 'Provenance (caviste / personne)', acqSource).wrap,
    field(el, 'Nombre de bouteilles', nbInput).wrap,
    field(el, 'Format', formatSel).wrap,
    warn,
    el('div', { class: 'row' }, saveBtn,
      el('button', { class: 'btn', onclick: () => { ui.mode = 'list'; ctx.onChange(); }, text: 'Annuler' })),
    el('p', { class: 'help', text: 'Les bouteilles arrivent « à ranger » : placez-les depuis le Plan.' }),
  );
  container.append(card);

  fillRegions();
  refreshGarde();
}

// ---------------------------------------------------------------------------
// Petits helpers de vue.
// ---------------------------------------------------------------------------

function field(el, label, input) {
  const wrap = el('div', { class: 'field' }, el('label', { text: label }), input);
  return { wrap, input };
}
const clearOpts = (sel) => { while (sel.firstChild) sel.removeChild(sel.firstChild); };

function toast(el, message) {
  const t = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('toast--on'));
  setTimeout(() => { t.classList.remove('toast--on'); setTimeout(() => t.remove(), 250); }, 2800);
}
