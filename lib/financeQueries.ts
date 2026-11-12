'use client';

import { useMemo } from 'react';
import { orThrow, useCached } from '@/lib/cache';
import { fetchAllLines, fetchLines, fetchLinesRange, shiftMonth } from '@/lib/finance';
import { fetchMonthPlans } from '@/lib/repartition';
import { fetchBalanceLinks } from '@/lib/balanceLinks';
import {
  connectedFrom,
  countTransactions,
  fetchBudgets,
  fetchCoverage,
  fetchMonthBudgets,
  fetchTransactions,
  isConnectedTx,
  loadCategories,
  type Transaction
} from '@/lib/transactions';

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

// Lignes du bilan et du compte de résultat qui ont déjà eu un montant, un mois ou un autre (« rubrique|intitulé en
// minuscules ») : celles qui n'en ont jamais eu peuvent être masquées pour que deux tableaux côte à côte aient la même longueur
export const lineKey = (section: string, label: string) => `${section}|${label.trim().toLowerCase()}`;
export function useFilledLines() {
  return useCached('finances:lignes-remplies', async () => {
    const { rows, error } = await fetchAllLines<{ section: string; label: string }>('section, label', (q) => q.neq('amount', 0));
    return orThrow([...new Set(rows.map((r) => lineKey(r.section, r.label)))], error);
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

// Répartitions du revenu propres aux mois passés (lib/repartition) ; la répartition par défaut : useIncomePlan
export function useMonthPlans() {
  return useCached('finances:repartitions-des-mois', async () => {
    const { monthPlans, error } = await fetchMonthPlans();
    return orThrow(monthPlans, error);
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

// Opérations des catégories reliées à une ligne du bilan (créances, emprunts, dettes : Finances > Gestion, connecteurs) :
// prêts aux proches, emprunts et leurs remboursements. Les chiffres d'indication des cartes Finances ne les comptent pas
// (ce n'est ni un revenu ni une dépense). Renvoie un test : l'opération va-t-elle au bilan ?
export function useDebtCategories() {
  const links = useCached('finances:lignes-reliees', async () => {
    const { links, error } = await fetchBalanceLinks();
    return orThrow(links, error);
  }).data;
  // Même règle que le compte de résultat (lib/transactions, connectedCategories) : toutes les rubriques reliées
  // (créances, emprunts, dettes), à partir du mois de départ de chaque connecteur
  return useMemo(() => {
    const connected = connectedFrom(links ?? []);
    return (t: Pick<Transaction, 'category' | 'date'>) => isConnectedTx(connected, t);
  }, [links]);
}
