'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Category = { id: string; name: string; budget_limit: number | null };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');

  async function loadCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) console.error(error);
    else setCategories(data);
    setLoading(false);
  }

  useEffect(() => {
    loadCategories();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase
      .from('categories')
      .insert({ name: name.trim(), budget_limit: budget ? Number(budget) : null });
    if (error) return console.error(error);
    setName('');
    setBudget('');
    loadCategories();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) console.error(error);
    else loadCategories();
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      <h1 className="title-hand text-4xl mb-1">Catégories</h1>
      <p className="opacity-70 mb-6">Fixe un budget max par catégorie, sur chaque achat.</p>

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-4">
        <span className="tape" />
        <div>
          <label className="field-label">Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fruits & légumes" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Budget max (€)</label>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            type="number"
            step="0.01"
            placeholder="40"
            className="input-hand w-24"
          />
        </div>
        <button type="submit" className="btn-hand">
          Ajouter
        </button>
      </form>

      <ul className="space-y-3">
        {categories.map((c) => (
          <li key={c.id} className="card flex items-center justify-between">
            <span className="tape" />
            <span className="text-lg">{c.name}</span>
            <span className="flex items-center gap-4">
              <span className="text-mustard font-bold">
                {c.budget_limit != null ? `${c.budget_limit} €` : 'pas de budget'}
              </span>
              <button onClick={() => handleDelete(c.id)} className="btn-ghost">
                supprimer
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
