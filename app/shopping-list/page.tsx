'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { IngredientWithRelations, Store } from '@/lib/types';
import { optimizeShoppingList, type ShoppingItem, type OptimizationResult } from '@/lib/optimize';

export default function ShoppingListPage() {
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase
        .from('ingredients')
        .select('*, category:categories(*), prices:ingredient_prices(*, store:stores(*))')
        .order('name'),
      supabase.from('stores').select('*')
    ]).then(([{ data: ings }, { data: sts }]) => {
      setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
      setStores(sts ?? []);
      setLoading(false);
    });
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 1;
      return next;
    });
  }

  function runOptimization() {
    const items: ShoppingItem[] = Object.entries(selected).map(([ingredientId, quantity]) => {
      const ing = ingredients.find((i) => i.id === ingredientId)!;
      return {
        ingredientId,
        ingredientName: ing.name,
        quantity,
        options: ing.prices.filter((p) => p.available).map((p) => ({ storeId: p.store_id, storeName: p.store.name, price: p.price }))
      };
    });
    setResult(optimizeShoppingList(items, stores));
    setSaved(false);
  }

  async function saveList() {
    if (!result) return;
    const { data: list, error: listError } = await supabase
      .from('shopping_lists')
      .insert({ name: 'Liste de courses', estimated_price: result.totalPrice })
      .select()
      .single();
    if (listError || !list) return console.error(listError);

    const rows = result.breakdown.flatMap((b) =>
      b.items.map((it) => ({
        shopping_list_id: list.id,
        ingredient_id: it.ingredientId,
        quantity: it.quantity,
        expected_price: it.lineTotal,
        store_id: b.store.id
      }))
    );
    const { error: itemsError } = await supabase.from('shopping_list_items').insert(rows);
    if (itemsError) console.error(itemsError);
    else setSaved(true);
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      <h1 className="title-hand text-4xl mb-1">Liste de courses</h1>
      <p className="opacity-70 mb-6">Coche ce dont tu as besoin, puis optimise.</p>

      <ul className="card">
        <span className="tape" />
        {ingredients.map((ing) => (
          <li key={ing.id} className="flex items-center gap-2 py-1">
            <input type="checkbox" checked={ing.id in selected} onChange={() => toggle(ing.id)} className="w-4 h-4 accent-brick" />
            <span>{ing.name}</span>
            {ing.prices.length === 0 && <span className="text-xs text-brick opacity-70">(aucun prix)</span>}
            {ing.id in selected && (
              <input
                type="number"
                min={1}
                value={selected[ing.id]}
                onChange={(e) => setSelected((s) => ({ ...s, [ing.id]: Number(e.target.value) }))}
                className="input-hand w-14 ml-auto"
              />
            )}
          </li>
        ))}
      </ul>

      <button onClick={runOptimization} disabled={Object.keys(selected).length === 0} className="btn-hand mb-8">
        Optimiser
      </button>

      {result && (
        <div>
          <p className="title-hand text-3xl mb-4">
            {result.storeCount} magasin{result.storeCount > 1 ? 's' : ''} — {result.totalPrice.toFixed(2)} €
          </p>

          <div className="grid sm:grid-cols-2 gap-x-6">
            {result.breakdown.map((b) => (
              <div key={b.store.id} className="card">
                <span className="tape" style={{ background: `${b.store.color ?? '#c98a2c'}55` }} />
                <p className="title-hand text-2xl mb-2">{b.store.name}</p>
                <ul className="text-sm space-y-1 mb-2">
                  {b.items.map((it) => (
                    <li key={it.ingredientId} className="flex justify-between">
                      <span>
                        {it.ingredientName} ×{it.quantity}
                      </span>
                      <span className="text-mustard font-bold">{it.lineTotal.toFixed(2)} €</span>
                    </li>
                  ))}
                </ul>
                <p className="border-t-2 border-dashed border-line pt-2 flex justify-between font-bold">
                  <span>Sous-total</span>
                  <span>{b.subtotal.toFixed(2)} €</span>
                </p>
              </div>
            ))}
          </div>

          {result.missingIngredients.length > 0 && (
            <p className="text-brick mb-4">Introuvable : {result.missingIngredients.join(', ')}</p>
          )}

          {!saved ? (
            <button onClick={saveList} className="btn-hand">
              Enregistrer cette liste
            </button>
          ) : (
            <p className="title-hand text-2xl text-herb">Liste enregistrée ✓</p>
          )}
        </div>
      )}
    </div>
  );
}
