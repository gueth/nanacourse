'use client';

import { useMemo } from 'react';
import { orThrow, useCached } from '@/lib/cache';
import { fetchLines, fetchLinesRange, shiftMonth } from '@/lib/finance';
import { countTransactions, fetchBudgets, fetchCoverage, fetchMonthBudgets, fetchTransactions, loadCategories } from '@/lib/transactions';

// Données des pages Finances gardées en mémoire (lib/cache) : partagées entre les pages Santé, Bilan,
// Budget et l'accueil, elles ne sont chargées qu'une fois puis rafraîchies en arrière-plan.

// Lignes du bilan et du compte de résultat des "back" derniers mois (et du mois en cours).
// Une seule requête de 13 mois en arrière sert à toutes les pages ; chacune n'en garde que la période voulue.
// Relevés présents ou manquants, tous mois confondus (lib/coverage) : Bilan, accueil et état de santé
export function useCoverage() {
  return useCached('finances:releves', async () => {
    const { coverage, error } = await fetchCoverage();
    return orThrow(coverage, error);
  });
}

// Nombre d'opérations importées pour un mois (0 : aucun relevé n'a encore été importé pour ce mois).
// Clé distincte de useMonthTransactions (la liste des opérations du mois) : partager la même clé mettait un nombre
// là où l'accueil attend une liste, et la page plantait.
export function useMonthOperations(period: string | null) {
  return useCached(period && `finances:nombre-operations:${period}`, async () => {
    const { count, error } = await countTransactions(period!);
    return orThrow(count, error);
  });
}

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

// Limites mensuelles des grandes catégories (Finances > Budget) : même mémoire que la page Budget
export function useCategoryLimits() {
  return useCached('finances:budgets', async () => {
    const { budgets, error } = await fetchBudgets();
    return orThrow(budgets, error);
  });
}

// Budgets propres aux mois passés, et ce qui compte (ou non) dans la dette à moi-même, tous mois confondus
export function useMonthBudgets() {
  return useCached('finances:budgets-des-mois', async () => {
    const { monthBudgets, error } = await fetchMonthBudgets();
    return orThrow(monthBudgets, error);
  });
}

// Catégories personnalisées et supprimées, rangées dans CATEGORIES (lib/transactions) : même mémoire que la page Budget
export function useCategories() {
  return useCached('finances:categories', async () => orThrow(Date.now(), await loadCategories()));
}

// Opérations bancaires d'un mois (AAAA-MM)
export function useMonthTransactions(month: string | null) {
  return useCached(month && `finances:operations-du-mois:${month}`, async () => {
    const [y, m] = month!.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const { transactions, error } = await fetchTransactions(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`);
    return orThrow(transactions, error);
  });
}
