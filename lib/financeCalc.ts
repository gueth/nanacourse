// Calculs financiers purs (sans base de données) : épargne vers un objectif, crédits,
// projections. Les taux sont annuels (0.03 = 3 %) et appliqués mois par mois (taux / 12),
// comme le font les banques françaises pour les crédits.

const MAX_MONTHS = 1200; // 100 ans : au-delà, on considère que l'objectif n'est jamais atteint

function monthlyRate(annualRate: number) {
  return annualRate / 12;
}

// Valeur atteinte après "months" mois, en partant de "saved" et en ajoutant "monthly" chaque mois
export function futureValue(saved: number, monthly: number, annualRate: number, months: number) {
  const i = monthlyRate(annualRate);
  if (i === 0) return saved + monthly * months;
  const g = Math.pow(1 + i, months);
  return saved * g + (monthly * (g - 1)) / i;
}

// Nombre de mois pour passer de "saved" à "target" en épargnant "monthly" par mois (null : jamais)
export function monthsToTarget(saved: number, target: number, monthly: number, annualRate: number) {
  if (saved >= target) return 0;
  const i = monthlyRate(annualRate);
  if (i === 0) return monthly > 0 ? Math.ceil((target - saved) / monthly) : null;
  const n = Math.log((target * i + monthly) / (saved * i + monthly)) / Math.log(1 + i);
  return Number.isFinite(n) && n >= 0 && n <= MAX_MONTHS ? Math.ceil(n) : null;
}

// Épargne mensuelle nécessaire pour atteindre "target" en "months" mois
export function requiredMonthly(saved: number, target: number, months: number, annualRate: number) {
  if (months <= 0) return Math.max(0, target - saved);
  const i = monthlyRate(annualRate);
  if (i === 0) return Math.max(0, (target - saved) / months);
  const g = Math.pow(1 + i, months);
  return Math.max(0, ((target - saved * g) * i) / (g - 1));
}

// Taux réel : rendement une fois l'inflation retirée (pour raisonner en euros d'aujourd'hui)
export function realRate(annualRate: number, inflation: number) {
  return (1 + annualRate) / (1 + inflation) - 1;
}

// Mensualité d'un crédit de "principal" sur "months" mois
export function loanPayment(principal: number, annualRate: number, months: number) {
  const i = monthlyRate(annualRate);
  if (months <= 0) return principal;
  if (i === 0) return principal / months;
  return (principal * i) / (1 - Math.pow(1 + i, -months));
}

// Déroulé d'un crédit : durée restante et intérêts restant à payer (null : la mensualité ne couvre pas les intérêts)
export function loanSchedule(principal: number, annualRate: number, monthly: number) {
  const i = monthlyRate(annualRate);
  let balance = principal;
  let interest = 0;
  let months = 0;
  while (balance > 0.005) {
    const due = balance * i;
    if (monthly <= due) return null;
    interest += due;
    balance = balance + due - monthly;
    months++;
    if (months > MAX_MONTHS) return null;
  }
  return { months, interest };
}

// Date (mois/année) atteinte dans "months" mois : "mars 2029"
export function monthsFromNow(months: number, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// "2 ans et 3 mois"
export function durationLabel(months: number) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} an${y > 1 ? 's' : ''}`);
  if (m || !y) parts.push(`${m} mois`);
  return parts.join(' et ');
}

export type DebtInput = { id: string; name: string; principal: number; rate: number; monthly: number };
export type Strategy = 'avalanche' | 'snowball';

// Remboursement de plusieurs dettes avec un budget mensuel fixe (somme des mensualités + "extra").
// Quand une dette est soldée, sa mensualité est reportée sur la suivante :
// - avalanche : on attaque d'abord la dette au taux le plus élevé (moins d'intérêts payés)
// - boule de neige : on attaque d'abord la plus petite dette (victoires rapides)
export function simulateDebts(debts: DebtInput[], extra: number, strategy: Strategy) {
  const state = debts.filter((d) => d.principal > 0).map((d) => ({ ...d, balance: d.principal, paidOffAt: null as number | null }));
  const budget = state.reduce((s, d) => s + d.monthly, 0) + extra;
  let interest = 0;
  let month = 0;

  while (state.some((d) => d.balance > 0.005)) {
    month++;
    if (month > MAX_MONTHS) return null;
    // Intérêts du mois
    for (const d of state) {
      if (d.balance <= 0.005) continue;
      const due = d.balance * monthlyRate(d.rate);
      d.balance += due;
      interest += due;
    }
    // Mensualités minimales
    let left = budget;
    for (const d of state) {
      if (d.balance <= 0.005) continue;
      const pay = Math.min(d.monthly, d.balance, left);
      d.balance -= pay;
      left -= pay;
    }
    // Le reste du budget va à la dette prioritaire, puis à la suivante
    const order = state
      .filter((d) => d.balance > 0.005)
      .sort((a, b) => (strategy === 'avalanche' ? b.rate - a.rate : a.balance - b.balance));
    for (const d of order) {
      if (left <= 0) break;
      const pay = Math.min(left, d.balance);
      d.balance -= pay;
      left -= pay;
    }
    for (const d of state) if (d.balance <= 0.005 && d.paidOffAt === null) d.paidOffAt = month;
  }

  return {
    months: month,
    interest,
    order: [...state].sort((a, b) => (a.paidOffAt ?? 0) - (b.paidOffAt ?? 0)).map((d) => ({ name: d.name, month: d.paidOffAt ?? month }))
  };
}

// --- Placements ---

// Rendement annuel moyen d'un placement ouvert depuis "years" ans (null : moins d'un an, le chiffre ne voudrait rien dire).
// Calculé comme si tout avait été versé à l'ouverture : si les versements ont été étalés, le vrai rendement est un peu plus élevé.
export function annualizedReturn(invested: number, value: number, years: number) {
  if (invested <= 0 || value <= 0 || years < 1) return null;
  return Math.pow(value / invested, 1 / years) - 1;
}

// Ce que les frais annuels coûtent sur "years" ans : écart entre la valeur atteinte sans frais et avec frais
export function feesCost(value: number, grossRate: number, fees: number, years: number) {
  return futureValue(value, 0, grossRate, years * 12) - futureValue(value, 0, grossRate - fees, years * 12);
}

// Baisse plausible sur une mauvaise année selon le niveau de risque (1 à 7), ordre de grandeur indicatif
// inspiré des fourchettes de volatilité de l'indicateur de risque européen (SRI)
export const BAD_YEAR_DROP = [0, 0, 0.02, 0.08, 0.15, 0.25, 0.35, 0.6];
