'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AlertTriangle, PenLine } from 'lucide-react';
import { rememberedFinanceMonth, useViewedMonth } from '@/lib/health';
import { useCoverage, useMonthLines, useMonthOperations } from '@/lib/financeQueries';
import { estimateOf, isMissingLine, manualNotes, monthStatus, withEstimates, type TransferQuestion } from '@/lib/coverage';
import { lastDayOf, setTransferAccount } from '@/lib/transactions';
import { formatEuros, monthEndLabel, monthKey, monthLabel, SECTIONS, shiftMonth, totals, type FinanceLine, type Side, type Statement } from '@/lib/finance';
import {
  useFinanceToneVars,
  FIN,
  FinanceHeader,
  NewMonthCard,
  Ledger,
  LedgerComputed,
  SectionBlock,
  StatementTabs,
  SummaryTile
} from '@/components/finance/FinanceParts';
import { SwipePages } from '@/components/SwipePages';

// Teintes claires pour les montants posés sur le fond bleu nuit des totaux
const ON_NAVY = { sage: '#a9c4b0', rose: '#e3a6ab' };

const TABS: { id: Statement; label: string }[] = [
  { id: 'bilan', label: 'Bilan' },
  { id: 'resultat', label: 'Résultat' }
];

// Pages des deux documents, que l'on fait glisser : un tableau par page
const BILAN_PAGES = ['Actif', 'Passif'];
const RESULT_PAGES = ['Produits', 'Charges'];

// En-tête de chaque page : date d'arrêt, et la page en cours parmi les deux (« ← Actif · Passif → »)
function SwipeCaption({ page, labels, date }: { page: number; labels: string[]; date: string }) {
  return (
    <p className="mt-4 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
      {date}
      <span aria-hidden>·</span>
      {page > 0 && <span aria-hidden>←</span>}
      {labels.map((l, i) => (
        <span key={l} style={i === page ? { color: FIN.navy, fontWeight: 700 } : { opacity: 0.55 }}>
          {l}
        </span>
      ))}
      {page < labels.length - 1 && <span aria-hidden>→</span>}
    </p>
  );
}

// Mois en cours, lu dans le navigateur uniquement (le serveur peut être dans un autre fuseau horaire)
const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());

