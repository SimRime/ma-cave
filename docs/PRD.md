# PRD — « Ma Cave » : gestion de cave à vin, web app statique

**Version 2.0** · 13 juillet 2026 · **Statut : arbitré, prêt pour développement**

> **Ce que ce document fait, et ne fait pas.**
> Il dit **pourquoi** le projet existe, **pour qui**, **quoi** livrer et dans **quel ordre**.
> Il ne redéfinit **ni le modèle de données** (`schema/data.schema.json` fait foi), **ni les barèmes de
> calcul** (`docs/SPEC_MOTEURS.md` + `kb/garde.json` + `kb/accords.json` font foi). Une règle écrite deux
> fois divergera : la v1.5 de ce PRD en contenait onze, dont deux qui rendaient les moteurs inexploitables.
> Les arbitrages et leur justification sont dans `docs/DECISIONS.md`.

---

## 1. Contexte et objectif

### 1.1 Existant

Un classeur Excel macro (`Ma_Cave.xlsm`) sert aujourd'hui de référentiel. **Le fichier fourni contient des
données fictives (519 vins, 594 casiers), pas la cave réelle.** Il vaut comme modèle de structure et comme
jeu de test à forte charge — **pas** comme source de données à migrer.

**La cave réelle : 84 casiers** (un meuble unique, 7 rangées × 12 colonnes), avec l'ajout probable d'un
second meuble à l'avenir. Tout dimensionnement technique se cale sur cet ordre de grandeur.

Limites de l'Excel, qui définissent le projet :

- Non consultable depuis un téléphone. Non partageable à deux.
- Le lien « quantité restante » ↔ « plan de cave » est maintenu par une macro de vérification →
  **incohérences possibles**. C'est le défaut central, et il est structurel.
- La colonne **Mets** est renseignée pour 26 vins sur 519 : l'information manque en pratique.
- Les fenêtres de garde sont saisies à la main et absentes pour ~200 vins.
- Référentiel franco-français.

### 1.2 Objectif

Une **web app statique, installable sur téléphone (PWA)**, hébergée sur GitHub Pages, permettant à
**2 utilisateurs** de consulter et modifier une cave commune : savoir où est chaque bouteille, quand la
boire, et avec quoi la servir — sur la France, la Suisse et l'Italie.

### 1.3 Critères de succès *(mesurables, protocole de recette au §9)*

1. **Trouver la position physique d'une bouteille en moins de 10 s**, depuis le téléphone.
   *Recette : 5 recherches chronométrées, dans la cave, app fermée au départ, nom du vin donné à l'oral.
   Médiane < 10 s.*
2. **Enregistrer une bouteille bue en 2 tapes** (casier → *Boire*), plan et stock mis à jour.
   La feuille de dégustation qui suit est optionnelle et se passe d'un tap.
3. **Zéro incohérence structurelle possible** entre stock et plan (§3.2 — le stock est dérivé).
4. **Un vin saisi sans information de garde ni d'accord obtient une proposition exploitable —
   et sa justification.** Une estimation non expliquée n'est pas exploitable : c'est précisément ce qui
   manque à l'Excel.
5. Coût d'exploitation : **0 €/mois**.

---

## 2. Utilisateurs et usages

**2 utilisateurs**, confiance mutuelle totale. Pas de rôles, pas de permissions. Accès en écriture complet
pour chacun.

Parcours, par ordre de priorité :

1. **Trouver une bouteille / consulter le plan visuel** ← priorité n°1
2. **Savoir quoi boire** (fenêtre de garde, apogée, urgences)
3. **Accord mets-vin** (« on mange une raclette, qu'est-ce qu'on ouvre ? »)
4. **Statistiques et valeur de la cave**
5. **Historique de dégustation et notes**

