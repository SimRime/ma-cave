// stats.test.mjs — agrégats de la cave (app/stats.js).
//
// Le point le plus important : les DEUX agrégats monétaires sont distincts et jamais confondus
// (PRD §4.2). On le vérifie sur une fixture où un cadeau (prix null) a une valeur non nulle :
// il pèse dans « valeur de la cave » mais PAS dans « montant dépensé ».
// Aucun barème n'est recopié ici : ce module n'en lit aucun (sauf parApogee via le KB réel).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildKb } from '../app/kb.js';
import {
  montantDepense, valeurCave, parRegion, parCouleur, parMillesime,
  parApogee, consommationParMois, achatsParMois, provenance,
} from '../app/stats.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

// Fixture minimale, indépendante de data.json (qui évolue). Trois vins, quatre bouteilles.
// - w1 : valeur 90 ≠ prixRéf 65 (Grisons, Rouge, 2019) — 2 bouteilles dont un cadeau.
// - w2 : valeur 22 = prixRéf 22 (Valais, Blanc, 2024) — un achat.
// - w3 : valeur NULLE, prixRéf 30 (Bordeaux, Rouge, 2015) — un héritage → repli sur prixRéf.
const bt = (id, wineId, type, prix, date, source = null) => ({
  id, wineId, format: 'standard', slot: { zone: 'z', row: 'A', col: '1' },
  acquisition: { type, source, occasion: null, date, prix, note: null },
});

const data = {
  wines: [
    { id: 'w1', ref: 1, producteur: 'A', nom: 'X', pays: 'CH', region: 'Grisons', couleur: 'Rouge', millesime: 2019, prixReference: 65, valeur: 90, archive: false },
    { id: 'w2', ref: 2, producteur: 'B', nom: 'Y', pays: 'CH', region: 'Valais', couleur: 'Blanc', millesime: 2024, prixReference: 22, valeur: 22, archive: false },
    { id: 'w3', ref: 3, producteur: 'C', nom: 'Z', pays: 'FR', region: 'Bordeaux', couleur: 'Rouge', millesime: 2015, prixReference: 30, valeur: null, archive: false },
  ],
  bottles: [
    bt('b1', 'w1', 'achat', 65, '2022-04-12', 'Domaine'),
    bt('b2', 'w1', 'cadeau', null, '2024-03-12', 'Marc'),        // cadeau : prix null
    bt('b3', 'w2', 'achat', 22, '2026-05-30', 'Cave de Fully'),
    bt('b4', 'w3', 'heritage', null, '2020-01-01', 'Cave de Papa'),
  ],
  tastings: [
    { id: 't1', wineId: 'w1', bottleId: 'b0', date: '2026-06-14', note: 17 },
    { id: 't2', wineId: 'w2', bottleId: 'bx', date: '2026-07-02', note: 15 },
  ],
};

const trouve = (arr, cle) => arr.find((x) => x.cle === cle)?.n ?? 0;

test('montant dépensé = Σ des prix payés, cadeaux et héritages exclus (null → 0)', () => {
  assert.equal(montantDepense(data), 65 + 22); // 87
});

test('valeur de la cave = Σ valeur des bouteilles en stock, cadeaux inclus, repli sur prixRéf', () => {
  // b1 90 + b2 90 (cadeau compté) + b3 22 + b4 30 (valeur nulle → prixRéf) = 232
  assert.equal(valeurCave(data), 90 + 90 + 22 + 30);
});

test('les deux agrégats sont distincts — le cadeau pèse dans la valeur, pas dans le montant', () => {
  assert.notEqual(montantDepense(data), valeurCave(data));
  // Retirer le cadeau ne change pas le montant, mais baisse la valeur de 90.
  const sansCadeau = { ...data, bottles: data.bottles.filter((b) => b.id !== 'b2') };
  assert.equal(montantDepense(sansCadeau), montantDepense(data));
  assert.equal(valeurCave(sansCadeau), valeurCave(data) - 90);
});

test('répartition par région / couleur / millésime', () => {
  assert.equal(trouve(parRegion(data), 'Grisons'), 2);
  assert.equal(trouve(parRegion(data), 'Valais'), 1);
  assert.equal(trouve(parRegion(data), 'Bordeaux'), 1);
  assert.equal(trouve(parCouleur(data), 'Rouge'), 3);
  assert.equal(trouve(parCouleur(data), 'Blanc'), 1);
  assert.equal(trouve(parMillesime(data), '2019'), 2);
  // Millésimes triés chronologiquement (histogramme).
  assert.deepEqual(parMillesime(data).map((x) => x.cle), ['2015', '2019', '2024']);
});

test('provenance : comptes par type + « offert par » et « reste de »', () => {
  const p = provenance(data);
  assert.equal(trouve(p.parType, 'achat'), 2);
  assert.equal(trouve(p.parType, 'cadeau'), 1);
  assert.equal(trouve(p.parType, 'heritage'), 1);
  assert.deepEqual(p.cadeaux, [{ cle: 'Marc', n: 1 }]);
  assert.deepEqual(p.heritages, [{ cle: 'Cave de Papa', n: 1 }]);
});

test('séries mensuelles : fenêtre glissante, dates hors fenêtre ignorées', () => {
  const maintenant = new Date(2026, 6, 16); // juillet 2026 (mois 0-based = 6)
  const conso = consommationParMois(data, 24, maintenant);
  assert.equal(conso.length, 24);
  assert.equal(conso[conso.length - 1].mois, '2026-07');
  assert.equal(trouve2(conso, '2026-07'), 1); // t2
  assert.equal(trouve2(conso, '2026-06'), 1); // t1
  // Achats : seule b3 (2026-05) tombe dans les 24 mois ; b1/b2/b4 sont hors fenêtre.
  const achats = achatsParMois(data, 24, maintenant);
  assert.equal(achats.reduce((s, m) => s + m.n, 0), 1);
  assert.equal(trouve2(achats, '2026-05'), 1);
});

const trouve2 = (serie, mois) => serie.find((x) => x.mois === mois)?.n ?? 0;

test('parApogee regroupe par année d’apogée via le moteur de garde (KB réel)', async () => {
  const kb = buildKb({
    garde: await read('kb/garde.json'),
    cepages: await read('kb/cepages.json'),
    regions: await read('kb/regions.json'),
    accords: await read('kb/accords.json'),
  });
  const agg = parApogee(data, kb);
  // Somme des comptes = nombre de bouteilles ; chaque clé est une année ou « Inconnue ».
  assert.equal(agg.reduce((s, x) => s + x.n, 0), data.bottles.length);
  for (const { cle } of agg) assert.match(cle, /^(\d{4}|Inconnue)$/);
});
