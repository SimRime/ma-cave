---
name: enregistrer-degustation
description: Enregistrer une bouteille bue et sa dégustation. Se déclenche sur « j'ai bu », « on a ouvert », « on a fini une bouteille », « note de dégustation », « j'ai goûté », « on a descendu ». Le seul skill qui modifie data.json.
---

# Enregistrer une dégustation

**C'est le seul skill qui écrit.** L'utilisateur a bu une bouteille et veut l'enregistrer, avec ou sans
note. L'écriture se fait en éditant `data.json` sur le clone local puis en commitant — **pas** via
l'API GitHub (`app/github.js` est réservé au navigateur).

## Quand agir

Une bouteille a été bue, ouverte, finie ; ou une note de dégustation est dictée après coup.

## Quoi faire

1. **Identifier la bouteille** dans `data.json` (par vin + casier, ou par `bottle.id`). En cas
   d'ambiguïté (plusieurs bouteilles du même vin), demander laquelle — de préférence par son casier.
2. **Appliquer l'opération sur `data.json`** :
   - **Boire = SUPPRIMER l'objet `bottle`.** Jamais décrémenter un compteur : le stock est dérivé
     (invariant 1, `CLAUDE.md`). Le casier se libère mécaniquement.
   - Ajouter un objet `tastings` (date pré-remplie à aujourd'hui, `avecQui`, `occasion`, `note` /20 ou
     `null`, `commentaire`, `par` = nom de l'utilisateur). La dégustation garde `wineId` ; son
     `bottleId` référence la bouteille **désormais supprimée**, et c'est normal et attendu.
   - Respecter le modèle : `schema/data.schema.json` fait foi sur les champs.
3. **Valider** avant de proposer le commit :

   ```bash
   node scripts/validate-data.mjs
   ```

4. **Toujours demander confirmation avant de commiter.** Montrer le diff et un message lisible, du
   type : `bu: Barolo 2016 (Ma cave C4)`. Commit en français, à l'impératif, seulement après accord.

## Garde-fous

- **Ne jamais supprimer une bouteille en silence** ni en supprimer une autre que celle visée.
- Ne pas toucher au vin (`wine`) : un vin sans bouteille reste dans `wines` pour l'historique
  (invariant 6). Ne pas l'archiver de sa propre initiative.
- Si `validate-data.mjs` échoue, **ne pas commiter** : corriger d'abord.
