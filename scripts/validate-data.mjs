// validate-data.mjs — vérifie data.json : le SCHÉMA (ajv) puis les projections statiques
// vérifiables des SIX invariants (CLAUDE.md). À lancer à la main avant toute proposition.
//
//   node scripts/validate-data.mjs [chemin/vers/data.json]
//
// ajv/ajv-formats sont des devDependencies Node — jamais servies au navigateur (D12).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js'; // le schéma est en draft 2020-12 (voir son $schema)
import addFormats from 'ajv-formats';
import { slotKey } from '../app/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data.json');

const schema = JSON.parse(await readFile(path.join(root, 'schema/data.schema.json'), 'utf8'));
const data = JSON.parse(await readFile(dataPath, 'utf8'));

const errors = [];
const fail = (inv, msg) => errors.push(`[${inv}] ${msg}`);

// --- Schéma (fait foi) ----------------------------------------------------------------------
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(data)) {
  for (const e of validate.errors) fail('schéma', `${e.instancePath || '/'} ${e.message}`);
}

// --- Helpers d'invariants -------------------------------------------------------------------
const zones = new Map(data.zones.map((z) => [z.id, z]));
const rowLabels = (z) => z.rowLabels ?? Array.from({ length: z.rows }, (_, i) => String.fromCharCode(65 + i));
const colLabels = (z) => z.colLabels ?? Array.from({ length: z.cols }, (_, i) => String(i + 1));

const uniq = (values, label, inv) => {
  const seen = new Set();
  for (const v of values) {
    if (seen.has(v)) fail(inv, `${label} en double : ${v}`);
    seen.add(v);
  }
};

// --- Invariant 3 : ref et ids uniques -------------------------------------------------------
uniq(data.zones.map((z) => z.id), 'id de zone', 'invariant 3');
uniq(data.wines.map((w) => w.id), 'id de vin', 'invariant 3');
uniq(data.bottles.map((b) => b.id), 'id de bouteille', 'invariant 3');
uniq(data.tastings.map((t) => t.id), 'id de dégustation', 'invariant 3');
uniq(data.wines.map((w) => w.ref), 'ref de vin', 'invariant 3');
for (const w of data.wines) {
  if (!(Number.isInteger(w.ref) && w.ref >= 1)) fail('invariant 3', `ref invalide pour ${w.id} : ${w.ref}`);
}

// --- Invariant 2 : un casier ≤ une bouteille, dans les limites, hors casiers désactivés ------
const owners = new Map();
for (const b of data.bottles) {
  if (!b.slot) continue;
  const z = zones.get(b.slot.zone);
  if (!z) continue; // signalé par l'invariant 5/6 ci-dessous
  const key = `${b.slot.zone}|${b.slot.row}|${b.slot.col}`;
  if (owners.has(key)) {
    fail('invariant 2', `casier ${b.slot.zone} ${b.slot.row}${b.slot.col} occupé par ${owners.get(key)} ET ${b.id}`);
  } else {
    owners.set(key, b.id);
  }
  if (!rowLabels(z).includes(b.slot.row) || !colLabels(z).includes(b.slot.col)) {
    fail('invariant 2', `bouteille ${b.id} hors des limites de ${z.id} : ${b.slot.row}${b.slot.col}`);
  }
  if ((z.disabledSlots ?? []).includes(slotKey(b.slot.row, b.slot.col))) {
    fail('invariant 2', `bouteille ${b.id} sur un casier désactivé : ${b.slot.row}${b.slot.col}`);
  }
}

// --- Invariants 5 & 6 : intégrité référentielle (projection statique) ------------------------
const wineIds = new Set(data.wines.map((w) => w.id));
for (const b of data.bottles) {
  if (!zones.has(b.slot?.zone) && b.slot) fail('invariant 5/6', `bouteille ${b.id} sur une zone inconnue : ${b.slot.zone}`);
  if (!wineIds.has(b.wineId)) fail('invariant 5/6', `bouteille ${b.id} référence un vin inexistant : ${b.wineId}`);
}
for (const t of data.tastings) {
  if (!wineIds.has(t.wineId)) fail('invariant 6', `dégustation ${t.id} référence un vin inexistant : ${t.wineId}`);
  // tasting.bottleId n'est PAS vérifié : la bouteille bue n'existe plus (schéma + CLAUDE.md).
}

// Invariants 1 (stock dérivé) et 4 (valeur « manuel » non écrasée) sont des invariants de
// PROCESSUS, garantis par app/ops.js. Le schéma (additionalProperties:false, aucun champ
// « reste ») en couvre la part statique.

// --- Verdict --------------------------------------------------------------------------------
if (errors.length) {
  console.error(`❌ ${path.relative(root, dataPath)} invalide — ${errors.length} problème(s) :`);
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}
console.log(`✅ ${path.relative(root, dataPath)} valide : schéma + projections statiques des 6 invariants.`);
