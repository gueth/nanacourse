import { supabase } from '@/lib/supabase';

// Ajoute des quantités achetées au stock de l'inventaire, en une seule requête.
// Un même ingrédient peut apparaître plusieurs fois : toutes ses quantités sont additionnées
// au stock actuel. Renvoie l'erreur Supabase rencontrée, ou null si tout s'est bien passé.
export async function addToInventory(entries: { ingredientId: string; quantity: number }[]) {
  const ids = Array.from(new Set(entries.map((e) => e.ingredientId)));
  if (ids.length === 0) return null;

  // Stock actuel des ingrédients concernés
  const { data: inv, error: readError } = await supabase.from('inventory').select('ingredient_id, quantity').in('ingredient_id', ids);
  if (readError) return readError;

  // Nouveau stock : stock actuel + toutes les quantités ajoutées
  const stock = new Map<string, number>();
  for (const row of inv ?? []) stock.set(row.ingredient_id, row.quantity);
  for (const e of entries) {
    const total = (stock.get(e.ingredientId) ?? 0) + e.quantity;
    stock.set(e.ingredientId, Math.round(total * 1000) / 1000); // évite 0.30000000000000004
  }

  // "upsert" = update + insert : la ligne de l'ingrédient est mise à jour si elle existe, créée sinon
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('inventory').upsert(
    ids.map((id) => ({
      ingredient_id: id,
      quantity: stock.get(id)!,
      low_stock: false, // on vient d'en acheter, donc plus en stock faible
      updated_at: updatedAt
    })),
    // La colonne qui sert à savoir si la ligne existe déjà
    { onConflict: 'ingredient_id' }
  );
  return error;
}
