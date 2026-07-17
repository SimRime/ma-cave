---
name: choisir-un-vin
description: Choisir un vin de la cave pour un plat ou un repas. Se déclenche sur « quel vin pour », « qu'est-ce qu'on ouvre », « on mange une raclette / une fondue / une côte de bœuf », « un rouge pour », « suggère un accord », « quel vin ce soir ».
---

# Choisir un vin

L'utilisateur veut savoir **quelle bouteille de SA cave** ouvrir pour un plat. Cas de référence :
« J'ai besoin d'un rouge pour une côte de bœuf. Suggère-moi quelque chose en fonction des apogées et
des accords de ma cave. »

## Quand agir

Dès qu'un plat, un repas ou une envie d'accord est mentionné.

## Quoi faire

1. **Traduire le plat en identifiant** de la taxonomie `kb/accords.json > plats` (p. ex. « côte de
   bœuf », « entrecôte » → `viandes_rouges_grillees` ; « raclette » → `raclette`). En cas de doute,
   lance la commande avec un id proche : si l'id est inconnu, `query.mjs` liste les ids valides.
2. **Appeler le moteur** — ne calcule jamais un score toi-même :

   ```bash
   node scripts/query.mjs --accord <platId> --en-stock
   ```

3. **Relayer** la liste telle qu'elle sort, en donnant pour chaque vin : **l'emplacement** (le casier),
   la **raison** de l'accord, l'**état de garde**, la **température**, le **carafage**, et la
   **provenance si c'est un cadeau**. Le classement est déjà fait par le moteur : le respecter.

Si aucun vin n'atteint le seuil, `query.mjs` affiche un repli honnêtement étiqueté : le transmettre tel
quel, sans le maquiller en accord établi.

## Interdits

- **Ne jamais proposer un vin dont il ne reste aucune bouteille.** `--en-stock` s'en charge : ne pas le
  contourner en lisant `data.json` à la main.
- **Ne jamais inventer un vin absent de `data.json`**, ni un accord que le moteur n'a pas produit.
- **Ne pas ré-expliquer comment un score est calculé** : la règle vit dans `app/accords.js`, pas ici.
