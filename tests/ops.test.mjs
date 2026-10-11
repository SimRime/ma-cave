// ops.test.mjs — LE test qui compte pour L0 (BRIEFS_LOTS.md, DECISIONS.md D10).
//
// Deux opérations concurrentes sur des états différents → l'app détecte le 409, recharge,
// RÉAPPLIQUE l'opération, et les deux modifications survivent avec DEUX ref distinctes.
// Le scénario passe par l'API publique de github.js (donc par le vrai base64 UTF-8 et la vraie
// boucle de retry), avec un `fetchImpl` injecté qui simule GitHub en mémoire.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as github from '../app/github.js';
import { applyOp, OpAbortError } from '../app/ops.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedRaw = await readFile(path.join(root, 'data.json'), 'utf8');
const seed = () => JSON.parse(seedRaw); // une copie fraîche par test.

// --- Faux GitHub en mémoire ----------------------------------------------------------------
// Stocke { json, sha }. En base64 côté transport (comme l'API contents). Peut simuler un commit
// concurrent de « Bob » au premier PUT pour forcer un 409 réaliste.
function makeFakeGitHub(seedData, { injectBobOnFirstPut = false } = {}) {
  const server = { json: JSON.stringify(seedData), sha: 'sha-0' };
  let putCount = 0;
  const enc = (s) => Buffer.from(s, 'utf8').toString('base64');
  const dec = (s) => Buffer.from(s, 'base64').toString('utf8');
  const headers = new Headers({ 'x-ratelimit-remaining': '4999' });
  const resp = (status, obj) => ({ ok: status >= 200 && status < 300, status, headers, json: async () => obj });

  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    if (method === 'GET') {
      return resp(200, { content: enc(server.json), sha: server.sha });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      putCount += 1;
      // Premier PUT : Bob a commité entre-temps (état différent) → 409.
      if (injectBobOnFirstPut && putCount === 1) {
        const bob = applyOp(JSON.parse(server.json), {
          type: 'ADD_WINE',
          payload: { producteur: 'Domaine de Bob', nom: 'Gamay', pays: 'CH', couleur: 'Rouge' },
        });
        server.json = JSON.stringify(bob.data);
        server.sha = 'sha-1';
        return resp(409, { message: 'sha does not match' });
      }
      if (body.sha !== server.sha) return resp(409, { message: 'sha does not match' });
      server.json = dec(body.content); // ce que l'app a réellement encodé (teste le base64)
      server.sha = `sha-${putCount + 1}`;
      return resp(200, { content: { sha: server.sha }, commit: { sha: `commit-${putCount}` } });
    }
    return resp(404, {});
  }

  return { fetchImpl, server };
}

// --- LE test 409 ---------------------------------------------------------------------------
test('conflit 409 : deux ADD_WINE concurrents survivent, avec deux ref distinctes', async () => {
  const data = seed();
  const maxRefBefore = Math.max(...data.wines.map((w) => w.ref)); // 2 dans la graine
  const fake = makeFakeGitHub(data, { injectBobOnFirstPut: true });
  github.configure({ token: 'tok', user: 'Alice', backoffMs: 0, fetchImpl: fake.fetchImpl });

  const res = await github.pushOperation({
    type: 'ADD_WINE',
    payload: { producteur: 'Domaine de la Côte Rôtie', nom: 'Syrah', pays: 'FR', couleur: 'Rouge' },
  });

  assert.equal(res.retries, 1, 'un retry attendu (le 1er PUT a pris un 409)');

  const final = JSON.parse(fake.server.json);
  const bob = final.wines.find((w) => w.producteur === 'Domaine de Bob');
  const alice = final.wines.find((w) => w.producteur === 'Domaine de la Côte Rôtie');

  assert.ok(bob, 'le vin de Bob a survécu au conflit');
  assert.ok(alice, 'le vin d’Alice a survécu au conflit');
  assert.notEqual(bob.ref, alice.ref, 'les deux ref sont distinctes');
  assert.notEqual(bob.id, alice.id, 'les deux id sont distincts');
  assert.equal(bob.ref, maxRefBefore + 1, 'Bob a pris ref 3');
  assert.equal(alice.ref, maxRefBefore + 2, 'Alice a été réattribuée à ref 4 après rechargement');
  assert.equal(alice.id, `w_${alice.ref}`, 'id dérivé de ref (source monotone unique)');
  assert.ok(alice.producteur.includes('Rôtie'), 'le producteur accentué a traversé le base64 UTF-8');
  assert.equal(final.updatedBy, 'Alice', 'updatedBy = dernier écrivain');
});

