'use client';

import { useState, useSyncExternalStore } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import { useGroceriesTotal, useMonthLines } from '@/lib/financeQueries';
import {
  addLine,
  deleteLine,
  formatEuros,
  GROCERIES,
  monthEndLabel,
  monthKey,
  monthLabel,
  SECTIONS,
  seedMonth,
  shiftMonth,
  totals,
  updateLine,
  type FinanceLine,
  type Section,
  type Side,
  type Statement
} from '@/lib/finance';
import {
  FIN,
  FinanceHeader,
  Ornament,
  Ledger,
  LedgerComputed,
  SectionBlock,
  StatementTabs,
  SummaryTile
} from '@/components/finance/FinanceParts';

// Teintes claires pour les montants posés sur le fond bleu nuit des totaux
const ON_NAVY = { sage: '#a9c4b0', rose: '#e3a6ab' };

const TABS: { id: Statement; label: string }[] = [
  { id: 'bilan', label: 'Bilan' },
  { id: 'resultat', label: 'Résultat' }
];

// Mois en cours, lu dans le navigateur uniquement (le serveur peut être dans un autre fuseau horaire)
const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());

export default function FinancePage() {
  const [confirm, confirmDialog] = useConfirm();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [offset, setOffset] = useState(0);
  const period = currentMonth ? shiftMonth(currentMonth, offset) : null;
  const [tab, setTab] = useState<Statement>('bilan');

  // Lignes du mois affiché, et du mois précédent (pour proposer de les reprendre quand le mois affiché est vide),
  // gardées en mémoire entre deux visites (lib/financeQueries) : affichées tout de suite, puis rafraîchies
  const currentQuery = useMonthLines(period);
  const previousQuery = useMonthLines(period && shiftMonth(period, -1));
  const groceriesQuery = useGroceriesTotal(period);
  const lines = currentQuery.data ?? [];
  const setLines = currentQuery.setData;
  const previous = previousQuery.data ?? [];
  const groceries = groceriesQuery.data ?? 0;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (currentQuery.error && describeError(currentQuery.error));

  const loading = !period || (currentQuery.data === undefined && !currentQuery.error);
  const t = totals(lines);
  const prev = totals(previous);
  // Variation du patrimoine que le résultat du mois n'explique pas (réévaluations, oublis)
  const otherChanges = t.patrimoine - prev.patrimoine - t.resultat;

  function report(err: { message: string } | null) {
    if (err) setError(describeError(err.message));
  }

  async function seed(from: FinanceLine[] | null) {
    if (!period) return;
    report(await seedMonth(period, from));
    currentQuery.reload();
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
        >
          {showGroceries && (
            <div className="my-1 flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[10px]" style={{ backgroundColor: FIN.mist, color: FIN.slate }}>
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
    <div className="finance-screen min-h-dvh pb-16" style={{ backgroundColor: FIN.mist, color: FIN.navy }}>
      {confirmDialog}
      <FinanceHeader
        month={period ? monthLabel(period) : ''}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => o + 1)}
      />

      <main className="mx-auto max-w-md px-4">
        {error && (
          <p className="mt-4 rounded-sm border px-3 py-2 text-[11px]" style={{ borderColor: FIN.rose, color: FIN.rose, backgroundColor: FIN.paper }}>
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
            Chargement…
          </p>
        ) : lines.length === 0 ? (
          // Mois vide : partir du modèle, ou reprendre le mois précédent
          <div className="mt-6 rounded-sm border px-5 py-8 text-center" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
            <p className="text-[32px] leading-none" style={{ fontFamily: 'var(--font-script), cursive' }}>
              Nouveau mois
            </p>
            <div className="my-3">
              <Ornament />
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: FIN.slate }}>
              Rien n&apos;est encore rempli pour {monthLabel(period)}.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {previous.length > 0 && (
                <button
                  type="button"
                  onClick={() => seed(previous)}
                  className="rounded-full py-2.5 text-[11px] uppercase tracking-[0.2em]"
                  style={{ backgroundColor: FIN.slate, color: FIN.paper }}
                >
                  Reprendre {monthLabel(shiftMonth(period, -1))}
                </button>
              )}
              <button
                type="button"
                onClick={() => seed(null)}
                className="rounded-full border py-2.5 text-[11px] uppercase tracking-[0.2em]"
                style={{ borderColor: FIN.slate, color: FIN.slate }}
              >
                Partir du modèle
              </button>
            </div>
          </div>
        ) : (
          <>
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

            {tab === 'bilan' ? (
              <>
                <p className="mt-4 text-center text-[10px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
                  Au {monthEndLabel(period)}
                </p>
                <Ledger title="Actif" total={t.actif} color={ON_NAVY.sage} totalLabel="Total de l'actif">
                  {renderSide('actif')}
                </Ledger>
                <Ledger title="Passif" total={t.patrimoine + t.dettes} color={ON_NAVY.rose} totalLabel="Total du passif">
                  {/* Capitaux propres : ce qui t'appartient vraiment, et comment le résultat du mois l'a fait évoluer */}
                  <LedgerComputed
                    title="Capitaux propres"
                    rows={
                      previous.length > 0
                        ? [
                            { label: 'Patrimoine net au début du mois', value: prev.patrimoine, note: `Bilan de ${monthLabel(shiftMonth(period, -1))}` },
                            { label: 'Résultat du mois', value: t.resultat, note: 'Repris du compte de résultat', color: t.resultat >= 0 ? FIN.sage : FIN.rose },
                            ...(Math.abs(otherChanges) >= 0.01
                              ? [{ label: 'Autres variations', value: otherChanges, note: 'Écart que le résultat n’explique pas : variation de valeur de tes biens ou placements, ou ligne oubliée' }]
                              : [])
                          ]
                        : [
                            { label: 'Situation nette avant le résultat', value: t.patrimoine - t.resultat, note: 'Ce que tu possédais déjà, hors résultat du mois' },
                            { label: 'Résultat du mois', value: t.resultat, note: 'Repris du compte de résultat', color: t.resultat >= 0 ? FIN.sage : FIN.rose }
                          ]
                    }
                  />
                  {renderSide('passif')}
                </Ledger>
                <p className="mt-2 text-center text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.sage }}>
                  ✓ Actif = Passif = {formatEuros(t.actif)}
                </p>
                <p className="mt-1 text-center text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
                  Le passif dit d&apos;où vient ce que tu possèdes : de tes dettes, ou de toi (capitaux propres). Le résultat du mois
                  s&apos;ajoute à tes capitaux propres.
                </p>
              </>
            ) : (
              <>
                <p className="mt-4 text-center text-[10px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
                  Du 1er au {monthEndLabel(period)}
                </p>
                <Ledger title="Produits" total={t.produits} color={ON_NAVY.sage} totalLabel="Total des produits">
                  {renderSide('produits')}
                </Ledger>
                <Ledger title="Charges" total={t.charges} color={ON_NAVY.rose} totalLabel="Total des charges">
                  {renderSide('charges')}
                </Ledger>
                <table className="mt-3 w-full table-fixed border-collapse text-[12px]">
                  <tbody>
                    <tr style={{ backgroundColor: FIN.navy, color: FIN.paper }}>
                      <td className="px-2 py-2.5 text-[10px] uppercase tracking-[0.2em]">
                        {t.resultat >= 0 ? 'Résultat : épargne du mois' : 'Résultat : déficit du mois'}
                        <span className="block text-[9px] normal-case tracking-normal opacity-70">
                          Produits moins charges
                          {t.tauxEpargne !== null ? `, soit ${Math.round(t.tauxEpargne * 100)} % des revenus` : ''} · reporté au passif du
                          bilan
                        </span>
                      </td>
                      <td className="w-[146px] px-2 py-2.5 text-right text-[15px] font-bold" style={{ color: t.resultat >= 0 ? ON_NAVY.sage : ON_NAVY.rose }}>
                        {formatEuros(t.resultat)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
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
