'use client';

import { useMemo } from 'react';
import { byPeriod, formatEuros, liquidAssets, median, monthLabel, passiveIncome, shiftMonth, totals, type FinanceLine } from '@/lib/finance';
import { useCategories, useCategoryLimits, useFinanceLines, useMonthTransactions } from '@/lib/financeQueries';
import { categoryById, summarize } from '@/lib/transactions';

// Parcours vers l'autonomie financière : six étapes validées à partir des chiffres.
// Affiché à l'accueil.

export type ParcoursStep = { title: string; text: string; done: boolean; action: string };
export type Parcours = { steps: ParcoursStep[]; validated: boolean[]; currentStep: number; coverage: number };

// Matelas de sécurité : au moins 6 mois de dépenses en liquidités
const CUSHION = 6;

// span : nombre de derniers mois terminés pris pour les moyennes (épargne, dépenses)
export function computeParcours(
  lines: FinanceLine[],
  currentMonth: string,
  span: number,
  limits: { category: string; monthly_limit: number }[],
  lastMonthTx: Parameters<typeof summarize>[0] | undefined
): Parcours | null {
  const periods = byPeriod(lines.filter((l) => l.amount !== 0));
  const filled = [...periods.keys()].sort();
  const trendMonths = Array.from({ length: span }, (_, i) => shiftMonth(currentMonth, -(span - i)));
  const done = trendMonths.filter((p) => periods.has(p));
  const ref = done[done.length - 1] ?? filled.filter((p) => p < currentMonth).pop() ?? (periods.has(currentMonth) ? currentMonth : undefined);
  if (!ref) return null;

  const L = periods.get(ref) ?? [];
  const t = totals(L);
  // Moyennes sur les mois terminés de la période (plus fiables qu'un seul mois)
  const recent = (done.length ? done : [ref]).map((p) => periods.get(p)!).filter((ls) => totals(ls).produits > 0);
  const avg = (f: (ls: FinanceLine[]) => number) => (recent.length ? recent.reduce((s, ls) => s + f(ls), 0) / recent.length : 0);
  const savings = recent.length ? avg((ls) => totals(ls).resultat) : t.resultat;
  const income = recent.length ? avg((ls) => totals(ls).produits) : t.produits;
  const charges = avg((ls) => totals(ls).charges) || t.charges;
  const savingsRate = income > 0 ? savings / income : null;
  const coverage = charges > 0 ? passiveIncome(L) / charges : 0;
  const fiTarget = charges * 12 * 25;
  const placements = L.filter((l) => l.section === 'placements').reduce((s, l) => s + l.amount, 0);

  // Médiane des dépenses des 6 derniers mois terminés
  const lastSix = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth, -(6 - i))).filter((p) => periods.has(p) && totals(periods.get(p)!).charges > 0);
  const medianSpent6 = lastSix.length ? median(lastSix.map((p) => totals(periods.get(p)!).charges)) : charges;
  // Budget sain : des limites fixées dans Finances > Budget, et aucune catégorie au-delà de sa limite le mois dernier
  const spentLastMonth = summarize(lastMonthTx ?? []).byCategory;
  const overLimits = limits.filter((b) => (spentLastMonth.get(b.category) ?? 0) > b.monthly_limit);
  // Matelas de sécurité : 6 mois de dépenses en liquidités, 4 mois terminés d'affilée
  const cushionMonths = Array.from({ length: 4 }, (_, i) => shiftMonth(currentMonth, -(4 - i)));
  const cushionOk = cushionMonths.filter((p) => periods.has(p) && medianSpent6 > 0 && liquidAssets(periods.get(p)!) >= medianSpent6 * CUSHION).length;

  const steps: ParcoursStep[] = [
    {
      title: 'Comprendre sa situation',
      text: 'Connaître ses revenus, ses dépenses, ses dettes et son patrimoine net.',
      done: t.actif > 0 && t.produits > 0,
      action: 'Remplis ton bilan et ton compte de résultat, ou importe un relevé.'
    },
    {
      title: 'Avoir un budget sain',
      text: 'S’assurer que ses dépenses ne dépassent pas les limites fixées pour chaque catégorie.',
      done: limits.length > 0 && lastMonthTx !== undefined && overLimits.length === 0,
      action:
        limits.length === 0
          ? 'Fixe une limite mensuelle pour tes grandes catégories dans Finances > Budget.'
          : overLimits.length > 0
            ? `En ${monthLabel(shiftMonth(currentMonth, -1))}, ${overLimits.length > 1 ? `${overLimits.length} catégories ont` : 'une catégorie a'} dépassé sa limite : ${overLimits
                .map((b) => categoryById(b.category).label)
                .join(', ')}.`
            : 'Garde tes dépenses sous les limites de chaque catégorie, mois après mois.'
    },
    {
      title: 'Avoir un matelas de sécurité',
      text: 'Garder au moins 6 mois de dépenses de côté, 4 mois d’affilée (validé au bout de 4 mois).',
      done: cushionOk === 4,
      action: `${cushionOk}/4 mois validés : garde au moins ${formatEuros(medianSpent6 * CUSHION)} de liquidités chaque fin de mois.`
    },
    {
      title: "Dégager une capacité d'épargne",
      text: 'Trouver combien tu peux épargner régulièrement sans fragiliser ton quotidien.',
      done: savingsRate !== null && savingsRate >= 0.1,
      action: 'Vise 10 % de tes revenus épargnés chaque mois : regarde ton budget pour trouver où.'
    },
    {
      title: 'Faire grandir ton patrimoine',
      text: 'Comprendre les placements et investir selon son horizon et son niveau de risque.',
      done: placements > 0,
      action: 'Place une partie de ton épargne selon ton horizon, et inscris tes placements dans ton bilan (rubrique Placements).'
    },
    {
      title: "Atteindre ton objectif d'indépendance",
      text: 'Avoir un patrimoine dont les revenus couvrent tes dépenses.',
      done: coverage >= 1,
      action: `Repère indicatif (règle des 4 %) : un patrimoine placé d'environ ${formatEuros(fiTarget)}.`
    }
  ];
  // Validation progressive : une étape n'est validée que si toutes les précédentes le sont déjà,
  // même si son objectif est atteint (elle l'indique alors, et sera validée à son tour)
  const validated = steps.map((_, i) => steps.slice(0, i + 1).every((x) => x.done));
  const currentStep = validated.findIndex((v) => !v);
  return { steps, validated, currentStep, coverage };
}

// Parcours calculé à partir des données gardées en mémoire (lib/financeQueries)
export function useParcours(currentMonth: string | null, span: number) {
  const lines = useFinanceLines(currentMonth, 13).data;
  const limits = useCategoryLimits().data;
  // Libellés des catégories personnalisées, pour nommer celles qui dépassent leur limite
  useCategories();
  const lastMonthTx = useMonthTransactions(currentMonth && shiftMonth(currentMonth, -1)).data;
  return useMemo(
    () => (currentMonth && lines ? computeParcours(lines, currentMonth, span, limits ?? [], lastMonthTx) : null),
    [lines, currentMonth, span, limits, lastMonthTx]
  );
}
