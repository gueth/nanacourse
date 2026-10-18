'use client';

import { useMemo, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { SwipePages } from '@/components/SwipePages';

type Category = { id: string; name: string; budget_limit: number | null };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [categories, search]
  );

  async function loadCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) console.error(error);
    else setCategories(data);
    setLoading(false);
  }

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (error) console.error(error);
        else setCategories(data);
        setLoading(false);
      });
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

  const formPage = (
    <div>
      <h1 className="title-hand text-4xl mb-1">Catégories</h1>
      <p className="opacity-70 mb-6">Fixe un budget max par catégorie, sur chaque achat.</p>

      <h2 className="title-hand text-2xl mb-3">Ajouter une catégorie</h2>

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
    </div>
  );

  const listPage = (
    <div>
      <h2 className="title-hand text-4xl mb-1">Tes catégories</h2>
      <p className="opacity-70 mb-6">Recherche et gère tes catégories.</p>

      <input
        type="text"
        placeholder="Rechercher une catégorie..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-hand w-full mb-4"
      />

      <ul className="space-y-3">
        {filtered.length === 0 && <p className="opacity-60">Aucune catégorie ne correspond à ta recherche.</p>}
        {filtered.map((c) => (
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

  return <SwipePages pages={[formPage, listPage]} labels={['Ajouter une catégorie', 'Liste des catégories']} />;
}