Contexte d'usage dominant : **debout, dans la cave, sur téléphone, une main.** L'ergonomie mobile prime.
La saisie lourde (ajout d'un vin, édition des zones) peut être optimisée pour desktop.

---

## 3. Architecture

### 3.1 Décision

**Site statique + `data.json` versionné dans le dépôt GitHub. Pas de backend, pas de base de données.**

```
┌──────────────────────────┐
│  Téléphone / navigateur  │
│  index.html (PWA)        │
└───────┬──────────────────┘
        │ LECTURE et ÉCRITURE : API GitHub, une seule source de vérité
        │   GET  api.github.com/repos/<user>/ma-cave/contents/data.json
        │   PUT  api.github.com/repos/<user>/ma-cave/contents/data.json
        │        Authorization: Bearer <PAT en localStorage>   (écriture)
        ▼
┌──────────────────────────┐
│  Dépôt GitHub PUBLIC     │
│  index.html, app/*, kb/* │
│  data.json  ← la « base »│
└──────────────────────────┘
```

**La lecture ne passe PAS par la copie servie par GitHub Pages.** Celle-ci est en retard de 20 s à
plusieurs minutes après un commit (build + CDN) : on boirait une bouteille et on la reverrait à l'écran.
L'écriture, elle, est immédiatement cohérente. **Une seule source de vérité.** La copie Pages ne sert qu'au
cache hors-ligne du service worker. Détail : `CLAUDE.md`, § « Écriture ».

*Sans token, l'API `contents` est limitée à 60 requêtes/heure par IP — largement suffisant à deux.
Sur `403` + `x-ratelimit-remaining: 0`, servir le cache et le dire (§7.3).*

### 3.2 Justification (et alternatives écartées)

| Option | Verdict |
|---|---|
| **JSON dans GitHub** ✅ **retenu** | Gratuit à vie, jamais en pause, historique Git = sauvegarde et restauration gratuites, zéro infrastructure. Coût : pas de temps réel, gestion de conflit à implémenter (tenable à 2 utilisateurs). |
| Supabase | Le tier gratuit **met les projets en pause après 7 jours d'inactivité** et n'a aucune rétention de sauvegarde. Une cave consultée une fois par semaine est exactement le profil à risque. |
| Google Sheets + Apps Script | Fonctionne, mais API lente, quotas, et on reste prisonnier d'un tableur — c'est ce qu'on quitte. |
| localStorage seul | Pas de synchro entre les 2 utilisateurs. Éliminatoire. |

### 3.3 Modèle d'écriture et gestion des conflits

L'app ne fait **jamais** de « write blind ». **Chaque mutation est une opération atomique et rejouable**
(`DRINK_BOTTLE(bottleId)`, `MOVE_BOTTLE(bottleId, slot)`, `ADD_WINE(payload)`…), jamais un remplacement
d'état.

Le cycle complet, l'allocation des identifiants, la matrice des préconditions rompues et l'encodage base64
sont spécifiés dans **`CLAUDE.md`, § « Écriture »** — et nulle part ailleurs.

**Cache optimiste** : l'UI applique le changement immédiatement, affiche un indicateur de synchro, et
effectue un rollback visuel en cas d'échec définitif. Les écritures sont **sérialisées** (une seule requête
en vol).

### 3.4 Authentification

- Aucune authentification pour la **lecture**.
- **Écriture** : chaque utilisateur génère un **fine-grained Personal Access Token** GitHub, limité à ce
  seul dépôt, permission `Contents: Read and write`, expiration 1 an. Collé une fois dans Réglages, stocké
  en `localStorage`, jamais commité, jamais envoyé ailleurs qu'à `api.github.com`.
- Sans token : **mode lecture seule**. Les boutons de mutation sont désactivés avec le message
  « Ajoutez votre token GitHub dans Réglages pour modifier la cave ». **Pas d'écran d'erreur.**

### 3.5 Conséquence du dépôt public (acceptée)

`data.json` est **lisible publiquement** : prix d'achat, valeurs estimées, lieux d'achat. Aucune
obfuscation (elle donnerait une fausse impression de sécurité). Le token reste le seul verrou en écriture.

> **Réversibilité** : si ce point devenait gênant → dépôt **privé** + **Cloudflare Pages** (gratuit,
> déploie depuis un dépôt privé). La lecture passerait aussi par l'API authentifiée. Aucun changement du
> modèle de données. D'où : **tous les accès réseau dans le seul `app/github.js`.**

### 3.6 Stack technique imposée

- **Aucune étape de build.** HTML + CSS + JS ES modules servis tels quels. Un `git push` = un déploiement.
- **Aucune dépendance dans le navigateur.** Pas de CDN, pas de framework, pas une bibliothèque.
  Les scripts Node (`scripts/`, `tests/`) peuvent avoir des `devDependencies` (`ajv`) : elles ne sont
  jamais servies.
- **PWA** : `manifest.json` + service worker (cache de l'app shell et de `kb/` ; `data.json` en
  `network-first`).
- Cible : iOS Safari et Chrome Android récents.

### 3.7 Arborescence

