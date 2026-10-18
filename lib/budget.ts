import { supabase } from '@/lib/supabase';

// Réglages du budget (une seule ligne dans la table "budget_settings")
export type BudgetSettings = {
  id?: string;
  amount: number; // somme à ne pas dépasser sur une période (ex : 50 €)
  missing_margin: number; // marge de sécurité quand des articles n'ont pas de prix (ex : 10 € -> limite à 40 €)
  period_value: number; // durée de la période (ex : 2)...
  period_unit: 'day' | 'week'; // ...en jours ou en semaines
  start_date: string; // début de la première période (AAAA-MM-JJ) ; les suivantes s'enchaînent
};

// Une dépense : le prix d'une course validée
export type Expense = { id: string; amount: number; label: string | null; spent_at: string };

export type BudgetState = {
  settings: BudgetSettings;
  period: { start: Date; end: Date }; // période en cours (fin exclue)
  expenses: Expense[]; // dépenses de la période en cours
  spent: number;
  remaining: number; // ce qu'on peut encore dépenser sur la période (jamais négatif)
};

// Date du jour au format AAAA-MM-JJ (heure locale)
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Réglages par défaut tant que rien n'est enregistré : 50 € par semaine, limite à 40 € si des prix manquent
export const DEFAULT_BUDGET: BudgetSettings = {
  amount: 50,
  missing_margin: 10,
  period_value: 1,
  period_unit: 'week',
  start_date: today()
};

// Période en cours : on part de la date de début et on enchaîne des périodes de même durée.
// Exemple : début le 1er, période de 2 jours -> 1er-2, 3-4, 5-6...
export function currentPeriod(settings: BudgetSettings, now = new Date()) {
  const [y, m, d] = settings.start_date.split('-').map(Number);
  const lengthDays = Math.max(1, settings.period_value) * (settings.period_unit === 'week' ? 7 : 1);
  // Nombre de jours écoulés depuis le début (calcul en UTC pour ignorer les changements d'heure)
  const elapsedDays = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000
  );
  const index = Math.max(0, Math.floor(elapsedDays / lengthDays));
  const start = new Date(y, m - 1, d + index * lengthDays);
  const end = new Date(y, m - 1, d + (index + 1) * lengthDays);
  return { start, end };
}

// Charge les réglages et les dépenses de la période en cours, et calcule ce qui reste.
// Si les tables n'existent pas encore, on utilise les réglages par défaut sans dépense.
export async function fetchBudget(): Promise<BudgetState> {
  const { data: rows, error } = await supabase.from('budget_settings').select('*').limit(1);
  if (error) console.error(error);
  const settings: BudgetSettings = rows?.[0] ? { ...DEFAULT_BUDGET, ...rows[0] } : DEFAULT_BUDGET;
  const period = currentPeriod(settings);

  const { data: exp, error: expError } = await supabase
    .from('expenses')
    .select('*')
    .gte('spent_at', period.start.toISOString())
    .lt('spent_at', period.end.toISOString())
    .order('spent_at', { ascending: false });
  if (expError) console.error(expError);

  const expenses = (exp as Expense[]) ?? [];
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  return { settings, period, expenses, spent, remaining: Math.max(0, Number(settings.amount) - spent) };
}

// Enregistre le prix d'une course validée : il est déduit de ce qui reste sur la période
export async function recordExpense(amount: number, label: string) {
  const { error } = await supabase.from('expenses').insert({ amount: Math.round(amount * 100) / 100, label });
  if (error) console.error(error);
}

// Budget dépassé ? Plus que ce qui reste, ou plus que (reste - marge) si des articles n'ont pas de prix
export function isOverBudget(total: number, hasMissingPrice: boolean, budget: BudgetState) {
  return total > budget.remaining || (hasMissingPrice && total > budget.remaining - Number(budget.settings.missing_margin));
}

// Date courte à la française (ex : 18/10)
export function shortDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
