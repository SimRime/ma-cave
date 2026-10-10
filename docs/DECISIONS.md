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

## D15 — Cognac, Porto, VDN : périmètre du KB (tranché en L1-FR)

Le modèle `kb/regions.json` n'offre que six couleurs (`Rouge`, `Blanc`, `Rosé`, `Effervescent`,
`Liquoreux`, `Jaune`) et trois codes pays (`FR`, `CH`, `IT`). Trois cas du périmètre PRD §5.1 n'y
entrent pas proprement :

- **Cognac** : eau-de-vie, pas un vin. Aucune couleur, aucune logique de garde/accords ne s'applique.
  **Exclu.**
- **Porto** : vin fortifié **portugais** ; le code pays n'existe pas dans l'enum. **Exclu.**
- **VDN français** (Banyuls, Maury, Muscat de Rivesaltes, Muscat de Beaumes-de-Venise) : vins mutés,
  mais bel et bien des vins de cave → **modélisés en `Liquoreux`** (couleur la plus proche), cépage
  dominant Grenache ou Muscat, accords foie gras / bleus / desserts.

Les faire entrer un jour — ou un Marsala, un Xérès — demande une **évolution du schéma** (nouvelle
couleur « Fortifié », élargissement de l'enum `pays`), jamais un contournement. **L1-IT tranche
Marsala de la même façon.**

## D16 — Synonymes d'appellation, et appellations trop larges pour porter une garde

Constat qui déclenche la décision : sur un relevé de 42 rouges (25 suisses), **33 appellations
d'étiquette ne résolvaient pas**. Les étiquettes suisses portent « AOC Valais », « Ticino DOC »,
« AOC Chablais » ; le référentiel, lui, nomme les dénominations par cépage (Fendant, Dôle,
*Cornalin du Valais*, *Merlot del Ticino*). L'entrée `ch-ticino-merlot` portait même la note
« c'est l'appellation générique “Ticino DOC” en rouge » — que rien ne permettait d'atteindre.

**Deux ajouts, et ils vont ensemble.**

**1. `appellation.synonymes`** — même mécanique que `cepage.synonymes`, indexée sur le couple
`(libellé normalisé, couleur)`. Une appellation se reconnaît sous tous ses noms d'étiquette.
`scripts/validate-kb.mjs` refuse désormais deux entrées qui revendiqueraient la **même clé de
résolution pour la même couleur** : sans ce garde-fou, le synonyme le plus utile est aussi le plus
facile à poser deux fois.

**2. `appellation.tierGarde: null`** — autorisé, et **obligatoire à écrire explicitement**.

C'est le point de fond. Une appellation régionale (« Valais » rouge, « Vin de Pays Suisse ») couvre
un pinot de supermarché et un assemblage élevé en barrique. Lui attribuer un tier moyen serait pire
que de n'en attribuer aucun : **l'appellation est la première marche de la cascade, elle court-circuite
le cépage, qui en sait davantage.** Sur ce relevé, déclarer « Valais rouge → `moyen` » aurait dégradé
dix vins correctement classés `garde` par leur Cornalin, leur Humagne ou leur Syrah.

`tierGarde: null` fait donc tomber la cascade à l'étape 2 **sans perdre l'appellation** : la région,
les accords et l'affichage restent résolus. `gardeExplication` le dit —
*« — appellation Valais, trop large pour fixer une garde »* — plutôt que le mensonge
*« appellation inconnue du référentiel »*.

> **Règle pour les lots L1.** Un tier s'attribue à une appellation qui *discrimine*. Si la même
> entrée recouvre des vins dont la garde va du simple au quadruple, c'est `null`. Ne pas moyenner.

## D17 — Cépage dominant non résolu : ne jamais promouvoir le suivant

`wine.cepageIds[0]` **est** le cépage dominant : il décide du tier de garde, du profil d'accord, de la
température de service, du verre et du carafage. Or la saisie ne poussait que les libellés *résolus* :
un Navarra « Tempranillo, Merlot, Garnacha, Syrah » dont le Tempranillo était absent du KB se retrouvait
classé, servi et accordé **comme un Merlot**, sans que rien ne le signale.

Les deux sorties possibles étaient : promouvoir le suivant (ce que faisait le code), ou retomber sur la
couleur. **On retombe sur la couleur** — mais sans jeter les cépages secondaires, qui sont une
information vraie.

`wine` gagne donc un drapeau **`cepageDominantInconnu`** (booléen, défaut `false`), posé à la saisie
quand le **premier** libellé de l'étiquette ne résout pas. Il ne change pas le contrat : il dit que
l'index 0 ne vaut pas dominant pour ce vin.

| Lecture | Avec le drapeau |
|---|---|
| `garde.js` — étape 2 de la cascade | **sautée** → couleur |
| `accords.js` — profil, service (temp., verre, carafage) | **profil par défaut de la couleur** |
| `accords.js` — bonus « un cépage cite ce plat » | **inchangé** : les secondaires comptent |
| `kb.metsUnionKb` / `metsAutomatiques` | accords de l'appellation seuls |

Autrement dit : un cépage secondaire connu peut toujours *suggérer* un accord, jamais *gouverner*
le vin. Une estimation prudente et dite vaut mieux qu'une estimation fausse et sûre d'elle — c'est
la même règle que D6, appliquée un cran plus bas.

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
