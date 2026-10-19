'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, IngredientWithRelations } from '@/lib/types';
import { createIngredient, saveIngredientPrice } from '@/lib/ingredients';
import { normalizeQuantity, quantityRule, TYPE_SUGGESTIONS } from '@/lib/quantity';
import { storeLabel, STORE_SELECT } from '@/lib/stores';
import ScanLabelButton from '@/components/ScanLabelButton';
import { refreshListTotal } from '@/lib/lists';

type Props = {
  // Listes dans lesquelles on peut ajouter l'article, avec le magasin choisi pour chacune
  lists: { id: string; name: string; store_id?: string | null }[];
  // Appelée une fois l'article ajouté
  onAdded: () => void;
};

// Formulaire d'ajout d'un ingrédient à une liste de courses (active ou non).
// Seul le nom est obligatoire, tout le reste est facultatif :
//  - nouveau nom : l'ingrédient est aussi créé dans la liste des ingrédients ;
//  - ingrédient connu : ses valeurs sont pré-remplies, et celles qu'on change
//    (catégorie, marque, type) sont enregistrées sur l'ingrédient.
// Pas de choix de magasin ici : le prix proposé est celui du magasin choisi pour la liste
// (ligne "Magasin" du ticket), ou, sans magasin, le prix le plus haut connu pour l'ingrédient.
export default function AddToListForm({ lists, onAdded }: Props) {
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [storeName, setStoreName] = useState('');

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [price, setPrice] = useState('');
  // Par défaut : la liste la plus récente (la première, triée par id décroissant)
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  // Magasin choisi pour la liste visée ('' = aucun)
  const storeId = lists.find((l) => l.id === listId)?.store_id ?? '';
  const [saving, setSaving] = useState(false);

  // Chargement des ingrédients, catégories, marques et magasins à l'ouverture du cadre
  useEffect(() => {
    Promise.all([
      supabase.from('ingredients').select(`*, brand:brands(*), prices:ingredient_prices(*, store:stores(${STORE_SELECT}))`).order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      storeId ? supabase.from('stores').select(STORE_SELECT).eq('id', storeId).maybeSingle() : Promise.resolve({ data: null })
    ]).then(([{ data: ings, error }, { data: cats }, { data: brs }, { data: store }]) => {
      if (error) console.error(error);
      setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setStoreName(store ? storeLabel(store) : '');
    });
  }, [storeId]);

  // Ingrédient existant qui porte exactement ce nom (sans tenir compte des majuscules)
  const existing = useMemo(
    () => ingredients.find((i) => i.name.toLowerCase() === name.trim().toLowerCase()) ?? null,
    [ingredients, name]
  );

  // Quantités possibles selon le type saisi (kg, pièce, paquet...)
  const rule = quantityRule(type);

  // Prix proposé pour un ingrédient connu : celui du magasin de la liste s'il est connu,
  // sinon (aucun magasin, ou prix inconnu dans ce magasin) le plus haut de ses prix
  function suggestedPrice(ing: IngredientWithRelations) {
    const inStore = storeId ? ing.prices.find((p) => p.store_id === storeId) : undefined;
    if (inStore) return inStore.price;
    return ing.prices.length > 0 ? Math.max(...ing.prices.map((p) => p.price)) : null;
  }

  // Quand on choisit un ingrédient connu, on pré-remplit ses informations et son prix
  // (tout reste modifiable ensuite)
  function handleNameChange(value: string) {
    setName(value);
    const match = ingredients.find((i) => i.name.toLowerCase() === value.trim().toLowerCase());
    if (match) {
      setCategoryId(match.category_id ?? '');
      setBrandId(match.brand_id ?? '');
      setType(match.type ?? '');
      const p = suggestedPrice(match);
      setPrice(p != null ? String(p) : '');
    }
  }

  // Origine du prix proposé, affichée sous le champ prix
  const priceSource = existing
    ? storeId && existing.prices.some((p) => p.store_id === storeId)
      ? `prix chez ${storeName || 'le magasin de la liste'}`
      : existing.prices.length > 0
        ? 'prix le plus haut connu'
        : ''
    : '';

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
      // Prix saisi, mémorisé pour le magasin de la liste (s'il y en a un) : ajouté s'il est nouveau, mis à jour sinon
      if (storeId && price) {
        const error = await saveIngredientPrice(existing.id, storeId, unitPrice);
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

    // 3. L'article dans la liste (prix de la ligne = prix unitaire × quantité).
    // Si l'ingrédient y est déjà, on ne crée pas de doublon : sa quantité augmente et son prix est recalculé
    // (avec le prix unitaire saisi, ou à défaut celui déjà connu sur la ligne).
    const { data: existingItem, error: readError } = await supabase
      .from('shopping_list_items')
      .select('id, quantity, expected_price, store_id')
      .eq('shopping_list_id', targetListId)
      .eq('ingredient_id', ingredientId)
      .limit(1)
      .maybeSingle();
    if (readError) {
      console.error(readError);
      return setSaving(false);
    }

    let itemError;
    if (existingItem) {
      const newQty = Math.round((Number(existingItem.quantity) + qty) * 1000) / 1000;
      const knownUnit = existingItem.expected_price ? Number(existingItem.expected_price) / Number(existingItem.quantity) : 0;
      const unit = unitPrice > 0 ? unitPrice : knownUnit;
      ({ error: itemError } = await supabase
        .from('shopping_list_items')
        .update({
          quantity: newQty,
          expected_price: Math.round(unit * newQty * 100) / 100,
          store_id: storeId || existingItem.store_id
        })
        .eq('id', existingItem.id));
    } else {
      ({ error: itemError } = await supabase.from('shopping_list_items').insert({
        shopping_list_id: targetListId,
        ingredient_id: ingredientId,
        quantity: qty,
        expected_price: unitPrice * qty,
        store_id: storeId || null
      }));
    }
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
            // Seul un prix au kilo affiché : produit en vrac
            if (r.type) setType(r.type);
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
        <label className="field-label">Prix unitaire (€)</label>
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="inconnu" className="input-hand w-24" />
        {/* D'où vient le prix proposé : magasin de la liste, ou prix le plus haut connu */}
        {priceSource && <p className="text-xs opacity-60 mt-1">{priceSource}</p>}
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

      <p className="col-span-full text-xs opacity-60">Seul le nom est obligatoire, le reste est facultatif.</p>
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
