'use client';

import { formatEuros } from '@/lib/finance';
import { useCategoryLimits, useDebtCategories, useMonthBudgets } from '@/lib/financeQueries';
import { debtOfMonth } from '@/lib/selfDebt';
import { annualPlans, categoryById, lastDayOf, monthOf, summarize, type Transaction } from '@/lib/transactions';
import { FIN, Panel } from '@/components/finance/FinanceParts';

const percent = (n: number) => `${Math.round(n * 100)} %`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEuros(Math.abs(n))}`;

// Petit chiffre clé : intitulé, valeur, précision
function Figure({ label, value, note, color = FIN.navy }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <div className="rounded-sm border px-2 py-2 text-center" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <p className="text-[8px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-bold" style={{ color }}>
        {value}
      </p>
      {note && (
        <p className="text-[9px] leading-tight" style={{ color: FIN.slate }}>
          {note}
        </p>
      )}
    </div>
  );
}

// « En bref » du Budget : les chiffres clés du mois affiché, comparés aux mois précédents quand ils sont connus.
// Les sorties sont comparées à la moyenne des 6 mois précédents, sans les créances (prêts aux proches et leurs
// remboursements, catégories reliées aux lignes de créances du bilan) ni la dette à moi-même.
// "transactions" : opérations du mois affiché et des mois d'avant ; "fixed" : total des dépenses fixes du mois.
export function KeyFigures({
  period,
  currentMonth,
  transactions,
  fixed
}: {
  period: string;
  currentMonth: string | null;
  transactions: Transaction[];
  fixed: number;
}) {
  const budgets = useCategoryLimits().data;
  const monthBudgets = useMonthBudgets().data;
  const monthTx = transactions.filter((t) => monthOf(t.date) === period);
  const { income, expenses } = summarize(monthTx);

  // Catégories laissées hors des sorties : créances et dettes (Finances > Gestion, lignes reliées) et la dette à moi-même
  const debtCategories = useDebtCategories();
  const excluded = new Set(['dette_moi', ...debtCategories]);
  const outflows = (list: Transaction[]) => summarize(list.filter((t) => !excluded.has(t.category))).expenses;
  const spent = outflows(monthTx);
  // Dépenses fixes sans les catégories laissées de côté (la dette à moi-même est rangée dans les fixes)
  const fixedSpent = Math.max(
    0,
    fixed - monthTx.filter((t) => t.amount < 0 && excluded.has(t.category) && categoryById(t.category).kind === 'fixed').reduce((s, t) => s - t.amount, 0)
  );
  const sixMonths = [...new Set(transactions.map((t) => monthOf(t.date)))]
    .filter((m) => m < period)
    .sort()
    .slice(-6)
    .map((m) => outflows(transactions.filter((t) => monthOf(t.date) === m)));
  const avgSpent = sixMonths.length ? sixMonths.reduce((a, b) => a + b, 0) / sixMonths.length : null;

  // Moyennes des 3 mois précédents qui ont des opérations
  const previous = [...new Set(transactions.map((t) => monthOf(t.date)))]
    .filter((m) => m < period)
    .sort()
    .slice(-3)
    .map((m) => summarize(transactions.filter((t) => monthOf(t.date) === m)));
  const previousRates = previous.filter((p) => p.income > 0).map((p) => (p.income - p.expenses) / p.income);
  const avgRate = previousRates.length ? previousRates.reduce((s, r) => s + r, 0) / previousRates.length : null;

  const rate = income > 0 ? (income - expenses) / income : null;
  const debt = budgets && monthBudgets ? debtOfMonth(period, monthTx, budgets, annualPlans(), monthBudgets) : null;
  // Mois en cours : dépense par jour écoulé
  const days = period === currentMonth ? new Date().getDate() : Number(lastDayOf(period).slice(8));

  return (
    <Panel title="En bref">
      <div className="grid grid-cols-3 gap-1.5">
        <Figure
          label="Épargne"
          value={rate === null ? '—' : percent(rate)}
          note={avgRate === null ? 'des entrées' : `moy. ${percent(avgRate)}`}
          color={rate === null ? FIN.slate : rate >= 0.1 ? FIN.sage : rate >= 0 ? FIN.gold : FIN.rose}
        />
        <Figure
          label="Dette à moi"
          value={!debt || debt.allowed === 0 ? '—' : signed(debt.delta)}
          note={!debt || debt.allowed === 0 ? 'aucune limite' : debt.delta > 0 ? 'ajoutée ce mois' : debt.delta < 0 ? 'remboursée' : 'inchangée'}
          color={!debt || debt.delta === 0 ? FIN.slate : debt.delta > 0 ? FIN.rose : FIN.sage}
        />
        <Figure
          label="Budget utilisé"
          value={!debt || debt.allowed === 0 ? '—' : percent(debt.spent / debt.allowed)}
          note={debt && debt.allowed > 0 ? `${formatEuros(debt.spent)} / ${formatEuros(debt.allowed)}` : undefined}
          color={!debt || debt.allowed === 0 ? FIN.slate : debt.spent > debt.allowed ? FIN.rose : debt.spent >= debt.allowed * 0.8 ? FIN.gold : FIN.sage}
        />
        <Figure
          label="Sorties"
          value={avgSpent ? `${spent >= avgSpent ? '+' : '−'}${percent(Math.abs(spent - avgSpent) / avgSpent)}` : formatEuros(spent)}
          note={avgSpent ? `vs moy. 6 mois ${formatEuros(avgSpent)}` : 'ce mois'}
          color={!avgSpent ? FIN.navy : spent > avgSpent ? FIN.rose : FIN.sage}
        />
        <Figure label="Par jour" value={formatEuros(spent / days)} note="de sorties" />
        <Figure label="Fixes" value={spent > 0 ? percent(fixedSpent / spent) : '—'} note={`${formatEuros(fixedSpent)} des sorties`} />
      </div>
    </Panel>
  );
}
