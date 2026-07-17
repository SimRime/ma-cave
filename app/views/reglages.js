// views/reglages.js — token GitHub, nom d'utilisateur, test de connexion, éditeur de zones (L2),
// écran Diagnostic. C'est l'écran qui déclenche des écritures (test d'écriture, gestion des zones).

import { renderZones } from './zones.js';

const PAT_URL = 'https://github.com/settings/personal-access-tokens/new';

export function renderReglages(container, ctx) {
  const { el, store, github, settings } = ctx;
  const state = store.getState();
  const { token, user } = settings.read();

  // — Identité et token —————————————————————————————————————————————————————
  const userInput = el('input', { type: 'text', id: 'r-user', value: user, maxlength: '60', placeholder: 'Votre prénom' });
  const tokenInput = el('input', { type: 'password', id: 'r-token', value: token, placeholder: 'github_pat_…', autocomplete: 'off' });

  const connStatus = el('p', { class: 'status', text: '' });

  const save = () => {
    settings.save({ token: tokenInput.value.trim(), user: userInput.value.trim() });
    ctx.onChange(); // recalcule le bandeau lecture seule et l'état des boutons
  };

  const testConnection = async () => {
    settings.save({ token: tokenInput.value.trim(), user: userInput.value.trim() });
    connStatus.textContent = 'Test en cours…';
    const r = await github.testConnection();
    connStatus.textContent = r.message;
    connStatus.className = r.ok && r.canWrite ? 'status status--ok' : 'status status--warn';
  };

  const identite = el('section', { class: 'card' },
    el('h2', { text: 'Réglages' }),
    el('label', { for: 'r-user', text: 'Nom d’utilisateur (pour « modifié par » et les dégustations)' }),
    userInput,
    el('label', { for: 'r-token', text: 'Token GitHub' }),
    tokenInput,
    el('p', { class: 'help' },
      el('a', { href: PAT_URL, target: '_blank', rel: 'noopener', text: 'Créer un fine-grained token' }),
      ' — ce dépôt uniquement, permission « Contents: Read and write », expiration 1 an. ',
      'Sans token, la cave reste consultable en lecture seule.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn--primary', onclick: save, text: 'Enregistrer' }),
      el('button', { class: 'btn', onclick: testConnection, text: 'Tester la connexion' })),
    connStatus,
  );

  // — Diagnostic (PRD §6.8, DECISIONS.md D11) ————————————————————————————————
  const data = state.data;
  const swState = navigator.serviceWorker && navigator.serviceWorker.controller
    ? 'actif'
    : 'non enregistré (prévu au lot L5)';

  const writeStatus = el('p', { class: 'status', text: '' });

  const testWrite = async () => {
    if (!state.canWrite) return;
    const target = data?.wines?.[0];
    if (!target) { writeStatus.textContent = 'Aucun vin à toucher pour le test.'; return; }
    writeStatus.textContent = 'Écriture de test en cours…';
    try {
      // Opération réelle, non destructive : un UPDATE_WINE sans champ modifié. Seuls updatedAt /
      // updatedBy changent → un commit visible sur GitHub, sans altérer la cave.
      const res = await store.dispatch({ type: 'UPDATE_WINE', payload: { id: target.id, fields: {} } });
      writeStatus.textContent = `Commit écrit — sha ${String(res.sha).slice(0, 7)} (${res.retries} retry).`;
      writeStatus.className = 'status status--ok';
      ctx.onChange();
    } catch (e) {
      writeStatus.textContent = `Échec : ${e.message}`;
      writeStatus.className = 'status status--warn';
    }
  };

  const dl = el('dl', { class: 'diag' },
    dt(el, 'sha courant'), dd(el, state.sha || '—'),
    dt(el, 'modifié le'), dd(el, data?.updatedAt || '—'),
    dt(el, 'modifié par'), dd(el, data?.updatedBy || '—'),
    dt(el, 'token'), dd(el, token ? 'présent' : 'absent (lecture seule)'),
    dt(el, 'service worker'), dd(el, swState),
    dt(el, 'zones · vins · bouteilles'),
    dd(el, data ? `${data.zones.length} · ${data.wines.length} · ${data.bottles.length}` : '—'),
  );

  const journal = store.getJournal();
  const journalList = el('ul', { class: 'journal' },
    journal.length
      ? journal.map((j) => el('li', {},
          el('code', { text: j.type }),
          ` — ${j.result}`,
          j.retries ? ` (${j.retries} retry)` : '',
          el('time', { class: 'muted', text: ` ${j.at}` })))
      : el('li', { class: 'muted', text: 'Aucune opération dans cette session.' }),
  );

  const testWriteBtn = el('button', {
    class: 'btn btn--primary',
    onclick: testWrite,
    text: 'Tester l’écriture',
    disabled: !state.canWrite,
    title: state.canWrite ? '' : 'Ajoutez un token pour écrire.',
  });

  // — Export data.json (PRD §6.8) — un téléchargement de fichier, jamais via localStorage ——————
  const exportData = () => {
    const d = store.getState().data;
    if (!d) return;
    const blob = new Blob([`${JSON.stringify(d, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'data.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportCard = el('section', { class: 'card' },
    el('h2', { text: 'Export' }),
    el('p', { class: 'help', text: 'Télécharge une copie de data.json (vins, bouteilles, zones, dégustations). Format JSON — pas de CSV.' }),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: exportData, text: 'Exporter data.json', disabled: !data })),
  );

  const diagnostic = el('section', { class: 'card' },
    el('h2', { text: 'Diagnostic' }),
    dl,
    el('div', { class: 'row' }, testWriteBtn,
      !state.canWrite ? el('span', { class: 'muted', text: 'Écriture désactivée sans token.' }) : null),
    writeStatus,
    el('h3', { text: '20 dernières opérations' }),
    journalList,
  );

  container.append(identite);
  renderZones(container, ctx); // éditeur de zones (L2, PRD §6.8)
  container.append(exportCard);
  container.append(diagnostic);
}

const dt = (el, t) => el('dt', { text: t });
const dd = (el, t) => el('dd', { text: t });
