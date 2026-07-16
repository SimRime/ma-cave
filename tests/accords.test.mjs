// accords.test.mjs — les 8 vecteurs A1–A8 de docs/SPEC_MOTEURS.md §4 (NORMATIFS).
//
// Année de référence : 2026 (passée explicitement → test déterministe quelle que soit la date).
// Le barème n'est JAMAIS recopié ici : kb/accords.json fait foi, on ne vérifie que ses SORTIES.
// La contrainte « aucune constante métier en dur » vise le code du moteur ; un test PEUT construire
// des scénarios (A8 s'appuie sur un KB synthétique minimal, cf. plus bas).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildKb } from '../app/kb.js';
import { evaluerAccord, accordsPourPlat, profilVin } from '../app/accords.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

const gardeKb = await read('kb/garde.json');
const cepagesKb = await read('kb/cepages.json');
const regionsKb = await read('kb/regions.json');
const accordsKb = await read('kb/accords.json');

const kb = buildKb({ garde: gardeKb, cepages: cepagesKb, regions: regionsKb, accords: accordsKb });

const ANNEE = 2026;
// Une bouteille standard rattachée au vin (pour la fenêtre EFFECTIVE, via statutVin qui filtre par wineId).
const bt = (wineId, date, format = 'standard') => ({
  id: `b_${wineId}`, wineId, format, slot: { zone: 'z', row: 'A', col: '1' },
  acquisition: { type: 'achat', source: null, occasion: null, date, prix: null, note: null },
});

// Chaque vecteur : le vin, ses bouteilles, le plat, le score attendu et l'exclusion attendue.
// Réf. SPEC_MOTEURS.md §4 (valeurs revérifiées contre le KB réel).
const VECTEURS = [
  {
    nom: 'A1 — Fendant 2024 / fondue → 80 (appellation 50 + cépage 30, apogée ×1.0)',
    wine: { id: 'a1', ref: 1, appellationId: 'ch-valais-fendant', cepageIds: ['chasselas'], couleur: 'Blanc', millesime: 2024, prixReference: 22, note: null, archive: false },
    bottles: [bt('a1', '2025-01-01')],
    plat: 'fondue', score: 80, exclu: false,
  },
  {
    nom: 'A2 — Barolo 2019 / raclette → 0 EXCLU (anti-règle tanin 5 ≥ 3)',
    wine: { id: 'a2', ref: 2, appellationId: 'it-barolo', cepageIds: ['nebbiolo'], couleur: 'Rouge', millesime: 2019, prixReference: 60, note: null, archive: false },
    bottles: [bt('a2', '2022-01-01')],
    plat: 'raclette', score: 0, exclu: true,
  },
  {
    nom: 'A3 — Barolo 2019 / gibier → 81 (50 + 30 + profil 10, aBoire ×0.9)',
    wine: { id: 'a3', ref: 3, appellationId: 'it-barolo', cepageIds: ['nebbiolo'], couleur: 'Rouge', millesime: 2019, prixReference: 60, note: null, archive: false },
    bottles: [bt('a3', '2022-01-01')],
    plat: 'gibier', score: 81, exclu: false,
  },
  {
    nom: 'A4 — Barbera (appellation hors KB) / pâtes tomate → 34 (cépage 30 + profil 8, aBoire ×0.9)',
    wine: { id: 'a4', ref: 4, appellationId: null, cepageIds: ['barbera'], couleur: 'Rouge', millesime: 2020, prixReference: null, note: null, archive: false },
    bottles: [bt('a4', '2022-01-01')],
    plat: 'pates_tomate', score: 34, exclu: false,
  },
  {
    nom: 'A5 — Blanc XX, cépage inconnu, garde inconnue / raclette → 9 (profil défaut Blanc 10, inconnu ×0.85)',
    wine: { id: 'a5', ref: 5, appellationId: null, cepageIds: [], couleur: 'Blanc', millesime: null, prixReference: null, note: null, archive: false },
    bottles: [], // garde inconnue (ni millésime ni bouteille) → facteur 0.85
    plat: 'raclette', score: 9, exclu: false,
  },
  {
    nom: 'A6 — Rouge XX, cépage inconnu / raclette → 0 EXCLU (profil défaut Rouge : tanin 3 → anti-règle)',
    wine: { id: 'a6', ref: 6, appellationId: null, cepageIds: [], couleur: 'Rouge', millesime: 2020, prixReference: null, note: null, archive: false },
    bottles: [bt('a6', '2022-01-01')],
    plat: 'raclette', score: 0, exclu: true,
  },
  {
    nom: 'A7 — Syrah du Valais 2020 / viandes rouges grillées → 81 (50 + 30 + profil 10, aBoire ×0.9)',
    wine: { id: 'a7', ref: 7, appellationId: 'ch-valais-syrah', cepageIds: ['syrah'], couleur: 'Rouge', millesime: 2020, prixReference: null, note: null, archive: false },
    bottles: [bt('a7', '2022-01-01')],
    plat: 'viandes_rouges_grillees', score: 81, exclu: false,
  },
];

