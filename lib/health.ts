'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { byPeriod, liquidAssets, monthKey, passiveIncome, shiftMonth, totals, type FinanceLine } from '@/lib/finance';
import { useFinanceLines } from '@/lib/financeQueries';

// Santé financière : l'état (hémorragie, maladie, fatigue, santé, olympique), la teinte qu'il donne à la partie
// Finances, et la prévision d'une hémorragie (période sans revenu d'activité).

export type HealthState = 'hemorragie' | 'maladie' | 'fatigue' | 'sante' | 'olympique';

// Inflation annuelle retenue pour l'état « Fatigue » (épargne qui ne suit pas la hausse des prix)
export const INFLATION = 0.02;

// Teinte de chaque état : "dark" pour l'en-tête et les accents, "pale" pour le fond des pages Finances
export const HEALTH_TONES: Record<HealthState, { dark: string; pale: string }> = {
  hemorragie: { dark: '#9b2f37', pale: '#f4e3e4' },
  // Orange et jaune adoucis (terre cuite et miel), plus reposants pour l'œil
  maladie: { dark: '#c07a52', pale: '#f8eee6' },
  fatigue: { dark: '#a99047', pale: '#f7f2e2' },
  sante: { dark: '#3d5a80', pale: '#e6edf5' },
  olympique: { dark: '#3d6b4c', pale: '#e2ede5' }
};

// --- Dates d'arrêt et de reprise des revenus d'activité, saisies par l'utilisateur ---
// Gardées sur l'appareil (stockage du navigateur) : fin de contrat prévue, et reprise prévue si on la connaît.

export type HemorrhagePlan = { start: string | null; resume: string | null }; // dates AAAA-MM-JJ
const PLAN_KEY = 'nanacourses.hemorragie';
const EMPTY_PLAN: HemorrhagePlan = { start: null, resume: null };
const planListeners = new Set<() => void>();
let planCache: { raw: string | null; plan: HemorrhagePlan } | null = null;

function readPlan(): HemorrhagePlan {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PLAN_KEY);
  } catch {
    return EMPTY_PLAN;
  }
  // Même texte enregistré : même objet, pour que React ne redessine pas inutilement
  if (planCache && planCache.raw === raw) return planCache.plan;
  let plan = EMPTY_PLAN;
  try {
    plan = raw ? { ...EMPTY_PLAN, ...JSON.parse(raw) } : EMPTY_PLAN;
  } catch {
    plan = EMPTY_PLAN;
  }
  planCache = { raw, plan };
  return plan;
}

export function saveHemorrhagePlan(plan: HemorrhagePlan) {
  try {
    if (plan.start || plan.resume) window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    else window.localStorage.removeItem(PLAN_KEY);
  } catch {
    // stockage indisponible (navigation privée...) : la prévision reste automatique
  }
  planListeners.forEach((l) => l());
}

