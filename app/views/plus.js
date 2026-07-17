// views/plus.js — écran « Plus » (PRD §6). Route #/plus.
//
// La barre principale n'a que cinq onglets (Plan · Vins · À boire · Accords · Plus). « Plus »
// regroupe les écrans secondaires : Dégustations, Stats, Réglages. Simple page d'atterrissage —
// pas de menu déroulant, qui se battrait avec le re-rendu total du routeur.

const LIENS = [
  { route: '/degustations', titre: 'Dégustations', desc: 'Historique, recherche, édition des notes.' },
  { route: '/stats', titre: 'Stats', desc: 'Montant dépensé, valeur de la cave, graphiques.' },
  { route: '/reglages', titre: 'Réglages', desc: 'Token, nom, zones, export, diagnostic.' },
];

export function renderPlus(container, ctx) {
  const { el } = ctx;
  container.append(el('h1', { text: 'Plus' }));
  container.append(el('ul', { class: 'menu' },
    ...LIENS.map((l) => el('li', {},
      el('a', { class: 'menu__item', href: `#${l.route}` },
        el('span', { class: 'menu__titre', text: l.titre }),
        el('span', { class: 'menu__desc', text: l.desc }))))));
}
