'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { byPeriod, monthKey, shiftMonth, totals, type FinanceLine } from '@/lib/finance';
import { useCategories, useCategoryLimits, useCoverage, useDebtCategories, useFinanceLines, useMonthBudgets, useMonthTransactions } from '@/lib/financeQueries';
import { annualPlans, categoryById, categoryGroups, groupKindOf, isTransfer, summarize } from '@/lib/transactions';
import { budgetLinesOf, budgetOfMonth } from '@/lib/monthBudget';
import { knownLines } from '@/lib/coverage';
import { CHECK_ORDER, compare, DEFAULT_RULES, measureOf, needsBudget, needsCategoryTotals, savingsTargetPct, useHealthSettings, type HealthCondition, type HealthRules } from '@/lib/healthSettings';
import { useSavingsRuleVersion } from '@/lib/savingsRule';

// Santé financière : l'état (hémorragie, maladie, fatigue, santé, olympique, ou neutre) et la teinte qu'il donne à la partie Finances.

export type HealthState = 'hemorragie' | 'maladie' | 'fatigue' | 'sante' | 'olympique' | 'neutre';

// Inflation annuelle retenue par défaut pour l'état « Fatigue » (épargne qui ne suit pas la hausse des prix) ;
// modifiable dans Paramètres > Finances (lib/healthSettings)
export const INFLATION = 0.02;

