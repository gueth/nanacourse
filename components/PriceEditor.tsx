'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { storeLabel } from '@/lib/stores';
import StoreOptions from '@/components/StoreOptions';
import type { IngredientPrice, Store } from '@/lib/types';
import { Trash2 } from 'lucide-react';
import { IconButton } from '@/components/settings/ui';
import { useConfirm } from '@/components/ConfirmDialog';

type Props = {
  ingredientId: string;
  stores: Store[];
  prices: (IngredientPrice & { store: Store })[];
  onChange: () => void;
};

export default function PriceEditor({ ingredientId, stores, prices, onChange }: Props) {
  const [storeId, setStoreId] = useState('');
  const [price, setPrice] = useState('');
  const [confirm, confirmDialog] = useConfirm();

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

  // Enregistre un nouveau prix quand on quitte le champ (seulement s'il a changé)
  async function updatePrice(id: string, oldPrice: number, raw: string) {
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value === oldPrice) return;
    const { error } = await supabase.from('ingredient_prices').update({ price: value }).eq('id', id);
    if (error) console.error(error);
    else onChange();
  }

  async function removePrice(id: string) {
    const p = prices.find((x) => x.id === id);
    if (!(await confirm('Retirer le prix', `Retirer le prix chez « ${p ? storeLabel(p.store) : 'ce magasin'} » ?`, { confirm: 'Retirer' }))) return;
    const { error } = await supabase.from('ingredient_prices').delete().eq('id', id);
    if (error) console.error(error);
    else onChange();
  }

  return (
    <div className="pl-3 border-l-2 border-dashed border-line">
      {confirmDialog}
      <p className="field-label mb-1">Prix par magasin</p>
      {/* Un prix par ligne : magasin, prix modifiable (enregistré en quittant le champ), retrait */}
      <ul className="mb-3 text-sm">
        {prices.length === 0 && <li className="opacity-60 py-1">Aucun prix pour l&apos;instant.</li>}
        {prices.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate">{storeLabel(p.store)}</span>
            <input
              key={p.price}
              defaultValue={p.price}
              onBlur={(e) => updatePrice(p.id, p.price, e.target.value)}
              type="number"
              inputMode="decimal"
              step="0.01"
              className="input-hand w-20 text-right text-mustard font-bold"
              title="Modifier le prix"
            />
            <span>€</span>
            <IconButton label="Retirer ce prix" onClick={() => removePrice(p.id)} danger>
              <Trash2 size={16} />
            </IconButton>
          </li>
        ))}
      </ul>
      {/* Ajout d'un prix : le magasin sur une ligne, le prix et le bouton sur la suivante */}
      {availableStores.length > 0 && (
        <div className="space-y-2 text-sm">
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-hand w-full">
            <option value="">Ajouter un prix dans un magasin...</option>
            {/* Magasins regroupés par enseigne */}
            <StoreOptions stores={availableStores} />
          </select>
          <div className="flex items-center gap-3">
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="prix"
              className="input-hand w-24"
            />
            <span>€</span>
            <button onClick={addPrice} disabled={!storeId || !price} className="btn-ghost disabled:opacity-40">
              + ajouter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
