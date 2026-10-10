// kb.test.mjs — les vecteurs K1–K8 de docs/SPEC_MOTEURS.md §3.1 (NORMATIFS).
//
// La résolution du KB est la première marche : si elle se trompe, garde.js et accords.js se
// trompent avec elle, et en silence. Ces vecteurs tournent sur le KB RÉEL (kb/*.json), pas sur
// une fixture — c'est le contenu livré qu'on verrouille, autant que le code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildKb } from '../app/kb.js';
import { calculerGardeVin } from '../app/garde.js';
import { profilVin, serviceVin, metsAutomatiques } from '../app/accords.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

const kb = buildKb({
  garde: await read('kb/garde.json'),
  cepages: await read('kb/cepages.json'),
  regions: await read('kb/regions.json'),
  accords: await read('kb/accords.json'),
});

// ---------------------------------------------------------------------------
// K1–K7 — résolution d'appellation sur le couple (libellé, couleur).
// ---------------------------------------------------------------------------

const VECTEURS_APP = [
  ['K1', 'La Côte', 'Rouge', 'ch-vaud-la-cote-rouge', "jamais l'entrée blanche du même nom"],
  ['K2', 'Barolo DOCG', 'Rouge', 'it-barolo', 'mention DOCG retirée'],
  ['K3', 'Ticino DOC', 'Rouge', 'ch-ticino-merlot', 'par synonyme'],
  ['K4', 'Saint-Émilion Grand Cru', 'Rouge', 'fr-saint-emilion', 'par synonyme — « Grand Cru » n’est PAS une mention retirable'],
  ['K5', 'Salento IGT', 'Rouge', 'it-salento', 'mention IGT retirée'],
  ['K6', 'Dézaley', 'Rouge', null, "l'entrée existe en blanc : la couleur ne correspond pas"],
  ['K7', 'Navarra', 'Rouge', null, 'hors périmètre (D15) — refusé ici, accepté par l’app en texte libre'],
];

for (const [ref, texte, couleur, attendu, pourquoi] of VECTEURS_APP) {
  test(`${ref} — « ${texte} » en ${couleur} → ${attendu ?? 'null'} (${pourquoi})`, () => {
    assert.equal(kb.resolveAppellation(texte, couleur), attendu);
  });
}

test('K8 — « Tinta del País » → tempranillo (synonyme de cépage)', () => {
  assert.equal(kb.resolveCepage('Tinta del País'), 'tempranillo');
  assert.equal(kb.resolveCepage('tinta del pais'), 'tempranillo', 'insensible aux accents et à la casse');
});

// ---------------------------------------------------------------------------
// Le bug que K1 verrouille, vu de bout en bout : avant le correctif, un rouge des Côtes de l'Orbe
// héritait de l'entrée BLANCHE (tier `leger`) et se retrouvait « à boire vite » dix ans trop tôt.
// ---------------------------------------------------------------------------

test('un rouge vaudois ne prend jamais le tier d’une appellation blanche', () => {
  const blanche = kb.appellation('ch-vaud-cotes-de-lorbe');
  assert.deepEqual(blanche.couleurs, ['Blanc'], 'prérequis : l’entrée historique est blanche');

  const id = kb.resolveAppellation("Côtes de l'Orbe AOC", 'Rouge');
  assert.equal(id, 'ch-vaud-cotes-de-lorbe-rouge');

  const wine = {
    id: 'w', appellationId: id, cepageIds: ['gamaret', 'garanoir', 'pinot-noir'],
    couleur: 'Rouge', millesime: 2021, prixReference: null,
  };
  const g = calculerGardeVin(wine, [], kb);
  // Tier du Gamaret (`garde`), pas celui de l'entrée blanche (`leger`, qui donnait 2022–2025).
  assert.deepEqual(
    { de: g.gardeDe, a: g.gardeA },
    { de: 2024, a: 2033 },
  );
});

// ---------------------------------------------------------------------------
// D17 — un cépage secondaire suggère, il ne gouverne pas. Les quatre lectures du drapeau.
// ---------------------------------------------------------------------------

