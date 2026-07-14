# Décisions d'arbitrage — 13 juillet 2026

Ce document tranche les points laissés ouverts ou contradictoires par le PRD v1.5.
**Il fait foi sur les points qu'il traite.** Le PRD, `CLAUDE.md` et `BRIEFS_LOTS.md` doivent être
mis à jour en conséquence.

Principe directeur : **2 utilisateurs, une cave de 84 casiers, aucune vocation commerciale.**
Toute solution qui ajoute de la complexité sans corriger un calcul faux ou une perte de données
est hors périmètre.

---

## D1 — Périmètre du KB : les 3 pays, mais en 3 lots séparés

`L1` est scindé en **L1-CH → L1-FR → L1-IT**, dans cet ordre.
Chaque lot est une session d'agent distincte, suivie d'une **relecture humaine avant le lot suivant**.
La Suisse d'abord : c'est le référentiel que le commanditaire sait juger, et sa qualité dit si la
méthode tient. Si L1-CH sort truffé d'erreurs, on ne lance pas L1-FR — on corrige la méthode.

Pas de champ `confiance` : le découpage + relecture le remplace, et coûte moins cher.

## D2 — Accords : seuil, puis repli

Les valeurs (seuil, plafonds, poids, paramètres du repli) vivent dans `kb/accords.json > ponderation`
et `> repli` — **aucun chiffre n'est recopié ici**.

- **Recalibrage v2** : en v1, le plafond des règles de profil était **inférieur** au seuil d'affichage —
  elles ne pouvaient donc jamais faire apparaître un vin, ce qui vidait de son sens le champ `profil`.
  Le plafond relevé reste sous le poids de l'appellation : le profil ne peut **toujours pas** dominer
  une source explicite.
- **Repli** : si aucun vin n'atteint le seuil, afficher les meilleurs candidats (nombre et score
  minimum : `kb/accords.json > repli`) sous l'intitulé
  *« Aucun accord établi — suggestions d'après le profil des vins »*.
- Les **anti-règles ramènent le score à 0** et excluent le vin **y compris du repli**.

## D3 — Garde : tous les modificateurs conservés (prix, format, non millésimé)

Conséquence obligatoire : la garde est **deux fonctions**, pas un champ.

- `calculerGardeVin(wine, bottles, kb)` → fenêtre **canonique** (format `standard`). **Seule** valeur
  écrite dans `data.json` (`gardeDe`, `gardeA`, `apogee`, `gardeExplication`).
- `gardeEffective(wine, bottle, kb)` → fenêtre **de cette bouteille** (applique `format`, et pour un vin
  non millésimé recale sur `bottle.acquisition.date`). **Jamais persistée.** Calculée à l'affichage par
  le Plan, la Fiche, « À boire » et les Accords.

Détails (ordre, arrondi, prix de référence) : voir `SPEC_MOTEURS.md`.

## D4 — Statuts de garde : des drapeaux, pas une valeur unique

Un vin peut être à la fois « à l'apogée » et « à boire vite » → **on affiche les deux**
(« à l'apogée, et la fenêtre se ferme »).

Conséquence heureuse : `apogee` et `urgent` ont **le même** `facteurAccords` (1.0), donc le calcul n'a
aucune ambiguïté. Règle : **facteur = le maximum des facteurs des drapeaux actifs.**
Aucun drapeau (garde inconnue) → facteur `0.85`.

## D5 — Plan : curseur 24 → 46 px

La règle « cibles tactiles ≥ 44 px » devient :
> **≥ 44 px pour toute cible d'action** (boutons, onglets, éléments de feuille).
> Les **casiers de la grille** sont une exception assumée : de **24 à 46 px**. En dessous de 24 px, un tap
> est trop imprécis pour une main prise dans une cave — c'est le contexte d'usage qui fixe la borne,
> pas l'esthétique.

Le curseur reste un agrément (84 casiers tiennent dans un écran à 46 px sur 12 colonnes).

## D6 — Résolution du KB : par identifiant, jamais par chaîne de caractères

`wine` gagne deux champs :
- `appellationId` : id de `kb/regions.json`, ou `null`.
- `cepageIds` : ids de `kb/cepages.json`, **ordonnés — le premier est le cépage dominant**.

`wine.appellation` et `wine.cepages` restent du **texte d'affichage** (ce qui est écrit sur l'étiquette).
**`garde.js` et `accords.js` ne lisent QUE les `…Id`.**

À la saisie, `kb.js` tente la résolution (normalisation NFD, sans accents, minuscules, mentions
`AOC|AOP|AC|DOC|DOCG|IGP|DOP` retirées, espaces/tirets compressés). **Si elle échoue : l'app avertit
mais accepte** — bandeau *« Appellation inconnue du référentiel — la garde et les accords seront
estimés depuis le cépage »*. Jamais de correspondance approximative silencieuse.

