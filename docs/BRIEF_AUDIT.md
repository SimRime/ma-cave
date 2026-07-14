# Brief — Lot A : audit de cohérence du dossier *(avant tout code)*

**Une session. Aucun code applicatif. Aucune modification de fichier sans validation humaine.**

---

## 1. Contexte — lis ceci avant tout le reste

Tu audites la documentation d'une **petite application personnelle** : deux utilisateurs (un couple), une
cave de **84 casiers**, hébergée gratuitement sur GitHub Pages. Ce n'est **pas** un logiciel industriel, il
n'y a **pas** d'utilisateurs à protéger, **pas** de SLA, **pas** d'équipe qui reprendra le code.

Cette phrase n'est pas un préambule poli : **c'est ton critère de tri principal.** Un problème n'est un
problème que s'il produit, dans *cette* cave, l'un des trois effets suivants :

1. **Une donnée fausse ou perdue** (une bouteille qui disparaît, deux vins avec la même référence, une
   modification de l'autre utilisateur écrasée).
2. **Un calcul faux affiché avec aplomb** (une fenêtre de garde erronée, un accord absurde proposé
   sérieusement).
3. **Un agent de codage qui part dans une direction fausse** parce que deux documents se contredisent.

Tout le reste — élégance, extensibilité, conformité aux bonnes pratiques, couverture de test — **n'est pas
un problème.** Si tu hésites à signaler quelque chose, demande-toi : *« si ça reste comme ça, est-ce que
quelqu'un perd une bouteille, lit un chiffre faux, ou code la mauvaise chose ? »* Si la réponse est non,
tais-toi.

---

## 2. Ce que tu dois lire

```
README.md              ← dit quel document fait foi sur quoi. Commence par là.
CLAUDE.md
docs/PRD.md
docs/SPEC_MOTEURS.md
docs/DECISIONS.md
docs/BRIEFS_LOTS.md
schema/data.schema.json · schema/kb.cepages.schema.json · schema/kb.regions.schema.json
kb/garde.json · kb/accords.json · kb/cepages.seed.json · kb/regions.seed.json
data.json
prototype-plan-cave.html   (survole : structure et variantes, pas le CSS)
```

---

## 3. Ta mission, dans cet ordre

### 3.1 Vérifier les vecteurs de calcul à la main *(le cœur du lot)*

`docs/SPEC_MOTEURS.md` contient **9 vecteurs de garde (G1–G9)** et **8 vecteurs d'accords (A1–A8)** avec
des résultats chiffrés attendus.

**Recalcule chacun d'eux à la main, uniquement à partir de `kb/garde.json` et `kb/accords.json` et de
l'algorithme décrit dans `SPEC_MOTEURS.md`. N'utilise pas les résultats attendus comme point de départ :
calcule, puis compare.**

Pour chaque vecteur, produis la ligne de calcul complète. Exemple de la forme attendue :

> **G3** — cépage `pinot-noir` (tier `garde`), `prixReference: 65`.
> Cascade : `appellationId` null → cépage → tier `garde` (de 4, a 15, apogée 8).
> Prix 65 > seuil 40 → décalage +1 → `grandeGarde` (de 6, a 30, apogée 15).
> Format standard → facteurs 1.0.
> Base = millésime 2019 → **2025 / 2034 / 2049**. ✅ conforme au vecteur.

**Un seul écart, et tu t'arrêtes pour le signaler.** Un écart signifie que la spécification et les barèmes
ont divergé — donc que l'agent de L3 ou L4 codera un moteur faux tout en respectant scrupuleusement sa
consigne. C'est le mode d'échec le plus coûteux du projet, et c'est précisément ce que ces vecteurs
existent pour empêcher.

Vérifie en particulier :
- **G5** (magnum) : l'arrondi et le fait que le facteur ne s'applique **pas** à `de`.
- **G7** (vin non millésimé) : la base est bien la date d'acquisition.
- **A2 et A6** : les deux vins **doivent** être exclus, l'un par le tanin du cépage, l'autre par le profil
  par défaut de sa couleur. Si A6 n'est pas exclu, l'anti-règle de la raclette ne protège rien.
- **A8** : le plafond à 100 est appliqué **avant** le facteur de garde, pas après.

### 3.2 Vérifier mécaniquement, pas à l'œil

```bash
npm install ajv ajv-formats     # devDependencies, jamais servies au navigateur
```

- `data.json` valide contre `schema/data.schema.json` (ajv, draft 2020-12 → `ajv/dist/2020.js`).
- `kb/cepages.seed.json` valide contre son schéma. Idem `kb/regions.seed.json`.
- Tout `cepages[]` cité par une appellation existe dans les cépages.
- Tout id de plat cité par un cépage ou une appellation existe dans `kb/accords.json > plats`.
- Tout `tierGarde` cité existe dans `kb/garde.json > tiers`.
- `wine.appellationId` et `wine.cepageIds[]` de `data.json` existent dans le KB (ou sont `null`/vides).

*Note : deux de ces contrôles ont déjà échoué une fois. Ne présume pas qu'ils passent.*

### 3.3 Chasser les contradictions entre documents

Cherche activement, par recherche textuelle et non de mémoire :

- **Une règle métier, un barème, un seuil ou un facteur recopié hors de son fichier de référence.** C'est
  la faute la plus dangereuse du dossier : un agent obéit au chiffre qu'il a sous les yeux, pas à celui du
  fichier canonique. Le PRD, les briefs et les futurs `SKILL.md` ne doivent contenir **aucun chiffre**.
- **Un champ décrit dans un document mais absent du schéma** (ou l'inverse). Les schémas ont
  `additionalProperties: false` : un champ non déclaré fait échouer la validation.
- **Des invariants numérotés différemment** d'un fichier à l'autre.
- **Une fonctionnalité déclarée hors périmètre à un endroit et exigée à un autre** (l'import Excel a
  survécu dans six endroits dans une version antérieure).
- **Un identifiant qui n'existe pas** (id de plat, id de cépage, id d'appellation, nom de fichier, nom de
  module) cité dans un document.
- **Un terme vague sans définition mesurable** : « fluide », « rapide », « robuste », « lisible »,
  « message clair ». Ne les signale que s'il en découle une décision de code — sinon, ignore.

### 3.4 Chercher le silence

Les manques les plus coûteux ne se voient pas : ce sont les cas dont **aucun document ne parle**, et
qu'un agent tranchera donc tout seul, arbitrairement, sans le dire.

Cherche-les en te posant, pour chaque écran et chaque opération, la question : *« et si la valeur est
`null` ? et si les deux utilisateurs le font en même temps ? et si le vin n'est pas dans le KB ? »*

Signale un manque **uniquement** si son absence conduit à un des trois effets du §1. Un cas limite qui
n'arrivera jamais dans une cave de 84 bouteilles (une zone de 60×60, un vin de 1912, 400 dégustations le
même jour) n'est pas un manque : c'est une distraction.

