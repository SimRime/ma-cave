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
  const data = seed(); // b_1 est en A1
  assert.throws(
    () => applyOp(data, { type: 'PLACE_BOTTLE', payload: { bottleId: 'b_3', slot: { zone: 'z1', row: 'A', col: '1' } } }),
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
  const r1 = applyOp(seed(), { type: 'ADD_WINE', payload: { producteur: 'A', nom: 'x', pays: 'FR', couleur: 'Rouge' } });
  const r2 = applyOp(r1.data, { type: 'ADD_WINE', payload: { producteur: 'B', nom: 'y', pays: 'FR', couleur: 'Blanc' } });
  assert.equal(r1.ids.wineId, 'w_3');
  assert.equal(r2.ids.wineId, 'w_4');
  assert.equal(r2.data.wines.at(-1).ref, 4);
});

test('applyOp ne mute pas le document d’entrée (rejeu propre)', () => {
  const data = seed();
  const before = JSON.stringify(data);
  applyOp(data, { type: 'ADD_WINE', payload: { producteur: 'A', nom: 'x', pays: 'FR', couleur: 'Rouge' } });
  assert.equal(JSON.stringify(data), before);
});