// --- Préconditions rompues -----------------------------------------------------------------
test('DRINK_BOTTLE sur une bouteille absente : no-op idempotent, aucune écriture', async () => {
  const fake = makeFakeGitHub(seed());
  github.configure({ token: 'tok', user: 'Bob', backoffMs: 0, fetchImpl: fake.fetchImpl });
  const res = await github.pushOperation({ type: 'DRINK_BOTTLE', payload: { bottleId: 'b_inexistante' } });
  assert.equal(res.noop, true);
  assert.match(res.message, /déjà bue/);
  assert.equal(fake.server.sha, 'sha-0', 'aucun PUT : le serveur n’a pas bougé');
});

test('PLACE_BOTTLE sur un casier occupé : OpAbortError (invariant 2)', () => {
  const data = seed(); // le magnum b_2 occupe A2 dans la graine
  assert.throws(
    () => applyOp(data, { type: 'PLACE_BOTTLE', payload: { bottleId: 'b_3', slot: { zone: 'z1', row: 'A', col: '2' } } }),
    (e) => e instanceof OpAbortError && e.code === 'SLOT_OCCUPIED',
  );
});

test('DELETE_WINE d’un vin avec bouteilles : OpAbortError (invariant 5)', () => {
  const data = seed(); // w_1 a deux bouteilles
  assert.throws(
    () => applyOp(data, { type: 'DELETE_WINE', payload: { id: 'w_1' } }),
    (e) => e instanceof OpAbortError && e.code === 'WINE_HAS_BOTTLES',
  );
});

// --- Allocation d'ids (D9) -----------------------------------------------------------------
test('deux ADD_WINE séquentiels : ref et id strictement croissants, alloués par l’op', () => {
  // La graine est la VRAIE cave, qui grandit : les attentes se dérivent d'elle. Coder « w_3 » en dur
  // ferait tomber ce test au prochain vin ajouté, sans que ops.js ait changé.
  const derniereRef = seed().wines.reduce((m, w) => Math.max(m, w.ref), 0);
  const r1 = applyOp(seed(), { type: 'ADD_WINE', payload: { producteur: 'A', nom: 'x', pays: 'FR', couleur: 'Rouge' } });
  const r2 = applyOp(r1.data, { type: 'ADD_WINE', payload: { producteur: 'B', nom: 'y', pays: 'FR', couleur: 'Blanc' } });
  assert.equal(r1.ids.wineId, `w_${derniereRef + 1}`);
  assert.equal(r2.ids.wineId, `w_${derniereRef + 2}`);
  assert.equal(r2.data.wines.at(-1).ref, derniereRef + 2);
});

test('applyOp ne mute pas le document d’entrée (rejeu propre)', () => {
  const data = seed();
  const before = JSON.stringify(data);
  applyOp(data, { type: 'ADD_WINE', payload: { producteur: 'A', nom: 'x', pays: 'FR', couleur: 'Rouge' } });
  assert.equal(JSON.stringify(data), before);
});

