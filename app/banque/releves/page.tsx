'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileUp, X } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import { parseStatement, readStatementFile, type ParseResult } from '@/lib/bankImport';
import { readPdfStatement } from '@/lib/bankPdf';
import { orThrow, useCached } from '@/lib/cache';
import {
  checkStatement,
  completeFromStatement,
  deleteTransactions,
  fetchTransactions,
  importTransactions,
  monthOf,
  reclassifyOthers,
  type StatementCheck
} from '@/lib/transactions';
import { describeDbError, syncSavingsAccount } from '@/lib/financePlans';
import { ErrorNote, FIN, FinanceHeader, FinancePage, FinButton, Panel } from '@/components/finance/FinanceParts';

const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Résumé des écarts entre un relevé et ce qui est déjà enregistré (ex : « 12 identiques, 2 opérations nouvelles ou modifiées »)
function diffText(c: StatementCheck) {
  const parts = [];
  if (c.added.length) parts.push(`${c.added.length} opération${c.added.length > 1 ? 's' : ''} nouvelle${c.added.length > 1 ? 's' : ''} ou modifiée${c.added.length > 1 ? 's' : ''}`);
  if (c.removed.length) parts.push(`${c.removed.length} opération${c.removed.length > 1 ? 's' : ''} enregistrée${c.removed.length > 1 ? 's' : ''} absente${c.removed.length > 1 ? 's' : ''} du relevé`);
  return `${c.present} identique${c.present > 1 ? 's' : ''}, ${parts.join(', ')}`;
}

// Import d'un relevé : choix du fichier, aperçu, puis enregistrement
function ImportForm({ accounts, onImported }: { accounts: string[]; onImported: (message: string, month?: string) => void }) {
  const [parsed, setParsed] = useState<(ParseResult & { name: string }) | null>(null);
  const [account, setAccount] = useState('Compte courant');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Relevé comparé à ce qui est déjà enregistré sur le compte choisi (null pendant la vérification)
  const [check, setCheck] = useState<StatementCheck | null>(null);
  const [ask, askDialog] = useConfirm();

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
    const { inserted, error: err } = await importTransactions(parsed.transactions, name);
    if (err) {
      setBusy(false);
      return setError(describeDbError(err.message));
    }
    const dupes = parsed.transactions.length - inserted;
    let message = `${inserted} opération${inserted > 1 ? 's' : ''} importée${inserted > 1 ? 's' : ''}${dupes ? `, ${dupes} déjà présente${dupes > 1 ? 's' : ''} gardée${dupes > 1 ? 's' : ''}` : ''}.`;
    if (c.removed.length) message += ` ${c.removed.length} ancienne${c.removed.length > 1 ? 's' : ''} opération${c.removed.length > 1 ? 's' : ''} remplacée${c.removed.length > 1 ? 's' : ''}.`;
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
    // Mois où tombent le plus d'opérations du relevé : le lien vers le budget s'y place
    const counts = new Map<string, number>();
    for (const t of parsed.transactions) counts.set(monthOf(t.date), (counts.get(monthOf(t.date)) ?? 0) + 1);
    const month = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
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
                    <span className="truncate">+ {shortDate(t.date)} · {t.label}</span>
                    <span>{formatEuros(t.amount)}</span>
                  </li>
                ))}
                {check.removed.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex justify-between gap-2 line-through">
                    <span className="truncate">− {shortDate(t.date)} · {t.label}</span>
                    <span>{formatEuros(t.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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

export default function RelevesPage() {
  const [notice, setNotice] = useState<{ message: string; month?: string } | null>(null);
  // Comptes déjà alimentés par un relevé (12 derniers mois), proposés dans le champ « Compte concerné »
  const accountsQuery = useCached('finances:comptes-importes', async () => {
    const today = monthKey(new Date());
    const { transactions, error } = await fetchTransactions(`${shiftMonth(today, -12)}-01`, `${today}-31`);
    return [...new Set(orThrow(transactions, error).map((t) => t.account))];
  });

  return (
    <FinancePage header={<FinanceHeader subtitle="relevés · import" />}>
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
      <Panel title="Importer un relevé">
        <ImportForm
          accounts={accountsQuery.data ?? []}
          onImported={(message, month) => {
            setNotice({ message, month });
            accountsQuery.reload();
          }}
        />
      </Panel>
    </FinancePage>
  );
}
