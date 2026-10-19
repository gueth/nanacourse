'use client';

import { useState } from 'react';
import { TYPE_SUGGESTIONS } from '@/lib/quantity';
import type { Brand, Category, Store } from '@/lib/types';
import { createIngredient } from '@/lib/ingredients';
import StoreOptions from '@/components/StoreOptions';
import ScanLabelButton from '@/components/ScanLabelButton';


type Props = {
  // Nom pré-rempli (ex : le texte tapé dans la recherche)
  initialName?: string;
  categories: Category[];
  brands: Brand[];
  stores: Store[];
  // Appelée une fois l'ingrédient créé
  onCreated: () => void;
};

// Formulaire complet de création d'un ingrédient, affiché dans la fenêtre modale des paramètres.
export default function NewIngredientForm({ initialName = '', categories, brands, stores, onCreated }: Props) {
  const [name, setName] = useState(initialName);
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [storeId, setStoreId] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const id = await createIngredient(
      { name, note, category_id: categoryId, brand_id: brandId, type },
      storeId || undefined,
      price ? Number(price) : undefined
    );
    setSaving(false);
    if (id) onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      {/* Photo de l'étiquette : remplit le nom et le prix lus dessus */}
      <div className="col-span-full">
        <ScanLabelButton
          onResult={(r) => {
            if (r.name) setName(r.name);
            if (r.price != null) setPrice(String(r.price));
            // Seul un prix au kilo affiché : produit en vrac
            if (r.type) setType(r.type);
          }}
        />
      </div>
      <div>
        <label className="field-label">Nom</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tomates cerises" className="input-hand" />
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
          list="new-ingredient-types"
          className="input-hand w-32"
        />
        <datalist id="new-ingredient-types">
          {TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="field-label">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bio de préférence" className="input-hand w-48" />
      </div>
      <div>
        <label className="field-label">Magasin</label>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-hand">
          <option value="">—</option>
          {/* Magasins regroupés par enseigne */}
          <StoreOptions stores={stores} />
        </select>
      </div>
      <div>
        <label className="field-label">Prix (€)</label>
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="2.50" className="input-hand w-24" />
      </div>
      <button type="submit" disabled={saving || !name.trim()} className="btn-hand">
        {saving ? 'Ajout...' : 'Ajouter'}
      </button>
    </form>
  );
}
