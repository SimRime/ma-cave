// garde.test.mjs — les 12 vecteurs G1–G12 de docs/SPEC_MOTEURS.md §3 (NORMATIFS).
//
// Année de référence : 2026 (passée explicitement à statutsGarde → test déterministe quelle que
// soit la date d'exécution ; les fenêtres, elles, ne dépendent que du millésime/acquisition).
// Le barème n'est jamais recopié ici : kb/garde.json fait foi, on ne vérifie que ses SORTIES.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildKb } from '../app/kb.js';
import {
  calculerGardeVin,
  gardeEffective,
  statutsGarde,
  facteurAccords,
  recalculerGardes,
} from '../app/garde.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

const kb = buildKb({
  garde: await read('kb/garde.json'),
  cepages: await read('kb/cepages.json'),
  regions: await read('kb/regions.json'),
  accords: await read('kb/accords.json'),
});

const ANNEE = 2026;
const sorted = (a) => [...a].sort();
const bottle = (format, date) => ({ format, acquisition: { type: 'achat', date, prix: null } });

// Chaque vecteur : le vin, une bouteille (pour la fenêtre EFFECTIVE, qui applique le format),
// la fenêtre attendue et les drapeaux attendus en 2026. Réf. SPEC_MOTEURS.md §3.
const VECTEURS = [
  {
    nom: 'G1 — appellation it-barolo, prix +1 PLAFONNÉ',
    wine: { id: 'g1', appellationId: 'it-barolo', cepageIds: ['nebbiolo'], couleur: 'Rouge', millesime: 2019, prixReference: 60 },
    bottle: bottle('standard', '2022-01-01'),
    attendu: { gardeDe: 2024, apogee: 2031, gardeA: 2041 },
    drapeaux: ['aBoire'],
    explication: 'Appellation Barolo (grande garde) + millésime 2019',
  },
  {
    nom: 'G2 — appellation ch-valais-fendant, aucun modificateur',
    wine: { id: 'g2', appellationId: 'ch-valais-fendant', cepageIds: ['chasselas'], couleur: 'Blanc', millesime: 2024, prixReference: 22 },
    bottle: bottle('standard', '2025-01-01'),
    attendu: { gardeDe: 2025, apogee: 2026, gardeA: 2028 },
    drapeaux: ['aBoire', 'apogee'],
  },
  {
    nom: 'G3 — cépage pinot-noir, prix +1 → grandeGarde',
    wine: { id: 'g3', appellationId: null, cepageIds: ['pinot-noir'], couleur: 'Rouge', millesime: 2019, prixReference: 65 },
    bottle: bottle('standard', '2022-01-01'),
    attendu: { gardeDe: 2024, apogee: 2031, gardeA: 2041 },
    drapeaux: ['aBoire'],
    explication: "Cépage Pinot Noir (vin de garde), relevé d'un cran (prix 65 CHF) + millésime 2019 — appellation inconnue du référentiel",
  },
  {
    nom: 'G4 — cépage pinot-noir, prix −1 → moyen',
    wine: { id: 'g4', appellationId: null, cepageIds: ['pinot-noir'], couleur: 'Rouge', millesime: 2019, prixReference: 8 },
    bottle: bottle('standard', '2022-01-01'),
    attendu: { gardeDe: 2021, apogee: 2022, gardeA: 2025 },
    drapeaux: ['depasse'],
  },
  {
    nom: 'G5 — magnum ×1.25 sur a et apogee (arrondi)',
    wine: { id: 'g5', appellationId: null, cepageIds: ['pinot-noir'], couleur: 'Rouge', millesime: 2019, prixReference: 65 },
    bottle: bottle('magnum', '2022-01-01'),
    attendu: { gardeDe: 2024, apogee: 2034, gardeA: 2047 },
    drapeaux: ['aBoire'],
  },
  {
    nom: 'G6 — demi ×0.75 (a 4→3, apogee 2→2)',
    wine: { id: 'g6', appellationId: 'ch-valais-fendant', cepageIds: ['chasselas'], couleur: 'Blanc', millesime: 2024, prixReference: 22 },
    bottle: bottle('demi', '2025-01-01'),
    attendu: { gardeDe: 2025, apogee: 2026, gardeA: 2027 },
    drapeaux: ['aBoire', 'apogee', 'urgent'],
  },
  {
    nom: 'G7 — Effervescent non millésimé, base = acquisition, +1 → moyen',
    wine: { id: 'g7', appellationId: null, cepageIds: [], couleur: 'Effervescent', millesime: null, prixReference: 45 },
    bottle: bottle('standard', '2024-03-01'),
    attendu: { gardeDe: 2026, apogee: 2027, gardeA: 2030 },
    drapeaux: ['aBoire', 'apogee'],
    mentionBSA: true,
  },
  {
    nom: 'G8 — pays XX, couleur Rouge, prixReference null → défaut moyen',
    wine: { id: 'g8', appellationId: null, cepageIds: [], couleur: 'Rouge', millesime: 2020, prixReference: null },
    bottle: bottle('standard', '2022-01-01'),
    attendu: { gardeDe: 2022, apogee: 2023, gardeA: 2026 },
    drapeaux: ['aBoire', 'urgent'],
    explication: 'Couleur Rouge (garde moyenne) + millésime 2020 — appellation et cépage inconnus du référentiel',
  },
  {
    // D16 — une appellation régionale porte tierGarde: null et NE court-circuite PAS le cépage.
    // Sans ce vecteur, déclarer « Valais rouge → moyen » dégraderait silencieusement tous les
    // cornalins, humagnes et syrahs du Valais, correctement classés `garde` par leur cépage.
    nom: 'G10 — appellation sans tier (ch-valais-rouge) : la cascade descend au cépage',
    wine: { id: 'g10', appellationId: 'ch-valais-rouge', cepageIds: ['cornalin'], couleur: 'Rouge', millesime: 2022, prixReference: null },
    bottle: bottle('standard', '2024-01-01'),
    attendu: { gardeDe: 2025, apogee: 2029, gardeA: 2034 },
    drapeaux: ['aBoire'],
    explication: 'Cépage Cornalin (vin de garde) + millésime 2022 — appellation Valais, trop large pour fixer une garde',
  },
  {
    nom: 'G11 — appellation sans tier et aucun cépage : la cascade descend jusqu’à la couleur',
    wine: { id: 'g11', appellationId: 'ch-valais-rouge', cepageIds: [], couleur: 'Rouge', millesime: 2022, prixReference: null },
    bottle: bottle('standard', '2024-01-01'),
    attendu: { gardeDe: 2024, apogee: 2025, gardeA: 2028 },
    drapeaux: ['aBoire', 'apogee'],
    explication: 'Couleur Rouge (garde moyenne) + millésime 2022 — appellation Valais, trop large pour fixer une garde, et cépage inconnu du référentiel',
  },
  {
    // D17 — le Navarra dont le Tempranillo serait inconnu : merlot est SECONDAIRE, il ne décide
    // de rien. Sans le drapeau, ce vin se garderait `garde` (tier du merlot) au lieu de `moyen`.
    nom: 'G12 — cepageDominantInconnu : un cépage secondaire ne gouverne pas',
    wine: { id: 'g12', appellationId: null, cepageIds: ['merlot'], cepageDominantInconnu: true, couleur: 'Rouge', millesime: 2021, prixReference: null },
    bottle: bottle('standard', '2023-01-01'),
    attendu: { gardeDe: 2023, apogee: 2024, gardeA: 2027 },
    drapeaux: ['aBoire', 'urgent'],
    explication: 'Couleur Rouge (garde moyenne) + millésime 2021 — appellation et cépage inconnus du référentiel',
  },
];

