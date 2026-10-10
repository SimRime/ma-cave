// garde.js — moteur de garde. Implémente docs/SPEC_MOTEURS.md §1, et RIEN d'autre.
//
// Toutes les valeurs (tiers, durées, seuils de prix, facteurs de format, défauts par couleur,
// facteurs d'accord) vivent dans kb/garde.json, passé ici via `kb.garde`. AUCUN barème, aucun
// seuil, aucun facteur n'est écrit en dur (CLAUDE.md § « Données vs connaissance »).
//
// Deux fonctions, une seule persistée (D3) :
//   calculerGardeVin(wine, bottles, kb) → { gardeDe, gardeA, apogee, gardeExplication } | null
//       Fenêtre CANONIQUE (format standard). La SEULE valeur écrite dans data.json.
//   gardeEffective(wine, bottle, kb)    → { gardeDe, gardeA, apogee, mention }
//       Fenêtre de CETTE bouteille (applique le format, recale sur l'acquisition si non millésimé).
//       JAMAIS persistée — recalculée à l'affichage.
//
// Les moteurs lisent wine.appellationId / wine.cepageIds — jamais le texte libre (D6).

const yearOf = (dateStr) => {
  if (!dateStr) return null;
  const y = parseInt(String(dateStr).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

// ---------------------------------------------------------------------------
// Étape 1 — Résoudre le tier (cascade, premier trouvé gagne).
// ---------------------------------------------------------------------------

function resoudreTier(wine, kb) {
  const app = wine.appellationId ? kb.appellation(wine.appellationId) : null;
  if (app && app.tierGarde) {
    return { tier: app.tierGarde, source: 'appellation', nom: app.nom };
  }
  // Appellation résolue mais SANS tier : régionale ou vin de pays, trop large pour discriminer
  // (D16). La cascade continue — le cépage en sait davantage — mais on retient son nom : dire
  // « appellation inconnue du référentiel » serait faux, elle est connue et délibérément muette.
  const appSansTier = app ? app.nom : null;

  // D17 : un cépage secondaire ne gouverne jamais. Si le dominant n'a pas été reconnu à la
  // saisie, l'étape 2 est sautée — sans quoi un Navarra se garderait comme son Merlot d'appoint.
  const cepId = wine.cepageDominantInconnu ? null : wine.cepageIds?.[0];
  const cep = cepId ? kb.cepage(cepId) : null;
  if (cep && cep.tierGarde) {
    return { tier: cep.tierGarde, source: 'cepage', nom: cep.nom, appSansTier };
  }
  const parCouleur = kb.garde.defautParCouleur?.[wine.couleur];
  if (parCouleur) {
    return { tier: parCouleur, source: 'couleur', nom: wine.couleur, appSansTier };
  }
  return null; // couleur hors référentiel (ne devrait pas arriver : enum du schéma)
}

// ---------------------------------------------------------------------------
// Étape 2 — Modificateur de prix (décalage borné du tier).
// Base = wine.prixReference UNIQUEMENT (jamais acquisition.prix). null → aucun modificateur.
// ---------------------------------------------------------------------------

function modifPrix(tier, prixReference, garde) {
  const ordre = garde.ordreTiers;
  const idx = ordre.indexOf(tier);
  const p = garde.modificateurs.prix;
  let shift = 0;
  if (prixReference != null) {
    // Premier palier dont le prix est STRICTEMENT inférieur à la borne, ou le palier terminal
    // (jusquA: null). Les bornes vivent dans kb/garde.json, jamais ici.
    const palier = p.paliers.find((x) => x.jusquA == null || prixReference < x.jusquA);
    shift = palier?.decalageTier ?? 0;
  }
  const bornedIdx = Math.max(0, Math.min(ordre.length - 1, idx + shift));
  return { tier: ordre[bornedIdx], shift: bornedIdx - idx }; // shift EFFECTIF après bornage
}

// Tier EFFECTIF du vin (cascade + modificateur de prix borné), ou null si la couleur est hors
// référentiel. Exposé pour app/accords.js (cascade de service §2.3, carafage par tier) : la
// résolution du tier reste écrite UNE SEULE FOIS ici (CLAUDE.md « Un seul endroit »).
export function tierEffectif(wine, kb) {
  const ctx = resoudreTier(wine, kb);
  if (!ctx) return null;
  return modifPrix(ctx.tier, wine.prixReference, kb.garde).tier;
}

// ---------------------------------------------------------------------------
// Étapes 3-4 — Durées du tier, puis facteur de format (a et apogee, jamais de).
// ---------------------------------------------------------------------------

const dureesTier = (tier, garde) => {
  const t = garde.tiers[tier];
  return { de: t.de, a: t.a, apogee: t.apogee };
};

const facteurFormat = (format, garde) =>
  garde.modificateurs.format[format] ?? garde.modificateurs.format.standard;

// Étape 6 — Fenêtre. Le format multiplie a et apogee (Math.round), jamais de.
function fenetre(base, durees, ff) {
  return {
    gardeDe: base + durees.de,
    apogee: base + Math.round(durees.apogee * ff.facteurApogee),
    gardeA: base + Math.round(durees.a * ff.facteurA),
  };
}

// ---------------------------------------------------------------------------
// Étape 7 — Explication (obligatoire si gardeSource: "auto").
// Format calqué sur la graine data.json : « Appellation Fendant (garde courte) + millésime 2024 ».
// ---------------------------------------------------------------------------

const PREFIXE = { appellation: 'Appellation', cepage: 'Cépage', couleur: 'Couleur' };

const CRANS = { 1: "d'un cran", 2: 'de deux crans', 3: 'de trois crans', 4: 'de quatre crans' };

// Contrainte de schema/data.schema.json > wine.gardeExplication.maxLength. Le schéma fait foi ;
// cette constante n'est qu'un garde-fou local pour ne jamais produire une valeur invalide.
const MAX_EXPLICATION = 200;

function construireExplication({ source, nom, tierBase, shift, base, hasMillesime, garde, appSansTier, prixReference }) {
  const libelle = garde.tiers[tierBase].libelle;
  let s = `${PREFIXE[source]} ${nom} (${libelle})`;
  // On cite le PRIX, pas le seuil franchi : avec plusieurs paliers, « prix > 40 CHF » ne
  // désignerait plus rien de précis, et c'est le chiffre saisi que l'utilisateur veut vérifier.
  if (shift !== 0) {
    const crans = CRANS[Math.abs(shift)] ?? `de ${Math.abs(shift)} crans`;
    s += `, ${shift > 0 ? 'relevé' : 'abaissé'} ${crans} (prix ${prixReference} CHF)`;
  }
  s += hasMillesime
    ? ` + millésime ${base}`
    : `, fenêtre estimée depuis l'achat ${base} (vin non millésimé)`;
  // Pourquoi la cascade est descendue jusque-là. « Trop large » et « inconnue » ne disent pas la
  // même chose à l'utilisateur : l'une est un choix du référentiel, l'autre un trou (D16).
  if (source === 'cepage') {
    s += appSansTier
      ? ` — appellation ${appSansTier}, trop large pour fixer une garde`
      : ' — appellation inconnue du référentiel';
  } else if (source === 'couleur') {
    s += appSansTier
      ? ` — appellation ${appSansTier}, trop large pour fixer une garde, et cépage inconnu du référentiel`
      : ' — appellation et cépage inconnus du référentiel';
  }
  // Garde-fou : data.schema.json plafonne gardeExplication à 200 caractères. Les quatre fragments
  // (tier, prix, millésime, appellation sans tier) peuvent les dépasser sur un nom long. Mieux vaut
  // une phrase coupée qu'une écriture refusée à la validation.
  return s.length <= MAX_EXPLICATION ? s : `${s.slice(0, MAX_EXPLICATION - 1)}…`;
}

// ---------------------------------------------------------------------------
// Fenêtre CANONIQUE (persistée). Format standard ; base = millésime, sinon acquisition la plus
// ancienne parmi les bouteilles du vin (déterministe).
// ---------------------------------------------------------------------------

export function calculerGardeVin(wine, bottles, kb) {
  const ctx = resoudreTier(wine, kb);
  if (!ctx) return null;
  const { tier: tierEff, shift } = modifPrix(ctx.tier, wine.prixReference, kb.garde);
  const durees = dureesTier(tierEff, kb.garde);

  let base;
  let hasMillesime;
  if (wine.millesime != null) {
    base = wine.millesime;
    hasMillesime = true;
  } else {
    const years = (bottles ?? []).map((b) => yearOf(b.acquisition?.date)).filter((y) => y != null);
    if (!years.length) return null; // ni millésime ni bouteille → null, statut inconnu (G9)
    base = Math.min(...years);
    hasMillesime = false;
  }

  const f = fenetre(base, durees, facteurFormat('standard', kb.garde));
  const gardeExplication = construireExplication({
    source: ctx.source, nom: ctx.nom, tierBase: ctx.tier, shift, base, hasMillesime,
    garde: kb.garde, appSansTier: ctx.appSansTier, prixReference: wine.prixReference,
  });
  return { gardeDe: f.gardeDe, gardeA: f.gardeA, apogee: f.apogee, gardeExplication };
}

// ---------------------------------------------------------------------------
// Fenêtre EFFECTIVE (jamais persistée). Applique le format de la bouteille ; base = millésime,
// sinon acquisition de CETTE bouteille (avec mention BSA affichée).
// ---------------------------------------------------------------------------

const FENETRE_NULLE = { gardeDe: null, gardeA: null, apogee: null, mention: null };

export function gardeEffective(wine, bottle, kb) {
  const ctx = resoudreTier(wine, kb);
  if (!ctx) return { ...FENETRE_NULLE };
  const { tier: tierEff } = modifPrix(ctx.tier, wine.prixReference, kb.garde);
  const durees = dureesTier(tierEff, kb.garde);

  let base;
  let hasMillesime;
  if (wine.millesime != null) {
    base = wine.millesime;
    hasMillesime = true;
  } else {
    base = yearOf(bottle?.acquisition?.date);
    hasMillesime = false;
    if (base == null) return { ...FENETRE_NULLE };
  }

  const f = fenetre(base, durees, facteurFormat(bottle?.format ?? 'standard', kb.garde));
  return {
    gardeDe: f.gardeDe,
    gardeA: f.gardeA,
    apogee: f.apogee,
    mention: hasMillesime ? null : kb.garde.sansMillesime.mention,
  };
}

// ---------------------------------------------------------------------------
// Statuts (D4) — des drapeaux, pas une valeur. Évalués sur la fenêtre EFFECTIVE.
// ---------------------------------------------------------------------------

export function statutsGarde(fenetreEff, annee = new Date().getFullYear()) {
  const { gardeDe, gardeA, apogee } = fenetreEff ?? {};
  // Court-circuit : sans fenêtre, seul « inconnu » (évite `annee > null` → depasse par erreur).
  if (gardeDe == null || gardeA == null) return ['inconnu'];
  const flags = [];
  if (annee < gardeDe) flags.push('tropJeune');
  if (gardeDe <= annee && annee <= gardeA) flags.push('aBoire');
  if (apogee != null && Math.abs(annee - apogee) <= 1) flags.push('apogee');
  if (gardeA - 1 <= annee && annee <= gardeA) flags.push('urgent');
  if (annee > gardeA) flags.push('depasse');
  return flags;
}

// Facteur d'accord = MAX des facteurs des drapeaux actifs. Aucun drapeau → inconnu (0.85).
export function facteurAccords(flags, kb) {
  const table = kb.garde.facteurAccords;
  if (!flags || !flags.length) return table.inconnu;
  return Math.max(...flags.map((f) => table[f] ?? 0));
}

// Statut d'un VIN = celui de sa bouteille la plus urgente (gardeA le plus proche = minimal).
export function statutVin(wine, allBottles, kb, annee = new Date().getFullYear()) {
  const list = (allBottles ?? []).filter((b) => b.wineId === wine.id);
  if (!list.length) {
    const canon = calculerGardeVin(wine, [], kb);
    return { flags: statutsGarde(canon, annee), fenetre: canon, bottle: null };
  }
  let best = null;
  for (const b of list) {
    const fen = gardeEffective(wine, b, kb);
    if (fen.gardeA == null) continue;
    if (!best || fen.gardeA < best.fen.gardeA) best = { b, fen };
  }
  if (!best) {
    const fen = gardeEffective(wine, list[0], kb);
    return { flags: statutsGarde(fen, annee), fenetre: fen, bottle: list[0] };
  }
  return { flags: statutsGarde(best.fen, annee), fenetre: best.fen, bottle: best.b };
}

// ---------------------------------------------------------------------------
// Recalcul global — helper PUR. Renvoie les payloads UPDATE_WINE des vins « auto » dont la
// fenêtre calculée diffère du stocké. INVARIANT 4 verrouillé ici : un vin « manuel » n'est
// JAMAIS dans la sortie, y compris quand sa fenêtre stockée diverge du calcul.
// ---------------------------------------------------------------------------

export function recalculerGardes(data, kb) {
  const updates = [];
  for (const wine of data.wines) {
    if (wine.gardeSource === 'manuel') continue; // jamais écrasé
    const bottles = data.bottles.filter((b) => b.wineId === wine.id);
    const g = calculerGardeVin(wine, bottles, kb);
    const next = g
      ? { gardeDe: g.gardeDe, gardeA: g.gardeA, apogee: g.apogee, gardeExplication: g.gardeExplication, gardeSource: 'auto' }
      : { gardeDe: null, gardeA: null, apogee: null, gardeExplication: null, gardeSource: 'auto' };
    const changed =
      wine.gardeDe !== next.gardeDe ||
      wine.gardeA !== next.gardeA ||
      wine.apogee !== next.apogee ||
      wine.gardeExplication !== next.gardeExplication ||
      wine.gardeSource !== next.gardeSource;
    if (changed) updates.push({ type: 'UPDATE_WINE', payload: { id: wine.id, fields: next } });
  }
  return updates;
}
