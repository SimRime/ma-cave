---
name: cave-context
description: Socle pour toute question sur « ma cave », « la cave à vin », les bouteilles, casiers, zones ou dégustations. Explique où sont les données et quoi appeler. À charger avant les autres skills de la cave.
---

# Contexte de la cave

Ce dépôt EST une cave à vin. Il n'y a ni backend ni base de données : `data.json` à la racine est la
base. Lancé sur un clone local, tu lis la cave directement — aucun connecteur, aucun export.

## Où sont les choses

- **`data.json`** — les données de l'utilisateur : `zones`, `wines`, `bottles`, `tastings`.
  Le modèle fait foi dans `schema/data.schema.json`. **Ne jamais deviner un champ : le lire.**
- **`kb/`** — la connaissance (cépages, appellations, barèmes de garde, règles d'accords).
  **Jamais écrite par un agent** sauf demande explicite (voir `CLAUDE.md`).
- **`docs/`** — `PRD.md` (pourquoi), `SPEC_MOTEURS.md` (garde et accords), `DECISIONS.md`, `CLAUDE.md`.

## Vocabulaire

- Un **vin** (`wine`) = un producteur + une cuvée + un millésime. Deux millésimes = deux vins.
- Une **bouteille** (`bottle`) = un objet de premier rang, avec son format et son casier (`slot`).
- Un **casier** = une case d'une **zone**. Adresse lisible : « Ma cave · C4 ».
- Le **stock d'un vin est DÉRIVÉ**, jamais stocké : c'est le nombre de ses bouteilles. Un vin sans
  bouteille reste dans `wines` (l'historique le référence) mais est masqué des vues de stock.
  Les invariants complets sont dans `CLAUDE.md`.

## La règle d'or : ne jamais recalculer une règle métier

La garde vit dans `app/garde.js`, les accords dans `app/accords.js`, les agrégats dans `app/stats.js`.
**Ne réimplémente aucun barème, seuil ni classement en prose.** Pour toute question de classement,
appelle :

```bash
node scripts/query.mjs --accord <platId> --en-stock   # accords mets → vin
node scripts/query.mjs --a-boire                       # urgences de garde
node scripts/query.mjs --inventaire                    # inventaire, valeur, provenance
```

Ajoute `--json` pour un format machine. `query.mjs` importe les moteurs de l'app : ses réponses sont
**identiques** à celles des écrans. C'est ce qui garantit qu'il n'y a jamais deux vérités.

## Skills liés

`choisir-un-vin` · `etat-de-la-cave` · `ajouter-depuis-etiquette` · `enregistrer-degustation`.
