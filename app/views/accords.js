// views/accords.js — écran Accords, mets → vin (PRD §6.5). Route #/accords. La fonctionnalité phare.
//
// Grille de plats (kb/accords.json > plats), un tap → les vins EN CAVE triés par score, chacun avec
// son EMPLACEMENT, son statut de garde, la température, le carafage, le verre, et LA RAISON. Si aucun
// vin n'atteint le seuil : les meilleurs candidats sous un intitulé honnête (repli).
//
// Tout le calcul vient de app/accords.js — aucune règle métier ici. Les champs libres (producteur,
// cuvée) passent par le helper `el` (textContent), jamais innerHTML.

import { wineLabel, slotLabel, normalise } from '../format.js';
import { accordsPourPlat } from '../accords.js';

const colorSlug = (couleur) => normalise(couleur).replace(/\s+/g, '-');
const COULEURS = ['Rouge', 'Blanc', 'Rosé', 'Effervescent', 'Liquoreux', 'Jaune'];

// État de l'écran (persiste entre les rendus) : plat choisi et filtres.
const ui = { platId: null, colorFilter: null, dansFenetre: false };

export function renderAccords(container, ctx) {
  const { el, store } = ctx;
  const s = store.getState();
  const kb = ctx.kb;

  container.append(el('h1', { text: 'Accords' }));

  if (!s.loaded) {
    container.append(el('p', { class: 'muted', text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }
  if (!kb || !kb.accords) {
    container.append(el('p', { class: 'muted', text: 'Base de connaissances en cours de chargement…' }));
    return;
  }

  container.append(renderGrillePlats(ctx, kb));

  if (!ui.platId) {
    container.append(el('p', { class: 'help', text: 'Touchez un plat pour voir quels vins de la cave l’accompagnent.' }));
    return;
  }

  container.append(renderResultats(ctx, kb, s.data));
}

// ---------------------------------------------------------------------------
// Grille de plats, groupée par famille. Boutons ≥ 44 px (cible d'action).
// ---------------------------------------------------------------------------

function renderGrillePlats(ctx, kb) {
  const { el } = ctx;
  const wrap = el('section', { class: 'plats' });

  const familles = [];
  const parFamille = new Map();
  for (const p of kb.accords.plats) {
    const f = p.famille || 'Autres';
    if (!parFamille.has(f)) { parFamille.set(f, []); familles.push(f); }
    parFamille.get(f).push(p);
  }

  for (const f of familles) {
    wrap.append(el('h2', { class: 'famille', text: f }));
    const row = el('div', { class: 'plats__row' });
    for (const p of parFamille.get(f)) {
      row.append(el('button', {
        class: ui.platId === p.id ? 'plat plat--on' : 'plat',
        'aria-pressed': ui.platId === p.id ? 'true' : 'false',
        onclick: () => { ui.platId = ui.platId === p.id ? null : p.id; ctx.onChange(); },
        text: p.nom,
      }));
    }
    wrap.append(row);
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Résultats pour le plat choisi : filtres + liste (établis, sinon repli étiqueté).
// ---------------------------------------------------------------------------

function renderResultats(ctx, kb, data) {
  const { el } = ctx;
  const annee = new Date().getFullYear();
  const plat = kb.plat(ui.platId);
  const res = accordsPourPlat(data, ui.platId, kb, annee);

  const section = el('section', { class: 'card' });
  section.append(el('h2', { text: `Pour : ${plat?.nom ?? ui.platId}` }));

  // — Filtres (couleur + « dans leur fenêtre ») ——————————————————————————————
  const tous = [...res.etablis, ...res.repli];
  const present = COULEURS.filter((c) => tous.some((e) => e.wine.couleur === c));
  const filtres = el('div', { class: 'filters' });
  if (present.length > 1) {
    const chip = (c, label) => el('button', {
      class: ui.colorFilter === c ? 'chip chip--on' : 'chip',
      'aria-pressed': ui.colorFilter === c ? 'true' : 'false',
      onclick: () => { ui.colorFilter = c; ctx.onChange(); }, text: label,
    });
    filtres.append(chip(null, 'Toutes'), ...present.map((c) => chip(c, c)));
  }
  filtres.append(el('button', {
    class: ui.dansFenetre ? 'chip chip--on' : 'chip',
    'aria-pressed': ui.dansFenetre ? 'true' : 'false',
    onclick: () => { ui.dansFenetre = !ui.dansFenetre; ctx.onChange(); },
    text: 'Dans leur fenêtre',
  }));
  if (filtres.childNodes.length) section.append(filtres);

  const garder = (e) =>
    (!ui.colorFilter || e.wine.couleur === ui.colorFilter) &&
    (!ui.dansFenetre || e.flags.includes('aBoire'));

  const etablis = res.etablis.filter(garder);
  const repli = res.repli.filter(garder);

  if (etablis.length) {
    const ul = el('ul', { class: 'accords' });
    for (const e of etablis) ul.append(ligne(ctx, kb, e));
    section.append(ul);
  } else if (repli.length) {
    section.append(el('p', { class: 'help', text: kb.accords.repli.intitule }));
    const ul = el('ul', { class: 'accords' });
    for (const e of repli) ul.append(ligne(ctx, kb, e));
    section.append(ul);
  } else {
    const raison = (res.etablis.length || res.repli.length)
      ? 'Aucun vin ne correspond à ces filtres.'
      : 'Aucun vin en cave pour cet accord.';
    section.append(el('p', { class: 'muted', text: raison }));
  }
  return section;
}

// ---------------------------------------------------------------------------
// Une suggestion : vin, emplacement (→ plan), garde, service, raison.
// ---------------------------------------------------------------------------

function ligne(ctx, kb, e) {
  const { el } = ctx;
  const w = e.wine;

  const dot = el('span', { class: 'sheet__dot accord__dot' });
  dot.style.background = `var(--wine-${colorSlug(w.couleur)})`;

  const addr = e.emplacement
    ? el('button', { class: 'btn btn--link', onclick: () => ctx.navigate('/plan'), text: slotLabel(e.emplacement), title: 'Voir sur le plan' })
    : el('span', { class: 'tag tag--empty', text: 'à ranger' });

  const autres = e.nbBouteilles > 1 ? el('span', { class: 'muted', text: `+${e.nbBouteilles - 1}` }) : null;

  return el('li', { class: 'accord', role: 'button', tabindex: '0',
    onclick: () => ctx.navigate(`/fiche/${w.id}`),
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ctx.navigate(`/fiche/${w.id}`); } },
  },
    el('div', { class: 'accord__head' },
      dot,
      el('span', { class: 'accord__nom', text: wineLabel(w) }),
      el('span', { class: 'tag', text: w.couleur }),
      el('span', { class: 'muted accord__score', text: String(e.score) })),
    el('div', { class: 'accord__meta' },
      addr, autres,
      ...e.flags.map((f) => el('span', { class: `tag garde garde--${f}`, text: kb.garde.statuts[f]?.libelle ?? f }))),
    serviceLigne(el, e.service),
    e.raison ? el('div', { class: 'muted accord__why', text: e.raisons.join(' · ') }) : null,
  );
}

// Ligne de service : température, carafage, verre. Cascade déjà résolue par accords.js.
function serviceLigne(el, svc) {
  if (!svc) return null;
  const bits = [];
  if (Array.isArray(svc.tempC)) bits.push(`${svc.tempC[0]}–${svc.tempC[1]} °C`);
  bits.push(svc.carafage ? `carafage ${svc.carafage}` : 'sans carafage');
  if (svc.verre) bits.push(`verre ${svc.verre}`);
  return el('div', { class: 'muted accord__svc', text: bits.join(' · ') });
}
