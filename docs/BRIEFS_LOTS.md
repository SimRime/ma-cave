# Briefs de lot — Ma Cave

Un lot = **une session d'agent**. Chaque brief est autonome : on le donne tel quel, avec `README.md`,
`CLAUDE.md` et les documents qu'il cite.
**Ne jamais enchaîner deux lots dans une même session.** Chaque lot se termine par une vérification
humaine.

Ordre : **L0 → L1-CH → L1-FR → L1-IT → L2 → L3 → L4 → L5 → L6.**
Les lots L1-* peuvent se faire en parallèle de L0 : contenu pur, aucun code.

> **Aucun brief ne recopie une règle métier, un barème ou un invariant.** Il renvoie au document qui fait
> foi. Un chiffre recopié dans un brief est le plus dangereux de tous : l'agent y voit la consigne la plus
> explicite du dossier et l'applique **contre** le fichier de référence.

---

## L0 — Socle

**Objectif.** Le squelette qui lit et écrit `data.json` sur GitHub. Rien d'autre. Aucune fonctionnalité
métier.

**À créer.**
```
index.html · manifest.json · assets/styles.css · package.json (devDependencies: ajv)
app/main.js      routeur par hash (#/plan, #/vins, #/reglages), coquilles vides
app/store.js     état en mémoire, application des opérations, abonnements
app/ops.js       DRINK_BOTTLE, MOVE_BOTTLE, PLACE_BOTTLE, ADD_WINE, ADD_BOTTLES,
                 UPDATE_WINE, UPDATE_BOTTLE, DELETE_WINE, ADD_TASTING, UPDATE_TASTING,
                 UPSERT_ZONE, DELETE_ZONE
                 + ALLOCATION DES ids ET DES ref (voir CLAUDE.md § Écriture)
app/github.js    SEUL module réseau : lecture par l'API, écriture, sha, 409, retry, base64 UTF-8
app/format.js    slotKey(row, col), normalisation de recherche, libellés
app/views/reglages.js   token, nom d'utilisateur, test de connexion, écran Diagnostic
data.json        graine fournie : 1 zone 7×12 (« Ma cave », 84 casiers), 2 vins, 3 bouteilles
                 (dont 1 magnum reçu en cadeau), 1 dégustation
scripts/validate-data.mjs   schéma + les six invariants
schema/data.schema.json     (fourni)
tests/ops.test.mjs
```

**Le cœur du lot, c'est `ops.js`.** Chaque opération est un **delta rejouable** : une fonction pure
`(data, payload) → data`. Jamais un remplacement d'état complet. `github.js` doit pouvoir la réappliquer
sur une version rechargée après un 409.

**Lire `CLAUDE.md` § « Écriture » avant d'écrire une ligne.** Il contient les quatre choses qui font
échouer ce lot si on les découvre trop tard : l'allocation des identifiants **par l'opération** (sinon deux
vins avec la même `ref` après un conflit), la **matrice des préconditions rompues**, l'encodage **base64
UTF-8** (`btoa` seul lève une exception sur « Côte Rôtie »), et le fait que **la lecture passe par l'API,
pas par Pages**.

**Terminé quand.**
- On ouvre l'app sur un téléphone, on colle un token, on voit la cave graine.
- Une opération de test produit un **commit visible** sur GitHub.
- **`tests/ops.test.mjs` passe** : conflit 409 simulé (deux opérations concurrentes sur des états
  différents) → l'app détecte le 409, recharge, réapplique, et **les deux modifications survivent**, avec
  **deux `ref` distinctes**. *C'est le seul test qui compte dans ce lot, et il doit être automatique.*
- Sans token : l'app affiche les données en lecture seule, les boutons de mutation sont désactivés avec un
  message. **Pas d'écran d'erreur.**
- `node scripts/validate-data.mjs` passe.

**Interdit.** Toucher au plan, aux vins, aux accords. Ce lot ne fait rien de visible, et c'est normal.

---

## L1-CH · L1-FR · L1-IT — Base de connaissances *(contenu pur, aucun code)*

**Trois lots séparés, dans cet ordre, avec une relecture humaine entre chaque.**
La Suisse d'abord : c'est le référentiel que le commanditaire sait juger, et sa qualité dit si la méthode
tient. **Si L1-CH sort truffé d'erreurs, on ne lance pas L1-FR — on corrige la méthode.**