test('D17 — cepageDominantInconnu : profil, service et mets retombent sur la couleur', () => {
  const base = { id: 'w', appellationId: null, cepageIds: ['merlot'], couleur: 'Rouge', millesime: 2021, prixReference: null };
  const avecDrapeau = { ...base, cepageDominantInconnu: true };

  const merlot = kb.cepage('merlot');
  assert.deepEqual(profilVin(base, kb), merlot.profil, 'sans drapeau : profil du merlot');
  assert.deepEqual(
    profilVin(avecDrapeau, kb),
    kb.accords.profilDefautParCouleur.Rouge,
    'avec drapeau : profil par défaut de la couleur',
  );

  assert.deepEqual(serviceVin(base, kb).tempC, merlot.service.tempC, 'sans drapeau : service du merlot');
  assert.deepEqual(
    serviceVin(avecDrapeau, kb).tempC,
    kb.accords.service.Rouge.tempC,
    'avec drapeau : service par défaut de la couleur',
  );

  assert.ok(metsAutomatiques(base, kb).length > 0, 'sans drapeau : les mets du merlot');
  assert.deepEqual(metsAutomatiques(avecDrapeau, kb), [], 'avec drapeau : aucun mets hérité du secondaire');
  assert.deepEqual(kb.metsUnionKb(avecDrapeau), [], 'même règle à la saisie (kb.metsUnionKb)');
});

test('D17 — le bonus « un cépage liste ce plat » reste acquis aux secondaires', async () => {
  const { accordsPourPlat } = await import('../app/accords.js');
  const wine = {
    id: 'w_1', ref: 1, appellationId: null, cepageIds: ['merlot'], cepageDominantInconnu: true,
    couleur: 'Rouge', millesime: 2021, prixReference: null, note: null, archive: false, mets: [],
  };
  const data = {
    wines: [wine],
    bottles: [{ id: 'b_1', wineId: 'w_1', format: 'standard', slot: null, acquisition: { type: 'achat', date: '2023-01-01', prix: null } }],
  };
  const plat = 'viandes_rouges_grillees'; // listé par le merlot
  assert.ok(kb.cepage('merlot').accords.includes(plat), 'prérequis');

  const res = accordsPourPlat(data, plat, kb, 2026);
  const tous = [...(res.etablis ?? []), ...(res.repli ?? [])];
  const trouve = tous.find((r) => r.wine.id === 'w_1');
  assert.ok(trouve, 'le vin est proposé');
  assert.ok(
    trouve.sources.some((s) => s.type === 'cepage'),
    'le merlot secondaire compte toujours dans le score',
  );
});

// ---------------------------------------------------------------------------
// Saisie manuelle de la garde : ce que l'utilisateur écrit PRIME sur le moteur.
// La convention de saisie (« 3 » = une durée, « 2029 » = une année) est une règle, pas du DOM :
// elle est extraite du formulaire et vérifiée ici.
// ---------------------------------------------------------------------------

test('anneeDeGarde : sous 100 = durée depuis la base, au-delà = année', async () => {
  const { anneeDeGarde } = await import('../app/views/vins.js');
  assert.equal(anneeDeGarde('3', 2022), 2025, '« 3 ans » sur un 2022');
  assert.equal(anneeDeGarde('6', 2022), 2028);
  assert.equal(anneeDeGarde('0', 2022), 2022, 'une durée nulle reste une durée');
  assert.equal(anneeDeGarde('2029', 2022), 2029, 'une année est prise telle quelle');
  assert.equal(anneeDeGarde('2029', null), 2029, 'une année n’a pas besoin de base');
  assert.equal(anneeDeGarde('3', null), null, 'une durée sans base ne résout pas');
  assert.equal(anneeDeGarde('', 2022), null);
  assert.equal(anneeDeGarde(null, 2022), null);
  assert.equal(anneeDeGarde('-1', 2022), null, 'une valeur négative est refusée');
});

test('une garde manuelle survit au recalcul global (invariant 4, bout en bout)', async () => {
  const { recalculerGardes } = await import('../app/garde.js');
  const { applyOp } = await import('../app/ops.js');
  // Le Nez Noir : le producteur annonce « 3 à 6 ans » au dos, le moteur dirait tout autre chose.
  const wine = {
    id: 'w_1', ref: 1, producteur: 'Rouvinez', nom: 'Nez Noir', pays: 'CH', couleur: 'Rouge',
    appellationId: 'ch-valais-rouge', cepageIds: ['merlot'], millesime: 2022, prixReference: 19.95,
    gardeDe: 2025, apogee: 2026, gardeA: 2028, gardeSource: 'manuel',
    gardeExplication: 'Fenêtre annoncée par le producteur', archive: false,
  };
  let data = { wines: [wine], bottles: [], zones: [], tastings: [] };
  const updates = recalculerGardes(data, kb);
  assert.deepEqual(updates, [], 'aucune mise à jour proposée pour une garde manuelle');
  for (const op of updates) data = applyOp(data, op).data;
  assert.deepEqual(
    { de: data.wines[0].gardeDe, a: data.wines[0].gardeA, src: data.wines[0].gardeSource },
    { de: 2025, a: 2028, src: 'manuel' },
    'la fenêtre du producteur est intacte',
  );
});
