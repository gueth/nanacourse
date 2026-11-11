'use client';

import { fetchBudgets, fetchIncomePlan } from '@/lib/budget';
import { must, orThrow, useCached } from '@/lib/cache';
import { STORE_SELECT } from '@/lib/stores';
import { supabase } from '@/lib/supabase';
import type { Category, Chain, Ingredient, IngredientWithRelations, Store } from '@/lib/types';

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

// Nombre d'aliments sans catégorie (signalé sur la page de titre), sans charger tous les ingrédients
export function useUncategorizedCount() {
  return useCached('courses:sans-categorie', async () => {
    const { count, error } = await supabase.from('ingredients').select('id', { count: 'exact', head: true }).is('category_id', null);
    return orThrow(count ?? 0, error);
  });
}

// Ingrédients, par ordre alphabétique (scan d'un reçu depuis le ticket de la liste active) ;
// chargés seulement quand on en a besoin (enabled), pour ne pas alourdir l'affichage de l'accueil
export function useIngredients(enabled = true) {
  return useCached(enabled ? 'courses:ingredients' : null, async () => must<Ingredient[]>(await supabase.from('ingredients').select('*').order('name')));
}

// Catalogue des courses : catégories, supermarchés, ingrédients (avec catégorie et prix par magasin) et enseignes.
// Utilisé par la gestion des ingrédients, catégories et supermarchés (menu de la page des courses)
// et par le scan d'un reçu des Paramètres.
export function useCatalog() {
  return useCached('courses:parametres', async () => {
    const [{ data: cats }, { data: sts }, { data: ings, error }, { data: chs }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('stores').select(STORE_SELECT).order('name'),
      supabase
        .from('ingredients')
        .select(`*, category:categories(*), prices:ingredient_prices(*, store:stores(${STORE_SELECT}))`)
        .order('name'),
      // Enseignes (libellé + couleur), gérées avec les supermarchés
      supabase.from('chains').select('*').order('name')
    ]);
    if (error) console.error(error);
    return {
      categories: (cats as Category[]) ?? [],
      stores: (sts as Store[]) ?? [],
      chains: (chs as Chain[]) ?? [],
      ingredients: (ings as unknown as IngredientWithRelations[]) ?? []
    };
  });
}
