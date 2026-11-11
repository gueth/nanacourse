'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { FileUp, Plus, Repeat, X } from 'lucide-react';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import { parseStatement, readStatementFile, type ParseResult } from '@/lib/bankImport';
import { readPdfStatement } from '@/lib/bankPdf';
import { orThrow, useCached } from '@/lib/cache';
import {
  addPlanned,
  categoryById,
  checkStatement,
  completeFromStatement,
  deletePlanned,
  deleteTransactions,
  linkTransfers,
  detectSubscriptions,
  fetchPlanned,
  fetchTransactions,
  importTransactions,
  isSavingsAccount,
  lastDayOf,
  loadCategories,
  monthOf,
  reclassifyOthers,
  refreshStatements,
  recordStatementMonths,
  statementMonths,
  type PlannedExpense,
  type StatementCheck,
  type Transaction
} from '@/lib/transactions';
import { describeDbError } from '@/lib/financePlans';
import { refreshBalanceLinks } from '@/lib/balanceLinks';
import { syncFinances } from '@/lib/financeSync';
import { checkGroceries, type UnmatchedGrocery } from '@/lib/groceryCheck';
import { BalanceLinksPanel } from '@/components/finance/BalanceLinks';
import { CategoriesPanel } from '@/components/finance/CategoryManager';
import { SelfDebtPanel } from '@/components/finance/SelfDebt';
import { DefaultRepartitionPanel } from '@/components/finance/Repartition';
import { ErrorNote, FIN, FinanceHeader, FinancePage, FinButton, FinModal, NumberField, Panel, useFinConfirm } from '@/components/finance/FinanceParts';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Résumé des écarts entre un relevé et ce qui est déjà enregistré (ex : « 12 identiques, 2 opérations nouvelles ou modifiées »)
function diffText(c: StatementCheck) {
  const parts = [];
  if (c.added.length) parts.push(`${c.added.length} opération${c.added.length > 1 ? 's' : ''} nouvelle${c.added.length > 1 ? 's' : ''} ou modifiée${c.added.length > 1 ? 's' : ''}`);
  if (c.removed.length) parts.push(`${c.removed.length} opération${c.removed.length > 1 ? 's' : ''} enregistrée${c.removed.length > 1 ? 's' : ''} absente${c.removed.length > 1 ? 's' : ''} du relevé`);
  return `${c.present} identique${c.present > 1 ? 's' : ''}, ${parts.join(', ')}`;
}