## D7 — Import Excel : supprimé partout

Il survit dans six endroits du PRD et de `CLAUDE.md` alors que le §8 le déclare hors périmètre.
SheetJS, `app/import-xlsx.js`, l'écran d'import, le mapping du §4.3, `region.nomExcel` : **tout part.**

## D8 — Lecture des données : API GitHub, jamais GitHub Pages

`data.json` est lu **toujours** via `GET api.github.com/repos/{owner}/{repo}/contents/data.json`.
Le fichier servi par Pages est en retard de 20 s à plusieurs minutes après un commit : Alice boirait une
bouteille et la reverrait à l'écran. La copie servie par Pages ne sert **qu'** au cache hors-ligne.

## D9 — Identifiants alloués par l'opération, jamais par l'appelant

Le `payload` d'une opération de création ne contient **aucun** `id` ni `ref` : `ops.js` les dérive du
document sur lequel l'opération est appliquée, **au moment où elle est appliquée**. Sans cela, une
opération rejouée après un 409 réutilise un identifiant déjà pris — précisément le bug que
l'architecture prétend éliminer. Voir la matrice des préconditions dans `CLAUDE.md` § « Écriture ».

## D10 — Tests : le minimum utile

- `tests/garde.test.mjs` — les 9 vecteurs chiffrés de `SPEC_MOTEURS.md`.
- `tests/accords.test.mjs` — les 8 vecteurs chiffrés de `SPEC_MOTEURS.md`.
- `tests/ops.test.mjs` — **le test du conflit 409** : deux opérations concurrentes, les deux survivent.
- `node --test`, **zéro dépendance**.

Les invariants restent vérifiés par `scripts/validate-data.mjs` (exécuté à la main), pas par des tests.

## D11 — Fonctions secondaires : arbitrage

| Fonction | Décision |
|---|---|
| Écran **Diagnostic** dans Réglages | ✅ **conservé** (sha courant, `updatedAt`/`updatedBy`, 20 dernières opérations, état du token, état du service worker) |
| Filtre « budget » sur l'écran Accords | ❌ **supprimé** — on ne choisit pas un vin de sa propre cave par son prix |
| Export CSV | ❌ **supprimé** — l'export `data.json` suffit, et le fichier est de toute façon public sur GitHub |
| Thème sombre | ❌ **supprimé du périmètre v1** — `prefers-color-scheme` en CSS si c'est gratuit, sinon rien |

## D12 — Dépendances : la règle est reformulée

> **Aucune dépendance dans le code exécuté par le navigateur.**
> Les scripts de `scripts/` et `tests/` tournent sous Node et peuvent utiliser des `devDependencies`
> npm (`ajv`, `ajv-formats` pour la validation de schéma). Elles ne sont **jamais** servies par Pages.

Sans cette phrase, un agent réécrira un validateur JSON Schema à la main — ou pire, un validateur
partiel qui laissera passer des données invalides.

## D13 — Clé de casier

Un casier se désigne **partout** par `slotKey(row, col) = \`${row}|${col}\`` → `"A|12"`.
La concaténation actuelle (`"A3"`) est ambiguë dès qu'un `rowLabel` fait plus d'un caractère.
`data.schema.json > zone.disabledSlots` impose désormais le motif `^[^|]{1,4}\|[^|]{1,4}$`.

## D14 — Encodage GitHub

`btoa(JSON.stringify(data))` **lève une exception** sur « Côte Rôtie », « Château », « Dézaley ».
Le couple TextEncoder/TextDecoder est **obligatoire**, et écrit noir sur blanc dans `CLAUDE.md`.

---

## Ce qui change dans le plan de lots

| Lot | Avant | Après |
|---|---|---|
| L0 | Socle | Socle **+ D9 (ids dans `ops.js`), D8 (lecture API), D13 (`slotKey`), D14 (base64), D12 (devDeps)** |
| L1 | KB 3 pays, une session | **L1-CH → relecture → L1-FR → relecture → L1-IT** |
| L2 | Plan | Curseur **24**→46 px ; §6.1 réécrit (plus de pinch-zoom, plus de « bandes ») |
| L3 | Garde | `calculerGardeVin` + `gardeEffective` ; vecteurs G1–G9 verts |
| L4 | Accords | Barème recalibré ; repli ; vecteurs A1–A8 verts |
| L5 | Reste | **CSV et thème sombre retirés** ; Diagnostic ajouté |
| L6 | Claude Code | Inchangé |
