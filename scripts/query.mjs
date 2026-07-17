// query.mjs — interrogation de la cave en ligne de commande, pour Claude Code (lot L6).
//
// Ce script NE RÉIMPLÉMENTE RIEN. Il importe les moteurs et agrégats de l'app et se contente de les
// appeler sur les fichiers lus SUR DISQUE. C'est la garantie que l'app (navigateur) et les skills
// Claude Code classent les vins IDENTIQUEMENT — une règle métier écrite deux fois divergerait
// (CLAUDE.md « Un seul endroit pour chaque logique »).
//
//   node scripts/query.mjs --accord <platId> --en-stock [--json]   accords mets → vin (accords.js)
//   node scripts/query.mjs --a-boire [--json]                      urgences de garde (garde.js)
//   node scripts/query.mjs --inventaire [--json]                   inventaire, valeur, provenance (stats.js)
//   options communes : --data <chemin>  (défaut data.json racine)  --annee <n>  (défaut année courante)
//
// Tourne sous Node comme tests/accords.test.mjs : lit data.json et kb/*.json sur disque, JAMAIS via
// l'API. N'importe JAMAIS app/github.js ni aucune API navigateur (fetch, btoa) : ce module est en
// lecture pure. L'unique skill qui écrit (enregistrer-degustation) édite data.json puis commite —
// il ne passe pas par ici.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildKb } from '../app/kb.js';
import { accordsPourPlat } from '../app/accords.js';
import { gardeEffective, statutsGarde } from '../app/garde.js';
import { montantDepense, valeurCave, provenance, parRegion, parCouleur } from '../app/stats.js';
import { slotLabel, wineLabel } from '../app/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

// Chargement du KB depuis le disque (mêmes fichiers que l'app, via le MÊME buildKb).
async function loadKbDisk() {
  const at = (name) => path.join(root, 'kb', name);
  const [garde, cepages, regions, accords] = await Promise.all([
    readJson(at('garde.json')),
    readJson(at('cepages.json')),
    readJson(at('regions.json')),
    readJson(at('accords.json')),
  ]);
  return buildKb({ garde, cepages, regions, accords });
}

// ---------------------------------------------------------------------------
// Analyse des arguments (minimale, sans dépendance).
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--accord': opts.accord = argv[++i]; break;
      case '--data': opts.data = argv[++i]; break;
      case '--annee': opts.annee = Number(argv[++i]); break;
      case '--en-stock': opts.enStock = true; break;
      case '--json': opts.json = true; break;
      case '--a-boire': opts.aBoire = true; break;
      case '--inventaire': opts.inventaire = true; break;
      default:
        console.error(`Argument inconnu : ${a}`);
        process.exit(1);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Helpers d'affichage (aucune règle métier : mise en forme uniquement).
// ---------------------------------------------------------------------------

const zoneNom = (data, slot) => data.zones?.find((z) => z.id === slot.zone)?.nom ?? slot.zone;

// Emplacement lisible : « Ma cave · C4 » — sans lui, on ne va pas fouiller la cave (PRD §6.5).
const emplacement = (data, bottle) =>
  bottle?.slot ? `${zoneNom(data, bottle.slot)} · ${slotLabel(bottle.slot)}` : 'à ranger';

const drapeauxLibelles = (kb, flags) => flags.map((f) => kb.garde.statuts?.[f]?.libelle ?? f);

// Ligne de service (température, carafage, verre) déjà résolue par accords.js (serviceVin).
function serviceLigne(svc) {
  if (!svc) return null;
  const bits = [];
  if (Array.isArray(svc.tempC)) bits.push(`${svc.tempC[0]}–${svc.tempC[1]} °C`);
  bits.push(svc.carafage ? `carafage ${svc.carafage}` : 'sans carafage');
  if (svc.verre) bits.push(`verre ${svc.verre}`);
  return bits.join(' · ');
}

