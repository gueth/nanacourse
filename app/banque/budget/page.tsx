'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { latestCached, orThrow, setCachedAll, useCached } from '@/lib/cache';
import { Plus, X } from 'lucide-react';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import {
  addManualTransaction,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  DEFAULT_CATEGORY_IDS,
  deleteManualTransaction,
  detectUnusual,
  fetchTransactions,
  isManual,
  isSavingsAccount,
  loadCategories,
  merchantKey,
  monthOf,
  reclassifyOthers,
  saveRule,
  splitByKind,
  summarize,
  updateCategory,
  type Category,
  type CategoryGroup,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { syncFinances } from '@/lib/financeSync';
import { rememberedFinanceMonth, useViewedMonth } from '@/lib/health';
import { NewCategoryForm } from '@/components/finance/CategoryManager';
import { BudgetLimits } from '@/components/finance/BudgetLimits';
import { MonthRepartitionPanel } from '@/components/finance/Repartition';
import { KeyFigures } from '@/components/finance/KeyFigures';
import { useCoverage, useDebtCategories } from '@/lib/financeQueries';
import { flagTransfersToVerify } from '@/lib/coverage';
import { EstimatedOperations } from '@/components/finance/EstimatedOperations';
import {
  ErrorNote,
  FIN,
  FinanceHeader,
  FinancePage,
  FinButton,
  NewMonthCard,
  NumberField,
  Panel,
  SummaryTile,
  useFinConfirm
} from '@/components/finance/FinanceParts';

// Fenêtre d'opérations en mémoire : du mois "from" au mois "to" (inclus)
type TxWindow = { from: string; to: string; list: Transaction[] };
const TX_PREFIX = 'finances:operations:';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
// Mois demandé dans l'adresse (?mois=2026-03), par exemple au retour de la page Gestion
const readAskedMonth = () => new URLSearchParams(window.location.search).get('mois')?.match(/^\d{4}-\d{2}$/)?.[0] ?? null;

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
      className="fin-select min-w-0 flex-1 py-1 pl-1.5 text-[11px]"
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
      collapsible
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
                  <span className="min-w-0 break-words">{t.label}</span>
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
    </Panel>
  );
}

// Opération ajoutée à la main (paiement en espèces, opération pas encore sur un relevé…), datée dans le mois affiché
type ManualFields = { date: string; label: string; amount: number; account: string; category: string };
function AddOperationForm({
  period,
  accounts,
  defaultAccount,
  onAdd,
  onCancel
}: {
  period: string;
  accounts: string[];
  defaultAccount?: string;
  onAdd: (fields: ManualFields) => Promise<boolean>;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today.startsWith(period) ? today : lastDay(period));
  const [label, setLabel] = useState('');
  const [sign, setSign] = useState<1 | -1>(-1);
  const [amount, setAmount] = useState<number | null>(null);
  const [account, setAccount] = useState(defaultAccount ?? accounts[0] ?? 'Compte courant');
  const [category, setCategory] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const ready = !!label.trim() && !!amount && amount > 0 && date.startsWith(period);
  const inputClass = 'rounded-sm border bg-white px-2 py-1 text-[13px] outline-none';
  const caption = (text: string) => (
    <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
      {text}
    </span>
  );

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const ok = await onAdd({
      date,
      label: label.trim(),
      amount: sign * amount!,
      account: account.trim() || 'Compte courant',
      category: category ?? (sign > 0 ? 'autre_revenu' : 'autre_depense')
    });
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <div className="mb-3 rounded-sm border p-3" style={{ borderColor: FIN.line, backgroundColor: FIN.paper }}>
      <div className="flex gap-1.5">
        {(
          [
            [-1, 'Dépense'],
            [1, 'Entrée']
          ] as const
        ).map(([s, text]) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSign(s);
              setCategory(undefined);
            }}
            className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
            style={sign === s ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper } : { borderColor: FIN.line, color: FIN.slate }}
          >
            {text}
          </button>
        ))}
      </div>
      <label className="mt-2 flex flex-col gap-0.5">
        {caption('Libellé')}
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Marché, retrait…" className={inputClass} style={{ borderColor: FIN.line }} />
      </label>
      <div className="mt-2 grid grid-cols-[1fr_110px] gap-2">
        <label className="flex flex-col gap-0.5">
          {caption('Date')}
          <input
            type="date"
            value={date}
            min={`${period}-01`}
            max={lastDay(period)}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
            style={{ borderColor: FIN.line }}
          />
        </label>
        <NumberField label="Montant" value={amount} onChange={(n) => setAmount(n === null ? null : Math.abs(n))} />
      </div>
      <label className="mt-2 flex flex-col gap-0.5">
        {caption('Compte')}
        <select value={account} onChange={(e) => setAccount(e.target.value)} className="fin-select w-full py-1.5 pl-2 text-[13px]">
          {[...new Set([...(accounts.length > 0 ? accounts : ['Compte courant']), 'Espèces'])].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex flex-col gap-0.5">
        {caption('Catégorie')}
        <div className="flex">
          <CategorySelect amount={sign} value={category} onPick={setCategory} />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <FinButton onClick={submit} disabled={!ready || busy}>
          {busy ? 'Ajout…' : 'Ajouter'}
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
    </div>
  );
}