Voir `README.md`. Modules clés et leur responsabilité **unique** : `github.js` (réseau), `ops.js`
(opérations + ids), `store.js` (état), `kb.js` (résolution du référentiel), `garde.js`, `accords.js`
(moteurs purs), `format.js` (libellés, `slotKey`), `views/*` (UI).

---

## 4. Modèle de données

> **`schema/data.schema.json` fait foi.** Les sections ci-dessous expliquent **pourquoi** le modèle est
> ainsi ; elles ne redéfinissent aucun champ. La v1.5 de ce PRD recopiait le modèle en JSON, et les deux
> versions avaient divergé (un champ `ajouteLe` que le schéma interdit, un `gardeExplication` absent, un
> id de plat inexistant).

### 4.1 La bouteille est un objet de premier rang

L'Excel modélise un vin avec une colonne `Reste` (un compteur) **et** des cases du plan contenant la
référence. Les deux peuvent diverger — d'où la macro « VERIFICATION ».

Ici : **`Reste` n'existe pas.** Le stock d'un vin est *dérivé* :
`bottles.filter(b => b.wineId === w.id).length`. Boire une bouteille = **supprimer un objet `bottle`**.
Le casier se libère mécaniquement. **L'incohérence devient structurellement impossible.**

Corollaire : une bouteille peut avoir `slot: null` (achetée, pas encore rangée). Le Plan affiche un
bandeau « 3 bouteilles à ranger » avec un raccourci de placement.

### 4.2 La provenance est une propriété de la bouteille, pas du vin

On peut acheter 3 bouteilles d'un Cornalin chez un caviste et s'en faire offrir une 4ᵉ. L'objet
`acquisition` est donc porté par la **bouteille**.

| Type | `source` signifie | `prix` |
|---|---|---|
| `achat` | caviste, domaine, salon… | montant payé |
| `cadeau` | **la personne qui l'a offerte** | `null` |
| `heritage` | d'où elle vient (« Cave de Papa ») | `null` |
| `echange` | avec qui | `null` |
| `production` | producteur / ami vigneron | `null` ou coût |

Exigences associées :

- **Saisie sans friction** : à l'ajout d'un vin, une acquisition **par défaut** est appliquée aux N
  bouteilles créées, puis éditable bouteille par bouteille (« celle-ci, c'est Marc qui me l'a offerte »).
  Ne jamais forcer la saisie N fois.
- **Autocomplétion** de `source` et `occasion` depuis les valeurs déjà présentes dans `data.json` (liste
  dérivée, jamais stockée).
- **Affichage au moment de boire** : « Offerte par Marc Dupraz — anniversaire 40 ans ». C'est
  l'information qu'on veut sous les yeux à ce moment-là, et c'est exactement ce que l'Excel perd.
- **Filtres et stats par provenance** : « offertes par X », « ce qui reste de la cave de Papa ».
- **Distinction comptable stricte, et c'est une des raisons d'être du projet** :
  `montant dépensé` = Σ `acquisition.prix` (les cadeaux valent `null`, donc 0)
  ≠ `valeur de la cave` = Σ `wine.valeur` des bouteilles **en stock** (les cadeaux comptent).
  Les deux chiffres apparaissent **séparément** dans Stats.

### 4.3 Texte d'affichage vs identifiant

`wine.appellation` et `wine.cepages` contiennent **ce qui est écrit sur l'étiquette** (« Barolo DOCG »,
« Heida »). `wine.appellationId` et `wine.cepageIds` contiennent les **identifiants résolus du KB**
(`it-barolo`, `savagnin`).

**Les moteurs ne lisent QUE les identifiants.** Sans cette séparation, la cascade de garde repose sur une
comparaison de chaînes libres : « Barolo DOCG » ne correspondrait pas à « Barolo », la garde retomberait
silencieusement sur le cépage, et personne ne verrait jamais l'erreur.

La résolution vit dans `app/kb.js` (normalisation NFD, sans accents, minuscules, mentions
`AOC|AOP|AC|DOC|DOCG|IGP|DOP` retirées). **Aucune correspondance approximative.** Si elle échoue,
**l'app avertit mais accepte** : bandeau « Appellation inconnue du référentiel — la garde et les accords
seront estimés depuis le cépage ».

Deux appellations peuvent porter le **même nom** et des couleurs disjointes (Crozes-Hermitage rouge et
blanc ne se gardent pas pareil) : la résolution se fait sur le couple **(nom normalisé, `wine.couleur`)**.