export function useHemorrhagePlan() {
  return useSyncExternalStore(
    (onChange) => {
      planListeners.add(onChange);
      return () => planListeners.delete(onChange);
    },
    readPlan,
    () => EMPTY_PLAN
  );
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00`);

// Hémorragie déclarée en cours : la date d'arrêt est passée, et la reprise n'est pas encore arrivée
export function plannedHemorrhageNow(plan: HemorrhagePlan, now = new Date()) {
  return !!plan.start && toDate(plan.start) <= now && (!plan.resume || toDate(plan.resume) > now);
}

// --- État de santé ---

const workIncomeOf = (ls: FinanceLine[]) => ls.filter((l) => l.section === 'revenus').reduce((s, l) => s + l.amount, 0);

// État de santé sur une période : le mois en cours ("now") ou les "span" derniers mois terminés.
// Du plus grave au meilleur :
//  - hémorragie : plus aucun revenu d'activité (ou arrêt déclaré par l'utilisateur) ;
//  - maladie : on travaille, mais on dépense plus qu'on ne gagne (ou on est à découvert) ;
//  - olympique : budget tenu, et on investit (rubrique Placements du bilan) ;
//  - fatigue : budget tenu sans investir, mais le patrimoine progresse moins vite que l'inflation ;
//  - santé : budget tenu, et le patrimoine progresse au moins au rythme de l'inflation.
// null : pas encore assez de chiffres.
export function assessHealth(lines: FinanceLine[], currentMonth: string, span: number | 'now', plan: HemorrhagePlan = EMPTY_PLAN) {
  const periods = byPeriod(lines.filter((l) => l.amount !== 0));
  // Mois analysables : ceux qui ont des revenus ou des dépenses au compte de résultat (un mois qui n'a que des soldes
  // reportés, faute de relevé importé, n'en fait pas partie : il serait sinon jugé « sans revenu »)
  const hasResult = (p: string) => {
    const tt = totals(periods.get(p) ?? []);
    return tt.produits + tt.charges > 0;
  };
  const filled = [...periods.keys()].filter(hasResult).sort();
  const isNow = span === 'now';
  const trendMonths = isNow ? [currentMonth] : Array.from({ length: span }, (_, i) => shiftMonth(currentMonth, -(span - i)));
  const done = trendMonths.filter((p) => periods.has(p) && hasResult(p));
  const ref = done[done.length - 1] ?? filled.filter((p) => p <= currentMonth).pop();
  if (!ref) return null;

  const L = periods.get(ref) ?? [];
  const t = totals(L);
  const recent = (done.length ? done : [ref]).map((p) => periods.get(p)!).filter((ls) => totals(ls).produits > 0);
  const savings = recent.length ? recent.reduce((s, ls) => s + totals(ls).resultat, 0) / recent.length : t.resultat;
  const overdraft = L.some((l) => /d[ée]couvert/i.test(l.label) && l.amount > 0);
  const periodLines = (done.length ? done : [ref]).map((p) => periods.get(p) ?? []);
  const workIncome = periodLines.reduce((s, ls) => s + workIncomeOf(ls), 0) / (periodLines.length || 1);
  const investing = L.some((l) => l.section === 'placements' && l.amount > 0);
  // Progression du patrimoine sur la période, comparée à celle qu'aurait demandé l'inflation
  const startLines = periods.get(shiftMonth(done.length ? done[0] : ref, -1));
  const months = isNow ? 1 : Math.max(1, done.length);
  const wealthStart = startLines ? totals(startLines).patrimoine : null;
  const inflationNeed = wealthStart !== null ? (Math.max(0, wealthStart) * INFLATION * months) / 12 : 0;
  const wealthGrowth = wealthStart !== null ? t.patrimoine - wealthStart : null;
  const declared = plannedHemorrhageNow(plan);

  const state: HealthState =
    declared || workIncome <= 0
      ? 'hemorragie'
      : savings < 0 || overdraft
        ? 'maladie'
        : investing
          ? 'olympique'
          : wealthGrowth !== null && wealthGrowth < inflationNeed
            ? 'fatigue'
            : 'sante';
  const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const reason = {
    hemorragie: declared
      ? `Tu as indiqué que tes revenus d'activité se sont arrêtés le ${toDate(plan.start!).toLocaleDateString('fr-FR')}.`
      : "Aucun salaire ni revenu d'activité n'apparaît dans ton compte de résultat sur cette période.",
    maladie: overdraft ? 'Une ligne de découvert est inscrite à ton bilan.' : `Tu dépenses en moyenne ${euros(-savings)} de plus que tu ne gagnes chaque mois.`,
    olympique: `Tu épargnes ${euros(savings)} par mois en moyenne, et une partie de ton argent est placée.`,
    fatigue: `Ton patrimoine a progressé de ${euros(wealthGrowth ?? 0)}, moins que les ${euros(inflationNeed)} qu'il aurait fallu pour suivre l'inflation : place une partie de ton épargne.`,
    sante:
      wealthGrowth !== null ? `Ton patrimoine a progressé de ${euros(wealthGrowth)}, au moins autant que l'inflation.` : `Tu épargnes ${euros(savings)} par mois en moyenne.`
  }[state];
  return { state, reason };
}

// Mois affiché par la page Finances ouverte (Bilan, Budget : flèches du mois) ; null = le mois en cours
let viewedMonth: string | null = null;
const viewedListeners = new Set<() => void>();
function setViewedMonth(month: string | null) {
  if (viewedMonth === month) return;
  viewedMonth = month;
  viewedListeners.forEach((l) => l());
}

// À appeler par une page qui navigue de mois en mois : la teinte suit le mois qu'elle affiche
export function useViewedMonth(month: string | null) {
  useEffect(() => {
    setViewedMonth(month);
    return () => setViewedMonth(null);
  }, [month]);
}

