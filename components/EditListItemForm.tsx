'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, Ingredient } from '@/lib/types';
import { TYPE_SUGGESTIONS } from '@/lib/quantity';

type Props = {
  // Ligne de la liste de courses dont on modifie l'ingrédient
  item: { id: string; ingredient_id: string; quantity: number; expected_price: number | null };
  // Appelée après l'enregistrement, avec le prix de la ligne (inchangé ici, pour recalculer le total)
  onSaved: (lineTotal: number) => void;
};

// Formulaire de modification d'un article de la liste de courses, affiché dans un cadre au-dessus de la page.
// Modifie l'ingrédient (nom, catégorie, marque, type, note). La quantité, le magasin et le prix
// se règlent directement sur le ticket de la liste.
export default function EditListItemForm({ item, onSaved }: Props) {
  const [ingredient, setIngredient] = useState<Ingredient | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Chargement de l'ingrédient et des listes de choix
  useEffect(() => {
    Promise.all([
      supabase.from('ingredients').select('*').eq('id', item.ingredient_id).single(),
      supabase.from('categories').select('*').order('name'),
      supabase.from('brands').select('*').order('name')
    ]).then(([{ data: ing, error }, { data: cats }, { data: brs }]) => {
      if (error || !ing) {
        console.error(error);
        setErrorMessage("Impossible de charger cet ingrédient.");
        return;
      }
      const loaded = ing as Ingredient;
      setIngredient(loaded);
      setName(loaded.name);
      setCategoryId(loaded.category_id ?? '');
      setBrandId(loaded.brand_id ?? '');
      setType(loaded.type ?? '');
      setNote(loaded.note ?? '');
      setCategories(cats ?? []);
      setBrands(brs ?? []);
    });
  }, [item.ingredient_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !ingredient) return;
    setSaving(true);
    setErrorMessage('');

    const { error: ingError } = await supabase
      .from('ingredients')
      .update({
        name: name.trim(),
        category_id: categoryId || null,
        brand_id: brandId || null,
        type: type.trim() || null,
        note: note.trim() || null
      })
      .eq('id', ingredient.id);
    if (ingError) {
      console.error(ingError);
      setErrorMessage(ingError.message);
      return setSaving(false);
    }

    setSaving(false);
    onSaved(item.expected_price ?? 0);
  }

  if (!ingredient) return <p className="opacity-70">{errorMessage || 'Chargement...'}</p>;

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      <div>
        <label className="field-label">Nom</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input-hand" />
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
        <label className="field-label">Marque</label>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-hand">
          <option value="">—</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.rating != null ? ` (${b.rating}/5)` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label">Type</label>
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="pièce, kg..."
          list="edit-item-types"
          className="input-hand"
        />
        <datalist id="edit-item-types">
          {TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="field-label">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bio de préférence" className="input-hand" />
      </div>
      {errorMessage && <p className="col-span-full text-sm text-brick">{errorMessage}</p>}

      <button type="submit" disabled={saving || !name.trim()} className="btn-hand">
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  );
}