// Teinte de chaque état : "dark" pour l'en-tête et les accents, "pale" pour le fond des pages Finances
export const HEALTH_TONES: Record<HealthState, { dark: string; pale: string }> = {
  hemorragie: { dark: '#aa333c', pale: '#f4e3e4' },
  // Maladie en jaune doré adouci (moins vif, sans pointe de vert pour ne pas le confondre avec le vert), fatigue en
  // orange franc (tirant sur le rouge) ; fonds crème et pêche.
  // Toutes les teintes "dark" ont la même luminosité : aucune ne paraît plus foncée que les autres, et le texte clair
  // de l'en-tête reste lisible partout (contraste d'environ 6,4 pour 1)
  maladie: { dark: '#765c22', pale: '#f9f2dc' },
  fatigue: { dark: '#9c4500', pale: '#fbe3d0' },
  sante: { dark: '#416089', pale: '#e6edf5' },
  // Vert vif (#0ed145) assombri pour l'en-tête et les accents, fond du même vert éclairci
  olympique: { dark: '#006f2e', pale: '#d4f2dc' },
  // Gris : le mois ne respecte aucune des règles
  neutre: { dark: '#5d636b', pale: '#eceef0' }
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
// Les couleurs sont vérifiées dans l'ordre CHECK_ORDER (rouge, orange, jaune, bleu, vert) : la première dont la règle
// est vraie donne sa couleur au mois, le gris (neutre) sinon. Chaque règle est une liste de conditions (Paramètres >
// Finances, lib/healthSettings), vraie si l'une d'elles l'est (ou toutes, au choix). Un arrêt des revenus déclaré par
// l'utilisateur donne aussi le rouge.
// null : pas encore assez de chiffres.
// "unknown" : mois dont le bilan ou le compte de résultat n'est pas connu faute de relevé (lib/coverage) ; ils sont
// laissés de côté, comme sur le Bilan et l'accueil.
export const SAVINGS_TARGET = savingsTargetPct(DEFAULT_RULES) / 100;
// Montant du mois de chaque catégorie et grande catégorie (« groupe:<id> ») : entrées reçues ou sorties payées, avec
// son nom ; pour les conditions de type « Catégorie » (null : pas chargés, ces conditions sont alors fausses)
export type CategoryTotals = Map<string, { label: string; total: number }>;
// Budget du mois, global et par catégorie ou grande catégorie limitée (clé : identifiant, ou « groupe:<id> »)
export type MonthBudgetCheck = { allowed: number; spent: number; lines: Map<string, { label: string; allowed: number; spent: number }> };
const NOTHING_UNKNOWN = { bilan: new Set<string>(), result: new Set<string>() };
export function assessHealth(
  lines: FinanceLine[],
  currentMonth: string,
  span: number | 'now',
  plan: HemorrhagePlan = EMPTY_PLAN,
  unknown: { bilan: Set<string>; result: Set<string> } = NOTHING_UNKNOWN,
  rules: HealthRules = DEFAULT_RULES,
  categoryTotals: CategoryTotals | null = null,
  // Budget du mois : total des limites et dépenses de ces catégories, et le budget de chaque catégorie ou grande
  // catégorie limitée (null : pas chargé, ces conditions sont fausses)
  budget: MonthBudgetCheck | null = null
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
  const avgOf = (f: (tt: ReturnType<typeof totals>) => number) => (recent.length ? recent.reduce((s, ls) => s + f(totals(ls)), 0) / recent.length : f(t));
  // Résultat (produits − charges) et épargne (sans les entrées écartées : aides…, règle de lib/savingsRule), en moyenne
  const resultat = avgOf((tt) => tt.resultat);
  const savings = avgOf((tt) => tt.epargne);
  const periodLines = (done.length ? done : [ref]).map((p) => periods.get(p) ?? []);
  const workIncome = periodLines.reduce((s, ls) => s + workIncomeOf(ls), 0) / (periodLines.length || 1);
  // Part des revenus retenus (sans les entrées écartées) mise de côté en moyenne
  const income = avgOf((tt) => tt.produits);
  const keptIncome = avgOf((tt) => tt.revenusRetenus);
  const savingsRate = keptIncome > 0 ? savings / keptIncome : 0;
  // Progression du patrimoine sur la période
  // (seulement entre deux bilans connus : un relevé manquant laisserait un solde inconnu)
  const startMonth = shiftMonth(done.length ? done[0] : ref, -1);
  const startLines = unknown.bilan.has(startMonth) || unknown.bilan.has(ref) ? undefined : periods.get(startMonth);
  const months = isNow ? 1 : Math.max(1, done.length);
  const wealthStart = startLines ? totals(startLines).patrimoine : null;
  const wealthGrowth = wealthStart !== null ? t.patrimoine - wealthStart : null;
  const declared = plannedHemorrhageNow(plan);
  const sumOf = (test: (l: FinanceLine) => boolean) => L.filter(test).reduce((sum, l) => sum + l.amount, 0);

  // Valeur mesurée par une condition (null : inconnue)
  const valueOf = (c: HealthCondition): number | null => {
    switch (c.kind) {
      case 'categorie':
        return categoryTotals && c.target ? (categoryTotals.get(c.target)?.total ?? 0) : null;
      case 'resultat':
        return { resultat, produits: income, charges: income - resultat, revenus_activite: workIncome }[c.measure] ?? null;
      case 'bilan':
        if (unknown.bilan.has(ref)) return null;
        return (
          {
            patrimoine: t.patrimoine,
            actif: t.actif,
            dettes: t.dettes,
            liquidites: sumOf((l) => l.section === 'liquidites'),
            decouvert: sumOf((l) => /d[ée]couvert/i.test(l.label))
          }[c.measure] ?? null
        );
      case 'epargne':
        return c.measure === 'taux' ? (keptIncome > 0 ? savingsRate * 100 : null) : savings;
      case 'budget':
        // Dépassement : dépenses − limites (en € ou en % des limites) ; négatif tant qu'on reste dans le budget
        // Budget d'une catégorie : seulement si elle a une limite ce mois-ci (sinon la condition est fausse)
        {
          const b = c.target ? (budget?.lines.get(c.target) ?? null) : budget;
          if (!b || b.allowed <= 0) return null;
          return c.measure === 'depassement' ? b.spent - b.allowed : ((b.spent - b.allowed) / b.allowed) * 100;
        }
      case 'patrimoine':
        if (c.measure === 'progression') return wealthGrowth;
        // Progression ramenée à un an, en % du patrimoine de départ
        return wealthGrowth !== null && wealthStart !== null && wealthStart > 0 ? (wealthGrowth / wealthStart) * (12 / months) * 100 : null;
    }
  };
  // Première condition vraie d'une couleur (avec « toutes » : la première, si toutes le sont)
  const ruleHit = (s: Exclude<HealthState, 'neutre'>): HealthCondition | null => {
    const r = rules[s];
    if (!r || r.conditions.length === 0) return null;
    const results = r.conditions.map((c) => compare(valueOf(c), c.op, c.value));
    if (r.match === 'all') return results.every(Boolean) ? r.conditions[0] : null;
    const i = results.findIndex(Boolean);
    return i >= 0 ? r.conditions[i] : null;
  };

  let state: HealthState = 'neutre';
  let hit: HealthCondition | null = null;
  if (declared) state = 'hemorragie';
  else
    for (const s of CHECK_ORDER) {
      if (s === 'neutre') break;
      hit = ruleHit(s);
      if (hit) {
        state = s;
        break;
      }
    }

  const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  // Explication : la condition qui a donné la couleur, avec la valeur du mois
  let reason: string;
  if (declared) reason = `Tu as indiqué que tes revenus d'activité se sont arrêtés le ${toDate(plan.start!).toLocaleDateString('fr-FR')}.`;
  else if (hit) {
    const m = measureOf(hit);
    const v = valueOf(hit) ?? 0;
    const name =
      hit.kind === 'categorie'
        ? `« ${categoryTotals?.get(hit.target ?? '')?.label ?? 'Catégorie'} »`
        : hit.kind === 'budget' && hit.target
          ? `${m?.label ?? ''} « ${budget?.lines.get(hit.target)?.label ?? 'Catégorie'} »`
          : (m?.label ?? '');
    const shown = (n: number) => (m?.unit === '€' ? euros(n) : `${Math.round(n * 10) / 10} ${m?.unit ?? ''}`);
    reason = `${name} : ${shown(v)} (règle : ${hit.op} ${shown(hit.value)}).`;
  } else if (state === 'neutre') reason = 'Ce mois ne respecte aucune des règles des couleurs (Paramètres > Finances).';
  else
    reason =
      wealthGrowth !== null ? `Ton patrimoine a progressé de ${euros(wealthGrowth)}.` : `Tu épargnes ${euros(savings)} par mois en moyenne.`;
  return { state, reason };
}

// Mois affiché par la page Finances ouverte (Bilan, Budget : flèches du mois) ; null = le mois en cours
let viewedMonth: string | null = null;
const viewedListeners = new Set<() => void>();
// Dernier mois affiché, gardé en changeant de page et en actualisant la page (stockage de l'onglet) : Bilan et Budget
// s'ouvrent sur le mois qu'on regardait
const FINANCE_MONTH_KEY = 'nanacourses.finance-month';
let rememberedMonth: string | null | undefined;
export const rememberedFinanceMonth = (): string | null => {
  if (rememberedMonth === undefined) {
    try {
      rememberedMonth = window.sessionStorage.getItem(FINANCE_MONTH_KEY)?.match(/^\d{4}-\d{2}$/)?.[0] ?? null;
    } catch {
      rememberedMonth = null;
    }
  }
  return rememberedMonth;
};
function storeFinanceMonth(month: string | null) {
  rememberedMonth = month;
  try {
    if (month) window.sessionStorage.setItem(FINANCE_MONTH_KEY, month);
    else window.sessionStorage.removeItem(FINANCE_MONTH_KEY);
  } catch {
    // pas de stockage : le mois n'est gardé que jusqu'à l'actualisation
  }
}
// En retournant à l'accueil, les Finances se rouvriront sur le mois précédent (le dernier terminé)
export const forgetFinanceMonth = () => storeFinanceMonth(null);
function setViewedMonth(month: string | null) {
  if (month) storeFinanceMonth(month);
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

// Dernière teinte connue, gardée sur l'appareil : reprise tant que l'état du moment n'est pas encore calculé (aucun
// bleu par défaut au chargement). Un petit script de app/layout.tsx la pose aussi avant le premier affichage.
export const FINANCE_TONE_KEY = 'nanacourses.finance-tone';
type Tone = { dark: string; pale: string };
let rememberedRaw: string | null | undefined;
let remembered: Tone | null = null;
function readRememberedTone(): Tone | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FINANCE_TONE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== rememberedRaw) {
    rememberedRaw = raw;
    try {
      const parsed = raw ? (JSON.parse(raw) as Tone) : null;
      remembered = parsed && parsed.dark && parsed.pale ? parsed : null;
    } catch {
      remembered = null;
    }
  }
  return remembered;
}
function rememberTone(tone: Tone) {
  try {
    window.localStorage.setItem(FINANCE_TONE_KEY, JSON.stringify(tone));
  } catch {
    // pas de stockage : la teinte sera recalculée à chaque ouverture
  }
}

