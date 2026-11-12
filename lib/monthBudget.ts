import { annualCategoryId, categoryById, categoryGroups, groupMembers, groupTarget, isOwnAnnual, limitIn, summarize, type Budget, type MonthBudget, type PlannedExpense, type Transaction } from '@/lib/transactions';

// Budget d'un mois : les limites des grandes catégories et des catégories (celles du mois s'il en a, sinon celles de sa
// couleur, sinon les générales), plus un douzième de chaque dépense annuelle, face à ce qui y a été dépensé.
// Sert au Budget du mois, à « Budget utilisé » (En bref) et aux règles « Budget » des couleurs (Paramètres > Finances).

const round = (n: number) => Math.round(n * 100) / 100;

// Une dépense annuelle compte à partir du mois de sa création
export const plannedFrom = (p: PlannedExpense) => (p.created_at ?? '').slice(0, 7);
// Dépenses annuelles comptées un mois donné : créées ce mois ou avant, et non reliées à une catégorie (sa limite les tient)
export const activePlans = (planned: PlannedExpense[], month: string) => planned.filter((p) => isOwnAnnual(p) && plannedFrom(p) <= month);

// Limites d'un mois : les siennes (month_budgets) s'il en a, sinon celles de sa couleur (colorLimits : « groupe:<id> » →
// limite, voir lib/colorBudgets), sinon les limites générales.
// category(id) / group(id) : limite d'une catégorie / grande catégorie (null : pas de limite) ; categories : celles limitées ce mois-là
export type ColorLimits = Map<string, number> | null | undefined;
export function monthLimits(month: string, budgets: Budget[], monthBudgets: MonthBudget[], colorLimits?: ColorLimits) {
  const category = (id: string) => limitIn(month, id, budgets.find((b) => b.category === id)?.monthly_limit ?? null, monthBudgets);
  const group = (id: string) =>
    limitIn(month, groupTarget(id), colorLimits?.get(groupTarget(id)) ?? categoryGroups().find((g) => g.id === id)?.monthly_limit ?? null, monthBudgets);
  const ids = new Set([
    ...budgets.map((b) => b.category),
    ...monthBudgets.filter((b) => b.month === month && b.custom_limit && !b.target.startsWith('groupe:')).map((b) => b.target)
  ]);
  const categories = [...ids].map((id) => ({ category: id, limit: category(id) })).filter((l): l is { category: string; limit: number } => l.limit !== null);
  return { category, group, categories };
}

// Budgets d'un mois : grandes catégories limitées (le total de leurs sous-catégories), puis catégories limitées hors de
// celles-ci, avec ce qui y a été dépensé (byCategory : dépenses par catégorie, voir summarize)
export function budgetLinesOf(month: string, byCategory: Map<string, number>, budgets: Budget[], monthBudgets: MonthBudget[], colorLimits?: ColorLimits) {
  const spentIn = (id: string) => byCategory.get(id) ?? 0;
  const limits = monthLimits(month, budgets, monthBudgets, colorLimits);
  const limitedGroups = categoryGroups()
    .filter((g) => g.kind === 'expense' && !g.virtual)
    .map((g) => ({ g, limit: limits.group(g.id) }))
    .filter((x): x is { g: (typeof x)['g']; limit: number } => x.limit !== null);
  return [
    ...limitedGroups.map(({ g, limit }) => ({
      target: groupTarget(g.id),
      label: g.label,
      limit,
      spent: groupMembers(g.id)
        .filter((c) => !c.annual)
        .reduce((s, c) => s + spentIn(c.id), 0)
    })),
    ...limits.categories
      .map(({ category, limit }) => ({ cat: categoryById(category), category, limit }))
      .filter(({ cat, category }) => cat.id === category && !cat.annual && !limitedGroups.some(({ g }) => g.id === cat.group))
      .map(({ cat, limit }) => ({ target: cat.id, label: cat.label, limit, spent: spentIn(cat.id) }))
  ];
}

// Total du budget d'un mois : ce qu'on pouvait dépenser (limites + parts des dépenses annuelles) et ce qui a été
// dépensé dans ces mêmes catégories
export function budgetOfMonth(
  month: string,
  monthTx: Transaction[],
  budgets: Budget[],
  planned: PlannedExpense[],
  monthBudgets: MonthBudget[] = [],
  colorLimits?: ColorLimits
): { allowed: number; spent: number } {
  const { byCategory } = summarize(monthTx);
  let allowed = 0;
  let spent = 0;
  for (const line of budgetLinesOf(month, byCategory, budgets, monthBudgets, colorLimits)) {
    allowed += line.limit;
    spent += line.spent;
  }
  for (const p of activePlans(planned, month)) {
    allowed += p.amount / 12;
    spent += byCategory.get(annualCategoryId(p.id)) ?? 0;
  }
  return { allowed: round(allowed), spent: round(spent) };
}