**Objectif.** Produire `kb/cepages.json` et `kb/regions.json`.
`kb/garde.json` et `kb/accords.json` sont **fournis complets** : ne pas les regénérer, seulement les
calibrer si un cas les met en défaut.

**Méthode imposée — la lire avant de commencer.**

> Générer 350 appellations et 150 cépages d'un seul trait produit un fichier qui *paraît* bon et qui
> contient des approximations invisibles, noyées dans le volume. C'est le mode d'échec de ce lot, et c'est
> pour ça qu'il est découpé en trois.

1. Partir de `kb/cepages.seed.json` et `kb/regions.seed.json` : entrées déjà validées.
   **Ne pas modifier ces entrées — ce sont les étalons**, et ils ont été corrigés pour ne plus contenir
   d'exception (chaque appellation à deux couleurs y est déjà scindée en deux entrées).
2. Avancer **région par région. Une région = un commit.** Jamais plus.
3. Après **chaque** région : `node scripts/validate-kb.mjs`. Une région qui ne valide pas ne se commite pas.
4. **Les cépages d'abord, les appellations ensuite** : une appellation ne peut référencer qu'un cépage
   existant.

**Périmètre.** PRD §5.1, pays par pays. S'y tenir.

**Points de vigilance.**
- **Les synonymes ne sont pas décoratifs.** Savagnin = Heida = Païen. Marsanne = Ermitage. Grenache =
  Cannonau. Nebbiolo = Spanna. Müller-Thurgau = Riesling-Sylvaner. Sans eux, la saisie par photo d'étiquette
  échoue sur la moitié des bouteilles suisses et italiennes. **Un cépage = un seul id**, jamais un doublon
  par pays.
- **Le `profil` décide des accords** quand rien d'autre ne le fait. Ce ne sont pas cinq nombres à remplir :
  un Chasselas est à `aromatique: 1` et c'est *pour ça* qu'il va sur la fondue. **Ne pas gonfler.**
- **`tierGarde` se décide appellation par appellation, jamais par région.** Barolo et Barbera d'Asti sont
  voisins et n'ont rien à voir.
- **`accords` d'une appellation : laisser vide plutôt qu'inventer.** Le cépage prendra le relais. C'est la
  source la plus lourde du barème ; un accord inventé à ce niveau pollue tout le classement.
- **Une appellation à deux couleurs → deux entrées**, avec le **même `nom`** et des `couleurs` disjointes.
  Jamais une moyenne. La résolution se fait sur (nom, couleur). Voir les entrées `fr-crozes-hermitage-rouge`
  / `-blanc` du seed : **c'est la forme à reproduire.**

**Terminé quand.**
- `node scripts/validate-kb.mjs` passe : tout cépage cité existe, tout cépage a un `tierGarde`, tout id de
  plat existe dans `kb/accords.json`.
- **Relecture humaine par le commanditaire.** Pour L1-CH : le Valais et Vaud, ligne à ligne. Pour L1-FR : le
  Rhône. Pour L1-IT : le Piémont. **Un lot pays ne se clôt pas sans cette relecture, et le lot suivant ne
  démarre pas avant.**

---

## L2 — Plan et bouteilles *(priorité n°1 du commanditaire)*

**Objectif.** L'écran d'accueil, et le geste central : trouver une bouteille, la boire.

**Référence : PRD §6.1** (exigences) et **`prototype-plan-cave.html`, variantes A et C** (rendu et gestes).
Elles ont été testées sur téléphone dans la cave. **Ne pas réinventer.**

Dans le prototype, sont **normatifs** : les dimensions, les états visuels du casier — occupé, libre,
magnum, résultat de recherche, estompé ; le sixième, **désactivé (hachuré)**, n'y figure pas et est
spécifié par le texte du PRD §6.1 uniquement —, le geste tap → feuille, la bascule Plan ↔ Adresse et la
persistance de la recherche. **Le CSS et la structure DOM sont indicatifs** : le prototype n'est pas du code
de production, ne pas le copier tel quel.

**À créer.** `app/views/plan.js`, `app/views/zones.js` (éditeur de zones dans Réglages), recherche partagée.

**Deux pièges.**
- **Le curseur descend à 24 px, pas à 14.** Pas de pinch-zoom, pas de pan.
- **Ne pas implémenter la vue « bandes par rangée ».** Elle a été testée et écartée. Si elle réapparaît,
  c'est une régression.

