# Ma Cave

Gestion d'une cave à vin. Web app statique, hébergée sur GitHub Pages, **deux utilisateurs**.
Savoir où est chaque bouteille, quand la boire, et avec quoi la servir — sur la France, la Suisse
et l'Italie.

Pas de build, pas de backend, pas de base de données. `data.json` dans ce dépôt **est** la base.

---

## Quel document fait foi sur quoi

C'est la question la plus importante de ce dépôt. **Une règle écrite deux fois divergera** — c'est une
certitude, pas un risque. Chaque sujet a donc **un seul** document de référence, et les autres y renvoient
sans le recopier.

| Sujet | Fait foi | Ne fait PAS foi |
|---|---|---|
| **Pourquoi** le projet existe, périmètre, parcours, décisions produit | `docs/PRD.md` | — |
| **Modèle de données** (champs, types, contraintes) | `schema/data.schema.json` | le PRD, qui l'explique sans le redéfinir |
| **Calcul de la garde et des accords** | `docs/SPEC_MOTEURS.md` + `kb/garde.json` + `kb/accords.json` | le PRD, les briefs, les SKILL.md |
| **Arbitrages tranchés** (et leur justification) | `docs/DECISIONS.md` | — |
| **Règles qui cassent le projet si on les ignore** | `CLAUDE.md` | — |
| **Découpage du travail** | `docs/BRIEFS_LOTS.md` | — |
| **Référence visuelle du plan** | `prototype-plan-cave.html`, variantes A et C | — |

**Aucun chiffre de barème, aucune règle métier ne doit être recopié ailleurs que dans son fichier de
référence.** Si tu en trouves un, c'est un bug de documentation : supprime-le, mets un renvoi.

---

## Structure

```
/
├── index.html                 shell unique, routage par hash (#/plan, #/vins, …)
├── manifest.json · sw.js
├── data.json                  ← DONNÉES MUTABLES (la « base »)
├── assets/styles.css · assets/icons/
├── app/
│   ├── main.js                bootstrap, routeur
│   ├── store.js               état en mémoire, application des opérations, abonnements
│   ├── ops.js                 opérations atomiques rejouables + allocation des ids
│   ├── github.js              SEUL module réseau (lecture, écriture, sha, 409, retry)
│   ├── kb.js                  chargement ET RÉSOLUTION du KB (appellations, cépages, synonymes)
│   ├── garde.js               moteur de garde        → docs/SPEC_MOTEURS.md §1
│   ├── accords.js             moteur d'accords       → docs/SPEC_MOTEURS.md §2
│   ├── format.js              libellés, slotKey, normalisation de recherche
│   └── views/                 plan · vins · fiche · a-boire · accords · degustations · stats · reglages
├── kb/                        BASE DE CONNAISSANCES — statique, jamais écrite par l'app
│   ├── cepages.json · regions.json      produits par les lots L1-CH / L1-FR / L1-IT
│   └── garde.json · accords.json        LIVRÉS COMPLETS — à calibrer, pas à regénérer
├── schema/                    data.schema.json · kb.cepages.schema.json · kb.regions.schema.json
├── scripts/                   validate-data.mjs · validate-kb.mjs · query.mjs · make-fixture.mjs
├── tests/                     garde · accords · ops (node --test, zéro dépendance)
├── docs/                      PRD.md · SPEC_MOTEURS.md · DECISIONS.md · BRIEFS_LOTS.md
└── .claude/skills/            cave-context · choisir-un-vin · etat-de-la-cave ·
                               ajouter-depuis-etiquette · enregistrer-degustation
```

`inbox/` (photos d'étiquettes en transit) est dans `.gitignore`. Aucune image n'est commitée.

---

## Développement

```bash
npm install                      # devDependencies uniquement (ajv) — jamais servi au navigateur
python3 -m http.server 8000      # ou tout serveur statique
node scripts/validate-data.mjs   # schéma + les 6 invariants
node scripts/validate-kb.mjs     # intégrité référentielle du KB
node --test                      # vecteurs de garde, d'accords, et le test du conflit 409
```

Un `git push` = un déploiement. Il n'y a pas d'étape de build, et il ne doit jamais y en avoir.

## Utilisation

Chaque utilisateur colle son **fine-grained PAT** GitHub (ce dépôt uniquement,
`Contents: Read and write`) dans Réglages. Sans token, l'app est **en lecture seule** — pas en erreur.

---

## Avant de proposer un changement

1. `node scripts/validate-data.mjs` et `node scripts/validate-kb.mjs` passent.
2. `node --test` passe.
3. Testé à **380 px** de large. C'est la cible, pas un cas limite.
4. Aucune règle métier n'a été dupliquée hors de son fichier de référence.
