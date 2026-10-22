'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { latestCached, orThrow, setCachedAll, useCached } from '@/lib/cache';
import { AlertTriangle, Repeat, X } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import {
  addPlanned,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  DEFAULT_CATEGORY_IDS,
  deletePlanned,
  detectSubscriptions,
  detectUnusual,
  fetchBudgets,
  fetchPlanned,
  fetchTransactions,
  groupMembers,
  loadCategories,
  merchantKey,
  monthOf,
  reclassifyOthers,
  reportToStatement,
  saveBudget,
  saveRule,
  splitByKind,
  spendingInsights,
  summarize,
  updateCategory,
  updateCategoryGroup,
  type Budget,
  type Category,
  type CategoryGroup,
  type PlannedExpense,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { useViewedMonth } from '@/lib/health';
import { CategoriesPanel, NewCategoryForm } from '@/components/finance/CategoryManager';
import {
  ErrorNote,
  FIN,
  FinanceHeader,
  FinancePage,
  FinButton,
  Meter,
  NewMonthCard,
  NumberField,
  Panel,
  SummaryTile
} from '@/components/finance/FinanceParts';

// Fenêtre d'opérations en mémoire : du mois "from" au mois "to" (inclus)
type TxWindow = { from: string; to: string; list: Transaction[] };
const TX_PREFIX = 'finances:operations:';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
// Mois demandé dans l'adresse (?mois=2026-03), par exemple au retour de la page Relevés
const readAskedMonth = () => new URLSearchParams(window.location.search).get('mois')?.match(/^\d{4}-\d{2}$/)?.[0] ?? null;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const OTHER_IDS = DEFAULT_CATEGORY_IDS;
const NEW_CATEGORY = '__nouvelle';
// Catégories proposées pour une opération : celles qui acceptent son sens (entrée ou sortie), par ordre alphabétique.
// Les « Autres » ne sont proposées que si l'opération y est déjà.
const choicesFor = (amount: number, current?: string) =>
  CATEGORIES.filter((c) => (!OTHER_IDS.includes(c.id) || c.id === current) && (!c.sign || c.sign === (amount > 0 ? 1 : -1))).sort(byLabel);
// Ces catégories rangées par grande catégorie (dans l'ordre alphabétique), celles sans regroupement d'abord
function groupedChoices(list: Category[]): { group: CategoryGroup | null; list: Category[] }[] {
  const loose = list.filter((c) => !c.group);
  const groups = categoryGroups()
    .map((group) => ({ group, list: list.filter((c) => c.group === group.id) }))
    .filter((g) => g.list.length > 0)
    .sort((a, b) => a.group.label.localeCompare(b.group.label, 'fr'));
  return [...(loose.length ? [{ group: null, list: loose }] : []), ...groups];
}

// Liste déroulante des catégories (ordre alphabétique), avec en dernier « + Nouvelle catégorie… »
function CategorySelect({
  amount,
  value,
  onPick,
  onCreated
}: {
  amount: number;
  value?: string;
  onPick: (category: string) => void;
  onCreated?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  if (creating)
    return (
      <NewCategoryForm
        kind={amount > 0 ? 'income' : 'variable'}
        onCancel={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          onCreated?.();
          onPick(id);
        }}
      />
    );
  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === NEW_CATEGORY) setCreating(true);
        else if (e.target.value) onPick(e.target.value);
      }}
      className="min-w-0 flex-1 rounded-sm border bg-white px-1.5 py-1 text-[11px]"
      style={value ? { borderColor: FIN.line, color: FIN.slate } : { borderColor: FIN.gold, color: FIN.navy }}
    >
      {!value && <option value="">Classer dans…</option>}
      {groupedChoices(choicesFor(amount, value)).map(({ group, list }) =>
        group ? (
          <optgroup key={group.id} label={group.label}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ) : (
          list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))
        )
      )}
      <option value={NEW_CATEGORY}>+ Nouvelle catégorie…</option>
    </select>
  );
}