for (const v of VECTEURS) {
  test(v.nom, () => {
    const ev = evaluerAccord(v.wine, v.bottles, v.plat, kb, ANNEE);
    assert.equal(ev.exclu, v.exclu, `exclusion (${ev.raison})`);
    assert.equal(ev.score, v.score, 'score');
  });
}

// A8 — plafond à 100 appliqué AVANT le facteur (50 + 30 + 35 = 115 → 100, ×1.0 = 100).
// Aucun vin réel n'atteint 115 (le profil réel plafonne à 12 pour un plat donné) : on construit un
// KB synthétique minimal — une appellation et un cépage factices citant le plat `truffe`, plus une
// règle de profil de poids 40 (→ plafonnée à ponderation.profil) citant le même plat. On ne recopie
// aucun chiffre du barème : on réutilise les poids réels (50/30/plafond) et on force juste la 3e source.
test('A8 — base 115 plafonnée à 100 AVANT le facteur → score 100', () => {
  const accordsSynth = JSON.parse(JSON.stringify(accordsKb));
  accordsSynth.reglesProfil.regles.push({ si: { corps: '>=1' }, plats: ['truffe'], poids: 40 });

  const cepagesSynth = JSON.parse(JSON.stringify(cepagesKb));
  cepagesSynth.cepages.push({
    id: 'x-cep', nom: 'Synthé', synonymes: [], couleur: 'noir', pays: ['XX'],
    profil: { corps: 5, tanin: 5, acidite: 3, sucre: 0, aromatique: 3 },
    aromes: [], tierGarde: 'moyen', accords: ['truffe'],
    service: { tempC: [16, 18], carafage: '60 min', verre: 'ballon' },
  });

  const regionsSynth = JSON.parse(JSON.stringify(regionsKb));
  regionsSynth.pays.push({
    code: 'XX', nom: 'Synthétique',
    regions: [{ id: 'x-reg', nom: 'Synthé', sousRegions: [], appellations: [
      { id: 'x-app', nom: 'Synthé', sousRegion: null, couleurs: ['Rouge'], cepages: ['x-cep'], tierGarde: 'moyen', accords: ['truffe'] },
    ] }],
  });

  const kbS = buildKb({ garde: gardeKb, cepages: cepagesSynth, regions: regionsSynth, accords: accordsSynth });
  // millésime 2022, tier moyen → apogée 2026 (facteur 1.0).
  const wine = { id: 'a8', ref: 8, appellationId: 'x-app', cepageIds: ['x-cep'], couleur: 'Rouge', millesime: 2022, prixReference: null, note: null, archive: false };
  const ev = evaluerAccord(wine, [bt('a8', '2022-01-01')], 'truffe', kbS, ANNEE);
  assert.equal(ev.base, 100, 'base plafonnée à 100 (pas 115)');
  assert.equal(ev.facteur, 1.0, 'facteur apogée = 1.0');
  assert.equal(ev.score, 100, 'score = round(100 × 1.0)');
});

// ---------------------------------------------------------------------------
// Assertions comportementales de docs/BRIEFS_LOTS.md L4.
// ---------------------------------------------------------------------------

// « Raclette » propose des blancs vifs et AUCUN rouge tannique (les anti-règles écartent tanin ≥ 3).
test('Raclette : aucun rouge tannique dans les suggestions', async () => {
  const data = await read('data.json');
  const res = accordsPourPlat(data, 'raclette', kb, ANNEE);
  const tous = [...res.etablis, ...res.repli];
  assert.ok(tous.length > 0, 'au moins une suggestion (le Fendant)');
  for (const c of tous) {
    assert.ok(profilVin(c.wine, kb).tanin < 3, `${c.wine.nom} ne doit pas être tannique sur une raclette`);
    assert.ok(c.emplacement != null, `${c.wine.nom} : chaque suggestion affiche l'emplacement`);
  }
});

// « Côte de bœuf » (viandes_rouges_grillées) : rouges structurés, à l'apogée d'abord.
test('Côte de bœuf : rouges structurés triés à l’apogée d’abord', () => {
  const wineSyrah = (id, ref, millesime) => ({
    id, ref, producteur: 'X', nom: `Syrah ${millesime}`, pays: 'CH', couleur: 'Rouge',
    appellationId: 'ch-valais-syrah', cepageIds: ['syrah'], millesime, prixReference: null, note: null, archive: false,
  });
  const data = {
    wines: [wineSyrah('wJ', 1, 2020), wineSyrah('wA', 2, 2018)], // 2020 → aBoire (0.9), 2018 → apogée (1.0)
    bottles: [bt('wJ', '2022-01-01'), bt('wA', '2020-01-01')],
  };
  const res = accordsPourPlat(data, 'viandes_rouges_grillees', kb, ANNEE);
  assert.equal(res.etablis.length, 2, 'les deux rouges structurés sont établis');
  assert.equal(res.etablis[0].wineId, 'wA', 'le vin à l’apogée arrive en tête');
  assert.ok(res.etablis[0].score > res.etablis[1].score, 'apogée (×1.0) devant aBoire (×0.9)');
  assert.ok(res.etablis[0].emplacement != null, 'l’emplacement est fourni');
});
