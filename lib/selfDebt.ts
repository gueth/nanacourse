import { shiftMonth } from '@/lib/finance';
import {
  annualCategoryId,
  categoryById,
  categoryGroups,
  groupMembers,
  monthOf,
  SELF_DEBT_ID,
  summarize,
  type Budget,
  type PlannedExpense,
  type Transaction
} from '@/lib/transactions';

// Dette à moi-même : ce que l'on se doit, mois après mois, pour tenir son budget.
//  - Dépenses annuelles : chaque mois depuis sa création, un douzième de chacune doit apparaître dans sa sous-catégorie
//    (« Dépenses annuelles ») ; la part qu'on ne retrouve pas dans les relevés du mois va dans la dette.
//    Payer plus que sa part (la facture de l'année, ou une mise de côté en avance) la rembourse d'autant.
//  - Budgets : dépasser la limite d'une grande catégorie ou d'une catégorie ajoute le dépassement à la dette ;
//    dépenser moins que prévu la rembourse de la différence.
//  - Les opérations classées dans « Dette à moi-même » la remboursent aussi.
// La dette s'accumule d'un mois sur l'autre, sans jamais descendre sous zéro. Son total, et ce qui la compose,
// s'affichent dans Finances > Gestion ; Finances > Budget montre celle du mois affiché.

export type DebtItemKind = 'annuelle' | 'depassement' | 'economie' | 'remboursement';
export type DebtItem = { label: string; amount: number; kind: DebtItemKind }; // amount > 0 : ajouté à la dette
export type DebtMonth = {
  month: string;
  items: DebtItem[];
  delta: number; // ce que le mois ajoute (> 0) ou retire (< 0) à la dette
  allowed: number; // ce qu'on pouvait dépenser dans le mois : limites des budgets + parts des dépenses annuelles
  spent: number; // ce qui a été dépensé dans ces mêmes catégories
};

const round = (n: number) => Math.round(n * 100) / 100;

// Une dépense annuelle compte à partir du mois de sa création
export const plannedFrom = (p: PlannedExpense) => (p.created_at ?? '').slice(0, 7);
const activePlans = (planned: PlannedExpense[], month: string) => planned.filter((p) => plannedFrom(p) <= month);

// Dette ajoutée (ou remboursée) par un mois, à partir de ses opérations
export function debtOfMonth(month: string, monthTx: Transaction[], budgets: Budget[], planned: PlannedExpense[]): DebtMonth {
  const { byCategory } = summarize(monthTx);
  const spentIn = (id: string) => byCategory.get(id) ?? 0;
  const items: DebtItem[] = [];
  let allowed = 0;
  let spent = 0;

  // Budgets : grandes catégories limitées (le total de leurs sous-catégories), puis catégories limitées hors de celles-ci
  const limitedGroups = categoryGroups().filter((g) => g.kind === 'expense' && !g.virtual && g.monthly_limit !== null);
  const budgetLines = [
    ...limitedGroups.map((g) => ({
      label: g.label,
      limit: g.monthly_limit!,
      spent: groupMembers(g.id)
        .filter((c) => c.id !== SELF_DEBT_ID && !c.annual)
        .reduce((s, c) => s + spentIn(c.id), 0)
    })),
    ...budgets
      .map((b) => ({ b, cat: categoryById(b.category) }))
      .filter(({ b, cat }) => cat.id === b.category && cat.id !== SELF_DEBT_ID && !cat.annual && !limitedGroups.some((g) => g.id === cat.group))
      .map(({ b, cat }) => ({ label: cat.label, limit: b.monthly_limit, spent: spentIn(cat.id) }))
  ];
  for (const line of budgetLines) {
    allowed += line.limit;
    spent += line.spent;
    const over = round(line.spent - line.limit);
    if (over > 0) items.push({ label: `${line.label} : dépassement`, amount: over, kind: 'depassement' });
    else if (over < 0) items.push({ label: `${line.label} : moins que prévu`, amount: over, kind: 'economie' });
  }

  // Dépenses annuelles : un douzième par mois depuis leur création
  for (const p of activePlans(planned, month)) {
    const share = p.amount / 12;
    const paid = spentIn(annualCategoryId(p.id));
    allowed += share;
    spent += paid;
    const missing = round(share - paid);
    if (missing > 0) items.push({ label: paid > 0 ? `${p.label} : part incomplète` : `${p.label} : part non vue dans le relevé`, amount: missing, kind: 'annuelle' });
    else if (missing < 0) items.push({ label: `${p.label} : payé au-delà de la part`, amount: missing, kind: 'remboursement' });
  }

  // Opérations classées dans « Dette à moi-même »
  const repaid = round(spentIn(SELF_DEBT_ID));
  if (repaid !== 0) items.push({ label: 'Remboursements à moi-même', amount: -repaid, kind: 'remboursement' });

  return { month, items, delta: round(items.reduce((s, i) => s + i.amount, 0)), allowed: round(allowed), spent: round(spent) };
}

// Mois à partir duquel la dette est suivie : celui de la première dépense annuelle créée
export function debtStart(planned: PlannedExpense[]) {
  return planned.map(plannedFrom).filter(Boolean).sort()[0] ?? null;
}

// Historique de la dette : chaque mois terminé qui a des opérations (relevé importé), du début du suivi au mois
// précédent, avec la dette cumulée à sa fin ; et le mois en cours à part, provisoire (pas encore ajouté au total)
export function debtHistory(currentMonth: string, transactions: Transaction[], budgets: Budget[], planned: PlannedExpense[]) {
  const start = debtStart(planned);
  const months: (DebtMonth & { total: number })[] = [];
  let total = 0;
  if (start) {
    const byMonth = new Map<string, Transaction[]>();
    for (const t of transactions) byMonth.set(monthOf(t.date), [...(byMonth.get(monthOf(t.date)) ?? []), t]);
    for (let m = start; m < currentMonth; m = shiftMonth(m, 1)) {
      const monthTx = byMonth.get(m);
      if (!monthTx?.length) continue;
      const d = debtOfMonth(m, monthTx, budgets, planned);
      total = round(Math.max(0, total + d.delta));
      months.push({ ...d, total });
    }
  }
  const currentTx = transactions.filter((t) => monthOf(t.date) === currentMonth);
  const current = start && start <= currentMonth && currentTx.length ? debtOfMonth(currentMonth, currentTx, budgets, planned) : null;
  return { start, months, total, current };
}
