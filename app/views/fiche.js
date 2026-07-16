// views/fiche.js — fiche vin (PRD §6.3). Route #/fiche/<wineId>.
//
// Frise de garde (gardeDe → apogée → gardeA) + phrase d'explication ; recalcul et correction
// manuelle (invariant 4) ; chips mets ; bouteilles avec leur fenêtre EFFECTIVE si elle diffère de
// la canonique (magnum, vin non millésimé) ; dégustations ; édition en place.
//
// La garde vient de app/garde.js, la résolution KB de app/kb.js. Toute mutation → ops.js.
// Le service (température/carafage/verre) relève du moteur d'accords : lot L4.

import { slotLabel, normalise } from '../format.js';
import { calculerGardeVin, gardeEffective, statutVin, statutsGarde } from '../garde.js';
import { serviceVin, metsAutomatiques } from '../accords.js';

const colorSlug = (c) => normalise(c).replace(/\s+/g, '-');

export function renderFiche(container, ctx, wineId) {
  const { el, store } = ctx;
  const s = store.getState();
  const kb = ctx.kb;

  container.append(el('div', { class: 'row' },
    el('button', { class: 'btn', onclick: () => ctx.navigate('/vins'), text: '← Vins' })));

  if (!s.loaded) {
    container.append(el('p', { class: 'muted', text: s.loadError ? '' : 'Chargement de la cave…' }));
    return;
  }

  const data = s.data;
  const wine = data.wines.find((w) => w.id === wineId);
  if (!wine) {
    container.append(el('p', { class: 'empty-state', text: 'Ce vin n’existe pas (ou plus).' }));
    return;
  }

  const canWrite = s.canWrite;
  const annee = new Date().getFullYear();
  const bottles = data.bottles.filter((b) => b.wineId === wine.id);
  const tastings = data.tastings
    .filter((t) => t.wineId === wine.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // — Identité ——————————————————————————————————————————————————————————————
  const dot = el('span', { class: 'sheet__dot fiche__dot' });
  dot.style.background = `var(--wine-${colorSlug(wine.couleur)})`;
  const lieu = [wine.pays, wine.region, wine.appellation, wine.sousRegion].filter(Boolean).join(' · ');
  container.append(el('div', { class: 'fiche__head' },
    dot,
    el('div', {},
      el('div', { class: 'sheet__prod muted', text: wine.producteur || '' }),
      el('h1', { class: 'fiche__nom', text: `${wine.nom || '—'}${wine.millesime ? ` ${wine.millesime}` : ''}` }),
      el('div', { class: 'muted', text: lieu }),
      wine.cepages?.length ? el('div', { class: 'muted', text: wine.cepages.join(', ') }) : null,
      el('div', { class: 'fiche__tags' },
        el('span', { class: 'tag', text: wine.couleur }),
        wine.note != null ? el('span', { class: 'tag', text: `${wine.note}/20` }) : null,
        wine.archive ? el('span', { class: 'tag tag--empty', text: 'archivé' }) : null,
        el('span', { class: bottles.length ? 'muted' : 'tag tag--empty', text: bottles.length ? `${bottles.length} en cave` : 'épuisé' })))));

  // — Garde ——————————————————————————————————————————————————————————————————
  container.append(renderGarde(ctx, wine, bottles, kb, annee, canWrite));

  // — Accords & service — sens inverse vin → mets (SPEC_MOTEURS §2). ————————————
  if (kb && kb.accords) container.append(renderAccordsFiche(ctx, wine, kb));

  // — Bouteilles ——————————————————————————————————————————————————————————————
  container.append(renderBottles(ctx, wine, bottles, kb, annee, canWrite));

  // — Dégustations ————————————————————————————————————————————————————————————
  container.append(renderTastings(el, tastings));

  // — Commentaire + édition ——————————————————————————————————————————————————
  if (wine.commentaire) {
    container.append(el('section', { class: 'card' },
      el('h2', { text: 'Commentaire' }), el('p', { text: wine.commentaire })));
  }
  container.append(renderEdit(ctx, wine, canWrite));
}

// ---------------------------------------------------------------------------
// Bloc garde : frise + explication + drapeaux + Recalculer / Corriger.
// ---------------------------------------------------------------------------

function renderGarde(ctx, wine, bottles, kb, annee, canWrite) {
  const { el, store } = ctx;
  const card = el('section', { class: 'card' }, el('h2', { text: 'Garde' }));

  const st = kb ? statutVin(wine, bottles, kb, annee) : { flags: statutsGarde(wine, annee) };
  const flags = st.flags;
  const canon = { gardeDe: wine.gardeDe, gardeA: wine.gardeA, apogee: wine.apogee };

  // Frise gardeDe → apogée → gardeA avec curseur « aujourd'hui ».
  if (wine.gardeDe != null && wine.gardeA != null) {
    card.append(frise(el, canon, annee));
  } else {
    card.append(el('p', { class: 'muted', text: 'Fenêtre de garde inconnue.' }));
  }

  // Drapeaux (tous affichés — un vin peut être « à l'apogée, et la fenêtre se ferme »).
  if (kb && flags.length) {
    card.append(el('div', { class: 'fiche__flags' },
      ...flags.map((f) => el('span', { class: `tag garde garde--${f}`, text: kb.garde.statuts[f]?.libelle ?? f }))));
  }

  // Explication + source.
  if (wine.gardeExplication) {
    card.append(el('p', { class: 'muted garde-preview__why', text: wine.gardeExplication }));
  }
  card.append(el('p', { class: 'help', text: `Source : ${wine.gardeSource === 'manuel' ? 'corrigée à la main' : 'estimée automatiquement'}.` }));

  // Actions.
  const status = el('p', { class: 'status', text: '' });
  const recalc = el('button', {
    class: 'btn', disabled: !canWrite || !kb,
    title: !kb ? 'KB en cours de chargement…' : (canWrite ? '' : 'Token requis.'),
    text: 'Recalculer',
  });
  recalc.addEventListener('click', async () => {
    if (!kb) return;
    const g = calculerGardeVin(wine, bottles, kb);
    const fields = g
      ? { gardeDe: g.gardeDe, gardeA: g.gardeA, apogee: g.apogee, gardeExplication: g.gardeExplication, gardeSource: 'auto' }
      : { gardeDe: null, gardeA: null, apogee: null, gardeExplication: null, gardeSource: 'auto' };
    await save(ctx, wine.id, fields, recalc, status, 'Garde recalculée.');
  });

  const correct = el('button', { class: 'btn', disabled: !canWrite, text: 'Corriger à la main' });
  const editZone = el('div', {});
  correct.addEventListener('click', () => {
    while (editZone.firstChild) editZone.removeChild(editZone.firstChild);
    const deI = el('input', { type: 'number', min: '1900', max: '2150', value: wine.gardeDe ?? '', placeholder: 'de' });
    const apI = el('input', { type: 'number', min: '1900', max: '2150', value: wine.apogee ?? '', placeholder: 'apogée' });
    const aI = el('input', { type: 'number', min: '1900', max: '2150', value: wine.gardeA ?? '', placeholder: 'à' });
    const num = (v) => (v === '' ? null : Number(v));
    const okBtn = el('button', { class: 'btn btn--primary', text: 'Enregistrer' });
    okBtn.addEventListener('click', async () => {
      const fields = {
        gardeDe: num(deI.value), apogee: num(apI.value), gardeA: num(aI.value),
        gardeSource: 'manuel',
        gardeExplication: 'Fenêtre corrigée à la main.',
      };
      await save(ctx, wine.id, fields, okBtn, status, 'Garde corrigée (elle résistera au recalcul global).');
    });
    editZone.append(
      el('div', { class: 'garde-edit' },
        labelled(el, 'De', deI), labelled(el, 'Apogée', apI), labelled(el, 'À', aI)),
      el('div', { class: 'row' }, okBtn,
        el('button', { class: 'btn', onclick: () => { while (editZone.firstChild) editZone.removeChild(editZone.firstChild); }, text: 'Annuler' })),
      el('p', { class: 'help', text: 'Une garde corrigée à la main (source « manuel ») n’est jamais écrasée par « Recalculer les gardes ».' }),
    );
  });

  card.append(el('div', { class: 'row' }, recalc, correct), status, editZone);
  return card;
}

// Frise horizontale. Positions par interpolation linéaire entre gardeDe et gardeA.
function frise(el, { gardeDe, gardeA, apogee }, annee) {
  const span = Math.max(1, gardeA - gardeDe);
  const pct = (y) => Math.max(0, Math.min(100, ((y - gardeDe) / span) * 100));
  const bar = el('div', { class: 'frise__bar' });
  if (apogee != null) bar.append(el('span', { class: 'frise__apogee', style: `left:${pct(apogee)}%` }));
  const todayIn = annee >= gardeDe && annee <= gardeA;
  bar.append(el('span', {
    class: `frise__today${todayIn ? '' : ' frise__today--out'}`,
    style: `left:${pct(annee)}%`, title: `aujourd'hui (${annee})`,
  }));
  return el('div', { class: 'frise' },
    bar,
    el('div', { class: 'frise__scale' },
      el('span', { text: String(gardeDe) }),
      apogee != null ? el('span', { class: 'frise__scale-apo', text: `apogée ${apogee}` }) : null,
      el('span', { text: String(gardeA) })),
    el('div', { class: 'frise__now muted', text: todayIn ? `aujourd'hui : ${annee}, dans la fenêtre` : `aujourd'hui : ${annee}` }));
}

// ---------------------------------------------------------------------------
// Accords & service (vin → mets). Chips = connaissance EXPLICITE du KB (metsAutomatiques, filtrée
// par les anti-règles) quand metsSource = auto ; une sélection « manuel » est affichée telle quelle
// (invariant 4). Le service vient de la cascade de accords.js. Écran complet : #/accords.
// ---------------------------------------------------------------------------

function renderAccordsFiche(ctx, wine, kb) {
  const { el } = ctx;
  const card = el('section', { class: 'card' }, el('h2', { text: 'Accords & service' }));

  const mets = wine.metsSource === 'manuel' ? (wine.mets ?? []) : metsAutomatiques(wine, kb);
  if (mets.length) {
    card.append(el('div', { class: 'chips chips--static' },
      ...mets.map((id) => el('span', { class: 'chip chip--static', text: kb.platLabel(id) }))));
  } else {
    card.append(el('p', { class: 'muted', text: 'Aucun accord établi depuis le référentiel.' }));
  }

  const svc = serviceVin(wine, kb);
  const bits = [];
  if (Array.isArray(svc.tempC)) bits.push(`${svc.tempC[0]}–${svc.tempC[1]} °C`);
  bits.push(svc.carafage ? `carafage ${svc.carafage}` : 'sans carafage');
  if (svc.verre) bits.push(`verre ${svc.verre}`);
  card.append(el('p', { class: 'muted', text: `Service : ${bits.join(' · ')}` }));

  card.append(el('p', { class: 'help', text: 'Quel plat, quels vins de la cave : écran Accords.' }));
  return card;
}

// ---------------------------------------------------------------------------
// Bouteilles : emplacement (→ plan), format, fenêtre effective si ≠ canonique, provenance.
// ---------------------------------------------------------------------------

function renderBottles(ctx, wine, bottles, kb, annee, canWrite) {
  const { el, store } = ctx;
  const card = el('section', { class: 'card' }, el('h2', { text: `Bouteilles (${bottles.length})` }));
  if (!bottles.length) {
    card.append(el('p', { class: 'muted', text: 'Aucune bouteille en cave. Le vin reste au catalogue pour l’historique.' }));
    return card;
  }

  const canon = { gardeDe: wine.gardeDe, gardeA: wine.gardeA, apogee: wine.apogee };
  for (const b of bottles) {
    const eff = kb ? gardeEffective(wine, b, kb) : null;
    const differs = eff && (eff.gardeDe !== canon.gardeDe || eff.gardeA !== canon.gardeA || eff.apogee !== canon.apogee);
    const flags = eff ? statutsGarde(eff, annee) : [];

    const addr = b.slot
      ? el('button', { class: 'btn btn--link', onclick: () => ctx.navigate('/plan'),
          text: slotLabel(b.slot), title: 'Voir sur le plan' })
      : el('span', { class: 'tag tag--empty', text: 'à ranger' });

    const line = el('div', { class: 'bottle' },
      el('div', { class: 'bottle__main' },
        el('span', { class: 'bottle__fmt', text: b.format }),
        addr,
        ...(kb ? flags.map((f) => el('span', { class: `tag garde garde--${f}`, text: kb.garde.statuts[f]?.libelle ?? f })) : [])),
      differs
        ? el('div', { class: 'muted bottle__eff', text:
            `Fenêtre de cette bouteille : ${eff.gardeDe ?? '—'} → ${eff.apogee ?? '—'} → ${eff.gardeA ?? '—'}${eff.mention ? ` · ${eff.mention}` : ''}` })
        : null,
      provenance(el, b),
      canWrite
        ? el('div', { class: 'row' },
            el('button', { class: 'btn', onclick: (ev) => drink(ctx, b, ev.currentTarget), text: 'Boire' }),
            el('button', { class: 'btn', onclick: () => ctx.navigate('/plan'), text: 'Déplacer' }))
        : null,
    );
    card.append(line);
  }
  return card;
}

async function drink(ctx, bottle, btn) {
  btn.disabled = true;
  btn.textContent = 'Ouverture…';
  try {
    await ctx.store.dispatch({ type: 'DRINK_BOTTLE', payload: { bottleId: bottle.id } });
    ctx.onChange();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Boire';
    toast(ctx.el, e.message || 'Impossible de boire cette bouteille.');
  }
}

function provenance(el, b) {
  const a = b.acquisition;
  if (!a) return null;
  let txt = '';
  if (a.type === 'cadeau') txt = `Offert par ${a.source || '—'}${a.occasion ? ` · ${a.occasion}` : ''}`;
  else if (a.type === 'heritage') txt = `Héritage — ${a.source || '—'}`;
  else txt = `${a.type}${a.source ? ` · ${a.source}` : ''}${a.prix != null ? ` · ${a.prix} CHF` : ''}`;
  if (a.date) txt += ` · ${a.date}`;
  return el('div', { class: 'muted bottle__prov', text: txt });
}

// ---------------------------------------------------------------------------
// Dégustations.
// ---------------------------------------------------------------------------

function renderTastings(el, tastings) {
  const card = el('section', { class: 'card' }, el('h2', { text: `Dégustations (${tastings.length})` }));
  if (!tastings.length) {
    card.append(el('p', { class: 'muted', text: 'Aucune dégustation enregistrée.' }));
    return card;
  }
  const ul = el('ul', { class: 'tastings' });
  for (const t of tastings) {
    ul.append(el('li', { class: 'tasting' },
      el('div', { class: 'tasting__head' },
        el('strong', { text: t.date || '—' }),
        t.note != null ? el('span', { class: 'tag', text: `${t.note}/20` }) : null,
        t.avecQui ? el('span', { class: 'muted', text: `avec ${t.avecQui}` }) : null),
      t.commentaire ? el('div', { class: 'muted', text: t.commentaire }) : null,
      t.par ? el('div', { class: 'help', text: `noté par ${t.par}` }) : null));
  }
  card.append(ul);
  return card;
}

// ---------------------------------------------------------------------------
// Édition en place de l'identité / note / commentaire (UPDATE_WINE, champ par champ).
// ---------------------------------------------------------------------------

function renderEdit(ctx, wine, canWrite) {
  const { el } = ctx;
  const card = el('section', { class: 'card' }, el('h2', { text: 'Modifier' }));
  if (!canWrite) {
    card.append(el('p', { class: 'muted', text: 'Ajoutez un token dans Réglages pour modifier ce vin.' }));
    return card;
  }
  const prod = el('input', { type: 'text', value: wine.producteur || '', maxlength: '120' });
  const nom = el('input', { type: 'text', value: wine.nom || '', maxlength: '160' });
  const mill = el('input', { type: 'number', min: '1900', max: '2100', value: wine.millesime ?? '' });
  const note = el('input', { type: 'number', min: '0', max: '20', step: '0.5', value: wine.note ?? '' });
  const prix = el('input', { type: 'number', min: '0', step: '0.5', value: wine.prixReference ?? '' });
  const valeur = el('input', { type: 'number', min: '0', step: '0.5', value: wine.valeur ?? '' });
  const comment = el('textarea', { maxlength: '1000', rows: '3' });
  comment.value = wine.commentaire || '';
  const archive = el('input', { type: 'checkbox' });
  if (wine.archive) archive.checked = true;

  const status = el('p', { class: 'status', text: '' });
  const btn = el('button', { class: 'btn btn--primary', text: 'Enregistrer' });
  btn.addEventListener('click', async () => {
    const num = (v) => (v === '' ? null : Number(v));
    const fields = {
      producteur: prod.value.trim() || wine.producteur, nom: nom.value.trim(),
      millesime: num(mill.value), note: num(note.value),
      prixReference: num(prix.value), valeur: num(valeur.value),
      commentaire: comment.value.trim() || null, archive: archive.checked,
    };
    await save(ctx, wine.id, fields, btn, status, 'Vin mis à jour.');
  });

  card.append(
    labelled(el, 'Producteur', prod), labelled(el, 'Cuvée', nom), labelled(el, 'Millésime', mill),
    labelled(el, 'Note /20', note), labelled(el, 'Prix de référence', prix), labelled(el, 'Valeur', valeur),
    labelled(el, 'Commentaire', comment),
    el('label', { class: 'check' }, archive, ' Archiver (ne rachètera pas — masqué du stock)'),
    el('div', { class: 'row' }, btn), status,
    el('p', { class: 'help', text: 'La modification n’écrase que les champs édités (dernier écrivain gagne, champ par champ).' }),
  );
  return card;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function save(ctx, id, fields, btn, status, okMsg) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Enregistrement…';
  status.textContent = '';
  try {
    await ctx.store.dispatch({ type: 'UPDATE_WINE', payload: { id, fields } });
    ctx.onChange(); // re-rend la fiche avec les nouvelles valeurs
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    status.textContent = e.message || 'Enregistrement impossible.';
    status.className = 'status status--warn';
  }
}

function labelled(el, label, input) {
  return el('div', { class: 'field' }, el('label', { text: label }), input);
}

function toast(el, message) {
  const t = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('toast--on'));
  setTimeout(() => { t.classList.remove('toast--on'); setTimeout(() => t.remove(), 250); }, 2800);
}
