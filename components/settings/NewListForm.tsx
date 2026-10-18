'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { IngredientWithRelations } from '@/lib/types';
import { normalizeQuantity, quantityRule } from '@/lib/quantity';

type Props = {
  // Appelée une fois la liste créée (avec l'id de la nouvelle liste)
  onCreated: (listId: string) => void;
};

// Création d'une liste de courses :
//  1. on lui donne un libellé ;
//  2. on coche les ingrédients voulus, rangés par catégorie ;
//  3. pour chaque ingrédient coché, le champ quantité apparaît et doit être rempli ;
//  4. "Créer" enregistre la liste, désactivée, avec ses articles.
// Le prix de chaque article est le prix le moins cher connu pour l'ingrédient (× quantité).
export default function NewListForm({ onCreated }: Props) {
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  // Ingrédients cochés : id de l'ingrédient -> quantité saisie (texte, comme dans un <input>)
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    supabase
      .from('ingredients')
      .select('*, category:categories(*), brand:brands(*), prices:ingredient_prices(*, store:stores(*))')
      .order('name')
      .then(({ data, error }) => {
        if (error) console.error(error);
        setIngredients((data as unknown as IngredientWithRelations[]) ?? []);
        setLoading(false);
      });
  }, []);

  // Ingrédients filtrés par la recherche, puis regroupés par catégorie (catégories par ordre alphabétique)
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, { name: string; items: IngredientWithRelations[] }>();
    for (const ing of ingredients) {
      if (q && !ing.name.toLowerCase().includes(q)) continue;
      const key = ing.category?.id ?? 'none';
      if (!map.has(key)) map.set(key, { name: ing.category?.name ?? 'Sans catégorie', items: [] });
      map.get(key)!.items.push(ing);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, search]);

  const selectedIds = Object.keys(selected);

  // Coche / décoche un ingrédient (quantité vide au départ : elle est à remplir)
  function toggle(id: string) {
    setSelected((s) => {
      const next = { ...s };
      if (id in next) delete next[id];
      else next[id] = '';
      return next;
    });
  }

  // Prix le moins cher connu pour un ingrédient (parmi les magasins où il est disponible)
  function cheapestPrice(ing: IngredientWithRelations) {
    return ing.prices.filter((p) => p.available).sort((a, b) => a.price - b.price)[0] ?? null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');
    if (!name.trim()) return setErrorMessage('Donne un libellé à la liste.');
    // Toutes les quantités des ingrédients cochés doivent être remplies
    const missing = selectedIds.filter((id) => !(Number(selected[id].replace(',', '.')) > 0));
    if (missing.length > 0) return setErrorMessage('Remplis la quantité de chaque ingrédient coché.');

    setSaving(true);

    // Articles de la liste : quantité ramenée sur une valeur possible pour le type, prix le moins cher
    const rows = selectedIds.map((id) => {
      const ing = ingredients.find((i) => i.id === id)!;
      const qty = normalizeQuantity(Number(selected[id].replace(',', '.')), quantityRule(ing.type));
      const best = cheapestPrice(ing);
      return {
        ingredient_id: id,
        quantity: qty,
        expected_price: best ? best.price * qty : 0,
        store_id: best?.store_id ?? null
      };
    });
    const total = rows.reduce((s, r) => s + r.expected_price, 0);

    // 1. La liste, désactivée
    const { data: list, error } = await supabase
      .from('shopping_lists')
      .insert({ name: name.trim(), estimated_price: total, is_active: false })
      .select()
      .single();
    if (error || !list) {
      setSaving(false);
      console.error(error);
      return setErrorMessage(error?.message ?? 'Création impossible.');
    }

    // 2. Ses articles
    if (rows.length > 0) {
      const { error: itemsError } = await supabase
        .from('shopping_list_items')
        .insert(rows.map((r) => ({ ...r, shopping_list_id: list.id })));
      if (itemsError) {
        setSaving(false);
        console.error(itemsError);
        return setErrorMessage(itemsError.message);
      }
    }

    setSaving(false);
    onCreated(list.id);
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <form onSubmit={handleCreate}>
      <div className="form-grid mb-4">
        <div>
          <label className="field-label">Libellé de la liste</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Courses de la semaine" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Rechercher un ingrédient</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="tomate, lait..." className="input-hand" />
        </div>
      </div>

      {/* INGRÉDIENTS RANGÉS PAR CATÉGORIE, avec une case à cocher chacun */}
      {ingredients.length === 0 && <p className="opacity-60 mb-4">Aucun ingrédient enregistré pour le moment.</p>}
      {ingredients.length > 0 && groups.length === 0 && <p className="opacity-60 mb-4">Aucun ingrédient ne correspond à ta recherche.</p>}
      <div className="space-y-4 mb-4">
        {groups.map((g) => (
          <div key={g.name}>
            <p className="field-label border-b-2 border-dashed border-line pb-1 mb-1">{g.name}</p>
            <ul>
              {g.items.map((ing) => {
                const checked = ing.id in selected;
                const rule = quantityRule(ing.type);
                return (
                  <li key={ing.id} className="flex flex-wrap items-center gap-3 py-1 text-sm">
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(ing.id)}
                        className="w-4 h-4 accent-brick shrink-0"
                      />
                      <span className="truncate">
                        {ing.name}
                        {ing.brand && <span className="opacity-60"> — {ing.brand.name}</span>}
                      </span>
                    </label>
                    {/* Le champ quantité n'apparaît qu'une fois l'ingrédient coché, et doit être rempli */}
                    {checked && (
                      <span className="flex items-center gap-1">
                        <input
                          autoFocus
                          type="number"
                          inputMode="decimal"
                          step={rule.step}
                          min={rule.min}
                          required
                          placeholder="qté"
                          value={selected[ing.id]}
                          onChange={(e) => setSelected((s) => ({ ...s, [ing.id]: e.target.value }))}
                          className="input-hand w-16 text-right"
                          aria-label={`Quantité de ${ing.name}`}
                        />
                        <span className="opacity-60">{rule.unit}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {errorMessage && <p className="text-sm text-brick mb-3">{errorMessage}</p>}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={saving} className="btn-hand">
          {saving ? 'Création...' : 'Créer'}
        </button>
        <span className="text-sm opacity-70">{selectedIds.length} ingrédient(s) coché(s)</span>
      </div>
    </form>
  );
}
