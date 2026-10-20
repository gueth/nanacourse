'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Check, ChevronDown } from 'lucide-react';
import {
  assetSplit,
  byPeriod,
  creditPayments,
  essentialCharges,
  fetchLinesRange,
  formatEuros,
  liquidAssets,
  monthKey,
  monthLabel,
  passiveIncome,
  shiftMonth,
  totals,
  type FinanceLine
} from '@/lib/finance';
import { describeDbError, fetchDebts, fetchGoals, type Debt, type Goal } from '@/lib/financePlans';
import { futureValue } from '@/lib/financeCalc';
import { notion, notionOfMonth } from '@/lib/financeGlossary';
import { Certainty, ErrorNote, FIN, FinanceHeader, FinancePage, Meter, Panel, StatementTabs } from '@/components/finance/FinanceParts';
import { SERIES_COLORS, TrendChart } from '@/components/finance/TrendChart';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());

// Période analysée : les derniers mois terminés (le mois en cours, incomplet, n'est jamais compté)
const SPANS = [
  { id: '4', label: '4 mois' },
  { id: '6', label: '6 mois' },
  { id: '12', label: '1 an' }
];

const pct = (n: number) => `${Math.round(n * 100)} %`;
const months1 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`;

type Indicator = {
  id: string;
  label: string;
  value: string;
  caption: string;
  color: string;
  what: string;
  how: string;
  target: string;
  action: string;
};

// Tuile d'indicateur : un toucher déplie l'explication, le calcul et ce que l'on peut faire
function IndicatorTile({ ind, open, onToggle }: { ind: Indicator; open: boolean; onToggle: () => void }) {
  return (
    <div className={`rounded-sm border ${open ? 'col-span-2' : ''}`} style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <button type="button" onClick={onToggle} className="w-full px-3 py-3 text-center" aria-expanded={open}>
        <p className="text-[9px] uppercase tracking-[0.22em]" style={{ color: FIN.slate }}>
          {ind.label}
        </p>
        <p className="mt-1 text-[20px] font-bold" style={{ color: ind.color }}>
          {ind.value}
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px]" style={{ color: FIN.slate }}>
          {ind.caption}
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </p>
      </button>
      {open && (
        <dl className="space-y-2 border-t px-4 pb-4 pt-3 text-[11px] leading-relaxed" style={{ borderColor: FIN.line }}>
          {[
            ['Ce que c’est', ind.what],
            ['Comment on le calcule', ind.how],
            ['Ce qu’on vise', ind.target],
            ['Ce que tu peux faire', ind.action]
          ].map(([t, d]) => (
            <div key={t}>
              <dt className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
                {t}
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// Variation d'un mois à l'autre : "+120 €" en vert ou rouge selon que c'est une bonne nouvelle
function Delta({ value, goodWhenUp = true }: { value: number; goodWhenUp?: boolean }) {
  const good = value === 0 ? null : value > 0 === goodWhenUp;
  return (
    <span className="font-bold" style={{ color: good === null ? FIN.slate : good ? FIN.sage : FIN.rose }}>
      {value > 0 ? '+' : ''}
      {formatEuros(value)}
    </span>
  );
}

export default function HealthPage() {
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [lines, setLines] = useState<FinanceLine[] | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rate, setRate] = useState(0.03);
  const [spanId, setSpanId] = useState('4');
  const span = Number(spanId);

  useEffect(() => {
    if (!currentMonth) return;
    let cancelled = false;
    (async () => {
      const [l, g, d] = await Promise.all([fetchLinesRange(shiftMonth(currentMonth, -13), currentMonth), fetchGoals(), fetchDebts()]);
      if (cancelled) return;
      const err = l.error ?? g.error ?? d.error;
      setError(err ? describeDbError(err.message) : null);
      setLines(l.lines);
      setGoals(g.goals);
      setDebts(d.debts);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMonth]);

  if (!currentMonth || lines === null) {
    return (
      <FinancePage header={<FinanceHeader subtitle="ta santé financière" />}>
        <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
          Chargement…
        </p>
      </FinancePage>
    );
  }

  // Analyse sur les derniers mois terminés (4, 6 ou 12 selon l'onglet) : le mois en cours, encore incomplet, est exclu.
  // Le bilan de référence est celui du dernier mois terminé rempli.
  const periods = byPeriod(lines.filter((l) => l.amount !== 0));
  const filled = [...periods.keys()].sort();
  const trendMonths = Array.from({ length: span }, (_, i) => shiftMonth(currentMonth, -(span - i)));
  const done = trendMonths.filter((p) => periods.has(p));
  // À défaut de mois terminé récent : le dernier mois terminé rempli, ou en dernier recours le mois en cours
  const ref = done[done.length - 1] ?? filled.filter((p) => p < currentMonth).pop() ?? (periods.has(currentMonth) ? currentMonth : undefined);

  if (!ref) {
    return (
      <FinancePage header={<FinanceHeader subtitle="ta santé financière" />}>
        <ErrorNote message={error} />
        <Panel title="Bienvenue" subtitle="Ton tableau de bord se remplira dès que tu auras saisi quelques chiffres.">
          <ol className="list-decimal space-y-2 pl-5 text-[12px] leading-relaxed">
            <li>
              Remplis ton <Link href="/banque/comptes" className="underline">bilan</Link> : ce que tu possèdes et ce que tu dois.
            </li>
            <li>
              Remplis ton <Link href="/banque/comptes" className="underline">compte de résultat</Link>, ou{' '}
              <Link href="/banque/budget" className="underline">importe un relevé bancaire</Link> pour le calculer automatiquement.
            </li>
          </ol>
        </Panel>
      </FinancePage>
    );
  }

  const L = periods.get(ref) ?? [];
  const P = periods.get(shiftMonth(ref, -1)) ?? [];
  const t = totals(L);
  const prev = totals(P);

  // Moyennes sur les mois terminés de la période (plus fiables qu'un seul mois)
  const recent = (done.length ? done : [ref]).map((p) => periods.get(p)!).filter((ls) => totals(ls).produits > 0);
  const avg = (f: (ls: FinanceLine[]) => number) => (recent.length ? recent.reduce((s, ls) => s + f(ls), 0) / recent.length : 0);
  const savings = recent.length ? avg((ls) => totals(ls).resultat) : t.resultat;
  const income = recent.length ? avg((ls) => totals(ls).produits) : t.produits;
  const essentials = avg(essentialCharges) || essentialCharges(L);
  const charges = avg((ls) => totals(ls).charges) || t.charges;
  const savingsRate = income > 0 ? savings / income : null;
  const liquid = liquidAssets(L);
  const reserve = essentials > 0 ? liquid / essentials : null;
  const passive = passiveIncome(L);
  const coverage = charges > 0 ? passive / charges : 0;
  const credit = Math.max(creditPayments(L), debts.reduce((s, d) => s + d.monthly, 0));
  const debtRatio = income > 0 ? credit / income : null;
  const fiTarget = charges * 12 * 25;
  const overdraft = L.some((l) => /d[ée]couvert/i.test(l.label) && l.amount > 0);

  const indicators: Indicator[] = [
    {
      id: 'patrimoine',
      label: 'Patrimoine net',
      value: formatEuros(t.patrimoine),
      caption: 'Ce que tu possèdes moins tes dettes',
      color: t.patrimoine >= 0 ? FIN.navy : FIN.rose,
      what: notion('patrimoine').text,
      how: `Total de l'actif (${formatEuros(t.actif)}) moins le total des dettes (${formatEuros(t.dettes)}), au bilan de ${monthLabel(ref)}.`,
      target: "Qu'il soit positif, puis qu'il progresse un peu chaque mois.",
      action: 'Mets ton bilan à jour chaque fin de mois pour suivre son évolution.'
    },
    {
      id: 'epargne',
      label: 'Épargne mensuelle',
      value: formatEuros(savings),
      caption: savingsRate !== null ? `${pct(savingsRate)} de tes revenus` : 'Ce qu’il te reste chaque mois',
      color: savings >= 0 ? FIN.sage : FIN.rose,
      what: notion('taux_epargne').text,
      how: `Revenus moins dépenses, en moyenne sur ${recent.length || 1} mois terminé${recent.length > 1 ? 's' : ''} du compte de résultat (le mois en cours n'est pas compté).`,
      target: 'Au moins 10 % de tes revenus, idéalement 20 %.',
      action: 'Repère dans ton budget une catégorie de dépenses variables à réduire, et programme un virement automatique vers ton épargne le jour de la paie.'
    },
    {
      id: 'reserve',
      label: 'Réserve de sécurité',
      value: reserve !== null ? months1(reserve) : '—',
      caption: 'De dépenses essentielles couvertes',
      color: reserve === null ? FIN.slate : reserve >= 3 ? FIN.sage : FIN.rose,
      what: notion('reserve').text,
      how: `Tes liquidités (${formatEuros(liquid)}) divisées par tes dépenses indispensables mensuelles (${formatEuros(essentials)} : logement, vie courante, transport, engagements).`,
      target: '3 à 6 mois de dépenses indispensables.',
      action:
        reserve !== null && reserve < 3
          ? `Il manque ${formatEuros(Math.max(0, essentials * 3 - liquid))} pour atteindre 3 mois. Crée un objectif « Réserve de sécurité » dans l'onglet Objectifs.`
          : "Ta réserve est en place : l'épargne supplémentaire peut servir tes autres objectifs."
    },
    {
      id: 'passifs',
      label: 'Revenus passifs',
      value: `${formatEuros(passive)}/mois`,
      caption: `${pct(coverage)} de tes dépenses`,
      color: FIN.gold,
      what: notion('revenus_passifs').text,
      how: "Lignes du compte de résultat contenant « loyer », « intérêts », « dividendes » ou « rente », dans les autres revenus.",
      target: "À long terme, qu'ils couvrent 100 % de tes dépenses : c'est l'indépendance financière.",
      action: 'Commence par sécuriser ta réserve, puis place régulièrement une partie de ton épargne selon ton horizon.'
    }
  ];
  if (debtRatio !== null && credit > 0) {
    indicators.push({
      id: 'endettement',
      label: "Taux d'endettement",
      value: pct(debtRatio),
      caption: `${formatEuros(credit)} de crédits par mois`,
      color: debtRatio <= 0.35 ? FIN.sage : FIN.rose,
      what: notion('taux_endettement').text,
      how: 'Mensualités de crédit (onglet Dettes, ou lignes « crédit » des engagements) divisées par tes revenus mensuels.',
      target: 'Rester sous 35 %.',
      action: "Consulte l'onglet Dettes pour comparer les stratégies de remboursement."
    });
  }

  // Totaux de chacun des mois terminés de la période (null : mois non rempli)
  const monthly = trendMonths.map((p) => (periods.has(p) ? totals(periods.get(p)!) : null));
  const known = monthly.map((m, i) => ({ m, p: trendMonths[i] })).filter((x): x is { m: ReturnType<typeof totals>; p: string } => x.m !== null);
  const trends: { text: string; good: boolean | null }[] = [];
  if (known.length >= 2) {
    const first = known[0];
    const last = known[known.length - 1];
    const span = `entre ${monthLabel(first.p)} et ${monthLabel(last.p)}`;
    const dp = last.m.patrimoine - first.m.patrimoine;
    if (first.m.actif + first.m.dettes > 0 && last.m.actif + last.m.dettes > 0) {
      trends.push({
        text: dp === 0 ? `Ton patrimoine net est stable ${span}.` : `Ton patrimoine net a ${dp > 0 ? 'progressé' : 'reculé'} de ${formatEuros(Math.abs(dp))} ${span}.`,
        good: dp === 0 ? null : dp > 0
      });
    }
    const avgCharges = known.slice(0, -1).reduce((s, x) => s + x.m.charges, 0) / (known.length - 1);
    const dc = last.m.charges - avgCharges;
    if (avgCharges > 0 && Math.abs(dc) >= Math.max(30, avgCharges * 0.05)) {
      trends.push({
        text: `Tes dépenses de ${monthLabel(last.p)} sont ${dc > 0 ? 'plus élevées' : 'plus basses'} de ${formatEuros(Math.abs(dc))} que ta moyenne des mois précédents.`,
        good: dc < 0
      });
    }
    const deficits = known.filter((x) => x.m.resultat < 0).length;
    trends.push(
      deficits === 0
        ? { text: `Tu as épargné chaque mois de la période.`, good: true }
        : { text: `${deficits} mois sur ${known.length} se sont terminés en déficit.`, good: false }
    );
    const saved = known.reduce((s, x) => s + x.m.resultat, 0);
    trends.push({
      text: `Sur la période, tu as ${saved >= 0 ? 'épargné' : 'perdu'} ${formatEuros(Math.abs(saved))} au total, soit ${formatEuros(Math.abs(saved) / known.length)} par mois rempli en moyenne.`,
      good: saved >= 0
    });
  }

  // Ce que ces chiffres veulent dire, en phrases simples
  const meaning: string[] = [];
  meaning.push(
    savings >= 0
      ? `Tu dépenses moins que tu ne gagnes : il te reste en moyenne ${formatEuros(savings)} par mois.`
      : `Tu dépenses plus que tu ne gagnes : il te manque en moyenne ${formatEuros(-savings)} par mois.`
  );
  if (reserve !== null)
    meaning.push(
      reserve >= 6
        ? 'Ta réserve de sécurité est confortable.'
        : reserve >= 3
          ? 'Tu as une réserve de sécurité suffisante, elle pourrait encore être renforcée.'
          : 'Ta réserve de sécurité est encore fragile : un imprévu pourrait te mettre en difficulté.'
    );
  meaning.push(
    passive > 0
      ? `Tes revenus passifs couvrent ${pct(coverage)} de tes dépenses mensuelles.`
      : "Tu n'as pas encore de revenus passifs, c'est normal au début du parcours."
  );
  if (debtRatio !== null && debtRatio > 0.35) meaning.push('Tes crédits pèsent lourd dans ton budget.');

  // Parcours vers l'autonomie : chaque étape est validée à partir des chiffres
  const placements = L.filter((l) => l.section === 'placements').reduce((s, l) => s + l.amount, 0);
  const steps = [
    {
      title: 'Comprendre ta situation',
      text: 'Connaître tes revenus, tes dépenses, tes dettes et ton patrimoine net.',
      done: t.actif > 0 && t.produits > 0,
      action: 'Remplis ton bilan et ton compte de résultat, ou importe un relevé.'
    },
    {
      title: 'Sécuriser tes finances',
      text: 'Constituer une réserve pour les imprévus et éviter les découverts coûteux.',
      done: reserve !== null && reserve >= 3 && !overdraft,
      action: overdraft ? 'Sors du découvert en priorité : c’est l’argent le plus cher.' : 'Mets de côté jusqu’à 3 mois de dépenses indispensables sur un livret.'
    },
    {
      title: "Dégager une capacité d'épargne",
      text: 'Trouver combien tu peux épargner régulièrement sans fragiliser ton quotidien.',
      done: savingsRate !== null && savingsRate >= 0.1,
      action: 'Vise 10 % de tes revenus épargnés chaque mois : regarde ton budget pour trouver où.'
    },
    {
      title: 'Faire grandir ton patrimoine',
      text: 'Définir des objectifs, comprendre les placements et investir selon ton horizon et ton niveau de risque.',
      done: placements > 0 && goals.length > 0,
      action: 'Fixe-toi un objectif chiffré dans l’onglet Objectifs, et renseigne-toi sur les placements adaptés à ton horizon.'
    },
    {
      title: "Atteindre ton objectif d'indépendance",
      text: 'Avoir un patrimoine dont les revenus couvrent tes dépenses.',
      done: coverage >= 1,
      action: `Repère indicatif (règle des 4 %) : un patrimoine placé d'environ ${formatEuros(fiTarget)}.`
    }
  ];
  const currentStep = steps.findIndex((s) => !s.done);

  // Bilan du mois, comparé au mois précédent
  const hasPrev = P.length > 0;
  const goalMonthly = goals.reduce((s, g) => s + g.monthly, 0);
  const notionMonth = notionOfMonth(ref);
  const split = assetSplit(L);
  const splitTotal = split.reduce((s, a) => s + a.amount, 0);
  const SPLIT_COLORS = [FIN.slate, FIN.gold, FIN.sage, FIN.rose];

  return (
    <FinancePage header={<FinanceHeader subtitle="ta santé financière" />}>
      <ErrorNote message={error} />

      <div className="mt-5">
        <StatementTabs tabs={SPANS} value={spanId} onChange={setSpanId} />
      </div>

      <p className="mt-3 text-center text-[10px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
        {done.length > 0
          ? `Moyenne des ${done.length} dernier${done.length > 1 ? 's' : ''} mois terminé${done.length > 1 ? 's' : ''} · bilan de ${monthLabel(ref)}`
          : `D'après ${monthLabel(ref)}`}
        <br />
        touche un chiffre pour l&apos;explication
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {indicators.map((ind) => (
          <IndicatorTile key={ind.id} ind={ind} open={open === ind.id} onToggle={() => setOpen(open === ind.id ? null : ind.id)} />
        ))}
      </div>

      <Panel title="Tendances" subtitle={`Les ${span} derniers mois terminés, de ${monthLabel(trendMonths[0])} à ${monthLabel(trendMonths[span - 1])}. Touche un mois pour voir ses chiffres.`}>
        {trends.length > 0 && (
          <ul className="mb-3 space-y-1.5 text-[12px] leading-relaxed">
            {trends.map((m) => (
              <li key={m.text} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45" style={{ backgroundColor: m.good === null ? FIN.slate : m.good ? FIN.sage : FIN.rose }} />
                {m.text}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
          Revenus et dépenses
        </p>
        <TrendChart
          months={trendMonths}
          kind="bar"
          format={(n) => formatEuros(Math.round(n))}
          series={[
            { name: 'Revenus', color: SERIES_COLORS[0], values: monthly.map((m) => m?.produits ?? null) },
            { name: 'Dépenses', color: SERIES_COLORS[1], values: monthly.map((m) => m?.charges ?? null) }
          ]}
        />
        <p className="mt-4 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
          Taux d&apos;épargne
        </p>
        <TrendChart
          months={trendMonths}
          kind="bar"
          format={(n) => `${Math.round(n)} %`}
          reference={{ value: 10, label: 'repère 10 %' }}
          series={[{ name: "Taux d'épargne", color: SERIES_COLORS[0], values: monthly.map((m) => (m && m.produits > 0 ? (m.resultat / m.produits) * 100 : null)) }]}
        />
        <p className="mt-4 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
          Patrimoine net
        </p>
        <TrendChart
          months={trendMonths}
          kind="line"
          format={(n) => formatEuros(Math.round(n))}
          series={[{ name: 'Patrimoine net', color: SERIES_COLORS[0], values: monthly.map((m) => (m && m.actif + m.dettes > 0 ? m.patrimoine : null)) }]}
        />
        {done.length < span && (
          <p className="mt-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            {span - done.length} mois de la période ne {span - done.length > 1 ? 'sont' : 'est'} pas rempli{span - done.length > 1 ? 's' : ''} : remplis
            leur bilan et leur compte de résultat (ou importe tes relevés) pour une tendance complète.
          </p>
        )}
      </Panel>

      <Panel title="Ce que ça veut dire">
        <ul className="space-y-1.5 text-[12px] leading-relaxed">
          {meaning.map((m) => (
            <li key={m} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45" style={{ backgroundColor: FIN.gold }} />
              {m}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Ton parcours" subtitle="Cinq étapes vers l'autonomie financière, validées à partir de tes chiffres.">
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const isCurrent = i === currentStep;
            return (
              <li key={s.title} className="flex gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold"
                  style={
                    s.done
                      ? { backgroundColor: FIN.sage, borderColor: FIN.sage, color: FIN.paper }
                      : isCurrent
                        ? { borderColor: FIN.gold, color: FIN.gold }
                        : { borderColor: FIN.line, color: FIN.slate }
                  }
                >
                  {s.done ? <Check size={13} /> : i + 1}
                </span>
                <div className={s.done || isCurrent ? '' : 'opacity-60'}>
                  <p className="text-[12px] font-bold">{s.title}</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: FIN.slate }}>
                    {s.text}
                  </p>
                  {isCurrent && (
                    <p className="mt-1 text-[11px] leading-relaxed" style={{ color: FIN.gold }}>
                      → {s.action}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {currentStep === 4 && (
          <div className="mt-3">
            <Meter value={coverage} color={FIN.gold} />
            <p className="mt-1 text-[10px]" style={{ color: FIN.slate }}>
              Revenus passifs : {pct(coverage)} de tes dépenses
            </p>
          </div>
        )}
      </Panel>

      <Panel title={`Bilan de ${monthLabel(ref)}`} subtitle="Ce qui s'est passé, et ce que tu peux faire ensuite.">
        {hasPrev ? (
          <ul className="space-y-1.5 text-[12px] leading-relaxed">
            <li>
              Revenus : <Delta value={t.produits - prev.produits} /> par rapport au mois précédent.
            </li>
            <li>
              Dépenses : <Delta value={t.charges - prev.charges} goodWhenUp={false} />.
            </li>
            <li>
              Patrimoine net : <Delta value={t.patrimoine - prev.patrimoine} />.
            </li>
            {goalMonthly > 0 && (
              <li>
                Épargne du mois : {formatEuros(t.resultat)} pour un objectif de {formatEuros(goalMonthly)} —{' '}
                {t.resultat >= goalMonthly ? (
                  <span style={{ color: FIN.sage }}>objectif atteint.</span>
                ) : (
                  <span style={{ color: FIN.rose }}>il manque {formatEuros(goalMonthly - t.resultat)}.</span>
                )}
              </li>
            )}
          </ul>
        ) : (
          <p className="text-[12px] leading-relaxed">
            Revenus {formatEuros(t.produits)}, dépenses {formatEuros(t.charges)}, épargne {formatEuros(t.resultat)}. Remplis le mois
            suivant pour voir l&apos;évolution.
          </p>
        )}
        <div className="mt-3 rounded-sm px-3 py-2 text-[11px] leading-relaxed" style={{ backgroundColor: FIN.mist }}>
          <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
            Action prioritaire
          </p>
          {currentStep >= 0 ? steps[currentStep].action : 'Continue sur ta lancée : toutes les étapes sont validées.'}
        </div>
        <div className="mt-2 rounded-sm px-3 py-2 text-[11px] leading-relaxed" style={{ backgroundColor: FIN.mist }}>
          <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
            Une notion à apprendre · {notionMonth.term}
          </p>
          {notionMonth.text}
        </div>
      </Panel>

      {split.length > 0 && (
        <Panel title="Ton patrimoine" subtitle="Répartition de ce que tu possèdes, et projection indicative.">
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {split.map((s, i) => (
              <div key={s.id} style={{ width: `${(s.amount / splitTotal) * 100}%`, backgroundColor: SPLIT_COLORS[i % 4] }} />
            ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
            {split.map((s, i) => (
              <li key={s.id} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SPLIT_COLORS[i % 4] }} />
                {s.title} · {pct(s.amount / splitTotal)}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
              Si tu épargnes {formatEuros(Math.max(0, savings))}/mois <Certainty estimate />
            </p>
          </div>
          <div className="mt-2 flex gap-1">
            {[0, 0.02, 0.04].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                className="flex-1 rounded-full border py-1 text-[10px]"
                style={rate === r ? { backgroundColor: FIN.slate, color: FIN.paper, borderColor: FIN.slate } : { borderColor: FIN.line, color: FIN.slate }}
              >
                {r === 0 ? 'Sans placement' : `${r * 100} %/an`}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {[5, 10, 20].map((y) => (
              <div key={y} className="rounded-sm py-2" style={{ backgroundColor: FIN.mist }}>
                <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  {y} ans
                </p>
                <p className="text-[13px] font-bold">{formatEuros(Math.round(futureValue(liquid + placements, Math.max(0, savings), rate, y * 12) + t.patrimoine - liquid - placements))}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            Hypothèses : épargne constante, rendement fixe appliqué à tes liquidités et placements (biens et dettes inchangés), sans inflation ni impôts. Les placements réels varient d&apos;une année à
            l&apos;autre : ce n&apos;est pas une prévision.
          </p>
        </Panel>
      )}
    </FinancePage>
  );
}
