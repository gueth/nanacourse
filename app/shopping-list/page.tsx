'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { IngredientWithRelations, Store } from '@/lib/types';
import { optimizeShoppingList, type ShoppingItem, type OptimizationResult } from '@/lib/optimize';
import { SwipePages } from '@/components/SwipePages';

type InventoryStatus = { quantity: number; low_stock: boolean };

function cheapestPrice(ing: IngredientWithRelations) {
  const available = ing.prices.filter((p) => p.available);
  if (available.length === 0) return null;
  return Math.min(...available.map((p) => p.price));
}

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
        .select('*, category:categories(*), brand:brands(*), prices:ingredient_prices(*, store:stores(*))')
        .order('name'),
      supabase.from('stores').select('*'),
      supabase.from('inventory').select('ingredient_id, quantity, low_stock')
    ]).then(([{ data: ings }, { data: sts }, { data: inv }]) => {
      const list = (ings as unknown as IngredientWithRelations[]) ?? [];
      setIngredients(list);
      setStores(sts ?? []);

      const invMap: Record<string, InventoryStatus> = {};
      for (const row of inv ?? []) {
        invMap[row.ingredient_id] = { quantity: row.quantity, low_stock: row.low_stock };
      }

      // INGRÉDIENTS ÉPUISÉS DANS L'INVENTAIRE : présélectionnés automatiquement
      const autoSelected: Record<string, number> = {};
      for (const ing of list) {
        const status = invMap[ing.id];
        if (status && (status.quantity <= 0 || status.low_stock)) autoSelected[ing.id] = 1;
      }
      setSelected(autoSelected);
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

  // REGROUPEMENT PAR CATÉGORIE, AVEC PRIX PAR CATÉGORIE ET PRIX TOTAL
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, { name: string; items: IngredientWithRelations[] }>();
    for (const ing of ingredients) {
      const key = ing.category?.id ?? 'none';
      const name = ing.category?.name ?? 'Sans catégorie';
      if (!groups.has(key)) groups.set(key, { name, items: [] });
      groups.get(key)!.items.push(ing);
    }
    return Array.from(groups.values()).map((g) => {
      const subtotal = g.items.reduce((sum, ing) => {
        if (!(ing.id in selected)) return sum;
        const price = cheapestPrice(ing);
        return price != null ? sum + price * selected[ing.id] : sum;
      }, 0);
      return { ...g, subtotal };
    });
  }, [ingredients, selected]);

  const grandTotal = categoryGroups.reduce((sum, g) => sum + g.subtotal, 0);

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

  const checklistPage = (
    <div>
      <h1 className="title-hand text-4xl mb-1">Liste de courses</h1>
      <p className="opacity-70 mb-6">Coche ce dont tu as besoin, regroupé par catégorie, puis optimise.</p>

      {categoryGroups.map((g) => (
        <div key={g.name} className="card">
          <span className="tape" />
          <p className="title-hand text-xl mb-2">{g.name}</p>
          <ul>
            {g.items.map((ing) => (
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
          <p className="border-t-2 border-dashed border-line mt-2 pt-2 flex justify-between font-bold text-sm">
            <span>Sous-total {g.name.toLowerCase()}</span>
            <span>{g.subtotal.toFixed(2)} €</span>
          </p>
        </div>
      ))}

      <p className="title-hand text-2xl mb-4 flex justify-between">
        <span>Total</span>
        <span>{grandTotal.toFixed(2)} €</span>
      </p>

      <button onClick={runOptimization} disabled={Object.keys(selected).length === 0} className="btn-hand mb-8">
        Optimiser
      </button>
    </div>
  );

  const resultPage = (
    <div>
      <h2 className="title-hand text-4xl mb-1">Résultat</h2>
      <p className="opacity-70 mb-6">Répartition par magasin, enregistrement, et mise en inventaire.</p>

      {!result && <p className="opacity-60">Coche des ingrédients puis appuie sur « Optimiser » pour voir le résultat ici.</p>}

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

          <div className="flex flex-wrap gap-3 items-center">
            {!saved ? (
              <button onClick={saveList} className="btn-hand">
                Enregistrer cette liste
              </button>
            ) : (
              <p className="title-hand text-2xl text-herb">
                Liste enregistrée ✓ — retrouve-la sur la page Course pour la valider.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return <SwipePages pages={[checklistPage, resultPage]} labels={['Liste à cocher', 'Résultat']} />;
}