**Éditeur de zones** : créer, renommer, dimensionner, désactiver des casiers, réordonner.
**Invariant 5** : refuser toute réduction qui supprimerait des casiers occupés, avec la liste des bouteilles
concernées.

**Dimension réelle.** La cave fait **84 casiers** (une zone, 7 × 12). `scripts/make-fixture.mjs` génère un
jeu de charge de **170 casiers** (la cave réelle plus le second meuble envisagé, en deux zones) :
**concevoir pour 84, vérifier que le scroll et le curseur restent fluides à 170** sur téléphone.
Un nœud DOM par casier suffit — pas de canvas, pas de virtualisation.

**Terminé quand.** Sur téléphone, dans la cave : chercher un vin, lire son emplacement, aller le chercher,
le boire, et voir le casier se libérer — **sans jamais pincer l'écran**.

---

## L3 — Vins, fiche, garde

**À créer.** `app/kb.js`, `app/garde.js`, `app/views/vins.js`, `app/views/fiche.js`,
`app/views/a-boire.js`, `tests/garde.test.mjs`.

**`garde.js` implémente `docs/SPEC_MOTEURS.md §1`, et rien d'autre.** Toutes les valeurs vivent dans
`kb/garde.json`. **Aucun tier, aucun seuil, aucun facteur en dur dans le code.**

**Exigences.**
- **Deux fonctions, pas une** : `calculerGardeVin` (fenêtre canonique, format standard — **la seule
  persistée**) et `gardeEffective` (fenêtre de *cette* bouteille : applique le format, et le cas du vin non
  millésimé — **jamais persistée**). Sans cette séparation, le modèle ne peut pas représenter un vin qui a
  deux bouteilles standard et un magnum.
- **`app/kb.js`** : chargement et **résolution** (appellation, cépage, synonymes, normalisation). Les
  moteurs lisent `appellationId` et `cepageIds`, **jamais** le texte libre. Si la résolution échoue :
  **avertir, mais accepter**.
- **Toute estimation automatique produit `gardeExplication`**, une phrase affichée à l'utilisateur.
  Une garde non expliquée n'est pas exploitable — c'est ce qui manque à l'Excel.
- **Invariant 4** : `gardeSource: "manuel"` n'est jamais écrasé, y compris par un recalcul global.
- Fiche vin : frise `gardeDe → apogée → gardeA` avec curseur « aujourd'hui », emplacement de chaque
  bouteille (cliquable → plan), **fenêtre effective de la bouteille si elle diffère de la canonique**,
  provenance, dégustations passées, édition en place.
- Formulaire d'ajout : pays → région → appellation → cépages **pré-remplis depuis le KB** → garde et accords
  calculés. Acquisition par défaut appliquée aux N bouteilles, éditable ensuite bouteille par bouteille.

**Terminé quand.** **Les 9 vecteurs G1–G9 de `SPEC_MOTEURS.md §3` passent.** Un vin saisi sans aucune
information de garde affiche une fenêtre estimée **et sa justification**. Un vin dont la garde a été
corrigée à la main résiste à un recalcul global.

---

## L4 — Accords

**À créer.** `app/accords.js`, `app/views/accords.js`, `tests/accords.test.mjs`.

**`accords.js` implémente `docs/SPEC_MOTEURS.md §2`, et rien d'autre.** Le barème, les seuils, les règles de
profil, les anti-règles et le profil par défaut vivent tous dans `kb/accords.json`.
**Ne recopier aucun chiffre — ni ici, ni dans le code.** Un barème écrit deux fois divergera.

**Exigences.**
- **Les anti-règles ramènent le score à 0** et excluent le vin **même du repli**. Elles ne sont pas
  optionnelles : sans elles, l'arithmétique finira par proposer un Nebbiolo sur une raclette. *Un mauvais
  accord suggéré avec aplomb détruit la confiance dans l'outil plus sûrement qu'un accord manquant.*
- **Le profil par défaut par couleur n'est pas cosmétique.** Sans lui, un vin hors KB a `tanin: undefined`,
  l'anti-règle raclette ne se déclenche pas, et le tannat arrive sur la raclette.
- **Le repli** : si aucun vin n'atteint le seuil, l'écran ne reste pas vide — il propose les meilleurs
  candidats, étiquetés « Aucun accord établi — suggestions d'après le profil des vins ».