export default function BudgetPage() {
  const [confirm, confirmDialog] = useFinConfirm();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [offset, setOffset] = useState(0);
  const askedMonth = useSyncExternalStore(noSubscribe, readAskedMonth, () => null);
  // Sinon, le mois qu'on regardait sur le Bilan (ou lors de la dernière visite du Budget), sinon le mois précédent
  const [remembered] = useState(rememberedFinanceMonth);
  const startMonth = askedMonth ?? remembered ?? (currentMonth && shiftMonth(currentMonth, -1));
  const period = startMonth ? shiftMonth(startMonth, offset) : null;
  // La teinte de la partie Finances suit l'état de santé du mois affiché
  useViewedMonth(period);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [accountFilter, setAccountFilter] = useState(''); // '' : tous les comptes

  // Données gardées en mémoire entre deux visites (lib/cache) : affichées tout de suite, puis rechargées en arrière-plan.
  // Opérations : une fenêtre de 13 mois (le mois affiché et les 12 d'avant) par mois affiché.
  const txQuery = useCached<TxWindow>(period && `${TX_PREFIX}${period}`, async () => {
    const from = shiftMonth(period!, -12);
    const { transactions, error } = await fetchTransactions(`${from}-01`, lastDay(period!));
    return { from, to: period!, list: orThrow(transactions, error) };
  });
  // Les catégories sont rangées dans CATEGORIES (lib/transactions) : la mémoire garde juste le moment du chargement
  const categoriesQuery = useCached('finances:categories', async () => orThrow(Date.now(), await loadCategories()));

  // En changeant de mois, la fenêtre du mois précédemment affiché contient souvent déjà le nouveau mois :
  // on l'utilise en attendant la sienne
  const shownWindow = txQuery.data ?? latestCached<TxWindow>(TX_PREFIX);
  const loaded = !!period && !!shownWindow && shownWindow.from <= period && period <= shownWindow.to && categoriesQuery.data !== undefined;
  const transactions = useMemo(() => (loaded ? shownWindow.list : []), [loaded, shownWindow]);
  const loadError = txQuery.error ?? categoriesQuery.error;
  const shownError = error ?? (loadError && describeDbError(loadError));

  // Les modifications s'appliquent à toutes les fenêtres d'opérations déjà en mémoire (un même mois peut être dans plusieurs)
  const setTransactions = (update: (ts: Transaction[]) => Transaction[]) => setCachedAll<TxWindow>(TX_PREFIX, (w) => ({ ...w, list: update(w.list) }));

  const monthTx = useMemo(() => transactions.filter((t) => period && monthOf(t.date) === period), [transactions, period]);
  // Chiffres d'indication des cartes (entrées, sorties, reste, en bref, limites, répartition) : sans les créances ni les
  // dettes (prêts aux proches, emprunts et leurs remboursements). La liste des opérations, elle, les garde toutes.
  const debtCategories = useDebtCategories();
  const figureTransactions = useMemo(() => transactions.filter((t) => !debtCategories.has(t.category)), [transactions, debtCategories]);
  const figureTx = useMemo(() => monthTx.filter((t) => !debtCategories.has(t.category)), [monthTx, debtCategories]);
  const history = useMemo(() => figureTransactions.filter((t) => period && monthOf(t.date) < period), [figureTransactions, period]);
  const summary = summarize(figureTx);
  // Dépenses inhabituelles : comptées comme occasionnelles dans la barre fixes / variables / occasionnelles
  const unusual = useMemo(() => detectUnusual(figureTx, history), [figureTx, history]);
  const unusualIds = new Set(unusual.map((t) => t.id));
  const split = splitByKind(figureTx, unusualIds);
  // Mes comptes : ceux des opérations chargées, ceux des relevés importés, et toujours compte courant, Livret A et LEP
  const coverageQuery = useCoverage();
  const accounts = useMemo(() => {
    const list: string[] = [];
    const known = (name: string) => list.some((a) => a.toLowerCase().includes(name.toLowerCase()));
    for (const a of [...transactions.map((t) => t.account), ...(coverageQuery.data?.tracked.map((t) => t.account) ?? [])])
      if (!list.some((x) => x.toLowerCase() === a.toLowerCase())) list.push(a);
    for (const a of ['Compte courant', 'Livret A', 'LEP']) if (!known(a)) list.push(a);
    return list;
  }, [transactions, coverageQuery.data]);

  function report(err: { message: string } | null) {
    if (err) setError(describeDbError(err.message));
  }

  // Après chaque changement d'opérations, le compte de résultat des mois touchés et les lignes du bilan reliées
  // à des catégories se mettent à jour d'eux-mêmes (lib/financeSync)
  async function sync(touched: Transaction[]) {
    report(await syncFinances([...new Set(touched.map((t) => monthOf(t.date)))]));
  }

  // Un changement qui touche aux virements entre mes comptes (ou à un livret) : le Bilan redemande de les vérifier
  function flagTransfers(touched: Pick<Transaction, 'date' | 'account' | 'category'>[], category?: string) {
    const months = touched.filter((t) => category === 'virement_interne' || t.category === 'virement_interne' || isSavingsAccount(t.account)).map((t) => monthOf(t.date));
    if (months.length) flagTransfersToVerify(months);
  }

  async function recategorize(t: Transaction, category: string) {
    flagTransfers([t], category);
    setTransactions((ts) => ts.map((x) => (x.id === t.id ? { ...x, category } : x)));
    const err = await updateCategory([t.id], category);
    if (err) return report(err);
    await sync([t]);
  }

  // Classement depuis « À classer » ; si le choix est retenu, il s'applique à toutes les opérations « Autres »
  // du même commerçant et dans le même sens (tous mois confondus), et aux prochains imports
  async function classifyOther(t: Transaction, category: string, remember: boolean) {
    if (!remember) return recategorize(t, category);
    const key = merchantKey(t.label);
    const isSame = (x: Transaction) => OTHER_IDS.includes(x.category) && merchantKey(x.label) === key && x.amount > 0 === t.amount > 0;
    const touched = transactions.filter(isSame);
    flagTransfers(touched, category);
    const ids = touched.map((x) => x.id);
    setTransactions((ts) => ts.map((x) => (isSame(x) ? { ...x, category } : x)));
    const err = (await updateCategory(ids, category)) ?? (await saveRule(key, category));
    if (err) return report(err);
    // Opérations plus anciennes (hors des 12 derniers mois chargés) : reclassées avec la règle qui vient d'être retenue
    const { changed } = await reclassifyOthers();
    await sync(touched);
    const n = ids.length + changed;
    setNotice(`« ${key} » classé en ${categoryById(category).label} (${n} opération${n > 1 ? 's' : ''}), et retenu pour les prochains imports.`);
  }

  // Mémorise la correction et l'applique à toutes les opérations du même commerçant
  async function alwaysLikeThis(t: Transaction) {
    const key = merchantKey(t.label);
    const same = transactions.filter((x) => merchantKey(x.label) === key && x.category !== t.category);
    flagTransfers(same, t.category);
    setTransactions((ts) => ts.map((x) => (merchantKey(x.label) === key ? { ...x, category: t.category } : x)));
    report(await saveRule(key, t.category));
    if (same.length) report(await updateCategory(same.map((x) => x.id), t.category));
    await sync(same);
    setNotice(`« ${key} » sera toujours classé en ${categoryById(t.category).label} (${same.length} autre${same.length > 1 ? 's' : ''} opération${same.length > 1 ? 's' : ''} corrigée${same.length > 1 ? 's' : ''}).`);
  }

  // Opération ajoutée à la main : rangée dans les fenêtres d'opérations en mémoire qui couvrent son mois
  async function addOperation(fields: ManualFields) {
    const { transaction, error: err } = await addManualTransaction(fields);
    if (err || !transaction) {
      report(err ?? { message: "l'opération n'a pas pu être ajoutée" });
      return false;
    }
    const month = monthOf(transaction.date);
    flagTransfers([transaction]);
    setCachedAll<TxWindow>(TX_PREFIX, (w) =>
      w.from <= month && month <= w.to ? { ...w, list: [transaction, ...w.list].sort((a, b) => b.date.localeCompare(a.date)) } : w
    );
    await sync([transaction]);
    setNotice(`« ${transaction.label} » ajoutée : le compte de résultat de ${monthLabel(month)} est à jour.`);
    return true;
  }

  // Seules les opérations ajoutées à la main se suppriment : celles des relevés font foi
  async function removeOperation(t: Transaction) {
    if (!isManual(t)) return;
    if (!(await confirm("Supprimer l'opération", `Supprimer « ${t.label} » (${formatEuros(t.amount)}), ajoutée à la main ?`))) return;
    flagTransfers([t]);
    setTransactions((ts) => ts.filter((x) => x.id !== t.id));
    const err = await deleteManualTransaction(t.id);
    if (err) return report(err);
    await sync([t]);
  }

  // Liste des opérations : filtrable par compte
  const shownAccount = accounts.includes(accountFilter) ? accountFilter : '';
  const listTx = shownAccount ? monthTx.filter((t) => t.account === shownAccount) : monthTx;
  // Livret sans relevé ce mois-ci : ses opérations sont estimées (et modifiables)
  const estimated =
    !!shownAccount &&
    isSavingsAccount(shownAccount) &&
    !!coverageQuery.data &&
    !coverageQuery.data.covered.includes(`${shownAccount.toLowerCase()}|${period}`);
  const shownTx = showAll ? listTx : listTx.slice(0, 15);

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
          <KeyFigures period={period!} currentMonth={currentMonth} transactions={figureTransactions} fixed={split.fixed} />

          {/* Ce que dit le relevé face aux limites : barre de progression, dépassement et de combien */}
          <BudgetLimits period={period!} currentMonth={currentMonth} monthTx={figureTx} onError={setError} onCategoriesChanged={() => categoriesQuery.reload()} />
          {/* La répartition du revenu choisie pour ce mois, face aux relevés : à titre indicatif */}
          <MonthRepartitionPanel period={period!} currentMonth={currentMonth} monthTx={figureTx} onError={setError} />

          <Panel collapsible title="Liste des opérations" subtitle="Corrige une catégorie si besoin : l'appli peut retenir ta correction pour les fois suivantes.">
            {adding ? (
              <AddOperationForm
                period={period!}
                accounts={accounts}
                defaultAccount={shownAccount || undefined}
                onAdd={addOperation}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="mb-3 flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.accent }}>
                <Plus size={13} /> Ajouter une opération
              </button>
            )}
            <label className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
              Compte
              <select
                value={shownAccount}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="fin-select min-w-0 flex-1 py-1 pl-2 text-[12px] normal-case tracking-normal"
              >
                <option value="">Tous les comptes</option>
                {accounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            {estimated && <EstimatedOperations account={shownAccount} period={period!} accounts={accounts} onSaved={coverageQuery.reload} />}
            {listTx.length === 0 && !estimated && (
              <p className="py-2 text-[11px]" style={{ color: FIN.slate }}>
                Aucune opération sur ce compte ce mois-ci.
              </p>
            )}
            <ul className="divide-y" style={{ borderColor: FIN.line }}>
              {shownTx.map((t) => {
                const cat = categoryById(t.category);
                return (
                  <li key={t.id} className="py-2">
                    <div className="flex items-start justify-between gap-2 text-[12px]">
                      <span className="min-w-0">
                        <span className="block break-words">{t.label}</span>
                        <span className="text-[10px]" style={{ color: FIN.slate }}>
                          {shortDate(t.date)}
                          {!shownAccount && ` · ${t.account}`}
                          {isManual(t) && ' · ajoutée à la main'}
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
                      {/* Suppression réservée aux opérations ajoutées à la main : celles des relevés importés font foi, on ne fait que les classer */}
                      {isManual(t) && (
                        <button
                          type="button"
                          onClick={() => removeOperation(t)}
                          aria-label={`Supprimer ${t.label}`}
                          title="Supprimer cette opération ajoutée à la main"
                          className="shrink-0 opacity-60 hover:opacity-100"
                          style={{ color: FIN.rose }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {listTx.length > 15 && (
              <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
                {showAll ? 'Voir moins' : `Voir les ${listTx.length} opérations`}
              </button>
            )}
          </Panel>
        </>
      )}
    </FinancePage>
  );
}
