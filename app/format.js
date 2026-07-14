// format.js — libellés, clé de casier, normalisation de recherche.
// AUCUNE logique métier ici (pas de garde, pas d'accords, pas de réseau).

// Clé de casier — définie UNE SEULE FOIS dans tout le dépôt (CLAUDE.md, DECISIONS.md D13).
// Le séparateur '|' n'est pas décoratif : sans lui, `"A1" + "2"` et `"A" + "12"` donnent
// la même chaîne, et désactiver un casier en désactiverait un autre.
export const slotKey = (row, col) => `${row}|${col}`;

// Clé de casier incluant la zone — pour repérer un slot de bouteille de façon unique.
export const slotKeyZone = (zone, row, col) => `${zone}|${row}|${col}`;

// Normalisation de recherche : minuscules, sans accents (NFD → suppression des diacritiques
// combinants U+0300–U+036F), espaces compressés. Compare une saisie à un texte affiché.
export const normalise = (str) =>
  (str ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Libellé d'affichage d'un casier : « A1 », ou « — » si la bouteille n'est pas rangée.
export const slotLabel = (slot) =>
  slot ? `${slot.row}${slot.col}` : '—';

// Libellé d'un vin pour les listes : « Producteur — Nom (millésime) ».
export const wineLabel = (wine) => {
  const parts = [wine.producteur, wine.nom].filter(Boolean).join(' — ');
  return wine.millesime ? `${parts} (${wine.millesime})` : parts;
};