- Écran **mets → vin** : grille de plats, un tap, résultat = les vins **en cave**, triés, avec
  **l'emplacement**, le statut de garde, la température, le carafage, et **la raison** de la suggestion.
- Fiche vin : le sens inverse (vin → mets).

**Terminé quand.**
- **Les 8 vecteurs A1–A8 de `SPEC_MOTEURS.md §4` passent**, dont **A2** (Barolo exclu de la raclette par
  l'anti-règle) et **A6** (rouge inconnu exclu de la raclette par le profil par défaut).
- « Raclette » propose des blancs vifs et **aucun rouge tannique**.
- « Côte de bœuf » propose des rouges structurés, à l'apogée d'abord.
- **Chaque suggestion affiche l'emplacement de la bouteille.** Une suggestion sans emplacement est inutile :
  on ne va pas fouiller la cave.

---

## L5 — Dégustations, stats, PWA, diagnostic

**Exigences.**
- Historique des dégustations : liste, recherche, filtre par vin / année / note, édition a posteriori.
- Stats : bouteilles par région / pays / couleur / millésime / apogée ; consommation et achats par mois.
  Quatre graphiques SVG, sans bibliothèque (PRD §6.7). **Pas de camembert : illisible à 380 px.**
- **Deux agrégats distincts, jamais confondus** : `montant dépensé` = Σ `acquisition.prix` (les cadeaux
  valent `null`, donc 0) ; `valeur de la cave` = Σ `wine.valeur` des bouteilles en stock (les cadeaux
  comptent). **Les afficher séparément. C'est une des raisons d'être de ce projet.**
- Stats de provenance : achat / cadeau / héritage ; « offert par X » ; « ce qui reste de la cave de Papa ».
- **Export `data.json`.** *(Pas de CSV — retiré du périmètre.)*
- **Écran Diagnostic** dans Réglages : `sha` courant, `updatedAt` / `updatedBy`, les 20 dernières
  opérations, état du token, état du service worker.
- PWA : service worker, app shell et `kb/` en cache, `data.json` en `network-first`.
  **Consultation hors-ligne, mutations refusées** avec un message clair — pas de file d'attente offline
  (source de conflits, bénéfice faible).

**Retiré du périmètre : l'import Excel, l'export CSV, le thème sombre.** Le fichier `Ma_Cave.xlsm` contient
des données fictives ; la cave réelle (84 casiers) est saisie à la main. **Ne pas intégrer SheetJS, ne pas
écrire d'écran de rapprochement.** *Si ces lignes réapparaissent dans une future version d'un document,
c'est une erreur.*

---

## L6 — Claude Code

**À créer.**
```
scripts/query.mjs         importe garde.js et accords.js — ne réimplémente RIEN
tests/query.test.mjs      test d'alignement
.claude/skills/cave-context/SKILL.md
.claude/skills/choisir-un-vin/SKILL.md
.claude/skills/etat-de-la-cave/SKILL.md
.claude/skills/ajouter-depuis-etiquette/SKILL.md
.claude/skills/enregistrer-degustation/SKILL.md
```

**La règle qui gouverne ce lot.** Un `SKILL.md` dit **quand** agir et **quoi appeler**. Il ne contient
**aucune règle métier**. Le scoring vit dans `accords.js`, la garde dans `garde.js`, et `query.mjs` les
importe. **Si un skill explique en prose comment noter un accord, le lot est raté** : l'app et Claude Code
donneront un jour deux réponses différentes, et l'utilisateur ne saura plus laquelle croire.

**Le champ `description` du frontmatter est le déclencheur**, pas de la documentation. Il doit contenir les
mots que l'utilisateur emploiera vraiment : « quel vin pour », « qu'est-ce qu'on ouvre », « côte de bœuf »,
« j'ai bu ».

Comportement détaillé des cinq skills : **PRD §8.3.**

**Terminé quand.**
- **`tests/query.test.mjs` passe** : `node scripts/query.mjs --accord viandes_rouges_grillees --en-stock
  --json` produit **exactement** le même tableau `[{ wineId, score, drapeaux }]` que `accords.js` appelé
  directement sur la même fixture. **Toute divergence fait échouer le test.** C'est la seule preuve
  mécanique que l'app et Claude Code ne donneront jamais deux réponses différentes.
- La question de référence (« un rouge pour une côte de bœuf ») retourne 3 vins réellement en cave, avec
  leur casier, et **le même classement que l'écran Accords de l'app**.