// --- COPY_BOTTLE : création + placement atomiques ------------------------------------------
// Dérive de la graine (la vraie cave) une bouteille rangée et un casier libre de sa zone.
function copyFixture() {
  const data = seed();
  const src = data.bottles.find((b) => b.slot);
  const z = data.zones.find((zz) => zz.id === src.slot.zone);
  const rows = z.rowLabels ?? Array.from({ length: z.rows }, (_, i) => String.fromCharCode(65 + i));
  const cols = z.colLabels ?? Array.from({ length: z.cols }, (_, i) => String(i + 1));
  const taken = (row, col) => data.bottles.some((b) => b.slot?.zone === z.id && b.slot.row === row && b.slot.col === col);
  const disabled = (row, col) => (z.disabledSlots ?? []).includes(`${row}|${col}`);
  let free = null;
  for (const row of rows) for (const col of cols) if (!free && !taken(row, col) && !disabled(row, col)) free = { zone: z.id, row, col };
  return { data, src, free };
}

test('COPY_BOTTLE : nouvelle bouteille du même vin, posée sur le casier, id alloué par l’op', () => {
  const { data, src, free } = copyFixture();
  const n = data.bottles.filter((b) => b.wineId === src.wineId).length;
  const res = applyOp(data, { type: 'COPY_BOTTLE', payload: { bottleId: src.id, slot: free } });
  const copy = res.data.bottles.find((b) => b.id === res.ids.bottleId);
  assert.notEqual(copy.id, src.id);
  assert.equal(copy.wineId, src.wineId);
  assert.equal(copy.format, src.format);
  assert.deepEqual(copy.acquisition, src.acquisition);
  assert.deepEqual(copy.slot, free);
  assert.equal(res.data.bottles.filter((b) => b.wineId === src.wineId).length, n + 1, 'stock dérivé +1 (invariant 1)');
});

test('COPY_BOTTLE sur un casier occupé : OpAbortError, rien n’est créé (invariant 2)', () => {
  const { data, src } = copyFixture();
  assert.throws(
    () => applyOp(data, { type: 'COPY_BOTTLE', payload: { bottleId: src.id, slot: src.slot } }),
    (e) => e instanceof OpAbortError && e.code === 'SLOT_OCCUPIED',
  );
});

test('COPY_BOTTLE rejoué après 409 : le casier pris par Bob entre-temps → abandon, pas de doublon', async () => {
  const { data, src, free } = copyFixture();
  const other = data.bottles.find((b) => b.id !== src.id && b.slot);
  const fake = makeFakeGitHub(data);
  // Premier PUT : Bob a posé une autre bouteille sur le casier visé → 409, rejeu, abandon.
  let first = true;
  const fetchImpl = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PUT' && first) {
      first = false;
      const bob = applyOp(JSON.parse(fake.server.json), { type: 'MOVE_BOTTLE', payload: { bottleId: other.id, slot: free } });
      fake.server.json = JSON.stringify(bob.data);
      fake.server.sha = 'sha-bob';
    }
    return fake.fetchImpl(url, init);
  };
  github.configure({ token: 'tok', user: 'Alice', backoffMs: 0, fetchImpl });
  await assert.rejects(
    github.pushOperation({ type: 'COPY_BOTTLE', payload: { bottleId: src.id, slot: free } }),
    (e) => e instanceof OpAbortError && e.code === 'SLOT_OCCUPIED',
  );
  const final = JSON.parse(fake.server.json);
  const onFree = final.bottles.filter((b) => b.slot?.zone === free.zone && b.slot.row === free.row && b.slot.col === free.col);
  assert.equal(onFree.length, 1, 'une seule bouteille sur le casier : celle de Bob');
  assert.equal(onFree[0].id, other.id);
});

test('COPY_BOTTLE d’une bouteille bue entre-temps : abandon BOTTLE_GONE', () => {
  const { data, free } = copyFixture();
  assert.throws(
    () => applyOp(data, { type: 'COPY_BOTTLE', payload: { bottleId: 'b_inexistante', slot: free } }),
    (e) => e instanceof OpAbortError && e.code === 'BOTTLE_GONE',
  );
});
