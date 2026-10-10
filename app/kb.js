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
// `igt` y figure au même titre qu'`igp` : c'est la mention portée par les étiquettes italiennes
// antérieures à l'harmonisation européenne (« Salento IGT »), et elle n'appartient à aucun nom.
// En revanche « Grand Cru », « Riserva » ou « Classico » n'y entrent PAS : ils font partie du nom
// dans certaines appellations et les retirer partout créerait des faux positifs. Ces cas passent
// par `appellation.synonymes` (D16).
const MENTIONS = /\b(aoc|aop|ac|docg|doc|igp|igt|dop)\b/g;

// Normalisation KB : la normalisation de recherche (NFD, sans accents, minuscules, espaces) PLUS
// le retrait des mentions et la compression des tirets/espaces. Spécifique au KB → définie ici.
// Exportée pour scripts/validate-kb.mjs, qui vérifie l'unicité des clés de résolution (D16) : il
// doit normaliser EXACTEMENT comme la résolution, pas comme une recopie qui divergera.
export const normKb = (str) =>
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
        // Nom ET synonymes, indexés sur le couple (libellé normalisé, couleur) — D16.
        // Les étiquettes suisses portent la mention cantonale (« AOC Valais », « Ticino DOC »)
        // là où le référentiel nomme la dénomination (« Cornalin du Valais », « Merlot del Ticino »).
        for (const label of [a.nom, ...(a.synonymes ?? [])]) {
          const labelKey = normKb(label);
          if (!labelKey) continue;
          for (const couleur of a.couleurs ?? []) {
            const key = `${labelKey}|${couleur}`;
            if (!appellationByKey.has(key)) appellationByKey.set(key, a.id);
          }
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
    // Couleur connue : la résolution se fait sur le COUPLE, et s'arrête là. Pas de repli
    // toutes-couleurs — il collait une appellation BLANCHE (La Côte, Côtes de l'Orbe, qui
    // n'existent au KB qu'en blanc) sur un rouge vaudois, avec son tier et ses accords. C'est
    // le rapprochement approximatif silencieux que D6 interdit, au niveau de la couleur.
    if (couleur) return appellationByKey.get(`${nomKey}|${couleur}`) ?? null;
    // Couleur inconnue seulement : accepter un libellé unique toutes couleurs confondues.
    const matches = [...appellationById.values()].filter((a) =>
      [a.nom, ...(a.synonymes ?? [])].some((label) => normKb(label) === nomKey),
    );
    return matches.length === 1 ? matches[0].id : null;
  };

  // Union des accords de l'appellation résolue et du cépage dominant (résolution KB pure, dédup).
  // PAS de filtrage anti-règles ici : c'est le lot L4 (accords.js) qui l'ajoutera. Cette union
  // reproduit exactement le champ `mets` de la graine data.json.
  const metsUnionKb = (wine) => {
    const app = wine.appellationId ? appellation(wine.appellationId) : null;
    // D17 : si le dominant n'a pas été reconnu, aucun id de cepageIds ne vaut dominant.
    const cepId = wine.cepageDominantInconnu ? null : wine.cepageIds?.[0];
    const cep = cepId ? cepage(cepId) : null;
    return [...new Set([...(app?.accords ?? []), ...(cep?.accords ?? [])])];
  };

  return {
    garde,
    accords, // config brute du moteur d'accords (kb/accords.json) — lue par app/accords.js, comme `garde`.
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