// Provenance affichée au moment de choisir : on met en avant les cadeaux (PRD §4.2, §6.5).
function provenanceLigne(bottle) {
  const a = bottle?.acquisition;
  if (!a || a.type !== 'cadeau' || !a.source) return null;
  return `Offerte par ${a.source}${a.occasion ? ` — ${a.occasion}` : ''}`;
}

// ---------------------------------------------------------------------------
// Mode --accord : accords mets → vin. Le SEUL contrat verrouillé par tests/query.test.mjs.
// Sortie --json : EXACTEMENT [{ wineId, score, drapeaux }] (la liste affichée). Sortie humaine :
// tout ce dont un skill a besoin pour répondre (emplacement, raison, garde, service, provenance).
// ---------------------------------------------------------------------------

function modeAccord(data, kb, opts) {
  const platId = opts.accord;
  if (!kb.plat(platId)) {
    console.error(`Plat inconnu : « ${platId} ».`);
    console.error(`Plats valides : ${kb.accords.plats.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }
  const annee = opts.annee || new Date().getFullYear();
  const res = accordsPourPlat(data, platId, kb, annee);
  const liste = res.etablis.length ? res.etablis : res.repli;

  // Contrat d'alignement : rien d'autre que ces trois champs (SPEC_MOTEURS §4).
  if (opts.json) {
    const out = liste.map((c) => ({ wineId: c.wineId, score: c.score, drapeaux: c.drapeaux }));
    process.stdout.write(JSON.stringify(out) + '\n');
    return;
  }

  const plat = kb.plat(platId);
  const lignes = [`Pour : ${plat.nom} (${platId})`];
  if (!liste.length) {
    lignes.push('Aucun vin en cave pour cet accord.');
    console.log(lignes.join('\n'));
    return;
  }
  if (!res.etablis.length) lignes.push(res.intituleRepli); // repli honnêtement étiqueté (D2)
  lignes.push(`${liste.length} vin(s) en cave.`, '');

  liste.forEach((c, i) => {
    lignes.push(`${i + 1}. ${wineLabel(c.wine)} · ${c.wine.couleur} · score ${c.score}`);
    lignes.push(`   Casier  : ${emplacement(data, c.bottle)}${c.nbBouteilles > 1 ? `  (+${c.nbBouteilles - 1} autre(s))` : ''}`);
    lignes.push(`   Garde   : ${drapeauxLibelles(kb, c.flags).join(', ') || '—'}`);
    if (c.raisons?.length) lignes.push(`   Raison  : ${c.raisons.join(' · ')}`);
    const svc = serviceLigne(c.service);
    if (svc) lignes.push(`   Service : ${svc}`);
    const prov = provenanceLigne(c.bottle);
    if (prov) lignes.push(`   ${prov}`);
    lignes.push('');
  });
  console.log(lignes.join('\n').trimEnd());
}

// ---------------------------------------------------------------------------
// Mode --a-boire : urgences de garde, PAR BOUTEILLE, exactement comme l'écran « À boire » de l'app
// (app/views/a-boire.js) — gardeEffective + statutsGarde, trois sections, tri par gardeA croissant.
// ---------------------------------------------------------------------------

function modeABoire(data, kb, opts) {
  const annee = opts.annee || new Date().getFullYear();
  const wineById = new Map(data.wines.map((w) => [w.id, w]));

  const entries = [];
  for (const b of data.bottles) {
    const w = wineById.get(b.wineId);
    if (!w || w.archive) continue;
    const eff = gardeEffective(w, b, kb);
    entries.push({ b, w, eff, flags: statutsGarde(eff, annee) });
  }
  const parGardeA = (a, b) => (a.eff.gardeA ?? Infinity) - (b.eff.gardeA ?? Infinity);
  const urgent = entries.filter((e) => e.flags.includes('urgent') || e.flags.includes('depasse')).sort(parGardeA);
  const apogee = entries.filter((e) => e.flags.includes('apogee')).sort(parGardeA);
  const jeune = entries.filter((e) => e.flags.includes('tropJeune')).sort(parGardeA);

  const toObj = (e) => ({ wineId: e.w.id, bottleId: e.b.id, drapeaux: e.flags, gardeA: e.eff.gardeA, emplacement: emplacement(data, e.b) });

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      aBoireVite: urgent.map(toObj),
      apogee: apogee.map(toObj),
      tropJeune: jeune.map(toObj),
    }) + '\n');
    return;
  }

  const lignes = [];
  const section = (titre, list) => {
    lignes.push(`— ${titre} (${list.length}) —`);
    if (!list.length) lignes.push('  (rien)');
    for (const e of list) {
      const fmt = e.b.format !== 'standard' ? ` (${e.b.format})` : '';
      lignes.push(`  ${wineLabel(e.w)}${fmt} · ${e.w.couleur} · ${emplacement(data, e.b)} · ${drapeauxLibelles(kb, e.flags).join(', ')} · → ${e.eff.gardeA ?? '—'}`);
    }
    lignes.push('');
  };
  section('À boire vite', urgent);
  section('À l’apogée', apogee);
  section('Encore trop jeune', jeune);
  console.log(lignes.join('\n').trimEnd());
}

// ---------------------------------------------------------------------------
// Mode --inventaire : inventaire, les DEUX agrégats monétaires distincts, provenance (app/stats.js).
// ---------------------------------------------------------------------------

function modeInventaire(data, opts) {
  const nbBouteilles = data.bottles.length;
  const nbVins = data.wines.filter((w) => data.bottles.some((b) => b.wineId === w.id)).length;
  const depense = montantDepense(data);
  const valeur = valeurCave(data);
  const prov = provenance(data);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      nbBouteilles, nbVins, montantDepense: depense, valeurCave: valeur,
      provenance: prov, parRegion: parRegion(data), parCouleur: parCouleur(data),
    }) + '\n');
    return;
  }

  const lignes = [
    `${nbBouteilles} bouteille(s) en stock · ${nbVins} vin(s) présent(s).`,
    // Deux chiffres distincts, jamais confondus (PRD §4.2, raison d'être du projet).
    `Montant dépensé  : ${depense} CHF   (Σ prix payés ; cadeaux et héritages = 0)`,
    `Valeur de la cave : ${valeur} CHF   (Σ valeurs des bouteilles en stock, cadeaux compris)`,
    '',
    `Par couleur : ${parCouleur(data).map((x) => `${x.cle} ${x.n}`).join(' · ') || '—'}`,
    `Par région  : ${parRegion(data).map((x) => `${x.cle} ${x.n}`).join(' · ') || '—'}`,
  ];
  if (prov.parType.length) lignes.push(`Provenance  : ${prov.parType.map((x) => `${x.cle} ${x.n}`).join(' · ')}`);
  if (prov.cadeaux.length) lignes.push(`Offert par  : ${prov.cadeaux.map((x) => `${x.cle} (${x.n})`).join(' · ')}`);
  if (prov.heritages.length) lignes.push(`Reste de    : ${prov.heritages.map((x) => `${x.cle} (${x.n})`).join(' · ')}`);
  console.log(lignes.join('\n'));
}

// ---------------------------------------------------------------------------
// Point d'entrée.
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataPath = opts.data ? path.resolve(opts.data) : path.join(root, 'data.json');
  const data = await readJson(dataPath);
  const kb = await loadKbDisk();

  if (opts.accord != null) return modeAccord(data, kb, opts);
  if (opts.aBoire) return modeABoire(data, kb, opts);
  if (opts.inventaire) return modeInventaire(data, opts);

  console.error('Aucun mode. Utiliser --accord <platId> | --a-boire | --inventaire (voir l’en-tête du fichier).');
  process.exit(1);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
