'use client';

import { useState } from 'react';
import { ChevronDown, Pencil, X } from 'lucide-react';
import { formatEuros } from '@/lib/finance';
import { useCategoryLimits, useMonthBudgets } from '@/lib/financeQueries';
import { useIncomePlan } from '@/lib/coursesQueries';
import { useColorLimits } from '@/lib/colorBudgets';
import { activePlans as plansOfMonth, budgetOfMonth, monthLimits } from '@/lib/monthBudget';
import {
  annualCategoryId,
  annualPlans,
  CATEGORIES,
  categoryGroups,
  groupMembers,
  groupTarget,
  saveMonthBudget,
  summarize,
  type Category,
  type CategoryGroup,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { FIN, FinModal, Meter, Panel, parseAmount } from '@/components/finance/FinanceParts';

// Page Budget, pour le mois affiché : ce que le relevé dit qui a été dépensé, par grande catégorie et par catégorie,
// face aux limites (barre de progression et dépassement pour les grandes catégories ; dépensé / limite pour les petites). Les dépenses annuelles ont pour limite un douzième
// de leur montant. onCategoriesChanged : une limite de grande catégorie a changé.
// Mois passé : ses limites lui sont propres (les changer ne touche que lui).
export function BudgetLimits({
  period,
  monthTx,
  onError
}: {
  period: string;
  currentMonth: string | null;
  monthTx: Transaction[];
  onError: (message: string) => void;
  onCategoriesChanged: () => void;
}) {
  const [editingMonth, setEditingMonth] = useState(false); // popin « Modifier » : toutes les limites du mois
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set()); // grandes catégories dépliées (repliées de base)
  const budgetsQuery = useCategoryLimits();
  const budgets = budgetsQuery.data ?? [];
  const monthBudgetsQuery = useMonthBudgets();
  const monthBudgets = monthBudgetsQuery.data ?? [];
  // Limites par défaut de la couleur du mois (Paramètres > Finances) : entre les limites propres au mois et les générales
  const colorLimits = useColorLimits(period, monthTx);
  const limits = monthLimits(period, budgets, monthBudgets, colorLimits);
  // Grande catégorie dont la limite a été modifiée pour ce mois (popin « Modifier ») ; les autres suivent la limite par défaut
  const ownLimit = (groupId: string) => monthBudgets.some((b) => b.month === period && b.target === groupTarget(groupId) && b.custom_limit);
  const { byCategory, income: monthIncome } = summarize(monthTx);
  // Base des limites en pourcentage : les revenus du mois, ou le revenu prévu (Gestion) tant qu'aucun n'est arrivé,
  // comme pour les budgets par défaut des couleurs (lib/colorBudgets)
  const plannedIncome = useIncomePlan().data?.income ?? 0;
  const income = monthIncome || plannedIncome;

  function report(err: { message: string } | null) {
    if (err) onError(describeDbError(err.message));
  }

  // Dépenses annuelles comptées ce mois-ci (créées ce mois ou avant) : leur limite est un douzième de leur montant
  const plans = annualPlans();
  const activePlans = plansOfMonth(plans, period);
  const annualShare = new Map(activePlans.map((p) => [annualCategoryId(p.id), p.amount / 12]));
  const limitOf = (c: Category) => (c.annual ? (annualShare.get(c.id) ?? null) : limits.category(c.id));
  const monthBudget = budgetOfMonth(period, monthTx, budgets, plans, monthBudgets, colorLimits);

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

  // Popin « Modifier » : limites propres au mois affiché (changes : « groupe:id » → limite, null = pas de limite ;
  // reset : ces grandes catégories reprennent la limite par défaut, celle de la couleur ou la générale)
  async function saveMonthLimits(changes: Map<string, number | null>, reset: string[]) {
    setEditingMonth(false);
    const rows = [
      ...[...changes].map(([target, limit]) => ({ target, changes: { custom_limit: true, monthly_limit: limit } })),
      ...reset.map((target) => ({ target, changes: { custom_limit: false, monthly_limit: null } }))
    ];
    if (!rows.length) return;
    monthBudgetsQuery.setData((bs) => {
      let next = bs;
      for (const { target, changes } of rows) {
        const own = next.find((b) => b.month === period && b.target === target);
        next = [...next.filter((b) => b !== own), { month: period, target, counted: true, ...own, ...changes }];
      }
      return next;
    });
    const errors = await Promise.all(rows.map((r) => saveMonthBudget(period, r.target, r.changes)));
    report(errors.find(Boolean) ?? null);
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

  // Barre de progression, même sans limite (cohérence visuelle) : face à la limite si elle existe,
  // sinon, en gris, la part de la dépense dans l'ensemble (share)
  const bar = (spent: number, limit: number | null, share: number) => {
    const { ratio, color } = colorOf(spent, limit);
    return <Meter value={limit !== null ? ratio : share} color={limit !== null ? color : FIN.slate} />;
  };

  // Petite catégorie : juste le dépensé / la limite et le crayon (la barre de progression est réservée aux grandes catégories)
  function limitRow({ cat, spent, limit }: { cat: Category; spent: number; limit: number | null }) {
    const { color } = colorOf(spent, limit);
    return (
      <li key={cat.id} className="px-2.5 py-1.5" style={{ borderColor: FIN.line }}>
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="flex min-w-0 items-baseline gap-1.5" style={{ color: FIN.slate }}>
            <span className="min-w-0">
            {cat.label}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="rounded-sm px-1.5 py-0.5 text-right" style={{ color, backgroundColor: `${color}1f` }}>
              {formatEuros(spent)}
              {limit !== null && <span style={{ color: FIN.slate }}>{` / ${formatEuros(limit)}`}</span>}
            </span>
          </span>
        </div>
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

  return (
    <Panel
      collapsible
      title="Budget du mois"
      subtitle="Est-ce que vous avez réussi à respecter votre budget ?"
      // En haut à droite du titre : la popin des limites de ce mois (sans plier ni déplier la carte)
      action={
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setEditingMonth(true);
          }}
          className="mt-2 flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.15em]"
          style={{ borderColor: FIN.accent, color: FIN.accent }}
        >
          <Pencil size={11} /> Modifier
        </button>
      }
    >
      {/* Pas d'écart affiché sous le titre : seulement l'absence de limites, s'il y a lieu */}
      {monthBudget.allowed <= 0 && (
        <p className="text-[11px]" style={{ color: FIN.slate }}>
          Aucune limite fixée pour ce mois.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {[...expenseGroups, ...(looseGroup ? [looseGroup] : [])].map(({ group, spent, rows }) => {
          const limit = group.monthly_limit;
          const { ratio, color } = colorOf(spent, limit);
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
                </span>
              </div>
              <div className="mt-0.5">{bar(spent, limit, monthSpent > 0 ? spent / monthSpent : 0)}</div>
              {/* Dessous : l'alerte de la limite à gauche ; « par défaut » en bas à droite, si la limite n'a pas été
                  modifiée pour ce mois */}
              {(() => {
                const alert = limit !== null && warning(spent, limit, ratio, color);
                const byDefault = !group.virtual && !ownLimit(group.id);
                if (!alert && !byDefault) return null;
                return (
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">{alert}</div>
                    {byDefault && (
                      <span className="mt-0.5 shrink-0 text-[9px] uppercase tracking-[0.15em]" style={{ color: FIN.slate }}>
                        par défaut
                      </span>
                    )}
                  </div>
                );
              })()}
              {open && rows.length > 0 && (
                <ul className="mt-2 divide-y rounded-sm" style={{ backgroundColor: FIN.paper }}>
                  {rows.map((r) => limitRow(r))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {editingMonth && (
        <MonthLimitsModal
          period={period}
          income={income}
          rows={categoryGroups()
            .filter((g) => g.kind === 'expense' && !g.virtual)
            .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
            .map((g) => {
              const target = groupTarget(g.id);
              const own = monthBudgets.find((b) => b.month === period && b.target === target && b.custom_limit);
              const source: MonthLimitRow['source'] = own ? 'month' : colorLimits?.has(target) ? 'color' : g.monthly_limit !== null ? 'general' : 'none';
              // Petites catégories (sans les dépenses annuelles, qui ont leur propre limite)
              const categories = groupMembers(g.id)
                .filter((c) => !c.annual && c.kind !== 'income' && c.kind !== 'transfer')
                .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
                .map((c) => ({ target: c.id, label: c.label, limit: limits.category(c.id) }));
              return { target, label: g.label, limit: limits.group(g.id), source, categories };
            })}
          onSave={saveMonthLimits}
          onClose={() => setEditingMonth(false)}
        />
      )}
    </Panel>
  );
}

// Popin « Modifier » du Budget du mois : la limite de chaque grande catégorie pour ce mois seulement. On part des limites
// en place (propre au mois, de la couleur du mois ou générale) ; une limite changée devient propre au mois, et
// « par défaut » rend à une grande catégorie la limite de la couleur du mois (ou la générale)
// "categories" : ses petites catégories ; leurs limites (facultatives) se prennent sur celle de la grande catégorie :
// si leur somme la dépasse, une notification le signale (sans empêcher d'enregistrer). Même chose pour les grandes
// catégories face aux revenus du mois.
type MonthLimitRow = {
  target: string;
  label: string;
  limit: number | null;
  source: 'month' | 'color' | 'general' | 'none';
  categories: { target: string; label: string; limit: number | null }[];
};
// Écart toléré (arrondis des pourcentages) avant de signaler un dépassement
const SPLIT_TOLERANCE = 0.05;
const roundCents = (n: number) => Math.round(n * 100) / 100;
const SOURCE_LABELS: Record<MonthLimitRow['source'], string> = {
  month: 'propre à ce mois',
  color: 'par défaut',
  general: '',
  none: ''
};
function MonthLimitsModal({
  income,
  rows,
  onSave,
  onClose
}: {
  period: string;
  // Revenus du mois (ou revenu prévu) : base des limites en pourcentage (0 : pas de pourcentage possible)
  income: number;
  rows: MonthLimitRow[];
  onSave: (changes: Map<string, number | null>, reset: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Map<string, number | null>>(() => new Map());
  const [reset, setReset] = useState<Set<string>>(() => new Set());
  const set = (target: string, n: number | null) => {
    setDraft((d) => new Map(d).set(target, n));
    setReset((r) => {
      const next = new Set(r);
      next.delete(target);
      return next;
    });
  };
  const backToDefault = (target: string) => {
    setDraft((d) => {
      const next = new Map(d);
      next.delete(target);
      return next;
    });
    setReset((r) => new Set(r).add(target));
  };
  const valueOf = (target: string, saved: number | null) => (draft.has(target) ? draft.get(target)! : saved);
  // Répartition d'une grande catégorie entre ses petites catégories : rien (aucune n'a de limite), juste, ou l'écart
  const splitOf = (r: MonthLimitRow): Split => {
    const total = valueOf(r.target, r.limit);
    const subs = r.categories.map((c) => valueOf(c.target, c.limit));
    const used = subs.some((v) => v !== null);
    const sum = roundCents(subs.reduce<number>((s, v) => s + (v ?? 0), 0));
    const gap = total === null ? null : roundCents(total - sum);
    // Dépassement seulement : des petites catégories qui ne prennent pas toute la limite, c'est permis
    return { total, used, sum, gap, ok: !used || gap === null || gap >= -SPLIT_TOLERANCE };
  };
  // Grandes catégories face aux revenus du mois : de combien leurs limites les dépassent (null : pas de dépassement)
  const groupsSum = roundCents(rows.reduce((sum, r) => sum + (valueOf(r.target, r.limit) ?? 0), 0));
  const overIncome = income > 0 && groupsSum - income > SPLIT_TOLERANCE ? roundCents(groupsSum - income) : null;
  // Grandes catégories dépliées (leurs petites catégories visibles) : repliées à l'ouverture
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const toggleRow = (target: string) =>
    setOpenRows((o) => {
      const next = new Set(o);
      if (!next.delete(target)) next.add(target);
      return next;
    });
  // Supprimer la limite d'une grande catégorie retire aussi celles de ses petites catégories
  const clearGroup = (r: MonthLimitRow) => {
    set(r.target, null);
    r.categories.forEach((c) => valueOf(c.target, c.limit) !== null && set(c.target, null));
  };
  // Seules les limites vraiment changées sont enregistrées
  function save() {
    const final = new Map(draft);
    const saved = (target: string) => {
      for (const r of rows) {
        if (r.target === target) return r.limit;
        const c = r.categories.find((x) => x.target === target);
        if (c) return c.limit;
      }
      return null;
    };
    onSave(new Map([...final].filter(([target, n]) => n !== saved(target))), [...reset]);
  }
  const changed = draft.size + reset.size > 0;
  return (
    <FinModal title="Modifier le budget" onClose={onClose}>
      <p className="mb-2 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        Liste de catégories
      </p>
      {/* Limites des grandes catégories au-delà des revenus du mois : une simple notification */}
      {overIncome !== null && <OverNote text={`Les grandes catégories dépassent de ${formatEuros(overIncome)} les revenus du mois (${formatEuros(income)}).`} />}
      <ul className="max-h-[55vh] space-y-2.5 overflow-y-auto pr-1">
        {rows.map((r) => {
          const value = draft.has(r.target) ? draft.get(r.target)! : r.limit;
          const back = reset.has(r.target);
          const open = openRows.has(r.target);
          const split = splitOf(r);
          const origin = back ? 'reprendra la limite par défaut' : draft.has(r.target) ? 'propre à ce mois' : SOURCE_LABELS[r.source];
          return (
            <li key={r.target}>
              {/* Grande catégorie : flèche (déplie ses petites catégories) et nom à gauche, ses champs à droite */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleRow(r.target)}
                  disabled={r.categories.length === 0}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12px] disabled:cursor-default"
                  style={{ color: FIN.navy }}
                >
                  <ChevronDown
                    size={13}
                    aria-hidden
                    className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${r.categories.length === 0 ? 'opacity-0' : ''}`}
                    style={{ color: FIN.gold }}
                  />
                  <span className="block truncate font-bold uppercase tracking-[0.05em]">{r.label}</span>
                </button>
                <LinkedLimit value={value} income={income} onChange={(n) => set(r.target, n)} label={r.label} />
                {/* Supprimer la limite : aucune limite pour cette grande catégorie ce mois-ci (ni pour ses petites catégories) */}
                <button
                  type="button"
                  onClick={() => clearGroup(r)}
                  disabled={value === null}
                  aria-label={`Supprimer la limite · ${r.label}`}
                  title="Supprimer la limite"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border disabled:opacity-30"
                  style={{ borderColor: FIN.rose, color: FIN.rose }}
                >
                  <X size={13} />
                </button>
              </div>
              {/* D'où vient la limite (propre à ce mois, par défaut) ; rien pour la limite générale ou sans limite */}
              {(origin || (r.source === 'month' && !back)) && (
                <span className="block pl-[18px] text-[10px]" style={{ color: FIN.slate }}>
                  {origin}
                  {r.source === 'month' && !back && (
                    <>
                      {origin && ' · '}
                      <button type="button" onClick={() => backToDefault(r.target)} className="underline" style={{ color: FIN.accent }}>
                        par défaut
                      </button>
                    </>
                  )}
                </span>
              )}
              {/* Petites catégories qui dépassent la limite de la grande catégorie : une simple notification */}
              {!split.ok && split.gap !== null && <OverNote text={`Les petites catégories dépassent de ${formatEuros(-split.gap)} la limite de ${r.label}.`} />}
              {open && r.categories.length > 0 && <SplitEditor row={r} split={split} valueOf={valueOf} set={set} />}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border px-4 py-1.5 text-[11px] uppercase tracking-[0.15em]"
          style={{ borderColor: FIN.line, color: FIN.slate }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!changed}
          className="rounded-full px-4 py-1.5 text-[11px] uppercase tracking-[0.15em] disabled:opacity-40"
          style={{ backgroundColor: FIN.accent, color: FIN.paper }}
        >
          Enregistrer
        </button>
      </div>
    </FinModal>
  );
}

// Limite d'une grande catégorie : un champ en euros et, à côté, le même montant en pourcentage des revenus du mois.
// Taper dans l'un met l'autre à jour aussitôt ; la limite (en euros) est retenue en quittant le champ.
// income ≤ 0 : pas de pourcentage possible, le champ % est grisé.
function LinkedLimit({
  value,
  income,
  onChange,
  label,
  base = 'des revenus'
}: {
  value: number | null;
  income: number;
  onChange: (n: number | null) => void;
  label: string;
  // Ce dont le pourcentage est une part (« des revenus », « de la grande catégorie »)
  base?: string;
}) {
  const show = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
  const pctOf = (n: number | null) => (n === null || income <= 0 ? null : Math.round((n / income) * 1000) / 10);
  // Textes en cours de saisie (null : on affiche la valeur enregistrée)
  const [typing, setTyping] = useState<{ eur: string; pct: string } | null>(null);
  const eur = typing?.eur ?? show(value);
  const pct = typing?.pct ?? show(pctOf(value));
  const amountOf = (text: string) => (text.trim() ? parseAmount(text) : null);

  function typeEur(text: string) {
    setTyping({ eur: text, pct: show(pctOf(amountOf(text))) });
  }
  function typePct(text: string) {
    const p = amountOf(text);
    setTyping({ eur: show(p === null ? null : Math.round(income * p) / 100), pct: text });
  }
  // En quittant un champ : la limite en euros est retenue (rien ne change si on n'a rien tapé)
  function commit() {
    if (!typing) return;
    const n = amountOf(typing.eur);
    setTyping(null);
    if (n !== value) onChange(n);
  }

  const input = 'min-w-0 rounded-sm border bg-white px-1.5 py-1 text-right text-[12px] outline-none focus:border-current disabled:opacity-40';
  return (
    <div className="flex shrink-0 gap-1.5">
      <label className="flex items-baseline gap-1">
        <input
          value={eur}
          onChange={(e) => typeEur(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          inputMode="decimal"
          placeholder="—"
          aria-label={`Limite en euros · ${label}`}
          className={`${input} w-[4.75rem]`}
          style={{ borderColor: FIN.line, color: FIN.navy }}
        />
        <span className="text-[11px]" style={{ color: FIN.slate }}>
          €
        </span>
      </label>
      <label className="flex items-baseline gap-1">
        <input
          value={pct}
          onChange={(e) => typePct(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={income <= 0}
          inputMode="decimal"
          placeholder="—"
          aria-label={`Limite en pourcentage ${base} · ${label}`}
          className={`${input} w-[3.25rem]`}
          style={{ borderColor: FIN.line, color: FIN.navy }}
        />
        <span className="text-[11px]" style={{ color: FIN.slate }}>
          %
        </span>
      </label>
    </div>
  );
}

type Split = { total: number | null; used: boolean; sum: number; gap: number | null; ok: boolean };

// Petites catégories d'une grande catégorie (dépliée), dans la popin « Modifier le budget » : sur un fond à part, chacune
// avec sa limite en euros ou en pourcentage de la limite de la grande catégorie
function SplitEditor({
  row,
  split,
  valueOf,
  set
}: {
  row: MonthLimitRow;
  split: Split;
  valueOf: (target: string, saved: number | null) => number | null;
  set: (target: string, n: number | null) => void;
}) {
  return (
    <ul className="mt-1.5 space-y-1 rounded-sm px-2 py-1.5" style={{ backgroundColor: FIN.mist }}>
      {row.categories.map((c) => {
        const v = valueOf(c.target, c.limit);
        return (
          <li key={c.target} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: FIN.navy }} title={c.label}>
              {c.label}
            </span>
            <LinkedLimit value={v} income={split.total ?? 0} onChange={(n) => set(c.target, n)} label={c.label} base="de la grande catégorie" />
            <button
              type="button"
              onClick={() => set(c.target, null)}
              disabled={v === null}
              aria-label={`Supprimer la limite · ${c.label}`}
              title="Supprimer la limite"
              className="flex size-6 shrink-0 items-center justify-center rounded-full border disabled:opacity-30"
              style={{ borderColor: FIN.rose, color: FIN.rose }}
            >
              <X size={11} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Notification de dépassement (limites au-delà de la grande catégorie, ou des revenus du mois) : n'empêche pas d'enregistrer
function OverNote({ text }: { text: string }) {
  return (
    <p
      className="mb-1.5 mt-1 flex items-start gap-1.5 rounded-sm border px-2 py-1 text-[10px] leading-snug"
      style={{ borderColor: FIN.rose, color: FIN.rose, backgroundColor: FIN.paper }}
    >
      <span aria-hidden>⚠</span>
      <span>{text}</span>
    </p>
  );
}
