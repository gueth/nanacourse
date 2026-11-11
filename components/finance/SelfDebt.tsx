'use client';

import { useMemo, useState } from 'react';
import { orThrow, useCached } from '@/lib/cache';
import { byPeriod, formatEuros, liquidAssets, monthLabel } from '@/lib/finance';
import { useCategoryLimits, useDebtCategories, useFinanceLines, useMonthBudgets } from '@/lib/financeQueries';
import { debtHistory, debtStart, type DebtMonth } from '@/lib/selfDebt';
import { annualPlans, fetchFirstTransactionMonth, fetchTransactions, lastDayOf } from '@/lib/transactions';
import { FIN, Panel } from '@/components/finance/FinanceParts';

// Page Gestion : dette à moi-même cumulée depuis le premier relevé importé (ou la première dépense annuelle si elle est
// plus ancienne) : les dettes collectées chaque mois (dépassements, parts annuelles non vues), moins les excédents
// (dépenses sous les limites, remboursements). Puis ce qui la compose mois par mois, et l'argent en compte une fois
// cette dette retirée. "ready" : catégories chargées (dont les dépenses annuelles).
export function SelfDebtPanel({ currentMonth, ready }: { currentMonth: string | null; ready: boolean }) {
  const plans = ready ? annualPlans() : [];
  const firstQuery = useCached(ready ? 'finances:premier-releve' : null, async () => {
    const { month, error } = await fetchFirstTransactionMonth();
    return orThrow(month, error);
  });
  const start = debtStart(plans, firstQuery.data ?? null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  // Opérations depuis le début du suivi (toutes, pour cumuler la dette)
  const txQuery = useCached(ready && start && currentMonth ? `finances:dette-moi:${start}:${currentMonth}` : null, async () => {
    const { transactions, error } = await fetchTransactions(`${start}-01`, lastDayOf(currentMonth!));
    return orThrow(transactions, error);
  });
  const budgets = useCategoryLimits().data;
  const monthBudgets = useMonthBudgets().data;
  // Sans les créances ni les dettes (prêts aux proches, emprunts et remboursements) : ni dépassement ni économie
  const debtCategories = useDebtCategories();
  // Argent en compte : liquidités du dernier bilan rempli
  const lines = useFinanceLines(currentMonth, 13).data;
  const cash = useMemo(() => {
    const months = [...byPeriod(lines ?? []).entries()].filter(([, l]) => l.some((x) => x.section === 'liquidites' && x.amount !== 0));
    const last = months.sort((a, b) => b[0].localeCompare(a[0]))[0];
    return last ? { month: last[0], amount: liquidAssets(last[1]) } : null;
  }, [lines]);
  const history =
    currentMonth && txQuery.data && budgets && monthBudgets
      ? debtHistory(start, currentMonth, txQuery.data.filter((t) => !debtCategories.has(t.category)), budgets, plans, monthBudgets)
      : null;

  if (!ready || firstQuery.data === undefined) return null;
  if (!start)
    return (
      <Panel title="Dette à moi-même" subtitle="Elle se suit dès ton premier relevé importé : importe-en un plus bas.">
        {null}
      </Panel>
    );

  // Dettes collectées chaque mois (ajouts) et excédents (retraits), mois en cours compris, sans les lignes « non comptées »
  const allMonths = [...(history?.months ?? []), ...(history?.current ? [history.current] : [])];
  const counted = allMonths.flatMap((m) => m.items.filter((i) => !i.ignored));
  const collected = Math.round(counted.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const surplus = Math.round(counted.filter((i) => i.amount < 0).reduce((s, i) => s - i.amount, 0) * 100) / 100;

  // Dette totale, signée : positive, tu te dois cet argent ; négative, tu es en avance sur ton budget.
  // Elle comprend le mois en cours, pour que chaque choix « Oui / Non » du Budget s'y voie tout de suite
  const total = Math.round(((history?.total ?? 0) + (history?.current?.delta ?? 0)) * 100) / 100;
  const signed = (n: number) => `${n > 0 ? '+ ' : n < 0 ? '− ' : ''}${formatEuros(Math.abs(n))}`;
  // Une avance ne s'ajoute pas à l'argent en compte : elle y est déjà
  const mine = cash ? cash.amount - Math.max(0, total) : null;
  // Les trois grands chiffres restent visibles même panneau replié
  const figures = !history ? (
    <span className="block text-[11px] italic" style={{ color: FIN.slate }}>
      Calcul…
    </span>
  ) : (
    <span className="grid grid-cols-3 gap-2 text-center">
      {[
        { label: cash ? `En compte (${monthLabel(cash.month)})` : 'En compte', value: cash ? formatEuros(cash.amount) : '—', color: FIN.navy },
        { label: total < 0 ? 'Dette à moi-même · en avance' : 'Dette à moi-même', value: signed(total), color: total > 0 ? FIN.rose : FIN.sage },
        { label: 'Vraiment à moi', value: mine !== null ? formatEuros(mine) : '—', color: mine !== null && mine < 0 ? FIN.rose : FIN.sage }
      ].map((t) => (
        <span key={t.label} className="block rounded-sm border px-1 py-2" style={{ borderColor: FIN.line }}>
          <span className="block text-[8px] uppercase leading-tight tracking-[0.15em]" style={{ color: FIN.slate }}>
            {t.label}
          </span>
          <span className="mt-1 block text-[13px] font-bold" style={{ color: t.color }}>
            {t.value}
          </span>
        </span>
      ))}
    </span>
  );
  return (
    <Panel collapsible title="Dette à moi-même" preview={figures}>
      {history && (
        <>
          {/* Dette totale : dettes collectées mois après mois, moins les excédents */}
          <div className="mt-1 space-y-1 rounded-sm px-3 py-2 text-[12px]" style={{ backgroundColor: FIN.mist }}>
            <p className="flex items-baseline justify-between gap-2">
              <span>Dettes collectées chaque mois</span>
              <b style={{ color: FIN.rose }}>+ {formatEuros(collected)}</b>
            </p>
            <p className="flex items-baseline justify-between gap-2">
              <span>Excédents</span>
              <b style={{ color: FIN.sage }}>− {formatEuros(surplus)}</b>
            </p>
            <p className="flex items-baseline justify-between gap-2 border-t pt-1 font-bold" style={{ borderColor: FIN.line }}>
              <span>Dette à moi-même totale</span>
              <span style={{ color: total > 0 ? FIN.rose : FIN.sage }}>{signed(total)}</span>
            </p>
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
                note="en cours, compté au fil du mois"
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
