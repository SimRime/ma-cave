---
name: etat-de-la-cave
description: Faire le point sur la cave — inventaire, valeur, provenance, urgences. Se déclenche sur « qu'est-ce que j'ai en cave », « combien de bouteilles », « la valeur de ma cave », « combien j'ai dépensé », « qu'est-ce qui reste de la cave de Papa », « offert par », « qu'est-ce qu'il faut boire », « à boire », « les urgences ».
---

# État de la cave

L'utilisateur veut un état des lieux : ce qu'il possède, ce que ça vaut, d'où ça vient, ce qui presse.

## Quand agir

Questions d'inventaire, de valeur, de provenance, ou « quoi boire bientôt ».

## Quoi faire

Appelle `query.mjs` — les chiffres et les statuts viennent des mêmes modules que les écrans de l'app
(`app/stats.js`, `app/garde.js`). Ne recompte rien à la main.

- **Inventaire, valeur, provenance :**

  ```bash
  node scripts/query.mjs --inventaire
  ```

  Il renvoie **deux chiffres monétaires distincts, à ne jamais confondre** (c'est une raison d'être du
  projet, PRD §4.2) : le **montant dépensé** (Σ des prix payés ; cadeaux et héritages = 0) et la
  **valeur de la cave** (Σ des valeurs des bouteilles en stock, cadeaux compris). Les rapporter
  **séparément**. Il donne aussi la provenance (« offert par X », « ce qui reste de … »).

- **Urgences de garde (« à boire ») :**

  ```bash
  node scripts/query.mjs --a-boire
  ```

  Trois sections, comme l'écran « À boire » de l'app : à boire vite, à l'apogée, encore trop jeune —
  chaque bouteille avec son casier. Le statut vient du moteur de garde : ne pas juger « à l'œil » sur
  `gardeA`, ce serait diverger de l'app.

Ajoute `--json` si tu dois filtrer ou agréger toi-même la sortie.

## Interdit

Ne pas réécrire la règle « montant dépensé ≠ valeur » ni la logique des drapeaux de garde en prose :
elles vivent dans `app/stats.js` et `app/garde.js`.
