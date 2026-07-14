# Ma Cave — règles du dépôt

Gestion d'une cave à vin. Web app statique, GitHub Pages, **deux utilisateurs**.

Ce fichier n'est pas un résumé du PRD : **il liste ce qui casse le projet si on l'ignore.**
Il ne recopie aucune règle métier — il renvoie au document qui fait foi (voir `README.md`).

## Ce que ce projet n'est pas

- **Pas de build.** HTML + CSS + JavaScript ES modules, servis tels quels. Pas de bundler, pas de
  transpilation. Un `git push` = un déploiement. Si une solution exige une étape de build, elle est hors
  périmètre — trouvez-en une autre.
- **Pas de framework.** Ni React, ni Vue, ni Svelte. JS vanilla, modules ES, un store minimal.
- **Pas de backend, pas de base de données.** `data.json` dans ce dépôt EST la base.
- **Aucune dépendance dans le code exécuté par le navigateur.** Pas de CDN, pas une bibliothèque.
  Les scripts de `scripts/` et `tests/` tournent sous Node et **peuvent** utiliser des `devDependencies`
  npm (`ajv`, `ajv-formats` pour la validation de schéma) : elles ne sont jamais servies par Pages.
- **Pas d'import Excel.** Ni SheetJS, ni écran de rapprochement, ni mapping d'onglets. La cave réelle
  (84 casiers) est saisie à la main. Si cette fonctionnalité réapparaît dans un document, c'est une
  erreur : voir `docs/DECISIONS.md` D7.
- **Pas de localStorage pour les données.** `localStorage` sert au token GitHub, au nom d'utilisateur et
  aux préférences d'affichage (taille des casiers) — **jamais** aux vins, bouteilles ou zones.

## Les six invariants

Ils ne sont pas exprimables en JSON Schema. Le code DOIT les faire respecter, et
`scripts/validate-data.mjs` DOIT les vérifier. **Cette liste est la seule ; les briefs y renvoient par
numéro.**

1. **Le stock est dérivé, jamais stocké.** Le nombre de bouteilles d'un vin =
   `bottles.filter(b => b.wineId === w.id).length`. Il n'existe aucun champ « reste ». Boire une
   bouteille = **supprimer l'objet `bottle`**. Si vous vous surprenez à écrire un compteur, vous
   réintroduisez le bug que ce projet existe pour éliminer.
2. **Un casier contient au plus une bouteille.** Placement sur un casier occupé → refus + proposition
   d'échange. Aucune bouteille sur un casier listé dans `zone.disabledSlots`.
3. **`wine.ref` est unique et strictement croissant.** Jamais réattribuée, même après suppression.
4. **Une valeur `manuel` n'est jamais écrasée par un calcul.** Vaut pour `gardeSource` et `metsSource`.
   Un recalcul global doit sauter ces vins.
5. **Réduire ou supprimer une zone dont des casiers sont occupés → refus**, avec la liste des
   bouteilles concernées. Ne jamais supprimer une bouteille en silence. Idem : supprimer un vin qui a
   encore des bouteilles → refus (proposer « boire » ou « supprimer les N bouteilles »).
6. **Un vin sans bouteille reste dans `wines`** (l'historique des dégustations le référence) mais est
   masqué des vues de stock. Ne pas le confondre avec `archive: true`, qui est une décision de
   l'utilisateur (« je n'en rachèterai pas »).

## Écriture : opérations, pas remplacements

Deux personnes écrivent dans le même fichier. Toute mutation passe par `app/ops.js` et suit ce cycle,
implémenté **uniquement** dans `app/github.js` :

1. `GET api.github.com/repos/{owner}/{repo}/contents/data.json` → contenu + `sha`.
2. Appliquer **l'opération** (`DRINK_BOTTLE`, `MOVE_BOTTLE`, `ADD_WINE`…) sur l'objet fraîchement lu.
3. `PUT` avec le `sha` attendu.
4. `409` → recharger, **réappliquer l'opération**, réessayer (3 tentatives, backoff 500 ms).

