'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Sommaire } from '@/components/gazette/Sommaire';
import { DEFIS } from '@/components/DefiCards';
import { DefiCoupons } from '@/components/gazette/DefiCoupons';
import { MessagesButton } from '@/components/MessagesButton';
import { openTicket, ReceiptPrinter } from '@/components/gazette/ReceiptPrinter';
import { TrendChart } from '@/components/finance/TrendChart';
import { Bow, Flourish, LaceEdge, LaceFrame, MIST, NAVY, PAPER, Rosette } from '@/components/gazette/Lace';
import { GroceryAd } from '@/components/gazette/GroceryAd';
import { byPeriod, formatEuros, monthKey, monthLabel, monthEndLabel, shiftMonth, totals } from '@/lib/finance';
import { useFinanceLines } from '@/lib/financeQueries';
import { formatIssue, gazetteIssue } from '@/lib/gazette';

// Accueil : la gazette du jour, en bleu nuit sur papier blanc, ornée de dentelle.
// À la une le bilan et le compte de résultat du dernier mois rempli, puis les graphiques de santé financière,
// une réclame d'épicerie avec le budget courses, dont le bouton imprime la liste de courses active (ticket de caisse),
// et les défis en brèves.

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
function Masthead({ today, onCourse }: { today: Date | null; onCourse: () => void }) {
  // Numéro de l'édition : 001 le premier jour, puis un de plus chaque jour à 8 h (lib/gazette.ts)
  const issue = useSyncExternalStore(noSubscribe, readIssue, () => null);
  // Date abrégée, sans les points d'abréviation : « mar 12 Oct 2027 »
  const short = (options: Intl.DateTimeFormatOptions) => today?.toLocaleDateString('fr-FR', options).replace('.', '') ?? '';
  const month = short({ month: 'short' });
  const date = today ? `${short({ weekday: 'short' })} ${today.getDate()} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${today.getFullYear()}` : '';

  return (
    <header className="relative pt-3 text-center">
      {/* Ligne du haut : numéro, date, et le « Sommaire » (menu) à droite */}
      <div className="grid h-[22px] grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] uppercase tracking-[0.18em]">
        <p className="text-left">
          N° <span className="italic" style={serif}>{issue ? formatIssue(issue) : '—'}</span>
        </p>
        <p className="normal-case">{date}</p>
        <div className="text-right">
          {/* MENU : feuille de sommaire qui se déplie sous la barre de séparation */}
          <Sommaire
            top={47}
            entries={[
              { label: 'Finances', href: '/banque', page: 2 },
              {
                label: 'Courses',
                href: '/accueil#ticket',
                page: 3,
                onClick: (e) => {
                  e.preventDefault();
                  onCourse();
                }
              },
              { label: 'Profil', href: '/profile', page: 4 },
              { label: 'Paramètres', href: '/settings?tab=lists', page: 5 }
            ]}
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
        L&apos;édition du jour · finances · courses · défis
      </p>
      <div className={`border-t ${FULL_WIDTH}`} style={{ borderColor: NAVY }} />
    </header>
  );
}

