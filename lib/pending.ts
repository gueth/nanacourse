import { supabase } from '@/lib/supabase';
import { saveIngredientPrice } from '@/lib/ingredients';

// Modifications faites depuis une liste de courses, gardées en attente sur la ligne de la liste
// (colonne "pending" de shopping_list_items) : elles ne sont appliquées à l'ingrédient
// qu'au moment où la liste est validée.
export type PendingChanges = {
  name?: string;
  category_id?: string | null;
  brand_id?: string | null;
  type?: string | null;
  note?: string | null;
  // Le prix de la ligne a été modifié à la main
  price_changed?: boolean;
};

// Champs de l'ingrédient concernés (le reste de PendingChanges ne touche pas l'ingrédient)
const INGREDIENT_FIELDS = ['name', 'category_id', 'brand_id', 'type', 'note'] as const;

// À la validation d'une liste, pour les articles achetés (barrés) seulement : applique aux ingrédients
// les modifications en attente, et mémorise leur prix unitaire dans le magasin de la liste.
// Les articles non barrés ne modifient rien (leurs modifications restent en attente sur la ligne).
// Renvoie la liste des éléments qui n'ont pas pu être enregistrés (vide si tout s'est bien passé).
export async function applyPendingChanges(
  boughtItems: {
    ingredient_id: string;
    quantity: number;
    expected_price: number | null;
    pending?: PendingChanges | null;
  }[],
  storeId: string | null
) {
  const failures: string[] = [];

  // 1. Informations de l'ingrédient (nom, catégorie, marque, unité, note)
  for (const item of boughtItems) {
    const p = item.pending;
    if (!p) continue;
    const changes: Record<string, string | null> = {};
    for (const field of INGREDIENT_FIELDS) if (p[field] !== undefined) changes[field] = p[field] ?? null;
    if (Object.keys(changes).length === 0) continue;
    const { error } = await supabase.from('ingredients').update(changes).eq('id', item.ingredient_id);
    if (error) {
      console.error(error);
      failures.push(`informations de « ${p.name ?? 'un ingrédient'} »`);
    }
  }

  // 2. Prix unitaire (prix de la ligne / quantité) dans le magasin de la liste
  if (storeId) {
    for (const item of boughtItems) {
      if (!item.expected_price || item.quantity <= 0) continue;
      const unit = Math.round((item.expected_price / item.quantity) * 100) / 100;
      const error = await saveIngredientPrice(item.ingredient_id, storeId, unit);
      if (error) {
        console.error(error);
        failures.push(`prix d'un ingrédient`);
      }
    }
  }

  return failures;
}
