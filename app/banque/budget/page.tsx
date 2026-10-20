'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, FileUp, Repeat, Trash2, X } from 'lucide-react';
import { formatEuros, monthKey, monthLabel, SECTIONS, shiftMonth } from '@/lib/finance';
import { parseStatement, readStatementFile, type ParseResult } from '@/lib/bankImport';
import { readPdfStatement } from '@/lib/bankPdf';
import {
  addCustomCategory,
  addPlanned,
  byLabel,
  CATEGORIES,
  categoryById,
  completeFromStatement,
  deleteCategory,
  DEFAULT_CATEGORY_IDS,
  deletePlanned,
  deleteTransaction,
  detectSubscriptions,
  detectUnusual,
  fetchBudgets,
  fetchPlanned,
  fetchTransactions,
  importTransactions,
  loadCategories,
  merchantKey,
  monthOf,
  reclassifyOthers,
  removedBaseCategories,
  restoreBaseCategories,
  reportToStatement,
  saveBudget,
  saveRule,
  splitByKind,
  spendingInsights,
  summarize,
  updateCategory,
  type Budget,
  type Category,
  type CustomCategory,
  type PlannedExpense,
  type Transaction
} from '@/lib/transactions';
import { describeDbError, syncSavingsAccount } from '@/lib/financePlans';
import {
  ErrorNote,
  FIN,
  FinanceHeader,
  FinancePage,
  FinButton,
  Meter,
  NumberField,
  Panel,
  SummaryTile
} from '@/components/finance/FinanceParts';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Import d'un relevé : choix du fichier, aperçu, puis enregistrement
function ImportPanel({ accounts, onImported }: { accounts: string[]; onImported: (message: string, month?: string) => void }) {
  const [parsed, setParsed] = useState<(ParseResult & { name: string }) | null>(null);
  const [account, setAccount] = useState('Compte courant');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    let result: ParseResult;
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      result = isPdf ? await readPdfStatement(file) : parseStatement(await readStatementFile(file));
    } catch (e) {
      console.error(e);
      setReading(false);
      setParsed(null);
      setError("Ce fichier n'a pas pu être lu. Un PDF protégé par mot de passe ou scanné (une photo du relevé) ne contient pas de texte lisible : télécharge le relevé depuis ton espace client, ou exporte tes opérations en CSV.");
      return;
    }
    setReading(false);
    if (result.transactions.length === 0) {
      setParsed(null);
      setError("Aucune opération reconnue dans ce fichier. Vérifie qu'il s'agit bien d'un relevé de compte en PDF, ou d'un export CSV ou OFX de ta banque.");
      return;
    }
    setParsed({ ...result, name: file.name });
    // Nom du compte reconnu d'après le titre du relevé (« Livret A », « LEP »...)
    if (result.summary?.accountName) setAccount(result.summary.accountName);
  }

  async function confirm() {
    if (!parsed) return;
    const name = account.trim() || 'Compte courant';
    setBusy(true);
    const { inserted, error: err } = await importTransactions(parsed.transactions, name);
    if (err) {
      setBusy(false);
      return setError(describeDbError(err.message));
    }
    const dupes = parsed.transactions.length - inserted;
    let message = `${inserted} opération${inserted > 1 ? 's' : ''} importée${inserted > 1 ? 's' : ''}${dupes ? `, ${dupes} déjà présente${dupes > 1 ? 's' : ''} ignorée${dupes > 1 ? 's' : ''}` : ''}.`;
    if (complete) {
      const done = await completeFromStatement(name, parsed.transactions, parsed.summary);
      if (done.error) {
        setBusy(false);
        return setError(describeDbError(done.error.message));
      }
      message += done.filled.length
        ? ` Compte de résultat mis à jour pour ${done.filled.map(monthLabel).join(', ')}.`
        : ' Compte de résultat déjà à jour.';
      if (done.kept) message += ` ${done.kept} ligne${done.kept > 1 ? 's' : ''} saisie${done.kept > 1 ? 's' : ''} à la main gardée${done.kept > 1 ? 's' : ''} telle${done.kept > 1 ? 's' : ''} quelle${done.kept > 1 ? 's' : ''}.`;
      if (done.balances) message += ` Soldes de fin de mois inscrits au bilan (ligne « ${name} »), sauf là où tu les avais saisis toi-même.`;
    }
    // Relevé de livret : la valeur du livret est aussi mise à jour dans les placements
    if (parsed.summary?.savings && parsed.summary.closing != null && parsed.summary.to) {
      const { created, error: err3 } = await syncSavingsAccount(name, parsed.summary.closing, parsed.summary.to);
      message += err3
        ? ` (Placements non mis à jour : ${describeDbError(err3.message)})`
        : ` « ${name} » ${created ? 'ajouté aux' : 'mis à jour dans les'} placements.`;
    }
    // Mois où tombent le plus d'opérations du relevé : la page s'y place pour les afficher
    const counts = new Map<string, number>();
    for (const t of parsed.transactions) counts.set(monthOf(t.date), (counts.get(monthOf(t.date)) ?? 0) + 1);
    const month = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
    if (month) message += ` Affichage de ${monthLabel(month)}.`;
    setBusy(false);
    setParsed(null);
    onImported(message, month);
  }

  // Reclasse les opérations restées en « Autres » avec les catégories et mots-clés actuels
  async function reclassify() {
    setBusy(true);
    const { changed, error: err } = await reclassifyOthers();
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    onImported(changed ? `${changed} opération${changed > 1 ? 's' : ''} « Autres » reclassée${changed > 1 ? 's' : ''}.` : 'Aucune opération « Autres » de plus n’a pu être classée.');
  }

  const tx = parsed?.transactions ?? [];
  const dates = tx.map((t) => t.date).sort();
  const income = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spent = tx.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const summary = parsed?.summary;
  const exchangeFees = tx.filter((t) => t.label.startsWith('COM CHANGE')).reduce((s, t) => s - t.amount, 0);
  const ownTransfers = tx.filter((t) => t.category === 'virement_interne').length;

  return (
    <Panel title="Importer un relevé" subtitle="Le fichier est lu sur ton appareil : rien n'est envoyé à ta banque ni à un service extérieur. Seules les opérations sont enregistrées dans ta base.">
      <ErrorNote message={error} />
      {!parsed ? (
        <>
          <label className="mt-2 flex cursor-pointer flex-col items-center gap-1 rounded-sm border border-dashed px-3 py-5 text-center" style={{ borderColor: FIN.slate, color: FIN.slate }}>
            <FileUp size={22} />
            <span className="text-[11px] uppercase tracking-[0.2em]">{reading ? 'Lecture du relevé…' : 'Choisir un relevé PDF, CSV ou OFX'}</span>
            <input
              type="file"
              accept=".pdf,application/pdf,.csv,.ofx,.qfx,.txt,text/csv"
              className="hidden"
              disabled={reading}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <div className="mt-2 flex justify-between gap-2">
            <button type="button" onClick={() => setHelp(!help)} className="text-[10px] underline" style={{ color: FIN.slate }}>
              Comment obtenir ce fichier ?
            </button>
            <button type="button" onClick={reclassify} disabled={busy} className="text-[10px] underline disabled:opacity-40" style={{ color: FIN.slate }}>
              Reclasser les « Autres »
            </button>
          </div>
          {help && (
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: FIN.slate }}>
              Le plus simple : le <b>relevé de compte mensuel en PDF</b>, tel que ta banque le met à disposition dans ton espace client
              (rubrique « Relevés » ou « e-Documents »). Tu peux aussi exporter tes opérations au format <b>CSV</b> (ou Excel/tableur)
              ou <b>OFX</b> (Money/Quicken). Importe tes relevés dans l&apos;ordre que tu veux : un même relevé importé deux fois n&apos;est
              compté qu&apos;une fois. Évite en revanche de mélanger, pour une même période, le PDF et un export CSV : ils seraient
              comptés deux fois.
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 text-[12px]">
          <p>
            <b>{parsed.name}</b> : {tx.length} opérations du {shortDate(summary?.from ?? dates[0])} au{' '}
            {shortDate(summary?.to ?? dates[dates.length - 1])}
            {parsed.skipped > 0 && <span style={{ color: FIN.slate }}> ({parsed.skipped} lignes ignorées)</span>}.
          </p>
          <p className="mt-1" style={{ color: FIN.slate }}>
            Entrées <b style={{ color: FIN.sage }}>{formatEuros(income)}</b> · Sorties <b style={{ color: FIN.rose }}>{formatEuros(spent)}</b>
          </p>
          {summary && (
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed">
              {summary.opening !== null && summary.closing !== null && (
                <li>
                  {summary.accountName && <b>{summary.accountName} · </b>}
                  Solde : {formatEuros(summary.opening)} → <b>{formatEuros(summary.closing)}</b>
                  {summary.account && <span style={{ color: FIN.slate }}> · compte {summary.account}</span>}
                </li>
              )}
              {summary.monthEnds.length > 0 && (
                <li style={{ color: FIN.slate }}>
                  Soldes de fin de mois : {summary.monthEnds.map((m) => `${monthLabel(m.month)} ${formatEuros(m.balance)}`).join(' · ')}
                </li>
              )}
              {summary.savings && (
                <li style={{ color: FIN.slate }}>
                  Compte d&apos;épargne : les virements avec tes autres comptes ne comptent ni en dépense ni en revenu, et sa valeur sera mise à jour
                  dans tes placements.
                </li>
              )}
              {summary.verified !== null && (
                <li style={{ color: summary.verified ? FIN.sage : FIN.rose }}>
                  {summary.verified
                    ? '✓ Toutes les opérations ont été retrouvées : les totaux et les soldes correspondent au relevé.'
                    : '⚠ Les totaux ne correspondent pas au relevé : quelques opérations ont pu être mal lues. Vérifie-les après l’import.'}
                </li>
              )}
              {exchangeFees > 0 && (
                <li style={{ color: FIN.rose }}>
                  Frais de change sur tes paiements à l&apos;étranger : <b>{formatEuros(exchangeFees)}</b>, mis à part dans « Frais bancaires ».
                </li>
              )}
              {ownTransfers > 0 && (
                <li style={{ color: FIN.slate }}>
                  {ownTransfers} virement{ownTransfers > 1 ? 's' : ''} à ton nom, compté{ownTransfers > 1 ? 's' : ''} comme mouvement entre tes comptes (ni dépense ni revenu).
                </li>
              )}
            </ul>
          )}
          <ul className="mt-2 space-y-0.5 text-[11px]" style={{ color: FIN.slate }}>
            {tx.slice(0, 4).map((t) => (
              <li key={t.importKey} className="flex justify-between gap-2">
                <span className="truncate">
                  {shortDate(t.date)} · {t.label}
                </span>
                <span>{formatEuros(t.amount)}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
              Compte concerné
            </span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              list="accounts"
              className="rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
              style={{ borderColor: FIN.line }}
            />
            <datalist id="accounts">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            Si tu importes plusieurs comptes (courant, livret…), les virements de l&apos;un à l&apos;autre sont repérés et ne sont
            comptés ni en dépense ni en revenu.
          </p>
          <label className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed">
            <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} className="mt-0.5" />
            <span>
              Compléter automatiquement le <b>compte de résultat</b>
              {summary?.closing != null && (
                <>
                  {' '}
                  et le <b>bilan</b> (solde du compte au {shortDate(summary.to ?? dates[dates.length - 1])})
                </>
              )}{' '}
              de chaque mois concerné ({[...new Set(dates.map(monthOf))].map(monthLabel).join(', ')}), même s&apos;il n&apos;est pas
              celui affiché, avec toutes les opérations connues de chaque mois (même venues d&apos;un autre relevé). Les montants que tu as saisis à la main ne sont jamais modifiés.
            </span>
          </label>
          <div className="mt-3 flex gap-2">
            <FinButton onClick={confirm} disabled={busy}>
              {busy ? 'Import…' : 'Importer'}
            </FinButton>
            <FinButton outline onClick={() => setParsed(null)}>
              Annuler
            </FinButton>
          </div>
        </div>
      )}
    </Panel>
  );
}

const OTHER_IDS = DEFAULT_CATEGORY_IDS;
const NEW_CATEGORY = '__nouvelle';
// Catégories proposées pour une opération : celles qui acceptent son sens (entrée ou sortie), par ordre alphabétique.
// Les « Autres » ne sont proposées que si l'opération y est déjà.
const choicesFor = (amount: number, current?: string) =>
  CATEGORIES.filter((c) => (!OTHER_IDS.includes(c.id) || c.id === current) && (!c.sign || c.sign === (amount > 0 ? 1 : -1))).sort(byLabel);

// Création d'une catégorie personnelle : nom, sens (dépense ou entrée) et rubrique du compte de résultat où reporter son total
function NewCategoryForm({ kind: fixedKind, onCreated, onCancel }: { kind?: CustomCategory['kind']; onCreated: (id: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CustomCategory['kind']>(fixedKind ?? 'variable');
  const [section, setSection] = useState(fixedKind === 'income' ? 'autres_revenus' : 'vie_courante');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sections = SECTIONS.filter((s) => s.side === (kind === 'income' ? 'produits' : 'charges'));
  const taken = CATEGORIES.some((c) => c.label.localeCompare(label.trim(), 'fr', { sensitivity: 'base' }) === 0);

  async function create() {
    if (!label.trim() || taken) return;
    setBusy(true);
    const { category, error: err } = await addCustomCategory(label, kind, section);
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    if (category) onCreated(category.id);
  }

  return (
    <div className="mt-1 w-full rounded-sm border px-2 py-2" style={{ borderColor: FIN.gold, backgroundColor: '#fff' }}>
      <ErrorNote message={error} />
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
        placeholder="Nom de la catégorie (ex. Animaux)"
        className="w-full rounded-sm border bg-white px-2 py-1 text-[12px] outline-none"
        style={{ borderColor: FIN.line }}
      />
      {taken && (
        <p className="mt-0.5 text-[10px]" style={{ color: FIN.rose }}>
          Cette catégorie existe déjà.
        </p>
      )}
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <select
          value={kind}
          disabled={!!fixedKind}
          onChange={(e) => {
            const k = e.target.value as CustomCategory['kind'];
            setKind(k);
            setSection(k === 'income' ? 'autres_revenus' : 'vie_courante');
          }}
          className="rounded-sm border bg-white px-1 py-1 text-[11px]"
          style={{ borderColor: FIN.line }}
        >
          <option value="variable">Dépense</option>
          <option value="income">Entrée d&apos;argent</option>
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-sm border bg-white px-1 py-1 text-[11px]" style={{ borderColor: FIN.line }} aria-label="Rubrique du compte de résultat">
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <FinButton onClick={create} disabled={busy || !label.trim() || taken}>
          Créer
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
    </div>
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
      className="min-w-0 flex-1 rounded-sm border bg-white px-1.5 py-1 text-[11px]"
      style={value ? { borderColor: FIN.line, color: FIN.slate } : { borderColor: FIN.gold, color: FIN.navy }}
    >
      {!value && <option value="">Classer dans…</option>}
      {choicesFor(amount, value).map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
      <option value={NEW_CATEGORY}>+ Nouvelle catégorie…</option>
    </select>
  );
}

// Toutes les catégories, par ordre alphabétique : ajout, suppression (sauf les deux « Autres »), rétablissement des catégories de base
function CategoriesPanel({ onChanged }: { onChanged: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = [...CATEGORIES].sort(byLabel);
  const removed = removedBaseCategories();

  async function remove(c: Category) {
    if (!window.confirm(`Supprimer la catégorie « ${c.label} » ? Ses opérations iront dans « Autres dépenses » ou « Autres entrées ».`)) return;
    const err = await deleteCategory(c);
    if (err) return setError(describeDbError(err.message));
    onChanged(`Catégorie « ${c.label} » supprimée : ses opérations sont maintenant dans « Autres ».`);
  }

  async function restore() {
    const err = await restoreBaseCategories();
    if (err) return setError(describeDbError(err.message));
    onChanged(`${removed.length} catégorie${removed.length > 1 ? 's' : ''} de base rétablie${removed.length > 1 ? 's' : ''}, et les opérations « Autres » reclassées.`);
  }

  return (
    <Panel title="Catégories" subtitle="Ajoute tes propres catégories ou supprime celles qui ne te servent pas. Les opérations d'une catégorie supprimée vont dans « Autres », qui ne se supprime pas.">
      <ErrorNote message={error} />
      {open && (
        <ul className="mb-2 divide-y text-[12px]" style={{ borderColor: FIN.mist }}>
          {all.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0">
                {c.label}
                <span className="text-[10px]" style={{ color: FIN.slate }}>
                  {' '}
                  · {c.kind === 'transfer' ? 'virement' : c.kind === 'income' ? 'entrée' : 'dépense'}
                  {c.custom && ' · perso'}
                  {DEFAULT_CATEGORY_IDS.includes(c.id) && ' · par défaut'}
                </span>
              </span>
              {!DEFAULT_CATEGORY_IDS.includes(c.id) && (
                <button type="button" onClick={() => remove(c)} aria-label={`Supprimer ${c.label}`} className="shrink-0 opacity-50 hover:opacity-100" style={{ color: FIN.rose }}>
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && removed.length > 0 && (
        <p className="mb-2 text-[11px]" style={{ color: FIN.slate }}>
          Supprimées : {removed.map((c) => c.label).join(', ')}.{' '}
          <button type="button" onClick={restore} className="underline" style={{ color: FIN.gold }}>
            Les rétablir
          </button>
        </p>
      )}
      {adding ? (
        <NewCategoryForm
          onCancel={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            onChanged(`Catégorie « ${categoryById(id).label} » créée.`);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <FinButton outline onClick={() => setOpen(!open)}>
            {open ? 'Masquer la liste' : `Voir les ${all.length} catégories`}
          </FinButton>
          <FinButton outline onClick={() => setAdding(true)}>
            + Nouvelle catégorie
          </FinButton>
        </div>
      )}
    </Panel>
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
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [offset, setOffset] = useState(0);
  const period = currentMonth ? shiftMonth(currentMonth, offset) : null;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [planned, setPlanned] = useState<PlannedExpense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // catégorie dont on modifie la limite
  const [newPlanned, setNewPlanned] = useState<{ label: string; amount: number | null; month: number }>({ label: '', amount: null, month: 1 });

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    (async () => {
      const [t, b, p, c] = await Promise.all([fetchTransactions(`${shiftMonth(period, -12)}-01`, lastDay(period)), fetchBudgets(), fetchPlanned(), loadCategories()]);
      if (cancelled) return;
      const err = t.error ?? b.error ?? p.error ?? c;
      setError(err ? describeDbError(err.message) : null);
      setTransactions(t.transactions);
      setBudgets(b.budgets);
      setPlanned(p.planned);
      setLoaded(period);
    })();
    return () => {
      cancelled = true;
    };
  }, [period, reloadKey]);

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

  async function remove(t: Transaction) {
    setTransactions((ts) => ts.filter((x) => x.id !== t.id));
    report(await deleteTransaction(t.id));
  }

  async function setLimit(category: string, limit: number | null) {
    setBudgets((bs) => [...bs.filter((b) => b.category !== category), ...(limit ? [{ category, monthly_limit: limit }] : [])]);
    setEditing(null);
    report(await saveBudget(category, limit));
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
          onNext={() => setOffset((o) => o + 1)}
        />
      }
    >
      <ErrorNote message={error} />
      {notice && (
        <p className="mt-4 flex items-start justify-between gap-2 rounded-sm border px-3 py-2 text-[11px]" style={{ borderColor: FIN.sage, color: FIN.sage, backgroundColor: FIN.paper }}>
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Fermer">
            <X size={14} />
          </button>
        </p>
      )}

      <ImportPanel
        accounts={accounts}
        onImported={(message, month) => {
          setNotice(message);
          // Se placer sur le mois du relevé importé
          if (month && currentMonth) {
            const [y1, m1] = currentMonth.split('-').map(Number);
            const [y2, m2] = month.split('-').map(Number);
            setOffset((y2 - y1) * 12 + (m2 - m1));
          }
          setReloadKey((k) => k + 1);
        }}
      />

      {loaded !== period ? (
        <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
          Chargement…
        </p>
      ) : monthTx.length === 0 ? (
        <p className="mt-6 text-center text-[12px] leading-relaxed" style={{ color: FIN.slate }}>
          Aucune opération pour {period && monthLabel(period)}. Importe un relevé qui couvre ce mois-ci.
        </p>
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

          <Panel title="Budget du mois" subtitle="Fixe une limite par catégorie : la barre passe à l'orange à 80 %, au rouge au-delà.">
            <ul className="space-y-3">
              {expenseCategories.map(({ cat, spent, limit }) => {
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
              })}
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
            {editing && !expenseCategories.some((r) => r.cat.id === editing) && (
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
                      <button type="button" onClick={() => remove(t)} aria-label="Supprimer l'opération" className="shrink-0 opacity-50 hover:opacity-100" style={{ color: FIN.rose }}>
                        <Trash2 size={13} />
                      </button>
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
          setReloadKey((k) => k + 1);
        }}
      />
    </FinancePage>
  );
}
