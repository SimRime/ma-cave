// ops.js — opérations atomiques REJOUABLES + allocation des identifiants.
//
// Chaque opération est une fonction pure `(data, payload) → data'` : jamais un remplacement
// d'état complet, jamais un accès réseau (c'est github.js), jamais un barème métier (kb/*.json).
// github.js doit pouvoir RÉAPPLIQUER l'opération sur un document rechargé après un 409.
//
// applyOp() clone l'entrée (structuredClone), mute le clone, et retourne
//   { data, ids, noop?, message? }   — ou lève OpAbortError si une précondition est rompue.
//
// Règle d'or (CLAUDE.md § Écriture, DECISIONS.md D9) : les ids et les `ref` sont dérivés du
// document AU MOMENT où l'opération est appliquée — jamais fournis par l'appelant. Sinon deux
// créations concurrentes rejouées après un 409 réutilisent le même id.

import { slotKey } from './format.js';

// Abandon d'une opération : la précondition n'est plus vraie après rechargement.
// github.js laisse remonter → l'UI optimiste fait son rollback.
export class OpAbortError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'OpAbortError';
    this.code = code ?? 'ABORT';
    this.details = details ?? null;
  }
}

// ---------------------------------------------------------------------------
// Allocation d'identifiants — dérivée du document, jamais de l'appelant (D9).
// ---------------------------------------------------------------------------

// La `ref` d'un vin : entière, unique, strictement croissante, jamais réattribuée (invariant 3).
// L'id du vin en découle directement — une seule source monotone : `w_${ref}`.
const nextRef = (data) => 1 + data.wines.reduce((m, w) => Math.max(m, w.ref), 0);

// Suffixe numérique d'un id « prefixN » (« b_3 » → 3). Tous les ids alloués ici sont numériques.
const suffix = (id, prefix) => {
  const n = parseInt(String(id).slice(prefix.length), 10);
  return Number.isFinite(n) ? n : 0;
};
const nextNum = (items, prefix) =>
  1 + items.reduce((m, it) => Math.max(m, suffix(it.id, prefix)), 0);

// ---------------------------------------------------------------------------
// Helpers d'invariants (zones, casiers).
// ---------------------------------------------------------------------------

const zoneOf = (data, zoneId) => data.zones.find((z) => z.id === zoneId);

const rowLabels = (z) =>
  z.rowLabels ?? Array.from({ length: z.rows }, (_, i) => String.fromCharCode(65 + i));
const colLabels = (z) =>
  z.colLabels ?? Array.from({ length: z.cols }, (_, i) => String(i + 1));

const inBounds = (z, slot) =>
  rowLabels(z).includes(slot.row) && colLabels(z).includes(slot.col);
const isDisabled = (z, slot) =>
  (z.disabledSlots ?? []).includes(slotKey(slot.row, slot.col));

// La bouteille (autre que `exceptId`) occupant ce casier, s'il y en a une (invariant 2).
const occupant = (data, slot, exceptId) =>
  data.bottles.find(
    (b) =>
      b.id !== exceptId &&
      b.slot &&
      b.slot.zone === slot.zone &&
      b.slot.row === slot.row &&
      b.slot.col === slot.col,
  );

// Bouteilles d'une zone dont le casier disparaîtrait si la zone prenait cette forme (invariant 5).
const orphansIf = (data, zone) =>
  data.bottles.filter((b) => {
    if (!b.slot || b.slot.zone !== zone.id) return false;
    return !inBounds(zone, b.slot) || isDisabled(zone, b.slot);
  });

const stripIds = (obj) => {
  const { id, ref, ...rest } = obj ?? {};
  return rest;
};

// ---------------------------------------------------------------------------
// Les 12 opérations. Chacune reçoit le clone `data` et le mute.
// ---------------------------------------------------------------------------

