'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { IngredientPrice, Store } from '@/lib/types';

type Props = {
  ingredientId: string;
  stores: Store[];
  prices: (IngredientPrice & { store: Store })[];
  onChange: () => void;
};

export default function PriceEditor({ ingredientId, stores, prices, onChange }: Props) {
  const [storeId, setStoreId] = useState('');
  const [price, setPrice] = useState('');

  const usedStoreIds = new Set(prices.map((p) => p.store_id));
  const availableStores = stores.filter((s) => !usedStoreIds.has(s.id));

  async function addPrice() {
    if (!storeId || !price) return;
    const { error } = await supabase
      .from('ingredient_prices')
      .insert({ ingredient_id: ingredientId, store_id: storeId, price: Number(price), available: true });
    if (error) return console.error(error);
    setStoreId('');
    setPrice('');
    onChange();
  }

  async function removePrice(id: string) {
    const { error } = await supabase.from('ingredient_prices').delete().eq('id', id);
    if (error) console.error(error);
    else onChange();
  }

  return (
    <div className="mt-3 pl-3 border-l-2 border-dashed border-line">
      <p className="field-label mb-1">Prix par magasin</p>
      <ul className="space-y-1 mb-2 text-sm">
        {prices.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <span className="w-28">{p.store.name}</span>
            <span className="text-mustard font-bold">{p.price} €</span>
            <button onClick={() => removePrice(p.id)} className="btn-ghost text-xs">
              retirer
            </button>
          </li>
        ))}
      </ul>
      {availableStores.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-hand">
            <option value="">Magasin...</option>
            {availableStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="prix" className="input-hand w-20" />
          <button onClick={addPrice} className="btn-ghost">
            + ajouter
          </button>
        </div>
      )}
    </div>
  );
}