// Abonnements et prélèvements repérés sur les 12 derniers mois d'opérations
function SubscriptionsPanel({ transactions }: { transactions: Transaction[] }) {
  const subscriptions = useMemo(() => detectSubscriptions(transactions), [transactions]);
  if (subscriptions.length === 0) return null;
  return (
    <Panel collapsible title="Dépenses récurrentes" subtitle="Abonnements et prélèvements qui reviennent chaque mois : vérifie que tu les utilises tous.">
      <ul className="space-y-1.5 text-[12px]">
        {subscriptions.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Repeat size={12} className="shrink-0" style={{ color: FIN.slate }} />
              <span className="min-w-0">
                <span className="block break-words">{s.key}</span>
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
  );
}

// Dépenses annuelles à étaler sur l'année : liste, ajout et suppression
// Chacune devient une sous-catégorie de « Dépenses annuelles » (limite : un douzième de son montant) ; onChanged
// prévient la page pour mettre à jour la dette à moi-même
function PlannedPanel({ onError, onChanged }: { onError: (message: string) => void; onChanged: () => void }) {
  const [confirm, confirmDialog] = useFinConfirm();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [newPlanned, setNewPlanned] = useState<{ label: string; amount: number | null; month: number }>({ label: '', amount: null, month: 1 });
  // Popin d'ajout ouverte ou non
  const [adding, setAdding] = useState(false);
  const plannedQuery = useCached('finances:depenses-prevues', async () => {
    const { planned, error } = await fetchPlanned();
    return orThrow(planned, error);
  });
  const planned = plannedQuery.data ?? [];
  const setPlanned = (update: (ps: PlannedExpense[]) => PlannedExpense[]) => plannedQuery.setData(update);
  useEffect(() => {
    if (plannedQuery.error) onError(describeDbError(plannedQuery.error));
  }, [plannedQuery.error, onError]);

  function report(err: { message: string } | null) {
    if (err) onError(describeDbError(err.message));
  }

  async function addPlannedExpense() {
    if (!newPlanned.label.trim() || !newPlanned.amount) return;
    const { planned: p, error: err } = await addPlanned(newPlanned.label.trim(), newPlanned.amount, newPlanned.month);
    report(err);
    if (p) setPlanned((ps) => [...ps, p].sort((a, b) => a.due_month - b.due_month));
    setNewPlanned({ label: '', amount: null, month: 1 });
    setAdding(false);
    onChanged();
  }

  // Mois restant avant chaque dépense annuelle
  const thisMonth = currentMonth ? Number(currentMonth.slice(5)) : 1;

  return (
    <>
      {confirmDialog}
      {/* Repliable : le titre, la description et le bouton d'ajout restent visibles, la liste se déplie */}
      <Panel
        collapsible
        title="Dépenses annuelles"
        subtitle="Assurance, impôts, vacances, cadeaux de Noël… En les étalant sur l'année, elles ne déséquilibrent plus le mois où elles tombent."
        preview={
          <button
            type="button"
            // Dans le titre repliable : ouvre la popin sans plier ni déplier la carte
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAdding(true);
            }}
            className="flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.12em]"
            style={{ borderColor: FIN.gold, color: FIN.gold }}
          >
            <Plus size={13} /> Ajouter une dépense annuelle
          </button>
        }
      >
        {planned.length === 0 && (
          <p className="text-[11px] italic" style={{ color: FIN.slate }}>
            Aucune dépense annuelle pour l&apos;instant.
          </p>
        )}
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
                      if (
                        !(await confirm(
                          'Supprimer la dépense prévue',
                          `Supprimer « ${p.label} » (${formatEuros(p.amount)}) ? Ses opérations iront dans « Autres dépenses », et ses parts ne compteront plus dans la dette à moi-même.`
                        ))
                      )
                        return;
                      setPlanned((ps) => ps.filter((x) => x.id !== p.id));
                      report(await deletePlanned(p.id));
                      onChanged();
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
      </Panel>
      {adding && (
        <FinModal title="Nouvelle dépense annuelle" onClose={() => setAdding(false)}>
          <div className="grid grid-cols-[1fr_90px] gap-2">
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
                className="fin-select py-1.5 pl-2 text-[12px]"
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
        </FinModal>
      )}
    </>
  );
}