const HANDLERS = {
  // — Créations : toujours rejouables ————————————————————————————————————————

  ADD_WINE(data, payload) {
    const ref = nextRef(data);
    const id = `w_${ref}`;
    const wine = {
      nom: '',
      region: null, appellation: null, appellationId: null, sousRegion: null,
      millesime: null, cepages: [], cepageIds: [],
      prixReference: null, valeur: null,
      gardeDe: null, gardeA: null, apogee: null, gardeExplication: null,
      mets: [], note: null, commentaire: null, archive: false,
      ...stripIds(payload),
      id, ref, // toujours en dernier : l'appelant ne peut pas les forcer.
    };
    data.wines.push(wine);
    return { data, ids: { wineId: id } };
  },

  // Crée N bouteilles en `slot: null` (à ranger). Le placement passe par PLACE_BOTTLE :
  // créer avec un slot ici casserait l'invariant 2 au rejeu après 409.
  ADD_BOTTLES(data, payload) {
    const wineId = payload.wineId;
    const specs = payload.bottles ?? [];
    let n = nextNum(data.bottles, 'b_');
    const bottleIds = [];
    for (const spec of specs) {
      const id = `b_${n++}`;
      data.bottles.push({
        id,
        wineId,
        format: spec.format ?? 'standard',
        slot: null,
        acquisition: spec.acquisition,
      });
      bottleIds.push(id);
    }
    return { data, ids: { bottleIds } };
  },

  ADD_TASTING(data, payload) {
    const id = `t_${nextNum(data.tastings, 't_')}`;
    const tasting = {
      bottleId: null, avecQui: null, occasion: null,
      note: null, commentaire: null, par: null,
      ...stripIds(payload),
      id,
    };
    data.tastings.push(tasting);
    return { data, ids: { tastingId: id } };
  },

  // — Placement : abandon si le casier cible est occupé/désactivé ————————————

  PLACE_BOTTLE: placeBottle,
  MOVE_BOTTLE: placeBottle, // même contrat : la cible doit être libre (l'UI gère l'échange).

  // — Boire : suppression de l'objet bouteille (invariant 1), idempotent ——————

  DRINK_BOTTLE(data, payload) {
    const i = data.bottles.findIndex((b) => b.id === payload.bottleId);
    if (i === -1) {
      return { data, ids: {}, noop: true, message: 'Bouteille déjà bue.' };
    }
    data.bottles.splice(i, 1);
    return { data, ids: {} };
  },

  // — Éditions : dernier écrivain gagne, champ par champ ————————————————————

  UPDATE_WINE(data, payload) {
    const w = data.wines.find((x) => x.id === payload.id);
    if (!w) return { data, ids: {}, noop: true, message: 'Ce vin n’existe plus.' };
    Object.assign(w, stripIds(payload.fields ?? {}));
    return { data, ids: { wineId: w.id } };
  },

  // Le slot ne se modifie JAMAIS ici (passe par MOVE/PLACE, invariant 2). On le retire du merge.
  UPDATE_BOTTLE(data, payload) {
    const b = data.bottles.find((x) => x.id === payload.id);
    if (!b) return { data, ids: {}, noop: true, message: 'Cette bouteille n’existe plus.' };
    const { id, wineId, slot, ...rest } = payload.fields ?? {};
    Object.assign(b, rest);
    return { data, ids: { bottleId: b.id } };
  },

  UPDATE_TASTING(data, payload) {
    const t = data.tastings.find((x) => x.id === payload.id);
    if (!t) return { data, ids: {}, noop: true, message: 'Cette dégustation n’existe plus.' };
    Object.assign(t, stripIds(payload.fields ?? {}));
    return { data, ids: { tastingId: t.id } };
  },

  // — Suppressions : abandon si des bouteilles seraient perdues (invariant 5) —

  DELETE_WINE(data, payload) {
    const i = data.wines.findIndex((x) => x.id === payload.id);
    if (i === -1) return { data, ids: {}, noop: true, message: 'Ce vin a déjà été supprimé.' };
    const bottles = data.bottles.filter((b) => b.wineId === payload.id);
    if (bottles.length) {
      throw new OpAbortError(
        `Ce vin a encore ${bottles.length} bouteille(s) : buvez-les ou supprimez-les d’abord.`,
        { code: 'WINE_HAS_BOTTLES', details: { bottleIds: bottles.map((b) => b.id) } },
      );
    }
    // Un vin référencé par une dégustation reste (invariant 6) : l'historique le cite.
    const tastings = data.tastings.filter((t) => t.wineId === payload.id);
    if (tastings.length) {
      throw new OpAbortError(
        `Ce vin a un historique de dégustation : il est conservé pour la mémoire de la cave.`,
        { code: 'WINE_HAS_TASTINGS', details: { tastingIds: tastings.map((t) => t.id) } },
      );
    }
    data.wines.splice(i, 1);
    return { data, ids: {} };
  },

  UPSERT_ZONE(data, payload) {
    const existing = payload.id ? zoneOf(data, payload.id) : null;
    if (existing) {
      const merged = { ...existing, ...stripIds(payload) };
      const orphans = orphansIf(data, merged);
      if (orphans.length) {
        throw new OpAbortError(
          `Cette forme de zone laisserait ${orphans.length} bouteille(s) sans casier.`,
          { code: 'ZONE_SHRINK_OCCUPIED', details: { bottleIds: orphans.map((b) => b.id) } },
        );
      }
      Object.assign(existing, merged);
      return { data, ids: { zoneId: existing.id } };
    }
    const id = payload.id ?? `z${nextNum(data.zones, 'z')}`;
    const zone = {
      disabledSlots: [],
      ordre: data.zones.length,
      ...stripIds(payload),
      id,
    };
    data.zones.push(zone);
    return { data, ids: { zoneId: id } };
  },

  DELETE_ZONE(data, payload) {
    const i = data.zones.findIndex((z) => z.id === payload.id);
    if (i === -1) return { data, ids: {}, noop: true, message: 'Cette zone a déjà été supprimée.' };
    const inside = data.bottles.filter((b) => b.slot && b.slot.zone === payload.id);
    if (inside.length) {
      throw new OpAbortError(
        `Cette zone contient ${inside.length} bouteille(s) : videz-la d’abord.`,
        { code: 'ZONE_NOT_EMPTY', details: { bottleIds: inside.map((b) => b.id) } },
      );
    }
    data.zones.splice(i, 1);
    return { data, ids: {} };
  },
};

