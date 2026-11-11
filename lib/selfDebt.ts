import { shiftMonth } from '@/lib/finance';
import {
  annualCategoryId,
  categoryById,
  categoryGroups,
  countedIn,
  groupMembers,
  groupTarget,
  isOwnAnnual,
  limitIn,
  monthOf,
  SELF_DEBT_ID,
  summarize,
  type Budget,
  type MonthBudget,
  type PlannedExpense,
  type Transaction
} from '@/lib/transactions';

// Dette à moi-même : ce que l'on se doit, mois après mois, pour tenir son budget.
//  - Dépenses annuelles : chaque mois depuis sa création, un douzième de chacune doit apparaître dans sa sous-catégorie
//    (« Dépenses annuelles ») ; la part qu'on ne retrouve pas dans les relevés du mois va dans la dette.
//    Payer plus que sa part (la facture de l'année, ou une mise de côté en avance) la rembourse d'autant.
//  - Budgets : dépasser la limite d'une grande catégorie ou d'une catégorie ajoute le dépassement à la dette ;
//    dépenser moins que prévu la rembourse de la différence. Un mois passé peut avoir ses propres limites
//    (month_budgets), et chaque dépassement ou économie d'un mois peut être retiré de la dette (« ne pas compter »).
//  - Les opérations classées dans « Dette à moi-même » la remboursent aussi.
//  - Mois amorti (bouton « Amortir les dépassements » du Budget du mois) : les économies des budgets couvrent d'abord
//    les dépassements, chacun à proportion ; seul le reste des dépassements va dans la dette. Les économies qui n'ont
//    rien eu à couvrir ne la remboursent pas, et le choix « compter ou non » de chaque ligne ne s'applique plus.
// La dette s'accumule d'un mois sur l'autre ; négative, on est en avance sur son budget. Son total, et ce qui la compose,
// s'affichent dans Finances > Gestion ; Finances > Budget montre celle du mois affiché.

export type DebtItemKind = 'annuelle' | 'depassement' | 'economie' | 'remboursement';
// amount > 0 : ajouté à la dette ; target : catégorie ou grande catégorie (« groupe:<id> ») concernée ;
// ignored : choisi pour ne pas compter dans la dette (affiché, mais hors du total)
// absorbed : mois amorti, part du dépassement couverte par les économies (ou part de l'économie utilisée pour cela)
export type DebtItem = { label: string; amount: number; kind: DebtItemKind; target?: string; ignored?: boolean; absorbed?: number };
// Amortissement d'un mois : total des dépassements, des économies, et ce que les économies en ont couvert
export type Amortization = { over: number; surplus: number; covered: number; used: Map<string, number> };
export type DebtMonth = {
  month: string;
  items: DebtItem[];
  delta: number; // ce que le mois ajoute (> 0) ou retire (< 0) à la dette
  allowed: number; // ce qu'on pouvait dépenser dans le mois : limites des budgets + parts des dépenses annuelles
  spent: number; // ce qui a été dépensé dans ces mêmes catégories
  amortization: Amortization | null; // null : mois non amorti
};

// Ligne de month_budgets qui retient qu'un mois est amorti (counted = true : amorti)
export const AMORTIZE_TARGET = 'amortir';
export const isAmortized = (month: string, monthBudgets: MonthBudget[]) =>
  monthBudgets.find((b) => b.month === month && b.target === AMORTIZE_TARGET)?.counted ?? false;

const round = (n: number) => Math.round(n * 100) / 100;

// Une dépense annuelle compte à partir du mois de sa création
export const plannedFrom = (p: PlannedExpense) => (p.created_at ?? '').slice(0, 7);
// Dépenses annuelles comptées un mois donné : créées ce mois ou avant, et non reliées à une catégorie (sa limite les tient)
export const activePlans = (planned: PlannedExpense[], month: string) => planned.filter((p) => isOwnAnnual(p) && plannedFrom(p) <= month);