// Teinte de la partie Finances : celle de l'état de santé du mois sur lequel on est (le mois affiché par la page,
// sinon le mois en cours), bleu « santé » tant qu'il n'est pas connu. Les données viennent de la mémoire partagée.
const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
export function useFinanceTone() {
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const viewed = useSyncExternalStore(
    (onChange) => {
      viewedListeners.add(onChange);
      return () => viewedListeners.delete(onChange);
    },
    () => viewedMonth,
    () => null
  );
  const month = viewed ?? currentMonth;
  const lines = useFinanceLines(currentMonth, 13).data;
  const plan = useHemorrhagePlan();
  return useMemo(() => {
    const health = month && lines ? assessHealth(lines, month, 'now', plan) : null;
    return { state: health?.state ?? null, ...HEALTH_TONES[health?.state ?? 'sante'] };
  }, [month, lines, plan]);
}

// --- Prévision d'une hémorragie ---

export type HemorrhageForecast = {
  source: 'saisie' | 'releves' | 'aucune';
  start: Date | null; // début (prévu ou constaté) de la période sans revenu d'activité
  resume: Date | null; // reprise prévue (saisie)
  runOut: Date | null; // date à laquelle les liquidités seraient épuisées, sans revenu d'activité
  runwayMonths: number | null; // nombre de mois que tiennent les liquidités (null : indéfiniment)
  burn: number; // ce qui sort chaque mois sans revenu d'activité (dépenses moins revenus passifs)
  liquid: number;
  shortfall: number; // ce qui manquerait pour tenir jusqu'à la reprise (0 si on tient)
  drop: number | null; // baisse récente des revenus d'activité (0,4 = -40 %), si elle est forte
};

const addMonths = (d: Date, months: number) => {
  const whole = Math.floor(months);
  const r = new Date(d.getFullYear(), d.getMonth() + whole, d.getDate());
  r.setDate(r.getDate() + Math.round((months - whole) * 30));
  return r;
};

// À partir des dates saisies si elles existent, sinon des relevés : début de l'hémorragie (arrêt des revenus
// d'activité constaté), et jusqu'à quand les liquidités tiendraient au rythme des dépenses des 6 derniers mois
export function forecastHemorrhage(lines: FinanceLine[], currentMonth: string, plan: HemorrhagePlan, now = new Date()): HemorrhageForecast {
  const periods = byPeriod(lines.filter((l) => l.amount !== 0));
  const lastSix = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth, -(6 - i))).filter((p) => periods.has(p));
  const avg = (f: (ls: FinanceLine[]) => number) => (lastSix.length ? lastSix.reduce((s, p) => s + f(periods.get(p)!), 0) / lastSix.length : 0);
  const spent = avg((ls) => totals(ls).charges);
  const passive = avg(passiveIncome);
  const burn = Math.max(0, spent - passive);
  const lastFilled = [...periods.keys()].filter((p) => p <= currentMonth).sort().pop();
  const liquid = lastFilled ? liquidAssets(periods.get(lastFilled)!) : 0;
  const runwayMonths = burn > 0 ? Math.max(0, liquid / burn) : null;

  // Revenus d'activité des mois remplis récents : arrêt constaté, ou forte baisse
  const work = lastSix.map((p) => ({ p, w: workIncomeOf(periods.get(p)!) }));
  const lastPaid = [...work].reverse().find((m) => m.w > 0);
  const stoppedFrom = lastPaid ? work.find((m) => m.p > lastPaid.p && m.w <= 0)?.p : undefined;
  const last = work[work.length - 1];
  const before = work.slice(0, -1).filter((m) => m.w > 0);
  const avgBefore = before.length ? before.reduce((s, m) => s + m.w, 0) / before.length : 0;
  const drop = last && last.w > 0 && avgBefore > 0 && last.w < avgBefore * 0.6 ? 1 - last.w / avgBefore : null;

  let source: HemorrhageForecast['source'] = 'aucune';
  let start: Date | null = null;
  if (plan.start) {
    source = 'saisie';
    start = toDate(plan.start);
  } else if (stoppedFrom) {
    source = 'releves';
    const [y, m] = stoppedFrom.split('-').map(Number);
    start = new Date(y, m - 1, 1);
  }
  const resume = plan.resume ? toDate(plan.resume) : null;
  // L'argent commence à fondre au début de l'hémorragie (ou dès aujourd'hui si elle a déjà commencé)
  const from = start && start > now ? start : now;
  const runOut = start && runwayMonths !== null ? addMonths(from, runwayMonths) : null;
  const monthsToResume = resume ? Math.max(0, (resume.getTime() - from.getTime()) / (30.44 * 86_400_000)) : null;
  const shortfall = monthsToResume !== null ? Math.max(0, monthsToResume * burn - liquid) : 0;
  return { source, start, resume, runOut, runwayMonths, burn, liquid, shortfall, drop };
}