// PLACE_BOTTLE et MOVE_BOTTLE partagent ce corps : poser la bouteille sur un casier libre.
function placeBottle(data, payload) {
  const b = data.bottles.find((x) => x.id === payload.bottleId);
  if (!b) throw new OpAbortError('Cette bouteille n’existe plus.', { code: 'BOTTLE_GONE' });
  const slot = payload.slot;
  const z = zoneOf(data, slot.zone);
  if (!z) throw new OpAbortError('La zone n’existe plus.', { code: 'ZONE_GONE' });
  if (!inBounds(z, slot)) {
    throw new OpAbortError(`Le casier ${slot.row}${slot.col} n’existe pas dans cette zone.`, {
      code: 'SLOT_OUT_OF_BOUNDS',
    });
  }
  if (isDisabled(z, slot)) {
    throw new OpAbortError(`Le casier ${slot.row}${slot.col} est désactivé.`, {
      code: 'SLOT_DISABLED',
    });
  }
  const occ = occupant(data, slot, b.id);
  if (occ) {
    throw new OpAbortError(`Le casier ${slot.row}${slot.col} vient d’être occupé.`, {
      code: 'SLOT_OCCUPIED',
      details: { bottleId: occ.id },
    });
  }
  b.slot = { zone: slot.zone, row: slot.row, col: slot.col };
  return { data, ids: {} };
}

// ---------------------------------------------------------------------------
// Point d'entrée unique.
// ---------------------------------------------------------------------------

export function applyOp(data, op) {
  const { type, payload = {} } = op ?? {};
  const handler = HANDLERS[type];
  if (!handler) {
    throw new OpAbortError(`Opération inconnue : ${type}`, { code: 'UNKNOWN_OP' });
  }
  const next = structuredClone(data);
  return handler(next, payload);
}
