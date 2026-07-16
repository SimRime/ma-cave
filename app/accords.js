// accords.js — moteur d'accords mets ↔ vin. Implémente docs/SPEC_MOTEURS.md §2, et RIEN d'autre.
//
// Tout le barème (poids appellation/cépage/profil, plafond du profil, seuil d'affichage, repli,
// règles de profil, anti-règles, profil par défaut, service) vit dans kb/accords.json, lu ici via
// `kb.accords`. AUCUN chiffre métier n'est écrit en dur (CLAUDE.md « Données vs connaissance »).
//
// Une seule implémentation du scoring : l'app (views/accords.js, views/fiche.js) et scripts/query.mjs
// (lot L6) l'appellent — jamais de règle métier dupliquée. On importe garde.js pour les drapeaux et le
// facteur d'accord (statut = bouteille la plus urgente, fenêtre EFFECTIVE), et le tier pour le service.
//
// Les moteurs lisent wine.appellationId / wine.cepageIds — jamais le texte libre (D6).

import { statutVin, facteurAccords, tierEffectif } from './garde.js';

// ---------------------------------------------------------------------------
// Profil du vin : cépage dominant, ou défaut par couleur si aucun cépage résolu (§2.2).
// Ce défaut n'est pas cosmétique : c'est lui qui donne un `tanin` au vin inconnu, sans quoi
// l'anti-règle raclette ne se déclenche pas et le tannat arrive sur la raclette (vecteur A6).
// ---------------------------------------------------------------------------

export function profilVin(wine, kb) {
  const cepId = wine.cepageIds?.[0];
  const cep = cepId ? kb.cepage(cepId) : null;
  if (cep && cep.profil) return cep.profil;
  return kb.accords.profilDefautParCouleur?.[wine.couleur] ?? null;
}

// ---------------------------------------------------------------------------
// Évaluation d'une condition `si` de kb/accords.json (règles de profil ET anti-règles).
// Clés = attributs du profil (opérateurs texte « >=4 », « <=2 »…) + clé spéciale `couleurVin`
// (appartenance). Toutes les clés doivent être satisfaites (ET). Un attribut absent → false.
// ---------------------------------------------------------------------------