// Import d'un relevé : choix du fichier, aperçu, puis enregistrement
function ImportForm({ accounts, onImported }: { accounts: string[]; onImported: (message: string, month?: string, groceries?: UnmatchedGrocery[]) => void }) {
  const [parsed, setParsed] = useState<(ParseResult & { name: string }) | null>(null);
  const [account, setAccount] = useState('Compte courant');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Relevé comparé à ce qui est déjà enregistré sur le compte choisi (null pendant la vérification)
  const [check, setCheck] = useState<StatementCheck | null>(null);
  const [ask, askDialog] = useFinConfirm();

  // Dès qu'un relevé est lu (ou que le compte change), on regarde s'il a déjà été importé
  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { check: c, error: err } = await checkStatement(parsed.transactions, account.trim() || 'Compte courant', parsed.summary);
      if (cancelled) return;
      if (err) setError(describeDbError(err.message));
      setCheck(c);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setCheck(null);
    };
  }, [parsed, account]);

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
    // Nouvelle vérification juste avant l'import : relevé identique -> rien à retraiter ;
    // relevé divergent -> on demande confirmation, puis les anciennes opérations sont remplacées par les nouvelles
    const { check: c, error: checkErr } = await checkStatement(parsed.transactions, name, parsed.summary);
    if (checkErr || !c) {
      setBusy(false);
      return setError(describeDbError(checkErr?.message ?? 'vérification impossible'));
    }
    setCheck(c);
    if (c.status === 'same') return setBusy(false);
    if (c.status === 'different') {
      const ok = await ask(
        'Relevé déjà importé',
        `Cette période est déjà importée sur « ${name} », mais le relevé diffère : ${diffText(c)}. Remplacer les anciennes données par celles de ce relevé ?`,
        { confirm: 'Remplacer', cancel: 'Annuler' }
      );
      if (!ok) return setBusy(false);
      const delErr = await deleteTransactions(c.removed.map((t) => t.id));
      if (delErr) {
        setBusy(false);
        return setError(describeDbError(delErr.message));
      }
    }
    const { inserted, linked, error: err } = await importTransactions(parsed.transactions, name);
    if (err) {
      setBusy(false);
      return setError(describeDbError(err.message));
    }
    // Mois sur lesquels le relevé renseigne ce compte : le bilan s'en sert pour signaler les relevés manquants
    await recordStatementMonths(name, statementMonths(parsed.transactions, parsed.summary));
    const dupes = parsed.transactions.length - inserted;
    let message = `${inserted} opération${inserted > 1 ? 's' : ''} importée${inserted > 1 ? 's' : ''}${dupes ? `, ${dupes} déjà présente${dupes > 1 ? 's' : ''} gardée${dupes > 1 ? 's' : ''}` : ''}.`;
    if (c.removed.length) message += ` ${c.removed.length} ancienne${c.removed.length > 1 ? 's' : ''} opération${c.removed.length > 1 ? 's' : ''} remplacée${c.removed.length > 1 ? 's' : ''}.`;
    if (linked.length)
      message += ` ${linked.length} opération${linked.length > 1 ? 's' : ''} de ${[...new Set(linked.map((t) => `« ${t.account} »`))].join(', ')} reconnue${linked.length > 1 ? 's' : ''} comme virement${linked.length > 1 ? 's' : ''} avec ce compte (ni dépense ni revenu).`;
    if (complete) {
      // Mois des opérations reclassées sur les autres comptes et hors de la période du relevé : leur compte de résultat change aussi
      const statementMonthsSet = new Set(parsed.transactions.map((t) => monthOf(t.date)));
      const extra = await refreshStatements(linked.map((t) => monthOf(t.date)).filter((m) => !statementMonthsSet.has(m)));
      if (extra.error) {
        setBusy(false);
        return setError(describeDbError(extra.error.message));
      }
      const done = await completeFromStatement(name, parsed.transactions, parsed.summary);
      if (done.error) {
        setBusy(false);
        return setError(describeDbError(done.error.message));
      }
      message += done.filled.length
        ? ` Compte de résultat mis à jour pour ${done.filled.map(monthLabel).join(', ')}.`
        : ' Compte de résultat déjà à jour.';
      if (done.kept) message += ` ${done.kept} ligne${done.kept > 1 ? 's' : ''} saisie${done.kept > 1 ? 's' : ''} à la main gardée${done.kept > 1 ? 's' : ''} telle${done.kept > 1 ? 's' : ''} quelle${done.kept > 1 ? 's' : ''}.`;
      if (done.balances) message += ` Soldes du relevé inscrits au bilan (ligne « ${name} »).`;
    }
    // Lignes du bilan reliées à des catégories (dettes, créances) : recalculées avec les nouvelles opérations
    const linkErr = await refreshBalanceLinks();
    if (linkErr) message += ` (Dettes et créances non mises à jour : ${describeDbError(linkErr.message)})`;
    // Courses enregistrées dans l'appli : retrouvées sur le relevé, sinon signalées
    const period = [...parsed.transactions.map((t) => t.date)].sort();
    const from = parsed.summary?.from ?? period[0];
    const to = parsed.summary?.to ?? period[period.length - 1];
    let groceries: UnmatchedGrocery[] = [];
    if (from && to) {
      const g = await checkGroceries(name, from, to);
      if (g.error) message += ` (Courses non vérifiées : ${describeDbError(g.error.message)})`;
      if (g.reclassified) message += ` ${g.reclassified} course${g.reclassified > 1 ? 's' : ''} de l'appli retrouvée${g.reclassified > 1 ? 's' : ''} et classée${g.reclassified > 1 ? 's' : ''}.`;
      groceries = g.unmatched;
      if (g.reclassified && complete) await syncFinances([...new Set(parsed.transactions.map((t) => monthOf(t.date)))]);
    }
    // Mois où tombent le plus d'opérations du relevé : le lien vers le budget s'y place
    const counts = new Map<string, number>();
    for (const t of parsed.transactions) counts.set(monthOf(t.date), (counts.get(monthOf(t.date)) ?? 0) + 1);
    const month = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
    setBusy(false);
    setParsed(null);
    onImported(message, month, groceries);
  }

  // Revérifie les opérations déjà enregistrées : « Autres » reclassées avec les catégories et mots-clés actuels,
  // puis virements entre mes comptes retrouvés d'un relevé à l'autre (compte courant ↔ livret), et compte de résultat des mois touchés remis à jour
  async function reclassify() {
    setBusy(true);
    const { changed, error: err } = await reclassifyOthers();
    if (err) {
      setBusy(false);
      return setError(describeDbError(err.message));
    }
    const { changed: linked, error: err2 } = await linkTransfers();
    if (err2) {
      setBusy(false);
      return setError(describeDbError(err2.message));
    }
    const months = linked.map((t) => monthOf(t.date));
    const { filled, error: err3 } = await refreshStatements(months);
    // Les reclassements changent aussi les lignes du bilan reliées à des catégories (dettes, créances)
    const err4 = err3 ?? (await refreshBalanceLinks());
    setBusy(false);
    if (err4) return setError(describeDbError(err4.message));
    const parts = [
      changed ? `${changed} opération${changed > 1 ? 's' : ''} « Autres » reclassée${changed > 1 ? 's' : ''}.` : 'Aucune opération « Autres » de plus n’a pu être classée.',
      linked.length
        ? `${linked.length} opération${linked.length > 1 ? 's' : ''} reconnue${linked.length > 1 ? 's' : ''} comme virement${linked.length > 1 ? 's' : ''} entre tes comptes.${filled.length ? ` Compte de résultat mis à jour pour ${filled.map(monthLabel).join(', ')}.` : ''}`
        : 'Aucun nouveau virement entre tes comptes.'
    ];
    onImported(parts.join(' '));
  }

  const tx = parsed?.transactions ?? [];
  const dates = tx.map((t) => t.date).sort();
  const income = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spent = tx.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const summary = parsed?.summary;
  const exchangeFees = tx.filter((t) => t.label.startsWith('COM CHANGE')).reduce((s, t) => s - t.amount, 0);

  return (
    <>
      {askDialog}
      <p className="-mt-1 mb-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
        Le fichier est lu sur ton appareil : rien n&apos;est envoyé à ta banque ni à un service extérieur. Seules les opérations sont enregistrées dans ta base.
      </p>
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
              Revérifier les classements
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
                  Compte d&apos;épargne : les virements avec tes autres comptes ne comptent ni en dépense ni en revenu, et ses opérations
                  n&apos;entrent pas dans le compte de résultat (seuls les comptes courants le font).
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
            </ul>
          )}
          <ul className="mt-2 space-y-0.5 text-[11px]" style={{ color: FIN.slate }}>
            {tx.slice(0, 4).map((t) => (
              <li key={t.importKey} className="flex justify-between gap-2">
                <span className="min-w-0 break-words">
                  {shortDate(t.date)} · {t.label}
                </span>
                <span className="shrink-0 whitespace-nowrap">{formatEuros(t.amount)}</span>
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
              celui affiché, avec toutes les opérations connues de chaque mois (même venues d&apos;un autre relevé). Sur la période du relevé, ses soldes remplacent ceux déjà inscrits. Aucun solde n&apos;est reporté sur les mois suivants : le bilan signale les relevés manquants. Les opérations ajoutées à la main sont gardées.
            </span>
          </label>
          {/* Relevé déjà importé ? */}
          {!check ? (
            <p className="mt-3 text-[11px]" style={{ color: FIN.slate }}>
              Vérification des imports précédents…
            </p>
          ) : check.status === 'same' ? (
            <p className="mt-3 rounded-sm border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: FIN.sage, color: FIN.sage }}>
              ✓ Relevé déjà importé : ses {check.present} opérations sont toutes enregistrées sur « {account.trim() || 'Compte courant'} ». Rien à retraiter.
            </p>
          ) : check.status === 'different' ? (
            <div className="mt-3 rounded-sm border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: FIN.rose, color: FIN.rose }}>
              <p>
                ⚠ Cette période est déjà importée sur « {account.trim() || 'Compte courant'} », mais le relevé diffère : {diffText(check)}. Si tu
                l&apos;importes, les anciennes données seront remplacées par celles de ce relevé (les opérations identiques gardent leur catégorie).
              </p>
              <ul className="mt-1 space-y-0.5" style={{ color: FIN.slate }}>
                {check.added.slice(0, 3).map((t) => (
                  <li key={t.importKey} className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">+ {shortDate(t.date)} · {t.label}</span>
                    <span className="shrink-0 whitespace-nowrap">{formatEuros(t.amount)}</span>
                  </li>
                ))}
                {check.removed.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex justify-between gap-2 line-through">
                    <span className="min-w-0 break-words">− {shortDate(t.date)} · {t.label}</span>
                    <span className="shrink-0 whitespace-nowrap">{formatEuros(t.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* Virements entre mes comptes : retrouvés (ou non) sur les autres comptes déjà importés */}
          {check && check.linked > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: FIN.sage }}>
              ✓ {check.linked} virement{check.linked > 1 ? 's' : ''} retrouvé{check.linked > 1 ? 's' : ''} en sens inverse sur{' '}
              {check.linkedAccounts.map((a) => `« ${a} »`).join(', ')} : compté{check.linked > 1 ? 's' : ''} comme mouvement
              {check.linked > 1 ? 's' : ''} entre tes comptes (ni dépense ni revenu), des deux côtés.
            </p>
          )}
          {check && check.unlinked.length > 0 && (
            <div className="mt-2 rounded-sm border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: FIN.gold, color: FIN.slate }}>
              <p>
                {check.unlinked.length} virement{check.unlinked.length > 1 ? 's' : ''} entre tes comptes sans opération correspondante sur
                tes autres comptes. {summary?.savings || isSavingsAccount(account)
                  ? "L'argent d'un livret ne peut venir que de ton compte courant (ou y retourner) : importe le relevé du compte courant de la même période pour qu'ils y soient reconnus aussi."
                  : 'Importe le relevé de l’autre compte sur la même période pour vérifier ces virements.'}
              </p>
              <ul className="mt-1 space-y-0.5">
                {check.unlinked.slice(0, 4).map((t) => (
                  <li key={t.importKey} className="flex justify-between gap-2">
                    <span className="truncate">
                      {shortDate(t.date)} · {t.label}
                    </span>
                    <span>{formatEuros(t.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            {check?.status !== 'same' && (
              <FinButton onClick={confirm} disabled={busy || !check}>
                {busy ? 'Import…' : check?.status === 'different' ? 'Remplacer par ce relevé' : 'Importer'}
              </FinButton>
            )}
            <FinButton outline onClick={() => setParsed(null)}>
              Annuler
            </FinButton>
          </div>
        </div>
      )}
    </>
  );
}

// Page Gestion : import des relevés, dépenses récurrentes et annuelles, catégories
export default function GestionPage() {
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [notice, setNotice] = useState<{ message: string; month?: string; groceries?: UnmatchedGrocery[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opérations des 12 derniers mois : comptes déjà alimentés par un relevé (proposés dans « Compte concerné ») et dépenses récurrentes
  const txQuery = useCached('finances:gestion-operations', async () => {
    const today = monthKey(new Date());
    const { transactions, error } = await fetchTransactions(`${shiftMonth(today, -12)}-01`, lastDayOf(today));
    return orThrow(transactions, error);
  });
  // Les catégories sont rangées dans CATEGORIES (lib/transactions) : la mémoire garde juste le moment du chargement
  const categoriesQuery = useCached('finances:categories', async () => orThrow(Date.now(), await loadCategories()));
  const transactions = useMemo(() => (categoriesQuery.data !== undefined ? (txQuery.data ?? []) : []), [txQuery.data, categoriesQuery.data]);
  const accounts = useMemo(() => [...new Set(transactions.map((t) => t.account))], [transactions]);
  const loadError = txQuery.error ?? categoriesQuery.error;
  const shownError = error ?? (loadError && describeDbError(loadError));

  return (
    <FinancePage header={<FinanceHeader subtitle="gestion · ma répartition" />}>
      <ErrorNote message={shownError} />
      {notice && (
        <div className="mt-4 rounded-sm border px-3 py-2 text-[11px]" style={{ borderColor: FIN.sage, color: FIN.sage, backgroundColor: FIN.paper }}>
          <p className="flex items-start justify-between gap-2">
            {notice.message}
            <button type="button" onClick={() => setNotice(null)} aria-label="Fermer">
              <X size={14} />
            </button>
          </p>
          {notice.month && (
            <Link href={`/banque/budget?mois=${notice.month}`} className="mt-1 inline-block underline">
              Voir les opérations de {monthLabel(notice.month)}
            </Link>
          )}
        </div>
      )}
      {/* Courses enregistrées dans l'appli sans opération correspondante sur le relevé : erreur possible */}
      {notice?.groceries && notice.groceries.length > 0 && (
        <div className="mt-3 rounded-sm border px-3 py-2 text-[11px]" style={{ borderColor: FIN.rose, color: FIN.rose, backgroundColor: FIN.paper }}>
          <p className="font-bold">
            {notice.groceries.length > 1 ? `${notice.groceries.length} courses de l'appli ne sont pas sur le relevé` : "Une course de l'appli n'est pas sur le relevé"}
          </p>
          <ul className="mt-1 space-y-0.5" style={{ color: FIN.navy }}>
            {notice.groceries.map((g, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0 break-words">
                  {shortDate(g.day)} · {g.label}
                </span>
                <span className="shrink-0 whitespace-nowrap">{formatEuros(g.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            Vérifie le montant enregistré, ou si elle a été payée en espèces ou depuis un autre compte.
          </p>
        </div>
      )}
      <SelfDebtPanel currentMonth={currentMonth} ready={categoriesQuery.data !== undefined} />
      <Panel title="Importer un relevé">
        <ImportForm
          accounts={accounts}
          onImported={(message, month, groceries) => {
            setNotice({ message, month, groceries });
            txQuery.reload();
          }}
        />
      </Panel>
      {/* Répartition du revenu par défaut, pour le mois en cours et les suivants */}
      <DefaultRepartitionPanel ready={categoriesQuery.data !== undefined} onError={setError} />
      <BalanceLinksPanel ready={categoriesQuery.data !== undefined} onError={setError} onChanged={(message) => setNotice({ message })} />
      <SubscriptionsPanel transactions={transactions} />
      <PlannedPanel onError={setError} onChanged={() => categoriesQuery.reload()} />
      <CategoriesPanel
        onChanged={(message) => {
          setNotice({ message });
          txQuery.reload();
          categoriesQuery.reload();
        }}
      />
    </FinancePage>
  );
}
