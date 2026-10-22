'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { useViewedMonth } from '@/lib/health';
import { useGroceriesTotal, useMonthLines, useMonthOperations, useStatementCoverage } from '@/lib/financeQueries';
import {
  addLine,
  deleteLine,
  formatEuros,
  GROCERIES,
  monthEndLabel,
  monthKey,
  monthLabel,
  SECTIONS,
  shiftMonth,
  totals,
  updateLine,
  type FinanceLine,
  type Section,
  type Side,
  type Statement
} from '@/lib/finance';
import {
  useFinanceToneVars,
  FIN,
  FinanceHeader,
  NewMonthCard,
  ofMonth,
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

export default function FinancePage() {
  const [confirm, confirmDialog] = useConfirm();
  // Teinte de la partie Finances selon l'état de santé
  const toneVars = useFinanceToneVars();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [offset, setOffset] = useState(0);
  const period = currentMonth ? shiftMonth(currentMonth, offset) : null;
  // La teinte de la partie Finances suit l'état de santé du mois affiché
  useViewedMonth(period);
  const [tab, setTab] = useState<Statement>('bilan');

  // Lignes du mois affiché, et du mois précédent (pour la variation du patrimoine),
  // gardées en mémoire entre deux visites (lib/financeQueries) : affichées tout de suite, puis rafraîchies
  const currentQuery = useMonthLines(period);
  const previousQuery = useMonthLines(period && shiftMonth(period, -1));
  const groceriesQuery = useGroceriesTotal(period);
  // Le mois en cours reste un « nouveau mois » tant que son relevé n'est pas importé
  const operations = useMonthOperations(period).data;
  // Comptes suivis par relevés : leur solde n'est connu que pour les mois couverts par un relevé
  const coverage = useStatementCoverage(period).data;
  const lines = currentQuery.data ?? [];
  // Relevés manquants pour faire correctement le bilan du mois : comptes suivis par relevés depuis ce mois ou avant,
  // sans opération ce mois-ci ni solde inscrit par un relevé sur leur ligne du bilan
  const balanceLine = (account: string) => lines.find((l) => l.section === 'liquidites' && l.label.toLowerCase() === account);
  const missingAccounts =
    period && coverage
      ? coverage.tracked
          .filter(({ account, first }) => {
            const key = account.toLowerCase();
            const line = balanceLine(key);
            return first <= period && !coverage.present.includes(key) && !(line?.auto && line.amount !== 0);
          })
          .map((a) => a.account)
      : [];
  // La même alerte, sur la ligne du compte concerné
  const missingStatement = (line: FinanceLine) =>
    period && line.section === 'liquidites' && missingAccounts.some((a) => a.toLowerCase() === line.label.toLowerCase())
      ? `Relevé ${ofMonth(period)} pas encore ajouté`
      : null;
  const setLines = currentQuery.setData;
  const previous = previousQuery.data ?? [];
  const groceries = groceriesQuery.data ?? 0;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (currentQuery.error && describeError(currentQuery.error));

  const loading = !period || (currentQuery.data === undefined && !currentQuery.error);
  const isNew = !!period && (lines.length === 0 || (period === currentMonth && operations === 0));
  const t = totals(lines);
  const prev = totals(previous);
  // Variation du patrimoine que le résultat du mois n'explique pas (réévaluations, oublis)
  const otherChanges = t.patrimoine - prev.patrimoine - t.resultat;

  function report(err: { message: string } | null) {
    if (err) setError(describeError(err.message));
  }

  async function add(section: Section) {
    if (!period) return;
    const position = Math.max(-1, ...lines.filter((l) => l.section === section.id).map((l) => l.position)) + 1;
    const { line, error: err } = await addLine(period, section, 'Nouvelle ligne', position);
    report(err);
    if (line) setLines((ls) => [...ls, line]);
  }

  async function change(line: FinanceLine, input: Partial<Pick<FinanceLine, 'label' | 'amount'>>) {
    // Un montant corrigé à la main ne sera plus recalculé par les imports de relevés
    const changes = input.amount !== undefined && line.auto ? { ...input, auto: false } : input;
    setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, ...changes } : l)));
    report(await updateLine(line.id, changes));
  }

  async function remove(line: FinanceLine) {
    if (!(await confirm('Supprimer la ligne', `Supprimer la ligne « ${line.label} » ?`))) return;
    setLines((ls) => ls.filter((l) => l.id !== line.id));
    report(await deleteLine(line.id));
  }

  // Reporte les courses enregistrées dans l'appli sur la ligne "Courses" (créée si besoin)
  async function useGroceries() {
    const existing = lines.find((l) => l.section === GROCERIES.section && l.label === GROCERIES.label);
    if (existing) return change(existing, { amount: groceries });
    const section = SECTIONS.find((s) => s.id === GROCERIES.section)!;
    const { line, error: err } = await addLine(period!, section, GROCERIES.label, -1);
    report(err);
    if (line) {
      setLines((ls) => [...ls, { ...line, amount: groceries }]);
      report(await updateLine(line.id, { amount: groceries }));
    }
  }

  // Affiche toutes les rubriques d'un côté du document
  function renderSide(side: Side) {
    return SECTIONS.filter((s) => s.side === side).map((section) => {
      const sectionLines = lines.filter((l) => l.section === section.id);
      const groceriesLine = sectionLines.find((l) => l.label === GROCERIES.label);
      const showGroceries = section.id === GROCERIES.section && groceries > 0 && groceriesLine?.amount !== groceries;
      return (
        <SectionBlock
          key={section.id}
          section={section}
          lines={sectionLines}
          onAdd={() => add(section)}
          onRename={(line, label) => change(line, { label })}
          onAmount={(line, amount) => change(line, { amount })}
          onDelete={remove}
          warningFor={missingStatement}
        >
          {showGroceries && (
            <div
              className="my-1 flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[10px]"
              style={{ backgroundColor: FIN.mist, color: FIN.slate }}
            >
              <span>Courses enregistrées dans l&apos;appli : {formatEuros(groceries)}</span>
              <button type="button" onClick={useGroceries} className="uppercase tracking-[0.15em]" style={{ color: FIN.gold }}>
                Reporter
              </button>
            </div>
          )}
        </SectionBlock>
      );
    });
  }

  return (
    <div className="finance-screen min-h-dvh pb-16 transition-colors duration-700" style={{ ...toneVars, backgroundColor: FIN.mist, color: FIN.navy }}>
      {confirmDialog}
      {/* Pas de mois futur : les Finances retranscrivent ce qui a déjà été fait */}
      <FinanceHeader
        month={period ? monthLabel(period) : ''}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => Math.min(0, o + 1))}
        canNext={offset < 0}
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
            {/* Bilan incomplet : il manque le relevé d'un ou plusieurs comptes pour ce mois */}
            {missingAccounts.length > 0 && (
              <div className="mt-5 rounded-sm border px-3 py-3 text-[12px] leading-relaxed" style={{ borderColor: FIN.rose, backgroundColor: FIN.paper }}>
                <p className="flex items-start gap-2 font-bold" style={{ color: FIN.rose }}>
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                  Bilan de {monthLabel(period)} incomplet
                </p>
                <p className="mt-1" style={{ color: FIN.navy }}>
                  Il manque le relevé {ofMonth(period)} pour {missingAccounts.length > 1 ? 'les comptes' : 'le compte'}{' '}
                  <b>{missingAccounts.join(', ')}</b> : {missingAccounts.length > 1 ? 'leurs soldes' : 'son solde'} ne {missingAccounts.length > 1 ? 'sont' : 'est'} pas
                  connu{missingAccounts.length > 1 ? 's' : ''}, et le patrimoine net du mois n&apos;est pas juste. Importe {missingAccounts.length > 1 ? 'ces relevés' : 'ce relevé'}{' '}
                  pour compléter le mois.
                </p>
                <Link
                  href="/banque/releves"
                  className="mt-2 inline-block rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.2em]"
                  style={{ backgroundColor: FIN.rose, color: FIN.paper }}
                >
                  Importer {missingAccounts.length > 1 ? 'les relevés' : 'le relevé'} {ofMonth(period)}
                </Link>
              </div>
            )}

            {/* Synthèse du mois */}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <SummaryTile label="Patrimoine net" value={formatEuros(t.patrimoine)} color={t.patrimoine >= 0 ? FIN.navy : FIN.rose} />
              <SummaryTile
                label="Épargne du mois"
                value={formatEuros(t.resultat)}
                color={t.resultat >= 0 ? FIN.sage : FIN.rose}
                note={t.tauxEpargne !== null ? `${Math.round(t.tauxEpargne * 100)} % des revenus` : undefined}
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
                    <Ledger title="Actif" total={t.actif} color={ON_NAVY.sage} totalLabel="Total de l'actif">
                      {renderSide('actif')}
                    </Ledger>
                  </div>,
                  <div key="passif">
                    <SwipeCaption page={1} labels={BILAN_PAGES} date={`Au ${monthEndLabel(period)}`} />
                    <Ledger title="Passif" total={t.patrimoine + t.dettes} color={ON_NAVY.rose} totalLabel="Total du passif">
                      {/* Capitaux propres : ce qui t'appartient vraiment, et comment le résultat du mois l'a fait évoluer */}
                      <LedgerComputed
                        title="Capitaux propres"
                        rows={
                          previous.length > 0
                            ? [
                                {
                                  label: 'Patrimoine net au début du mois',
                                  value: prev.patrimoine,
                                  note: `Bilan de ${monthLabel(shiftMonth(period, -1))}`
                                },
                                {
                                  label: 'Résultat du mois',
                                  value: t.resultat,
                                  note: 'Repris du compte de résultat',
                                  color: t.resultat >= 0 ? FIN.sage : FIN.rose
                                },
                                ...(Math.abs(otherChanges) >= 0.01
                                  ? [
                                      {
                                        label: 'Autres variations',
                                        value: otherChanges,
                                        note: 'Écart que le résultat n’explique pas : variation de valeur de tes biens ou placements, ou ligne oubliée'
                                      }
                                    ]
                                  : [])
                              ]
                            : [
                                {
                                  label: 'Situation nette avant le résultat',
                                  value: t.patrimoine - t.resultat,
                                  note: 'Ce que tu possédais déjà, hors résultat du mois'
                                },
                                {
                                  label: 'Résultat du mois',
                                  value: t.resultat,
                                  note: 'Repris du compte de résultat',
                                  color: t.resultat >= 0 ? FIN.sage : FIN.rose
                                }
                              ]
                        }
                      />
                      {renderSide('passif')}
                    </Ledger>
                    <p className="mt-2 text-center text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.sage }}>
                      ✓ Actif = Passif = {formatEuros(t.actif)}
                    </p>
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
                    <Ledger title="Produits" total={t.produits} color={ON_NAVY.sage} totalLabel="Total des produits">
                      {renderSide('produits')}
                    </Ledger>
                  </div>,
                  <div key="charges">
                    <SwipeCaption page={1} labels={RESULT_PAGES} date={`Du 1er au ${monthEndLabel(period)}`} />
                    <Ledger title="Charges" total={t.charges} color={ON_NAVY.rose} totalLabel="Total des charges">
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
                            {t.resultat >= 0 ? 'Résultat : épargne du mois' : 'Résultat : déficit du mois'}
                            <span className="block text-[9px] normal-case tracking-normal opacity-70">
                              Produits moins charges
                              {t.tauxEpargne !== null ? `, soit ${Math.round(t.tauxEpargne * 100)} % des revenus` : ''} · reporté au passif du bilan
                            </span>
                          </td>
                          <td
                            className="w-[146px] px-2 py-2.5 text-right text-[15px] font-bold"
                            style={{
                              color: t.resultat >= 0 ? ON_NAVY.sage : ON_NAVY.rose
                            }}
                          >
                            {formatEuros(t.resultat)}
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

// Message lisible quand la table n'existe pas encore dans Supabase
function describeError(message: string) {
  if (/finance_lines/.test(message) && /(does not exist|schema cache|not find)/i.test(message)) {
    return "La table « finance_lines » n'existe pas encore dans Supabase : crée-la avec le script SQL indiqué en haut de lib/finance.ts.";
  }
  return `Erreur : ${message}`;
}
