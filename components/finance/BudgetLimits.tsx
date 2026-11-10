'use client';

import { useState } from 'react';
import { formatEuros } from '@/lib/finance';
import { useCategoryLimits } from '@/lib/financeQueries';
import { debtOfMonth, plannedFrom } from '@/lib/selfDebt';
import {
  annualCategoryId,
  annualPlans,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  groupMembers,
  isLockedCategory,
  saveBudget,
  SELF_DEBT_ID,
  summarize,
  updateCategoryGroup,
  type Category,
  type CategoryGroup,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { orThrow, useCached } from '@/lib/cache';
import { fetchShoppingCategories } from '@/lib/budget';
import { FIN, Meter, NumberField, Panel } from '@/components/finance/FinanceParts';

// Page Budget, pour le mois affiché : ce que le relevé dit qui a été dépensé, par grande catégorie et par catégorie,
// face aux limites (barre de progression, dépassement et de combien). Les dépenses annuelles ont pour limite un douzième
// de leur montant. onCategoriesChanged : une limite de grande catégorie a changé.
export function BudgetLimits({
  period,
  monthTx,
  onError,
  onCategoriesChanged
}: {
  period: string;
  monthTx: Transaction[];
  onError: (message: string) => void;
  onCategoriesChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null); // catégorie (ou « groupe:id ») dont on modifie la limite
  const budgetsQuery = useCategoryLimits();
  const budgets = budgetsQuery.data ?? [];
  // Catégories reliées aux budgets de courses (Paramètres > Budgets) : leur limite en découle, elle ne se fixe pas ici
  const shoppingQuery = useCached('finances:categories-courses', async () => {
    const { categories, error } = await fetchShoppingCategories();
    return orThrow(categories, error);
  });
  const fromShopping = (c: Category) => (shoppingQuery.data ?? []).includes(c.id);
  const { byCategory } = summarize(monthTx);

  function report(err: { message: string } | null) {
    if (err) onError(describeDbError(err.message));
  }

  // Dépenses annuelles comptées ce mois-ci (créées ce mois ou avant) : leur limite est un douzième de leur montant
  const plans = annualPlans();
  const activePlans = plans.filter((p) => plannedFrom(p) <= period);
  const annualShare = new Map(activePlans.map((p) => [annualCategoryId(p.id), p.amount / 12]));
  const limitOf = (c: Category) => (c.annual ? (annualShare.get(c.id) ?? null) : (budgets.find((b) => b.category === c.id)?.monthly_limit ?? null));
  const debt = debtOfMonth(period, monthTx, budgets, plans);

  // Catégories de dépenses du mois, plus celles qui ont une limite
  const expenseCategories = CATEGORIES.filter((c) => c.kind !== 'income' && c.kind !== 'transfer')
    .map((c) => ({ cat: c, spent: byCategory.get(c.id) ?? 0, limit: limitOf(c) }))
    .filter((r) => r.spent > 0 || r.limit !== null)
    .sort((a, b) => b.spent - a.spent);
  // Grandes catégories de sorties : total dépensé dans leurs sous-catégories, comparé à leur limite
  const expenseGroups = categoryGroups()
    .filter((g) => g.kind === 'expense')
    .map((group) => ({
      // « Dépenses annuelles » : limite = somme des parts des dépenses annuelles comptées ce mois-ci
      group: group.virtual ? { ...group, monthly_limit: activePlans.length ? activePlans.reduce((s, p) => s + p.amount / 12, 0) : null } : group,
      spent: groupMembers(group.id).reduce((sum, c) => sum + (byCategory.get(c.id) ?? 0), 0),
      rows: expenseCategories.filter((r) => r.cat.group === group.id)
    }))
    .filter((g) => g.spent > 0 || g.group.monthly_limit !== null || g.rows.length > 0)
    .sort((a, b) => b.spent - a.spent);
  const looseRows = expenseCategories.filter((r) => !r.cat.group || !expenseGroups.some((g) => g.group.id === r.cat.group));
  const unbudgeted = CATEGORIES.filter((c) => c.kind !== 'income' && c.kind !== 'transfer' && !isLockedCategory(c) && !fromShopping(c) && !budgets.some((b) => b.category === c.id)).sort(byLabel);

  // Limite mensuelle d'une grande catégorie (null : pas de limite)
  async function setGroupLimit(group: CategoryGroup, limit: number | null) {
    setEditing(null);
    report(await updateCategoryGroup(group.id, { monthly_limit: limit }));
    onCategoriesChanged();
  }

  async function setLimit(category: string, limit: number | null) {
    budgetsQuery.setData((bs) => [...bs.filter((b) => b.category !== category), ...(limit ? [{ category, monthly_limit: limit }] : [])]);
    setEditing(null);
    report(await saveBudget(category, limit));
  }

  const colorOf = (spent: number, limit: number | null) => {
    const ratio = limit ? spent / limit : 0;
    return { ratio, color: !limit ? FIN.slate : ratio >= 1 ? FIN.rose : ratio >= 0.8 ? FIN.gold : FIN.sage };
  };
  const warning = (spent: number, limit: number, ratio: number, color: string) =>
    ratio >= 0.8 && (
      <p className="mt-0.5 text-[10px]" style={{ color }}>
        {ratio >= 1 ? `Limite dépassée de ${formatEuros(spent - limit)}.` : `Plus que ${formatEuros(limit - spent)} avant la limite.`}
      </p>
    );

  function limitRow({ cat, spent, limit }: { cat: Category; spent: number; limit: number | null }) {
    const { ratio, color } = colorOf(spent, limit);
    return (
      <li key={cat.id}>
        <div className="flex items-baseline justify-between gap-2 text-[12px]">
          <span>{cat.label}</span>
          {cat.annual || cat.id === SELF_DEBT_ID || fromShopping(cat) ? (
            // Dépense annuelle (sa limite vient de son montant), dette à moi-même, ou catégorie des budgets de courses
            // (sa limite est la somme de ces budgets) : pas de limite à fixer ici
            <span className="text-right" style={{ color }}>
              {formatEuros(spent)}
              {limit !== null && <span style={{ color: FIN.slate }}>{` / ${formatEuros(limit)}`}</span>}
              {fromShopping(cat) && (
                <span className="block text-[9px]" style={{ color: FIN.slate }}>
                  fixée par tes budgets de courses
                </span>
              )}
            </span>
          ) : (
            <button type="button" onClick={() => setEditing(editing === cat.id ? null : cat.id)} className="text-right" style={{ color }}>
              {formatEuros(spent)}
              <span style={{ color: FIN.slate }}>{limit ? ` / ${formatEuros(limit)}` : ' · fixer une limite'}</span>
            </button>
          )}
        </div>
        {limit !== null && <Meter value={ratio} color={color} />}
        {limit !== null && warning(spent, limit, ratio, color)}
        {editing === cat.id && (
          <div className="mt-1 flex items-end gap-2">
            <NumberField label="Limite mensuelle" value={limit} onChange={(n) => setLimit(cat.id, n)} />
            {limit !== null && (
              <button type="button" onClick={() => setLimit(cat.id, null)} className="pb-1 text-[10px] underline" style={{ color: FIN.rose }}>
                Retirer
              </button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
      <Panel
        collapsible
        title="Budget du mois"
        subtitle={`${debt.allowed > 0 ? `${formatEuros(debt.spent)} dépensés sur ${formatEuros(debt.allowed)} prévus (limites et parts des dépenses annuelles). ` : ''}Touche un montant pour fixer sa limite : la barre passe à l'orange à 80 %, au rouge en cas de dépassement.`}
      >
        <ul className="space-y-3">
          {expenseGroups.map(({ group, spent, rows }) => {
            const limit = group.monthly_limit;
            const { ratio, color } = colorOf(spent, limit);
            const key = `groupe:${group.id}`;
            return (
              <li key={group.id}>
                <div className="flex items-baseline justify-between gap-2 text-[12px] font-bold uppercase tracking-[0.05em]">
                  <span>{group.label}</span>
                  <button
                    type="button"
                    disabled={group.virtual}
                    onClick={() => setEditing(editing === key ? null : key)}
                    className="text-right normal-case tracking-normal"
                    style={{ color }}
                  >
                    {formatEuros(spent)}
                    <span className="font-normal" style={{ color: FIN.slate }}>
                      {limit ? ` / ${formatEuros(limit)}` : ' · fixer une limite'}
                    </span>
                  </button>
                </div>
                {limit !== null && <Meter value={ratio} color={color} />}
                {limit !== null && warning(spent, limit, ratio, color)}
                {editing === key && (
                  <div className="mt-1 flex items-end gap-2">
                    <NumberField label={`Limite mensuelle · ${group.label}`} value={limit} onChange={(n) => setGroupLimit(group, n)} />
                    {limit !== null && (
                      <button type="button" onClick={() => setGroupLimit(group, null)} className="pb-1 text-[10px] underline" style={{ color: FIN.rose }}>
                        Retirer
                      </button>
                    )}
                  </div>
                )}
                {rows.length > 0 && (
                  <ul className="mt-2 space-y-2 border-l pl-3" style={{ borderColor: FIN.line }}>
                    {rows.map(limitRow)}
                  </ul>
                )}
              </li>
            );
          })}
          {looseRows.map(limitRow)}
        </ul>
        {unbudgeted.length > 0 && (
          <select value="" onChange={(e) => e.target.value && setEditing(e.target.value)} className="fin-select mt-3 w-full py-1.5 pl-2 text-[11px]" style={{ color: FIN.slate }}>
            <option value="">+ Limite pour une autre catégorie…</option>
            {unbudgeted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        {editing && !editing.startsWith('groupe:') && !expenseCategories.some((r) => r.cat.id === editing) && (
          <div className="mt-2">
            <NumberField label={`Limite · ${categoryById(editing).label}`} value={null} onChange={(n) => setLimit(editing, n)} />
          </div>
        )}
      </Panel>
  );
}
