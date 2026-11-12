'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Sommaire } from '@/components/gazette/Sommaire';
import { TrendChart } from '@/components/finance/TrendChart';
import { Bow, Flourish, LaceEdge, LaceFrame, MIST, NAVY, PAPER, Rosette } from '@/components/gazette/Lace';
import { byPeriod, formatEuros, monthIndicators, monthKey, monthLabel, monthEndLabel, shiftMonth, totals } from '@/lib/finance';
import { useCategories, useCategoryLimits, useCoverage, useFinanceLines, useMonthBudgets } from '@/lib/financeQueries';
import { orThrow, useCached } from '@/lib/cache';
import { budgetLinesOf } from '@/lib/selfDebt';
import { fetchTransactions, monthOf, summarize, type Transaction } from '@/lib/transactions';
import { knownLines } from '@/lib/coverage';
import { SAVINGS_TARGET } from '@/lib/health';
import { savingsTargetPct, useHealthSettings } from '@/lib/healthSettings';
import { useParcours } from '@/lib/parcours';
import { unlockCreditsAudio } from '@/lib/creditsAudio';
import { formatIssue, gazetteIssue } from '@/lib/gazette';

// Accueil : la gazette du jour, en bleu nuit sur papier blanc, ornée de dentelle. À la une le bilan et le compte
// de résultat du dernier mois rempli, puis les graphiques de santé financière, la prédiction des dépenses à venir
// (rythme actuel face aux budgets) et le parcours vers l'autonomie.
// On passe d'une partie à l'autre (accueil, journal, finances, courses, paramètres) par le menu du bas (components/TabBar).

const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };
const blackletter = { fontFamily: 'var(--font-blackletter), serif' };
const script = { fontFamily: 'var(--font-script), cursive' };

// Bleu des barres « Revenus », plus clair que le bleu nuit des « Dépenses » : les deux séries se distinguent à la clarté
const LIGHT_BLUE = '#7f9bc4';

// Date et mois du jour, lus dans le navigateur uniquement (le serveur peut être dans un autre fuseau horaire)
const noSubscribe = () => () => {};
const readToday = () => new Date().toDateString();
const readIssue = () => gazetteIssue(new Date());

// Filets de l'en-tête étirés d'un bord à l'autre de l'écran, hors de la colonne centrale de la page
const FULL_WIDTH = 'relative left-1/2 w-screen -translate-x-1/2';

// Petits titres en capitales espacées, sous un filet (comme « DAVID THACKRAY ____ » dans un journal)
function Byline({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[9px] uppercase tracking-[0.25em]">
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1" style={{ backgroundColor: NAVY }} />
    </p>
  );
}

// Bandeau de rubrique : étiquette pleine bleu nuit, en capitales blanches (comme « TOP STORIES »)
function Ribbon({ children, href, onClick }: { children: React.ReactNode; href?: string; onClick?: () => void }) {
  const content = (
    <span className="flex items-center justify-between px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ backgroundColor: NAVY, color: PAPER, ...serif }}>
      {children}
      {(href || onClick) && <span className="text-[9px] font-normal tracking-[0.15em] opacity-80">lire →</span>}
    </span>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="mt-7 block w-full text-left">
        {content}
      </button>
    );
  }
  return href ? (
    <Link href={href} className="mt-7 block">
      {content}
    </Link>
  ) : (
    <div className="mt-7">{content}</div>
  );
}

// Ligne de chiffres avec points de conduite : « Actif ........ 12 340 € »
function LeaderRow({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <p className={`flex items-baseline gap-1 text-[12px] ${strong ? 'font-bold' : ''}`}>
      <span className="shrink-0">{label}</span>
      <span className="min-w-[8px] flex-1 -translate-y-[3px] border-b border-dotted" style={{ borderColor: NAVY }} />
      <span className="shrink-0 tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </p>
  );
}

// Illustration d'article, comme dans un journal : elle occupe un peu plus de la moitié de la colonne,
// d'un côté, et le texte coule à côté puis en dessous ; légende en italique sous un filet
function Figure({ side, caption, children }: { side: 'left' | 'right'; caption: string; children: React.ReactNode }) {
  return (
    <figure className={`mb-2 w-[56%] ${side === 'right' ? 'float-right ml-3' : 'float-left mr-3'}`}>
      <div className="rounded-sm px-1.5 pb-1.5 pt-2" style={{ backgroundColor: MIST }}>
        {children}
      </div>
      <figcaption className="mt-1 border-t pt-0.5 text-[10px] italic leading-snug" style={{ borderColor: NAVY }}>
        {caption}
      </figcaption>
    </figure>
  );
}

// Pendant le chargement : « Impression » et trois points qui font la vague
function Printing() {
  return (
    <div className="flex items-end justify-center gap-1.5 py-6" role="status" aria-label="Impression en cours">
      <span className="text-[18px] italic leading-none" style={serif}>
        Impression
      </span>
      <span className="flex gap-1 pb-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: NAVY, animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
    </div>
  );
}