// Le bilan et le compte de résultat ne se modifient pas ici : leurs montants viennent des relevés importés (Gestion)
// et des budgets (Budget). Aucun montant n'est reporté d'un mois sur l'autre : quand le relevé d'un compte manque,
// une barre remplace son solde et les totaux qui en dépendent ; pour un livret, son solde est estimé quand c'est possible
// (lib/coverage), et le relevé reste signalé comme manquant.
export default function FinancePage() {
  // Teinte de la partie Finances selon l'état de santé
  const toneVars = useFinanceToneVars();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [offset, setOffset] = useState(0);
  // Le Bilan s'ouvre sur le mois qu'on regardait sur le Budget, sinon sur le mois précédent (le dernier terminé)
  const [remembered] = useState(rememberedFinanceMonth);
  const startMonth = remembered ?? (currentMonth && shiftMonth(currentMonth, -1));
  const period = startMonth ? shiftMonth(startMonth, offset) : null;
  // La teinte de la partie Finances suit l'état de santé du mois affiché
  useViewedMonth(period);
  const [tab, setTab] = useState<Statement>('bilan');

  // Lignes du mois affiché, gardées en mémoire entre deux visites (lib/financeQueries) : affichées tout de suite, puis rafraîchies
  const currentQuery = useMonthLines(period);
  // Le mois en cours reste un « nouveau mois » tant que son relevé n'est pas importé
  const operations = useMonthOperations(period).data;
  // Relevés présents ou manquants (règles dans lib/coverage, les mêmes que pour l'accueil et l'état de santé)
  const coverageQuery = useCoverage();
  const coverage = coverageQuery.data;
  const stored = currentQuery.data ?? [];
  const balanceLine = (account: string) => stored.find((l) => l.section === 'liquidites' && l.label.toLowerCase() === account);
  const status = period && coverage ? monthStatus(coverage, period) : null;
  // Relevés manquants : toujours signalés ; le solde d'un livret est estimé quand c'est possible, sinon il est inconnu
  const missingAccounts = status?.missing ?? [];
  const unknownAccounts = status?.unknown ?? [];
  const estimatedAccounts = status?.estimated ?? [];
  // Opérations ajoutées à la main ce mois-ci : elles tiennent lieu de relevé pour leur compte, une note le signale
  const manual = period && coverage ? manualNotes(coverage, period) : [];
  const isMissing = (line: FinanceLine) => isMissingLine(line, unknownAccounts);
  const isEstimated = (line: FinanceLine) => line.section === 'liquidites' && estimatedAccounts.some((a) => a.toLowerCase() === line.label.toLowerCase());
  // Un compte dont le relevé manque a sa ligne au bilan (avec une barre ou son solde estimé), même s'il n'en avait pas encore
  const withMissing: FinanceLine[] = [
    ...stored,
    ...missingAccounts
      .filter((a) => !balanceLine(a.toLowerCase()))
      .map((a) => ({ id: `manquant-${a}`, period: period!, statement: 'bilan' as const, section: 'liquidites', label: a, amount: 0, position: 1000 }))
  ];
  const lines = period && coverage ? withEstimates(withMissing, coverage, period) : withMissing;
  // Virements entre mes comptes dont l'autre compte est à préciser : chacun se précise dans le mois où il a eu lieu
  const questions = (coverage?.questions ?? []).filter((q) => !!period && q.date.startsWith(period));
  // Mois (autres que celui affiché) dont des virements restent à préciser pour estimer le solde d'un livret ce mois-ci
  const pendingMonths = (account: string) => {
    const e = period && coverage?.estimates.find((x) => x.month === period && x.account === account && x.balance === null);
    if (!e) return [];
    const months = (coverage?.questions ?? []).filter((q) => q.date > lastDayOf(e.base) && q.date <= lastDayOf(e.month)).map((q) => q.date.slice(0, 7));
    return [...new Set(months)].filter((m) => m !== period).sort();
  };
  const error = currentQuery.error && describeError(currentQuery.error);

  const loading = !period || (currentQuery.data === undefined && !currentQuery.error);
  const isNew = !!period && (stored.length === 0 || (period === currentMonth && operations === 0));
  const t = totals(lines.filter((l) => !isMissing(l)));
  // Un solde n'est pas connu : le patrimoine et les totaux du bilan non plus (null : affichés avec une barre)
  const incomplete = unknownAccounts.length > 0;
  // Des soldes sont estimés : les totaux le sont aussi
  const estimatedBilan = !incomplete && estimatedAccounts.length > 0;
  const known = (n: number) => (incomplete ? null : n);
  // Le compte de résultat (revenus, dépenses, épargne du mois) ne dépend que des comptes courants : un relevé de livret
  // manquant ne le rend pas incomplet
  const resultIncomplete = !!period && !!coverage && !monthStatus(coverage, period).resultKnown;
  const knownResult = (n: number) => (resultIncomplete ? null : n);

  // Affiche toutes les rubriques d'un côté du document
  function renderSide(side: Side) {
    return SECTIONS.filter((s) => s.side === side).map((section) => (
      <SectionBlock key={section.id} section={section} lines={lines.filter((l) => l.section === section.id)} missing={isMissing} estimated={isEstimated} />
    ));
  }

  return (
    <div className="finance-screen min-h-dvh pb-16 transition-colors duration-700" style={{ ...toneVars, backgroundColor: FIN.mist, color: FIN.navy }}>
      {/* Pas de mois futur : les Finances retranscrivent ce qui a déjà été fait */}
      <FinanceHeader
        month={period ? monthLabel(period) : ''}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => period && currentMonth && period < currentMonth && setOffset((o) => o + 1)}
        canNext={!!period && !!currentMonth && period < currentMonth}
      />

      <main className="mx-auto max-w-md px-4">
        {error && (
          <p
            className="mt-4 rounded-sm border px-3 py-2 text-[11px]"
            style={{
              borderColor: FIN.rose,
              color: FIN.rose,
              backgroundColor: FIN.paper
            }}
          >
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
            Chargement…
          </p>
        ) : isNew ? (
          // Mois vide, ou mois en cours sans relevé : on l'importe
          <NewMonthCard period={period} />
        ) : (
          <>
            {/* Relevés manquants du mois affiché : un court message par compte, qui mène à l'import (toujours affiché,
                même quand le solde d'un livret est estimé) */}
            {missingAccounts.length > 0 && (
              <Link
                href="/banque/releves"
                className="mt-5 block rounded-sm border px-3 py-2 text-[12px]"
                style={{ borderColor: FIN.rose, backgroundColor: FIN.paper, color: FIN.rose }}
              >
                {missingAccounts.map((a) => {
                  const estimate = estimateOf(coverage!, a, period!);
                  return (
                    <span key={a} className="flex items-start gap-2 py-0.5">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <span>
                        Relevé {a} manquant
                        {estimate && (
                          <span className="block text-[10px]" style={{ color: FIN.slate }}>
                            {estimate.balance !== null
                              ? `Solde estimé : relevé de ${monthLabel(estimate.base)} et virements entre tes comptes depuis (hors intérêts)`
                              : pendingMonths(a).length
                                ? `Solde estimé dès que les virements de ${pendingMonths(a).map(monthLabel).join(', ')} seront précisés (sur ${pendingMonths(a).length > 1 ? 'ces mois' : 'ce mois'})`
                                : 'Solde estimé dès que les virements ci-dessous seront précisés'}
                          </span>
                        )}
                      </span>
                    </span>
                  );
                })}
              </Link>
            )}
            {/* Virements dont on ne sait pas vers quel compte va l'argent : la réponse permet d'estimer le solde du livret */}
            {questions.length > 0 && <TransferQuestions questions={questions} onAnswered={coverageQuery.reload} />}
            {/* Opérations ajoutées à la main : elles comptent pour le mois, en attendant (ou en plus) du relevé */}
            {manual.length > 0 && (
              <div className="mt-3 rounded-sm border px-3 py-2 text-[12px]" style={{ borderColor: FIN.gold, backgroundColor: FIN.paper, color: FIN.navy }}>
                {manual.map((m) => (
                  <span key={m.account} className="flex items-center gap-2 py-0.5">
                    <PenLine size={14} className="shrink-0" style={{ color: FIN.gold }} aria-hidden />
                    {m.account} : {m.count} opération{m.count > 1 ? 's' : ''} ajoutée{m.count > 1 ? 's' : ''} à la main
                  </span>
                ))}
              </div>
            )}

            {/* Synthèse du mois */}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <SummaryTile
                label="Patrimoine net"
                value={incomplete ? '—' : `${estimatedBilan ? '≈ ' : ''}${formatEuros(t.patrimoine)}`}
                color={incomplete || t.patrimoine >= 0 ? FIN.navy : FIN.rose}
                note={estimatedBilan ? 'estimé, relevé manquant' : undefined}
              />
              <SummaryTile
                label="Épargne du mois"
                value={resultIncomplete ? '—' : formatEuros(t.resultat)}
                color={resultIncomplete || t.resultat >= 0 ? FIN.sage : FIN.rose}
                note={!resultIncomplete && t.tauxEpargne !== null ? `${Math.round(t.tauxEpargne * 100)} % des revenus` : undefined}
              />
            </div>

            <div className="mt-5">
              <StatementTabs tabs={TABS} value={tab} onChange={setTab} />
            </div>

            {/* Chaque tableau sur sa page : on passe de l'une à l'autre en glissant le doigt, ou avec les points en bas de l'écran */}
            {tab === 'bilan' ? (
              <SwipePages
                key="bilan"
                color={FIN.accent}
                labels={BILAN_PAGES}
                pages={[
                  <div key="actif">
                    <SwipeCaption page={0} labels={BILAN_PAGES} date={`Au ${monthEndLabel(period)}`} />
                    <Ledger title="Actif" total={known(t.actif)} color={ON_NAVY.sage} totalLabel="Total de l'actif">
                      {renderSide('actif')}
                    </Ledger>
                  </div>,
                  <div key="passif">
                    <SwipeCaption page={1} labels={BILAN_PAGES} date={`Au ${monthEndLabel(period)}`} />
                    <Ledger title="Passif" total={known(t.patrimoine + t.dettes)} color={ON_NAVY.rose} totalLabel="Total du passif">
                      {/* Capitaux propres : ce qui t'appartient vraiment, dont le résultat du mois */}
                      <LedgerComputed
                        title="Capitaux propres"
                        rows={[
                          {
                            label: 'Situation nette avant le résultat',
                            value: known(t.patrimoine - t.resultat),
                            note: 'Ce que tu possédais déjà, hors résultat du mois'
                          },
                          {
                            label: 'Résultat du mois',
                            value: knownResult(t.resultat),
                            note: 'Repris du compte de résultat',
                            color: t.resultat >= 0 ? FIN.sage : FIN.rose
                          }
                        ]}
                      />
                      {renderSide('passif')}
                    </Ledger>
                    {!incomplete && (
                      <p className="mt-2 text-center text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.sage }}>
                        ✓ Actif = Passif = {estimatedBilan ? '≈ ' : ''}
                        {formatEuros(t.actif)}
                        {estimatedBilan ? ' (soldes estimés)' : ''}
                      </p>
                    )}
                    <p className="mt-1 text-center text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
                      Le passif dit d&apos;où vient ce que tu possèdes : de tes dettes, ou de toi (capitaux propres). Le résultat du mois s&apos;ajoute à tes
                      capitaux propres.
                    </p>
                  </div>
                ]}
              />
            ) : (
              <SwipePages
                key="resultat"
                color={FIN.accent}
                labels={RESULT_PAGES}
                pages={[
                  <div key="produits">
                    <SwipeCaption page={0} labels={RESULT_PAGES} date={`Du 1er au ${monthEndLabel(period)}`} />
                    <Ledger title="Produits" total={knownResult(t.produits)} color={ON_NAVY.sage} totalLabel="Total des produits">
                      {renderSide('produits')}
                    </Ledger>
                  </div>,
                  <div key="charges">
                    <SwipeCaption page={1} labels={RESULT_PAGES} date={`Du 1er au ${monthEndLabel(period)}`} />
                    <Ledger title="Charges" total={knownResult(t.charges)} color={ON_NAVY.rose} totalLabel="Total des charges">
                      {renderSide('charges')}
                    </Ledger>
                    <table className="mt-3 w-full table-fixed border-collapse text-[12px]">
                      <tbody>
                        <tr
                          style={{
                            backgroundColor: FIN.navy,
                            color: FIN.paper
                          }}
                        >
                          <td className="px-2 py-2.5 text-[10px] uppercase tracking-[0.2em]">
                            {resultIncomplete ? 'Résultat du mois' : t.resultat >= 0 ? 'Résultat : épargne du mois' : 'Résultat : déficit du mois'}
                            <span className="block text-[9px] normal-case tracking-normal opacity-70">
                              Produits moins charges
                              {!resultIncomplete && t.tauxEpargne !== null ? `, soit ${Math.round(t.tauxEpargne * 100)} % des revenus` : ''} · reporté au passif du bilan
                            </span>
                          </td>
                          <td
                            className="w-[146px] px-2 py-2.5 text-right text-[15px] font-bold"
                            style={{
                              color: t.resultat >= 0 ? ON_NAVY.sage : ON_NAVY.rose
                            }}
                          >
                            {resultIncomplete ? '—' : formatEuros(t.resultat)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ]}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Virements entre mes comptes à préciser : pour chacun, l'autre compte (celui qui reçoit l'argent, ou qui l'envoie)
function TransferQuestions({ questions, onAnswered }: { questions: TransferQuestion[]; onAnswered: () => Promise<unknown> }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function answer(id: string, account: string) {
    setSaving(id);
    setError(null);
    const err = await setTransferAccount(id, account);
    if (err)
      setError(
        /transfer_account/.test(err.message)
          ? "La colonne « transfer_account » n'existe pas encore : lance le script supabase/transfer_accounts.sql dans Supabase."
          : `Erreur : ${err.message}`
      );
    else await onAnswered();
    setSaving(null);
  }
  return (
    <div className="mt-3 rounded-sm border px-3 py-2 text-[12px]" style={{ borderColor: FIN.gold, backgroundColor: FIN.paper, color: FIN.navy }}>
      <p className="text-[11px]" style={{ color: FIN.slate }}>
        Virements entre tes comptes : précise l&apos;autre compte pour estimer le solde de ton livret.
      </p>
      {questions.map((q) => (
        <label key={q.id} className="mt-2 block">
          <span className="block">
            {new Date(q.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · {q.label}
          </span>
          <span className="flex items-center gap-2 text-[11px]" style={{ color: FIN.slate }}>
            {formatEuros(q.amount)} sur {q.account}, {q.amount < 0 ? 'vers' : 'depuis'}
            <select
              className="min-w-0 flex-1 rounded-sm border bg-transparent px-1 py-0.5 text-[12px]"
              style={{ borderColor: FIN.line, color: FIN.navy }}
              defaultValue=""
              disabled={saving === q.id}
              onChange={(e) => e.target.value !== '' && answer(q.id, e.target.value === '-' ? '' : e.target.value)}
            >
              <option value="" disabled>
                Choisir…
              </option>
              {q.choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="-">Un compte non suivi ici</option>
            </select>
          </span>
        </label>
      ))}
      {error && (
        <p className="mt-2 text-[11px]" style={{ color: FIN.rose }}>
          {error}
        </p>
      )}
    </div>
  );
}

// Message lisible quand la table n'existe pas encore dans Supabase
function describeError(message: string) {
  if (/finance_lines/.test(message) && /(does not exist|schema cache|not find)/i.test(message)) {
    return "La table « finance_lines » n'existe pas encore dans Supabase : crée-la avec le script SQL indiqué en haut de lib/finance.ts.";
  }
  return `Erreur : ${message}`;
}