// Opérations du mois affiché restées dans « Autres », jour par jour, à classer une à une
function OthersPanel({ items, onClassify }: { items: Transaction[]; onClassify: (t: Transaction, category: string, remember: boolean) => void }) {
  const [remember, setRemember] = useState(true);
  if (items.length === 0) return null;
  const days = new Map<string, Transaction[]>();
  for (const t of [...items].sort((a, b) => a.date.localeCompare(b.date))) days.set(t.date, [...(days.get(t.date) ?? []), t]);

  return (
    <Panel
      title="À classer"
      subtitle={`${items.length} opération${items.length > 1 ? 's' : ''} de ce mois restée${items.length > 1 ? 's' : ''} dans « Autres », jour par jour.`}
    >
      <label className="flex items-start gap-2 text-[11px] leading-relaxed">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5" />
        <span>Retenir mon choix : les autres opérations du même commerçant (ou de la même personne) sont classées aussi, maintenant et aux prochains imports</span>
      </label>
      {[...days].map(([date, list]) => (
        <div key={date} className="mt-3">
          <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
            {new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <ul className="divide-y" style={{ borderColor: FIN.line }}>
            {list.map((t) => (
              <li key={t.id} className="py-1.5">
                <div className="flex items-start justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate">{t.label}</span>
                  <b className="shrink-0" style={{ color: t.amount > 0 ? FIN.sage : FIN.navy }}>
                    {formatEuros(t.amount)}
                  </b>
                </div>
                <div className="mt-1 flex">
                  <CategorySelect amount={t.amount} onPick={(c) => onClassify(t, c, remember)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mt-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
        Pense à « Reporter dans le compte de résultat » ensuite pour mettre les totaux à jour.
      </p>
    </Panel>
  );
}

export default function BudgetPage() {
  const [confirm, confirmDialog] = useConfirm();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [offset, setOffset] = useState(0);
  const askedMonth = useSyncExternalStore(noSubscribe, readAskedMonth, () => null);
  const startMonth = askedMonth ?? currentMonth;
  const period = startMonth ? shiftMonth(startMonth, offset) : null;
  // La teinte de la partie Finances suit l'état de santé du mois affiché
  useViewedMonth(period);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // catégorie dont on modifie la limite
  const [newPlanned, setNewPlanned] = useState<{ label: string; amount: number | null; month: number }>({ label: '', amount: null, month: 1 });

  // Données gardées en mémoire entre deux visites (lib/cache) : affichées tout de suite, puis rechargées en arrière-plan.
  // Opérations : une fenêtre de 13 mois (le mois affiché et les 12 d'avant) par mois affiché.
  const txQuery = useCached<TxWindow>(period && `${TX_PREFIX}${period}`, async () => {
    const from = shiftMonth(period!, -12);
    const { transactions, error } = await fetchTransactions(`${from}-01`, lastDay(period!));
    return { from, to: period!, list: orThrow(transactions, error) };
  });
  const budgetsQuery = useCached('finances:budgets', async () => {
    const { budgets, error } = await fetchBudgets();
    return orThrow(budgets, error);
  });
  const plannedQuery = useCached('finances:depenses-prevues', async () => {
    const { planned, error } = await fetchPlanned();
    return orThrow(planned, error);
  });
  // Les catégories sont rangées dans CATEGORIES (lib/transactions) : la mémoire garde juste le moment du chargement
  const categoriesQuery = useCached('finances:categories', async () => orThrow(Date.now(), await loadCategories()));

  // En changeant de mois, la fenêtre du mois précédemment affiché contient souvent déjà le nouveau mois :
  // on l'utilise en attendant la sienne
  const shownWindow = txQuery.data ?? latestCached<TxWindow>(TX_PREFIX);
  const loaded = !!period && !!shownWindow && shownWindow.from <= period && period <= shownWindow.to && categoriesQuery.data !== undefined;
  const transactions = useMemo(() => (loaded ? shownWindow.list : []), [loaded, shownWindow]);
  const budgets = budgetsQuery.data ?? [];
  const planned = plannedQuery.data ?? [];
  const loadError = txQuery.error ?? budgetsQuery.error ?? plannedQuery.error ?? categoriesQuery.error;
  const shownError = error ?? (loadError && describeDbError(loadError));

  // Les modifications s'appliquent à toutes les fenêtres d'opérations déjà en mémoire (un même mois peut être dans plusieurs)
  const setTransactions = (update: (ts: Transaction[]) => Transaction[]) => setCachedAll<TxWindow>(TX_PREFIX, (w) => ({ ...w, list: update(w.list) }));
  const setBudgets = (update: (bs: Budget[]) => Budget[]) => budgetsQuery.setData(update);
  const setPlanned = (update: (ps: PlannedExpense[]) => PlannedExpense[]) => plannedQuery.setData(update);
  function reloadAll() {
    txQuery.reload();
    budgetsQuery.reload();
    plannedQuery.reload();
    categoriesQuery.reload();
  }

  const monthTx = useMemo(() => transactions.filter((t) => period && monthOf(t.date) === period), [transactions, period]);
  const history = useMemo(() => transactions.filter((t) => period && monthOf(t.date) < period), [transactions, period]);
  const summary = summarize(monthTx);
  const unusual = useMemo(() => detectUnusual(monthTx, history), [monthTx, history]);
  const unusualIds = new Set(unusual.map((t) => t.id));
  const split = splitByKind(monthTx, unusualIds);
  const insights = useMemo(() => (period ? spendingInsights(period, transactions) : []), [period, transactions]);
  const subscriptions = useMemo(() => detectSubscriptions(transactions), [transactions]);
  const accounts = [...new Set(transactions.map((t) => t.account))];

  // Catégories de dépenses du mois, plus celles qui ont une limite
  const expenseCategories = CATEGORIES.filter((c) => c.kind !== 'income' && c.kind !== 'transfer')
    .map((c) => ({ cat: c, spent: summary.byCategory.get(c.id) ?? 0, limit: budgets.find((b) => b.category === c.id)?.monthly_limit ?? null }))
    .filter((r) => r.spent > 0 || r.limit !== null)
    .sort((a, b) => b.spent - a.spent);
  // Grandes catégories de sorties : total dépensé dans leurs sous-catégories, comparé à leur limite
  const expenseGroups = categoryGroups()
    .filter((g) => g.kind === 'expense')
    .map((group) => ({
      group,
      spent: groupMembers(group.id).reduce((sum, c) => sum + (summary.byCategory.get(c.id) ?? 0), 0),
      rows: expenseCategories.filter((r) => r.cat.group === group.id)
    }))
    .filter((g) => g.spent > 0 || g.group.monthly_limit !== null || g.rows.length > 0)
    .sort((a, b) => b.spent - a.spent);
  const looseRows = expenseCategories.filter((r) => !r.cat.group || !expenseGroups.some((g) => g.group.id === r.cat.group));
  const unbudgeted = CATEGORIES.filter((c) => c.kind !== 'income' && c.kind !== 'transfer' && !budgets.some((b) => b.category === c.id)).sort(byLabel);

  function report(err: { message: string } | null) {
    if (err) setError(describeDbError(err.message));
  }

  async function recategorize(t: Transaction, category: string) {
    setTransactions((ts) => ts.map((x) => (x.id === t.id ? { ...x, category } : x)));
    report(await updateCategory([t.id], category));
  }

  // Classement depuis « À classer » ; si le choix est retenu, il s'applique à toutes les opérations « Autres »
  // du même commerçant et dans le même sens (tous mois confondus), et aux prochains imports
  async function classifyOther(t: Transaction, category: string, remember: boolean) {
    if (!remember) return recategorize(t, category);
    const key = merchantKey(t.label);
    const isSame = (x: Transaction) => OTHER_IDS.includes(x.category) && merchantKey(x.label) === key && x.amount > 0 === t.amount > 0;
    const ids = transactions.filter(isSame).map((x) => x.id);
    setTransactions((ts) => ts.map((x) => (isSame(x) ? { ...x, category } : x)));
    const err = (await updateCategory(ids, category)) ?? (await saveRule(key, category));
    if (err) return report(err);
    // Opérations plus anciennes (hors des 12 derniers mois chargés) : reclassées avec la règle qui vient d'être retenue
    const { changed } = await reclassifyOthers();
    const n = ids.length + changed;
    setNotice(`« ${key} » classé en ${categoryById(category).label} (${n} opération${n > 1 ? 's' : ''}), et retenu pour les prochains imports.`);
  }

  // Mémorise la correction et l'applique à toutes les opérations du même commerçant
  async function alwaysLikeThis(t: Transaction) {
    const key = merchantKey(t.label);
    const same = transactions.filter((x) => merchantKey(x.label) === key && x.category !== t.category);
    setTransactions((ts) => ts.map((x) => (merchantKey(x.label) === key ? { ...x, category: t.category } : x)));
    report(await saveRule(key, t.category));
    if (same.length) report(await updateCategory(same.map((x) => x.id), t.category));
    setNotice(`« ${key} » sera toujours classé en ${categoryById(t.category).label} (${same.length} autre${same.length > 1 ? 's' : ''} opération${same.length > 1 ? 's' : ''} corrigée${same.length > 1 ? 's' : ''}).`);
  }

  // Limite mensuelle d'une grande catégorie (null : pas de limite)
  async function setGroupLimit(group: CategoryGroup, limit: number | null) {
    setEditing(null);
    report(await updateCategoryGroup(group.id, { monthly_limit: limit }));
    categoriesQuery.reload();
  }

  async function setLimit(category: string, limit: number | null) {
    setBudgets((bs) => [...bs.filter((b) => b.category !== category), ...(limit ? [{ category, monthly_limit: limit }] : [])]);
    setEditing(null);
    report(await saveBudget(category, limit));
  }

  function limitRow({ cat, spent, limit }: { cat: Category; spent: number; limit: number | null }) {
    const ratio = limit ? spent / limit : 0;
    const color = !limit ? FIN.slate : ratio >= 1 ? FIN.rose : ratio >= 0.8 ? FIN.gold : FIN.sage;
    return (
      <li key={cat.id}>
        <div className="flex items-baseline justify-between gap-2 text-[12px]">
          <span>{cat.label}</span>
          <button type="button" onClick={() => setEditing(editing === cat.id ? null : cat.id)} className="text-right" style={{ color }}>
            {formatEuros(spent)}
            <span style={{ color: FIN.slate }}>{limit ? ` / ${formatEuros(limit)}` : ' · fixer une limite'}</span>
          </button>
        </div>
        {limit !== null && <Meter value={ratio} color={color} />}
        {limit !== null && ratio >= 0.8 && (
          <p className="mt-0.5 text-[10px]" style={{ color }}>
            {ratio >= 1 ? `Limite dépassée de ${formatEuros(spent - limit)}.` : `Plus que ${formatEuros(limit - spent)} avant la limite.`}
          </p>
        )}
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

  async function addPlannedExpense() {
    if (!newPlanned.label.trim() || !newPlanned.amount) return;
    const { planned: p, error: err } = await addPlanned(newPlanned.label.trim(), newPlanned.amount, newPlanned.month);
    report(err);
    if (p) setPlanned((ps) => [...ps, p].sort((a, b) => a.due_month - b.due_month));
    setNewPlanned({ label: '', amount: null, month: 1 });
  }

  async function sendToStatement() {
    if (!period) return;
    const { error: err } = await reportToStatement(period, monthTx);
    report(err);
    if (!err) setNotice(`Totaux reportés dans le compte de résultat de ${monthLabel(period)}.`);
  }

  // Jours restant avant chaque dépense annuelle, et somme à mettre de côté chaque mois
  const thisMonth = currentMonth ? Number(currentMonth.slice(5)) : 1;
  const provision = planned.reduce((s, p) => s + p.amount / 12, 0);
  const shownTx = showAll ? monthTx : monthTx.slice(0, 15);

  return (
    <FinancePage
      header={
        <FinanceHeader
          subtitle="budget · opérations"
          month={period ? monthLabel(period) : ''}
          onPrev={() => setOffset((o) => o - 1)}
          onNext={() => period && currentMonth && period < currentMonth && setOffset((o) => o + 1)}
          canNext={!!period && !!currentMonth && period < currentMonth}
        />
      }
    >
      {confirmDialog}
      <ErrorNote message={shownError} />
      {notice && (
        <p className="mt-4 flex items-start justify-between gap-2 rounded-sm border px-3 py-2 text-[11px]" style={{ borderColor: FIN.sage, color: FIN.sage, backgroundColor: FIN.paper }}>
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Fermer">
            <X size={14} />
          </button>
        </p>
      )}

      {!loaded ? (
        <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
          Chargement…
        </p>
      ) : monthTx.length === 0 ? (
        // Mois sans relevé importé : les Finances retranscrivent le passé, on importe donc son relevé
        <NewMonthCard period={period!} />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <SummaryTile label="Entrées" value={formatEuros(summary.income)} color={FIN.sage} />
            <SummaryTile label="Sorties" value={formatEuros(summary.expenses)} color={FIN.rose} />
            <SummaryTile
              label="Reste"
              value={formatEuros(summary.income - summary.expenses)}
              color={summary.income >= summary.expenses ? FIN.navy : FIN.rose}
            />
          </div>

          {/* Dépenses fixes, variables, occasionnelles */}
          {summary.expenses > 0 && (
            <div className="mt-3">
              <div className="flex h-3 w-full overflow-hidden rounded-full">
                {[
                  [split.fixed, FIN.slate],
                  [split.variable, FIN.gold],
                  [split.occasional, FIN.rose]
                ].map(([v, c], i) => (
                  <div key={i} style={{ width: `${((v as number) / summary.expenses) * 100}%`, backgroundColor: c as string }} />
                ))}
              </div>
              <p className="mt-1 flex justify-between text-[10px]" style={{ color: FIN.slate }}>
                <span>Fixes {formatEuros(split.fixed)}</span>
                <span>Variables {formatEuros(split.variable)}</span>
                <span>Occasionnelles {formatEuros(split.occasional)}</span>
              </p>
            </div>
          )}

          <OthersPanel items={monthTx.filter((t) => OTHER_IDS.includes(t.category))} onClassify={classifyOther} />

          {insights.length > 0 && (
            <Panel title="En bref">
              <ul className="space-y-2 text-[12px] leading-relaxed">
                {insights.map((i) => (
                  <li key={i.text} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45" style={{ backgroundColor: i.tone === 'good' ? FIN.sage : FIN.rose }} />
                    {i.text}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Budget du mois" subtitle="Fixe une limite par grande catégorie ou par catégorie : la barre passe à l'orange à 80 %, au rouge au-delà.">
            <ul className="space-y-3">
              {expenseGroups.map(({ group, spent, rows }) => {
                const limit = group.monthly_limit;
                const ratio = limit ? spent / limit : 0;
                const color = !limit ? FIN.slate : ratio >= 1 ? FIN.rose : ratio >= 0.8 ? FIN.gold : FIN.sage;
                const key = `groupe:${group.id}`;
                return (
                  <li key={group.id}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px] font-bold uppercase tracking-[0.05em]">
                      <span>{group.label}</span>
                      <button type="button" onClick={() => setEditing(editing === key ? null : key)} className="text-right normal-case tracking-normal" style={{ color }}>
                        {formatEuros(spent)}
                        <span className="font-normal" style={{ color: FIN.slate }}>
                          {limit ? ` / ${formatEuros(limit)}` : ' · fixer une limite'}
                        </span>
                      </button>
                    </div>
                    {limit !== null && <Meter value={ratio} color={color} />}
                    {limit !== null && ratio >= 0.8 && (
                      <p className="mt-0.5 text-[10px]" style={{ color }}>
                        {ratio >= 1 ? `Limite dépassée de ${formatEuros(spent - limit)}.` : `Plus que ${formatEuros(limit - spent)} avant la limite.`}
                      </p>
                    )}
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
              <select
                value=""
                onChange={(e) => e.target.value && setEditing(e.target.value)}
                className="mt-3 w-full rounded-sm border bg-white px-2 py-1.5 text-[11px]"
                style={{ borderColor: FIN.line, color: FIN.slate }}
              >
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

          {unusual.length > 0 && (
            <Panel title="Inhabituel" subtitle="Dépenses bien plus élevées que d'habitude dans leur catégorie, ou grosse dépense chez un nouveau commerçant.">
              <ul className="space-y-1 text-[12px]">
                {unusual.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <AlertTriangle size={13} className="shrink-0" style={{ color: FIN.gold }} />
                      <span className="truncate">
                        {shortDate(t.date)} · {t.label}
                      </span>
                    </span>
                    <b style={{ color: FIN.rose }}>{formatEuros(-t.amount)}</b>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Opérations" subtitle="Corrige une catégorie si besoin : l'appli peut retenir ta correction pour les fois suivantes.">
            <ul className="divide-y" style={{ borderColor: FIN.line }}>
              {shownTx.map((t) => {
                const cat = categoryById(t.category);
                return (
                  <li key={t.id} className="py-2">
                    <div className="flex items-start justify-between gap-2 text-[12px]">
                      <span className="min-w-0">
                        <span className="block truncate">{t.label}</span>
                        <span className="text-[10px]" style={{ color: FIN.slate }}>
                          {shortDate(t.date)}
                          {accounts.length > 1 && ` · ${t.account}`}
                        </span>
                      </span>
                      <b className="shrink-0" style={{ color: cat.kind === 'transfer' ? FIN.slate : t.amount > 0 ? FIN.sage : FIN.navy }}>
                        {formatEuros(t.amount)}
                      </b>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <CategorySelect amount={t.amount} value={t.category} onPick={(c) => recategorize(t, c)} />
                      <button type="button" onClick={() => alwaysLikeThis(t)} title="Toujours classer ce commerçant ainsi" className="shrink-0 text-[10px] underline" style={{ color: FIN.gold }}>
                        Toujours
                      </button>
                      {/* Pas de suppression : les opérations viennent uniquement des relevés importés, on ne fait que les classer */}
                    </div>
                  </li>
                );
              })}
            </ul>
            {monthTx.length > 15 && (
              <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
                {showAll ? 'Voir moins' : `Voir les ${monthTx.length} opérations`}
              </button>
            )}
            <div className="mt-3 border-t pt-3" style={{ borderColor: FIN.line }}>
              <FinButton outline onClick={sendToStatement}>
                Reporter dans le compte de résultat
              </FinButton>
              <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
                Remplit les lignes du compte de résultat de {period && monthLabel(period)} avec les totaux par catégorie (les lignes
                existantes du même nom sont remplacées).
              </p>
            </div>
          </Panel>
        </>
      )}

      {subscriptions.length > 0 && (
        <Panel title="Dépenses récurrentes" subtitle="Abonnements et prélèvements qui reviennent chaque mois : vérifie que tu les utilises tous.">
          <ul className="space-y-1.5 text-[12px]">
            {subscriptions.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Repeat size={12} className="shrink-0" style={{ color: FIN.slate }} />
                  <span className="min-w-0">
                    <span className="block truncate">{s.key}</span>
                    <span className="text-[10px]" style={{ color: FIN.slate }}>
                      {categoryById(s.category).label} · {s.months} mois
                      {s.stopped && ' · plus vu depuis le ' + shortDate(s.lastDate)}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <b>{formatEuros(s.amount)}</b>/mois
                  <span className="block text-[10px]" style={{ color: FIN.rose }}>
                    {formatEuros(s.yearly)}/an
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px]" style={{ color: FIN.slate }}>
            Total : <b>{formatEuros(subscriptions.filter((s) => !s.stopped).reduce((sum, s) => sum + s.yearly, 0))}</b> par an.
          </p>
        </Panel>
      )}

      <Panel title="Dépenses annuelles" subtitle="Assurance, impôts, vacances, cadeaux de Noël… En les étalant sur l'année, elles ne déséquilibrent plus le mois où elles tombent.">
        <ul className="space-y-1.5 text-[12px]">
          {planned.map((p) => {
            const monthsLeft = (p.due_month - thisMonth + 12) % 12;
            return (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>
                  {p.label}
                  <span className="block text-[10px]" style={{ color: FIN.slate }}>
                    en {MONTHS[p.due_month - 1]}
                    {monthsLeft === 0 ? ' · ce mois-ci' : ` · dans ${monthsLeft} mois`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-right">
                    <b>{formatEuros(p.amount)}</b>
                    <span className="block text-[10px]" style={{ color: FIN.slate }}>
                      {formatEuros(p.amount / 12)}/mois
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await confirm('Supprimer la dépense prévue', `Supprimer « ${p.label} » (${formatEuros(p.amount)}) ?`))) return;
                      setPlanned((ps) => ps.filter((x) => x.id !== p.id));
                      report(await deletePlanned(p.id));
                    }}
                    aria-label={`Supprimer ${p.label}`}
                    className="opacity-50 hover:opacity-100"
                    style={{ color: FIN.rose }}
                  >
                    <X size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {planned.length > 0 && (
          <p className="mt-2 rounded-sm px-3 py-2 text-[11px]" style={{ backgroundColor: FIN.mist }}>
            À mettre de côté chaque mois : <b>{formatEuros(provision)}</b>
          </p>
        )}
        <div className="mt-3 grid grid-cols-[1fr_90px] gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
              Dépense
            </span>
            <input
              value={newPlanned.label}
              onChange={(e) => setNewPlanned({ ...newPlanned, label: e.target.value })}
              placeholder="Assurance auto"
              className="rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
              style={{ borderColor: FIN.line }}
            />
          </label>
          <NumberField label="Montant" value={newPlanned.amount} onChange={(n) => setNewPlanned({ ...newPlanned, amount: n })} />
        </div>
        <div className="mt-2 flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
              Mois
            </span>
            <select
              value={newPlanned.month}
              onChange={(e) => setNewPlanned({ ...newPlanned, month: Number(e.target.value) })}
              className="rounded-sm border bg-white px-2 py-1.5 text-[12px]"
              style={{ borderColor: FIN.line }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <FinButton onClick={addPlannedExpense} disabled={!newPlanned.label.trim() || !newPlanned.amount}>
            Ajouter
          </FinButton>
        </div>
      </Panel>
      <CategoriesPanel
        onChanged={(message) => {
          setNotice(message);
          reloadAll();
        }}
      />
    </FinancePage>
  );
}
