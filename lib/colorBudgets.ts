'use client';

import { useIncomePlan } from '@/lib/coursesQueries';
import { useCategories, useMonthPlans } from '@/lib/financeQueries';
import { useFinanceTone } from '@/lib/health';
import { stateParts, useHealthSettings } from '@/lib/healthSettings';
import { colorLimits, partsFor } from '@/lib/repartition';
import { summarize, type Transaction } from '@/lib/transactions';

// Limites par défaut du mois affiché selon sa couleur (Paramètres > Finances, « Budgets par défaut ») : pour chaque grande
// catégorie, son pourcentage de sa partie de la répartition (celle de la couleur, sinon celle du mois), appliqué aux
// revenus du mois (ou au revenu prévu dans Gestion tant qu'aucun n'est arrivé). Une limite propre au mois (month_budgets)
// passe devant. null : la couleur n'a pas de budgets par défaut (les limites générales s'appliquent).
// monthTx : opérations du mois, sans celles qui vont au bilan.
export function useColorLimits(period: string, monthTx: Transaction[]) {
  const { state } = useFinanceTone();
  const settings = useHealthSettings().data;
  const plan = useIncomePlan().data;
  const monthPlans = useMonthPlans().data;
  const categoriesLoaded = useCategories().data !== undefined;
  const pcts = state ? settings?.budgets[state] : undefined;
  if (!pcts || !plan || !monthPlans || !categoriesLoaded) return null;
  const parts = stateParts(plan.parts, settings, state) ?? partsFor(period, plan, monthPlans);
  const income = summarize(monthTx).income || plan.income;
  return colorLimits(parts, pcts, income);
}