// EN-TÊTE DU JOURNAL : numéro et date, titre en lettres gothiques, nœud, filets et devise
function Masthead({ today }: { today: Date | null }) {
  // Numéro de l'édition : 001 le premier jour, puis un de plus chaque jour à 8 h (lib/gazette.ts)
  const issue = useSyncExternalStore(noSubscribe, readIssue, () => null);
  // Date abrégée, sans les points d'abréviation : « mar 12 Oct 2027 »
  const short = (options: Intl.DateTimeFormatOptions) => today?.toLocaleDateString('fr-FR', options).replace('.', '') ?? '';
  const month = short({ month: 'short' });
  const date = today ? `${short({ weekday: 'short' })} ${today.getDate()} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${today.getFullYear()}` : '';

  return (
    <header className="relative pt-3 text-center">
      {/* Ligne du haut : numéro, date, et le « Sommaire » (menu) à droite (le retour se fait par le menu du bas) */}
      <div className="grid h-[22px] grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] uppercase tracking-[0.18em]">
        <p className="flex items-center gap-2 text-left">
          <span>
            N° <span className="italic" style={serif}>{issue ? formatIssue(issue) : '—'}</span>
          </span>
        </p>
        <p className="normal-case">{date}</p>
        <div className="text-right">
          {/* MENU : feuille de sommaire qui se déplie sous la barre de séparation */}
          <Sommaire
            top={47}
            entries={[{ label: 'Crédits', href: '/credits', page: 2, onClick: () => unlockCreditsAudio() }]}
          />
        </div>
      </div>
      {/* Barre de séparation entre la ligne du numéro, de la date et du menu, et le titre du journal */}
      <div className={`mt-3 border-t ${FULL_WIDTH}`} style={{ borderColor: NAVY }} />

      <div className="mt-2 flex justify-center">
        <Bow width={40} />
      </div>
      <h1 className="-mt-1 text-[58px] leading-none" style={blackletter}>
        La Gazette
      </h1>
      <p className="-mt-2 text-[30px] leading-none" style={script}>
        de nana
      </p>

      {/* Double filet et devise, comme sous le titre d'un quotidien */}
      <div className={`mt-3 border-t-[3px] border-double ${FULL_WIDTH}`} style={{ borderColor: NAVY }} />
      <p className="py-1 text-[9px] uppercase tracking-[0.22em]" style={serif}>
        L&apos;édition du jour · finances · épargne · dépenses
      </p>
      <div className={`border-t ${FULL_WIDTH}`} style={{ borderColor: NAVY }} />
    </header>
  );
}

