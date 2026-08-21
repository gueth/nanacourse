'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Ingredient, InventoryRow } from '@/lib/types';

type Row = InventoryRow & { ingredient: Ingredient };

export default function InventoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('1');

  async function loadAll() {
    const [{ data: inv }, { data: ings }] = await Promise.all([
      supabase.from('inventory').select('*, ingredient:ingredients(*)').order('updated_at', { ascending: false }),
      supabase.from('ingredients').select('*').order('name')
    ]);
    setRows((inv as unknown as Row[]) ?? []);
    setIngredients(ings ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) return;
    const { error } = await supabase
      .from('inventory')
      .upsert({ ingredient_id: ingredientId, quantity: Number(quantity), updated_at: new Date().toISOString() }, { onConflict: 'ingredient_id' });
    if (error) return console.error(error);
    setIngredientId('');
    setQuantity('1');
    loadAll();
  }

  async function toggleLowStock(id: string, current: boolean) {
    const { error } = await supabase.from('inventory').update({ low_stock: !current }).eq('id', id);
    if (error) console.error(error);
    else loadAll();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('inventory').delete().eq('id', id);
    if (error) console.error(error);
    else loadAll();
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      <h1 className="title-hand text-4xl mb-1">Inventaire</h1>
      <p className="opacity-70 mb-6">Ce qu'il te reste à la maison.</p>

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-4">
        <span className="tape" />
        <div>
          <label className="field-label">Ingrédient</label>
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="input-hand">
            <option value="">—</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Quantité</label>
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min={0} className="input-hand w-20" />
        </div>
        <button type="submit" className="btn-hand">
          Mettre à jour
        </button>
      </form>

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="card flex items-center justify-between">
            <span className="tape" />
            <span className="flex items-center gap-3">
              {r.low_stock && <span className="text-brick font-bold">⚠</span>}
              <span className="text-lg">{r.ingredient.name}</span>
              <span className="text-sm opacity-60">quantité : {r.quantity}</span>
            </span>
            <span className="flex gap-3">
              <button onClick={() => toggleLowStock(r.id, r.low_stock)} className="btn-ghost">
                {r.low_stock ? 'suffisant' : 'stock faible'}
              </button>
              <button onClick={() => handleDelete(r.id)} className="btn-ghost">
                supprimer
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
