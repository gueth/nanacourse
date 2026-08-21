'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Category, IngredientWithRelations, Store } from '@/lib/types';
import PriceEditor from '@/components/PriceEditor';

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState('');

  async function loadAll() {
    const [{ data: cats }, { data: sts }, { data: ings, error }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase
        .from('ingredients')
        .select('*, category:categories(*), prices:ingredient_prices(*, store:stores(*))')
        .order('name')
    ]);
    if (error) console.error(error);
    setCategories(cats ?? []);
    setStores(sts ?? []);
    setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase
      .from('ingredients')
      .insert({ name: name.trim(), note: note.trim() || null, category_id: categoryId || null });
    if (error) return console.error(error);
    setName('');
    setNote('');
    setCategoryId('');
    loadAll();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('ingredients').delete().eq('id', id);
    if (error) console.error(error);
    else loadAll();
  }

  async function handlePhotoUpload(ingredientId: string, file: File) {
    const path = `${ingredientId}-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('ingredient-photos').upload(path, file);
    if (uploadError) return console.error(uploadError);
    const { data } = supabase.storage.from('ingredient-photos').getPublicUrl(path);
    const { error: updateError } = await supabase.from('ingredients').update({ photo_url: data.publicUrl }).eq('id', ingredientId);
    if (updateError) console.error(updateError);
    else loadAll();
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      <h1 className="title-hand text-4xl mb-1">Ingrédients</h1>
      <p className="opacity-70 mb-6">Note, photo, catégorie, prix par magasin.</p>

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-4">
        <span className="tape" />
        <div>
          <label className="field-label">Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tomates cerises" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Catégorie</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-hand">
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bio de préférence" className="input-hand w-48" />
        </div>
        <button type="submit" className="btn-hand">
          Ajouter
        </button>
      </form>

      <ul className="space-y-3">
        {ingredients.map((ing) => (
          <li key={ing.id} className="card">
            <span className="tape" />
            <div className="flex items-center gap-3">
              {ing.photo_url && (
                <img src={ing.photo_url} alt={ing.name} className="w-12 h-12 object-cover rounded border-2 border-ink" />
              )}
              <div className="flex-1">
                <p className="text-lg">
                  <strong>{ing.name}</strong>{' '}
                  <span className="text-sm opacity-60">({ing.category?.name ?? 'sans catégorie'})</span>
                </p>
                {ing.note && <p className="text-sm italic opacity-70">{ing.note}</p>}
              </div>
              <button onClick={() => setExpandedId(expandedId === ing.id ? null : ing.id)} className="btn-ghost">
                {expandedId === ing.id ? 'fermer' : 'photo / prix'}
              </button>
              <button onClick={() => handleDelete(ing.id)} className="btn-ghost">
                supprimer
              </button>
            </div>

            {expandedId === ing.id && (
              <div className="mt-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files?.[0] && handlePhotoUpload(ing.id, e.target.files[0])}
                  className="text-sm mb-2"
                />
                <PriceEditor ingredientId={ing.id} stores={stores} prices={ing.prices} onChange={loadAll} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
