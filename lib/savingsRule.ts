import { useSyncExternalStore } from 'react';

// Règle de l'épargne, la même partout dans l'application (accueil, Bilan, Budget, couleurs du mois, parcours) :
//   épargne = entrées du mois − entrées écartées (par défaut les aides et allocations) − charges du mois
// Les charges ne comptent ni les virements entre mes comptes ni les catégories reliées au bilan (créances, emprunts,
// dettes) : elles sont déjà écartées du compte de résultat et des opérations du mois.
// Taux d'épargne : l'épargne divisée par les entrées retenues (entrées − entrées écartées).
// Les catégories d'entrée écartées se règlent dans Paramètres > Finances (lib/healthSettings, qui les pose ici dès
// qu'elles sont lues ou enregistrées) ; ce module ne dépend d'aucun autre, pour servir aux calculs de base
// (lib/finance, lib/transactions).

export const DEFAULT_SAVINGS_EXCLUDED = ['aides'];

// Catégories d'entrée écartées ; "linesOf" donne les lignes du compte de résultat qui leur correspondent (lues à chaque
// fois : les catégories personnelles peuvent être chargées après la règle)
let excludedCategories = new Set<string>(DEFAULT_SAVINGS_EXCLUDED);
let linesOf: (categories: string[]) => string[] = () => ['Aides et allocations'];
let version = 0;
const listeners = new Set<() => void>();

export function setSavingsRule(categories: string[], lines?: (categories: string[]) => string[]) {
  if (lines) linesOf = lines;
  const next = new Set(categories);
  if (next.size === excludedCategories.size && [...next].every((c) => excludedCategories.has(c))) return;
  excludedCategories = next;
  version++;
  listeners.forEach((l) => l());
}

export const savingsExcluded = () => [...excludedCategories];
export const isExcludedIncomeCategory = (category: string) => excludedCategories.has(category);
export function isExcludedIncomeLine(label: string) {
  const l = label.trim().toLowerCase();
  return linesOf([...excludedCategories]).some((x) => x.trim().toLowerCase() === l);
}

// Numéro de la règle : à mettre dans les dépendances d'un calcul d'épargne mis en mémoire (useMemo), pour qu'il se
// refasse quand la règle change
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};
export const useSavingsRuleVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  );