for (const v of VECTEURS) {
  test(v.nom, () => {
    const eff = gardeEffective(v.wine, v.bottle, kb);
    assert.equal(eff.gardeDe, v.attendu.gardeDe, 'gardeDe');
    assert.equal(eff.apogee, v.attendu.apogee, 'apogée');
    assert.equal(eff.gardeA, v.attendu.gardeA, 'gardeA');

    const flags = statutsGarde(eff, ANNEE);
    assert.deepEqual(sorted(flags), sorted(v.drapeaux), `drapeaux ${flags}`);

    if (v.mentionBSA) {
      assert.equal(eff.mention, kb.garde.sansMillesime.mention, 'mention BSA affichée');
    } else {
      assert.equal(eff.mention, null, 'aucune mention si millésimé');
    }

    if (v.explication) {
      const canon = calculerGardeVin(v.wine, [v.bottle], kb);
      assert.equal(canon.gardeExplication, v.explication, 'explication');
    }
  });
}

// G9 — ni millésime ni bouteille → null, statut inconnu, facteur 0.85 (pas de NaN).
test('G9 — millésime null, aucune bouteille → null / inconnu / 0.85', () => {
  const wine = { id: 'g9', appellationId: null, cepageIds: [], couleur: 'Rouge', millesime: null, prixReference: null };
  const canon = calculerGardeVin(wine, [], kb);
  assert.equal(canon, null, 'fenêtre canonique nulle');
  const flags = statutsGarde(canon, ANNEE);
  assert.deepEqual(flags, ['inconnu']);
  assert.equal(facteurAccords(flags, kb), 0.85);
});