// Teinte de la partie Finances : celle de l'état de santé du mois sur lequel on est (le mois affiché par la page,
// sinon le mois en cours) ; tant qu'il n'est pas connu, la dernière teinte connue, sinon aucune (dark et pale null :
// la page garde alors la teinte posée par le script du début, ou un fond neutre). Les données viennent de la mémoire partagée.
const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
export function useFinanceTone(): { state: HealthState | null; dark: string | null; pale: string | null } {
  const last = useSyncExternalStore(noSubscribe, readRememberedTone, () => null);
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
  const rules = useHealthSettings().data?.rules;
  // Règle de l'épargne : la couleur se recalcule quand elle change
  const savingsRule = useSavingsRuleVersion();
  // Montants des grandes catégories du mois : chargés seulement si une règle s'en sert
  const needGroups = needsCategoryTotals(rules);
  const categoriesLoaded = useCategories().data !== undefined;
  // Budget du mois (limites et dépenses) : chargé seulement si une règle s'en sert
  const needBudgetData = needsBudget(rules);
  const limits = useCategoryLimits().data;
  const monthBudgets = useMonthBudgets().data;
  const monthTx = useMonthTransactions(needGroups || needBudgetData ? month : null).data;
  const isDebtTx = useDebtCategories();
  const groupTotals = useMemo(() => {
    if (!needGroups || !categoriesLoaded || !monthTx) return null;
    const map: CategoryTotals = new Map();
    for (const g of categoryGroups()) map.set(`groupe:${g.id}`, { label: g.label, total: 0 });
    for (const t of monthTx) {
      const c = categoryById(t.category);
      // Sans les virements entre mes comptes ni les opérations qui vont au bilan (dettes, créances)
      if (isTransfer(t) || isDebtTx(t)) continue;
      const move = groupKindOf(c) === 'income' ? t.amount : -t.amount;
      for (const key of [c.id, ...(c.group ? [`groupe:${c.group}`] : [])]) {
        const entry = map.get(key) ?? { label: c.label, total: 0 };
        entry.total = Math.round((entry.total + move) * 100) / 100;
        map.set(key, entry);
      }
    }
    return map;
  }, [needGroups, categoriesLoaded, monthTx, isDebtTx]);
  const budget = useMemo(() => {
    if (!needBudgetData || !month || !categoriesLoaded || !monthTx || !limits || !monthBudgets) return null;
    // Comme le Budget : sans les opérations qui vont au bilan
    const tx = monthTx.filter((t) => !isDebtTx(t));
    const total = budgetOfMonth(month, tx, limits, annualPlans(), monthBudgets);
    const lines = new Map(
      budgetLinesOf(month, summarize(tx).byCategory, limits, monthBudgets).map((l) => [l.target, { label: l.label, allowed: l.limit, spent: l.spent }])
    );
    return { allowed: total.allowed, spent: total.spent, lines } satisfies MonthBudgetCheck;
  }, [needBudgetData, month, categoriesLoaded, monthTx, limits, monthBudgets, isDebtTx]);
  const state = useMemo(() => {
    // Mêmes règles que le Bilan : soldes des relevés manquants écartés, mois incomplets laissés de côté
    const known = lines ? knownLines(lines, coverage) : null;
    const health =
      month && known && rules
        ? assessHealth(known.lines, month, 'now', plan, { bilan: known.unknownBilan, result: known.unknownResult }, rules, groupTotals, budget)
        : null;
    return health?.state ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savingsRule : l'épargne de totals() suit la règle
  }, [month, lines, coverage, plan, rules, groupTotals, budget, savingsRule]);
  // État connu : sa teinte est retenue pour les prochains chargements
  useEffect(() => {
    if (state) rememberTone(HEALTH_TONES[state]);
  }, [state]);
  if (state) return { state, ...HEALTH_TONES[state] };
  return { state: null, dark: last?.dark ?? null, pale: last?.pale ?? null };
}

