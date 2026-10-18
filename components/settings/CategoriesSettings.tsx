'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Category } from '@/lib/types';
import { deleteCategory } from '@/lib/deletions';
import { useConfirm } from '@/components/ConfirmDialog';

type Props = {
  categories: Category[];
  // Appelée après chaque modification pour recharger les données depuis Supabase
  onChange: () => void;
};

// Onglet "Catégories" des paramètres : ajout, modification (nom + budget) et suppression.
export default function CategoriesSettings({ categories, onChange }: Props) {
  // Formulaire d'ajout
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [search, setSearch] = useState('');
  // Message d'erreur affiché à l'écran (ex : suppression refusée par Supabase)
  const [errorMessage, setErrorMessage] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Ligne en cours de modification (null = aucune) et ses valeurs temporaires
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBudget, setEditBudget] = useState('');

  const filtered = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [categories, search]
  );

  // AJOUT D'UNE CATÉGORIE
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase
      .from('categories')
      .insert({ name: name.trim(), budget_limit: budget ? Number(budget) : null });
    if (error) return console.error(error);
    setName('');
    setBudget('');
    onChange();
  }

  // PASSAGE EN MODE ÉDITION : on pré-remplit les champs avec les valeurs actuelles
  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditBudget(c.budget_limit != null ? String(c.budget_limit) : '');
  }

  // ENREGISTREMENT DES MODIFICATIONS
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const { error } = await supabase
      .from('categories')
      .update({ name: editName.trim(), budget_limit: editBudget ? Number(editBudget) : null })
      .eq('id', id);
    if (error) return console.error(error);
    setEditingId(null);
    onChange();
  }

  // SUPPRESSION D'UNE CATÉGORIE, après confirmation : les ingrédients qui l'utilisaient passent "sans catégorie"
  async function handleDelete(c: Category) {
    if (!(await confirm('Supprimer la catégorie', `Supprimer « ${c.name} » ? Les ingrédients de cette catégorie passeront « sans catégorie ».`))) return;
    setErrorMessage('');
    const error = await deleteCategory(c.id);
    if (error) {
      console.error(error);
      setErrorMessage(error.message);
    } else onChange();
  }

  return (
    <div>
      {confirmDialog}
      <p className="opacity-70 mb-4">Fixe un budget max par catégorie, sur chaque achat.</p>
      {errorMessage && <p className="text-sm text-brick mb-4">{errorMessage}</p>}

      <form onSubmit={handleAdd} className="card form-grid">
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
          + Ajouter
        </button>
      </form>

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
          <li key={c.id} className="card">
            <span className="tape" />
            {editingId === c.id ? (
              // MODE ÉDITION
              <div className="form-grid">
                <div>
                  <label className="field-label">Nom</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-hand" />
                </div>
                <div>
                  <label className="field-label">Budget max (€)</label>
                  <input
                    value={editBudget}
                    onChange={(e) => setEditBudget(e.target.value)}
                    type="number"
                    step="0.01"
                    className="input-hand w-24"
                  />
                </div>
                <button onClick={() => saveEdit(c.id)} className="btn-hand">
                  Enregistrer
                </button>
                <button onClick={() => setEditingId(null)} className="btn-ghost">
                  annuler
                </button>
              </div>
            ) : (
              // MODE LECTURE
              <div className="flex items-center justify-between gap-4">
                <span className="text-lg">{c.name}</span>
                <span className="flex items-center gap-4">
                  <span className="text-mustard font-bold">
                    {c.budget_limit != null ? `${c.budget_limit} €` : 'pas de budget'}
                  </span>
                  <button onClick={() => startEdit(c)} className="btn-ghost">
                    modifier
                  </button>
                  <button onClick={() => handleDelete(c)} className="btn-ghost">
                    supprimer
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