---

## 4. Ce que tu n'as PAS le droit de proposer

Cette liste n'est pas négociable. Chacun de ces éléments a déjà été examiné et écarté, ou relève de la
sur-conception pour deux utilisateurs.

- ❌ Un framework, un bundler, une étape de build, TypeScript, une dépendance navigateur.
- ❌ Un backend, une base de données, une API, une authentification, des rôles.
- ❌ Une CI/CD, un linter, un formateur, des hooks de commit, un `CONTRIBUTING.md`.
- ❌ Des tests d'intégration, des tests end-to-end, une couverture de test, un framework de test autre que
  `node --test`.
- ❌ De la journalisation structurée, du monitoring, du suivi d'erreurs, de l'analytics.
- ❌ Une file d'attente de mutations hors-ligne, du temps réel, des WebSockets, du CRDT.
- ❌ De l'internationalisation, un thème sombre, un export CSV, un import Excel.
- ❌ Un découpage en davantage de modules « pour la propreté ».
- ❌ Une réécriture de la documentation « pour l'harmoniser ».

**Règle générale :** toute proposition qui ajoute un fichier, une dépendance ou une étape doit être
justifiée par **un scénario de défaillance concret dans une cave de 84 bouteilles gérée par deux
personnes**. Écris ce scénario. Si tu n'y arrives pas, la proposition n'a pas lieu d'être.

Et l'inverse est vrai : **si tu trouves dans le dossier une exigence qui ne sert à rien à cette échelle,
propose de la supprimer.** Retirer du périmètre est un résultat aussi valable qu'en ajouter — plus, même.

---

## 5. Livrable

**Un seul fichier : `docs/AUDIT.md`.** Tu ne modifies aucun autre fichier.

```markdown
# Audit de cohérence — <date>

## 1. Verdict
Une phrase : le dossier est-il prêt pour L0, oui ou non, et si non, à cause de quoi exactement.

## 2. Vérification des vecteurs
Tableau des 17 vecteurs : ✅ conforme / ❌ écart (avec le calcul détaillé et le résultat obtenu).

## 3. Vérification mécanique
Résultat de chaque contrôle du §3.2, avec la commande exécutée.

## 4. Problèmes
Un tableau, trié par gravité. Rien d'autre.

| # | Gravité | Fichier(s) | Problème | Effet concret | Correction proposée (une ligne) |
|---|---------|-----------|----------|---------------|--------------------------------|

Gravité :
- BLOQUANT — donnée fausse/perdue, calcul faux, ou agent qui codera la mauvaise chose.
- MOYEN    — friction réelle à l'usage, mais rattrapable après coup.
- MINEUR   — à corriger si on passe par là.

Si une colonne « Effet concret » ne peut pas être remplie par une phrase décrivant ce que
l'utilisateur verrait, la ligne n'a rien à faire dans le tableau. Supprime-la.

## 5. Ce que je propose de RETIRER du périmètre
(peut être vide, mais réfléchis-y sérieusement)

## 6. Questions au commanditaire
Uniquement celles qui bloquent. Formulées en oui/non ou en choix fermé.
```

**Pas de préambule, pas de conclusion, pas de félicitations, pas de « globalement le dossier est de bonne
qualité ».** Le tableau et les calculs suffisent.

---

## 6. Terminé quand

- Les 17 vecteurs ont été **recalculés à la main** et le calcul figure dans le rapport.
- Les contrôles mécaniques du §3.2 ont été **exécutés**, pas supposés.
- `docs/AUDIT.md` existe, et **aucun autre fichier n'a été modifié**.
- Chaque ligne du tableau porte un effet concret et une correction d'une ligne.
- Tu as répondu explicitement à : **« ce dossier peut-il partir en L0 tel quel ? »**

**Si tu ne trouves aucun problème BLOQUANT, dis-le franchement.** Un audit qui invente des problèmes pour
justifier son existence est pire qu'un audit vide : il fera perdre du temps sur des corrections inutiles,
et noiera les vraies erreurs dans le bruit.
