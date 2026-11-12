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
  checkStatement,
  completeFromStatement,
  deletePlanned,
  deleteTransactions,
  linkTransfers,
  detectSubscriptions,
  fetchPlanned,
  fetchTransactions,
  importTransactions,
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
import { DefaultRepartitionPanel } from '@/components/finance/Repartition';
import { ErrorNote, FIN, FinanceHeader, FinancePage, FinButton, FinModal, NumberField, Panel, useFinConfirm } from '@/components/finance/FinanceParts';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Abonnements et prélèvements repérés sur les 12 derniers mois d'opérations. On n'affiche que ceux prélevés
// au cours des 3 derniers mois complets (le mois en cours exclu), du plus récent au plus ancien.
function SubscriptionsPanel({ transactions }: { transactions: Transaction[] }) {
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const subscriptions = useMemo(() => {
    if (!currentMonth) return [];
    const from = shiftMonth(currentMonth, -3);
    return detectSubscriptions(transactions)
      .filter((s) => monthOf(s.lastDate) >= from && monthOf(s.lastDate) < currentMonth)
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [transactions, currentMonth]);
  if (subscriptions.length === 0) return null;
  return (
    <Panel collapsible title="Dépenses récurrentes" subtitle="Abonnements et prélèvements des 3 derniers mois (hors mois en cours), du plus récent au plus ancien : vérifie que tu les utilises tous.">
      <ul className="space-y-1.5 text-[12px]">
        {subscriptions.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Repeat size={12} className="shrink-0" style={{ color: FIN.slate }} />
              <span className="min-w-0">
                <span className="block break-words">{s.key}</span>
                <span className="text-[10px]" style={{ color: FIN.slate }}>
                  {s.stopped ? 'plus vu depuis le ' : 'dernier prélèvement le '}
                  {shortDate(s.lastDate)} · {s.months} mois
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
// prévient la page pour mettre à jour le budget
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
                          `Supprimer « ${p.label} » (${formatEuros(p.amount)}) ? Ses opérations iront dans « Autres dépenses », et sa part ne comptera plus dans le budget du mois.`
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

// Nombre de relevés qu'on peut choisir d'un coup
const MAX_FILES = 30;

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

// Mois où tombent le plus d'opérations : le lien vers le budget s'y place
function topMonth(transactions: { date: string }[]) {
  const counts = new Map<string, number>();
  for (const t of transactions) counts.set(monthOf(t.date), (counts.get(monthOf(t.date)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
}

// Lecture d'un fichier de relevé (PDF, CSV, OFX) sur l'appareil ; renvoie le relevé lu ou la raison de l'échec
async function readStatement(file: File): Promise<{ result?: ParseResult; error?: string }> {
  let result: ParseResult;
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    result = isPdf ? await readPdfStatement(file) : parseStatement(await readStatementFile(file));
  } catch (e) {
    console.error(e);
    return {
      error:
        "Ce fichier n'a pas pu être lu. Un PDF protégé par mot de passe ou scanné (une photo du relevé) ne contient pas de texte lisible : télécharge le relevé depuis ton espace client, ou exporte tes opérations en CSV."
    };
  }
  if (result.transactions.length === 0)
    return { error: "Aucune opération reconnue dans ce fichier. Vérifie qu'il s'agit bien d'un relevé de compte en PDF, ou d'un export CSV ou OFX de ta banque." };
  return { result };
}

type ImportOutcome = {
  inserted: number;
  dupes: number;
  removed: number;
  linked: Awaited<ReturnType<typeof importTransactions>>['linked'];
  filled: string[];
  kept: number;
  balances: boolean;
  reclassified: number;
  groceries: UnmatchedGrocery[];
  notes: string[];
};

// Enregistrement d'un relevé déjà vérifié (c) sur le compte « name » : anciennes opérations remplacées si le relevé diffère,
// compte de résultat et bilan complétés (si complete), courses de l'appli retrouvées sur le relevé.
// Les lignes du bilan reliées à des catégories sont recalculées ensuite par l'appelant, une seule fois.
async function importStatement(parsed: ParseResult, name: string, c: StatementCheck, complete: boolean): Promise<{ outcome?: ImportOutcome; error?: string }> {
  if (c.status === 'different') {
    const delErr = await deleteTransactions(c.removed.map((t) => t.id));
    if (delErr) return { error: describeDbError(delErr.message) };
  }
  const { inserted, linked, error: err } = await importTransactions(parsed.transactions, name);
  if (err) return { error: describeDbError(err.message) };
  // Mois sur lesquels le relevé renseigne ce compte : le bilan s'en sert pour signaler les relevés manquants
  await recordStatementMonths(name, statementMonths(parsed.transactions, parsed.summary));
  const outcome: ImportOutcome = {
    inserted,
    dupes: parsed.transactions.length - inserted,
    removed: c.removed.length,
    linked,
    filled: [],
    kept: 0,
    balances: false,
    reclassified: 0,
    groceries: [],
    notes: []
  };
  if (complete) {
    // Mois des opérations reclassées sur les autres comptes et hors de la période du relevé : leur compte de résultat change aussi
    const statementMonthsSet = new Set(parsed.transactions.map((t) => monthOf(t.date)));
    const extra = await refreshStatements(linked.map((t) => monthOf(t.date)).filter((m) => !statementMonthsSet.has(m)));
    if (extra.error) return { error: describeDbError(extra.error.message) };
    const done = await completeFromStatement(name, parsed.transactions, parsed.summary);
    if (done.error) return { error: describeDbError(done.error.message) };
    outcome.filled = [...new Set([...extra.filled, ...done.filled])];
    outcome.kept = done.kept;
    outcome.balances = !!done.balances;
  }
  // Courses enregistrées dans l'appli : retrouvées sur le relevé, sinon signalées
  const period = [...parsed.transactions.map((t) => t.date)].sort();
  const from = parsed.summary?.from ?? period[0];
  const to = parsed.summary?.to ?? period[period.length - 1];
  if (from && to) {
    const g = await checkGroceries(name, from, to);
    if (g.error) outcome.notes.push(`(Courses non vérifiées : ${describeDbError(g.error.message)})`);
    outcome.reclassified = g.reclassified;
    outcome.groceries = g.unmatched;
    if (g.reclassified && complete) await syncFinances([...new Set(parsed.transactions.map((t) => monthOf(t.date)))]);
  }
  return { outcome };
}

// Un relevé choisi parmi plusieurs : lu (parsed) ou illisible (error), son compte, et sa vérification
// face à ce qui est déjà enregistré (check, faite pour le compte checkedFor)
type BatchItem = {
  id: number;
  name: string;
  parsed?: ParseResult;
  error?: string;
  account: string;
  check: StatementCheck | null;
  checkedFor: string | null;
  include: boolean; // coché dans « Liste des comptes concernés » : à importer
};

const batchStart = (it: BatchItem) => it.parsed?.summary?.from ?? [...(it.parsed?.transactions ?? []).map((t) => t.date)].sort()[0] ?? '';
// Coché et vérifié : importé, même déjà importé (un relevé qui diffère remplace alors les anciennes données)
const willImport = (it: BatchItem) => !!it.parsed && !!it.check && it.include;
const batchEnd = (it: BatchItem) => it.parsed?.summary?.to ?? [...(it.parsed?.transactions ?? []).map((t) => t.date)].sort().pop() ?? '';
// « 09 Octobre 2026 »
const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    .split(' ')
    .map((w, i) => (i === 1 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

// Import des relevés : choix d'un ou plusieurs fichiers (jusqu'à 30), récapitulatif (fichiers, dates, nombre de
// transactions), comptes concernés à cocher avec leur solde, puis enregistrement. Un relevé déjà importé peut l'être à
// nouveau : une note le signale, et s'il diffère, ses données remplacent les anciennes. Le compte de résultat et le bilan
// des mois concernés sont toujours complétés.
function ImportForm({ accounts, onImported }: { accounts: string[]; onImported: (message: string, month?: string, groceries?: UnmatchedGrocery[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Relevés choisis : à vérifier puis à importer ensemble
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  // Chaque relevé est comparé à ce qui est déjà enregistré sur son compte, de nouveau quand son compte change
  const staleKey = batch
    .filter((it) => it.parsed && it.checkedFor !== (it.account.trim() || 'Compte courant'))
    .map((it) => `${it.id}|${it.account.trim()}`)
    .join(',');
  useEffect(() => {
    if (!staleKey || busy) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const entry of staleKey.split(',')) {
        const [id] = entry.split('|');
        const it = batch.find((b) => b.id === Number(id));
        if (!it?.parsed) continue;
        const name = it.account.trim() || 'Compte courant';
        const { check: c, error: err } = await checkStatement(it.parsed.transactions, name, it.parsed.summary);
        if (cancelled) return;
        if (err) setError(describeDbError(err.message));
        // Déjà importé : sa période est quand même enregistrée (mois sans opération compris), pour les relevés importés
        // avant que les mois couverts soient retenus
        if (c?.status === 'same') await recordStatementMonths(name, statementMonths(it.parsed.transactions, it.parsed.summary));
        setBatch((items) => items.map((b) => (b.id === it.id && (b.account.trim() || 'Compte courant') === name ? { ...b, check: c, checkedFor: name } : b)));
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // batch est lu au moment de la vérification ; staleKey suffit à relancer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleKey, busy]);

  async function pick(list: FileList | null) {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    setError(null);
    const chosen = files.slice(0, MAX_FILES);
    if (files.length > MAX_FILES) setError(`Seuls les ${MAX_FILES} premiers relevés sont gardés (${files.length} choisis) : importe les autres ensuite.`);
    const items: BatchItem[] = [];
    for (const [i, file] of chosen.entries()) {
      setReading(chosen.length > 1 ? `Lecture des relevés… ${i + 1}/${chosen.length}` : 'Lecture du relevé…');
      const { result, error: err } = await readStatement(file);
      items.push({
        id: i,
        name: file.name,
        parsed: result,
        error: err,
        // Nom du compte reconnu d'après le titre du relevé (« Livret A », « LEP »...)
        account: result?.summary?.accountName ?? 'Compte courant',
        check: null,
        checkedFor: null,
        include: true
      });
    }
    setReading(null);
    // Rangés du plus ancien au plus récent, illisibles à la fin
    setBatch(items.sort((a, b) => Number(!a.parsed) - Number(!b.parsed) || batchStart(a).localeCompare(batchStart(b))));
  }

  // Import des relevés cochés, du plus ancien au plus récent
  async function confirmBatch() {
    const todo = batch.filter(willImport).sort((a, b) => batchStart(a).localeCompare(batchStart(b)));
    if (todo.length === 0) return;
    setBusy(true);
    setError(null);
    let inserted = 0;
    let dupes = 0;
    let removed = 0;
    let linked = 0;
    let reclassified = 0;
    let done = 0;
    const filled = new Set<string>();
    const groceries: UnmatchedGrocery[] = [];
    const notes: string[] = [];
    const failed: string[] = [];
    const importedTx: { date: string }[] = [];
    for (const [k, it] of todo.entries()) {
      setProgress(todo.length > 1 ? `Import ${k + 1}/${todo.length}…` : 'Import…');
      const name = it.account.trim() || 'Compte courant';
      // Revérifié juste avant : un relevé précédent de la liste a pu couvrir la même période
      const { check: c, error: checkErr } = await checkStatement(it.parsed!.transactions, name, it.parsed!.summary);
      if (checkErr || !c) {
        failed.push(`${it.name} (${describeDbError(checkErr?.message ?? 'vérification impossible')})`);
        continue;
      }
      const { outcome: o, error: err } = await importStatement(it.parsed!, name, c, true);
      if (!o) {
        failed.push(`${it.name} (${err})`);
        continue;
      }
      done++;
      inserted += o.inserted;
      dupes += o.dupes;
      removed += o.removed;
      linked += o.linked.length;
      reclassified += o.reclassified;
      o.filled.forEach((m) => filled.add(m));
      groceries.push(...o.groceries);
      notes.push(...o.notes);
      importedTx.push(...it.parsed!.transactions);
      setBatch((items) => items.filter((b) => b.id !== it.id));
    }
    setProgress(null);
    let message = `${plural(done, 'relevé')} importé${done > 1 ? 's' : ''} : ${plural(inserted, 'opération')} ajoutée${inserted > 1 ? 's' : ''}${dupes ? `, ${dupes} déjà présente${dupes > 1 ? 's' : ''} gardée${dupes > 1 ? 's' : ''}` : ''}.`;
    if (removed) message += ` ${removed} ancienne${removed > 1 ? 's' : ''} opération${removed > 1 ? 's' : ''} remplacée${removed > 1 ? 's' : ''}.`;
    if (linked) message += ` ${plural(linked, 'opération')} reconnue${linked > 1 ? 's' : ''} comme virement${linked > 1 ? 's' : ''} entre tes comptes.`;
    if (filled.size) message += ` Compte de résultat mis à jour pour ${[...filled].sort().map(monthLabel).join(', ')}.`;
    if (done) {
      const linkErr = await refreshBalanceLinks();
      if (linkErr) message += ` (Dettes et créances non mises à jour : ${describeDbError(linkErr.message)})`;
    }
    for (const note of new Set(notes)) message += ` ${note}`;
    if (reclassified) message += ` ${reclassified} course${reclassified > 1 ? 's' : ''} de l'appli retrouvée${reclassified > 1 ? 's' : ''} et classée${reclassified > 1 ? 's' : ''}.`;
    setBusy(false);
    if (failed.length) setError(`Non importé${failed.length > 1 ? 's' : ''} : ${failed.join(' ; ')}. Ces relevés restent dans la liste.`);
    else setBatch([]);
    onImported(message, topMonth(importedTx), groceries);
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

  // Récapitulatif des relevés lus : fichiers, première et dernière date, nombre de transactions
  const readable = batch.filter((it) => it.parsed);
  const starts = readable.map(batchStart).filter(Boolean).sort();
  const ends = readable.map(batchEnd).filter(Boolean).sort();
  const txCount = readable.reduce((s, it) => s + it.parsed!.transactions.length, 0);
  const toImport = batch.filter(willImport).length;
  // Une ligne du récapitulatif : l'intitulé puis la valeur
  const row = (label: string, value: React.ReactNode) => (
    <p className="border-b py-1" style={{ borderColor: FIN.line }}>
      <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label} :
      </span>{' '}
      <b>{value}</b>
    </p>
  );

  return (
    <>
      <ErrorNote message={error} />
      {batch.length > 0 ? (
        <div className="mt-2 text-[12px]" style={{ color: FIN.navy }}>
          {row(batch.length > 1 ? 'Noms des fichiers' : 'Nom du fichier', batch.map((it) => it.name).join(', '))}
          {starts.length > 0 && row('Date de début', longDate(starts[0]))}
          {ends.length > 0 && row('Date de fin', longDate(ends[ends.length - 1]))}
          {row('Total de transactions', txCount)}
          <p className="mt-2 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
            Liste des comptes concernés :
          </p>
          <ul className="mt-1 space-y-1.5">
            {batch.map((it) => {
              const acc = it.account.trim() || 'Compte courant';
              const s = it.parsed?.summary;
              const checking = !!it.parsed && (!it.check || it.checkedFor !== acc);
              return (
                <li key={it.id} className="rounded-sm border px-2.5 py-1.5 text-[11px]" style={{ borderColor: FIN.line, backgroundColor: FIN.paper }}>
                  {it.error ? (
                    <p className="leading-relaxed" style={{ color: FIN.rose }}>
                      <b>{it.name}</b> : {it.error}
                    </p>
                  ) : (
                    <>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={it.include}
                          disabled={busy}
                          onChange={(e) => setBatch((items) => items.map((b) => (b.id === it.id ? { ...b, include: e.target.checked } : b)))}
                          aria-label={`Importer ${acc} (${it.name})`}
                        />
                        {/* Compte reconnu sur le relevé ; sinon (export CSV…) il se choisit parmi mes comptes */}
                        {s?.accountName ? (
                          <b className="min-w-0 flex-1 truncate text-[12px]">{acc}</b>
                        ) : (
                          <select
                            value={acc}
                            disabled={busy}
                            onChange={(e) => setBatch((items) => items.map((b) => (b.id === it.id ? { ...b, account: e.target.value } : b)))}
                            aria-label={`Compte de ${it.name}`}
                            className="fin-select min-w-0 flex-1 py-0.5 pl-1.5 text-[12px] font-bold"
                          >
                            {[...new Set([acc, 'Compte courant', 'Livret A', 'LEP', ...accounts])].map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                        )}
                        {batch.length > 1 && <span className="shrink-0 text-[10px]" style={{ color: FIN.slate }}>{shortDate(batchStart(it))}</span>}
                      </label>
                      <p className="pl-6" style={{ color: FIN.slate }}>
                        Solde :{' '}
                        {s?.opening != null && s.closing != null ? (
                          <>
                            {formatEuros(s.opening)} → <b style={{ color: FIN.navy }}>{formatEuros(s.closing)}</b>
                          </>
                        ) : s?.monthEnds.length ? (
                          <b style={{ color: FIN.navy }}>{formatEuros(s.monthEnds[s.monthEnds.length - 1].balance)}</b>
                        ) : (
                          'non indiqué sur le relevé'
                        )}
                      </p>
                      {/* Note seulement : un relevé déjà importé peut l'être de nouveau (s'il diffère, ses données remplacent les anciennes) */}
                      {checking ? (
                        <p className="pl-6" style={{ color: FIN.slate }}>
                          Vérification des imports précédents…
                        </p>
                      ) : it.check && it.check.status !== 'new' ? (
                        <p className="pl-6" style={{ color: FIN.gold }}>
                          Ce relevé a déjà été importé.
                        </p>
                      ) : null}
                      {s?.verified === false && (
                        <p className="pl-6 leading-relaxed" style={{ color: FIN.rose }}>
                          ⚠ Les totaux ne correspondent pas au relevé : quelques opérations ont pu être mal lues.
                        </p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex gap-2">
            <FinButton onClick={confirmBatch} disabled={busy || toImport === 0}>
              {progress ?? (batch.length > 1 ? `Importer ${plural(toImport, 'relevé')}` : 'Importer')}
            </FinButton>
            <FinButton outline onClick={() => setBatch([])} disabled={busy}>
              Annuler
            </FinButton>
          </div>
        </div>
      ) : (
        <>
          <label className="mt-2 flex cursor-pointer flex-col items-center gap-1 rounded-sm border border-dashed px-3 py-5 text-center" style={{ borderColor: FIN.slate, color: FIN.slate }}>
            <FileUp size={22} />
            <span className="text-[11px] uppercase tracking-[0.2em]">{reading ?? 'Choisir un ou plusieurs relevés PDF, CSV ou OFX'}</span>
            {!reading && <span className="text-[10px]">jusqu&apos;à {MAX_FILES} d&apos;un coup</span>}
            <input
              type="file"
              multiple
              accept=".pdf,application/pdf,.csv,.ofx,.qfx,.txt,text/csv"
              className="hidden"
              disabled={!!reading}
              onChange={(e) => {
                pick(e.target.files);
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
      )}
    </>
  );
}

// Page Gestion : import des relevés, dépenses récurrentes et annuelles, catégories
export default function GestionPage() {
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
