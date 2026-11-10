'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { byPeriod, monthKey, shiftMonth, totals, type FinanceLine } from '@/lib/finance';
import { useCoverage, useFinanceLines } from '@/lib/financeQueries';
import { knownLines } from '@/lib/coverage';

// Santé financière : l'état (hémorragie, maladie, fatigue, santé, olympique) et la teinte qu'il donne à la partie Finances.

export type HealthState = 'hemorragie' | 'maladie' | 'fatigue' | 'sante' | 'olympique';

// Inflation annuelle retenue pour l'état « Fatigue » (épargne qui ne suit pas la hausse des prix)
export const INFLATION = 0.02;

// Teinte de chaque état : "dark" pour l'en-tête et les accents, "pale" pour le fond des pages Finances
export const HEALTH_TONES: Record<HealthState, { dark: string; pale: string }> = {
  hemorragie: { dark: '#aa333c', pale: '#f4e3e4' },
  // Orange et jaune adoucis (terre cuite et miel), plus reposants pour l'œil.
  // Toutes les teintes "dark" ont la même luminosité : aucune ne paraît plus foncée que les autres, et le texte clair
  // de l'en-tête reste lisible partout (contraste d'environ 5,8 pour 1)
  maladie: { dark: '#875131', pale: '#f8eee6' },
  fatigue: { dark: '#6d5d2e', pale: '#f7f2e2' },
  sante: { dark: '#416089', pale: '#e6edf5' },
  // Vert vif (#0ed145) assombri pour l'en-tête et les accents, fond du même vert éclairci
  olympique: { dark: '#096d2d', pale: '#d4f0dc' }
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
//  - olympique : budget tenu, et on épargne au moins 20 % de ses revenus (la part « Épargne » de la répartition 40/40/20) ;
//  - fatigue : budget tenu, mais le patrimoine progresse moins vite que l'inflation ;
//  - santé : budget tenu, et le patrimoine progresse au moins au rythme de l'inflation.
// null : pas encore assez de chiffres.
// "unknown" : mois dont le bilan ou le compte de résultat n'est pas connu faute de relevé (lib/coverage) ; ils sont
// laissés de côté, comme sur le Bilan et l'accueil.
export const SAVINGS_TARGET = 0.2;
const NOTHING_UNKNOWN = { bilan: new Set<string>(), result: new Set<string>() };
export function assessHealth(
  lines: FinanceLine[],
  currentMonth: string,
  span: number | 'now',
  plan: HemorrhagePlan = EMPTY_PLAN,
  unknown: { bilan: Set<string>; result: Set<string> } = NOTHING_UNKNOWN
) {
  const periods = byPeriod(lines.filter((l) => l.amount !== 0));
  // Mois analysables : ceux qui ont des revenus ou des dépenses au compte de résultat, et dont le résultat est connu
  // (un mois qui n'a que des soldes, ou dont le relevé du compte courant manque, n'en fait pas partie)
  const hasResult = (p: string) => {
    if (unknown.result.has(p)) return false;
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
  // Part des revenus mise de côté en moyenne : 20 % ou plus, c'est la part « Épargne » de la répartition tenue
  const income = recent.length ? recent.reduce((s, ls) => s + totals(ls).produits, 0) / recent.length : t.produits;
  const savingsRate = income > 0 ? savings / income : 0;
  // Progression du patrimoine sur la période, comparée à celle qu'aurait demandé l'inflation
  // (seulement entre deux bilans connus : un relevé manquant laisserait un solde inconnu)
  const startMonth = shiftMonth(done.length ? done[0] : ref, -1);
  const startLines = unknown.bilan.has(startMonth) || unknown.bilan.has(ref) ? undefined : periods.get(startMonth);
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
        : savingsRate >= SAVINGS_TARGET
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
    olympique: `Tu épargnes ${euros(savings)} par mois en moyenne, soit ${Math.round(savingsRate * 100)} % de tes revenus.`,
    fatigue: `Ton patrimoine a progressé de ${euros(wealthGrowth ?? 0)}, moins que les ${euros(inflationNeed)} qu'il aurait fallu pour suivre l'inflation : mets davantage de côté.`,
    sante:
      wealthGrowth !== null ? `Ton patrimoine a progressé de ${euros(wealthGrowth)}, au moins autant que l'inflation.` : `Tu épargnes ${euros(savings)} par mois en moyenne.`
  }[state];
  return { state, reason };
}

// Mois affiché par la page Finances ouverte (Bilan, Budget : flèches du mois) ; null = le mois en cours
let viewedMonth: string | null = null;
const viewedListeners = new Set<() => void>();
// Dernier mois affiché, gardé en changeant de page : Bilan et Budget s'ouvrent sur le mois qu'on regardait
let rememberedMonth: string | null = null;
export const rememberedFinanceMonth = () => rememberedMonth;
// En retournant à l'accueil, les Finances se rouvriront sur le mois précédent (le dernier terminé)
export const forgetFinanceMonth = () => {
  rememberedMonth = null;
};
function setViewedMonth(month: string | null) {
  if (month) rememberedMonth = month;
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
  const coverage = useCoverage().data;
  const plan = useHemorrhagePlan();
  return useMemo(() => {
    // Mêmes règles que le Bilan : soldes des relevés manquants écartés, mois incomplets laissés de côté
    const known = lines ? knownLines(lines, coverage) : null;
    const health = month && known ? assessHealth(known.lines, month, 'now', plan, { bilan: known.unknownBilan, result: known.unknownResult }) : null;
    return { state: health?.state ?? null, ...HEALTH_TONES[health?.state ?? 'sante'] };
  }, [month, lines, coverage, plan]);
}

