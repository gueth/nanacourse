'use client';

import { useState } from 'react';
import { formatEuros, monthLabel } from '@/lib/finance';
import { useCategoryLimits, useMonthBudgets } from '@/lib/financeQueries';
import { debtOfMonth, monthLimits, plannedFrom } from '@/lib/selfDebt';
import {
  annualCategoryId,
  annualPlans,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  groupMembers,
  groupTarget,
  isLockedCategory,
  saveBudget,
  saveMonthBudget,
  SELF_DEBT_ID,
  summarize,
  updateCategoryGroup,
  type Category,
  type CategoryGroup,
  type MonthBudget,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { orThrow, useCached } from '@/lib/cache';
import { fetchShoppingCategories } from '@/lib/budget';
import { FIN, Meter, NumberField, Panel } from '@/components/finance/FinanceParts';

// Page Budget, pour le mois affiché : ce que le relevé dit qui a été dépensé, par grande catégorie et par catégorie,
// face aux limites (barre de progression, dépassement et de combien). Les dépenses annuelles ont pour limite un douzième
// de leur montant. onCategoriesChanged : une limite de grande catégorie a changé.
// Mois passé : ses limites lui sont propres (les changer ne touche que lui). Pour chaque dépassement ou économie,
// on choisit s'il compte dans la dette à moi-même de ce mois.
export function BudgetLimits({
  period,
  currentMonth,
  monthTx,
  onError,
  onCategoriesChanged
}: {
  period: string;
  currentMonth: string | null;
  monthTx: Transaction[];
  onError: (message: string) => void;
  onCategoriesChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null); // catégorie (ou « groupe:id ») dont on modifie la limite
  const budgetsQuery = useCategoryLimits();
  const budgets = budgetsQuery.data ?? [];
  const monthBudgetsQuery = useMonthBudgets();
  const monthBudgets = monthBudgetsQuery.data ?? [];
  const past = !!currentMonth && period < currentMonth;
  const limits = monthLimits(period, budgets, monthBudgets);
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
  const limitOf = (c: Category) => (c.annual ? (annualShare.get(c.id) ?? null) : limits.category(c.id));
  const debt = debtOfMonth(period, monthTx, budgets, plans, monthBudgets);

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
      group: {
        ...group,
        monthly_limit: group.virtual ? (activePlans.length ? activePlans.reduce((s, p) => s + p.amount / 12, 0) : null) : limits.group(group.id)
      },
      spent: groupMembers(group.id).reduce((sum, c) => sum + (byCategory.get(c.id) ?? 0), 0),
      rows: expenseCategories.filter((r) => r.cat.group === group.id)
    }))
    .filter((g) => g.spent > 0 || g.group.monthly_limit !== null || g.rows.length > 0)
    .sort((a, b) => b.spent - a.spent);
  const looseRows = expenseCategories.filter((r) => !r.cat.group || !expenseGroups.some((g) => g.group.id === r.cat.group));
  const unbudgeted = CATEGORIES.filter((c) => c.kind !== 'income' && c.kind !== 'transfer' && !isLockedCategory(c) && !fromShopping(c) && limits.category(c.id) === null).sort(byLabel);

  // Ligne propre au mois affiché (limite et/ou choix de compter dans la dette), modifiée tout de suite à l'écran
  async function saveForMonth(target: string, changes: Partial<Pick<MonthBudget, 'custom_limit' | 'monthly_limit' | 'counted'>>) {
    monthBudgetsQuery.setData((bs) => {
      const own = bs.find((b) => b.month === period && b.target === target);
      const row: MonthBudget = { month: period, target, custom_limit: false, monthly_limit: null, counted: true, ...own, ...changes };
      return [...bs.filter((b) => b !== own), row];
    });
    report(await saveMonthBudget(period, target, changes));
  }

  // Limite mensuelle d'une grande catégorie (null : pas de limite) : celle du mois passé affiché, ou la limite générale
  // (les mois passés gardent alors celle qu'ils avaient)
  async function setGroupLimit(group: CategoryGroup, limit: number | null) {
    setEditing(null);
    if (past) return saveForMonth(groupTarget(group.id), { custom_limit: true, monthly_limit: limit });
    report(await updateCategoryGroup(group.id, { monthly_limit: limit }));
    onCategoriesChanged();
    monthBudgetsQuery.reload();
  }

  async function setLimit(category: string, limit: number | null) {
    setEditing(null);
    if (past) return saveForMonth(category, { custom_limit: true, monthly_limit: limit });
    budgetsQuery.setData((bs) => [...bs.filter((b) => b.category !== category), ...(limit ? [{ category, monthly_limit: limit }] : [])]);
    report(await saveBudget(category, limit));
    monthBudgetsQuery.reload();
  }

  // Dépassement (ou économie) de cette ligne ce mois-ci : on demande s'il compte dans la dette à moi-même
  function debtQuestion(target: string) {
    const item = debt.items.find((i) => i.target === target);
    if (!item) return null;
    const choice = (counted: boolean, text: string) => {
      const on = counted === !item.ignored;
      return (
        <button
          type="button"
          aria-pressed={on}
          onClick={() => !on && saveForMonth(target, { counted })}
          className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.15em]"
          style={on ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper } : { borderColor: FIN.line, color: FIN.slate }}
        >
          {text}
        </button>
      );
    };
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]" style={{ color: FIN.slate }}>
        <span>
          {item.amount > 0
            ? `Compter ces ${formatEuros(item.amount)} dans la dette à moi-même ?`
            : `Retirer ces ${formatEuros(-item.amount)} de la dette à moi-même ?`}
        </span>
        {choice(true, 'Oui')}
        {choice(false, 'Non')}
      </div>
    );
  }

  // Comparaison au centime près : dépenser exactement la limite n'est pas un dépassement
  const cents = (n: number) => Math.round(n * 100);
  const colorOf = (spent: number, limit: number | null) => {
    const ratio = limit ? spent / limit : 0;
    const over = !!limit && cents(spent) > cents(limit);
    return { ratio, color: !limit ? FIN.slate : over ? FIN.rose : ratio >= 0.8 ? FIN.gold : FIN.sage };
  };
  const warning = (spent: number, limit: number, ratio: number, color: string) =>
    ratio >= 0.8 && (
      <p className="mt-0.5 text-[10px]" style={{ color }}>
        {cents(spent) > cents(limit)
          ? `Limite dépassée de ${formatEuros(spent - limit)}.`
          : cents(spent) === cents(limit)
            ? 'Limite atteinte pile.'
            : `Plus que ${formatEuros(limit - spent)} avant la limite.`}
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
        {debtQuestion(cat.id)}
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
        subtitle={`${debt.allowed > 0 ? `${formatEuros(debt.spent)} dépensés sur ${formatEuros(debt.allowed)} prévus (limites et parts des dépenses annuelles). ` : ''}${
          past
            ? `Limites propres à ${monthLabel(period)} : touche un montant pour la changer, seul ce mois (et sa dette à moi-même) change.`
            : "Touche un montant pour fixer sa limite (les mois passés gardent la leur) : la barre passe à l'orange à 80 %, au rouge en cas de dépassement."
        }`}
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
                {debtQuestion(key)}
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
        {/* Ce que ce mois ajoute à la dette à moi-même (ou en retire), avec les choix ci-dessus */}
        {debt.items.length > 0 && (
          <p className="mt-3 flex items-baseline justify-between gap-2 border-t pt-2 text-[12px] font-bold" style={{ borderColor: FIN.line }}>
            <span>{debt.delta >= 0 ? 'Ajouté à la dette à moi-même' : 'Retiré de la dette à moi-même'}</span>
            <span style={{ color: debt.delta > 0 ? FIN.rose : FIN.sage }}>{formatEuros(Math.abs(debt.delta))}</span>
          </p>
        )}
      </Panel>
  );
}