> **Le piège.** Si une mutation est implémentée comme « je pousse mon état local complet », le retry après
> conflit écrase silencieusement le travail de l'autre. Les opérations doivent être des **deltas
> rejouables**. C'est la règle la plus facile à violer sans s'en apercevoir, et la plus coûteuse.

### Signature imposée

```js
// github.js — la SEULE façon d'écrire. Ne JAMAIS lui passer l'objet data complet.
pushOperation({ type, payload }) → { data, sha, ids }
```

Les écritures sont **sérialisées** : une seule requête `PUT` en vol à la fois. Deux mutations rapides
depuis le même téléphone produiraient sinon un 409 contre soi-même.

### Les identifiants sont alloués par l'opération, jamais par l'appelant

Le `payload` d'une opération de création ne contient **aucun** `id` ni `ref`. `ops.js` les dérive du
document sur lequel l'opération est appliquée, **au moment où elle l'est** :

```js
const nextRef = (data) => 1 + data.wines.reduce((m, w) => Math.max(m, w.ref), 0);
```

Sinon : Alice crée `ref: 5`. Bob, sur un état antérieur, crée `ref: 5`, prend un 409, **rejoue son
opération telle quelle** → deux vins avec la même `ref` et le même `id`. C'est exactement le bug que
l'architecture prétend éliminer, et il est **invisible** jusqu'à ce qu'un vin en écrase un autre.

Corollaire : **l'id définitif n'est connu qu'après le succès du `PUT`.** L'UI optimiste manipule un id
provisoire (`tmp_…`) et le remplace par celui que retourne `pushOperation()`.

### Quand la précondition n'est plus vraie après rechargement

Le retry ne rejoue pas aveuglément. Chaque opération déclare son comportement :

| Opération | Précondition rompue | Comportement |
|---|---|---|
| `DRINK_BOTTLE` | la bouteille n'existe plus | **no-op idempotent** + « déjà bue par Bob » |
| `MOVE_BOTTLE` · `PLACE_BOTTLE` | le casier cible est occupé | **abandon**, rollback de l'UI, « le casier C4 vient d'être occupé » |
| `DELETE_WINE` | le vin a de nouveau des bouteilles | abandon + message (invariant 5) |
| `DELETE_ZONE` | la zone contient des bouteilles | abandon + message (invariant 5) |
| `UPDATE_WINE` · `UPDATE_BOTTLE` · `UPDATE_TASTING` · `UPSERT_ZONE` | l'objet a changé entre-temps | le payload ne porte que **les champs édités** → dernier écrivain gagne, champ par champ |
| `ADD_WINE` · `ADD_BOTTLES` · `ADD_TASTING` | — | toujours rejouable. `ADD_BOTTLES` crée en `slot: null` — le placement passe par `PLACE_BOTTLE`, sinon un rejeu après 409 peut poser deux bouteilles sur le même casier (invariant 2) |

Sans ce tableau, le retry écrase les préconditions et on perd le travail de l'autre — ce que le mécanisme
entier existe pour empêcher.

### L'encodage base64 casse sur le français

L'API `contents` attend du base64. La ligne qu'on écrit spontanément lève une exception dès le premier
« Côte Rôtie » :

```js
btoa(JSON.stringify(data))   // ❌ InvalidCharacterError sur « ô », « â », « é »
```

**Dans `github.js`, et nulle part ailleurs :**

```js
const toBase64   = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
```

Découper en tronçons de 32 Ko si `String.fromCharCode` sature la pile. `data.json` doit rester **sous
1 Mo** : c'est la limite de l'API `contents`.

### La lecture passe par l'API, jamais par Pages

`data.json` est lu **toujours** via `GET api.github.com/…/contents/data.json`. La copie servie par Pages
est en retard de 20 s à plusieurs minutes après un commit : on boirait une bouteille et on la reverrait à
l'écran. Cette copie ne sert **qu'** au cache hors-ligne du service worker.

## Un seul endroit pour chaque logique

