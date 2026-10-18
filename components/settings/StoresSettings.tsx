'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Store } from '@/lib/types';
import { storeLabel } from '@/lib/stores';
import { deleteStore } from '@/lib/deletions';
import { useConfirm } from '@/components/ConfirmDialog';
import FamilyList from '@/components/FamilyList';

type Props = {
  stores: Store[];
  // Appelée après chaque modification pour recharger les données depuis Supabase
  onChange: () => void;
};

// Onglet "Supermarchés" des paramètres : ajout, modification (enseigne, nom, adresse, couleur) et suppression.
// L'enseigne (ex : Carrefour) permet d'avoir plusieurs magasins d'une même chaîne, chacun avec ses prix.
export default function StoresSettings({ stores, onChange }: Props) {
  // Formulaire d'ajout
  const [chain, setChain] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [color, setColor] = useState('#4b6043');
  const [search, setSearch] = useState('');
  // Message d'erreur affiché à l'écran
  const [errorMessage, setErrorMessage] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Ligne en cours de modification (null = aucune) et ses valeurs temporaires
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editChain, setEditChain] = useState('');
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editColor, setEditColor] = useState('#4b6043');

  // Enseignes déjà utilisées, proposées pendant la saisie
  const chains = useMemo(
    () => Array.from(new Set(stores.map((s) => s.chain).filter((c): c is string => !!c))).sort(),
    [stores]
  );

  // Recherche sur l'enseigne, le nom et l'adresse ; tri par enseigne puis par nom
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores
      .filter((s) => [s.chain, s.name, s.address].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => (a.chain ?? '').localeCompare(b.chain ?? '') || a.name.localeCompare(b.name));
  }, [stores, search]);

  function showError(error: { message: string }) {
    console.error(error);
    setErrorMessage(error.message);
  }

  // AJOUT D'UN SUPERMARCHÉ
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMessage('');
    const { error } = await supabase
      .from('stores')
      .insert({ chain: chain.trim() || null, name: name.trim(), address: address.trim() || null, color });
    if (error) return showError(error);
    setName('');
    setAddress('');
    onChange();
  }

  // PASSAGE EN MODE ÉDITION : on pré-remplit les champs avec les valeurs actuelles
  function startEdit(s: Store) {
    setEditingId(s.id);
    setEditChain(s.chain ?? '');
    setEditName(s.name);
    setEditAddress(s.address ?? '');
    setEditColor(s.color ?? '#4b6043');
  }

  // ENREGISTREMENT DES MODIFICATIONS
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setErrorMessage('');
    const { error } = await supabase
      .from('stores')
      .update({ chain: editChain.trim() || null, name: editName.trim(), address: editAddress.trim() || null, color: editColor })
      .eq('id', id);
    if (error) return showError(error);
    setEditingId(null);
    onChange();
  }

  // SUPPRESSION D'UN SUPERMARCHÉ, après confirmation : ses prix sont effacés
  // et les articles des listes n'y sont plus rattachés
  async function handleDelete(s: Store) {
    if (!(await confirm('Supprimer le supermarché', `Supprimer « ${storeLabel(s)} » ? Ses prix seront effacés et il sera retiré des listes de courses.`))) return;
    setErrorMessage('');
    const error = await deleteStore(s.id);
    if (error) showError(error);
    else onChange();
  }

  return (
    <div>
      {confirmDialog}
      <p className="opacity-70 mb-4">Les supermarchés où tu fais tes courses, rangés par enseigne.</p>

      {/* Suggestions d'enseignes, partagées par le formulaire d'ajout et celui de modification */}
      <datalist id="store-chains">
        {chains.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <form onSubmit={handleAdd} className="card form-grid">
        <span className="tape" />
        <div>
          <label className="field-label">Enseigne</label>
          <input value={chain} onChange={(e) => setChain(e.target.value)} list="store-chains" placeholder="Carrefour" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Nom du magasin</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="City Bastille" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Adresse</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optionnel" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Couleur</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} type="color" className="h-9 w-14 border-2 border-ink rounded" />
        </div>
        <button type="submit" className="btn-hand">
          + Ajouter
        </button>
        {errorMessage && <p className="text-sm text-brick w-full">{errorMessage}</p>}
      </form>

      <input
        type="text"
        placeholder="Rechercher une enseigne, un magasin, une adresse..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-hand w-full mb-4"
      />

      <ul className="space-y-3">
        {filtered.length === 0 && <p className="opacity-60">Aucun supermarché ne correspond à ta recherche.</p>}
        {/* Les magasins d'une même enseigne sont regroupés sous une bannière dépliable (ex : Carrefour (3)).
            Regroupement sur l'enseigne exacte (sans tenir compte des majuscules) ; sans enseigne = magasin seul.
            Pendant une recherche, tous les groupes sont ouverts pour voir les résultats. */}
        <FamilyList
          items={filtered}
          nameOf={(s) => s.name}
          groupOf={(s) => ({ key: s.chain?.trim().toLowerCase() ?? '', label: s.chain?.trim() ?? '' })}
          collapsible
          forceOpen={!!search.trim()}
          renderItem={(s, nested) => (
            // Dans une bannière d'enseigne : simple ligne ; seul : carte avec scotch
            <li key={s.id} className={nested ? 'py-3' : 'card'}>
              {!nested && <span className="tape" />}
              {editingId === s.id ? (
                // MODE ÉDITION
                <div className="form-grid">
                  <div>
                    <label className="field-label">Enseigne</label>
                    <input value={editChain} onChange={(e) => setEditChain(e.target.value)} list="store-chains" className="input-hand" />
                  </div>
                  <div>
                    <label className="field-label">Nom du magasin</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-hand" />
                  </div>
                  <div>
                    <label className="field-label">Adresse</label>
                    <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="input-hand" />
                  </div>
                  <div>
                    <label className="field-label">Couleur</label>
                    <input
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      type="color"
                      className="h-9 w-14 border-2 border-ink rounded"
                    />
                  </div>
                  <button onClick={() => saveEdit(s.id)} className="btn-hand">
                    Enregistrer
                  </button>
                  <button onClick={() => setEditingId(null)} className="btn-ghost">
                    annuler
                  </button>
                  {errorMessage && <p className="text-sm text-brick w-full">{errorMessage}</p>}
                </div>
              ) : (
                // MODE LECTURE : enseigne en gras, puis nom du magasin et adresse
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-3.5 h-3.5 rounded-full border border-ink shrink-0" style={{ background: s.color ?? '#ccc' }} />
                    <span className="text-lg">
                      {s.chain && <strong>{s.chain} </strong>}
                      {s.name}
                    </span>
                    {s.address && <span className="text-sm opacity-60 truncate">— {s.address}</span>}
                  </span>
                  <span className="flex items-center gap-4">
                    <button onClick={() => startEdit(s)} className="btn-ghost">
                      modifier
                    </button>
                    <button onClick={() => handleDelete(s)} className="btn-ghost">
                      supprimer
                    </button>
                  </span>
                </div>
              )}
            </li>
          )}
        />
      </ul>
    </div>
  );
}
