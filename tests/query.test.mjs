// query.test.mjs — TEST D'ALIGNEMENT du lot L6 (docs/SPEC_MOTEURS.md §4, fin).
//
// La SEULE preuve mécanique que l'app et Claude Code ne donneront jamais deux réponses différentes :
// la sortie `--json` de scripts/query.mjs doit être EXACTEMENT le tableau [{ wineId, score, drapeaux }]
// que app/accords.js (accordsPourPlat) produit sur la MÊME fixture. Toute divergence casse le test.
//
// On lance la vraie CLI en sous-processus (parse d'arguments + chargement KB disque + sérialisation
// JSON compris) et on la compare à l'appel direct du moteur. Année de référence 2026, passée aux deux
// côtés (--annee) → déterministe quelle que soit la date d'exécution.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

import { buildKb } from '../app/kb.js';
import { accordsPourPlat } from '../app/accords.js';

const execFileP = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

const kb = buildKb({
  garde: await read('kb/garde.json'),
  cepages: await read('kb/cepages.json'),
  regions: await read('kb/regions.json'),
  accords: await read('kb/accords.json'),
});

const ANNEE = 2026;
const PLAT = 'viandes_rouges_grillees'; // « un rouge pour une côte de bœuf » (PRD §8.3)

// Bouteille rangée (slot non nul → chaque suggestion a un casier, PRD §6.5).
const bt = (wineId, date, row, col) => ({
  id: `b_${wineId}`, wineId, format: 'standard', slot: { zone: 'z1', row, col },
  acquisition: { type: 'achat', source: 'Caviste', occasion: null, date, prix: 30, note: null },
});
// Syrah du Valais : appellation (50) + cépage (30) + profil (10) = base 90. Le millésime fixe la
// fenêtre (tier `garde`), donc les DRAPEAUX 2026, donc le facteur — c'est ce qui distingue les scores.
const syrah = (id, ref, millesime) => ({
  id, ref, producteur: 'Domaine du Test', nom: 'Syrah du Valais', pays: 'CH', region: 'Valais',
  couleur: 'Rouge', appellationId: 'ch-valais-syrah', cepageIds: ['syrah'],
  millesime, prixReference: null, valeur: 30, note: null, archive: false,
});

// Fixture : 3 rouges structurés EN STOCK à drapeaux (donc scores) distincts pour exercer le tri,
// + un blanc non concordant (sous le seuil) + un rouge SANS bouteille (doit être exclu — en-stock).
const fixture = {
  schemaVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test',
  zones: [{ id: 'z1', nom: 'Ma cave', rows: 7, cols: 12, rowLabels: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], disabledSlots: [], couleur: '#8E2438', ordre: 1 }],
  wines: [
    syrah('w_apogee', 1, 2018),   // → aBoire+apogee (×1.0) → 90
    syrah('w_aboire', 2, 2020),   // → aBoire (×0.9)        → 81
    syrah('w_depasse', 3, 2008),  // → depasse (×0.7)       → 63
    { id: 'w_blanc', ref: 4, producteur: 'X', nom: 'Fendant', pays: 'CH', region: 'Valais', couleur: 'Blanc', appellationId: 'ch-valais-fendant', cepageIds: ['chasselas'], millesime: 2024, prixReference: null, valeur: 20, note: null, archive: false },
    syrah('w_horsstock', 5, 2019), // aucun bouteille → exclu
  ],
  bottles: [
    bt('w_apogee', '2022-01-01', 'A', '1'),
    bt('w_aboire', '2022-01-01', 'A', '2'),
    bt('w_depasse', '2010-01-01', 'A', '3'),
    bt('w_blanc', '2025-01-01', 'B', '1'),
  ],
  tastings: [],
};

// Liste AFFICHÉE par le moteur = établis, sinon repli (même règle que query.mjs).
function attenduAligne(data) {
  const res = accordsPourPlat(data, PLAT, kb, ANNEE);
  const liste = res.etablis.length ? res.etablis : res.repli;
  return { liste, aligne: liste.map((c) => ({ wineId: c.wineId, score: c.score, drapeaux: c.drapeaux })) };
}

test('alignement : query.mjs --json === accordsPourPlat (même fixture)', async () => {
  const tmp = path.join(os.tmpdir(), `cave-fixture-${process.pid}.json`);
  await writeFile(tmp, JSON.stringify(fixture));
  try {
    const { stdout } = await execFileP('node', [
      path.join(root, 'scripts/query.mjs'),
      '--accord', PLAT, '--en-stock', '--json', '--annee', String(ANNEE), '--data', tmp,
    ]);
    const obtenu = JSON.parse(stdout);
    const { liste, aligne } = attenduAligne(fixture);

    assert.deepEqual(obtenu, aligne, 'la CLI doit reproduire EXACTEMENT le classement du moteur');

    // La question de référence du brief : « 3 vins réellement en cave, avec leur casier ».
    assert.equal(aligne.length, 3, '3 rouges en cave pour la côte de bœuf');
    assert.deepEqual(aligne.map((c) => c.wineId), ['w_apogee', 'w_aboire', 'w_depasse'], 'apogée d’abord, puis aBoire, puis dépassé');
    for (const c of liste) assert.ok(c.bottle?.slot != null, `${c.wineId} : chaque suggestion a un casier`);
  } finally {
    await unlink(tmp).catch(() => {});
  }
});

// Le rouge sans bouteille n'apparaît jamais (invariant en-stock, §2.1) ; le blanc reste sous le seuil.
test('exclusions : hors-stock jamais proposé, blanc sous le seuil absent des établis', () => {
  const { aligne } = attenduAligne(fixture);
  const ids = aligne.map((c) => c.wineId);
  assert.ok(!ids.includes('w_horsstock'), 'un vin sans bouteille n’est jamais proposé');
  assert.ok(!ids.includes('w_blanc'), 'le Fendant blanc n’accompagne pas une côte de bœuf');
});