// À LA UNE : bilan et compte de résultat du dernier mois rempli, avec la tendance des derniers mois
function FinanceNews({ currentMonth }: { currentMonth: string }) {
  const { data: lines } = useFinanceLines(currentMonth, 13);

  const news = useMemo(() => {
    if (!lines) return null;
    const periods = byPeriod(lines.filter((l) => l.amount !== 0));
    const filled = [...periods.keys()].sort();
    // Mois de référence : le dernier mois terminé rempli, ou à défaut le mois en cours
    const ref = filled.filter((p) => p < currentMonth).pop() ?? (periods.has(currentMonth) ? currentMonth : null);
    // Six derniers mois terminés, pour les graphiques
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth, -(6 - i)));
    const monthly = months.map((m) => (periods.has(m) ? totals(periods.get(m)!) : null));

    // Chiffres des articles de la rubrique Santé : moyennes des mois remplis, meilleur et pire mois,
    // et évolution du patrimoine entre le premier et le dernier bilan de la période
    const withIncome = months.map((month, i) => ({ month, t: monthly[i] })).filter((m) => m.t && m.t.produits > 0) as { month: string; t: ReturnType<typeof totals> }[];
    const byResult = [...withIncome].sort((a, b) => b.t.resultat - a.t.resultat);
    const withWealth = months.map((month, i) => ({ month, t: monthly[i] })).filter((m) => m.t && m.t.actif + m.t.dettes > 0) as { month: string; t: ReturnType<typeof totals> }[];
    const first = withWealth[0];
    const last = withWealth[withWealth.length - 1];
    const health = {
      filled: withIncome.length,
      avgIncome: withIncome.reduce((s, m) => s + m.t.produits, 0) / (withIncome.length || 1),
      avgSpent: withIncome.reduce((s, m) => s + m.t.charges, 0) / (withIncome.length || 1),
      best: byResult.length > 1 ? { month: byResult[0].month, resultat: byResult[0].t.resultat } : null,
      worst: byResult.length > 1 ? { month: byResult[byResult.length - 1].month, resultat: byResult[byResult.length - 1].t.resultat } : null,
      wealth: withWealth.length > 1 ? { fromMonth: first.month, from: first.t.patrimoine, toMonth: last.month, to: last.t.patrimoine } : null
    };
    return { ref, t: ref ? totals(periods.get(ref)!) : null, months, monthly, health };
  }, [lines, currentMonth]);

  if (!news) return <Printing />;

  const { ref, t, months, monthly, health } = news;
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
              ? `Ton patrimoine net s’établit à ${formatEuros(t.patrimoine)}${rate !== null ? `, avec ${rate} % de tes revenus épargnés` : ''}.`
              : `Les dépenses ont dépassé les revenus de ${formatEuros(-t.resultat)} ; ton patrimoine net s’établit à ${formatEuros(t.patrimoine)}.`}
          </p>
        </div>
        <div className="mt-3">
          <Byline>Par nana · rubrique finances</Byline>
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
            Ce que tu possèdes vaut <b>{formatEuros(t.actif)}</b>, pour <b>{formatEuros(t.dettes)}</b> de dettes.{' '}
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
            <LeaderRow label="Actif" value={formatEuros(t.actif)} />
            <LeaderRow label="Dettes" value={formatEuros(t.dettes)} />
            <LeaderRow label="Net" value={formatEuros(t.patrimoine)} strong />
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

      {/* SANTÉ FINANCIÈRE : les graphiques de la page Santé, sur les six derniers mois terminés */}
      {/* Comme dans un journal, chaque graphique occupe une partie de la colonne et l'article coule à côté :
          le premier à droite, le second à gauche */}
      <Ribbon href="/banque">Santé financière</Ribbon>
      <div className="mt-3 flow-root text-[12px] leading-relaxed hyphens-auto">
        <Figure side="right" caption="Revenus et dépenses des six derniers mois.">
          <TrendChart
            months={months}
            kind="bar"
            width={200}
            height={150}
            format={(n) => formatEuros(Math.round(n))}
            series={[
              { name: 'Revenus', color: LIGHT_BLUE, values: monthly.map((m) => m?.produits ?? null) },
              { name: 'Dépenses', color: NAVY, values: monthly.map((m) => m?.charges ?? null) }
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
            series={[{ name: 'Patrimoine net', color: NAVY, values: monthly.map((m) => (m && m.actif + m.dettes > 0 ? m.patrimoine : null)) }]}
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
          Il évolue avec ton épargne, tes remboursements de dettes et la valeur de tes placements.{' '}
          <Link href="/banque" className="italic underline underline-offset-2">
            Tout le détail en page Santé.
          </Link>
        </p>
      </div>
    </>
  );
}

export default function Accueil() {
  const todayKey = useSyncExternalStore(noSubscribe, readToday, () => null);
  const today = useMemo(() => (todayKey ? new Date(todayKey) : null), [todayKey]);
  const currentMonth = today ? monthKey(today) : null;
  // Les boutons Courses impriment la liste de courses active (ticket de caisse, sous la réclame)
  const openCourse = openTicket;


  return (
    <>
      {/* Toute la gazette en caractères à empattements, chiffres alignés (sans chiffres elzéviriens) */}
      <div className="gazette overflow-x-clip pb-4 [font-variant-numeric:lining-nums_tabular-nums]" style={{ backgroundColor: PAPER, color: NAVY, ...serif }}>
        <LaceEdge />
        <div className="mx-auto max-w-[430px] px-4">
          <Masthead today={today} onCourse={openCourse} />

          {/* À LA UNE : les comptes du mois, puis la santé financière */}
          {currentMonth ? <FinanceNews currentMonth={currentMonth} /> : <Printing />}

          {/* COURSES : bandeau de rubrique, puis réclame d'épicerie d'antan ; tous deux impriment le ticket de la liste active */}
          <Ribbon onClick={openCourse}>Courses</Ribbon>
          <GroceryAd onOpen={openCourse} />
          {/* TICKET DE CAISSE : la liste de courses active, imprimée ici à la demande */}
          <ReceiptPrinter />

          {/* BRÈVES : les défis du jour */}
          <Ribbon>Les brèves · défis</Ribbon>
          <DefiCoupons defis={DEFIS} />

          {/* PIED DE PAGE */}
          <div className="mt-8">
            <Flourish width={160} />
            <p className="mt-2 text-center text-[22px]" style={script}>
              à demain !
            </p>
          </div>
        </div>
      </div>
      <div style={{ backgroundColor: PAPER }}>
        <LaceEdge flip />
      </div>

      {/* LETTRE FIXÉE EN BAS À DROITE : messagerie de nana */}
      <MessagesButton />
    </>
  );
}
