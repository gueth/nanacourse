import { supabase } from '@/lib/supabase';

export type NewIngredient = {
  name: string;
  note?: string;
  category_id?: string;
  brand_id?: string;
  type?: string;
};

// Crée un ingrédient (les champs vides deviennent null), et son prix dans un magasin si fourni.
// Renvoie l'id du nouvel ingrédient, ou null en cas d'erreur.
export async function createIngredient(fields: NewIngredient, storeId?: string, price?: number) {
  const { data: created, error } = await supabase
    .from('ingredients')
    .insert({
      name: fields.name.trim(),
      note: fields.note?.trim() || null,
      category_id: fields.category_id || null,
      brand_id: fields.brand_id || null,
      type: fields.type?.trim() || null
    })
    .select()
    .single();
  if (error || !created) {
    console.error(error);
    return null;
  }

  if (storeId && price != null) {
    const { error: priceError } = await supabase
      .from('ingredient_prices')
      .insert({ ingredient_id: created.id, store_id: storeId, price, available: true });
    if (priceError) console.error(priceError);
  }

  return created.id as string;
}

// Mémorise le prix d'un ingrédient dans un magasin : mis à jour s'il était déjà connu, ajouté sinon.
// Renvoie l'erreur Supabase rencontrée, ou null si tout s'est bien passé.
export async function saveIngredientPrice(ingredientId: string, storeId: string, price: number) {
  const { data: known, error: readError } = await supabase
    .from('ingredient_prices')
    .select('id, price')
    .eq('ingredient_id', ingredientId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return readError;
  if (known) {
    if (known.price === price) return null;
    return (await supabase.from('ingredient_prices').update({ price, available: true }).eq('id', known.id)).error;
  }
  return (await supabase.from('ingredient_prices').insert({ ingredient_id: ingredientId, store_id: storeId, price, available: true }))
    .error;
}

// Familles de produits (déplacées dans lib/family.ts), ré-exportées pour les imports existants
export { familyKey, familyLabel, groupByFamily } from '@/lib/family';
