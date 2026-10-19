'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, Ingredient } from '@/lib/types';
import { TYPE_SUGGESTIONS } from '@/lib/quantity';
import type { PendingChanges } from '@/lib/pending';

type Props = {
  // Ligne de la liste de courses dont on modifie l'ingrédient (avec ses modifications déjà en attente)
  item: { id: string; ingredient_id: string; quantity: number; expected_price: number | null; pending?: PendingChanges | null };
  // Appelée après l'enregistrement, avec le prix de la ligne (inchangé ici, pour recalculer le total)
  onSaved: (lineTotal: number) => void;
};

// Formulaire de modification d'un article de la liste de courses, affiché dans un cadre au-dessus de la page.
// Modifie les informations de l'ingrédient (nom, catégorie, marque, type, note), mais seulement
// "en attente" sur la ligne de la liste : elles ne sont appliquées à l'ingrédient qu'à la validation de la liste.
// La quantité, le magasin et le prix se règlent directement sur le ticket de la liste.
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
      // Valeurs affichées : celles déjà modifiées (en attente) sur cette ligne, sinon celles de l'ingrédient
      const p = item.pending ?? {};
      setName(p.name ?? loaded.name);
      setCategoryId((p.category_id !== undefined ? p.category_id : loaded.category_id) ?? '');
      setBrandId((p.brand_id !== undefined ? p.brand_id : loaded.brand_id) ?? '');
      setType((p.type !== undefined ? p.type : loaded.type) ?? '');
      setNote((p.note !== undefined ? p.note : loaded.note) ?? '');
      setCategories(cats ?? []);
      setBrands(brs ?? []);
    });
  }, [item.ingredient_id, item.pending]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !ingredient) return;
    setSaving(true);
    setErrorMessage('');

    // Seules les valeurs différentes de l'ingrédient sont gardées en attente (le prix modifié reste noté)
    const values = {
      name: name.trim(),
      category_id: categoryId || null,
      brand_id: brandId || null,
      type: type.trim() || null,
      note: note.trim() || null
    };
    const pending: PendingChanges = item.pending?.price_changed ? { price_changed: true } : {};
    if (values.name !== ingredient.name) pending.name = values.name;
    if (values.category_id !== ingredient.category_id) pending.category_id = values.category_id;
    if (values.brand_id !== ingredient.brand_id) pending.brand_id = values.brand_id;
    if (values.type !== ingredient.type) pending.type = values.type;
    if (values.note !== ingredient.note) pending.note = values.note;

    const { error } = await supabase
      .from('shopping_list_items')
      .update({ pending: Object.keys(pending).length > 0 ? pending : null })
      .eq('id', item.id);
    if (error) {
      console.error(error);
      setErrorMessage(
        error.code === '42703' || error.code === 'PGRST204'
          ? 'La colonne « pending » manque dans la table shopping_list_items : lance le SQL fourni dans Supabase.'
          : error.message
      );
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
      <p className="col-span-full text-xs opacity-60">
        Ces modifications s&apos;appliqueront à l&apos;ingrédient quand la liste sera validée.
      </p>

      <button type="submit" disabled={saving || !name.trim()} className="btn-hand">
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  );
}