// Limites d'un mois : les siennes (month_budgets) s'il en a, sinon les limites générales.
// category(id) / group(id) : limite d'une catégorie / grande catégorie (null : pas de limite) ; categories : celles limitées ce mois-là
export function monthLimits(month: string, budgets: Budget[], monthBudgets: MonthBudget[]) {
  const category = (id: string) => limitIn(month, id, budgets.find((b) => b.category === id)?.monthly_limit ?? null, monthBudgets);
  const group = (id: string) => limitIn(month, groupTarget(id), categoryGroups().find((g) => g.id === id)?.monthly_limit ?? null, monthBudgets);
  const ids = new Set([
    ...budgets.map((b) => b.category),
    ...monthBudgets.filter((b) => b.month === month && b.custom_limit && !b.target.startsWith('groupe:')).map((b) => b.target)
  ]);
  const categories = [...ids].map((id) => ({ category: id, limit: category(id) })).filter((l): l is { category: string; limit: number } => l.limit !== null);
  return { category, group, categories };
}

// Dette ajoutée (ou remboursée) par un mois, à partir de ses opérations
export function debtOfMonth(month: string, monthTx: Transaction[], budgets: Budget[], planned: PlannedExpense[], monthBudgets: MonthBudget[] = []): DebtMonth {
  const { byCategory } = summarize(monthTx);
  const spentIn = (id: string) => byCategory.get(id) ?? 0;
  const items: DebtItem[] = [];
  let allowed = 0;
  let spent = 0;

  for (const line of budgetLinesOf(month, byCategory, budgets, monthBudgets)) {
    allowed += line.limit;
    spent += line.spent;
    const over = round(line.spent - line.limit);
    const ignored = !countedIn(month, line.target, monthBudgets);
    if (over > 0) items.push({ label: `${line.label} : dépassement`, amount: over, kind: 'depassement', target: line.target, ignored });
    else if (over < 0) items.push({ label: `${line.label} : moins que prévu`, amount: over, kind: 'economie', target: line.target, ignored });
  }
  const amortization = isAmortized(month, monthBudgets) ? amortize(items) : null;
  return { ...finishDebt(month, items, allowed, spent, spentIn, planned, monthBudgets), amortization };
}

// Mois amorti : les économies couvrent les dépassements (chacun à proportion de sa taille), le reste des dépassements
// reste dans la dette ; les économies sortent du total (seule leur part utilisée est retenue, dans absorbed)
function amortize(items: DebtItem[]): Amortization {
  const overs = items.filter((i) => i.kind === 'depassement');
  const unders = items.filter((i) => i.kind === 'economie');
  const over = overs.reduce((s, i) => s + i.amount, 0);
  const surplus = -unders.reduce((s, i) => s + i.amount, 0);
  const covered = Math.min(over, surplus);
  const used = new Map<string, number>();
  for (const i of overs) {
    const absorbed = over > 0 ? round((i.amount * covered) / over) : 0;
    i.absorbed = absorbed;
    i.amount = round(i.amount - absorbed);
    i.ignored = false;
    if (absorbed > 0) i.label += ` (amorti de ${absorbed.toFixed(2).replace('.', ',')} €)`;
  }
  for (const i of unders) {
    const part = surplus > 0 ? round((-i.amount * covered) / surplus) : 0;
    i.absorbed = part;
    if (i.target) used.set(i.target, part);
  }
  // Les économies ne remboursent plus la dette ; les dépassements entièrement couverts disparaissent
  const kept = items.filter((i) => i.kind !== 'economie' && !(i.kind === 'depassement' && i.amount === 0));
  items.splice(0, items.length, ...kept);
  return { over: round(over), surplus: round(surplus), covered: round(covered), used };
}

