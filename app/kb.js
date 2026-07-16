// kb.js — chargement ET RÉSOLUTION de la base de connaissances (CLAUDE.md § « Un seul endroit »).
//
// C'est le SEUL module qui connaît la forme de kb/*.json. Les moteurs (garde.js, plus tard
// accords.js) reçoivent l'objet `kb` construit ici et lisent `wine.appellationId` /
// `wine.cepageIds` — JAMAIS le texte libre `wine.appellation` / `wine.cepages` (D6).
//
// Deux entrées :
//   buildKb({ garde, cepages, regions, accords })  → objet kb PUR (tests, query.mjs, navigateur)
//   loadKb()                                        → async : fetch des kb/*.json puis buildKb
//
// Ici : aucun barème de garde ni d'accords (ils vivent dans kb/*.json), aucun réseau applicatif
// (github.js), aucune écriture. Résolution seulement.

import { normalise } from './format.js';

// Mentions d'appellation à retirer avant résolution (D6). Retirées comme mots entiers.
const MENTIONS = /\b(aoc|aop|ac|docg|doc|igp|dop)\b/g;

// Normalisation KB : la normalisation de recherche (NFD, sans accents, minuscules, espaces) PLUS
// le retrait des mentions et la compression des tirets/espaces. Spécifique au KB → reste ici.
const normKb = (str) =>
  normalise(str)
    .replace(MENTIONS, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Construction de l'index (pur).
// ---------------------------------------------------------------------------

export function buildKb({ garde, cepages, regions, accords = null }) {
  // — Cépages : index par id + résolution par nom/synonyme normalisé ————————————
  const cepageById = new Map();
  const cepageByName = new Map(); // nom normalisé → id (nom ET synonymes)
  for (const c of cepages.cepages) {
    cepageById.set(c.id, c);
    for (const label of [c.nom, ...(c.synonymes ?? [])]) {
      const key = normKb(label);
      if (key && !cepageByName.has(key)) cepageByName.set(key, c.id);
    }
  }

  // — Appellations : aplaties avec leur contexte pays/région ————————————————————
  // Résolution sur le COUPLE (nom normalisé, couleur du vin) : deux entrées peuvent partager le
  // même nom avec des couleurs disjointes (Neuchâtel blanc/rouge, Petite Arvine sèche/flétrie).
  const appellationById = new Map();
  const appellationByKey = new Map(); // `${nomNorm}|${couleur}` → id
  const paysList = [];
  for (const pays of regions.pays) {
    const regionsOut = [];
    for (const region of pays.regions) {
      const appsOut = [];
      for (const a of region.appellations) {
        const flat = {
          ...a,
          paysCode: pays.code,
          regionId: region.id,
          regionNom: region.nom,
        };
        appellationById.set(a.id, flat);
        appsOut.push(flat);
        const nomKey = normKb(a.nom);
        for (const couleur of a.couleurs ?? []) {
          const key = `${nomKey}|${couleur}`;
          if (!appellationByKey.has(key)) appellationByKey.set(key, a.id);
        }
      }
      regionsOut.push({ id: region.id, nom: region.nom, sousRegions: region.sousRegions ?? [], appellations: appsOut });
    }
    paysList.push({ code: pays.code, nom: pays.nom, regions: regionsOut });
  }

  // — Plats (taxonomie d'affichage) : optionnelle. Le scoring reste au lot L4 (accords.js) ————
  const platById = new Map();
  if (accords) {
    for (const p of accords.plats ?? []) platById.set(p.id, p);
  }

  const cepage = (id) => cepageById.get(id) ?? null;
  const appellation = (id) => appellationById.get(id) ?? null;
  const plat = (id) => platById.get(id) ?? null;
  const platLabel = (id) => platById.get(id)?.nom ?? id;

  // Résolution d'un texte d'étiquette vers un id (ou null : l'app avertit mais accepte, D6).
  const resolveCepage = (texte) => cepageByName.get(normKb(texte)) ?? null;
  const resolveAppellation = (texte, couleur) => {
    const nomKey = normKb(texte);
    if (!nomKey) return null;
    if (couleur) {
      const hit = appellationByKey.get(`${nomKey}|${couleur}`);
      if (hit) return hit;
    }
    // Sans couleur (ou couleur non concluante) : accepter un nom unique toutes couleurs confondues.
    const matches = [...appellationById.values()].filter((a) => normKb(a.nom) === nomKey);
    return matches.length === 1 ? matches[0].id : null;
  };

  // Union des accords de l'appellation résolue et du cépage dominant (résolution KB pure, dédup).
  // PAS de filtrage anti-règles ici : c'est le lot L4 (accords.js) qui l'ajoutera. Cette union
  // reproduit exactement le champ `mets` de la graine data.json.
  const metsUnionKb = (wine) => {
    const app = wine.appellationId ? appellation(wine.appellationId) : null;
    const cep = wine.cepageIds?.[0] ? cepage(wine.cepageIds[0]) : null;
    return [...new Set([...(app?.accords ?? []), ...(cep?.accords ?? [])])];
  };

  return {
    garde,
    cepage,
    appellation,
    plat,
    platLabel,
    resolveCepage,
    resolveAppellation,
    metsUnionKb,
    pays: paysList,
    cepages: cepages.cepages,
  };
}

// ---------------------------------------------------------------------------
// Chargement navigateur — fetch relatif au module (résout /app/kb.js → /kb/*.json).
// ---------------------------------------------------------------------------

let cached = null;

export async function loadKb() {
  if (cached) return cached;
  const at = (name) => new URL(`../kb/${name}`, import.meta.url);
  const [garde, cepages, regions, accords] = await Promise.all([
    fetch(at('garde.json')).then((r) => r.json()),
    fetch(at('cepages.json')).then((r) => r.json()),
    fetch(at('regions.json')).then((r) => r.json()),
    fetch(at('accords.json')).then((r) => r.json()).catch(() => null),
  ]);
  cached = buildKb({ garde, cepages, regions, accords });
  return cached;
}
