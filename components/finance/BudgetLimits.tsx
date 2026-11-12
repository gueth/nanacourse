'use client';

import { useState } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';
import { formatEuros, monthLabel } from '@/lib/finance';
import { useCategoryLimits, useMonthBudgets } from '@/lib/financeQueries';
import { activePlans as plansOfMonth, AMORTIZE_TARGET, debtOfMonth, monthLimits } from '@/lib/selfDebt';
import {
  annualCategoryId,
  annualPlans,
  CATEGORIES,
  categoryById,
  categoryGroups,
  groupMembers,
  groupTarget,
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
import { FIN, FinModal, Meter, NumberField, Panel } from '@/components/finance/FinanceParts';

// Page Budget, pour le mois affiché : ce que le relevé dit qui a été dépensé, par grande catégorie et par catégorie,
// face aux limites (barre de progression et dépassement pour les grandes catégories ; dépensé / limite pour les petites). Les dépenses annuelles ont pour limite un douzième
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
  const [editing, setEditing] = useState<string | null>(null); // catégorie (ou « groupe:id ») dont la fenêtre de limite est ouverte
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set()); // grandes catégories dépliées (repliées de base)
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
  const activePlans = plansOfMonth(plans, period);
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
  // Les catégories rangées dans aucune grande catégorie forment un bandeau à part (« Sans grande catégorie »),
  // pour que toute la liste reste regroupée et alignée
  const looseGroup = looseRows.length
    ? {
        group: { id: '__sans-groupe', label: 'Sans grande catégorie', kind: 'expense', monthly_limit: null, virtual: true } as unknown as CategoryGroup & { virtual?: boolean },
        spent: looseRows.reduce((s, r) => s + r.spent, 0),
        rows: looseRows
      }
    : null;

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
    // Mois amorti : pas de question, juste ce que l'amortissement a fait de la ligne
    const amortized = debt.amortization;
    if (amortized) {
      const used = amortized.used.get(target);
      const over = debt.items.find((i) => i.target === target && i.kind === 'depassement');
      const text = used
        ? `${formatEuros(used)} de cette économie amortissent les dépassements.`
        : over
          ? `${over.absorbed ? `Amorti de ${formatEuros(over.absorbed)} · ` : ''}${formatEuros(over.amount)} vont dans la dette à moi-même.`
          : null;
      return (
        text && (
          <p className="mt-1 text-[10px]" style={{ color: FIN.slate }}>
            {text}
          </p>
        )
      );
    }
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
            ? 'Compter dans la dette à moi-même ?'
            : 'Retirer de la dette à moi-même ?'}
        </span>
        {choice(true, 'Oui')}
        {choice(false, 'Non')}
      </div>
    );
  }

  // Comparaison au centime près : dépenser exactement la limite n'est pas un dépassement
  const cents = (n: number) => Math.round(n * 100);
  const BLUE = '#3d63a6';
  const colorOf = (spent: number, limit: number | null) => {
    const ratio = limit ? spent / limit : 0;
    const over = !!limit && cents(spent) > cents(limit);
    const under = !!limit && cents(spent) < cents(limit);
    // Rouge : dépassement ; vert : en dessous de la limite ; bleu : limite atteinte pile, ou pas de limite
    return { ratio, color: over ? FIN.rose : under ? FIN.sage : BLUE };
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

  // Petit crayon qui ouvre la fenêtre de la limite
  const editButton = (target: string, label: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(target);
      }}
      aria-label={`Modifier la limite · ${label}`}
      className="-my-1 flex size-7 shrink-0 items-center justify-center rounded-full"
      style={{ color: FIN.slate }}
    >
      <Pencil size={13} />
    </button>
  );

  // Barre de progression, même sans limite (cohérence visuelle) : face à la limite si elle existe,
  // sinon, en gris, la part de la dépense dans l'ensemble (share)
  const bar = (spent: number, limit: number | null, share: number) => {
    const { ratio, color } = colorOf(spent, limit);
    return <Meter value={limit !== null ? ratio : share} color={limit !== null ? color : FIN.slate} />;
  };

  // Petite catégorie : juste le dépensé / la limite et le crayon (la barre de progression est réservée aux grandes catégories)
  function limitRow({ cat, spent, limit }: { cat: Category; spent: number; limit: number | null }) {
    const { color } = colorOf(spent, limit);
    // Dépense annuelle (sa limite vient de son montant) ou dette à moi-même : pas de limite à fixer ici
    const editable = !cat.annual && cat.id !== SELF_DEBT_ID;
    return (
      <li key={cat.id} className="px-2.5 py-1.5" style={{ borderColor: FIN.line }}>
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="flex min-w-0 items-baseline gap-1.5" style={{ color: FIN.slate }}>
            {/* Puce : petite catégorie */}
            <span aria-hidden className="size-1.5 shrink-0 -translate-y-px rounded-full" style={{ backgroundColor: FIN.gold }} />
            <span className="min-w-0">
            {cat.label}
            {/* Catégorie des budgets de courses : sa limite plafonne ces budgets (Profil > Budgets) */}
            {fromShopping(cat) && (
              <span className="block text-[9px]" style={{ color: FIN.slate }}>
                plafonne tes budgets de courses
              </span>
            )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="rounded-sm px-1.5 py-0.5 text-right" style={{ color, backgroundColor: `${color}1f` }}>
              {formatEuros(spent)}
              {limit !== null && <span style={{ color: FIN.slate }}>{` / ${formatEuros(limit)}`}</span>}
            </span>
            {editable ? editButton(cat.id, cat.label) : <span aria-hidden className="size-7 shrink-0" />}
          </span>
        </div>
        {debtQuestion(cat.id)}
      </li>
    );
  }

  const monthSpent = expenseGroups.reduce((s, g) => s + g.spent, 0) + looseRows.reduce((s, r) => s + r.spent, 0);
  const toggleGroup = (id: string) =>
    setOpenGroups((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Fenêtre de la limite en cours de modification : grande catégorie (« groupe:id ») ou catégorie
  const editingGroup = editing?.startsWith('groupe:') ? expenseGroups.find((g) => `groupe:${g.group.id}` === editing)?.group : undefined;
  const editingLabel = editing ? (editingGroup ? editingGroup.label : categoryById(editing).label) : '';
  const editingLimit = editing ? (editingGroup ? editingGroup.monthly_limit : limits.category(editing)) : null;
  const saveEditing = (n: number | null) => {
    if (!editing) return;
    if (editingGroup) setGroupLimit(editingGroup, n);
    else setLimit(editing, n);
  };

  return (
    <Panel
      collapsible
      title="Budget du mois"
      subtitle="Est-ce que vous avez réussi à respecter votre budget ?"
    >
      {/* Pas d'écart affiché sous le titre : seulement l'absence de limites, s'il y a lieu */}
      {debt.allowed <= 0 && (
        <p className="text-[11px]" style={{ color: FIN.slate }}>
          Aucune limite fixée pour ce mois.
        </p>
      )}
      {/* AMORTIR LES DÉPASSEMENTS : les économies de certaines catégories couvrent les dépassements des autres,
          seul le reste va dans la dette à moi-même (réglé pour ce mois, voir lib/selfDebt) */}
      {(debt.amortization || debt.items.some((i) => i.kind === 'depassement')) && (
        <div className="mt-2 rounded-sm border px-3 py-2" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
          <button
            type="button"
            aria-pressed={!!debt.amortization}
            onClick={() => saveForMonth(AMORTIZE_TARGET, { counted: !debt.amortization })}
            className="w-full rounded-full border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em]"
            style={
              debt.amortization ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper } : { borderColor: FIN.accent, color: FIN.accent }
            }
          >
            {debt.amortization ? 'Dépassements amortis · annuler' : 'Amortir les dépassements'}
          </button>
          {debt.amortization ? (
            <div className="mt-2 space-y-0.5 text-[11px]" style={{ color: FIN.slate }}>
              <p className="flex justify-between gap-2">
                <span>Dépassements</span>
                <b style={{ color: FIN.rose }}>{formatEuros(debt.amortization.over)}</b>
              </p>
              <p className="flex justify-between gap-2">
                <span>Couverts par les économies</span>
                <b style={{ color: FIN.sage }}>− {formatEuros(debt.amortization.covered)}</b>
              </p>
              <p className="flex justify-between gap-2 border-t pt-0.5 font-bold" style={{ borderColor: FIN.line, color: FIN.navy }}>
                <span>Reste dans la dette à moi-même</span>
                <span>{formatEuros(debt.amortization.over - debt.amortization.covered)}</span>
              </p>
              {debt.amortization.surplus > debt.amortization.covered && (
                <p className="text-[10px]">{formatEuros(debt.amortization.surplus - debt.amortization.covered)} d&apos;économies restent hors de la dette.</p>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-[10px]" style={{ color: FIN.slate }}>
              Les économies des autres catégories réduisent les dépassements ; seul le reste va dans la dette à moi-même.
            </p>
          )}
        </div>
      )}
      <ul className="mt-3 space-y-3">
        {[...expenseGroups, ...(looseGroup ? [looseGroup] : [])].map(({ group, spent, rows }) => {
          const limit = group.monthly_limit;
          const { ratio, color } = colorOf(spent, limit);
          const key = `groupe:${group.id}`;
          const open = openGroups.has(group.id);
          return (
            // Grande catégorie : bandeau teinté avec un liseré à gauche, à la couleur de son état (rouge : dépassement ;
            // vert : sous la limite ; bleu : pile ou sans limite) ; les petites catégories, sur fond clair, sont dedans
            <li key={group.id} className="rounded-sm border-l-[3px] px-2.5 py-2" style={{ backgroundColor: `${color}14`, borderColor: color, color: FIN.navy }}>
              {/* Grande catégorie, repliée de base : on la déplie en la touchant */}
              <div className="flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-[0.05em]">
                <button
                  type="button"
                  onClick={() => rows.length > 0 && toggleGroup(group.id)}
                  aria-expanded={rows.length > 0 ? open : undefined}
                  className="flex min-w-0 items-center gap-1 text-left uppercase"
                >
                  <ChevronDown
                    size={14}
                    aria-hidden
                    className="shrink-0 transition-transform"
                    style={{ color: FIN.gold, transform: open ? 'rotate(180deg)' : undefined, visibility: rows.length > 0 ? 'visible' : 'hidden' }}
                  />
                  <span className="min-w-0">{group.label}</span>
                </button>
                <span className="flex shrink-0 items-center gap-1 normal-case tracking-normal">
                  <span className="rounded-sm px-1.5 py-0.5 text-right" style={{ color, backgroundColor: `${color}1f` }}>
                    {formatEuros(spent)}
                    {limit !== null && <span className="font-normal" style={{ color: FIN.slate }}>{` / ${formatEuros(limit)}`}</span>}
                  </span>
                  {group.virtual ? <span aria-hidden className="size-7 shrink-0" /> : editButton(key, group.label)}
                </span>
              </div>
              <div className="mt-0.5">{bar(spent, limit, monthSpent > 0 ? spent / monthSpent : 0)}</div>
              {limit !== null && warning(spent, limit, ratio, color)}
              {group.id !== '__sans-groupe' && debtQuestion(key)}
              {open && rows.length > 0 && (
                <ul className="mt-2 divide-y rounded-sm" style={{ backgroundColor: FIN.paper }}>
                  {rows.map((r) => limitRow(r))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {/* Ce que ce mois ajoute à la dette à moi-même (ou en retire), avec les choix ci-dessus */}
      {debt.items.length > 0 && (
        <p className="mt-3 flex items-baseline justify-between gap-2 border-t pt-2 text-[12px] font-bold" style={{ borderColor: FIN.line }}>
          <span>{debt.delta >= 0 ? 'Ajouté à la dette à moi-même' : 'Retiré de la dette à moi-même'}</span>
          <span style={{ color: debt.delta > 0 ? FIN.rose : FIN.sage }}>{formatEuros(Math.abs(debt.delta))}</span>
        </p>
      )}

      {editing && <LimitModal label={editingLabel} limit={editingLimit} past={past} period={period} onSave={saveEditing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

// Fenêtre de modification d'une limite mensuelle : enregistrer, retirer la limite, ou fermer sans rien changer
function LimitModal({
  label,
  limit,
  past,
  period,
  onSave,
  onClose
}: {
  label: string;
  limit: number | null;
  past: boolean;
  period: string;
  onSave: (n: number | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<number | null>(limit);
  return (
    <FinModal title="Limite" onClose={onClose}>
      <p className="mb-3 text-[11px]" style={{ color: FIN.slate }}>
        {label}
        {past ? ` · pour ${monthLabel(period)} seulement` : ' · les mois passés gardent la leur'}
      </p>
      <NumberField label="Limite mensuelle" value={draft} onChange={setDraft} />
      <div className="mt-4 flex items-center justify-between gap-2">
        {limit !== null ? (
          <button type="button" onClick={() => onSave(null)} className="text-[11px] underline" style={{ color: FIN.rose }}>
            Retirer la limite
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="rounded-full px-4 py-1.5 text-[11px] uppercase tracking-[0.15em]"
          style={{ backgroundColor: FIN.accent, color: FIN.paper }}
        >
          Enregistrer
        </button>
      </div>
    </FinModal>
  );
}
