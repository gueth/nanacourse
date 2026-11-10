'use client';

import { useMemo, useState } from 'react';
import { orThrow, useCached } from '@/lib/cache';
import { byPeriod, formatEuros, liquidAssets, monthLabel } from '@/lib/finance';
import { useCategoryLimits, useFinanceLines, useMonthBudgets } from '@/lib/financeQueries';
import { debtHistory, debtStart, type DebtMonth } from '@/lib/selfDebt';
import { annualPlans, fetchTransactions, lastDayOf } from '@/lib/transactions';
import { FIN, Panel } from '@/components/finance/FinanceParts';

// Page Gestion : dette à moi-même cumulée depuis la première dépense annuelle, ce qui la compose mois par mois,
// et l'argent en compte une fois cette dette retirée. "ready" : catégories chargées (dont les dépenses annuelles).
export function SelfDebtPanel({ currentMonth, ready }: { currentMonth: string | null; ready: boolean }) {
  const plans = ready ? annualPlans() : [];
  const start = debtStart(plans);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  // Opérations depuis le début du suivi (toutes, pour cumuler la dette)
  const txQuery = useCached(ready && start && currentMonth ? `finances:dette-moi:${start}:${currentMonth}` : null, async () => {
    const { transactions, error } = await fetchTransactions(`${start}-01`, lastDayOf(currentMonth!));
    return orThrow(transactions, error);
  });
  const budgets = useCategoryLimits().data;
  const monthBudgets = useMonthBudgets().data;
  // Argent en compte : liquidités du dernier bilan rempli
  const lines = useFinanceLines(currentMonth, 13).data;
  const cash = useMemo(() => {
    const months = [...byPeriod(lines ?? []).entries()].filter(([, l]) => l.some((x) => x.section === 'liquidites' && x.amount !== 0));
    const last = months.sort((a, b) => b[0].localeCompare(a[0]))[0];
    return last ? { month: last[0], amount: liquidAssets(last[1]) } : null;
  }, [lines]);
  const history =
    currentMonth && txQuery.data && budgets && monthBudgets ? debtHistory(currentMonth, txQuery.data, budgets, plans, monthBudgets) : null;

  if (!ready) return null;
  if (!start)
    return (
      <Panel title="Dette à moi-même" subtitle="Elle se suit à partir de ta première dépense annuelle : ajoute-en une plus bas.">
        {null}
      </Panel>
    );

  // Dette totale, signée : positive, tu te dois cet argent ; négative, tu es en avance sur ton budget
  const total = history?.total ?? 0;
  const signed = (n: number) => `${n > 0 ? '+ ' : n < 0 ? '− ' : ''}${formatEuros(Math.abs(n))}`;
  // Une avance ne s'ajoute pas à l'argent en compte : elle y est déjà
  const mine = cash ? cash.amount - Math.max(0, total) : null;
  return (
    <Panel
      title="Dette à moi-même"
      subtitle={`Ce que tu te dois depuis ${monthLabel(start)} : parts des dépenses annuelles qu'on ne retrouve pas dans tes relevés et dépassements de budget, moins ce que tu as dépensé en dessous des limites. Négative, tu es en avance.`}
    >
      {!history ? (
        <p className="text-[11px] italic" style={{ color: FIN.slate }}>
          Calcul…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: cash ? `En compte (${monthLabel(cash.month)})` : 'En compte', value: cash ? formatEuros(cash.amount) : '—', color: FIN.navy },
              { label: total < 0 ? 'Dette à moi-même · en avance' : 'Dette à moi-même', value: signed(total), color: total > 0 ? FIN.rose : FIN.sage },
              { label: 'Vraiment à moi', value: mine !== null ? formatEuros(mine) : '—', color: mine !== null && mine < 0 ? FIN.rose : FIN.sage }
            ].map((t) => (
              <div key={t.label} className="rounded-sm border px-1 py-2" style={{ borderColor: FIN.line }}>
                <p className="text-[8px] uppercase leading-tight tracking-[0.15em]" style={{ color: FIN.slate }}>
                  {t.label}
                </p>
                <p className="mt-1 text-[13px] font-bold" style={{ color: t.color }}>
                  {t.value}
                </p>
              </div>
            ))}
          </div>
          {!cash && (
            <p className="mt-1 text-[10px]" style={{ color: FIN.slate }}>
              Remplis tes liquidités dans le Bilan (en important un relevé) pour voir ce qui est vraiment à toi.
            </p>
          )}

          {/* Mois par mois : ce qui a ajouté à la dette ou l'a remboursée */}
          <ul className="mt-3 divide-y text-[12px]" style={{ borderColor: FIN.line }}>
            {history.current && (
              <DebtMonthRow
                debt={history.current}
                note="en cours, pas encore compté"
                open={openMonth === history.current.month}
                onToggle={() => setOpenMonth(openMonth === history.current!.month ? null : history.current!.month)}
              />
            )}
            {[...history.months].reverse().map((m) => (
              <DebtMonthRow
                key={m.month}
                debt={m}
                note={`dette à la fin du mois : ${signed(m.total)}`}
                open={openMonth === m.month}
                onToggle={() => setOpenMonth(openMonth === m.month ? null : m.month)}
              />
            ))}
          </ul>
          {history.months.length === 0 && !history.current && (
            <p className="mt-2 text-[11px] italic" style={{ color: FIN.slate }}>
              Aucun relevé importé depuis {monthLabel(start)}.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// Un mois de l'historique : ce qu'il ajoute ou retire, et son détail en le touchant
function DebtMonthRow({ debt, note, open, onToggle }: { debt: DebtMonth; note: string; open: boolean; onToggle: () => void }) {
  return (
    <li className="py-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-baseline justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="capitalize">{monthLabel(debt.month)}</span>
          <span className="block text-[10px]" style={{ color: FIN.slate }}>
            {note}
          </span>
        </span>
        <b className="shrink-0" style={{ color: debt.delta > 0 ? FIN.rose : FIN.sage }}>
          {debt.delta > 0 ? '+' : debt.delta < 0 ? '−' : ''} {formatEuros(Math.abs(debt.delta))}
        </b>
      </button>
      {open && (
        <div className="mt-2 rounded-sm px-3 py-2" style={{ backgroundColor: FIN.mist }}>
          <DebtItems debt={debt} />
        </div>
      )}
    </li>
  );
}

// Ce qui compose la dette à moi-même d'un mois : parts annuelles non vues, dépassements (ajoutés, en rose),
// économies et remboursements (retirés, en vert), puis le solde du mois
export function DebtItems({ debt }: { debt: DebtMonth }) {
  if (debt.items.length === 0)
    return (
      <p className="text-[11px] italic" style={{ color: FIN.slate }}>
        Rien à signaler ce mois-ci.
      </p>
    );
  return (
    <>
      <ul className="space-y-1 text-[12px]">
        {[...debt.items]
          .sort((a, b) => b.amount - a.amount)
          .map((i) => (
            <li key={`${i.kind}:${i.label}`} className="flex items-baseline justify-between gap-2" style={i.ignored ? { opacity: 0.55 } : undefined}>
              <span className="min-w-0 break-words">
                {i.label}
                {i.ignored && <span style={{ color: FIN.slate }}> · non compté</span>}
              </span>
              <b className="shrink-0" style={{ color: i.ignored ? FIN.slate : i.amount > 0 ? FIN.rose : FIN.sage, textDecoration: i.ignored ? 'line-through' : undefined }}>
                {i.amount > 0 ? '+' : '−'} {formatEuros(Math.abs(i.amount))}
              </b>
            </li>
          ))}
      </ul>
      <p className="mt-2 flex items-baseline justify-between gap-2 border-t pt-2 text-[12px] font-bold" style={{ borderColor: FIN.line }}>
        <span>{debt.delta >= 0 ? 'Ajouté à la dette' : 'Remboursé'}</span>
        <span style={{ color: debt.delta > 0 ? FIN.rose : FIN.sage }}>{formatEuros(Math.abs(debt.delta))}</span>
      </p>
    </>
  );
}