// À LA UNE : bilan et compte de résultat du dernier mois rempli, avec la tendance des derniers mois
function FinanceNews({ currentMonth }: { currentMonth: string }) {
  const { data: rawLines } = useFinanceLines(currentMonth, 13);
  const coverage = useCoverage().data;
  // Repère d'épargne : le seuil du bleu (« Santé »), réglable dans Paramètres > Finances
  const settingsRules = useHealthSettings().data?.rules;
  const targetPct = settingsRules ? savingsTargetPct(settingsRules) : SAVINGS_TARGET * 100;
  const target = targetPct / 100;

  const news = useMemo(() => {
    if (!rawLines) return null;
    // Mêmes règles que le Bilan (lib/coverage) : les soldes des relevés manquants sont écartés, et un mois dont le bilan
    // ou le résultat n'est pas connu n'est pas compté dans les chiffres qui en dépendent
    const { lines, unknownBilan, unknownResult, estimatedBilan } = knownLines(rawLines, coverage);
    const periods = byPeriod(lines.filter((l) => l.amount !== 0));
    const filled = [...periods.keys()].sort();
    // Mois de référence : le dernier mois terminé rempli dont le résultat est connu, ou à défaut le mois en cours
    const ref =
      filled.filter((p) => p < currentMonth && !unknownResult.has(p)).pop() ??
      (periods.has(currentMonth) && !unknownResult.has(currentMonth) ? currentMonth : null);
    // Six derniers mois terminés, pour les graphiques : résultat et bilan, chacun seulement s'il est connu
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth, -(6 - i)));
    const resultMonthly = months.map((m) => (periods.has(m) && !unknownResult.has(m) ? totals(periods.get(m)!) : null));
    const bilanMonthly = months.map((m) => (periods.has(m) && !unknownBilan.has(m) ? totals(periods.get(m)!) : null));

    // Chiffres des articles de la rubrique Santé : moyennes des mois remplis, meilleur et pire mois,
    // et évolution du patrimoine entre le premier et le dernier bilan connu de la période
    const withIncome = months.map((month, i) => ({ month, t: resultMonthly[i] })).filter((m) => m.t && m.t.produits > 0) as { month: string; t: ReturnType<typeof totals> }[];
    const byResult = [...withIncome].sort((a, b) => b.t.resultat - a.t.resultat);
    const withWealth = months.map((month, i) => ({ month, t: bilanMonthly[i] })).filter((m) => m.t && m.t.actif + m.t.dettes > 0) as { month: string; t: ReturnType<typeof totals> }[];
    const first = withWealth[0];
    const last = withWealth[withWealth.length - 1];
    const health = {
      filled: withIncome.length,
      avgIncome: withIncome.reduce((s, m) => s + m.t.produits, 0) / (withIncome.length || 1),
      avgSpent: withIncome.reduce((s, m) => s + m.t.charges, 0) / (withIncome.length || 1),
      best: byResult.length > 1 ? { month: byResult[0].month, resultat: byResult[0].t.resultat } : null,
      worst: byResult.length > 1 ? { month: byResult[byResult.length - 1].month, resultat: byResult[byResult.length - 1].t.resultat } : null,
      wealth: withWealth.length > 1 ? { fromMonth: first.month, from: first.t.patrimoine, toMonth: last.month, to: last.t.patrimoine } : null,
      // Taux d'épargne moyen, et nombre de mois où le repère d'épargne (seuil du bleu, Paramètres > Finances) est atteint
      avgRate: withIncome.length ? withIncome.reduce((s, m) => s + m.t.resultat / m.t.produits, 0) / withIncome.length : null,
      aboveTarget: withIncome.filter((m) => m.t.resultat / m.t.produits >= target).length
    };
    // Chiffres clés du dernier mois terminé (le mois en cours n'a pas encore son relevé) : patrimoine et réserve
    // seulement si son bilan est connu, épargne seulement si son résultat l'est
    const lastDone = filled.filter((p) => p < currentMonth).pop() ?? null;
    const indicators = lastDone ? monthIndicators(lines, lastDone) : null;
    const keyFigures =
      lastDone && indicators
        ? {
            month: lastDone,
            ...indicators,
            patrimoine: unknownBilan.has(lastDone) ? null : indicators.patrimoine,
            reserve: unknownBilan.has(lastDone) ? null : indicators.reserve,
            savings: unknownResult.has(lastDone) ? null : indicators.savings,
            savingsRate: unknownResult.has(lastDone) ? null : indicators.savingsRate,
            // Solde d’un livret estimé (son relevé arrive plus tard) : le patrimoine l’est aussi
            estimated: estimatedBilan.has(lastDone)
          }
        : null;
    const bilanKnown = !!ref && !unknownBilan.has(ref);
    const estimated = !!ref && estimatedBilan.has(ref);
    return { ref, t: ref ? totals(periods.get(ref)!) : null, bilanKnown, estimated, months, resultMonthly, bilanMonthly, health, keyFigures };
  }, [rawLines, coverage, currentMonth, target]);

  if (!news) return <Printing />;

  const { ref, t, bilanKnown, estimated, months, resultMonthly, bilanMonthly, health, keyFigures } = news;
  if (!ref || !t) {
    return (
      <article className="mt-5 text-center">
        <h2 className="text-[26px] font-bold leading-tight" style={serif}>
          Ta première édition t&apos;attend
        </h2>
        <p className="mx-auto mt-2 max-w-[280px] text-[12px] italic leading-relaxed" style={serif}>
          Remplis ton bilan et ton compte de résultat, ou importe un relevé : la une s&apos;écrira toute seule.
        </p>
        <Link href="/banque/comptes" className="mt-4 inline-block rounded-full border px-5 py-1.5 text-[10px] uppercase tracking-[0.25em]" style={{ borderColor: NAVY }}>
          Ouvrir le bilan
        </Link>
      </article>
    );
  }

  const saved = t.resultat >= 0;
  const rate = t.tauxEpargne !== null ? Math.round(t.tauxEpargne * 100) : null;
  const month = monthLabel(ref);

  return (
    <>
      {/* GROS TITRE, chapeau en italique et signature */}
      <article className="mt-5">
        <h2 className="text-[30px] font-bold leading-[1.05] tracking-tight" style={serif}>
          {saved ? `${formatEuros(t.resultat)} mis de côté en ${month}` : `Un mois de ${month} dans le rouge`}
        </h2>
        <div className="mt-2 border-t-2 pt-2" style={{ borderColor: NAVY }}>
          <p className="text-[13px] italic leading-snug" style={serif}>
            {saved
              ? bilanKnown
                ? `Ton patrimoine net s’établit à ${formatEuros(t.patrimoine)}${rate !== null ? `, avec ${rate} % de tes revenus épargnés` : ''}.`
                : `${rate !== null ? `${rate} % de tes revenus épargnés` : 'Un mois d’épargne'} ; le patrimoine attend un relevé manquant.`
              : `Les dépenses ont dépassé les revenus de ${formatEuros(-t.resultat)}${bilanKnown ? ` ; ton patrimoine net s’établit à ${formatEuros(t.patrimoine)}` : ''}.`}
          </p>
        </div>
        <div className="mt-3">
          <Byline>Rubrique comptable</Byline>
        </div>

        {/* Texte en deux colonnes séparées par un filet, avec lettrine */}
        <div className="mt-3 columns-2 gap-4 text-[12px] leading-relaxed" style={{ columnRule: `1px solid ${NAVY}`, ...serif }}>
          <p className="text-justify">
            <span className="float-left mr-1 mt-1 text-[40px] leading-[0.75]" style={blackletter}>
              E
            </span>
            n {month}, tes revenus ont atteint <b>{formatEuros(t.produits)}</b> pour <b>{formatEuros(t.charges)}</b> de dépenses.
            {saved ? ' Le mois se termine sur un excédent, ' : ' Le mois se termine sur un déficit, '}
            reporté à ton bilan arrêté au {monthEndLabel(ref)}.
          </p>
          <p className="mt-2 break-inside-avoid">
            {bilanKnown ? (
              <>
                Ce que tu possèdes vaut <b>{formatEuros(t.actif)}</b>, pour <b>{formatEuros(t.dettes)}</b> de dettes.{' '}
              </>
            ) : (
              <>Il manque un relevé de compte pour arrêter le bilan de ce mois. </>
            )}
            <Link href="/banque/comptes" className="italic underline underline-offset-2">
              Suite en page Bilan.
            </Link>
          </p>
        </div>
      </article>

      {/* BILAN ET COMPTE DE RÉSULTAT, dans un encart de dentelle */}
      <LaceFrame className="mt-5">
        <div className="flex items-center gap-3">
          {/* Médaillon festonné : part des revenus épargnée (ou part de déficit), en plus petit si le nombre est long */}
          <Rosette size={70}>
            <span className="text-[7px] uppercase tracking-[0.15em]">{saved ? 'épargne' : 'déficit'}</span>
            <span className={`mt-0.5 font-bold ${rate !== null && String(Math.abs(rate)).length > 2 ? 'text-[13px]' : 'text-[18px]'}`}>
              {rate !== null ? `${Math.abs(rate)} %` : '—'}
            </span>
          </Rosette>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-[0.25em]">Les comptes de</p>
            <p className="text-[24px] leading-none first-letter:uppercase" style={script}>
              {month}
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <p className="mb-1 text-center text-[10px] font-bold uppercase tracking-[0.2em]" style={serif}>
              Bilan
            </p>
            <LeaderRow label="Actif" value={bilanKnown ? formatEuros(t.actif) : '—'} />
            <LeaderRow label="Dettes" value={bilanKnown ? formatEuros(t.dettes) : '—'} />
            <LeaderRow label={estimated ? 'Net (estimé)' : 'Net'} value={bilanKnown ? formatEuros(t.patrimoine) : '—'} strong />
          </div>
          <div className="border-l pl-4" style={{ borderColor: NAVY }}>
            <p className="mb-1 text-center text-[10px] font-bold uppercase tracking-[0.2em]" style={serif}>
              Résultat
            </p>
            <LeaderRow label="Revenus" value={formatEuros(t.produits)} />
            <LeaderRow label="Dépenses" value={formatEuros(t.charges)} />
            <LeaderRow label={saved ? 'Épargne' : 'Déficit'} value={formatEuros(t.resultat)} strong />
          </div>
        </div>
      </LaceFrame>

      {/* CHIFFRES CLÉS du dernier mois terminé : patrimoine, réserve, épargne et dividendes */}
      {keyFigures && (
        <section className="mt-5">
          <p className="text-center text-[9px] uppercase tracking-[0.3em]">Les chiffres clés de</p>
          <p className="text-center text-[22px] leading-none first-letter:uppercase" style={script}>
            {monthLabel(keyFigures.month)}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2" style={serif}>
            {[
              {
                label: 'Patrimoine net',
                value: keyFigures.patrimoine !== null ? formatEuros(keyFigures.patrimoine) : '—',
                note:
                  keyFigures.patrimoine === null
                    ? 'relevé manquant'
                    : keyFigures.estimated
                      ? 'estimé, relevé de livret manquant'
                      : `au ${monthEndLabel(keyFigures.month)}`
              },
              {
                label: 'Réserve de sécurité',
                value: keyFigures.reserve !== null ? `${keyFigures.reserve.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois` : '—',
                note: 'de dépenses (médiane 6 mois)'
              },
              {
                label: "Taux d'épargne",
                value: keyFigures.savingsRate !== null ? `${Math.round(keyFigures.savingsRate * 100)} %` : '—',
                note: keyFigures.savings !== null ? `${formatEuros(keyFigures.savings)} sur le mois` : 'relevé manquant'
              },
              { label: 'Dividendes', value: formatEuros(keyFigures.dividends), note: 'et intérêts perçus' }
            ].map((c) => (
              <div key={c.label} className="border px-2 py-2 text-center" style={{ borderColor: NAVY }}>
                <p className="text-[8px] uppercase tracking-[0.2em]">{c.label}</p>
                <p className="mt-0.5 text-[18px] font-bold leading-tight">{c.value}</p>
                <p className="text-[9px] italic opacity-80">{c.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SANTÉ FINANCIÈRE : trois graphiques sur les six derniers mois terminés */}
      {/* Comme dans un journal, chaque graphique occupe une partie de la colonne et l'article coule à côté :
          tantôt à droite, tantôt à gauche */}
      <Ribbon>Santé financière</Ribbon>
      <div className="mt-3 flow-root text-[12px] leading-relaxed hyphens-auto">
        <Figure side="right" caption="Revenus et dépenses des six derniers mois.">
          <TrendChart
            months={months}
            kind="bar"
            width={200}
            height={150}
            format={(n) => formatEuros(Math.round(n))}
            series={[
              { name: 'Revenus', color: LIGHT_BLUE, values: resultMonthly.map((m) => m?.produits ?? null) },
              { name: 'Dépenses', color: NAVY, values: resultMonthly.map((m) => m?.charges ?? null) }
            ]}
          />
        </Figure>
        <p className="text-justify">
          <span className="float-left mr-1 mt-1 text-[40px] leading-[0.75]" style={blackletter}>
            {health.filled > 0 ? 'S' : 'P'}
          </span>
          {health.filled > 0 ? (
            <>
              ur {health.filled > 1 ? `les ${health.filled} derniers mois remplis` : 'le dernier mois rempli'}, tes revenus s&apos;élèvent en moyenne à{' '}
              <b>{formatEuros(health.avgIncome)}</b> par mois, pour <b>{formatEuros(health.avgSpent)}</b> de dépenses.
              {health.best && (
                <>
                  {' '}
                  Ton meilleur mois est <span className="italic">{monthLabel(health.best.month)}</span>, avec {formatEuros(health.best.resultat)}{' '}
                  {health.best.resultat >= 0 ? 'mis de côté' : 'de déficit'}.
                </>
              )}
              {health.worst && health.worst.month !== health.best?.month && (
                <>
                  {' '}
                  Le plus serré : <span className="italic">{monthLabel(health.worst.month)}</span> ({formatEuros(health.worst.resultat)}).
                </>
              )}
            </>
          ) : (
            <>as encore assez de mois remplis pour tracer une tendance : complète ton bilan et ton compte de résultat.</>
          )}
        </p>
      </div>

      <div className="mt-4 flow-root text-[12px] leading-relaxed hyphens-auto">
        <Figure side="left" caption="Ton patrimoine net, fin de mois après fin de mois.">
          <TrendChart
            months={months}
            kind="line"
            width={200}
            height={150}
            format={(n) => formatEuros(Math.round(n))}
            series={[{ name: 'Patrimoine net', color: NAVY, values: bilanMonthly.map((m) => (m && m.actif + m.dettes > 0 ? m.patrimoine : null)) }]}
          />
        </Figure>
        <p className="text-justify">
          {health.wealth ? (
            <>
              Ton patrimoine net est passé de <b>{formatEuros(health.wealth.from)}</b> en <span className="italic">{monthLabel(health.wealth.fromMonth)}</span> à{' '}
              <b>{formatEuros(health.wealth.to)}</b> en <span className="italic">{monthLabel(health.wealth.toMonth)}</span>, soit{' '}
              <b>
                {health.wealth.to - health.wealth.from >= 0 ? '+' : ''}
                {formatEuros(health.wealth.to - health.wealth.from)}
              </b>
              .
            </>
          ) : (
            <>Ton patrimoine net s&apos;affichera ici mois après mois, dès que deux bilans seront remplis.</>
          )}{' '}
          Il évolue avec ton épargne, tes emprunts et tes remboursements de dettes.
        </p>
      </div>

      <div className="mt-4 flow-root text-[12px] leading-relaxed hyphens-auto">
        <Figure side="right" caption="Part des revenus mise de côté, mois après mois.">
          <TrendChart
            months={months}
            kind="bar"
            width={200}
            height={150}
            format={(n) => `${Math.round(n)} %`}
            reference={{ value: targetPct, label: `repère ${targetPct} %` }}
            series={[{ name: "Taux d'épargne", color: NAVY, values: resultMonthly.map((m) => (m && m.produits > 0 ? (m.resultat / m.produits) * 100 : null)) }]}
          />
        </Figure>
        <p className="text-justify">
          {health.avgRate !== null ? (
            <>
              Tu mets de côté en moyenne <b>{Math.round(health.avgRate * 100)} %</b> de tes revenus.{' '}
              {health.aboveTarget === health.filled
                ? `Le repère des ${targetPct} % d'épargne est atteint chaque mois : belle régularité.`
                : `Le repère des ${targetPct} % est atteint ${health.aboveTarget} mois sur ${health.filled}.`}
            </>
          ) : (
            <>Ton taux d&apos;épargne s&apos;affichera ici dès qu&apos;un mois de revenus sera rempli.</>
          )}
        </p>
      </div>

      {/* PRÉDICTION ET ESTIMATION : les dépenses à venir au rythme actuel, face à celles voulues par les budgets */}
      <Forecast currentMonth={currentMonth} />

      {/* PARCOURS vers l'autonomie financière, validé à partir des chiffres */}
      <Parcours currentMonth={currentMonth} />
    </>
  );
}

// Nombre de mois prévus (le mois en cours compris) et de mois terminés qui donnent le rythme actuel
const FORECAST_MONTHS = 6;
const PACE_MONTHS = 3;

// PRÉDICTION ET ESTIMATION : sur les postes qui ont un budget (grandes catégories et catégories limitées, Finances > Budget),
// le total des dépenses à venir si le comportement des derniers mois relevés continue, face au total voulu par les limites.
// Le mois en cours ajoute à ce qui est déjà relevé ce qu'il reste à dépenser au même rythme.
// Les dépenses annuelles sont laissées de côté : payées une fois par an, elles fausseraient le rythme.
function Forecast({ currentMonth }: { currentMonth: string }) {
  const categoriesReady = useCategories().data;
  const budgets = useCategoryLimits().data;
  const monthBudgets = useMonthBudgets().data;
  const operations = useCached(`journal:operations-prevision:${currentMonth}`, async () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const lastDay = String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const { transactions, error } = await fetchTransactions(`${shiftMonth(currentMonth, -PACE_MONTHS)}-01`, `${currentMonth}-${lastDay}`);
    return orThrow(transactions, error);
  }).data;

  const forecast = useMemo(() => {
    if (!categoriesReady || !budgets || !monthBudgets || !operations) return null;
    const byMonth = new Map<string, Transaction[]>();
    for (const t of operations) byMonth.set(monthOf(t.date), [...(byMonth.get(monthOf(t.date)) ?? []), t]);
    // Postes budgétés avec leurs limites d'aujourd'hui ; ce que chacun a coûté un mois donné
    const linesIn = (month: string) => budgetLinesOf(currentMonth, summarize(byMonth.get(month) ?? []).byCategory, budgets, monthBudgets);
    const lines = linesIn(currentMonth);
    const allowed = lines.reduce((s, l) => s + l.limit, 0);
    if (!lines.length) return { lines: [], allowed: 0, pace: null };

    // Rythme actuel : moyenne des mois terminés qui ont un relevé
    const past = Array.from({ length: PACE_MONTHS }, (_, i) => shiftMonth(currentMonth, -(i + 1))).filter((m) => byMonth.get(m)?.length);
    const pastLines = past.map(linesIn);
    const avgOf = (target: string) => pastLines.reduce((s, ls) => s + (ls.find((l) => l.target === target)?.spent ?? 0), 0) / (past.length || 1);

    // Mois en cours : déjà relevé jusqu'à la dernière opération, puis le reste du mois au même rythme
    const currentTx = byMonth.get(currentMonth) ?? [];
    const soFar = lines.reduce((s, l) => s + l.spent, 0);
    const [y, m] = currentMonth.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const lastDay = currentTx.reduce((d, t) => Math.max(d, Number(t.date.slice(8, 10))), 0);
    const elapsed = lastDay / days;
    if (!past.length && !currentTx.length) return { lines, allowed, pace: null };

    const pace = past.length ? lines.reduce((s, l) => s + avgOf(l.target), 0) : soFar / elapsed;
    const thisMonth = currentTx.length ? soFar + pace * (1 - elapsed) : pace;
    const months = Array.from({ length: FORECAST_MONTHS }, (_, i) => shiftMonth(currentMonth, i));
    const projected = months.map((_, i) => thisMonth + pace * i);
    const wanted = months.map((_, i) => allowed * (i + 1));
    const rows = lines
      .map((l) => ({ label: l.label, limit: l.limit, monthly: past.length ? avgOf(l.target) : l.spent / elapsed }))
      .sort((a, b) => b.monthly - b.limit - (a.monthly - a.limit));
    return { lines, allowed, pace, past: past.length, soFar, hasCurrent: currentTx.length > 0, thisMonth, months, projected, wanted, rows };
  }, [categoriesReady, budgets, monthBudgets, operations, currentMonth]);

  if (!forecast) return null;
  const { allowed, pace } = forecast;

  return (
    <>
      <Ribbon>Prédiction et estimation</Ribbon>
      {!forecast.lines.length || pace === null ? (
        <p className="mt-3 text-[12px] italic leading-relaxed" style={serif}>
          {!forecast.lines.length ? (
            <>
              Fixe des limites à tes grandes catégories pour que la gazette compare tes dépenses à venir à celles que tu veux.{' '}
              <Link href="/banque/budget" className="underline underline-offset-2">
                Ouvrir le budget.
              </Link>
            </>
          ) : (
            <>Importe un relevé de compte : l&apos;estimation de tes dépenses à venir s&apos;écrira à partir de ton rythme.</>
          )}
        </p>
      ) : (
        (() => {
          const { months, projected, wanted, rows, past, hasCurrent, soFar, thisMonth } = forecast as Required<typeof forecast>;
          const last = months.length - 1;
          const gap = projected[last] - wanted[last];
          const top = Math.max(1, ...rows.map((r) => Math.max(r.monthly, r.limit)));
          const drifting = rows.filter((r) => r.monthly - r.limit >= 1);
          return (
            <>
              <div className="mt-3 flow-root text-[12px] leading-relaxed hyphens-auto">
                <Figure side="left" caption={`Dépenses cumulées d'ici ${monthLabel(months[last])}.`}>
                  <TrendChart
                    months={months}
                    kind="line"
                    width={200}
                    height={150}
                    format={(n) => formatEuros(Math.round(n))}
                    series={[
                      { name: 'Ton rythme', color: NAVY, values: projected },
                      { name: 'Tes budgets', color: LIGHT_BLUE, values: wanted }
                    ]}
                  />
                </Figure>
                <p className="text-justify">
                  <span className="float-left mr-1 mt-1 text-[40px] leading-[0.75]" style={blackletter}>
                    {past ? 'A' : 'D'}
                  </span>
                  {past ? (
                    <>
                      u rythme {past > 1 ? `des ${past} derniers mois relevés` : 'du dernier mois relevé'}, tes postes budgétés te coûtent environ{' '}
                      <b>{formatEuros(Math.round(pace))}</b> par mois, pour <b>{formatEuros(Math.round(allowed))}</b> prévus par tes budgets.
                    </>
                  ) : (
                    <>
                      &apos;après ce mois-ci, tes postes budgétés te coûteraient environ <b>{formatEuros(Math.round(pace))}</b> par mois, pour{' '}
                      <b>{formatEuros(Math.round(allowed))}</b> prévus par tes budgets.
                    </>
                  )}{' '}
                  D&apos;ici fin <span className="italic">{monthLabel(months[last])}</span>, cela ferait <b>{formatEuros(Math.round(projected[last]))}</b> dépensés contre{' '}
                  <b>{formatEuros(Math.round(wanted[last]))}</b> voulus :{' '}
                  {Math.abs(gap) < 1 ? (
                    <>pile dans tes budgets.</>
                  ) : (
                    <>
                      <b>{formatEuros(Math.round(Math.abs(gap)))}</b> {gap > 0 ? 'de plus que prévu' : 'de moins que prévu, à mettre de côté'}.
                    </>
                  )}
                  {hasCurrent && (
                    <>
                      {' '}
                      Pour <span className="italic">{monthLabel(months[0])}</span>, {formatEuros(Math.round(soFar))} sont déjà relevés : la fin du mois est estimée à{' '}
                      <b>{formatEuros(Math.round(thisMonth))}</b>.
                    </>
                  )}
                </p>
              </div>

              {/* Un mois type au rythme actuel, poste par poste : la barre pleine est l'estimation, le trait la limite */}
              <figure className="mt-4">
                <ul className="space-y-2 rounded-sm px-2.5 py-2.5" style={{ backgroundColor: MIST }}>
                  {rows.map((r) => {
                    const over = r.monthly - r.limit;
                    return (
                      <li key={r.label}>
                        <p className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="truncate">{r.label}</span>
                          <span className="shrink-0 tabular-nums">
                            <b>{formatEuros(Math.round(r.monthly))}</b> / {formatEuros(Math.round(r.limit))}
                          </span>
                        </p>
                        <div className="relative mt-0.5 h-2.5">
                          <div className="absolute inset-y-0 left-0 rounded-r-sm" style={{ width: `${(r.monthly / top) * 100}%`, backgroundColor: over >= 1 ? NAVY : LIGHT_BLUE }} />
                          <div className="absolute -inset-y-0.5 w-0.5" style={{ left: `calc(${(r.limit / top) * 100}% - 1px)`, backgroundColor: NAVY }} aria-hidden />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <figcaption className="mt-1 border-t pt-0.5 text-[10px] italic leading-snug" style={{ borderColor: NAVY }}>
                  Un mois à ton rythme actuel, poste par poste : la barre est l&apos;estimation, le trait la limite (en bleu nuit, les postes qui la dépassent).
                </figcaption>
              </figure>
              <p className="mt-2 text-[12px] leading-relaxed" style={serif}>
                {drifting.length ? (
                  <>
                    À surveiller :{' '}
                    {drifting.slice(0, 3).map((r, i) => (
                      <span key={r.label}>
                        {i > 0 && (i === Math.min(drifting.length, 3) - 1 ? ' et ' : ', ')}
                        <span className="italic">{r.label}</span> (+{formatEuros(Math.round(r.monthly - r.limit))} par mois)
                      </span>
                    ))}
                    .
                  </>
                ) : (
                  <>Chaque poste tient dans sa limite à ce rythme : continue comme ça.</>
                )}
              </p>
            </>
          );
        })()
      )}
    </>
  );
}

// TON PARCOURS : six étapes vers l'autonomie financière, l'étape en cours mise en avant avec son action
function Parcours({ currentMonth }: { currentMonth: string }) {
  const parcours = useParcours(currentMonth, 6);
  if (!parcours) return null;
  const { steps, validated, currentStep, coverage } = parcours;
  return (
    <>
      <Ribbon>Ton parcours</Ribbon>
      <p className="mt-2 text-[12px] italic leading-snug" style={serif}>
        Six étapes vers l&apos;autonomie financière, validées à partir de tes chiffres.
      </p>
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => {
          const isCurrent = i === currentStep;
          const ok = validated[i];
          // Objectif atteint, mais une étape précédente n'est pas encore validée
          const waiting = s.done && !ok;
          return (
            <li key={s.title} className="flex gap-3">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold"
                style={ok ? { backgroundColor: NAVY, borderColor: NAVY, color: PAPER } : { borderColor: NAVY, opacity: isCurrent ? 1 : 0.5 }}
              >
                {ok ? <Check size={13} /> : i + 1}
              </span>
              <div className={ok || isCurrent ? '' : 'opacity-60'}>
                <p className="text-[13px] font-bold">{s.title}</p>
                <p className="text-[11px] leading-relaxed">{s.text}</p>
                {isCurrent && <p className="mt-1 border-l-2 pl-2 text-[11px] italic leading-relaxed" style={{ borderColor: NAVY }}>→ {s.action}</p>}
                {waiting && <p className="mt-1 text-[10px] italic leading-relaxed opacity-80">Déjà atteint : validé dès que l&apos;étape {currentStep + 1} le sera.</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {currentStep === steps.length - 1 && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full border" style={{ borderColor: NAVY }}>
            <div className="h-full" style={{ width: `${Math.min(100, coverage * 100)}%`, backgroundColor: NAVY }} />
          </div>
          <p className="mt-1 text-[10px] italic">Revenus passifs : {Math.round(coverage * 100)} % de tes dépenses</p>
        </div>
      )}
    </>
  );
}

export default function Accueil() {
  const todayKey = useSyncExternalStore(noSubscribe, readToday, () => null);
  const today = useMemo(() => (todayKey ? new Date(todayKey) : null), [todayKey]);
  const currentMonth = today ? monthKey(today) : null;
  const router = useRouter();
  // Anciens liens vers le ticket (/accueil#ticket) : les courses ont maintenant leur propre page
  useEffect(() => {
    if (window.location.hash === '#ticket') router.replace('/course');
  }, [router]);

  const footer = (
    <div className="mt-8">
      <Flourish width={160} />
      <p className="mt-2 text-center text-[22px]" style={script}>
        à demain !
      </p>
      {/* Tout en bas : les crédits (le toucher déverrouille le son, la musique de la page démarre toute seule) */}
      <p className="mt-6 text-center">
        <Link href="/credits" onClick={() => unlockCreditsAudio()} className="inline-block px-3 py-2 text-[11px] uppercase tracking-[0.22em] underline underline-offset-4">
          Crédits
        </Link>
      </p>
    </div>
  );

  return (
    <>
      {/* Toute la gazette en caractères à empattements, chiffres alignés (sans chiffres elzéviriens) */}
      <div
        className="gazette overflow-x-clip pb-4 [font-variant-numeric:lining-nums_tabular-nums]"
        style={{ backgroundColor: PAPER, color: NAVY, ...serif }}
      >
        <LaceEdge />
        <div className="mx-auto max-w-[430px] px-4">
          <Masthead today={today} />

          {/* À LA UNE : les comptes du mois, puis la santé financière */}
          {currentMonth ? <FinanceNews currentMonth={currentMonth} /> : <Printing />}

          {footer}
        </div>
      </div>
      <div style={{ backgroundColor: PAPER }}>
        <LaceEdge flip />
      </div>
    </>
  );
}
