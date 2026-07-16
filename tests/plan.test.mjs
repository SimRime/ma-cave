// plan.test.mjs — la recherche partagée du Plan (format.js > matchWine).
// Fonction pure, testable sans DOM ni réseau. node --test, zéro dépendance.

import test from 'node:test';
import assert from 'node:assert/strict';

import { matchWine } from '../app/format.js';

const wine = {
  producteur: 'Domaine de la Côte Rôtie',
  nom: 'Syrah',
  appellation: 'Côte Rôtie AOC',
  region: 'Rhône',
  sousRegion: 'Ampuis',
  millesime: 2019,
  cepages: ['Syrah', 'Viognier'],
};

test('correspondance insensible aux accents et à la casse', () => {
  assert.equal(matchWine(wine, 'rotie'), true, '« rotie » trouve « Rôtie »');
  assert.equal(matchWine(wine, 'CÔTE'), true, 'casse et accents ignorés');
});

test('sous-chaîne sur chaque champ cherché', () => {
  assert.equal(matchWine(wine, 'rhone'), true, 'région');
  assert.equal(matchWine(wine, 'ampuis'), true, 'sous-région');
  assert.equal(matchWine(wine, 'viognier'), true, 'cépage secondaire');
  assert.equal(matchWine(wine, '2019'), true, 'millésime');
  assert.equal(matchWine(wine, 'syrah'), true, 'cuvée / cépage');
});

test('aucune correspondance parasite', () => {
  assert.equal(matchWine(wine, 'chardonnay'), false);
  assert.equal(matchWine(wine, 'bordeaux'), false);
});

test('saisie vide : aucun résultat (le Plan n’estompe rien sans recherche)', () => {
  assert.equal(matchWine(wine, ''), false);
  assert.equal(matchWine(wine, '   '), false);
});

test('champs manquants tolérés (pas de cépages, pas de sous-région)', () => {
  const minimal = { producteur: 'Gantenbein', nom: 'Pinot Noir', couleur: 'Rouge' };
  assert.equal(matchWine(minimal, 'gantenbein'), true);
  assert.equal(matchWine(minimal, 'pinot'), true);
  assert.equal(matchWine(minimal, 'merlot'), false);
});
