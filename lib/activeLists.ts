'use client';

import { useCached } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import type { PendingChanges } from '@/lib/pending';

// Liste de courses ACTIVE, imprimée en ticket de caisse sur l'accueil (même mémoire : lib/cache).

// Un article (une ligne) d'une liste de courses enregistrée.
export type SavedItem = {
  id: string; // identifiant unique de la ligne dans "shopping_list_items"
  ingredient_id: string; // identifiant de l'ingrédient concerné
  quantity: number; // quantité à acheter
  expected_price: number | null; // prix estimé de la ligne (0 ou null = prix pas encore connu)
  // L'ingrédient lié (récupéré grâce à la jointure Supabase), avec sa catégorie.
  // "| null" : la valeur peut être absente (ex : ingrédient supprimé entre-temps).
  ingredient: {
    name: string;
    type: string | null; // kg, pièce, paquet... : fixe les quantités possibles
    brand: { name: string } | null;
    category: { id: string; name: string; budget_limit: number | null } | null; // budget max de la catégorie
  } | null;
  // Modifications en attente (nom, catégorie, prix modifié...) : appliquées à l'ingrédient à la validation de la liste.
  // L'ingrédient ci-dessus est déjà affiché avec ces modifications (voir withPending).
  pending?: PendingChanges | null;
};

// Une liste de courses enregistrée, avec tous ses articles.
export type SavedList = {
  id: string; // identifiant unique de la liste
  name: string; // nom de la liste (affiché en titre de la carte)
  estimated_price: number; // total estimé calculé à la création de la liste
  date?: string | null; // date de la liste (AAAA-MM-JJ)
  created_at?: string | null; // date de création
  updated_at?: string | null; // date de dernière modification (mise à jour par Supabase à chaque changement)
  activated_at?: string | null; // date d'activation (dans Paramètres > Listes de courses)
  store_id?: string | null; // magasin choisi pour faire les courses (ligne "Magasin" du ticket)
  items: SavedItem[]; // tous les articles de cette liste
};

// Requête de la liste de courses ACTIVE (on l'active dans Paramètres > Listes de courses), avec :
//   items      -> les lignes de "shopping_list_items" liées à la liste
//   ingredient -> pour chaque ligne, l'ingrédient (nom, type, marque)
//   category   -> pour chaque ingrédient, sa catégorie (id + nom)
// Tri par id décroissant : les listes les plus récentes en premier.
export async function fetchActiveLists() {
  const [lists, { data: categories }, { data: brands }] = await Promise.all([
    supabase
      .from('shopping_lists')
      .select('*, items:shopping_list_items(*, ingredient:ingredients(name, type, brand:brands(name), category:categories(id, name, budget_limit)))')
      .eq('is_active', true)
      .order('id', { ascending: false }),
    supabase.from('categories').select('id, name, budget_limit'),
    supabase.from('brands').select('id, name')
  ]);
  return { data: withPending((lists.data as unknown as SavedList[]) ?? [], categories ?? [], brands ?? []), error: lists.error };
}

// Affichage des articles avec leurs modifications en attente (nom, catégorie, marque, unité) :
// la liste montre ce que l'utilisateur a saisi, même si l'ingrédient ne change qu'à la validation
function withPending(
  lists: SavedList[],
  categories: { id: string; name: string; budget_limit: number | null }[],
  brands: { id: string; name: string }[]
) {
  return lists.map((list) => ({
    ...list,
    items: list.items.map((item) => {
      const p = item.pending;
      if (!p || !item.ingredient) return item;
      const ingredient = { ...item.ingredient };
      if (p.name !== undefined) ingredient.name = p.name;
      if (p.type !== undefined) ingredient.type = p.type ?? null;
      if (p.brand_id !== undefined) ingredient.brand = brands.find((b) => b.id === p.brand_id) ?? null;
      if (p.category_id !== undefined) ingredient.category = categories.find((c) => c.id === p.category_id) ?? null;
      return { ...item, ingredient };
    })
  }));
}

// Listes actives gardées en mémoire entre deux visites : affichées tout de suite, puis rechargées en arrière-plan
export function useActiveLists() {
  return useCached('courses:listes-actives', async () => {
    const { data, error } = await fetchActiveLists();
    // En cas d'erreur on l'affiche dans la console du navigateur (F12), et la liste reste vide.
    if (error) console.error(error);
    return data;
  });
}
