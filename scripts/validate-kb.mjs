// validate-kb.mjs — vérifie kb/cepages.json et kb/regions.json : les SCHÉMAS (ajv) puis
// l'intégrité référentielle du KB. À lancer après CHAQUE région d'un lot L1 (CLAUDE.md, brief L1).
//
//   node scripts/validate-kb.mjs
//
// Vérifie :
//   - cepages.json valide contre schema/kb.cepages.schema.json ;
//   - regions.json valide contre schema/kb.regions.schema.json ;
//   - tout cépage cité par une appellation existe dans cepages.json ;
//   - tout cépage a un tierGarde ;
//   - tout id de plat cité (cepage.accords ET appellation.accords) existe dans kb/accords.json ;
//   - unicité des id de cépage et d'appellation.
// Ne vérifie PAS tasting.bottleId : hors périmètre KB (c'est data.json ; CLAUDE.md).
//
// ajv/ajv-formats sont des devDependencies Node — jamais servies au navigateur (D12).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js'; // les schémas sont en draft 2020-12 (voir leur $schema)
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

const [cepagesSchema, regionsSchema, cepages, regions, accords] = await Promise.all([
  read('schema/kb.cepages.schema.json'),
  read('schema/kb.regions.schema.json'),
  read('kb/cepages.json'),
  read('kb/regions.json'),
  read('kb/accords.json'),
]);

const errors = [];
const fail = (scope, msg) => errors.push(`[${scope}] ${msg}`);

// --- Schémas (font foi) ---------------------------------------------------------------------
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const check = (schema, doc, label) => {
  const validate = ajv.compile(schema);
  if (!validate(doc)) {
    for (const e of validate.errors) fail(`schéma ${label}`, `${e.instancePath || '/'} ${e.message}`);
  }
};
check(cepagesSchema, cepages, 'cepages');
check(regionsSchema, regions, 'regions');

// --- Index -----------------------------------------------------------------------------------
const cepageIds = new Set(cepages.cepages.map((c) => c.id));
const platIds = new Set(accords.plats.map((p) => p.id));

const uniq = (values, label) => {
  const seen = new Set();
  for (const v of values) {
    if (seen.has(v)) fail('unicité', `${label} en double : ${v}`);
    seen.add(v);
  }
};

// --- Unicité des id --------------------------------------------------------------------------
uniq(cepages.cepages.map((c) => c.id), 'id de cépage');
const appellations = regions.pays.flatMap((p) =>
  p.regions.flatMap((r) => r.appellations.map((a) => ({ ...a, _region: r.id }))),
);
uniq(regions.pays.flatMap((p) => p.regions.map((r) => r.id)), 'id de région');
uniq(appellations.map((a) => a.id), 'id d\'appellation');

// --- Tout cépage a un tierGarde (le schéma l'exige ; on le revérifie explicitement) ----------
for (const c of cepages.cepages) {
  if (!c.tierGarde) fail('cépage', `${c.id} sans tierGarde`);
}

// --- Tout cépage cité par une appellation existe ---------------------------------------------
for (const a of appellations) {
  for (const id of a.cepages ?? []) {
    if (!cepageIds.has(id)) {
      fail('référence', `appellation ${a.id} cite un cépage inexistant : ${id}`);
    }
  }
}

// --- Tout id de plat cité existe dans kb/accords.json > plats ---------------------------------
for (const c of cepages.cepages) {
  for (const id of c.accords ?? []) {
    if (!platIds.has(id)) fail('référence', `cépage ${c.id} cite un plat inexistant : ${id}`);
  }
}
for (const a of appellations) {
  for (const id of a.accords ?? []) {
    if (!platIds.has(id)) fail('référence', `appellation ${a.id} cite un plat inexistant : ${id}`);
  }
}

// --- Verdict ---------------------------------------------------------------------------------
if (errors.length) {
  console.error(`❌ kb/ invalide — ${errors.length} problème(s) :`);
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}
console.log(
  `✅ kb/ valide : schémas + intégrité référentielle ` +
    `(${cepages.cepages.length} cépages, ${appellations.length} appellations).`,
);
