'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AlertTriangle, PenLine } from 'lucide-react';
import { rememberedFinanceMonth, useViewedMonth } from '@/lib/health';
import { lineKey, useCoverage, useDebtCategories, useFilledLines, useMonthLines, useMonthOperations } from '@/lib/financeQueries';
import {
  clearTransfersToVerify,
  isMissingLine,
  manualNotes,
  monthStatus,
  monthsToVerify,
  readTransfersToVerify,
  subscribeTransfersToVerify,
  withEstimates,
  type TransferCheck,
  type TransferMismatch
} from '@/lib/coverage';
import {
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  groupMembers,
  isSavingsAccount,
  loadCategories,
  setTransferAccount,
  type Category,
  type Transaction
} from '@/lib/transactions';
import { orThrow, useCached } from '@/lib/cache';
import { balanceLinksSettled, checkBalance, refreshBalanceLinksOnce } from '@/lib/balanceLinks';
import { formatEuros, monthEndLabel, monthKey, monthLabel, SECTIONS, shiftMonth, totals, type FinanceLine, type Section, type Side, type Statement } from '@/lib/finance';
import {
  useFinanceToneVars,
  FIN,
  FinanceHeader,
  ImportStatementButton,
  NewMonthCard,
  Ledger,
  LedgerComputed,
  LedgerFiller,
  SectionBlock,
  StatementTabs,
  SummaryTile
} from '@/components/finance/FinanceParts';
import { SwipePages } from '@/components/SwipePages';
import { fetchTxWindow, MonthCashSummary, TX_PREFIX, type TxWindow } from '@/components/finance/MonthCashSummary';

// Teintes claires pour les montants posés sur le fond bleu nuit des totaux
const ON_NAVY = { sage: '#a9c4b0', rose: '#e3a6ab' };

const TABS: { id: Statement; label: string }[] = [
  { id: 'bilan', label: 'Bilan' },
  { id: 'resultat', label: 'Résultat' }
];

// Pages des deux documents, que l'on fait glisser : un tableau par page
const BILAN_PAGES = ['Actif', 'Passif'];
// Rubrique calculée des capitaux propres (passif), repliable comme les autres
const CAPITAUX = 'capitaux-propres';
const RESULT_PAGES = ['Produits', 'Charges'];