function comparer(valeur, expr) {
  const m = String(expr).match(/^(>=|<=|>|<|==)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return false;
  const op = m[1] || '==';
  const n = Number(m[2]);
  switch (op) {
    case '>=': return valeur >= n;
    case '<=': return valeur <= n;
    case '>': return valeur > n;
    case '<': return valeur < n;
    default: return valeur === n;
  }
}

function evaluerCondition(si, profil, couleur) {
  for (const [cle, val] of Object.entries(si)) {
    if (cle === 'couleurVin') {
      if (!Array.isArray(val) || !val.includes(couleur)) return false;
      continue;
    }
    const attr = profil?.[cle];
    if (attr == null) return false; // profil indéfini sur cet attribut → condition non satisfaite
    if (!comparer(attr, val)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Anti-règle active pour ce (vin, plat) : ramène le score à 0 et exclut le vin, même du repli (§2.1).
// Évaluée sur le MÊME profil que les règles de profil (cépage dominant, ou défaut par couleur).
// ---------------------------------------------------------------------------

export function antiRegleActive(wine, platId, kb) {
  const profil = profilVin(wine, kb);
  for (const r of kb.accords.antiRegles?.regles ?? []) {
    if ((r.plats ?? []).includes(platId) && evaluerCondition(r.si, profil, wine.couleur)) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Score de base sur 100 (§2.1) : appellation (50) + cépage (30) + Σ profil (plafonné), min(·, 100).
// Le plafond du profil (kb: ponderation.profil) reste sous le poids de l'appellation : le filet de
// sécurité ne peut jamais dominer une source explicite. `sources` porte de quoi construire la raison.
// ---------------------------------------------------------------------------

function scoreBase(wine, platId, kb) {
  const P = kb.accords.ponderation;
  const sources = [];
  let base = 0;

  // Appellation résolue listant le plat.
  const app = wine.appellationId ? kb.appellation(wine.appellationId) : null;
  if (app && (app.accords ?? []).includes(platId)) {
    base += P.appellation;
    sources.push({ type: 'appellation', poids: P.appellation, nom: app.nom });
  }

  // Au moins un cépage résolu listant le plat (raison : le premier qui le cite).
  let cepMatch = null;
  for (const id of wine.cepageIds ?? []) {
    const c = kb.cepage(id);
    if (c && (c.accords ?? []).includes(platId)) { cepMatch = c; break; }
  }
  if (cepMatch) {
    base += P.cepage;
    sources.push({ type: 'cepage', poids: P.cepage, nom: cepMatch.nom });
  }

  // Règles de profil satisfaites citant le plat, cumul PLAFONNÉ (kb: ponderation.profil).
  const profil = profilVin(wine, kb);
  let profilPoints = 0;
  for (const r of kb.accords.reglesProfil?.regles ?? []) {
    if ((r.plats ?? []).includes(platId) && evaluerCondition(r.si, profil, wine.couleur)) {
      profilPoints += r.poids;
    }
  }
  profilPoints = Math.min(profilPoints, P.profil);
  if (profilPoints > 0) {
    base += profilPoints;
    sources.push({ type: 'profil', poids: profilPoints, nom: wine.couleur });
  }

  return { base: Math.min(base, 100), sources };
}

// Libellé de raison affichée (§2.4), construit depuis la source qui a marqué. Le plat visé est déjà
// dans l'en-tête de l'écran ; la raison dit d'où vient la note (source explicite vs filet de sécurité).
const raisonSource = (s) =>
  s.type === 'appellation' ? `Appellation ${s.nom}`
  : s.type === 'cepage' ? `Cépage ${s.nom}`
  : `Profil ${s.nom}`;

// ---------------------------------------------------------------------------
// Évaluation complète d'un (vin, plat) — la fonction verrouillée par les vecteurs A1–A8.
// score = round(base × facteur d'accord de la garde). Anti-règle → score 0, vin exclu.
// ---------------------------------------------------------------------------

export function evaluerAccord(wine, bottles, platId, kb, annee = new Date().getFullYear()) {
  const st = statutVin(wine, bottles ?? [], kb, annee);
  const flags = st.flags;
  const facteur = facteurAccords(flags, kb);

  const anti = antiRegleActive(wine, platId, kb);
  if (anti) {
    return { score: 0, base: 0, flags, facteur, exclu: true, bottle: st.bottle, raison: anti.raison, raisons: [anti.raison], sources: [] };
  }

  const { base, sources } = scoreBase(wine, platId, kb);
  const score = Math.round(base * facteur);
  const raisons = sources.map(raisonSource);
  return { score, base, flags, facteur, exclu: false, bottle: st.bottle, raison: raisons[0] ?? null, raisons, sources };
}

// ---------------------------------------------------------------------------
// Service (§2.3) — cascade explicite, du plus spécifique au plus générique. Un assemblage n'utilise
// QUE son cépage dominant (pas de moyenne). Un cépage résolu qui porte `carafage: null` renseigne
// « pas de carafage » : on ne retombe alors PAS sur le tier (« _parTier n'intervient que si le cépage
// ne renseigne pas de carafage »).
// ---------------------------------------------------------------------------

export function serviceVin(wine, kb) {
  const svc = kb.accords.service;
  const cepId = wine.cepageIds?.[0];
  const cep = cepId ? kb.cepage(cepId) : null;
  const cepSvc = cep?.service ?? null;
  const parCouleur = svc[wine.couleur] ?? {};

  const tempC = cepSvc?.tempC ?? parCouleur.tempC ?? null;
  const verre = cepSvc?.verre ?? parCouleur.verre ?? null;

  let carafage;
  if (cepSvc && 'carafage' in cepSvc) {
    carafage = cepSvc.carafage; // le cépage renseigne (null compris = pas de carafage)
  } else {
    const tier = tierEffectif(wine, kb);
    const parTier = tier ? svc._parTier?.[tier]?.carafage : undefined;
    carafage = parTier ?? parCouleur.carafage ?? null;
  }
  return { tempC, verre, carafage };
}

// ---------------------------------------------------------------------------
// Mets automatiques persistés (§2.5) : union des accords de l'appellation résolue et du cépage
// dominant, filtrée par les anti-règles. Alimente les chips de la fiche — connaissance EXPLICITE du
// KB, pas le filet de sécurité (les plats venus des seules règles de profil n'y entrent pas).
// Invariant 4 : appelé uniquement quand metsSource === "auto" ; une valeur « manuel » n'est jamais
// écrasée.
// ---------------------------------------------------------------------------

export function metsAutomatiques(wine, kb) {
  const app = wine.appellationId ? kb.appellation(wine.appellationId) : null;
  const cep = wine.cepageIds?.[0] ? kb.cepage(wine.cepageIds[0]) : null;
  const union = [...new Set([...(app?.accords ?? []), ...(cep?.accords ?? [])])];
  return union.filter((platId) => !antiRegleActive(wine, platId, kb));
}

// ---------------------------------------------------------------------------
// Écran mets → vin (§2.1, PRD §6.5). Seuls les vins EN STOCK et non archivés sont considérés.
// Établis : score >= seuilAffichage. Sinon repli : les N meilleurs de score >= scoreMinimum, étiquetés.
// Tri déterministe (identique à query.mjs, lot L6) : score ↓, puis apogée/urgent d'abord, puis note ↓,
// puis ref ↑.
// ---------------------------------------------------------------------------

const aApogeeOuUrgent = (flags) => flags.includes('apogee') || flags.includes('urgent');

function trierAccords(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const ap = aApogeeOuUrgent(a.flags);
  const bp = aApogeeOuUrgent(b.flags);
  if (ap !== bp) return ap ? -1 : 1;
  const an = a.wine.note ?? -Infinity;
  const bn = b.wine.note ?? -Infinity;
  if (bn !== an) return bn - an;
  return a.wine.ref - b.wine.ref;
}

export function accordsPourPlat(data, platId, kb, annee = new Date().getFullYear()) {
  const P = kb.accords.ponderation;
  const repli = kb.accords.repli;

  const bottlesByWine = new Map();
  for (const b of data.bottles) {
    if (!bottlesByWine.has(b.wineId)) bottlesByWine.set(b.wineId, []);
    bottlesByWine.get(b.wineId).push(b);
  }

  const candidats = [];
  for (const wine of data.wines) {
    if (wine.archive) continue;
    const bs = bottlesByWine.get(wine.id) ?? [];
    if (!bs.length) continue; // uniquement les vins ayant au moins une bouteille en stock (§2.1)

    const ev = evaluerAccord(wine, bs, platId, kb, annee);
    if (ev.exclu) continue; // anti-règle → jamais, même au repli
    candidats.push({
      wineId: wine.id,
      wine,
      score: ev.score,
      flags: ev.flags,
      drapeaux: ev.flags, // alias explicite pour l'alignement query.mjs (lot L6)
      facteur: ev.facteur,
      raison: ev.raison,
      raisons: ev.raisons,
      sources: ev.sources,
      service: serviceVin(wine, kb),
      bottle: ev.bottle, // la bouteille qui porte le statut → son emplacement
      emplacement: ev.bottle?.slot ?? null,
      nbBouteilles: bs.length,
    });
  }

  candidats.sort(trierAccords);

  const etablis = candidats.filter((c) => c.score >= P.seuilAffichage);
  if (etablis.length) return { etablis, repli: [], intituleRepli: null };

  const repliList = candidats.filter((c) => c.score >= repli.scoreMinimum).slice(0, repli.nombre);
  return { etablis: [], repli: repliList, intituleRepli: repli.intitule };
}
