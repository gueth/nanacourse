import { supabase } from '@/lib/supabase';

// Total d'une liste : somme des prix connus de ses articles (prix vide ou 0 = inconnu, compté 0)
export function listTotal(items: { expected_price: number | null }[]) {
  return items.reduce((sum, i) => sum + (i.expected_price ?? 0), 0);
}

// Enregistre le total d'une liste à partir de ses articles (déjà connus côté page)
export async function saveListTotal(listId: string, items: { expected_price: number | null }[]) {
  const { error } = await supabase.from('shopping_lists').update({ estimated_price: listTotal(items) }).eq('id', listId);
  if (error) console.error(error);
}

// Choisit le magasin où l'on fait les courses d'une liste (null = aucun) :
//  - le prix de chaque article dont le prix est connu dans ce magasin est remplacé (prix unitaire × quantité) ;
//  - le magasin est enregistré sur la liste, et le total recalculé.
// "unitPrice" (ingredient_id|store_id -> prix) est lu dans la base s'il n'est pas fourni.
// Renvoie l'erreur Supabase rencontrée, ou null si tout s'est bien passé.
export async function applyStoreToList(
  listId: string,
  items: { id: string; ingredient_id: string; quantity: number; expected_price: number | null }[],
  storeId: string | null,
  unitPrice?: Map<string, number>
) {
  let prices = unitPrice;
  if (!prices && storeId) {
    const { data, error } = await supabase
      .from('ingredient_prices')
      .select('ingredient_id, store_id, price')
      .eq('store_id', storeId)
      .eq('available', true)
      .in('ingredient_id', Array.from(new Set(items.map((i) => i.ingredient_id))));
    if (error) return error;
    prices = new Map((data ?? []).map((p) => [`${p.ingredient_id}|${p.store_id}`, p.price]));
  }

  const updated = items.map((item) => {
    const price = storeId ? prices?.get(`${item.ingredient_id}|${storeId}`) : undefined;
    return price != null
      ? { ...item, expected_price: Math.round(price * item.quantity * 100) / 100, changed: true }
      : { ...item, changed: false };
  });

  const results = await Promise.all([
    supabase.from('shopping_lists').update({ store_id: storeId }).eq('id', listId),
    ...updated
      .filter((i) => i.changed)
      .map((i) => supabase.from('shopping_list_items').update({ expected_price: i.expected_price, store_id: storeId }).eq('id', i.id))
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) return failed.error;

  await saveListTotal(listId, updated);
  return null;
}

// Relit les articles d'une liste dans la base, puis enregistre son total
// (quand la page ne connaît pas tous les articles, ex : après la suppression d'un ingrédient)
export async function refreshListTotal(listId: string) {
  const { data, error } = await supabase.from('shopping_list_items').select('expected_price').eq('shopping_list_id', listId);
  if (error) return console.error(error);
  await saveListTotal(listId, data ?? []);
}
