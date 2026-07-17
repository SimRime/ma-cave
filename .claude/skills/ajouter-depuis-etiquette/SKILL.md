---
name: ajouter-depuis-etiquette
description: Ajouter un vin à partir d'une photo d'étiquette. Se déclenche sur « ajoute ce vin », « voici une photo / une étiquette », « j'ai acheté cette bouteille », « nouvelle bouteille », « rentre ce vin », ou quand des images attendent dans inbox/.
---

# Ajouter un vin depuis une étiquette

L'utilisateur dépose des photos d'étiquettes dans `inbox/` (dossier `.gitignore`, jamais commité) et
veut en tirer une fiche vin. **Ce n'est pas de l'OCR** : lis les images nativement et passe directement
de la photo aux champs structurés.

## Quand agir

Une ou plusieurs images dans `inbox/`, ou une demande explicite d'ajout de vin.

## Quoi faire

1. **Lire l'étiquette** → producteur, cuvée, **millésime**, appellation. Rendre les champs libres tels
   qu'ils sont écrits (`textContent` côté app : ne pas inventer de mise en forme).
2. **Croiser avec `kb/regions.json` — c'est là que se joue la valeur.** Les étiquettes françaises
   mentionnent rarement les cépages, mais « Gigondas 2019 » suffit à déduire l'appellation résolue, donc
   les cépages, le tier de garde, la fenêtre et les accords. **La photo fournit l'identité ; le KB
   fournit le reste.** La résolution appellation/cépage se fait via `app/kb.js` (le même que l'app) ;
   la garde et les accords se calculent avec `app/garde.js` / `app/accords.js` — jamais estimés à la
   main. Pour prévisualiser garde/accords d'un vin déjà saisi, `node scripts/query.mjs` reste la
   référence.
3. **Marquer tout champ incertain** et le signaler à l'utilisateur.

## Garde-fous (un faux millésime fausse toute la garde)

- **Le millésime est souvent sur la capsule, pas sur l'étiquette de face.** S'il est illisible, **le
  demander — jamais le deviner.**
- Si l'appellation ne résout pas dans le KB, l'accepter quand même en le signalant (« appellation
  inconnue du référentiel — garde et accords estimés depuis le cépage »), comme le fait l'app.
- **Aucune valeur extraite d'une photo n'est écrite sans validation humaine.** Proposer la fiche,
  attendre la confirmation. L'écriture effective (créer le vin, ses bouteilles) passe par une
  validation puis un commit humain — voir le skill `enregistrer-degustation` pour la discipline d'écriture.
