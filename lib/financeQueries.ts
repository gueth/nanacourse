'use client';

import { useMemo } from 'react';
import { orThrow, useCached } from '@/lib/cache';
import { fetchLines, fetchLinesRange, groceriesTotal, shiftMonth } from '@/lib/finance';
import { fetchDebts, fetchGoals, fetchInvestments } from '@/lib/financePlans';

// Données des pages Finances gardées en mémoire (lib/cache) : partagées entre les pages Santé, Objectifs,
// Placements et Dettes, elles ne sont chargées qu'une fois puis rafraîchies en arrière-plan.

// Lignes du bilan et du compte de résultat des "back" derniers mois (et du mois en cours).
// Une seule requête de 13 mois en arrière sert à toutes les pages ; chacune n'en garde que la période voulue.
export function useFinanceLines(currentMonth: string | null, back: number) {
  const query = useCached(currentMonth && `finances:lignes:${currentMonth}`, async () => {
    const { lines, error } = await fetchLinesRange(shiftMonth(currentMonth!, -13), currentMonth!);
    return orThrow(lines, error);
  });
  const from = currentMonth ? shiftMonth(currentMonth, -back) : '';
  // En cas d'erreur de chargement : liste vide, pour que la page s'affiche quand même avec le message d'erreur
  const failed = !!query.error;
  const lines = useMemo(() => query.data?.filter((l) => l.period >= from) ?? (failed ? [] : undefined), [query.data, from, failed]);
  return { ...query, data: lines };
}

// Lignes d'un seul mois (page Bilan) : le mois affiché et le précédent partagent la même mémoire,
// si bien qu'en changeant de mois l'un des deux est souvent déjà chargé
export function useMonthLines(period: string | null) {
  return useCached(period && `finances:mois:${period}`, async () => {
    const { lines, error } = await fetchLines(period!);
    return orThrow(lines, error);
  });
}

// Total des courses enregistrées dans l'appli pour un mois
export function useGroceriesTotal(period: string | null) {
  return useCached(period && `finances:courses:${period}`, () => groceriesTotal(period!));
}

export function useGoals() {
  return useCached('finances:objectifs', async () => {
    const { goals, error } = await fetchGoals();
    return orThrow(goals, error);
  });
}

export function useDebts() {
  return useCached('finances:dettes', async () => {
    const { debts, error } = await fetchDebts();
    return orThrow(debts, error);
  });
}

export function useInvestments() {
  return useCached('finances:placements', async () => {
    const { investments, error } = await fetchInvestments();
    return orThrow(investments, error);
  });
}
