# Audit de cohérence — 14 juillet 2026

## 1. Verdict

**Non, pas tel quel** : la liste d'opérations que L0 doit implémenter est incomplète ou sous-spécifiée
sur trois points (`UPDATE_BOTTLE`/`UPDATE_TASTING` absents alors que le PRD exige ces éditions,
`DELETE_ZONE` sans précondition, `ADD_BOTTLES` « toujours rejouable » sans réserve sur les emplacements),
et `DECISIONS.md` D2 contredit `kb/accords.json` sur la borne du repli. Chaque correction tient en une ou
deux lignes de documentation ; les 17 vecteurs sont conformes et tous les contrôles mécaniques passent.

## 2. Vérification des vecteurs

Recalculés à la main depuis `kb/garde.json`, `kb/accords.json` et l'algorithme de `SPEC_MOTEURS.md`.
Année de référence : 2026.

### Garde (G1–G9)

| # | Calcul complet | Obtenu | Verdict |
|---|---|---|---|
| G1 | `appellationId: it-barolo` → tier `grandeGarde`. Prix 60 > 40 → +1, **plafonné** (déjà au sommet de `ordreTiers`) → `grandeGarde` (de 6, a 30, apogée 15). Standard ×1.0. Base 2019. Drapeaux 2026 : 2025 ≤ 2026 ≤ 2049 → `aBoire` ; \|2026−2034\| = 8 > 1 → pas `apogee`. | **2025 / 2034 / 2049**, aBoire | ✅ |
| G2 | `ch-valais-fendant` → `leger` (1, 4, 2). Prix 22 ∈ ]10;40[ → aucun modificateur. Base 2024. Drapeaux : `aBoire` (2025 ≤ 2026 ≤ 2028) + `apogee` (\|2026−2026\| = 0) ; `urgent` non (2027 > 2026). | **2025 / 2026 / 2028**, aBoire + apogee | ✅ |
| G3 | `appellationId` null → cépage `pinot-noir` → `garde`. Prix 65 > 40 → **+1 → `grandeGarde`** (6, 30, 15). Base 2019. | **2025 / 2034 / 2049**, aBoire | ✅ |
| G4 | idem G3 mais prix 8 < 10 → **−1 → `moyen`** (2, 8, 4). Base 2019 → 2021/2023/2027. Drapeaux : `aBoire` + `urgent` (gardeA−1 = 2026 ≤ 2026 ≤ 2027). | **2021 / 2023 / 2027**, aBoire + urgent | ✅ |
| G5 | `grandeGarde` ; **magnum ×1.25 sur `a` et `apogee` uniquement** : a = 30×1.25 = 37.5 → `Math.round` → **38** ; apogée = 15×1.25 = 18.75 → **19** ; **`de` = 6 inchangé**. Base 2019. | **2025 / 2038 / 2057**, aBoire | ✅ |
| G6 | `leger` ; demi ×0.75 : a = 4×0.75 = 3 ; apogée = 2×0.75 = 1.5 → `Math.round` → 2 ; `de` = 1 inchangé. Base 2024 → 2025/2026/2027. Drapeaux : `aBoire` + `apogee` (Δ0) + `urgent` (2026 ≤ 2026 ≤ 2027). | **2025 / 2026 / 2027**, aBoire + apogee + urgent | ✅ |
| G7 | `appellationId` null, `cepageIds` vide → couleur `Effervescent` → `defautParCouleur` = `leger`. Prix 45 > 40 → +1 → `moyen` (2, 8, 4). Millésime null → **base = année d'acquisition = 2024**. Mention « Fenêtre estimée depuis l'achat (vin non millésimé) ». | **2026 / 2028 / 2032**, aBoire + mention | ✅ |
| G8 | couleur `Rouge` → `moyen` (2, 8, 4). Prix **null → aucun modificateur**. Base 2020. | **2022 / 2024 / 2028**, aBoire | ✅ |
| G9 | millésime null, aucune bouteille → étape 5 : **retourner null**. Aucun drapeau sauf `inconnu` → facteur 0.85. | **null / null / null**, inconnu (0.85) | ✅ |

### Accords (A1–A8)

| # | Calcul complet | Obtenu | Verdict |
|---|---|---|---|
| A1 | fondue : appellation `ch-valais-fendant` la liste → +50 ; cépage `chasselas` la liste → +30 ; seule règle de profil citant fondue = {Blanc, acidité ≥ 4, sucre ≤ 1} — chasselas acidité **3** → non satisfaite → +0. Base 80. Anti-règle tanin ≥ 3 : tanin 0 → non. Facteur = max(aBoire 0.9, apogee 1.0) = 1.0. | round(80×1.0) = **80**, affiché | ✅ |
| A2 | raclette : profil du cépage dominant `nebbiolo`, tanin **5 ≥ 3** → anti-règle fondue/raclette → **score 0, exclu y compris du repli**. | **0**, exclu | ✅ |
| A3 | gibier : `it-barolo` +50 ; `nebbiolo` +30 ; règle {tanin≥4, corps≥4} (5/4) cite gibier → +10. Base 90. Facteur aBoire 0.9. | round(81) = **81**, affiché | ✅ |
| A4 | pates_tomate : appellation hors KB → +0 ; `barbera` la liste → +30 ; règle {tanin≤2, corps≤3, Rouge} (2/3) la cite → +8. Base 38. Facteur 0.9. | round(34.2) = **34** ≥ 30, affiché | ✅ |
| A5 | raclette : +0 / +0 ; **profil défaut Blanc** (acidité 4 ≥ 4, sucre 0 ≤ 1) satisfait la règle Blanc-vif → +10. Base 10. Anti-règle : tanin 0 → non. Facteur `inconnu` 0.85. | round(8.5) = **9** < 30, repli uniquement | ✅ |
| A6 | raclette : cépage non résolu → **profil défaut Rouge, tanin 3 ≥ 3** → anti-règle → **score 0, exclu**. Le filet fonctionne : sans le défaut, `undefined >= 3` serait faux et le vin serait proposé. | **0**, exclu | ✅ |
| A7 | viandes_rouges_grillees : `ch-valais-syrah` +50 ; `syrah` +30 ; règle {tanin≥4, corps≥4} (4/4) → +10. Base 90. Facteur aBoire 0.9. | round(81) = **81**, affiché | ✅ |
| A8 | 50 + 30 + 35 = 115 → **min(115, 100) = 100 AVANT le facteur** ; ×1.0. | **100** | ✅ |

**17/17 conformes.** Les points de vigilance du brief sont vérifiés : G5 (arrondi 37.5→38, `de` non
multiplié), G7 (base = acquisition), A2 **et** A6 tous deux exclus, A8 (plafond avant facteur).

## 3. Vérification mécanique

Exécuté avec `ajv` 8 + `ajv-formats` (draft 2020-12 via `ajv/dist/2020.js`), installés **hors du dépôt**
(scratchpad), via un script ad hoc lui aussi hors dépôt — aucun fichier du dossier n'a été modifié.
Note : le dossier audité est à plat dans `files/` ; les chemins ci-dessous sont ceux du dépôt cible.

```bash
npm install ajv ajv-formats     # dans le scratchpad, pas dans le dépôt
node verif.mjs                  # compile les 3 schémas, vérifie l'intégrité référentielle
```

| Contrôle | Résultat |
|---|---|
| `data.json` valide contre `schema/data.schema.json` | ✅ PASS |
| `kb/cepages.seed.json` valide contre `schema/kb.cepages.schema.json` | ✅ PASS |
| `kb/regions.seed.json` valide contre `schema/kb.regions.schema.json` | ✅ PASS |
| Tout `cepages[]` cité par une appellation existe dans les cépages | ✅ PASS |
| Tout id de plat cité (cépages, appellations, `wine.mets`, règles de profil, anti-règles) existe dans `kb/accords.json > plats` | ✅ PASS |
| Tout `tierGarde` cité (cépages, appellations, `defautParCouleur`, `service._parTier`) existe dans `kb/garde.json > tiers` | ✅ PASS |
| `wine.appellationId` et `wine.cepageIds[]` de `data.json` existent dans le KB (ou null/vide) | ✅ PASS |
| Bonus : `facteurAccords` ↔ `statuts` (mêmes 6 drapeaux) ; les 6 couleurs couvertes par `defautParCouleur`, `profilDefautParCouleur` et `service` | ✅ PASS |

## 4. Problèmes

| # | Gravité | Fichier(s) | Problème | Effet concret | Correction proposée (une ligne) |
|---|---------|-----------|----------|---------------|--------------------------------|
| 1 | BLOQUANT | `docs/DECISIONS.md` D2 · `kb/accords.json` | D2 dit repli = « les 5 meilleurs (**score ≥ 10**) » ; `kb/accords.json` dit `scoreMinimum: 1` et SPEC dit « score > 0 ». D2 recopie le barème hors de son fichier de référence, et a déjà divergé. | L'agent L4 qui obéit au chiffre de D2 exclut du repli le blanc de A5 (score 9) : le vecteur échoue, ou pire, sans lancer les vecteurs, la suggestion disparaît de l'écran. | Réécrire D2 sans aucun chiffre : renvoi à `kb/accords.json > ponderation` et `> repli`. |
| 2 | BLOQUANT | `docs/BRIEFS_LOTS.md` L0 · `CLAUDE.md` § Écriture | PRD §4.2 exige l'édition d'une acquisition **bouteille par bouteille** et §6.6 l'édition d'une dégustation **a posteriori**, mais aucune opération `UPDATE_BOTTLE` / `UPDATE_TASTING` n'existe dans la liste L0 ni dans la matrice des préconditions. | L'agent L5 inventera sa mutation hors matrice ; l'implémentation naturelle (« je pousse l'objet entier ») écrase l'édition concurrente de l'autre utilisateur au retry après 409. | Ajouter `UPDATE_BOTTLE` et `UPDATE_TASTING` à la liste L0 et à la matrice (« champs édités seulement, dernier écrivain gagne »). |
| 3 | MOYEN | `CLAUDE.md` § Écriture (matrice) | `DELETE_ZONE` figure dans la liste L0 mais pas dans la matrice des préconditions, et aucun document ne traite la suppression d'une zone **contenant des bouteilles** (l'invariant 5 ne couvre que la *réduction*). | Une zone supprimée avec bouteilles laisse des `slot` pointant vers une zone inexistante : les bouteilles disparaissent du plan sans avoir été bues. | Étendre l'invariant 5 à la suppression (« zone occupée → refus + liste ») et ajouter `DELETE_ZONE` à la matrice. |
| 4 | MOYEN | `CLAUDE.md` § Écriture (matrice) | `ADD_BOTTLES` est « toujours rejouable » sans réserve, alors que son payload peut porter des emplacements. | Alice ajoute 3 bouteilles placées en A\|3–A\|5 ; Bob déplace une bouteille sur A\|4 ; le rejeu d'Alice après 409 pose **deux bouteilles sur A\|4** (invariant 2 violé, silencieusement). | Préciser : `ADD_BOTTLES` crée en `slot: null`, le placement passe par `PLACE_BOTTLE` (ou : au rejeu, casier occupé → `slot: null` + bandeau « à ranger »). |
| 5 | MOYEN | `docs/SPEC_MOTEURS.md` §2 | La production de `wine.mets` (`metsSource: "auto"`) n'est définie nulle part : le moteur décrit plat → vins, jamais quels plats écrire sur le vin. La graine suggère « accords de l'appellation ∪ cépage dominant » sans le dire. | L'app et `query.mjs` remplissent des chips « Accords mets » différents pour le même vin — deux réponses différentes, exactement ce que le test d'alignement L6 existe pour empêcher. | Une ligne dans SPEC §2 : « `mets` auto = accords de l'appellation ∪ accords du cépage dominant » (ou la règle tranchée en §6 ci-dessous). |
| 6 | MOYEN | `prototype-plan-cave.html` (absent) · `README.md` · `docs/BRIEFS_LOTS.md` L2 | Le fichier déclaré « fait foi » pour la référence visuelle du plan, et normatif pour L2 (dimensions, six états, gestes), **n'est pas dans le dossier**. | L'agent L2 réinvente le rendu et les gestes déjà tranchés sur téléphone — la variante « bandes », testée et écartée, peut réapparaître. | Ajouter le fichier au dépôt avant L2 (n'empêche ni L0 ni L1). |
| 7 | MINEUR | `docs/DECISIONS.md` (en-tête et D9) | Deux renvois vers `PATCHS.md`, qui n'existe pas ; la matrice des préconditions citée vit dans `CLAUDE.md`. | Un agent qui suit le renvoi de D9 ne trouve rien et perd la matrice de vue. | Remplacer les deux renvois par « `CLAUDE.md` § Écriture ». |

## 5. Ce que je propose de RETIRER du périmètre

- **Le budget de performance à 600 casiers** (PRD §7.1 : « premier rendu < 150 ms », 16 ms/frame ;
  BRIEFS L2 : « vérifier que ça ne s'effondre pas à 600 ») et la fixture qui va avec. La cave fait
  84 casiers ; le second meuble envisagé la porterait à ~170. Aucun scénario de défaillance concret
  n'existe à cette échelle avec un nœud DOM par casier. Proposer : ramener la fixture de
  `make-fixture.mjs` à ~170 casiers et supprimer le budget chiffré — le critère « scroll fluide sur le
  téléphone du commanditaire » suffit. Gain : une session L2 qui n'optimise pas pour un problème
  inexistant.

## 6. Questions au commanditaire

1. **`mets` auto** (problème n°5) — quelle règle ? **(a)** union des accords de l'appellation et du
   cépage dominant (ce que la graine `data.json` reflète), ou **(b)** les plats dont le score du moteur
   atteint `seuilAffichage` ?
2. **`prototype-plan-cave.html`** (problème n°6) — le fichier existe-t-il et sera-t-il ajouté au dépôt
   avant L2 : oui / non ?

---

## Post-scriptum — 14 juillet 2026, corrections appliquées

Les 7 problèmes du §4 sont **résolus**, sur validation du commanditaire :
n°1 (D2 réécrit sans chiffres), n°2 (`UPDATE_BOTTLE`/`UPDATE_TASTING` ajoutés à L0 et à la matrice),
n°3 (invariant 5 étendu à la suppression de zone, `DELETE_ZONE` dans la matrice), n°4 (`ADD_BOTTLES`
crée en `slot: null`), n°5 (question 1 tranchée : option **(a)** — SPEC_MOTEURS §2.5 ajouté, graine
`data.json` alignée), n°6 (question 2 : oui — prototype ajouté au dépôt ; il montre cinq des six états,
« désactivé » est spécifié par le texte du PRD seul, et sa variante B est marquée « testée et
écartée »), n°7 (renvois `PATCHS.md` remplacés). Contrôles mécaniques du §3 relancés après corrections :
**tout passe**. La proposition du §5 a également été **acceptée** : fixture ramenée à 170 casiers
(cave réelle + second meuble) et budget chiffré remplacé par le critère « scroll et curseur fluides
sur le téléphone cible » (PRD §7.1, §11, brief L2).
