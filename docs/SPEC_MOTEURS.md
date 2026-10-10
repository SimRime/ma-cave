# SPEC_MOTEURS — garde et accords

**Ce document fait foi.** `app/garde.js`, `app/accords.js` et `scripts/query.mjs` l'implémentent ;
personne d'autre. Les barèmes vivent dans `kb/garde.json` et `kb/accords.json` — **aucune constante
métier en dur dans le code.**

Les vecteurs de test en fin de document sont **normatifs** : un lot n'est pas terminé tant qu'ils ne
passent pas. Ce sont eux, pas la prose, qui définissent le comportement attendu.

---

## 1. Moteur de garde

### 1.1 Deux fonctions, une seule persistée

```js
// Fenêtre CANONIQUE du vin : format standard. C'est la SEULE valeur écrite dans data.json.
calculerGardeVin(wine, bottles, kb) → { gardeDe, gardeA, apogee, gardeExplication } | null

// Fenêtre de CETTE bouteille : applique le format, et le cas non millésimé.
// JAMAIS persistée. Recalculée à l'affichage.
gardeEffective(wine, bottle, kb) → { gardeDe, gardeA, apogee, mention }
```

Le Plan, la Fiche (ligne « bouteilles »), « À boire » et les Accords utilisent **`gardeEffective`**.
Le **statut d'un vin** = celui de sa bouteille **la plus urgente** (celle dont `gardeA` est le plus proche).

### 1.2 Algorithme, dans cet ordre

**Étape 1 — Résoudre le tier** (cascade, premier trouvé gagne) :

1. `wine.appellationId` → `kb/regions.json` → `appellation.tierGarde` — **sauf si `null`** : une
   appellation régionale ou un vin de pays ne discrimine rien, la cascade continue et l'appellation
   reste résolue pour le reste (région, accords, affichage). Voir D16.
2. `wine.cepageIds[0]` (le **dominant**) → `kb/cepages.json` → `cepage.tierGarde` — **sauf si
   `wine.cepageDominantInconnu`** : les ids présents sont alors tous des cépages secondaires, et un
   secondaire ne gouverne jamais le vin. Voir D17.
3. `wine.couleur` → `kb/garde.json > defautParCouleur`

`wine.appellation` (texte libre) n'est **jamais** consulté. Voir D6.

**Étape 2 — Modificateur de prix** (décalage du tier)

- Base : **`wine.prixReference`**. Jamais `bottle.acquisition.prix` (un cadeau vaut `null` et changerait
  la garde selon la bouteille).
- `prixReference === null` → **aucun modificateur**.
- **Paliers** (`kb/garde.json > modificateurs.prix.paliers`), premier dont le prix est **strictement
  inférieur** à la borne, ou palier terminal (`jusquA: null`) :

  | `prixReference` | décalage |
  |---|---|
  | < 20 CHF | **−1 cran** |
  | 20 – 45 CHF | aucun |
  | 45 – 80 CHF | **+1 cran** |
  | ≥ 80 CHF | **+2 crans** |

  Le cépage dit ce que le raisin **peut** faire ; le prix dit si **cette bouteille-là** le fait. C'est le
  seul signal disponible quand l'appellation est régionale (`tierGarde: null`, D16). Les deux seuils
  d'origine (10 et 40) laissaient sans correction 35 des 42 vins tarifés de la cave réelle.
- Le décalage est **borné** : `primeur < leger < moyen < garde < grandeGarde`. Un Barolo à 60 CHF reste
  `grandeGarde` (pas de cran au-dessus), et le `shift` cité dans l'explication est celui **après** bornage
  — un décalage absorbé par la borne n'est pas mentionné.

**Étape 3 — Durées du tier** → `{ de, a, apogee }` en années.

**Étape 4 — Modificateur de format** (uniquement dans `gardeEffective`)

- Multiplie **`a` et `apogee`**, jamais `de` (le vin ne devient pas buvable plus tard parce qu'il est en
  magnum ; il tient simplement plus longtemps).
