import { supabase } from '@/lib/supabase';
import { refreshListTotal } from '@/lib/lists';

// Suppressions "propres" : avant d'effacer un élément, on le retire de partout où il est utilisé,
// pour que Supabase n'ait plus de lien vers lui et accepte la suppression.
// Chaque fonction renvoie l'erreur Supabase rencontrée, ou null si tout s'est bien passé.

type DbError = { code?: string; message: string } | null;

// CATÉGORIE : les ingrédients qui l'utilisaient passent "sans catégorie"
export async function deleteCategory(id: string): Promise<DbError> {
  const { error } = await supabase.from('ingredients').update({ category_id: null }).eq('category_id', id);
  if (error) return error;
  return (await supabase.from('categories').delete().eq('id', id)).error;
}

// MARQUE : les ingrédients qui l'utilisaient n'ont plus de marque
export async function deleteBrand(id: string): Promise<DbError> {
  const { error } = await supabase.from('ingredients').update({ brand_id: null }).eq('brand_id', id);
  if (error) return error;
  return (await supabase.from('brands').delete().eq('id', id)).error;
}

// SUPERMARCHÉ : ses prix sont effacés, et les articles des listes n'y sont plus rattachés
export async function deleteStore(id: string): Promise<DbError> {
  const [{ error: pricesError }, { error: itemsError }] = await Promise.all([
    supabase.from('ingredient_prices').delete().eq('store_id', id),
    supabase.from('shopping_list_items').update({ store_id: null }).eq('store_id', id)
  ]);
  if (pricesError || itemsError) return pricesError ?? itemsError;
  return (await supabase.from('stores').delete().eq('id', id)).error;
}

// INGRÉDIENT : retiré des listes de courses (dont le total est recalculé), de l'inventaire et des prix
export async function deleteIngredient(id: string): Promise<DbError> {
  // Listes qui contiennent cet ingrédient, pour recalculer leur total ensuite
  const { data: rows, error: readError } = await supabase
    .from('shopping_list_items')
    .select('shopping_list_id')
    .eq('ingredient_id', id);
  if (readError) return readError;

  const results = await Promise.all([
    supabase.from('shopping_list_items').delete().eq('ingredient_id', id),
    supabase.from('inventory').delete().eq('ingredient_id', id),
    supabase.from('ingredient_prices').delete().eq('ingredient_id', id)
  ]);
  const failed = results.find((r) => r.error);
  if (failed) return failed.error;

  const listIds = Array.from(new Set((rows ?? []).map((r) => r.shopping_list_id as string)));
  await Promise.all(listIds.map(refreshListTotal));

  return (await supabase.from('ingredients').delete().eq('id', id)).error;
}

// LISTE DE COURSES : ses articles d'abord, puis la liste
export async function deleteList(id: string): Promise<DbError> {
  const { error } = await supabase.from('shopping_list_items').delete().eq('shopping_list_id', id);
  if (error) return error;
  return (await supabase.from('shopping_lists').delete().eq('id', id)).error;
}