// Tableau des charges par grande catégorie : une rubrique par grande catégorie de sorties (ordre alphabétique), avec
// les catégories qui ont des dépenses ce mois-ci ; les catégories sans grande catégorie viennent à la fin. Mêmes règles
// que le compte de résultat (lib/transactions, reportToStatement) : comptes courants seulement (pas les livrets), sans
// les virements entre mes comptes ni les opérations qui vont au bilan, dépenses moins remboursements (jamais négatif).
// "total" : charges du compte de résultat ; s'il diffère (ligne saisie à la main…), l'écart a sa propre ligne.
function chargesByGroup(period: string, monthTx: Transaction[], isDebtTx: (t: Transaction) => boolean, total: number | null) {
  const amounts = new Map<string, number>();
  for (const t of monthTx) {
    const cat = categoryById(t.category);
    if (isSavingsAccount(t.account) || cat.kind === 'transfer' || cat.kind === 'income' || isDebtTx(t) || !cat.section || !cat.line) continue;
    if (SECTIONS.find((s) => s.id === cat.section)?.side !== 'charges') continue;
    amounts.set(cat.id, (amounts.get(cat.id) ?? 0) - t.amount);
  }
  const sections: Section[] = [];
  const lines: FinanceLine[] = [];
  const add = (id: string, title: string, rows: { id: string; label: string; amount: number }[]) => {
    sections.push({ id, statement: 'resultat', side: 'charges', title, template: [] });
    rows.forEach((r, position) => lines.push({ id: r.id, period, statement: 'resultat', section: id, label: r.label, amount: r.amount, position }));
  };
  const rowsOf = (categories: Category[]) =>
    categories
      .filter((c) => (amounts.get(c.id) ?? 0) > 0)
      .sort(byLabel)
      .map((c) => ({ id: `categorie-${c.id}`, label: c.label, amount: Math.round(amounts.get(c.id)! * 100) / 100 }));
  for (const g of categoryGroups()
    .filter((g) => g.kind === 'expense')
    .sort((a, b) => a.label.localeCompare(b.label, 'fr')))
    add(`groupe-${g.id}`, g.label, rowsOf(groupMembers(g.id)));
  const loose = rowsOf(CATEGORIES.filter((c) => !c.group));
  if (loose.length) add('groupe-sans', 'Sans grande catégorie', loose);
  // Écart avec les charges enregistrées (ligne saisie à la main, arrondis…) : montré à part pour que le total tombe juste
  const gap = total === null ? 0 : Math.round((total - lines.reduce((s, l) => s + l.amount, 0)) * 100) / 100;
  if (Math.abs(gap) >= 0.01) add('groupe-autres', 'Autres charges', [{ id: 'charges-ecart', label: 'Saisies à la main et ajustements', amount: gap }]);
  return { sections, lines };
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
  // Mois choisi avec les flèches ; sinon le Bilan s'ouvre sur le mois qu'on regardait (sur le Budget, ou avant
  // d'actualiser la page), sinon sur le mois précédent (le dernier terminé)
  const [chosen, setChosen] = useState<string | null>(null);
  const remembered = useSyncExternalStore(noSubscribe, rememberedFinanceMonth, () => null);
  const period = chosen ?? remembered ?? (currentMonth && shiftMonth(currentMonth, -1));
  // La teinte de la partie Finances suit l'état de santé du mois affiché
  useViewedMonth(period);
  const [tab, setTab] = useState<Statement>('bilan');
  // Messages des relevés manquants, ouverts par le triangle sur la case du patrimoine
  const [showMissing, setShowMissing] = useState(false);

  // Lignes du mois affiché, gardées en mémoire entre deux visites (lib/financeQueries) : affichées tout de suite, puis rafraîchies
  const currentQuery = useMonthLines(period);
  // Lignes du mois d'avant : sa situation nette ouvre les capitaux propres du mois affiché
  const previousQuery = useMonthLines(period && shiftMonth(period, -1));
  // Lignes qui ont déjà eu un montant, un mois ou un autre : les autres peuvent être masquées pour égaler les tableaux
  const filledQuery = useFilledLines();
  const filled = useMemo(() => (filledQuery.data ? new Set(filledQuery.data) : null), [filledQuery.data]);
  // Rubriques dont les lignes repliées (jamais remplies) sont dépliées
  // Tableaux repliés à l'ouverture (seule la ligne des totaux) ; toucher un total déplie ou replie les deux tableaux ensemble
  const [tablesOpen, setTablesOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());
  // Transactions du mois (même mémoire que le Budget) et catégories chargées : tableau des charges par grande catégorie
  const txQuery = useCached<TxWindow>(period && `${TX_PREFIX}${period}`, () => fetchTxWindow(period!));
  const categoriesQuery = useCached('finances:categories', async () => orThrow(Date.now(), await loadCategories()));
  const isDebtTx = useDebtCategories();
  // Les lignes reliées (créances, emprunts, dettes) sont recalculées une fois à l'ouverture, puis le mois est rechargé
  const reloadLines = currentQuery.reload;
  // Équilibre du bilan contrôlé à chaque affichage du mois, une fois les recalculs finis (après un import, un reclassement
  // ou un connecteur modifié) : la liste des problèmes, vide si tout est juste
  const balanceQuery = useCached(period && `bilan:controle:${period}`, async () => {
    await refreshBalanceLinksOnce();
    await balanceLinksSettled();
    return checkBalance(period!);
  });
  const reloadBalance = balanceQuery.reload;
  useEffect(() => {
    refreshBalanceLinksOnce().then((done) => {
      if (done) {
        reloadLines();
        reloadBalance();
      }
    });
  }, [reloadLines, reloadBalance]);
  const balanceProblems = balanceQuery.data ?? [];
  const unbalanced = balanceProblems.length > 0;
  const [showUnbalanced, setShowUnbalanced] = useState(false);
  // Triangle d'alerte sur le coin des cartes Dette et Créance : affiche ou masque les problèmes trouvés
  const unbalancedButton = (
    <button
      type="button"
      onClick={() => setShowUnbalanced((v) => !v)}
      aria-expanded={showUnbalanced}
      aria-label="Bilan déséquilibré : voir pourquoi"
      className="flex h-7 w-7 items-center justify-center rounded-full border shadow-sm"
      style={{ borderColor: FIN.rose, backgroundColor: showUnbalanced ? FIN.rose : FIN.paper, color: showUnbalanced ? FIN.paper : FIN.rose }}
    >
      <AlertTriangle size={15} aria-hidden />
    </button>
  );
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
  // Tous les virements du mois, à revérifier après un changement dans la liste des opérations (ou sur demande)
  const monthTransfers = (coverage?.transfers ?? []).filter((q) => !!period && q.date.startsWith(period));
  const mismatches = (coverage?.mismatches ?? []).filter((m) => m.month === period);
  const verifySnapshot = useSyncExternalStore(subscribeTransfersToVerify, readTransfersToVerify, () => '');
  const flagged = !!period && monthsToVerify(verifySnapshot).includes(period);
  const error = currentQuery.error && describeError(currentQuery.error);

  const loading = !period || (currentQuery.data === undefined && !currentQuery.error);
  const isNew = !loading && !!period && (stored.length === 0 || (period === currentMonth && operations === 0));
  // Mois en cours sans relevé : le bouton d'import, puis la page telle qu'elle sera, sans données (lignes du modèle,
  // une barre à la place de chaque montant). Un mois passé sans relevé garde la carte « Nouveau mois ».
  const blank = isNew && period === currentMonth;
  // Pendant le chargement : la même page vide (lignes du modèle, une barre à la place des montants), qui se remplit
  // ensuite sans que les cartes ni les boutons n'apparaissent d'un coup
  const empty = blank || loading;
  const shownLines: FinanceLine[] = empty
    ? SECTIONS.flatMap((s) =>
        s.template.map((label, position) => ({ id: `vide-${s.id}-${position}`, period: period!, statement: s.statement, section: s.id, label, amount: 0, position }))
      )
    : lines;
  const lineMissing = empty ? () => true : isMissing;
  const t = totals(shownLines.filter((l) => !lineMissing(l)));
  // Un solde n'est pas connu : le patrimoine et les totaux du bilan non plus (null : affichés avec une barre)
  const incomplete = empty || unknownAccounts.length > 0;
  // Des soldes sont estimés : les totaux le sont aussi
  const estimatedBilan = !incomplete && estimatedAccounts.length > 0;
  const known = (n: number) => (incomplete ? null : n);
  // Le compte de résultat (revenus, dépenses, épargne du mois) ne dépend que des comptes courants : un relevé de livret
  // manquant ne le rend pas incomplet
  const resultIncomplete = empty || (!!period && !!coverage && !monthStatus(coverage, period).resultKnown);
  const knownResult = (n: number) => (resultIncomplete ? null : n);
  // Lignes « Dette » (ce que je dois) et « Créance » (ce que les autres me doivent) du bilan, affichées dans la synthèse
  // à côté du patrimoine
  const lineTotal = (section: string, label: string) =>
    shownLines.filter((l) => l.section === section && l.label.trim().toLowerCase() === label).reduce((s, l) => s + l.amount, 0);
  const iOwe = lineTotal('dettes', 'dette');
  const owedToMe = lineTotal('creances', 'créance');

  // Capitaux propres : la situation nette de la fin du mois d'avant (son patrimoine net, calculé comme au bilan de ce
  // mois-là : soldes estimés compris, soldes inconnus exclus), plus le résultat du mois. Le patrimoine peut aussi bouger
  // hors du compte de résultat (livrets et placements, qui n'y sont pas, intérêts, soldes corrigés, lignes reliées…) :
  // cet écart a sa propre ligne, pour que le total reste le patrimoine net du mois.
  const previousMonth = period && shiftMonth(period, -1);
  const previousStored = previousQuery.data;
  const previousStatus = previousMonth && coverage ? monthStatus(coverage, previousMonth) : null;
  const previousNet =
    !previousMonth || !coverage || !previousStored || previousStored.every((l) => l.statement !== 'bilan')
      ? null
      : totals(withEstimates(previousStored, coverage, previousMonth).filter((l) => !isMissingLine(l, previousStatus!.unknown))).patrimoine;
  const previousKnown = previousNet !== null && previousStatus!.bilanKnown;
  const otherChanges = previousNet === null ? 0 : Math.round((t.patrimoine - previousNet - t.resultat) * 100) / 100;
  const capitalRows: { label: string; value: number | null; note?: string; color?: string }[] = [
    previousNet === null
      ? { label: 'Situation nette avant le résultat', value: known(t.patrimoine - t.resultat), note: 'Pas de bilan le mois d’avant : patrimoine net moins le résultat' }
      : {
          label: 'Situation nette du mois précédent',
          value: previousKnown ? previousNet : null,
          note: 'Patrimoine net à la fin du mois d’avant'
        },
    { label: 'Résultat du mois', value: knownResult(t.resultat), note: 'Repris du compte de résultat', color: t.resultat >= 0 ? FIN.sage : FIN.rose },
    ...(previousNet !== null && otherChanges !== 0
      ? [
          {
            label: 'Autres variations',
            value: previousKnown && !incomplete && !resultIncomplete ? otherChanges : null,
            note: 'Hors compte de résultat : livrets, placements, intérêts, soldes corrigés, lignes reliées…',
            color: otherChanges >= 0 ? FIN.sage : FIN.rose
          }
        ]
      : [])
  ];

  // Charges : par grande catégorie, d'après les transactions du mois (le total reste celui du compte de résultat)
  const txReady = !!txQuery.data && categoriesQuery.data !== undefined && !!period;
  const monthTx = txReady && !empty ? txQuery.data!.list.filter((tx) => tx.date.startsWith(period!)) : [];
  const chargeView = chargesByGroup(period ?? '', monthTx, isDebtTx, txReady && !resultIncomplete ? t.charges : null);
  // Rubriques et lignes de chaque côté : les charges par grande catégorie, les autres côtés tels qu'enregistrés
  const sectionsOf = (side: Side) => (side === 'charges' ? chargeView.sections : SECTIONS.filter((s) => s.side === side));
  const sideLines = (side: Side) => (side === 'charges' ? chargeView.lines : shownLines);

  // Affiche toutes les rubriques d'un côté du document
  // Deux tableaux d'un même document (actif / passif, produits / charges) : toujours le même nombre de lignes.
  // 1. Le plus long replie des lignes qui n'ont jamais eu de montant (aucun mois), en partant du bas, juste assez pour
  //    égaler l'autre — jamais plus, et jamais une ligne qui a déjà servi. Elles ne sont pas retirées : le bouton
  //    « +N » à côté de l'intitulé de leur rubrique les montre ou les replie.
  // 2. S'il manque encore des lignes d'un côté (pas assez de lignes à replier, ou rubrique dépliée), des lignes vides
  //    sont ajoutées en bas du tableau le plus court.
  // Tant que la liste des lignes déjà remplies n'est pas chargée, rien n'est replié (les lignes vides égalisent seules).
  const linesOf = (side: Side) => sectionsOf(side).flatMap((s) => sideLines(side).filter((l) => l.section === s.id));
  // Lignes d'un tableau : un intitulé par rubrique, ses lignes ; au passif, en plus, les capitaux propres (intitulé et ses lignes)
  // Capitaux propres repliés avec les autres rubriques quand les tableaux le sont (sauf si on les a ouverts)
  const capitauxFolded = !tablesOpen && !openSections.has(CAPITAUX);
  const rowCount = (side: Side) => sectionsOf(side).length + linesOf(side).length + (side === 'passif' ? (capitauxFolded ? 1 : 1 + capitalRows.length) : 0);
  const folded = new Set<string>();
  const fillers: Partial<Record<Side, number>> = {};
  for (const [a, b] of [['actif', 'passif'], ['produits', 'charges']] as [Side, Side][]) {
    const extra = rowCount(a) - rowCount(b);
    // Lignes repliées dans une rubrique fermée, pas affichées
    const hiddenCount = (side: Side) => linesOf(side).filter((l) => folded.has(l.id) && !openSections.has(l.section)).length;
    if (!tablesOpen) {
      // Tableaux repliés (à l'ouverture de la page) : chaque rubrique est repliée avec toutes ses lignes, qu'elles aient un
      // montant ou non (« Placements +4 » et son sous-total) ; des lignes vides équilibrent les deux côtés
      for (const side of [a, b]) linesOf(side).forEach((l) => folded.add(l.id));
    } else if (filled && extra !== 0) {
      const longer = extra > 0 ? a : b;
      linesOf(longer)
        .filter((l) => l.amount === 0 && !filled.has(lineKey(l.section, l.label)) && (empty || !isMissing(l)) && !isEstimated(l))
        .reverse()
        .slice(0, Math.abs(extra))
        .forEach((l) => folded.add(l.id));
    }
    // Charges plus longues que les produits : les catégories de grandes catégories entières se replient (le titre et son
    // sous-total restent), les plus fournies d'abord, sans dépasser ce qu'il faut ; si aucune combinaison ne tombe juste,
    // une grande catégorie de plus se replie et des lignes vides complètent
    const chargesExtra = rowCount('charges') - hiddenCount('charges') - (rowCount('produits') - hiddenCount('produits'));
    if (b === 'charges' && chargesExtra > 0) {
      const groups = sectionsOf('charges')
        .map((s) => ({ id: s.id, lines: linesOf('charges').filter((l) => l.section === s.id && !folded.has(l.id)) }))
        .filter((g) => g.lines.length > 0)
        .sort((x, y) => y.lines.length - x.lines.length);
      let remaining = chargesExtra;
      const fold = (g: (typeof groups)[number]) => {
        g.lines.forEach((l) => folded.add(l.id));
        remaining -= g.lines.length;
      };
      for (const g of groups) if (g.lines.length <= remaining) fold(g);
      if (remaining > 0) {
        const last = groups.filter((g) => !folded.has(g.lines[0].id)).sort((x, y) => x.lines.length - y.lines.length).find((g) => g.lines.length > remaining);
        if (last) fold(last);
      }
    }
    // Lignes affichées : sans celles repliées dans une rubrique fermée
    const shownCount = (side: Side) => rowCount(side) - hiddenCount(side);
    const gap = shownCount(a) - shownCount(b);
    fillers[gap > 0 ? b : a] = Math.abs(gap);
  }
  const toggleSection = (id: string) =>
    setOpenSections((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Dernière ligne d'un tableau (avant les lignes ajoutées) : le titre de sa dernière rubrique, si celle-ci n'a aucune ligne affichée
  const lastRowIsGroup = (side: Side) => {
    const last = sectionsOf(side).at(-1);
    if (!last) return side === 'passif' && capitauxFolded;
    const lines = linesOf(side).filter((l) => l.section === last.id);
    return lines.every((l) => folded.has(l.id)) && !openSections.has(last.id);
  };

  function renderSide(side: Side) {
    return [
      ...sectionsOf(side).map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          lines={sideLines(side).filter((l) => l.section === section.id)}
          missing={lineMissing}
          estimated={empty ? undefined : isEstimated}
          folded={folded}
          open={openSections.has(section.id)}
          onToggle={() => toggleSection(section.id)}
        />
      )),
      // Lignes ajoutées habillées comme celle juste au-dessus : un titre de rubrique si la dernière rubrique est repliée
      <LedgerFiller key="lignes-vides" count={fillers[side] ?? 0} variant={lastRowIsGroup(side) ? 'group' : 'line'} />
    ];
  }

  return (
    <div className="finance-screen min-h-dvh pb-16 transition-colors duration-700" style={{ ...toneVars, backgroundColor: FIN.mist, color: FIN.navy }}>
      {/* Pas de mois futur : les Finances retranscrivent ce qui a déjà été fait */}
      <FinanceHeader
        month={period ? monthLabel(period) : ''}
        onPrev={() => period && setChosen(shiftMonth(period, -1))}
        onNext={() => period && currentMonth && period < currentMonth && setChosen(shiftMonth(period, 1))}
        canNext={!!period && !!currentMonth && period < currentMonth}
      />

      <main className="mx-auto max-w-md px-4">
        {/* Bilan ou compte de résultat : en haut, juste sous le choix du mois */}
        {!(isNew && !blank) && (
          <div className="mt-4">
            <StatementTabs tabs={TABS} value={tab} onChange={setTab} />
            {/* Date du document affiché : le bilan est une photo à la fin du mois, le compte de résultat couvre tout le mois */}
            <p className="mt-3 text-center text-[10px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
              {!period ? ' ' : tab === 'bilan' ? `Au ${monthEndLabel(period)}` : `Du 1er au ${monthEndLabel(period)}`}
            </p>
          </div>
        )}
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

        {isNew && !blank ? (
          // Mois passé vide : on importe son relevé
          <NewMonthCard period={period} />
        ) : (
          <>
            {/* Mois en cours sans relevé : seulement le bouton d'import, la page suit sans données */}
            {blank && <ImportStatementButton period={period} />}
            {/* Virements dont on ne sait pas vers quel compte va l'argent : la réponse permet d'estimer le solde du livret */}
            {/* Rien à vérifier quand tout concorde : la vérification n'apparaît qu'en cas d'incohérence ou de question */}
            {(questions.length > 0 || flagged || mismatches.length > 0) && (
              <TransferReview
                transfers={monthTransfers}
                mismatches={mismatches}
                flagged={flagged}
                onAnswered={coverageQuery.reload}
                onDone={() => clearTransfersToVerify(period!)}
              />
            )}
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

            {/* Synthèse du mois, en haut : celle du document ouvert. Bilan : patrimoine net et épargne du mois ;
                compte de résultat : entrées, sorties et reste */}
            {/* Même place, même hauteur pour les deux (cases de hauteur fixe) : rien ne se décale en changeant d'onglet */}
            <div className="mt-6">
            {tab === 'resultat' ? (
              period ? (
                <MonthCashSummary period={period} />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {[['Entrées', 'revenus'], ['Sorties', 'dépenses'], ['Reste', 'résultat']].map(([label, note]) => (
                    <SummaryTile key={label} label={label} note={note} value="—" color={FIN.slate} />
                  ))}
                </div>
              )
            ) : (
            <>
            <div className="grid grid-cols-3 gap-2">
              <SummaryTile
                label="Patrimoine net"
                value={incomplete ? '—' : `${estimatedBilan ? '≈ ' : ''}${formatEuros(t.patrimoine)}`}
                color={incomplete || t.patrimoine >= 0 ? FIN.navy : FIN.rose}
                note={estimatedBilan ? 'ce que je possède, estimé' : 'ce que je possède'}
                // Relevés manquants : un triangle sur le coin de la case, qui affiche ou masque leurs messages
                corner={
                  !empty && missingAccounts.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowMissing((v) => !v)}
                      aria-expanded={showMissing}
                      aria-label={`${missingAccounts.length} relevé${missingAccounts.length > 1 ? 's' : ''} manquant${missingAccounts.length > 1 ? 's' : ''}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full border shadow-sm"
                      style={{ borderColor: FIN.rose, backgroundColor: showMissing ? FIN.rose : FIN.paper, color: showMissing ? FIN.paper : FIN.rose }}
                    >
                      <AlertTriangle size={15} aria-hidden />
                    </button>
                  ) : undefined
                }
              />
              {/* Bilan déséquilibré (connecteurs) : « ≈ » devant le montant et triangle d'alerte, qui montre les problèmes */}
              <SummaryTile
                label="Dette"
                value={empty ? '—' : `${unbalanced ? '≈ ' : ''}${formatEuros(Math.abs(iOwe))}`}
                color={empty ? FIN.slate : unbalanced ? FIN.rose : FIN.navy}
                note="ce que je dois"
                corner={!empty && unbalanced ? unbalancedButton : undefined}
              />
              <SummaryTile
                label="Créance"
                value={empty ? '—' : `${unbalanced ? '≈ ' : ''}${formatEuros(Math.abs(owedToMe))}`}
                color={empty ? FIN.slate : unbalanced ? FIN.rose : FIN.navy}
                note="ce qu'on me doit"
                corner={!empty && unbalanced ? unbalancedButton : undefined}
              />
            </div>
            {showUnbalanced && !empty && unbalanced && (
              <Link
                href="/banque/releves"
                className="mt-2 block rounded-sm border px-3 py-2 text-[12px]"
                style={{ borderColor: FIN.rose, backgroundColor: FIN.paper, color: FIN.rose }}
              >
                <span className="flex items-start gap-2 py-0.5 font-bold">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>Bilan déséquilibré : vérifie tes connecteurs</span>
                </span>
                {balanceProblems.map((p) => (
                  <span key={p} className="block py-0.5 pl-[22px]">
                    {p}
                  </span>
                ))}
              </Link>
            )}
            {/* Messages des relevés manquants, ouverts par le triangle : un par compte, ils mènent à l'import (même quand
                le solde d'un livret est estimé) */}
            {showMissing && !empty && missingAccounts.length > 0 && (
              <Link
                href="/banque/releves"
                className="mt-2 block rounded-sm border px-3 py-2 text-[12px]"
                style={{ borderColor: FIN.rose, backgroundColor: FIN.paper, color: FIN.rose }}
              >
                {missingAccounts.map((a) => (
                  <span key={a} className="flex items-start gap-2 py-0.5">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span>Relevé {a} manquant</span>
                  </span>
                ))}
              </Link>
            )}
            </>
            )}
            </div>

            {/* Chaque tableau sur sa page : on passe de l'une à l'autre en glissant le doigt, ou avec les points en bas de l'écran */}
            {tab === 'bilan' ? (
              <SwipePages
                key="bilan"
                color={FIN.accent}
                labels={BILAN_PAGES}
                tabs
                scriptLabels
                dots={false}
                pages={[
                  <div key="actif">
                    <Ledger open={tablesOpen} onToggle={() => setTablesOpen((o) => !o)} total={known(t.actif)} color={ON_NAVY.sage} alert={!empty && unbalanced} totalLabel="Total de l'actif">
                      {renderSide('actif')}
                    </Ledger>
                    <Explain>
                      L&apos;actif, c&apos;est tout ce que tu possèdes à la fin du mois : l&apos;argent sur tes comptes et livrets, tes placements, tes biens de valeur, et les sommes qu&apos;on te doit encore.
                    </Explain>
                  </div>,
                  <div key="passif">
                    <Ledger open={tablesOpen} onToggle={() => setTablesOpen((o) => !o)} total={known(t.patrimoine + t.dettes)} color={ON_NAVY.rose} alert={!empty && unbalanced} totalLabel="Total du passif">
                      {/* Capitaux propres : ce qui t'appartient vraiment, dont le résultat du mois */}
                      <LedgerComputed
                        title="Capitaux propres"
                        folded={!tablesOpen}
                        open={openSections.has(CAPITAUX)}
                        onToggle={() => toggleSection(CAPITAUX)}
                        rows={capitalRows}
                      />
                      {renderSide('passif')}
                    </Ledger>
                    <Explain>
                      Le passif dit d&apos;où vient ce que tu possèdes : de tes dettes (emprunts, découvert, argent que tu dois à des proches), ou de toi-même (capitaux propres). Le résultat du mois s&apos;ajoute à tes capitaux propres.
                    </Explain>
                  </div>
                ]}
              />
            ) : (
              <>
              <SwipePages
                key="resultat"
                color={FIN.accent}
                labels={RESULT_PAGES}
                tabs
                scriptLabels
                dots={false}
                pages={[
                  <div key="produits">
                    <Ledger open={tablesOpen} onToggle={() => setTablesOpen((o) => !o)} total={knownResult(t.produits)} color={ON_NAVY.sage} totalLabel="Total des produits">
                      {renderSide('produits')}
                    </Ledger>
                    <Explain>
                      Les produits, c&apos;est tout l&apos;argent qui est entré pendant le mois : salaire, primes, aides, intérêts, remboursements reçus…
                    </Explain>
                  </div>,
                  <div key="charges">
                    <Ledger open={tablesOpen} onToggle={() => setTablesOpen((o) => !o)} total={knownResult(t.charges)} color={ON_NAVY.rose} totalLabel="Total des charges">
                      {renderSide('charges')}
                    </Ledger>
                    <Explain>
                      Les charges, c&apos;est tout l&apos;argent dépensé pendant le mois : logement, courses, transport, abonnements, loisirs… Produits moins charges donne le résultat : ce que tu as épargné (ou perdu) ce mois-ci.
                    </Explain>
                  </div>
                ]}
              />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Explication en bas d'une partie du bilan ou du compte de résultat (ce qu'est l'actif, le passif...)
function Explain({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[11px] leading-relaxed" style={{ color: FIN.slate }}>
      {children}
    </p>
  );
}

// Virements entre mes comptes du mois : pour chacun, l'autre compte (celui qui reçoit l'argent, ou qui l'envoie).
// Ceux dont l'autre compte n'est pas connu sont à préciser ; après un changement dans la liste des opérations, ou quand
// les opérations estimées d'un livret ne collent plus aux virements vus, tous sont à revérifier.
function TransferReview({
  transfers,
  mismatches,
  flagged,
  onAnswered,
  onDone
}: {
  transfers: TransferCheck[];
  mismatches: TransferMismatch[];
  flagged: boolean;
  onAnswered: () => Promise<unknown>;
  onDone: () => void;
}) {
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
        {mismatches.length > 0
          ? 'Les opérations estimées d’un livret ne correspondent pas aux virements vus sur tes autres comptes :'
          : flagged
            ? 'La liste des opérations a changé ce mois-ci, et tout concorde avec les opérations estimées de tes livrets. Vérifie seulement que chaque virement ci-dessous va vers le bon compte (un virement peut très bien aller simplement du livret vers ton compte courant).'
            : 'Virements entre tes comptes : précise l’autre compte pour estimer le solde de ton livret.'}
      </p>
      {mismatches.map((m) => (
        <div key={m.account} className="mt-2 text-[11px]" style={{ color: FIN.rose }}>
          <p className="flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {m.account} : {formatEuros(m.estimated)} d&apos;opérations estimées, contre {formatEuros(m.seen)} de virements vus vers ou depuis ce
              livret sur tes autres comptes.
            </span>
          </p>
          <ul className="mt-1 list-disc pl-8" style={{ color: FIN.navy }}>
            {m.reasons.map((r) => (
              <li key={r} className="mt-0.5">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {transfers.map((q) => (
        <label key={`${q.id}|${q.target}`} className="mt-2 block">
          <span className="block">
            {new Date(q.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · {q.label}
          </span>
          <span className="flex items-center gap-2 text-[11px]" style={{ color: q.target === null ? FIN.gold : FIN.slate }}>
            {formatEuros(q.amount)} sur {q.account}, {q.amount < 0 ? 'vers' : 'depuis'}
            <select
              className="fin-select min-w-0 flex-1 py-0.5 pl-1.5 text-[12px]"
              defaultValue={q.target === null ? '' : q.target === '' ? '-' : (q.choices.find((c) => c.toLowerCase() === q.target!.toLowerCase()) ?? q.target)}
              disabled={saving === q.id}
              onChange={(e) => e.target.value !== '' && answer(q.id, e.target.value === '-' ? '' : e.target.value)}
            >
              <option value="" disabled>
                Choisir…
              </option>
              {[...q.choices, ...(q.target && !q.choices.some((c) => c.toLowerCase() === q.target!.toLowerCase()) ? [q.target] : [])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="-">Un compte non suivi ici</option>
            </select>
          </span>
        </label>
      ))}
      {transfers.length === 0 && (
        <p className="mt-2 text-[11px]" style={{ color: FIN.slate }}>
          Aucun virement entre tes comptes à vérifier ce mois-ci.
        </p>
      )}
      {transfers.every((q) => q.target !== null) && (
        <button type="button" onClick={onDone} className="mt-3 text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.accent }}>
          {flagged ? 'C’est vérifié' : 'Fermer'}
        </button>
      )}
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