- `magnum` ×1.25 · `demi` ×0.75 · `clavelin` ×1.0 · `standard` ×1.0.
- **Arrondi : `Math.round`** sur le nombre d'années, après le facteur. (`30 × 1.25 = 37.5 → 38`.)

**Étape 5 — Année de base**

- `wine.millesime` s'il existe.
- Sinon (**vin non millésimé**) :
  - dans `gardeEffective` : l'année de `bottle.acquisition.date` ;
  - dans `calculerGardeVin` : l'année de l'acquisition **la plus ancienne** parmi les bouteilles du vin
    (déterministe) ;
  - dans les deux cas, `mention = "Fenêtre estimée depuis l'achat (vin non millésimé)"`, **affichée**.
- Ni millésime ni bouteille → **retourner `null`** (`gardeDe`/`gardeA`/`apogee` restent `null`,
  statut `inconnu`). Ne jamais inventer une année.

**Étape 6 — Fenêtre** : `gardeDe = base + de`, `apogee = base + apogee`, `gardeA = base + a`.

**Étape 7 — Explication** (obligatoire si `gardeSource: "auto"`) :

> `« appellation Barolo (grande garde) + millésime 2019 »`
> `« cépage Pinot Noir (vin de garde), relevé d'un cran (prix 65 CHF) + millésime 2019 »`
> `« couleur Rouge (garde moyenne) + millésime 2020 — appellation et cépage inconnus du référentiel »`

Quand la cascade est descendue parce que l'appellation portait `tierGarde: null`, le suffixe le **dit** —
l'appellation est connue, pas absente :

> `« cépage Cornalin (vin de garde) + millésime 2022 — appellation Valais, trop large pour fixer une garde »`

L'explication cite le **prix saisi**, jamais le seuil franchi : avec plusieurs paliers, « prix > 40 CHF »
ne désignerait plus rien de précis, et c'est le chiffre saisi que l'utilisateur veut pouvoir vérifier.

Une garde non expliquée n'est pas exploitable. C'est ce qui manque à l'Excel ; c'est la raison d'être du champ.

### 1.3 Invariant 4 rappelé

`gardeSource: "manuel"` n'est **jamais** écrasé — y compris par le bouton « recalculer tout ».
`gardeEffective` s'applique quand même (le facteur magnum reste pertinent sur une fenêtre saisie à la
main), mais **n'écrit rien**.

### 1.4 Statuts : des drapeaux, pas une valeur

Évalués sur la fenêtre **effective** de la bouteille, `annee = new Date().getFullYear()`.

| Drapeau | Condition | Libellé | Facteur d'accord |
|---|---|---|---|
| `inconnu` | `gardeDe == null \|\| gardeA == null` | garde inconnue | 0.85 |
| `tropJeune` | `annee < gardeDe` | encore fermé | 0.6 |
| `aBoire` | `gardeDe <= annee <= gardeA` | dans sa fenêtre | 0.9 |
| `apogee` | `apogee != null && abs(annee - apogee) <= 1` | à l'apogée | 1.0 |
| `urgent` | `gardeA - 1 <= annee <= gardeA` | à boire vite | 1.0 |
| `depasse` | `annee > gardeA` | fenêtre dépassée | 0.7 |

