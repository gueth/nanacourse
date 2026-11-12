'use client';

import { useMemo } from 'react';
import { formatEuros, shiftMonth } from '@/lib/finance';
import { useCached, orThrow } from '@/lib/cache';
import { useDebtCategories } from '@/lib/financeQueries';
import { fetchTransactions, loadCategories, monthOf, summarize, type Transaction } from '@/lib/transactions';
import { FIN, SummaryTile } from '@/components/finance/FinanceParts';

// Opérations chargées pour un mois : une fenêtre de 13 mois (le mois et les 12 d'avant), gardée en mémoire (lib/cache)
// et partagée entre le Budget et le compte de résultat du Bilan
export type TxWindow = { from: string; to: string; list: Transaction[] };
export const TX_PREFIX = 'finances:operations:';
export const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
export async function fetchTxWindow(period: string): Promise<TxWindow> {
  const from = shiftMonth(period, -12);
  const { transactions, error } = await fetchTransactions(`${from}-01`, lastDay(period));
  return { from, to: period, list: orThrow(transactions, error) };
}

// Entrées, sorties et reste du mois. Sans les opérations qui vont au bilan (connecteurs vers créances, emprunts ou dettes) : ce ne sont ni des revenus ni des dépenses.
// Affiché sous l'onglet « Compte de résultat » du Bilan.
export function MonthCashSummary({ period }: { period: string }) {
  const txQuery = useCached<TxWindow>(`${TX_PREFIX}${period}`, () => fetchTxWindow(period));
  // Catégories (fixes, variables...) rangées dans CATEGORIES : elles doivent être chargées avant le calcul
  const categoriesQuery = useCached('finances:categories', async () => orThrow(Date.now(), await loadCategories()));
  const isDebtTx = useDebtCategories();
  const ready = !!txQuery.data && categoriesQuery.data !== undefined;

  const monthTx = useMemo(
    () => (ready ? txQuery.data!.list : []).filter((t) => !isDebtTx(t) && monthOf(t.date) === period),
    [ready, txQuery.data, isDebtTx, period]
  );

  // En attendant les opérations : les mêmes cases, vides (une barre à la place des montants), pour qu'aucun bloc
  // n'apparaisse d'un coup une fois le chargement fini
  const summary = ready ? summarize(monthTx) : null;
  const has = !!summary && monthTx.length > 0;
  const euros = (n: number) => (has ? formatEuros(n) : '—');
  const rest = summary ? summary.income - summary.expenses : 0;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Entrées" note="revenus" value={euros(summary?.income ?? 0)} color={has ? FIN.sage : FIN.slate} />
        <SummaryTile label="Sorties" note="dépenses" value={euros(summary?.expenses ?? 0)} color={has ? FIN.rose : FIN.slate} />
        <SummaryTile label="Reste" note="résultat" value={euros(rest)} color={!has ? FIN.slate : rest >= 0 ? FIN.navy : FIN.rose} />
      </div>
    </div>
  );
}
