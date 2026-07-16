// make-fixture.mjs — jeu de CHARGE pour vérifier la fluidité du Plan (lot L2, PRD §7.1).
//
// Génère une cave à DEUX zones totalisant 170 casiers utilisables (84 + 86) : la cave réelle plus le
// second meuble envisagé. Sert à vérifier, sur le téléphone cible, que le scroll et le curseur de taille
// restent fluides à 170 casiers — un nœud DOM par casier, pas de canvas, pas de virtualisation.
//
//   node scripts/make-fixture.mjs               # écrit sur stdout
//   node scripts/make-fixture.mjs fixture.json  # écrit dans le fichier
//   node scripts/make-fixture.mjs | node scripts/validate-data.mjs /dev/stdin
//
// La sortie valide le schéma ET les six invariants (à vérifier avec scripts/validate-data.mjs).

import { writeFile } from 'node:fs/promises';
import { slotKey } from '../app/format.js';

const WINES = [
  { producteur: 'Domaine Gantenbein', nom: 'Pinot Noir', pays: 'CH', couleur: 'Rouge', millesime: 2019, cepages: ['Pinot Noir'] },
  { producteur: 'Marie-Thérèse Chappaz', nom: 'Fendant de Fully', pays: 'CH', couleur: 'Blanc', millesime: 2023, cepages: ['Chasselas'] },
  { producteur: 'Guigal', nom: 'Côte Rôtie Brune et Blonde', pays: 'FR', couleur: 'Rouge', millesime: 2018, cepages: ['Syrah', 'Viognier'] },
  { producteur: 'Domaine Weinbach', nom: 'Riesling Schlossberg', pays: 'FR', couleur: 'Blanc', millesime: 2020, cepages: ['Riesling'] },
  { producteur: 'Gaja', nom: 'Barbaresco', pays: 'IT', couleur: 'Rouge', millesime: 2017, cepages: ['Nebbiolo'] },
  { producteur: 'Château d’Yquem', nom: 'Sauternes', pays: 'FR', couleur: 'Liquoreux', millesime: 2015, cepages: ['Sémillon', 'Sauvignon'] },
  { producteur: 'Bollinger', nom: 'Special Cuvée', pays: 'FR', couleur: 'Effervescent', millesime: null, cepages: ['Pinot Noir', 'Chardonnay'] },
  { producteur: 'Domaine Berthet-Bondet', nom: 'Château-Chalon', pays: 'FR', couleur: 'Jaune', millesime: 2016, cepages: ['Savagnin'] },
  { producteur: 'Domaine Ott', nom: 'Bandol Rosé', pays: 'FR', couleur: 'Rosé', millesime: 2023, cepages: ['Mourvèdre', 'Grenache'] },
];

const wines = WINES.map((w, i) => ({
  id: `w_${i + 1}`,
  ref: i + 1,
  producteur: w.producteur,
  nom: w.nom,
  pays: w.pays,
  region: null,
  appellation: null,
  appellationId: null,
  sousRegion: null,
  couleur: w.couleur,
  millesime: w.millesime,
  cepages: w.cepages,
  cepageIds: [],
  prixReference: 20 + i * 5,
  valeur: 20 + i * 5,
  gardeDe: w.millesime ? w.millesime + 1 : null,
  gardeA: w.millesime ? w.millesime + 12 : null,
  apogee: w.millesime ? w.millesime + 6 : null,
  gardeSource: 'auto',
  gardeExplication: 'Estimation de charge (fixture).',
  mets: [],
  metsSource: 'auto',
  note: null,
  commentaire: null,
  archive: false,
}));

// Deux zones. z2 a 96 casiers dont 10 désactivés (dernière rangée, colonnes 3–12) → 86 utilisables.
const letters = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
const z2disabled = Array.from({ length: 10 }, (_, i) => slotKey('H', String(i + 3)));

const zones = [
  { id: 'z1', nom: 'Ma cave', rows: 7, cols: 12, rowLabels: letters(7), disabledSlots: [], couleur: '#8E2438', ordre: 1 },
  { id: 'z2', nom: 'Second meuble', rows: 8, cols: 12, rowLabels: letters(8), disabledSlots: z2disabled, couleur: '#3A6B4F', ordre: 2 },
];

// Remplit ~80 % des casiers utilisables ; laisse des casiers libres pour tester le placement.
const FORMATS = ['standard', 'standard', 'standard', 'standard', 'magnum', 'demi'];
const bottles = [];
let n = 0;
let cursor = 0;
for (const z of zones) {
  const disabled = new Set(z.disabledSlots);
  for (const row of z.rowLabels) {
    for (let c = 1; c <= z.cols; c++) {
      const col = String(c);
      if (disabled.has(slotKey(row, col))) continue;
      cursor += 1;
      if (cursor % 5 === 0) continue; // 1 casier sur 5 reste libre
      const wine = wines[cursor % wines.length];
      let format = FORMATS[cursor % FORMATS.length];
      if (wine.couleur === 'Jaune') format = 'clavelin'; // le vin jaune est en clavelin (62 cl)
      const gift = cursor % 7 === 0;
      bottles.push({
        id: `b_${(n += 1)}`,
        wineId: wine.id,
        format,
        slot: { zone: z.id, row, col },
        acquisition: gift
          ? { type: 'cadeau', source: 'Un ami', occasion: null, date: '2024-12-24', prix: null, note: null }
          : { type: 'achat', source: 'Caviste', occasion: null, date: '2023-09-15', prix: wine.prixReference, note: null },
      });
    }
  }
}

const data = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: 'make-fixture',
  zones,
  wines,
  bottles,
  tastings: [],
};

const usable = zones.reduce((m, z) => m + z.rows * z.cols - z.disabledSlots.length, 0);
const json = JSON.stringify(data, null, 2) + '\n';
const out = process.argv[2];
if (out) {
  await writeFile(out, json);
  console.error(`✅ ${out} — ${zones.length} zones, ${usable} casiers utilisables, ${bottles.length} bouteilles.`);
} else {
  process.stdout.write(json);
}
