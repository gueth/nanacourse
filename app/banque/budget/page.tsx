'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { latestCached, orThrow, setCachedAll, useCached } from '@/lib/cache';
import { CalendarDays, Plus, X } from 'lucide-react';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import {
  addManualTransaction,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  DEFAULT_CATEGORY_IDS,
  deleteManualTransaction,
  fetchTransactions,
  isManual,
  isSavingsAccount,
  loadCategories,
  merchantKey,
  monthOf,
  reclassifyOthers,
  saveRule,
  saveTransactionNote,
  updateCategory,
  type Category,
  type CategoryGroup,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { syncFinances } from '@/lib/financeSync';
import { rememberedFinanceMonth, useViewedMonth } from '@/lib/health';
import { NewCategoryForm } from '@/components/finance/CategoryManager';
import { GroupIcon, TransferIcon } from '@/components/finance/GroupIcon';
import { BudgetLimits } from '@/components/finance/BudgetLimits';
import { KeyFigures } from '@/components/finance/KeyFigures';
import { fetchTxWindow, lastDay, TX_PREFIX, type TxWindow } from '@/components/finance/MonthCashSummary';
import { useCoverage, useDebtCategories } from '@/lib/financeQueries';
import { flagTransfersToVerify } from '@/lib/coverage';
import { EstimatedOperations } from '@/components/finance/EstimatedOperations';
import {
  ErrorNote,
  FIN,
  FinanceHeader,
  FinancePage,
  FinButton,
  FinModal,
  ImportStatementButton,
  NewMonthCard,
  NumberField,
  Panel,
  useFinConfirm
} from '@/components/finance/FinanceParts';


const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
// Mois demandé dans l'adresse (?mois=2026-03), par exemple au retour de la page Gestion
const readAskedMonth = () => new URLSearchParams(window.location.search).get('mois')?.match(/^\d{4}-\d{2}$/)?.[0] ?? null;

const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Filtre par date : une icône calendrier qui ouvre le choix des jours (dans le mois affiché). On touche un premier jour,
// puis un second pour la fin de l'intervalle ; « Valider » sans second jour garde le premier jour et les suivants.
// Popin calendrier aux couleurs de l'appli (le calendrier du téléphone ne se laisse pas habiller) : les jours du mois
// affiché, semaine du lundi au dimanche ; un point sous les jours qui ont des opérations ("marked", AAAA-MM-JJ)
const WEEK_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
// Intervalle de dates (AAAA-MM-JJ) : from '' = toutes les dates ; to '' = jusqu'à la fin du mois
type DateRange = { from: string; to: string };
// « du 1 au 12 oct », « le 13 oct » ou « à partir du 01 oct » (les jours sont toujours dans le mois affiché)
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthShort = (date: string) => shortDate(date).split(' ').slice(1).join(' ').replace('.', '');
const rangeLabel = ({ from, to }: DateRange) =>
  !to
    ? `à partir du ${from.slice(8, 10)} ${monthShort(from)}`
    : to === from
      ? `le ${Number(from.slice(8, 10))} ${monthShort(from)}`
      : `du ${Number(from.slice(8, 10))} au ${Number(to.slice(8, 10))} ${monthShort(to)}`;
// Dates choisies, sous l'icône calendrier : « 12/11/2026 » pour un seul jour, sinon le début et, juste en dessous, la
// fin (sans fin choisie : le dernier jour du mois, on ne sort jamais du mois affiché)
const frDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const endOfMonth = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return `${date.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
function DateFilter({ value, period, marked, onChange }: { value: DateRange; period: string; marked: Set<string>; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  // Choix en cours dans la popin (appliqué au second jour touché, ou avec « Valider »)
  const [draft, setDraft] = useState<DateRange>(value);
  const [year, month] = period.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7; // cases vides avant le 1er (semaine du lundi)
  const dateOf = (day: number) => `${period}-${String(day).padStart(2, '0')}`;
  function apply(range: DateRange) {
    onChange(range);
    setOpen(false);
  }
  // Premier jour touché : le début ; second (le même jour ou après) : la fin, et la popin se ferme ; un jour d'avant
  // le début recommence l'intervalle
  function pick(date: string) {
    if (!draft.from || draft.to || date < draft.from) setDraft({ from: date, to: '' });
    else apply({ from: draft.from, to: date });
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        aria-label="Filtrer par dates"
        title="Filtrer par dates"
        className="flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-sm border"
        style={value.from ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper } : { borderColor: FIN.line, color: FIN.accent, backgroundColor: 'white' }}
      >
        <CalendarDays size={16} />
      </button>
      {open && (
        <FinModal title="Dates" onClose={() => setOpen(false)}>
          <p className="mb-3 text-center text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
            {monthLabel(period)}
          </p>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK_DAYS.map((d, i) => (
              <span key={i} className="pb-1 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
                {d}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={`vide-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const date = dateOf(i + 1);
              // Début et fin de l'intervalle : pleins ; jours entre les deux (ou après le début, sans fin) : légèrement teintés
              const chosen = date === draft.from || date === draft.to;
              const kept = !!draft.from && date > draft.from && (!draft.to || date < draft.to);
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => pick(date)}
                  aria-pressed={chosen}
                  className="relative flex aspect-square items-center justify-center rounded-full border text-[12px]"
                  style={
                    chosen
                      ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper, fontWeight: 700 }
                      : { borderColor: kept ? FIN.line : 'transparent', backgroundColor: kept ? FIN.mist : 'transparent', color: FIN.navy }
                  }
                >
                  {i + 1}
                  {marked.has(date) && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ backgroundColor: chosen ? FIN.paper : FIN.gold }} aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            {!draft.from
              ? 'Touche le premier jour, puis le dernier. Un point marque les jours qui ont des transactions.'
              : !draft.to
                ? `${capitalized(rangeLabel(draft))} : touche le dernier jour, ou valide pour garder tous les jours suivants.`
                : `${capitalized(rangeLabel(draft))}. Touche un jour pour recommencer.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {draft.from && <FinButton onClick={() => apply(draft)}>Valider</FinButton>}
            {value.from && (
              <FinButton outline onClick={() => apply({ from: '', to: '' })}>
                Tous les jours
              </FinButton>
            )}
            <FinButton outline onClick={() => setOpen(false)}>
              Fermer
            </FinButton>
          </div>
        </FinModal>
      )}
    </>
  );
}

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

// Grande catégorie d'une catégorie (null : sans regroupement)
const groupOf = (categoryId: string) => {
  const id = categoryById(categoryId).group;
  return (id && categoryGroups().find((g) => g.id === id)) || null;
};

// Popin « Modifier une transaction », ouverte en touchant l'icône d'une transaction : son libellé, sa date et son compte,
// puis sa catégorie en deux listes (la grande catégorie, puis la catégorie de celle-ci). Le choix vaut toujours pour ce
// commerçant (et les prochains relevés) : à partir du mois de la transaction, ou sur tous les mois, même passés.
// 'month' : ce commerçant dans le mois de la transaction seulement ; 'all' : tous les mois, passés et à venir
type ClassifyScope = 'one' | 'month' | 'all';
const NO_GROUP = 'sans';
function ClassifyModal({
  transaction: t,
  busy,
  onClassify,
  onClose
}: {
  transaction: Transaction;
  busy: boolean;
  onClassify: (category: string, scope: ClassifyScope, note: string) => void;
  onClose: () => void;
}) {
  const choices = groupedChoices(choicesFor(t.amount, t.category));
  // Note de la transaction : propre à elle seule, quel que soit le bouton choisi
  const [note, setNote] = useState(t.note ?? '');
  const noteChanged = note.trim() !== (t.note ?? '').trim();
  const [group, setGroup] = useState<string>(categoryById(t.category).group ?? NO_GROUP);
  const [category, setCategory] = useState(t.category);
  const inGroup = choices.find((g) => (g.group?.id ?? NO_GROUP) === group)?.list ?? [];
  // Une ligne d'information : l'intitulé puis la valeur, à la suite dans le même texte (une valeur longue revient à la
  // ligne sous l'intitulé, pas dans une colonne à part)
  const info = (label: string, value: React.ReactNode) => (
    <p className="break-words border-b py-1.5 text-[12px]" style={{ borderColor: FIN.line, color: FIN.navy }}>
      <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label} :
      </span>{' '}
      <b>{value}</b>
    </p>
  );
  return (
    <FinModal title="Modifier une transaction" onClose={() => !busy && onClose()}>
      <div className="mt-1">
        {info('Libellé de la transaction', t.label)}
        {/* Montant : vert pour une entrée, rouge pour une sortie */}
        {info('Montant', <span style={{ color: t.amount > 0 ? FIN.sage : FIN.rose }}>{formatEuros(t.amount)}</span>)}
        {info('Date', shortDate(t.date))}
        {info('Type de compte', t.account)}
      </div>

      {/* Catégorie : la grande catégorie, puis la catégorie */}
      <p className="mb-1 mt-4 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        Catégorie
      </p>
      <div className="flex items-center gap-2">
        <GroupIcon group={choices.find((g) => (g.group?.id ?? NO_GROUP) === group)?.group ?? null} size={30} />
        <select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            const list = choices.find((g) => (g.group?.id ?? NO_GROUP) === e.target.value)?.list ?? [];
            setCategory(list.some((c) => c.id === t.category) ? t.category : list.length === 1 ? list[0].id : '');
          }}
          aria-label="Grande catégorie"
          className="fin-select min-w-0 flex-1 py-2 pl-2 text-[12px]"
        >
          {choices.map(({ group: g }) => (
            <option key={g?.id ?? NO_GROUP} value={g?.id ?? NO_GROUP}>
              {g ? g.label : 'Sans grande catégorie'}
            </option>
          ))}
        </select>
      </div>
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie" className="fin-select mt-2 w-full py-2 pl-2 text-[12px]">
        {!inGroup.some((c) => c.id === category) && <option value="">Choisir une catégorie…</option>}
        {inGroup.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      {/* Note : affichée sous le libellé, dans la liste */}
      <label className="mt-4 block">
        <span className="mb-1 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
          Note
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="Ajouter une note (facultatif)"
          className="w-full resize-none rounded-[2px] border border-[#c9d2df] bg-[#f8f7f4] px-2 py-1.5 text-[12px] text-[#2b3a55] outline-none focus:border-[var(--fin-accent,#5e5b57)]"
        />
      </label>

      <div className="mt-5 flex flex-col gap-2">
        {/* Cette transaction seule ; celles du même commerçant ce mois-ci ; ou sur tous les mois (et les prochains relevés) */}
        <FinButton onClick={() => onClassify(category, 'one', note)} disabled={busy || !category || (category === t.category && !noteChanged)}>
          Modifier cette transaction uniquement
        </FinButton>
        <FinButton onClick={() => onClassify(category, 'month', note)} disabled={busy || !category}>
          Modifier toutes les transactions de ce mois
        </FinButton>
        <FinButton onClick={() => onClassify(category, 'all', note)} disabled={busy || !category}>
          Modifier les transactions de tous les mois
        </FinButton>
        <FinButton outline onClick={onClose} disabled={busy}>
          Annuler
        </FinButton>
      </div>
      {busy && (
        <p className="mt-3 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          Enregistrement en cours…
        </p>
      )}
    </FinModal>
  );
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
    // Contenu de la popin « Ajouter une transaction »
    <div>
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

// Filtres de la liste de transactions, gardés tant que l'appli reste ouverte : changer de mois, aller au Bilan ou
// ailleurs dans les Finances puis revenir ne les efface pas
type AmountOp = 'eq' | 'gte' | 'lte';
type TxFilters = { account: string; range: DateRange; flow: '' | 'in' | 'out'; category: string; amountOp: AmountOp; amount: string };
const KEPT_FILTERS: TxFilters = { account: '', range: { from: '', to: '' }, flow: '', category: '', amountOp: 'eq', amount: '' };
function useKeptFilter<K extends keyof TxFilters>(key: K) {
  const [value, setValue] = useState<TxFilters[K]>(KEPT_FILTERS[key]);
  const set = (next: TxFilters[K]) => {
    KEPT_FILTERS[key] = next;
    setValue(next);
  };
  return [value, set] as const;
}

export default function BudgetPage() {
  const [confirm, confirmDialog] = useFinConfirm();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  // Mois choisi avec les flèches
  const [chosen, setChosen] = useState<string | null>(null);
  const askedMonth = useSyncExternalStore(noSubscribe, readAskedMonth, () => null);
  // Sinon, le mois qu'on regardait sur le Bilan (ou lors de la dernière visite du Budget), sinon le mois précédent
  // (aussi après avoir actualisé la page)
  const remembered = useSyncExternalStore(noSubscribe, rememberedFinanceMonth, () => null);
  const period = chosen ?? askedMonth ?? remembered ?? (currentMonth && shiftMonth(currentMonth, -1));
  // La teinte de la partie Finances suit l'état de santé du mois affiché
  useViewedMonth(period);
  // Changement de mois avec les flèches : le mois demandé dans l'adresse (?mois=) est retiré, pour qu'en actualisant la
  // page on revienne au mois qu'on regardait
  function pickMonth(month: string) {
    setChosen(month);
    if (askedMonth) window.history.replaceState(window.history.state, '', window.location.pathname);
  }

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  // Transaction dont la popin de classement est ouverte (depuis son icône)
  const [classifying, setClassifying] = useState<Transaction | null>(null);
  // Reclassement en cours depuis la popin de classement
  const [alwaysBusy, setAlwaysBusy] = useState(false);
  // Filtres de la liste : gardés en mémoire (KEPT_FILTERS) quand on change de mois ou qu'on va ailleurs dans les Finances
  const [accountFilter, setAccountFilter] = useKeptFilter('account'); // '' : tous les comptes
  // Dates gardées par la liste : un intervalle, ou un jour et les suivants (from '' : toutes)
  const [dateRange, setDateRange] = useKeptFilter('range');
  const [flowFilter, setFlowFilter] = useKeptFilter('flow'); // '' : entrées et sorties
  const [categoryFilter, setCategoryFilter] = useKeptFilter('category'); // '' : toutes ; sinon une grande catégorie, 'sans' ou 'virements'
  // Filtre par montant : égal, supérieur ou égal, ou inférieur ou égal à ce montant (sans signe ; le sens se
  // choisit à part). '' : aucun. Appliqué avec « Valider » (ou Entrée) : la saisie en cours reste à part
  const [amountOp, setAmountOp] = useKeptFilter('amountOp');
  const [amountFilter, setAmountFilter] = useKeptFilter('amount');
  const [amountDraft, setAmountDraft] = useState(amountFilter);
  const [amountOpDraft, setAmountOpDraft] = useState(amountOp);
  const applyAmount = () => {
    setAmountFilter(amountDraft);
    setAmountOp(amountOpDraft);
  };
  // Reset : tous les filtres de la liste reviennent à zéro
  const resetFilters = () => {
    setAccountFilter('');
    setDateRange({ from: '', to: '' });
    setFlowFilter('');
    setCategoryFilter('');
    setAmountFilter('');
    setAmountOp('eq');
    setAmountDraft('');
    setAmountOpDraft('eq');
  };

  // Données gardées en mémoire entre deux visites (lib/cache) : affichées tout de suite, puis rechargées en arrière-plan.
  // Opérations : une fenêtre de 13 mois (le mois affiché et les 12 d'avant) par mois affiché.
  const txQuery = useCached<TxWindow>(period && `${TX_PREFIX}${period}`, () => fetchTxWindow(period!));
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
  // Chiffres d'indication des cartes (entrées, sorties, reste, en bref, limites, répartition) : sans les opérations qui vont
  // au bilan (connecteurs vers créances, emprunts ou dettes, à partir de leur mois de départ). La liste des opérations, elle, les garde toutes.
  const isDebtTx = useDebtCategories();
  const figureTransactions = useMemo(() => transactions.filter((t) => !isDebtTx(t)), [transactions, isDebtTx]);
  const figureTx = useMemo(() => monthTx.filter((t) => !isDebtTx(t)), [monthTx, isDebtTx]);
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
  // à des catégories se mettent à jour d'eux-mêmes (lib/financeSync), en arrière-plan : la liste est déjà à jour à
  // l'écran, on n'attend pas la fin du recalcul pour rendre la main
  function sync(touched: Transaction[]) {
    void syncFinances([...new Set(touched.map((t) => monthOf(t.date)))]).then(report);
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
    sync([t]);
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
    sync(touched);
    const n = ids.length + changed;
    setNotice(`« ${key} » classé en ${categoryById(category).label} (${n} opération${n > 1 ? 's' : ''}), et retenu pour les prochains imports.`);
  }

  // Choix fait dans la popin de classement : la transaction passe dans la catégorie choisie, avec les autres transactions
  // du même commerçant : celles du même mois seulement (scope 'month', sans règle : les autres mois et les prochains
  // relevés ne changent pas), ou celles de tous les mois, passés et futurs ('all' : la règle vaut aussi pour les
  // prochains relevés)
  async function classifyTransaction(t: Transaction, category: string, scope: ClassifyScope, note: string) {
    setAlwaysBusy(true);
    // Note : pour cette transaction seulement
    if (note.trim() !== (t.note ?? '').trim()) {
      const err = await saveTransactionNote(t.id, note);
      if (err) {
        setAlwaysBusy(false);
        return report(err);
      }
      setTransactions((ts) => ts.map((x) => (x.id === t.id ? { ...x, note: note.trim() || null } : x)));
    }
    if (category !== t.category) await recategorize(t, category);
    if (scope === 'one') setAlwaysBusy(false);
    else await alwaysLikeThis({ ...t, category }, scope);
    setClassifying(null);
  }

  async function alwaysLikeThis(t: Transaction, scope: 'month' | 'all') {
    setAlwaysBusy(true);
    const key = merchantKey(t.label);
    const { transactions: stored, error: fetchErr } = await fetchTransactions(
      scope === 'all' ? '0001-01-01' : `${monthOf(t.date)}-01`,
      scope === 'all' ? '9999-12-31' : lastDay(monthOf(t.date))
    );
    if (fetchErr) {
      setAlwaysBusy(false);
      return report(fetchErr);
    }
    const same = stored.filter((x) => x.id !== t.id && merchantKey(x.label) === key && x.category !== t.category);
    const ids = new Set(same.map((x) => x.id));
    flagTransfers(same, t.category);
    setTransactions((ts) => ts.map((x) => (ids.has(x.id) ? { ...x, category: t.category } : x)));
    if (scope === 'all') report(await saveRule(key, t.category));
    if (same.length) report(await updateCategory([...ids], t.category));
    sync(same);
    setAlwaysBusy(false);
    const others = `${same.length} autre${same.length > 1 ? 's' : ''} transaction${same.length > 1 ? 's' : ''} reclassée${same.length > 1 ? 's' : ''}`;
    setNotice(
      scope === 'all'
        ? `« ${key} » sera toujours classé en ${categoryById(t.category).label} : ${others} sur tous les mois.`
        : `« ${key} » classé en ${categoryById(t.category).label} pour ${monthLabel(monthOf(t.date))} : ${others} ce mois-ci.`
    );
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
    sync([transaction]);
    setNotice(`« ${transaction.label} » ajoutée : le compte de résultat de ${monthLabel(month)} se met à jour.`);
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
    sync([t]);
  }

  // Liste des opérations : filtrable par compte et par dates (un intervalle, ou un jour et les suivants)
  const shownAccount = accounts.includes(accountFilter) ? accountFilter : '';
  // Changer de mois garde les mêmes jours (du 1 au 12), reportés dans le mois affiché (le 31 devient le dernier jour du mois)
  const inPeriod = (date: string) => {
    if (!period || monthOf(date) === period) return date;
    const last = endOfMonth(`${period}-01`);
    return `${period}-${String(Math.min(Number(date.slice(8, 10)), Number(last.slice(8, 10)))).padStart(2, '0')}`;
  };
  const shownRange: DateRange = period && dateRange.from ? { from: inPeriod(dateRange.from), to: dateRange.to && inPeriod(dateRange.to) } : { from: '', to: '' };
  const shownFrom = shownRange.from;
  const inRange = (t: Transaction) => !shownFrom || (t.date >= shownFrom && (!shownRange.to || t.date <= shownRange.to));
  // Sens : entrée (montant positif) ou sortie (négatif)
  const flowOk = (t: Transaction) => !flowFilter || (flowFilter === 'in' ? t.amount > 0 : t.amount < 0);
  // Filtre par grande catégorie : toutes, même sans transaction ce mois-ci (dans le sens choisi s'il y en a un) ; les
  // virements entre mes comptes et les catégories sans grande catégorie ont chacun leur choix, en fin de liste
  const filterKeyOf = (t: Transaction) => (categoryById(t.category).kind === 'transfer' ? 'virements' : (groupOf(t.category)?.id ?? 'sans'));
  const usedGroups = categoryGroups()
    .filter((g) => !flowFilter || (flowFilter === 'in') === (g.kind === 'income'))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const filterGroups = [
    // Même nom en sorties et en entrées : le sens est précisé
    ...usedGroups.map((g) => ({
      id: g.id,
      label: usedGroups.some((o) => o.id !== g.id && o.label === g.label) ? `${g.label} (${g.kind === 'income' ? 'entrées' : 'sorties'})` : g.label
    })),
    { id: 'sans', label: 'Sans grande catégorie' },
    { id: 'virements', label: 'Virements entre mes comptes' }
  ];
  const shownCategory = filterGroups.some((g) => g.id === categoryFilter) ? categoryFilter : '';
  // Montant saisi (virgule ou point) : comparé au montant de l'opération sans son signe, au centime près
  const amountValue = amountFilter.trim() === '' ? null : Number(amountFilter.replace(/s/g, '').replace(',', '.'));
  const shownAmount = amountValue !== null && Number.isFinite(amountValue) ? Math.round(Math.abs(amountValue) * 100) : null;
  const amountOk = (t: Transaction) => {
    if (shownAmount === null) return true;
    const cents = Math.round(Math.abs(t.amount) * 100);
    return amountOp === 'gte' ? cents >= shownAmount : amountOp === 'lte' ? cents <= shownAmount : cents === shownAmount;
  };
  const filteredTx = monthTx.filter(
    (t) => (!shownAccount || t.account === shownAccount) && inRange(t) && flowOk(t) && (!shownCategory || filterKeyOf(t) === shownCategory) && amountOk(t)
  );
  // Dates choisies : la liste commence par les transactions du premier jour, puis va vers les suivants
  const listTx = shownFrom ? [...filteredTx].sort((a, b) => a.date.localeCompare(b.date)) : filteredTx;
  // Livret sans relevé ce mois-ci : ses opérations sont estimées (et modifiables)
  const estimated =
    !!shownAccount &&
    isSavingsAccount(shownAccount) &&
    !!coverageQuery.data &&
    !coverageQuery.data.covered.includes(`${shownAccount.toLowerCase()}|${period}`);
  const shownTx = showAll ? listTx : listTx.slice(0, 15);
  // Comptes sans relevé importé ce mois-ci : seuls ceux-là reçoivent des transactions ajoutées à la main
  const uncovered = coverageQuery.data ? accounts.filter((a) => !coverageQuery.data!.covered.includes(`${a.toLowerCase()}|${period}`)) : [];
  const canAdd = shownAccount ? uncovered.includes(shownAccount) : uncovered.length > 0;

  return (
    <FinancePage
      header={
        <FinanceHeader
          subtitle="budget · opérations"
          month={period ? monthLabel(period) : ''}
          onPrev={() => period && pickMonth(shiftMonth(period, -1))}
          onNext={() => period && currentMonth && period < currentMonth && pickMonth(shiftMonth(period, 1))}
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

      {/* Pendant le chargement, la page est déjà là, vide (sans opérations), et se remplit ensuite : les cartes et les
          boutons n'apparaissent pas d'un coup */}
      {!period ? null : loaded && monthTx.length === 0 && period !== currentMonth ? (
        // Mois passé sans relevé importé : les Finances retranscrivent le passé, on importe donc son relevé
        <NewMonthCard period={period} />
      ) : (
        <>
          {/* Mois en cours sans relevé : seulement le bouton d'import, la page suit sans données */}
          {loaded && monthTx.length === 0 && <ImportStatementButton period={period} />}
          {/* Entrées, sorties, reste et dépenses fixes / variables / occasionnelles : sur le Bilan, onglet Compte de résultat */}
          <OthersPanel items={monthTx.filter((t) => OTHER_IDS.includes(t.category))} onClassify={classifyOther} />
          <KeyFigures period={period!} transactions={figureTransactions} />

          {/* Ce que dit le relevé face aux limites : barre de progression, dépassement et de combien */}
          <BudgetLimits period={period!} currentMonth={currentMonth} monthTx={figureTx} onError={setError} onCategoriesChanged={() => categoriesQuery.reload()} />

          {/* Popin de classement, ouverte depuis l'icône d'une transaction */}
          {classifying && (
            <ClassifyModal transaction={classifying} busy={alwaysBusy} onClassify={(c, scope, note) => classifyTransaction(classifying, c, scope, note)} onClose={() => setClassifying(null)} />
          )}
          {/* Popin « Ajouter une transaction » : hors de la carte, pour s'ouvrir même quand celle-ci est pliée */}
          {adding && (
            <FinModal title="Ajouter une transaction" onClose={() => setAdding(false)}>
              <AddOperationForm
                period={period!}
                accounts={uncovered.length ? uncovered : accounts}
                defaultAccount={shownAccount && uncovered.includes(shownAccount) ? shownAccount : undefined}
                onAdd={addOperation}
                onCancel={() => setAdding(false)}
              />
            </FinModal>
          )}
          <Panel
            collapsible
            title="Liste de transactions"
            action={
              // À droite du titre, seulement pour les comptes sans relevé ce mois-ci ; ouvre la popin sans plier ni déplier la carte
              canAdd && !adding ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setAdding(true);
                  }}
                  aria-label="Ajouter une transaction"
                  title="Ajouter une transaction"
                  className="mt-2 flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.15em]"
                  style={{ borderColor: FIN.accent, color: FIN.accent }}
                >
                  <Plus size={12} /> Ajouter
                </button>
              ) : undefined
            }
          >
            {/* Filtres, dans l'ordre : calendrier, les dates choisies juste à sa droite, puis le type de compte. La place des
                dates est toujours réservée : le type de compte ne bouge pas quand on en choisit ou en retire */}
            <div className="mb-2 flex items-end gap-1.5">
              <DateFilter value={shownRange} period={period!} marked={new Set(monthTx.map((t) => t.date))} onChange={setDateRange} />
              <span className="flex h-[30px] w-[74px] shrink-0 items-center gap-1 text-[10px] leading-tight tabular-nums" style={{ color: FIN.slate }}>
              {shownFrom && (
                <>
                  <span className="flex min-w-0 flex-col">
                    <span>{frDate(shownFrom)}</span>
                    {(shownRange.to || endOfMonth(shownFrom)) !== shownFrom && <span>{frDate(shownRange.to || endOfMonth(shownFrom))}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDateRange({ from: '', to: '' })}
                    aria-label="Retirer le filtre de dates"
                    className="shrink-0"
                    style={{ color: FIN.accent }}
                  >
                    <X size={13} />
                  </button>
                </>
              )}
              {/* Aucune date choisie : le format attendu, en pâle */}
              {!shownFrom && <span style={{ opacity: 0.5 }}>jj/mm/aaaa</span>}
              </span>
              <label className="min-w-0 flex-1">
                <span className="mb-0.5 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  Type de compte
                </span>
                <select value={shownAccount} onChange={(e) => setAccountFilter(e.target.value)} className="fin-select w-full py-1 pl-2 text-[12px]">
                  <option value="">Tous les comptes</option>
                  {accounts.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* Dessous : le sens (entrée ou sortie), puis la grande catégorie (celles du mois, dans ce sens) */}
            <div className="mb-2 grid grid-cols-[2fr_3fr] gap-2">
              <label className="min-w-0">
                <span className="mb-0.5 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  Entrée ou sortie
                </span>
                <select value={flowFilter} onChange={(e) => setFlowFilter(e.target.value as '' | 'in' | 'out')} className="fin-select w-full py-1 pl-2 text-[12px]">
                  <option value="">Toutes</option>
                  <option value="in">Entrées</option>
                  <option value="out">Sorties</option>
                </select>
              </label>
              <label className="min-w-0">
                <span className="mb-0.5 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  Grande catégorie
                </span>
                <select value={shownCategory} onChange={(e) => setCategoryFilter(e.target.value)} className="fin-select w-full py-1 pl-2 text-[12px]">
                  <option value="">Toutes</option>
                  {filterGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* Montant : égal, supérieur ou égal, ou inférieur ou égal à la somme saisie, appliqué avec « Valider » ;
                « Reset » remet tous les filtres à zéro. Les deux champs se partagent la ligne, les boutons sont centrés en dessous */}
            <form
              className="mb-2"
              onSubmit={(e) => {
                e.preventDefault();
                applyAmount();
              }}
            >
              <div className="flex items-end gap-1.5">
              <label className="min-w-0 flex-1">
                <span className="mb-0.5 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  Montant
                </span>
                <select
                  value={amountOpDraft}
                  onChange={(e) => setAmountOpDraft(e.target.value as AmountOp)}
                  aria-label="Comparaison du montant"
                  className="fin-select w-full py-1 pl-2 text-[12px]"
                >
                  <option value="eq">Égal</option>
                  <option value="gte">Supérieur ou égal</option>
                  <option value="lte">Inférieur ou égal</option>
                </select>
              </label>
              <label className="min-w-0 flex-1">
                <span className="mb-0.5 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  Somme en €
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  placeholder="Tous"
                  className="w-full min-w-0 rounded-[2px] border border-[#c9d2df] bg-[#f8f7f4] py-1 pl-2 pr-1 text-[12px] text-[#2b3a55] outline-none focus:border-[var(--fin-accent,#5e5b57)]"
                />
              </label>
              </div>
              <div className="mt-2.5 flex justify-center gap-6">
                <button
                  type="submit"
                  disabled={amountDraft === amountFilter && amountOpDraft === amountOp}
                  className="min-w-[88px] rounded-full border px-4 py-1 text-[9px] uppercase tracking-[0.15em] text-white disabled:opacity-40"
                  style={{ borderColor: FIN.accent, backgroundColor: FIN.accent }}
                >
                  Valider
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  title="Remettre tous les filtres à zéro"
                  className="min-w-[88px] rounded-full border px-4 py-1 text-[9px] uppercase tracking-[0.15em]"
                  style={{ borderColor: FIN.accent, color: FIN.accent }}
                >
                  Reset
                </button>
              </div>
            </form>
            {/* Séparation entre les filtres et le début de la liste */}
            <hr className="mb-3 mt-2 h-[2px] rounded-full border-0" style={{ backgroundColor: FIN.accent, opacity: 0.55 }} />
            {estimated && <EstimatedOperations account={shownAccount} period={period!} accounts={accounts} onSaved={coverageQuery.reload} />}
            {loaded && listTx.length === 0 && !estimated && (
              <p className="py-2 text-[11px]" style={{ color: FIN.slate }}>
                {shownFrom || flowFilter || shownCategory || shownAmount !== null ? 'Aucune transaction ne correspond à la recherche.' : 'Aucune transaction sur ce compte ce mois-ci.'}
              </p>
            )}
            <ul className="divide-y" style={{ borderColor: FIN.line }}>
              {shownTx.map((t) => {
                const cat = categoryById(t.category);
                return (
                  // Toute la ligne ouvre la popin « Modifier une transaction » (catégorie et note)
                  <li
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setClassifying(t)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setClassifying(t);
                      }
                    }}
                    aria-label={`Modifier ${t.label}`}
                    className="flex cursor-pointer items-start gap-2.5 py-2"
                  >
                    {/* Icône de la grande catégorie (virement entre mes comptes : une barre dans un rond bleu) */}
                    <span className="mt-0.5 shrink-0 rounded-full" title={groupOf(t.category)?.label}>
                      {cat.kind === 'transfer' ? <TransferIcon size={34} /> : <GroupIcon group={groupOf(t.category)} size={34} />}
                    </span>
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2 text-[12px]">
                      <span className="min-w-0">
                        {/* Au-dessus du nom : date, catégorie (elle se change en touchant l'icône), compte */}
                        <span className="block text-[10px]" style={{ color: FIN.slate }}>
                          {/* Date en gras, sans point après le mois (« 29 oct ») */}
                          <b className="font-semibold" style={{ color: FIN.navy }}>
                            {shortDate(t.date).replace('.', '')}
                          </b>
                          {' · '}
                          <span style={OTHER_IDS.includes(t.category) ? { color: FIN.gold } : undefined}>{cat.label}</span>
                          {!shownAccount && ` · ${t.account}`}
                          {isManual(t) && ' · ajoutée à la main'}
                        </span>
                        <span className="block break-words">{t.label}</span>
                        {/* Note, sous le libellé : plus petite et en gris clair */}
                        {t.note && (
                          <span className="block break-words text-[10px] leading-snug" style={{ color: FIN.slate, opacity: 0.75 }}>
                            {t.note}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <b style={{ color: cat.kind === 'transfer' ? FIN.slate : t.amount > 0 ? FIN.sage : FIN.navy }}>{formatEuros(t.amount)}</b>
                        {/* Suppression réservée aux opérations ajoutées à la main : celles des relevés importés font foi, on ne fait que les classer */}
                        {isManual(t) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeOperation(t);
                            }}
                            aria-label={`Supprimer ${t.label}`}
                            title="Supprimer cette opération ajoutée à la main"
                            className="opacity-60 hover:opacity-100"
                            style={{ color: FIN.rose }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </span>
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
