'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import StoreOptions from '@/components/StoreOptions';
import type { Brand, Category, IngredientWithRelations, Store } from '@/lib/types';
import { createIngredient } from '@/lib/ingredients';
import { normalizeQuantity, quantityRule } from '@/lib/quantity';
import ScanLabelButton from '@/components/ScanLabelButton';
import { refreshListTotal } from '@/lib/lists';

type Props = {
  // Listes en attente dans lesquelles on peut ajouter l'article
  lists: { id: string; name: string }[];
  // Appelée une fois l'article ajouté
  onAdded: () => void;
};

const TYPE_SUGGESTIONS = ['pièce', 'kg', 'g', 'litre', 'paquet', 'conserve', 'bouteille'];

// Formulaire d'ajout d'un ingrédient à une liste de courses (active ou non).
// Tous les champs sont modifiables, que l'ingrédient soit nouveau ou déjà connu :
//  - nouveau nom : l'ingrédient est aussi créé dans la liste des ingrédients ;
//  - ingrédient connu : ses valeurs sont pré-remplies, et celles qu'on change
//    (catégorie, marque, type, prix dans le magasin choisi) sont enregistrées sur l'ingrédient.
export default function AddToListForm({ lists, onAdded }: Props) {
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [storeId, setStoreId] = useState('');
  const [price, setPrice] = useState('');
  // Par défaut : la liste la plus récente (la première, triée par id décroissant)
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  // Chargement des ingrédients, catégories, marques et magasins à l'ouverture du cadre
  useEffect(() => {
    Promise.all([
      supabase.from('ingredients').select('*, brand:brands(*), prices:ingredient_prices(*, store:stores(*))').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      supabase.from('stores').select('*').order('name')
    ]).then(([{ data: ings, error }, { data: cats }, { data: brs }, { data: sts }]) => {
      if (error) console.error(error);
      setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setStores(sts ?? []);
    });
  }, []);

  // Ingrédient existant qui porte exactement ce nom (sans tenir compte des majuscules)
  const existing = useMemo(
    () => ingredients.find((i) => i.name.toLowerCase() === name.trim().toLowerCase()) ?? null,
    [ingredients, name]
  );

  // Quantités possibles selon le type saisi (kg, pièce, paquet...)
  const rule = quantityRule(type);

  // Quand on choisit un ingrédient connu, on pré-remplit ses informations et son prix le moins cher
  // (tout reste modifiable ensuite)
  function handleNameChange(value: string) {
    setName(value);
    const match = ingredients.find((i) => i.name.toLowerCase() === value.trim().toLowerCase());
    if (match) {
      setCategoryId(match.category_id ?? '');
      setBrandId(match.brand_id ?? '');
      setType(match.type ?? '');
    }
    const cheapest = match?.prices.slice().sort((a, b) => a.price - b.price)[0];
    if (cheapest) {
      setStoreId(cheapest.store_id);
      setPrice(String(cheapest.price));
    }
  }

  // Quand on change de magasin pour un ingrédient connu, on reprend le prix de ce magasin
  function handleStoreChange(value: string) {
    setStoreId(value);
    const p = existing?.prices.find((pr) => pr.store_id === value);
    if (p) setPrice(String(p.price));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Quantité ramenée sur une valeur possible pour le type (ex : pas de 0,5 pièce)
    const qty = normalizeQuantity(Number(quantity.replace(',', '.')), rule);
    const unitPrice = price ? Number(price) : 0;
    if (!name.trim()) return;
    setSaving(true);

    // 1. L'ingrédient : on réutilise celui qui existe (en enregistrant ce qui a changé), sinon on le crée
    let ingredientId = existing?.id ?? null;
    if (!existing) {
      ingredientId = await createIngredient(
        { name, category_id: categoryId, brand_id: brandId, type },
        storeId || undefined,
        price ? unitPrice : undefined
      );
    } else {
      // Catégorie, marque ou type modifiés : mise à jour de l'ingrédient
      const changes = {
        category_id: categoryId || null,
        brand_id: brandId || null,
        type: type.trim() || null
      };
      if (
        changes.category_id !== existing.category_id ||
        changes.brand_id !== existing.brand_id ||
        changes.type !== existing.type
      ) {
        const { error } = await supabase.from('ingredients').update(changes).eq('id', existing.id);
        if (error) console.error(error);
      }
      // Prix dans le magasin choisi : ajouté s'il est nouveau, mis à jour s'il a changé
      const known = existing.prices.find((p) => p.store_id === storeId);
      if (storeId && price) {
        const { error } = known
          ? known.price !== unitPrice
            ? await supabase.from('ingredient_prices').update({ price: unitPrice }).eq('id', known.id)
            : { error: null }
          : await supabase
              .from('ingredient_prices')
              .insert({ ingredient_id: existing.id, store_id: storeId, price: unitPrice, available: true });
        if (error) console.error(error);
      }
    }
    if (!ingredientId) return setSaving(false);

    // 2. La liste : celle choisie, ou une nouvelle s'il n'y en a aucune en attente
    let targetListId = listId;
    if (!targetListId) {
      const { data: created, error } = await supabase
        .from('shopping_lists')
        // Une nouvelle liste est toujours créée désactivée (on l'active dans Paramètres > Listes de courses)
        .insert({ name: 'Liste de courses', estimated_price: 0, is_active: false })
        .select()
        .single();
      if (error || !created) {
        console.error(error);
        return setSaving(false);
      }
      targetListId = created.id;
    }

    // 3. L'article dans la liste (prix de la ligne = prix unitaire × quantité)
    const lineTotal = unitPrice * qty;
    const { error: itemError } = await supabase.from('shopping_list_items').insert({
      shopping_list_id: targetListId,
      ingredient_id: ingredientId,
      quantity: qty,
      expected_price: lineTotal,
      store_id: storeId || null
    });
    if (itemError) {
      console.error(itemError);
      return setSaving(false);
    }

    // 4. Mise à jour du total estimé de la liste (relu dans la base, donc toujours à jour)
    await refreshListTotal(targetListId);

    setSaving(false);
    onAdded();
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      {/* Photo de l'étiquette : remplit le nom (et le magasin d'un ingrédient connu), puis le prix lu */}
      <div className="col-span-full">
        <ScanLabelButton
          onResult={(r) => {
            if (r.name) handleNameChange(r.name);
            if (r.price != null) setPrice(String(r.price));
          }}
        />
      </div>
      <div>
        <label className="field-label">Ingrédient</label>
        {/* list= : propose les ingrédients existants pendant la saisie, mais on peut taper un nouveau nom */}
        <input
          autoFocus
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          list="add-to-list-ingredients"
          placeholder="Tomates cerises"
          className="input-hand"
        />
        <datalist id="add-to-list-ingredients">
          {ingredients.map((i) => (
            <option key={i.id} value={i.name} />
          ))}
        </datalist>
      </div>
      <div>
        {/* Pas et minimum selon le type saisi (pièces entières par défaut) */}
        <label className="field-label">Quantité ({rule.unit})</label>
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          type="number"
          inputMode="decimal"
          min={rule.min}
          step={rule.step}
          className="input-hand w-16"
        />
      </div>

      {/* Type, catégorie et marque : toujours modifiables.
          Pré-remplis pour un ingrédient connu ; les changements sont enregistrés sur l'ingrédient. */}
      <div>
        <label className="field-label">Type</label>
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          list="add-to-list-types"
          placeholder="pièce, kg, paquet..."
          className="input-hand"
        />
        <datalist id="add-to-list-types">
          {TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
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
        <label className="field-label">Magasin</label>
        <select value={storeId} onChange={(e) => handleStoreChange(e.target.value)} className="input-hand">
          <option value="">—</option>
          {/* Magasins regroupés par enseigne */}
          <StoreOptions stores={stores} />
        </select>
      </div>
      <div>
        <label className="field-label">Prix unitaire (€, optionnel)</label>
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="inconnu" className="input-hand w-24" />
      </div>

      {/* Choix de la liste, seulement s'il y en a plusieurs en attente */}
      {lists.length > 1 && (
        <div>
          <label className="field-label">Liste</label>
          <select value={listId} onChange={(e) => setListId(e.target.value)} className="input-hand">
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {name.trim() && !existing && (
        <p className="text-sm opacity-70 w-full">« {name.trim()} » n&apos;existe pas encore : il sera aussi ajouté à tes ingrédients.</p>
      )}
      {lists.length === 0 && <p className="text-sm opacity-70 w-full">Aucune liste active : une nouvelle liste sera créée, désactivée (active-la dans Paramètres › Listes de courses).</p>}

      <button type="submit" disabled={saving || !name.trim()} className="btn-hand">
        {saving ? 'Ajout...' : 'Ajouter à la liste'}
      </button>
    </form>
  );
}