Plusieurs drapeaux peuvent être actifs. **Ils le sont tous, et on les affiche tous**
(« à l'apogée, et la fenêtre se ferme »).

> **Conséquence du recalibrage à connaître.** Un vin `moyen` n'est jamais en simple `aBoire` : sa
> fenêtre de 5 ans (+2 à +6) est entièrement couverte par `apogee` (+2 à +4, tolérance ±1) puis par
> `urgent` (+5, +6). Son facteur d'accord vaut donc toujours 1.0. Ce n'est pas un défaut — un vin à
> fenêtre courte est effectivement prêt sur toute sa fenêtre — mais c'est ce qui a fait basculer le
> vecteur A4.

**Facteur d'accord = le maximum des facteurs des drapeaux actifs.** Aucun drapeau → 0.85.
`apogee` et `urgent` valant tous deux 1.0, il n'y a **aucune ambiguïté de calcul** — c'était le seul
risque et il est levé par construction.

---

## 2. Moteur d'accords

### 2.1 Barème

```
base = 0
  + 50  si l'appellation (appellationId) du vin liste le plat
  + 30  si au moins un cépage (cepageIds) du vin liste le plat
  + Σ   poids des règles de profil satisfaites citant le plat, CUMUL PLAFONNÉ À 35
base = min(base, 100)
score = round(base × facteurAccords)

si une ANTI-RÈGLE s'applique → score = 0, le vin est EXCLU (y compris du repli)
```

- **Affichage** : les vins dont `score >= 30` (`seuilAffichage`), triés par score décroissant.
- **Repli** : si **aucun** vin n'atteint 30, afficher les **5 meilleurs** vins de score `> 0`, sous
  l'intitulé *« Aucun accord établi — suggestions d'après le profil des vins »*. Un écran vide est un
  échec ; une suggestion honnêtement étiquetée ne l'est pas.
- **Départage** (scores égaux) : drapeau `apogee` ou `urgent` d'abord, puis `wine.note` décroissante,
  puis `ref` croissante. Déterministe — l'app et `query.mjs` doivent trier **identiquement**.
- **Seuls les vins ayant au moins une bouteille en stock** sont considérés. Jamais d'exception.

Pourquoi 35 et non 20 : à 20, le plafond du profil était **inférieur** au seuil d'affichage. Les règles de
profil ne pouvaient donc jamais faire apparaître un vin — le « filet de sécurité » était décoratif.
À 35, elles peuvent le faire apparaître, mais restent en dessous des 50 de l'appellation : elles ne
peuvent toujours pas dominer une source explicite. C'était l'intention ; c'est maintenant le comportement.

### 2.2 Profil utilisé

Le profil du **cépage dominant** (`cepageIds[0]`).
**Si aucun cépage n'est résolu** → `kb/accords.json > profilDefautParCouleur`.
**Si `wine.cepageDominantInconnu`** → `profilDefautParCouleur` également, et pour la même raison :
les ids présents sont des secondaires, aucun ne décrit le vin (D17). Cela vaut aussi pour le service
(§2.3) et pour les mets automatiques (§2.5). En revanche le bonus de 30 points « au moins un cépage
liste le plat » (§2.1) reste acquis : un secondaire connu peut *suggérer* un accord, jamais *gouverner*.

Ce défaut n'est pas cosmétique : sans lui, un vin hors KB a `tanin === undefined`, l'anti-règle
`{ raclette, tanin >= 3 }` ne se déclenche pas, et **le tannat arrive sur la raclette** — exactement le
scénario que les anti-règles existent pour empêcher. Le défaut « Rouge » porte `tanin: 3` : le vin
inconnu est écarté par précaution. C'est le bon sens du doute.

### 2.3 Service (température, carafage, verre)

Cascade explicite, du plus spécifique au plus générique :

| Donnée | 1er | 2e | 3e |
|---|---|---|---|
| Température | `cepage.service.tempC` (dominant) | `service[couleur].tempC` | — |
| Verre | `cepage.service.verre` (dominant) | `service[couleur].verre` | — |
| Carafage | `cepage.service.carafage` (dominant) | `service._parTier[tier].carafage` | `service[couleur].carafage` |

Un **assemblage** n'utilise que son cépage **dominant**. Pas de moyenne : une moyenne de deux
températures de service ne veut rien dire.

### 2.4 Raison affichée

Chaque suggestion porte **sa raison**, construite depuis la source qui a marqué :

> « Appellation Barolo : gibier, truffe » (50)
> « Cépage Nebbiolo : gibier » (30)
> « Rouge tannique et corsé » (profil, 10)

Une suggestion sans raison n'est pas vérifiable par l'utilisateur, donc pas fiable.
Et **chaque suggestion affiche l'emplacement de la bouteille** — sans lui, on ne va pas fouiller la cave.

### 2.5 Le champ `mets` persisté

Si `metsSource: "auto"`, `wine.mets` = **l'union des `accords` de l'appellation résolue et de ceux du
cépage dominant**, filtrée par les anti-règles (même profil qu'en §2.2). Appellation non résolue →
accords du cépage seul ; rien de résolu → tableau vide, jamais d'invention. Les plats issus des seules
règles de profil n'y entrent pas : les chips de la fiche montrent la connaissance explicite du KB, pas
le filet de sécurité. Invariant 4 : `metsSource: "manuel"` n'est jamais écrasé, y compris par
« recalculer tout ».

---

## 3. Vecteurs de test — GARDE *(normatifs)*

`tests/garde.test.mjs`. Année de référence : **2026**. Barème recalibré en octobre 2026 : voir
`kb/garde.json > _calibrage` pour les quatre contre-étiquettes qui ont servi de banc d'essai.

| # | Vin | prixRef | Format | Millésime | Tier résolu | gardeDe | apogée | gardeA | Drapeaux 2026 |
|---|---|---|---|---|---|---|---|---|---|
| G1 | appellation `it-barolo` | 60 | standard | 2019 | `grandeGarde` (prix +1 **plafonné**) | **2024** | **2031** | **2041** | aBoire |
| G2 | appellation `ch-valais-fendant` | 22 | standard | 2024 | `leger` (aucun modif.) | **2025** | **2026** | **2028** | aBoire, apogee |
| G3 | appellation inconnue, cépage `pinot-noir` | 65 | standard | 2019 | `garde` **+1 → grandeGarde** | **2024** | **2031** | **2041** | aBoire |
| G4 | idem G3 | 8 | standard | 2019 | `garde` **−1 → moyen** | **2021** | **2022** | **2025** | depasse |
| G5 | idem G3 | 65 | **magnum** | 2019 | `grandeGarde`, ×1.25 sur `a` et `apogee` | **2024** | **2034** | **2047** | aBoire |
| G6 | idem G2 | 22 | **demi** | 2024 | `leger`, ×0.75 (`a` 4→3, `apogee` 2→2) | **2025** | **2026** | **2027** | aBoire, apogee, urgent |
| G7 | couleur `Effervescent`, rien d'autre, acquis **2024-03-01** | 45 | standard | **null** | `leger` **+1 → moyen** | **2026** | **2027** | **2030** | aBoire, apogee + **mention BSA** |
| G8 | `pays: XX`, cépage libre inconnu, `Rouge` | **null** | standard | 2020 | défaut couleur → `moyen` | **2022** | **2023** | **2026** | aBoire, urgent |
| G9 | millésime `null`, **aucune bouteille** | — | — | null | — | **null** | **null** | **null** | **inconnu** (facteur 0.85) |
| G10 | appellation `ch-valais-rouge` (**`tierGarde: null`**), cépage `cornalin` | null | standard | 2022 | **cépage** `garde` — l'appellation ne court-circuite pas | **2025** | **2029** | **2034** | aBoire |
| G11 | appellation `ch-valais-rouge`, **aucun cépage** | null | standard | 2022 | défaut couleur → `moyen` | **2024** | **2025** | **2028** | aBoire, apogee |
| G12 | appellation inconnue, `cepageIds: ["merlot"]` + **`cepageDominantInconnu`** | null | standard | 2021 | défaut couleur → `moyen`, **pas** `garde` | **2023** | **2024** | **2027** | aBoire, urgent |

*Vérifications que ces vecteurs verrouillent :* le plafonnement du décalage de tier (G1), le décalage
vers le haut et vers le bas (G3/G4), l'arrondi du facteur de format (G5 : 22×1.25 = 27,5 → **28**),
le fait que `de` n'est **pas** touché par le format (G5/G6), la base d'acquisition (G7), le cas dégénéré
qui produisait `NaN` (G9), la traversée d'une appellation sans tier (G10/G11, D16) et le refus de
promouvoir un cépage secondaire (G12, D17).

### 3.1 Vecteurs de test — RÉSOLUTION DU KB *(normatifs)*

`tests/kb.test.mjs`. Ils verrouillent `resolveAppellation` / `resolveCepage`, dont dépend tout le reste.

| # | Saisie | Couleur | Attendu |
|---|---|---|---|
| K1 | `"La Côte"` | `Rouge` | `ch-vaud-la-cote-rouge` — **jamais** l'entrée blanche |
| K2 | `"Barolo DOCG"` | `Rouge` | `it-barolo` (mention `DOCG` retirée) |
| K3 | `"Ticino DOC"` | `Rouge` | `ch-ticino-merlot` (par synonyme) |
| K4 | `"Saint-Émilion Grand Cru"` | `Rouge` | `fr-saint-emilion` (par synonyme, « Grand Cru » **non** retiré par `MENTIONS`) |
| K5 | `"Salento IGT"` | `Rouge` | `it-salento` (mention `IGT` retirée) |
| K6 | `"Dézaley"` | `Rouge` | **`null`** — l'entrée existe en blanc, la couleur ne correspond pas |
| K7 | `"Navarra"` | `Rouge` | **`null`** — hors périmètre (D15), et l'app accepte quand même |
| K8 | `"Tinta del País"` | — | `tempranillo` (par synonyme) |

---

## 4. Vecteurs de test — ACCORDS *(normatifs)*

`tests/accords.test.mjs`. Année de référence : **2026**. Vins supposés en stock.

| # | Vin | Plat | Appell. | Cépage | Profil | Base | Facteur | **Score** | Résultat |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Fendant 2024 (`ch-valais-fendant`, `chasselas`) | `fondue` | 50 | 30 | 0 | 80 | 1.0 (apogee) | **80** | affiché — accord établi |
| A2 | Barolo 2019 (`it-barolo`, `nebbiolo`) | `raclette` | — | — | — | — | — | **0** | **exclu** (anti-règle : tanin 5 ≥ 3) |
| A3 | Barolo 2019 | `gibier` | 50 | 30 | 10 | 90 | 0.9 (aBoire) | **81** | affiché |
| A4 | Barbera, **appellation hors KB** | `pates_tomate` | 0 | 30 | 8 | 38 | 1.0 (urgent) | **38** | **affiché** ← le cas que l'ancien barème ratait (< 40) |
| A5 | Blanc `pays: XX`, cépage inconnu, garde inconnue | `raclette` | 0 | 0 | 10 (profil **défaut** Blanc) | 10 | 0.85 | **9** | **repli uniquement** |
| A6 | Rouge `pays: XX`, cépage inconnu | `raclette` | 0 | 0 | — | — | — | **0** | **exclu** (profil défaut Rouge : tanin 3 → anti-règle) |
| A7 | Syrah du Valais 2022 (`ch-valais-syrah`, `syrah`) | `viandes_rouges_grillees` | 50 | 30 | 10 | 90 | 0.9 (aBoire) | **81** | affiché |
| A8 | Vin fictif : appellation 50 + cépage 30 + profil 35 | quelconque | 50 | 30 | 35 | **100** (plafonné, pas 115) | 1.0 | **100** | plafond respecté |

*Vérifications que ces vecteurs verrouillent :* les anti-règles priment sur tout (A2), le profil par défaut
fait fonctionner les anti-règles sur un vin inconnu (A6 — sans lui, le score serait > 0 et le vin proposé),
le recalibrage rend visible un accord cépage correct (A4), le repli existe et est étiqueté (A5),
le plafond à 100 est appliqué **avant** le facteur (A8).

**Test d'alignement (lot L6)** — `tests/query.test.mjs` :
`node scripts/query.mjs --accord viandes_rouges_grillees --en-stock --json` doit produire **exactement**
le même tableau `[{ wineId, score, drapeaux }]` que `accords.js` appelé directement sur la même fixture.
Toute divergence fait échouer le test. C'est la seule preuve mécanique que l'app et Claude Code ne
donneront jamais deux réponses différentes.