// Budgets d'un mois : grandes catégories limitées (le total de leurs sous-catégories), puis catégories limitées hors de
// celles-ci, avec ce qui y a été dépensé (byCategory : dépenses par catégorie, voir summarize)
export function budgetLinesOf(month: string, byCategory: Map<string, number>, budgets: Budget[], monthBudgets: MonthBudget[]) {
  const spentIn = (id: string) => byCategory.get(id) ?? 0;
  const limits = monthLimits(month, budgets, monthBudgets);
  const limitedGroups = categoryGroups()
    .filter((g) => g.kind === 'expense' && !g.virtual)
    .map((g) => ({ g, limit: limits.group(g.id) }))
    .filter((x): x is { g: (typeof x)['g']; limit: number } => x.limit !== null);
  const budgetLines = [
    ...limitedGroups.map(({ g, limit }) => ({
      target: groupTarget(g.id),
      label: g.label,
      limit,
      spent: groupMembers(g.id)
        .filter((c) => c.id !== SELF_DEBT_ID && !c.annual)
        .reduce((s, c) => s + spentIn(c.id), 0)
    })),
    ...limits.categories
      .map(({ category, limit }) => ({ cat: categoryById(category), category, limit }))
      .filter(({ cat, category }) => cat.id === category && cat.id !== SELF_DEBT_ID && !cat.annual && !limitedGroups.some(({ g }) => g.id === cat.group))
      .map(({ cat, limit }) => ({ target: cat.id, label: cat.label, limit, spent: spentIn(cat.id) }))
  ];
  return budgetLines;
}

// Suite de debtOfMonth : dépenses annuelles et remboursements, puis total du mois
function finishDebt(
  month: string,
  items: DebtItem[],
  allowed: number,
  spent: number,
  spentIn: (id: string) => number,
  planned: PlannedExpense[],
  monthBudgets: MonthBudget[]
): Omit<DebtMonth, 'amortization'> {
  // Dépenses annuelles : un douzième par mois depuis leur création
  for (const p of activePlans(planned, month)) {
    const share = p.amount / 12;
    const target = annualCategoryId(p.id);
    const paid = spentIn(target);
    const ignored = !countedIn(month, target, monthBudgets);
    allowed += share;
    spent += paid;
    const missing = round(share - paid);
    if (missing > 0)
      items.push({ label: paid > 0 ? `${p.label} : part incomplète` : `${p.label} : part non vue dans le relevé`, amount: missing, kind: 'annuelle', target, ignored });
    else if (missing < 0) items.push({ label: `${p.label} : payé au-delà de la part`, amount: missing, kind: 'remboursement', target, ignored });
  }

  // Opérations classées dans « Dette à moi-même »
  const repaid = round(spentIn(SELF_DEBT_ID));
  if (repaid !== 0) items.push({ label: 'Remboursements à moi-même', amount: -repaid, kind: 'remboursement' });

  const delta = round(items.reduce((s, i) => s + (i.ignored ? 0 : i.amount), 0));
  return { month, items, delta, allowed: round(allowed), spent: round(spent) };
}

// Mois à partir duquel la dette est suivie : le premier relevé importé (firstMonth), ou la première dépense annuelle
// créée si elle est plus ancienne
export function debtStart(planned: PlannedExpense[], firstMonth: string | null) {
  return [firstMonth, ...planned.map(plannedFrom)].filter((m): m is string => !!m).sort()[0] ?? null;
}

// Historique de la dette : chaque mois terminé qui a des opérations (relevé importé), du début du suivi au mois
// précédent, avec la dette cumulée à sa fin ; et le mois en cours à part, provisoire (pas encore ajouté au total)
export function debtHistory(
  start: string | null,
  currentMonth: string,
  transactions: Transaction[],
  budgets: Budget[],
  planned: PlannedExpense[],
  monthBudgets: MonthBudget[] = []
) {
  const months: (DebtMonth & { total: number })[] = [];
  let total = 0;
  if (start) {
    const byMonth = new Map<string, Transaction[]>();
    for (const t of transactions) byMonth.set(monthOf(t.date), [...(byMonth.get(monthOf(t.date)) ?? []), t]);
    for (let m = start; m < currentMonth; m = shiftMonth(m, 1)) {
      const monthTx = byMonth.get(m);
      if (!monthTx?.length) continue;
      const d = debtOfMonth(m, monthTx, budgets, planned, monthBudgets);
      total = round(total + d.delta);
      months.push({ ...d, total });
    }
  }
  const currentTx = transactions.filter((t) => monthOf(t.date) === currentMonth);
  const current = start && start <= currentMonth && currentTx.length ? debtOfMonth(currentMonth, currentTx, budgets, planned, monthBudgets) : null;
  return { start, months, total, current };
}