### 4.4 Invariants

**Les six invariants sont listés dans `CLAUDE.md`.** Ils y sont numérotés, et c'est cette numérotation que
les briefs utilisent. Ne pas les recopier ici : la v1.5 en listait six sans numéros pendant que
`CLAUDE.md` en numérotait cinq, et les briefs renvoyaient à des numéros qui ne pointaient nulle part.

---

## 5. Base de connaissances (`kb/`)

C'est le cœur de la valeur ajoutée par rapport à l'Excel, et le poste de travail le plus important.
**Elle doit être produite avant les écrans qui la consomment.**

`kb/garde.json` et `kb/accords.json` sont **livrés complets** : à calibrer, jamais à regénérer.
`kb/cepages.json` et `kb/regions.json` sont produits par les lots L1-CH, L1-FR, L1-IT.

### 5.1 Couverture géographique — France, Suisse, Italie

Arbre `pays → région → appellations[]`. Structure : `schema/kb.regions.schema.json`.

**Suisse** *(lot L1-CH, en premier — c'est le référentiel que le commanditaire sait juger)*
- **Valais** : Fendant, Johannisberg, Dôle, Petite Arvine, Cornalin, Humagne Rouge, Humagne Blanche,
  Amigne de Vétroz, Heida/Païen, Syrah du Valais, Ermitage, Malvoisie
- **Vaud** : Lavaux (Dézaley GC, Calamin GC, Epesses, Saint-Saphorin, Villette), Chablais (Yvorne, Aigle),
  La Côte, Bonvillars, Côtes de l'Orbe, Vully, Salvagnin
- **Genève** : Satigny, Peissy, Dardagny
- **Neuchâtel / Trois-Lacs** : Neuchâtel AOC, Œil-de-Perdrix, Bonvillars, Vully
- **Tessin** : Merlot del Ticino, Ticino DOC, Bianco di Merlot
- **Grisons** : Bündner Herrschaft (Malans, Fläsch, Jenins, Maienfeld), Completer
- **Suisse alémanique** : Zurich, Schaffhouse, Argovie, Bâle · **Fribourg** : Vully fribourgeois, Cheyres

Cépages : Chasselas, Petite Arvine, Amigne, Humagne Blanche, Heida/Savagnin, Completer, Räuschling,
Müller-Thurgau, Pinot Noir, Gamay, Gamaret, Garanoir, Diolinoir, Cornalin, Humagne Rouge, Merlot, Syrah,
Mondeuse.

**France** *(lot L1-FR)* — les 15 régions de l'onglet *Appellations* de l'Excel : Alsace, Beaujolais,
Bordeaux, Bourgogne, Champagne, Jura, Languedoc-Roussillon, Lorraine, Loire, Provence-Corse, Rhône,
Savoie-Bugey, Sud-Ouest, Cognac, Porto — et compléter.

**Italie** *(lot L1-IT)* — Piémont, Toscane, Vénétie, Lombardie, Trentin-Haut-Adige, Frioul,
Émilie-Romagne, Marches, Ombrie, Abruzzes, Campanie, Pouilles, Sicile, Sardaigne. Principales DOCG/DOC de
chacune (liste détaillée dans le brief L1-IT).

**Un pays « Autre » (`XX`) reste possible**, en saisie libre. Le KB ne le couvre pas, mais l'app ne le
rejette pas : garde et accords retombent sur `defautParCouleur` et `profilDefautParCouleur`.

### 5.2 Moteurs de garde et d'accords

> **`docs/SPEC_MOTEURS.md` fait foi**, et les valeurs vivent dans `kb/garde.json` et `kb/accords.json`.
> Aucun barème n'est recopié ici : la v1.5 en contenait une version déjà périmée.

Ce qu'il faut savoir au niveau produit :

- **La garde est une cascade** : appellation → cépage dominant → couleur. Modificateurs : prix, format,
  vin non millésimé. **Toute estimation automatique produit sa justification**, affichée à l'utilisateur
  (« appellation Barolo (grande garde) + millésime 2019 »). Une garde non expliquée n'est pas exploitable.
- **La garde d'un vin et celle d'une bouteille sont deux choses.** Un magnum tient plus longtemps ; un
  champagne non millésimé se compte depuis son achat. La fenêtre **canonique** (format standard) est
  stockée sur le vin ; la fenêtre **effective** de chaque bouteille est calculée à l'affichage et
  **jamais persistée**.
- **Les accords sont un score sur 100** : appellation (source la plus forte) → cépage → profil structurel
  (filet de sécurité). **Les anti-règles ramènent le score à zéro** et ne sont pas optionnelles : sans
  elles, l'arithmétique proposera un jour un Nebbiolo sur une raclette. *Un mauvais accord suggéré avec
  aplomb détruit la confiance dans l'outil bien plus sûrement qu'un accord manquant.*
- **Si aucun vin n'atteint le seuil, l'écran ne reste pas vide** : il propose les meilleurs candidats,
  honnêtement étiquetés « suggestions d'après le profil des vins ».
- `gardeSource: "manuel"` et `metsSource: "manuel"` protègent une saisie utilisateur (invariant 4).

---

## 6. Écrans et fonctionnalités

Navigation : barre d'onglets inférieure, 5 entrées : **Plan · Vins · À boire · Accords · Plus**
(→ Dégustations, Stats, Réglages).

### 6.1 Plan (écran d'accueil) — priorité 1

Deux surfaces, tranchées par le prototype L-1 testé sur téléphone dans la cave : **Plan (grille)**, vue par
défaut, et **Adresse**, accessible par une bascule permanente. La variante « bandes par rangée » a été
testée et **écartée** — si elle réapparaît, c'est une régression.

- Sélecteur de zone (onglets horizontaux si plusieurs zones).
- **Un casier = un disque** (le cul de la bouteille vu de face, ce que l'œil voit dans un rack).
  Couleur = couleur du vin. Casier libre = contour pointillé. Casier désactivé = hachuré. **Repère distinct
  pour le magnum.** **La couleur ne porte jamais seule l'information** : libellé au tap et `aria-label`.
- **Curseur de taille des casiers, 24 → 46 px**, mémorisé en `localStorage` (préférence locale : elle n'a
  rien à faire dans `data.json`). **Pas de pinch-zoom, pas de pan.** À 46 px, les 84 casiers réels (7 × 12)
  tiennent dans un écran de téléphone sans aucun zoom : **le curseur est un agrément**, pas une exigence
  critique. Il existe pour le jour où un second meuble plus large apparaîtra.
- **Recherche** partagée entre Plan et Adresse, **qui survit à la bascule**. Sur le plan : les casiers
  correspondants sont **cerclés**, les autres **s'estompent fortement**. Le repère reste lisible **au plus
  petit réglage (24 px)**.
  *Comportement : normalisation NFD sans accents, minuscules, sous-chaîne, sur producteur + cuvée +
  appellation + région + sous-région + millésime + noms des cépages résolus. Aucun fuzzy matching.*
- **Tap sur un casier** → feuille inférieure : vin, millésime, appellation, statut de garde, provenance si
  c'est un cadeau, et **Boire · Déplacer · Fiche**.
- **Boire = 2 tapes** (casier → *Boire*). La bouteille est **supprimée**. Une feuille de dégustation
  **optionnelle** suit (date pré-remplie, note /20, avec qui) : on la valide ou on la passe d'un tap.
- Bandeau « **N bouteilles à ranger** » (`slot: null`) avec raccourci de placement.
- Compteur de places libres par zone. Filtre rapide par couleur et par statut de garde.

**Vue Adresse** : pour chaque vin trouvé — producteur, cuvée, millésime, appellation, statut de garde,
**emplacement en gros caractères** (« Ma cave · C4 »), les emplacements des autres bouteilles du même vin,
et une mini-carte de la zone situant la case.

**Référence normative** : `prototype-plan-cave.html`, variantes A et C. Sont normatifs **les dimensions,
les états visuels du casier, le geste tap → feuille, la bascule et la persistance de la recherche**.
Le prototype montre cinq des six états ; le sixième, **désactivé (hachuré)**, est spécifié par le texte
ci-dessus uniquement. Le CSS et la structure DOM sont **indicatifs** : le prototype n'est pas du code de
production.

### 6.2 Vins (catalogue)

Liste et recherche sur tous les champs. Filtres combinables : pays, région, appellation, couleur, cépage,
millésime, statut de garde, en stock / archivé. Tri : apogée, millésime, prix, producteur, quantité.
Vue par défaut : **en stock uniquement**.

### 6.3 Fiche vin

- Identité (producteur, cuvée, millésime, pays/région/appellation, cépages).
- **Frise de garde** `gardeDe → apogée → gardeA` avec curseur « aujourd'hui », **et la phrase
  d'explication** de l'estimation. Boutons « recalculer » et « corriger à la main ».
- **Accords mets** (chips), température de service, carafage, verre.
- **Bouteilles** : chacune avec son emplacement exact (cliquable → va au plan), son format, **sa fenêtre de
  garde effective** si elle diffère (magnum, vin non millésimé), sa provenance, et Boire / Déplacer.
- Historique des dégustations de ce vin. Commentaire libre. Édition en place.

### 6.4 À boire

Trois sections, fondées sur les **drapeaux** de garde (un vin peut porter plusieurs drapeaux, ils sont tous
affichés — « à l'apogée, et la fenêtre se ferme ») :
**À boire vite** · **À l'apogée** · **Encore trop jeune** (repliée par défaut).
Chaque ligne montre la position de la bouteille. Filtre par couleur.

### 6.5 Accords (mets → vin) — la fonctionnalité phare

- Grille de plats tactile (`kb/accords.json > plats`). Un tap.
- Résultat : les vins **en cave**, triés par score, chacun avec **son emplacement**, son statut de garde,
  la température, le carafage, et **la raison** de la suggestion (« Cépage Chasselas : fondue »).
  **Une suggestion sans emplacement est inutile : on ne va pas fouiller la cave.**
- Si aucun vin n'atteint le seuil : les 5 meilleurs candidats, sous l'intitulé « Aucun accord établi —
  suggestions d'après le profil des vins ».
- Filtre : couleur, « uniquement ceux qui sont dans leur fenêtre ».
- Sens inverse (vin → mets) sur la fiche vin.

### 6.6 Dégustations

Historique complet, recherche, filtre par vin / année / note. Édition d'une note a posteriori.

### 6.7 Stats

- Bouteilles par région / pays / couleur / millésime / année d'apogée.
- **`montant dépensé`** et **`valeur de la cave`**, affichés **séparément** (§4.2).
- Consommation et achats par mois / année.
- Provenance : achat / cadeau / héritage ; « offert par X » ; « ce qui reste de la cave de Papa ».
- Quatre graphiques, en SVG, sans bibliothèque : bouteilles par région (barres horizontales), par millésime
  (histogramme), consommation sur 24 mois (barres), répartition par couleur (barres empilées — **pas de
  camembert : illisible à 380 px**).

### 6.8 Réglages

- **Token GitHub** (lien vers la page de création, permissions expliquées) + test de connexion.
- **Nom de l'utilisateur** (pour `updatedBy` et `par`).
- **Éditeur de zones** : créer, renommer, dimensionner, désactiver des casiers pour dessiner une cave non
  rectangulaire, réordonner. Respect strict des invariants — notamment **l'invariant 5**.
  - **Cave par défaut au premier lancement** : une zone « Ma cave », **7 × 12** (84 casiers), rangées A–G,
    colonnes 1–12. C'est la graine `data.json`. **Ne pas livrer une cave vide** : un plan sans zone n'a rien
    à afficher, et l'écran d'accueil serait un formulaire.
- **Export `data.json`.**
- **Diagnostic** : `sha` courant, `updatedAt` / `updatedBy` du dernier chargement, les 20 dernières
  opérations (type, horodatage, résultat, nombre de retries), état du token, état du service worker.
  Sans lui, une écriture qui échoue chez l'autre utilisateur se débogue à l'aveugle.

---

## 7. Exigences non fonctionnelles

### 7.1 Performance *(mesurable)*
- Chargement à froid, cache vide, 4G simulée : **FCP < 2 s**, grille interactive **< 3 s**.
- Chargement à chaud (service worker) : grille interactive **< 500 ms**.
- Avec la fixture de charge (**170 casiers** — la cave réelle plus le second meuble envisagé) : scroll et
  déplacement du curseur **fluides sur le téléphone cible**. Un nœud DOM par casier suffit — **pas de
  canvas, pas de virtualisation.**

### 7.2 Hors-ligne
Consultation complète en mode avion (service worker + dernier `data.json` en cache).
**Les mutations hors-ligne sont refusées avec un message clair.** Pas de file d'attente offline : source de
conflits complexes, bénéfice faible.

### 7.3 Robustesse — matrice d'erreurs

| Situation | Message | Action |
|---|---|---|
| `401` — token invalide/expiré | « Votre token GitHub n'est plus valide. » | → Réglages |
| `403` + `remaining: 0` | « Limite GitHub atteinte, réessayez dans N min. » | lecture depuis le cache |
| `403` — droits insuffisants | « Ce token n'a pas la permission d'écrire (Contents: Read and write). » | → Réglages |
| `404` | « Dépôt ou fichier introuvable. » | → Réglages |
| `409` / `422` — conflit de `sha` | *(silencieux)* | recharger, rejouer, 3 tentatives, backoff 500 ms |
| `5xx` / réseau | « GitHub est injoignable. » | bouton « Réessayer » |
| `data.json` illisible | « Les données de la cave sont illisibles. » + chemin de l'erreur + lien vers l'historique Git | **aucune écriture** dans cet état |

Jamais d'écran blanc. Jamais d'échec silencieux.

### 7.4 Accessibilité
Cibles d'action **≥ 44 px** ; casiers de la grille **24–46 px** (exception assumée, §6.1). Contrastes
suffisants. **La couleur du vin n'est jamais la seule information.**

### 7.5 i18n
Interface en **français uniquement**.

---

## 8. Interrogation en langage naturel via Claude Code

### 8.1 Principe
Parce que `data.json` et `kb/` vivent **dans le dépôt**, Claude Code — lancé sur un clone local — lit la
cave directement : aucun connecteur, aucune API, aucun export. C'est un bénéfice gratuit de
l'architecture (§3.2).

Les **skills projet** vivent dans `.claude/skills/<nom>/SKILL.md`, versionnés, donc partagés entre les deux
utilisateurs. **Le champ `description` du frontmatter est le déclencheur**, pas de la documentation : il
doit contenir les mots réellement employés (« quel vin pour », « qu'est-ce qu'on ouvre », « côte de bœuf »,
« j'ai bu »).

### 8.2 La règle qui gouverne ce lot
Un `SKILL.md` dit **quand** agir et **quoi appeler**. Il ne contient **aucune règle métier**. Le scoring
vit dans `accords.js`, la garde dans `garde.js`, et `scripts/query.mjs` les importe. **Si un skill explique
en prose comment noter un accord, le lot est raté** : l'app et Claude Code donneront un jour deux réponses
différentes, et l'utilisateur ne saura plus laquelle croire.

### 8.3 Les cinq skills

**`cave-context`** — socle : structure du dépôt, vocabulaire, comment lire `data.json` et `kb/`.

**`choisir-un-vin`** — le skill principal. Cas de référence :
> « J'ai besoin d'un rouge pour une côte de bœuf. Suggère-moi quelque chose en fonction des apogées et des
> accords de ma cave. »

Traduire le plat en ids de la taxonomie → `node scripts/query.mjs --accord viandes_rouges_grillees
--en-stock` → répondre avec, pour chaque vin : **l'emplacement**, la raison de l'accord, l'état de la
garde, la température, le carafage, et la provenance si c'est un cadeau.
**Ne jamais proposer un vin dont il ne reste aucune bouteille. Ne jamais inventer un vin absent de
`data.json`.**

**`etat-de-la-cave`** — inventaire, valeur, provenance, urgences de garde.

**`ajouter-depuis-etiquette`** — lire les photos de `inbox/` (jamais commitées), en extraire producteur,
cuvée, millésime, appellation. **Ce n'est pas de l'OCR** : Claude lit les images nativement, on passe
directement de la photo aux champs structurés.
**Croiser avec `kb/regions.json` — c'est là que se joue la valeur** : les étiquettes françaises ne
mentionnent presque jamais les cépages, mais « Gigondas 2019 » suffit à déduire Grenache/Syrah, le tier de
garde, la fenêtre et les accords. **La photo fournit l'identité, le KB fournit le reste.**
Marquer tout champ incertain. **Le millésime est souvent sur la capsule, pas sur l'étiquette de face : s'il
est illisible, le demander — jamais le deviner.** Un millésime faux fausse toute la fenêtre de garde, donc
tout l'outil. Aucune valeur extraite d'une photo n'est écrite sans validation humaine.

**`enregistrer-degustation`** — **le seul skill qui écrit.** Respecter les invariants : boire = **supprimer
l'objet `bottle`**, jamais décrémenter. Valider contre le schéma. **Toujours demander confirmation avant de
commiter.** Message lisible : `bu: Barolo 2016 (Ma cave C4)`.

### 8.4 Pourquoi pas un chat « sommelier » dans l'app web
Écarté : cela exigerait une clé API côté client, or le dépôt est **public** — la clé serait exposée. Il
faudrait un proxy, donc une infrastructure, donc l'abandon du « zéro backend ». Claude Code offre le même
service sans ce coût.

---

## 9. Lots de développement

Détail : `docs/BRIEFS_LOTS.md`. **Un lot = une session d'agent. Jamais deux lots dans une même session.**

| Lot | Contenu | Livrable vérifiable |
|---|---|---|
| **L-1** | Prototype du plan | ✅ **Fait.** Variantes A (grille + curseur) et C (adresse) retenues ; « bandes » écartée. |
| **L0** | Socle : `store`, `ops`, `github`, Réglages/token, graine | Un conflit 409 simulé : les **deux** modifications survivent. Test automatisé. |
| **L1-CH** | KB Suisse | `validate-kb` passe. **Relecture humaine avant L1-FR.** |
| **L1-FR** | KB France | idem |
| **L1-IT** | KB Italie | idem |
| **L2** | Plan + bouteilles ← **priorité n°1** | Dans la cave : chercher un vin, aller le chercher, le boire, voir le casier se libérer — sans jamais pincer l'écran. |
| **L3** | Vins, fiche, garde | Les **9 vecteurs G1–G9** de `SPEC_MOTEURS.md` passent. Un vin sans garde affiche une estimation **et sa justification**. |
| **L4** | Accords | Les **8 vecteurs A1–A8** passent. « Raclette » propose des blancs vifs et **aucun rouge tannique**. |
| **L5** | Dégustations, stats, export, PWA, diagnostic | « Montant dépensé » et « valeur de la cave » sont distincts et justes malgré les cadeaux. |
| **L6** | Claude Code | La question de référence retourne 3 vins réellement en cave, avec leur casier, et **le même classement que l'écran Accords** (test d'alignement automatisé). |

L1 peut se faire en parallèle de L0 : c'est du contenu pur, aucun code.

---

## 10. Décisions arrêtées

Les arbitrages complets, avec leur justification, sont dans **`docs/DECISIONS.md`**. En résumé :

1. **Notation : sur 20**, demi-points admis, `null` autorisé.
2. **Plan : grille + curseur (24–46 px)**, bascule Adresse. « Bandes par rangée » écartée.
3. **Valeur estimée : purement manuelle.** Défaut = `prixReference`. Aucune API de cotation.
4. **Formats** : `standard` 75 cl · `magnum` 150 cl · `demi` 50 cl · `clavelin` 62 cl (le vin jaune du Jura
   se vend exclusivement en clavelin, et la cave en contient).
5. **Un vin = un millésime.** Deux millésimes du même domaine sont deux entrées `wine` distinctes.
6. **Garde : tous les modificateurs conservés** (prix, format, vin non millésimé) → d'où la distinction
   fenêtre canonique / fenêtre effective.
7. **Accords : seuil, puis repli.** Un écran vide est un échec.
8. **KB : les 3 pays, mais en 3 lots**, avec relecture humaine entre chaque.

---

## 11. Hors périmètre v1

- Application native (iOS/Android).
- Comptes utilisateurs, rôles, permissions.
- **Import Excel** — il n'y a rien à migrer : le fichier fourni contient des données fictives, et la cave
  réelle (84 casiers) se saisit à la main en une soirée. **Ni SheetJS, ni écran de rapprochement, ni
  mapping d'onglets.** *Si cette ligne réapparaît dans une future version, c'est une erreur.*
  Ce qui subsiste de l'Excel : le modèle de structure (absorbé au §4) et un **jeu de test à forte charge**
  (170 casiers — la cave réelle plus le second meuble envisagé), régénéré par
  `scripts/make-fixture.mjs` — pas une donnée de production.
- **Stockage** de photos d'étiquettes dans l'app. Leur **lecture ponctuelle** via `inbox/` pour la saisie
  par Claude Code est en revanche prévue (§8.3).
- Chat « sommelier » intégré à l'app web (§8.4).
- Scan de code-barres, OCR.
- Synchronisation temps réel. Mutations hors-ligne différées.
- Cotation de marché automatique.
- Export CSV, thème sombre, filtre « budget » sur l'écran Accords *(retirés — `DECISIONS.md` D11)*.
- Pays autres que France, Suisse, Italie dans le KB (saisie libre uniquement).
