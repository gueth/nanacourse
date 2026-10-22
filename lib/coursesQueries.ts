'use client';

import { fetchBudgets, fetchIncomePlan } from '@/lib/budget';
import { must, orThrow, useCached } from '@/lib/cache';
import { STORE_SELECT } from '@/lib/stores';
import { supabase } from '@/lib/supabase';
import type { Ingredient, Store } from '@/lib/types';

// Données de la partie Courses gardées en mémoire (lib/cache), partagées entre les pages qui en ont besoin :
// chargées une fois, affichées tout de suite aux visites suivantes, puis rafraîchies en arrière-plan.

// Budgets de courses avec leur période en cours (réglages + ce qui reste), affichés sur l'accueil (réclame),
// le ticket de caisse et dans Profil > Budget. Chaque liste utilise le sien (voir budgetFor dans lib/budget).
export function useShoppingBudgets() {
  return useCached('courses:budgets', async () => {
    const { budgets, error } = await fetchBudgets();
    return orThrow(budgets, error);
  });
}

// Répartition du revenu (charges / investissement personnel / épargne) de Profil > Budget
export function useIncomePlan() {
  return useCached('courses:repartition', async () => {
    const { plan, error } = await fetchIncomePlan();
    return orThrow(plan, error);
  });
}

// Supermarchés, par ordre alphabétique (liste de courses, magasins, paramètres...)
export function useStores() {
  return useCached('courses:magasins', async () => must<Store[]>(await supabase.from('stores').select(STORE_SELECT).order('name')));
}

// Ingrédients, par ordre alphabétique (scan d'un reçu depuis le ticket de la liste active)
export function useIngredients() {
  return useCached('courses:ingredients', async () => must<Ingredient[]>(await supabase.from('ingredients').select('*').order('name')));
}
