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

// Relit les articles d'une liste dans la base, puis enregistre son total
// (quand la page ne connaît pas tous les articles, ex : après la suppression d'un ingrédient)
export async function refreshListTotal(listId: string) {
  const { data, error } = await supabase.from('shopping_list_items').select('expected_price').eq('shopping_list_id', listId);
  if (error) return console.error(error);
  await saveListTotal(listId, data ?? []);
}
