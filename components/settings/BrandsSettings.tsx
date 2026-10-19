'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Brand } from '@/lib/types';
import CollapsibleForm from '@/components/settings/CollapsibleForm';
import { deleteBrand } from '@/lib/deletions';
import { useConfirm } from '@/components/ConfirmDialog';

type Props = {
  brands: Brand[];
  // Appelée après chaque modification pour recharger les données depuis Supabase
  onChange: () => void;
};

// Onglet "Marques" des paramètres : ajout, modification (nom + avis sur 5) et suppression.
export default function BrandsSettings({ brands, onChange }: Props) {
  // Formulaire d'ajout
  const [name, setName] = useState('');
  const [rating, setRating] = useState('');
  const [search, setSearch] = useState('');
  // Message d'erreur affiché à l'écran (ex : ajout refusé par Supabase)
  const [errorMessage, setErrorMessage] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Affiche une erreur Supabase de façon lisible
  function showError(error: { code?: string; message: string }) {
    console.error(error);
    setErrorMessage(
      error.code === '42501'
        ? "Supabase refuse l'accès à la table des marques (règle de sécurité RLS manquante)."
        : error.message
    );
  }

  // Ligne en cours de modification (null = aucune) et ses valeurs temporaires
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRating, setEditRating] = useState('');

  const filtered = useMemo(
    () => brands.filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase())),
    [brands, search]
  );

  // AJOUT D'UNE MARQUE
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMessage('');
    const { error } = await supabase
      .from('brands')
      .insert({ name: name.trim(), rating: rating ? Number(rating) : null });
    if (error) return showError(error);
    setName('');
    setRating('');
    onChange();
  }

  // PASSAGE EN MODE ÉDITION : on pré-remplit les champs avec les valeurs actuelles
  function startEdit(b: Brand) {
    setEditingId(b.id);
    setEditName(b.name);
    setEditRating(b.rating != null ? String(b.rating) : '');
  }

  // ENREGISTREMENT DES MODIFICATIONS
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const { error } = await supabase
      .from('brands')
      .update({ name: editName.trim(), rating: editRating ? Number(editRating) : null })
      .eq('id', id);
    if (error) return showError(error);
    setEditingId(null);
    onChange();
  }

  // SUPPRESSION D'UNE MARQUE, après confirmation : les ingrédients qui l'utilisaient n'ont plus de marque
  async function handleDelete(b: Brand) {
    if (!(await confirm('Supprimer la marque', `Supprimer « ${b.name} » ? Elle sera retirée des ingrédients qui l'utilisent.`))) return;
    setErrorMessage('');
    const error = await deleteBrand(b.id);
    if (error) showError(error);
    else onChange();
  }

  return (
    <div>
      {confirmDialog}
      <p className="opacity-70 mb-4">Les marques de tes produits, avec ton avis sur 5.</p>

      {/* Formulaire d'ajout, repliable pour laisser de la place à la liste */}
      <CollapsibleForm title="+ Ajouter une marque" storageKey="settings-brands">
        <form onSubmit={handleAdd} className="form-grid">
          <div>
            <label className="field-label">Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bonduelle" className="input-hand" />
          </div>
          <div>
            <label className="field-label">Avis (/5)</label>
            <input
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              type="number"
              min={0}
              max={5}
              step="0.5"
              placeholder="4"
              className="input-hand w-20"
            />
          </div>
          <button type="submit" className="btn-hand">
            + Ajouter
          </button>
        </form>
      </CollapsibleForm>
      {/* Erreurs (ajout, suppression...) affichées hors du formulaire, visibles même quand il est replié */}
      {errorMessage && <p className="text-sm text-brick mb-4">{errorMessage}</p>}

      <input
        type="text"
        placeholder="Rechercher une marque..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-hand w-full mb-4"
      />

      <ul className="space-y-3">
        {filtered.length === 0 && <p className="opacity-60">Aucune marque ne correspond à ta recherche.</p>}
        {filtered.map((b) => (
          <li key={b.id} className="card">
            <span className="tape" />
            {editingId === b.id ? (
              // MODE ÉDITION
              <div className="form-grid">
                <div>
                  <label className="field-label">Nom</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-hand" />
                </div>
                <div>
                  <label className="field-label">Avis (/5)</label>
                  <input
                    value={editRating}
                    onChange={(e) => setEditRating(e.target.value)}
                    type="number"
                    min={0}
                    max={5}
                    step="0.5"
                    className="input-hand w-20"
                  />
                </div>
                <button onClick={() => saveEdit(b.id)} className="btn-hand">
                  Enregistrer
                </button>
                <button onClick={() => setEditingId(null)} className="btn-ghost">
                  annuler
                </button>
              </div>
            ) : (
              // MODE LECTURE
              <div className="flex items-center justify-between gap-4">
                <span className="text-lg">{b.name}</span>
                <span className="flex items-center gap-4">
                  <span className="text-mustard font-bold">{b.rating != null ? `${b.rating}/5` : 'pas d’avis'}</span>
                  <button onClick={() => startEdit(b)} className="btn-ghost">
                    modifier
                  </button>
                  <button onClick={() => handleDelete(b)} className="btn-ghost">
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
