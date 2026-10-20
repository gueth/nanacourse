// Notions de finance expliquées simplement : affichées dans les explications des indicateurs
// et une par mois dans le bilan mensuel ("une notion à apprendre").

export type Notion = { id: string; term: string; text: string };

export const GLOSSARY: Notion[] = [
  {
    id: 'patrimoine',
    term: 'Patrimoine net',
    text: "Tout ce que tu possèdes (comptes, épargne, biens) moins tout ce que tu dois. Attention : ce montant n'est pas forcément disponible sur ton compte, une voiture ou un logement ne se dépensent pas."
  },
  {
    id: 'reserve',
    term: 'Réserve de sécurité',
    text: "De l'argent mis de côté, disponible à tout moment (livret A, LDDS), pour faire face à un imprévu sans t'endetter : panne, perte d'emploi, frais de santé. On vise en général 3 à 6 mois de dépenses indispensables."
  },
  {
    id: 'taux_epargne',
    term: "Taux d'épargne",
    text: "La part de tes revenus que tu ne dépenses pas. 10 % est un bon début, 20 % est très solide. C'est l'indicateur qui fait le plus avancer vers l'autonomie."
  },
  {
    id: 'interets_composes',
    term: 'Intérêts composés',
    text: "Quand les intérêts gagnés rapportent à leur tour des intérêts. Sur de longues durées, l'effet devient important : c'est pourquoi commencer tôt compte plus qu'épargner beaucoup."
  },
  {
    id: 'inflation',
    term: 'Inflation',
    text: "La hausse générale des prix. Avec 2 % d'inflation, 100 € d'aujourd'hui n'achètent plus que l'équivalent de 98 € dans un an. Un placement qui rapporte moins que l'inflation fait perdre du pouvoir d'achat."
  },
  {
    id: 'taux_endettement',
    term: "Taux d'endettement",
    text: "La part de tes revenus mensuels consacrée au remboursement de crédits. Les banques considèrent qu'au-delà de 35 %, le budget devient fragile."
  },
  {
    id: 'taeg',
    term: 'TAEG',
    text: "Taux annuel effectif global : le vrai coût d'un crédit, frais et assurance compris. C'est lui qu'il faut comparer entre deux offres, pas seulement le taux nominal."
  },
  {
    id: 'diversification',
    term: 'Diversification',
    text: "Ne pas mettre tous ses œufs dans le même panier : répartir son argent entre plusieurs placements pour qu'une mauvaise surprise sur l'un ne fasse pas tout perdre."
  },
  {
    id: 'horizon',
    term: 'Horizon de placement',
    text: "La durée pendant laquelle tu peux laisser ton argent placé sans y toucher. Plus l'horizon est long, plus on peut accepter des placements qui varient (actions), car on a le temps d'attendre qu'ils remontent."
  },
  {
    id: 'frais_placement',
    term: 'Frais de gestion',
    text: "Un pourcentage prélevé chaque année sur la valeur d'un placement, qu'il gagne ou qu'il perde. 1 % paraît peu, mais sur 20 ans il peut emporter près d'un cinquième de ce que tu aurais eu sans frais."
  },
  {
    id: 'risque',
    term: 'Niveau de risque (SRI)',
    text: "Une note de 1 à 7 inscrite dans le document d'information de chaque placement. 1 : la valeur ne bouge presque pas ; 7 : elle peut perdre plus de la moitié en peu de temps. Plus le risque est élevé, plus il faut un horizon long."
  },
  {
    id: 'revenus_passifs',
    term: 'Revenus passifs',
    text: "Des revenus qui ne demandent pas de travailler : intérêts, dividendes, loyers. L'autonomie financière, c'est quand ils couvrent tes dépenses."
  },
  {
    id: 'regle_4',
    term: 'Règle des 4 %',
    text: "Repère approximatif : un patrimoine placé égal à 25 fois tes dépenses annuelles permettrait d'en retirer environ 4 % par an pendant longtemps. C'est une estimation fondée sur le passé, pas une garantie."
  },
  {
    id: 'avalanche',
    term: 'Avalanche et boule de neige',
    text: "Deux façons de rembourser plusieurs dettes : avalanche = la dette au taux le plus élevé d'abord (moins d'intérêts payés) ; boule de neige = la plus petite d'abord (des victoires rapides, motivantes)."
  },
  {
    id: 'charges_fixes',
    term: 'Charges fixes et variables',
    text: "Les charges fixes reviennent chaque mois au même montant (loyer, abonnements, assurances). Les variables changent selon tes choix (courses, sorties). C'est surtout sur les variables, et sur les abonnements oubliés, que l'on peut agir vite."
  }
];

export const notion = (id: string) => GLOSSARY.find((n) => n.id === id)!;

// Notion du mois : change chaque mois, la même pour tout le mois
export function notionOfMonth(period: string) {
  const [y, m] = period.split('-').map(Number);
  return GLOSSARY[(y * 12 + m) % GLOSSARY.length];
}