- **Réseau** : `app/github.js`. Nulle part ailleurs. (Le jour où le dépôt passe en privé, un seul fichier
  change.)
- **Résolution du KB** (appellation, cépage, synonymes, normalisation) : `app/kb.js`. Les moteurs lisent
  **`wine.appellationId` et `wine.cepageIds`**, jamais le texte libre `wine.appellation` / `wine.cepages`.
- **Garde** : `app/garde.js`, qui implémente `docs/SPEC_MOTEURS.md §1` et lit `kb/garde.json`.
- **Accords** : `app/accords.js`, qui implémente `docs/SPEC_MOTEURS.md §2` et lit `kb/accords.json`.
- **Aucun barème, aucun seuil, aucun facteur en dur dans le code.** Ils vivent dans `kb/*.json`.
- **Les skills Claude Code ne réimplémentent rien.** Ils appellent `scripts/query.mjs`, qui importe
  `garde.js` et `accords.js`. **L'app et les skills doivent classer les vins identiquement.** Une règle
  métier écrite deux fois divergera — c'est une certitude, pas un risque.

## Données vs connaissance

| | Écrit par l'app | Contenu |
|---|---|---|
| `data.json` | **Oui** | Les vins, bouteilles, zones, dégustations de l'utilisateur. |
| `kb/*.json` | **Jamais** | Cépages, appellations, barèmes de garde, règles d'accords. Modifié par commit humain. |

Un agent ne modifie `kb/` que si on le lui demande explicitement, et jamais en même temps que `data.json`.

## Sécurité

- Le dépôt est **public**. `data.json` est lisible par tous : c'est un choix assumé du commanditaire.
- **Aucun secret dans le dépôt.** Jamais de token, de clé API, de `.env`. Le token GitHub de chaque
  utilisateur vit dans son `localStorage`, saisi via Réglages.
- Sans token, l'app est en **lecture seule** — pas en erreur. Les actions de mutation sont désactivées
  avec un message clair.
- Les champs libres (producteur, commentaire, « offert par ») sont rendus avec **`textContent`**, jamais
  `innerHTML`.
- `inbox/` est dans `.gitignore`. Aucune image n'est commitée.

## Conventions

- **Langue : français.** Interface, commentaires, messages de commit. Les identifiants de code sont en
  anglais si c'est plus naturel (`wineId`, `slot`), mais les libellés utilisateur sont en français.
- **Écriture d'interface** : verbes actifs, casse normale. Le bouton dit ce qui va se passer (« Boire »,
  pas « Valider »), et le même mot suit l'action jusqu'au bout.
- **Clé de casier** : `slotKey(row, col)` = `` `${row}|${col}` `` → `"A|12"`. Défini une seule fois, dans
  `app/format.js`. **Ne jamais concaténer à la main** : `"A1" + "2"` et `"A" + "12"` donnent la même
  chaîne, et un casier désactivé en désactiverait un autre.
- **Cibles tactiles : ≥ 44 px pour toute cible d'action** (boutons, onglets, éléments de feuille). **Les
  casiers de la grille sont une exception assumée : 24 à 46 px.** L'app s'utilise debout, dans une cave,
  une main prise — c'est le contexte d'usage qui fixe la borne basse à 24 px, pas l'esthétique.
- **La couleur ne porte jamais seule une information.** Un casier rouge est aussi étiqueté.
- Commits en français, à l'impératif : `ajoute le curseur de taille des casiers`.

## Avant de proposer un changement

- `node scripts/validate-data.mjs` — schéma **et** les six invariants.
- `node scripts/validate-kb.mjs` — tout cépage cité par une appellation existe ; tout cépage a un
  `tierGarde` ; tout id de plat cité existe dans `kb/accords.json`. **Ne vérifie PAS `tasting.bottleId`** :
  la bouteille n'existe plus, c'est normal et attendu.
- `node --test` — les vecteurs de `docs/SPEC_MOTEURS.md` et le test du conflit 409.
- Testé à 380 px de large. C'est la cible, pas un cas limite.
