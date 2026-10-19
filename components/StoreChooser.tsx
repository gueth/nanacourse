'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { storeLabel } from '@/lib/stores';
import { applyStoreToList } from '@/lib/lists';
import type { Store } from '@/lib/types';

type Item = { id: string; ingredient_id: string; quantity: number; expected_price: number | null };

type Props = {
  listId: string;
  items: Item[];
  // Magasin actuellement choisi pour la liste (mis en avant)
  currentStoreId: string | null;
  // Appelée une fois le magasin choisi et les prix mis à jour
  onChosen: () => void;
};

// Cadre de choix du magasin où l'on fait les courses d'une liste.
// Chaque magasin affiche le prix total de la liste si on y allait : prix du magasin pour les articles
// dont il est connu, prix actuel de la ligne pour les autres. Les magasins sont rangés du moins cher au plus cher.
// Choisir un magasin remplace automatiquement le prix de chaque article dont le prix y est connu.
export default function StoreChooser({ listId, items, currentStoreId, onChosen }: Props) {
  const [stores, setStores] = useState<Store[]>([]);
  const [prices, setPrices] = useState<{ ingredient_id: string; store_id: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const ingredientIds = Array.from(new Set(items.map((i) => i.ingredient_id)));
    Promise.all([
      supabase.from('stores').select('*').order('name'),
      supabase
        .from('ingredient_prices')
        .select('ingredient_id, store_id, price')
        .eq('available', true)
        .in('ingredient_id', ingredientIds)
    ]).then(([{ data: sts, error: storesError }, { data: prs, error: pricesError }]) => {
      if (storesError || pricesError) console.error(storesError ?? pricesError);
      setStores(sts ?? []);
      setPrices(prs ?? []);
      setLoading(false);
    });
  }, [items]);

  // Prix unitaire d'un ingrédient dans un magasin
  const unitPrice = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prices) map.set(`${p.ingredient_id}|${p.store_id}`, p.price);
    return map;
  }, [prices]);

  // Total de la liste dans chaque magasin, et nombre d'articles dont le prix y est connu
  const ranked = useMemo(
    () =>
      stores
        .map((store) => {
          let known = 0;
          let total = 0;
          for (const item of items) {
            const price = unitPrice.get(`${item.ingredient_id}|${store.id}`);
            if (price != null) {
              known += 1;
              total += price * item.quantity;
            } else total += item.expected_price ?? 0;
          }
          return { store, known, total };
        })
        // Du moins cher au plus cher ; les magasins sans aucun prix connu à la fin
        .sort((a, b) => Number(a.known === 0) - Number(b.known === 0) || a.total - b.total),
    [stores, items, unitPrice]
  );

  // CHOIX D'UN MAGASIN : prix connus appliqués aux articles, magasin enregistré sur la liste, total recalculé
  async function choose(storeId: string | null) {
    setSaving(true);
    setError('');
    const failed = await applyStoreToList(listId, items, storeId, unitPrice);
    setSaving(false);
    if (failed) {
      console.error(failed);
      return setError(
        failed.code === '42703'
          ? 'La colonne « store_id » manque dans la table shopping_lists (voir le SQL à lancer dans Supabase).'
          : failed.message
      );
    }
    onChosen();
  }

  if (loading) return <p className="opacity-70">Chargement...</p>;
  if (stores.length === 0) return <p className="opacity-70">Aucun supermarché enregistré (Paramètres › Supermarchés).</p>;

  return (
    <div>
      <p className="text-sm opacity-70 mb-3">
        Prix total de ta liste dans chaque magasin. En choisissant un magasin, le prix de chaque article dont il est connu
        y est automatiquement appliqué.
      </p>
      <ul className="divide-y-2 divide-dashed divide-line mb-4">
        {ranked.map(({ store, known, total }) => {
          const current = store.id === currentStoreId;
          return (
            <li key={store.id}>
              <button
                onClick={() => choose(store.id)}
                disabled={saving}
                className={`w-full flex items-center justify-between gap-3 py-2 px-2 text-left hover:bg-paper disabled:opacity-50 ${current ? 'font-bold' : ''}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full border border-ink shrink-0" style={{ background: store.color ?? '#ccc' }} />
                  <span className="truncate">
                    {current && '► '}
                    {storeLabel(store)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block">{total.toFixed(2)} €</span>
                  <span className="block text-xs opacity-60">
                    {known === 0 ? 'aucun prix connu' : `${known}/${items.length} prix connus`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-brick mb-3">{error}</p>}
      {currentStoreId && (
        <button onClick={() => choose(null)} disabled={saving} className="btn-ghost">
          ne plus choisir de magasin
        </button>
      )}
    </div>
  );
}
