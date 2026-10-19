'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, IngredientWithRelations, Store } from '@/lib/types';
import StoreOptions from '@/components/StoreOptions';
import { saveIngredientPrice } from '@/lib/ingredients';
import { formatQuantity, normalizeQuantity, quantityRule, TYPE_SUGGESTIONS } from '@/lib/quantity';


type Props = {
  // Ligne de la liste de courses à modifier
  item: { id: string; ingredient_id: string; quantity: number; expected_price: number | null };
  // Appelée après l'enregistrement, avec le nouveau prix de la ligne (pour recalculer le total)
  onSaved: (lineTotal: number) => void;
};

// Formulaire de modification d'un article de la liste de courses, affiché dans un cadre au-dessus de la page.
// Modifie à la fois l'ingrédient (nom, catégorie, marque, type, note) et la ligne de la liste
// (quantité, magasin, prix). Le prix est aussi mémorisé pour ce magasin dans les prix de l'ingrédient.
export default function EditListItemForm({ item, onSaved }: Props) {
  const [ingredient, setIngredient] = useState<IngredientWithRelations | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [storeId, setStoreId] = useState('');
  // Prix unitaire, déduit du prix de la ligne (prix de la ligne = prix unitaire × quantité)
  const [unitPrice, setUnitPrice] = useState(
    item.expected_price ? String(Math.round((item.expected_price / item.quantity) * 100) / 100) : ''
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Chargement de l'ingrédient (avec ses prix), du magasin de la ligne et des listes de choix
  useEffect(() => {
    Promise.all([
      supabase.from('ingredients').select('*, prices:ingredient_prices(*, store:stores(*))').eq('id', item.ingredient_id).single(),
      supabase.from('shopping_list_items').select('store_id').eq('id', item.id).single(),
      supabase.from('categories').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      supabase.from('stores').select('*').order('name')
    ]).then(([{ data: ing, error }, { data: row }, { data: cats }, { data: brs }, { data: sts }]) => {
      if (error || !ing) {
        console.error(error);
        setErrorMessage("Impossible de charger cet ingrédient.");
        return;
      }
      const loaded = ing as unknown as IngredientWithRelations;
      setIngredient(loaded);
      setName(loaded.name);
      setCategoryId(loaded.category_id ?? '');
      setBrandId(loaded.brand_id ?? '');
      setType(loaded.type ?? '');
      setNote(loaded.note ?? '');
      setStoreId(row?.store_id ?? '');
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setStores(sts ?? []);
    });
  }, [item.id, item.ingredient_id]);

  // Quantités possibles selon le type choisi (ex : 0,1 kg ou pièces entières)
  const rule = quantityRule(type);
  const qtyValue = Number(quantity.replace(',', '.'));
  const lineTotal = unitPrice && Number.isFinite(qtyValue) ? Number(unitPrice) * qtyValue : null;

  // Changement de magasin : on reprend le prix connu de l'ingrédient dans ce magasin
  function handleStoreChange(value: string) {
    setStoreId(value);
    const p = ingredient?.prices.find((pr) => pr.store_id === value);
    if (p) setUnitPrice(String(p.price));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !ingredient) return;
    setSaving(true);
    setErrorMessage('');

    // 1. L'ingrédient
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

    // 2. La ligne de la liste : quantité ramenée sur une valeur possible, prix de la ligne recalculé
    const qty = normalizeQuantity(qtyValue, rule);
    const unit = unitPrice ? Number(unitPrice) : 0;
    const newLineTotal = unit * qty;
    const { error: itemError } = await supabase
      .from('shopping_list_items')
      .update({ quantity: qty, expected_price: newLineTotal, store_id: storeId || null })
      .eq('id', item.id);
    if (itemError) {
      console.error(itemError);
      setErrorMessage(itemError.message);
      return setSaving(false);
    }

    // 3. Le prix est mémorisé pour ce magasin (mis à jour s'il existait, ajouté sinon)
    if (storeId && unitPrice) {
      const priceError = await saveIngredientPrice(ingredient.id, storeId, unit);
      if (priceError) console.error(priceError);
    }

    setSaving(false);
    onSaved(newLineTotal);
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
      <div>
        <label className="field-label">Quantité ({rule.unit})</label>
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          type="number"
          inputMode="decimal"
          step={rule.step}
          min={rule.min}
          className="input-hand"
        />
      </div>
      <div>
        <label className="field-label">Magasin</label>
        <select value={storeId} onChange={(e) => handleStoreChange(e.target.value)} className="input-hand">
          <option value="">—</option>
          {/* Magasins regroupés par enseigne */}
          <StoreOptions stores={stores} />
        </select>
      </div>
      <div>
        <label className="field-label">Prix unitaire (€)</label>
        <input
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          type="number"
          step="0.01"
          placeholder="inconnu"
          className="input-hand"
        />
      </div>

      {/* Prix de la ligne, recalculé pendant la saisie */}
      <p className="col-span-full text-sm opacity-70">
        {lineTotal != null
          ? `Prix de la ligne : ${formatQuantity(normalizeQuantity(qtyValue, rule))} ${rule.unit} × ${Number(unitPrice).toFixed(2)} € = ${(
              Number(unitPrice) * normalizeQuantity(qtyValue, rule)
            ).toFixed(2)} €`
          : 'Prix inconnu : le total de la liste ne le comptera pas.'}
      </p>
      {errorMessage && <p className="col-span-full text-sm text-brick">{errorMessage}</p>}

      <button type="submit" disabled={saving || !name.trim()} className="btn-hand">
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  );
}
