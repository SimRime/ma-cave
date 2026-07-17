// stats.js — agrégats de la cave. Module PUR : aucun DOM, aucun réseau.
// Miroir de garde.js / accords.js : la vue Stats et (plus tard) scripts/query.mjs importent
// les MÊMES fonctions. Une règle écrite deux fois divergerait (CLAUDE.md).
//
// Deux agrégats monétaires DISTINCTS, jamais confondus (PRD §4.2 — une raison d'être du projet) :
//   montantDepense = Σ acquisition.prix des bouteilles      (un cadeau vaut null → 0)
//   valeurCave     = Σ wine.valeur des bouteilles EN STOCK  (les cadeaux comptent)
// prixReference n'entre dans NI l'un NI l'autre : il ne sert qu'au moteur de garde (schéma).
//
// Le stock EST l'ensemble des bouteilles présentes : boire une bouteille la supprime (invariant 1).
// Il n'existe donc aucun historique de consommation autre que les dégustations, ni d'historique
// d'achat au-delà des bouteilles encore en cave. C'est assumé, pas un manque à combler.

import { gardeEffective } from './garde.js';

const wineIndex = (data) => new Map(data.wines.map((w) => [w.id, w]));

const trierParN = (arr) => arr.sort((a, b) => b.n - a.n);
const trierParCle = (arr) => arr.sort((a, b) => a.cle.localeCompare(b.cle));

// --- Les deux agrégats monétaires ----------------------------------------------------------

// Σ des prix réellement payés. Un cadeau (prix null) n'entre PAS dans le montant dépensé.
export function montantDepense(data) {
  return data.bottles.reduce((sum, b) => sum + (b.acquisition?.prix ?? 0), 0);
}

// Σ des valeurs estimées des bouteilles en stock — cadeaux inclus. Repli valeur → prixRéf → 0
// (le formulaire fait « défaut = prix réf. » ; ce repli évite un sous-comptage si valeur est nulle).
export function valeurCave(data) {
  const wines = wineIndex(data);
  return data.bottles.reduce((sum, b) => {
    const w = wines.get(b.wineId);
    if (!w) return sum;
    return sum + (w.valeur ?? w.prixReference ?? 0);
  }, 0);
}

// --- Répartitions du stock ------------------------------------------------------------------

// Regroupe les bouteilles en stock selon `cleDe(wine, bottle)` → [{ cle, n }].
function grouper(data, cleDe) {
  const wines = wineIndex(data);
  const compte = new Map();
  for (const b of data.bottles) {
    const w = wines.get(b.wineId);
    if (!w) continue;
    const cle = cleDe(w, b);
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return [...compte.entries()].map(([cle, n]) => ({ cle, n }));
}

export const parRegion = (data) =>
  trierParN(grouper(data, (w) => w.region || 'Sans région'));

export const parPays = (data) =>
  trierParN(grouper(data, (w) => w.pays || 'XX'));

export const parCouleur = (data) =>
  trierParN(grouper(data, (w) => w.couleur || 'Sans couleur'));

export const parMillesime = (data) =>
  trierParCle(grouper(data, (w) => (w.millesime != null ? String(w.millesime) : 'Sans millésime')));

// Répartition par année d'apogée — réutilise gardeEffective (jamais réimplémenté). Nécessite kb.
export function parApogee(data, kb) {
  const wines = wineIndex(data);
  const compte = new Map();
  for (const b of data.bottles) {
    const w = wines.get(b.wineId);
    if (!w) continue;
    const { apogee } = gardeEffective(w, b, kb);
    const cle = apogee != null ? String(apogee) : 'Inconnue';
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return trierParCle([...compte.entries()].map(([cle, n]) => ({ cle, n })));
}

// --- Séries mensuelles ----------------------------------------------------------------------

const moisCle = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Série des N derniers mois (clé « YYYY-MM », du plus ancien au plus récent), comptée depuis
// une liste de dates ISO. Les dates hors fenêtre sont ignorées.
function serieMensuelle(dates, nMois, maintenant) {
  const buckets = [];
  const index = new Map();
  const y0 = maintenant.getFullYear();
  const m0 = maintenant.getMonth();
  for (let i = nMois - 1; i >= 0; i -= 1) {
    const cle = moisCle(new Date(y0, m0 - i, 1)); // le débordement de mois est normalisé par Date
    index.set(cle, buckets.length);
    buckets.push({ mois: cle, n: 0 });
  }
  for (const ds of dates) {
    if (!ds) continue;
    const j = index.get(String(ds).slice(0, 7));
    if (j != null) buckets[j].n += 1;
  }
  return buckets;
}

// Consommation par mois = dégustations par mois (seul historique de « bue » — invariant 1).
export const consommationParMois = (data, nMois = 24, maintenant = new Date()) =>
  serieMensuelle(data.tastings.map((t) => t.date), nMois, maintenant);

// Achats par mois = dates d'acquisition des bouteilles ENCORE en stock (les autres ont disparu).
export const achatsParMois = (data, nMois = 24, maintenant = new Date()) =>
  serieMensuelle(data.bottles.map((b) => b.acquisition?.date), nMois, maintenant);

// --- Provenance -----------------------------------------------------------------------------

// Comptes par type d'acquisition, + « offert par X » (cadeaux) et « ce qui reste de … » (héritage).
export function provenance(data) {
  const parType = new Map();
  const cadeaux = new Map();
  const heritages = new Map();
  for (const b of data.bottles) {
    const a = b.acquisition;
    if (!a) continue;
    parType.set(a.type, (parType.get(a.type) ?? 0) + 1);
    if (a.type === 'cadeau' && a.source) cadeaux.set(a.source, (cadeaux.get(a.source) ?? 0) + 1);
    if (a.type === 'heritage' && a.source) heritages.set(a.source, (heritages.get(a.source) ?? 0) + 1);
  }
  const toList = (m) => trierParN([...m.entries()].map(([cle, n]) => ({ cle, n })));
  return { parType: toList(parType), cadeaux: toList(cadeaux), heritages: toList(heritages) };
}