// apogee et urgent valent tous deux 1.0 : leur coexistence (G6) ne crée aucune ambiguïté.
test('facteur d’accord = max des drapeaux (apogee/urgent = 1.0)', () => {
  assert.equal(facteurAccords(['aBoire', 'apogee', 'urgent'], kb), 1.0);
  assert.equal(facteurAccords(['aBoire'], kb), 0.9);
  assert.equal(facteurAccords(['depasse'], kb), 0.7);
});

// La fenêtre CANONIQUE ignore le format : un magnum (G5) partage la fenêtre standard de son vin.
test('calculerGardeVin est canonique (format standard), gardeEffective applique le magnum', () => {
  const wine = { id: 'g5', appellationId: null, cepageIds: ['pinot-noir'], couleur: 'Rouge', millesime: 2019, prixReference: 65 };
  const canon = calculerGardeVin(wine, [bottle('magnum', '2022-01-01')], kb);
  assert.deepEqual(
    { de: canon.gardeDe, ap: canon.apogee, a: canon.gardeA },
    { de: 2024, ap: 2031, a: 2041 },
    'canonique = standard (2041), pas magnum (2047)',
  );
  const eff = gardeEffective(wine, bottle('magnum', '2022-01-01'), kb);
  assert.equal(eff.gardeA, 2047, 'effective = magnum');
});

// INVARIANT 4 — recalculerGardes ne touche JAMAIS un vin gardeSource:"manuel".
test('invariant 4 : « recalculer tout » saute les gardes manuelles', () => {
  const manuel = {
    id: 'w_m', ref: 1, producteur: 'A', nom: 'x', pays: 'IT', couleur: 'Rouge',
    appellationId: 'it-barolo', cepageIds: ['nebbiolo'], millesime: 2019, prixReference: 60,
    gardeDe: 1999, gardeA: 2001, apogee: 2000, gardeSource: 'manuel', archive: false,
  };
  const auto = {
    id: 'w_a', ref: 2, producteur: 'B', nom: 'y', pays: 'IT', couleur: 'Rouge',
    appellationId: 'it-barolo', cepageIds: ['nebbiolo'], millesime: 2019, prixReference: 60,
    gardeDe: 1999, gardeA: 2001, apogee: 2000, gardeSource: 'auto', archive: false,
  };
  const data = { wines: [manuel, auto], bottles: [] };
  const updates = recalculerGardes(data, kb);
  const ids = updates.map((u) => u.payload.id);
  assert.ok(!ids.includes('w_m'), 'la garde manuelle n’est pas recalculée');
  assert.ok(ids.includes('w_a'), 'la garde auto périmée est recalculée');
  const up = updates.find((u) => u.payload.id === 'w_a');
  assert.equal(up.payload.fields.gardeA, 2041, 'la garde auto est remise à jour (2041)');
});
