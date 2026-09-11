'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

const steps = [
  { href: '/', title: 'acceuil', desc: 'la page d acceuil' },
  { href: '/categories', title: 'Catégories', desc: 'Le budget max par catégorie.' },
  { href: '/stores', title: 'Magasins', desc: 'Les enseignes où tu fais tes courses.' },
  { href: '/ingredients', title: 'Ingrédients', desc: 'Note, photo, prix par magasin.' },
  { href: '/inventory', title: 'Inventaire', desc: "Ce qu'il te reste à la maison." },
  { href: '/shopping-list', title: 'Liste de courses', desc: 'Le meilleur trajet magasins/prix.' }
];

type SavedItem = {
  id: string;
  ingredient_id: string;
  quantity: number;
  expected_price: number;
  ingredient: { name: string; category: { id: string; name: string } | null } | null;
};

type SavedList = {
  id: string;
  name: string;
  estimated_price: number;
  items: SavedItem[];
};

export default function CoursePage() {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [realPrices, setRealPrices] = useState<Record<string, string>>({});
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<string | null>(null);

  function toggleChecked(itemId: string) {
    setCheckedItems((c) => ({ ...c, [itemId]: !c[itemId] }));
  }

  async function loadLists() {
    const { data, error } = await supabase
      .from('shopping_lists')
      .select('*, items:shopping_list_items(*, ingredient:ingredients(name, category:categories(id, name)))')
      .order('id', { ascending: false });
    if (error) console.error(error);
    setLists((data as unknown as SavedList[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    supabase
      .from('shopping_lists')
      .select('*, items:shopping_list_items(*, ingredient:ingredients(name, category:categories(id, name)))')
      .order('id', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error(error);
        setLists((data as unknown as SavedList[]) ?? []);
        setLoading(false);
      });
  }, []);

  function groupByCategory(items: SavedItem[]) {
    const groups = new Map<string, { name: string; items: SavedItem[] }>();
    for (const item of items) {
      const key = item.ingredient?.category?.id ?? 'none';
      const name = item.ingredient?.category?.name ?? 'Sans catégorie';
      if (!groups.has(key)) groups.set(key, { name, items: [] });
      groups.get(key)!.items.push(item);
    }
    return Array.from(groups.values());
  }

  function realPriceFor(item: SavedItem) {
    const raw = realPrices[item.id];
    return raw ? Number(raw) : item.expected_price;
  }

  function realTotalFor(list: SavedList) {
    return list.items.reduce((sum, item) => sum + realPriceFor(item), 0);
  }

  // VALIDATION : les ingrédients rejoignent l'inventaire, la liste disparaît
  async function validateList(list: SavedList) {
    setValidating(list.id);

    const boughtItems = list.items.filter((item) => checkedItems[item.id]);

    const { data: inv } = await supabase.from('inventory').select('ingredient_id, quantity');
    const currentByIngredient: Record<string, number> = {};
    for (const row of inv ?? []) currentByIngredient[row.ingredient_id] = row.quantity;

    for (const item of boughtItems) {
      const current = currentByIngredient[item.ingredient_id] ?? 0;
      const { error } = await supabase
        .from('inventory')
        .upsert(
          {
            ingredient_id: item.ingredient_id,
            quantity: current + item.quantity,
            low_stock: false,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'ingredient_id' }
        );
      if (error) console.error(error);
    }

    await supabase.from('shopping_list_items').delete().eq('shopping_list_id', list.id);
    const { error: deleteError } = await supabase.from('shopping_lists').delete().eq('id', list.id);
    if (deleteError) console.error(deleteError);

    setValidating(null);
    loadLists();
  }

  return (
    <div>
      <h1 className="title-hand text-5xl mb-2">Sache où aller,</h1>
      <h1 className="title-hand text-5xl mb-6">sache combien ça coûte.</h1>
      <p className="mb-8 opacity-70">Configure une fois, réutilise à chaque course.</p>

      {!loading && lists.length > 0 && (
        <div className="mb-10">
          <h2 className="title-hand text-3xl mb-4">Tes listes en attente</h2>
          {lists.map((list) => (
            <div key={list.id} className="card">
              <span className="tape" />
              <p className="title-hand text-2xl mb-3">{list.name}</p>

              {groupByCategory(list.items).map((g) => (
                <div key={g.name} className="mb-3">
                  <p className="field-label">{g.name}</p>
                  <ul className="space-y-1">
                    {g.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={!!checkedItems[item.id]}
                          onChange={() => toggleChecked(item.id)}
                          className="w-4 h-4 accent-brick shrink-0"
                          title="Acheté"
                        />
                        <span className={`flex-1 ${checkedItems[item.id] ? 'line-through opacity-50' : ''}`}>
                          {item.ingredient?.name ?? 'Ingrédient supprimé'} ×{item.quantity}
                        </span>
                        <span className="opacity-60">estimé {item.expected_price.toFixed(2)} €</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder={item.expected_price.toFixed(2)}
                          value={realPrices[item.id] ?? ''}
                          onChange={(e) => setRealPrices((r) => ({ ...r, [item.id]: e.target.value }))}
                          className="input-hand w-20"
                          title="Prix réel, si différent"
                        />
                        <span>€</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <p className="border-t-2 border-dashed border-line pt-2 flex justify-between font-bold">
                <span>Total estimé : {list.estimated_price.toFixed(2)} €</span>
                <span className="text-mustard">Total réel : {realTotalFor(list).toFixed(2)} €</span>
              </p>

              <button onClick={() => validateList(list)} disabled={validating === list.id} className="btn-hand mt-3">
                {validating === list.id ? 'Validation...' : 'Valider cette liste'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-x-6">
        {steps.map((s) => (
          <Link key={s.href} href={s.href} className="card block hover:-translate-y-0.5 transition-transform">
            <span className="tape" />
            <p className="title-hand text-2xl mb-1">{s.title}</p>
            <p className="text-sm opacity-70">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
