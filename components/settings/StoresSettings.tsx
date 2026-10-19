'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Chain, Store } from '@/lib/types';
import CollapsibleForm from '@/components/settings/CollapsibleForm';
import { storeColor, storeLabel } from '@/lib/stores';
import { deleteChain, deleteStore } from '@/lib/deletions';
import { useConfirm } from '@/components/ConfirmDialog';
import FamilyList from '@/components/FamilyList';

type Props = {
  stores: Store[];
  chains: Chain[];
  // Appelée après chaque modification pour recharger les données depuis Supabase
  onChange: () => void;
};

// Couleur proposée pour une nouvelle enseigne
const DEFAULT_COLOR = '#4b6043';

// Pastille de couleur d'une enseigne : un clic ouvre le choix de la couleur, enregistrée une fois choisie
// (événement « change » du navigateur, déclenché à la fermeture du sélecteur, sur ordinateur comme sur téléphone)
function ChainColorInput({ chain, onSave }: { chain: Chain; onSave: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = () => onSave(el.value);
    el.addEventListener('change', handle);
    return () => el.removeEventListener('change', handle);
  }, [onSave]);
  return (
    <input
      ref={ref}
      type="color"
      defaultValue={chain.color ?? DEFAULT_COLOR}
      aria-label={`Couleur de ${chain.name}`}
      title="Changer la couleur"
      className="w-6 h-6 rounded-full border border-ink cursor-pointer"
    />
  );
}

// Onglet "Supermarchés" des paramètres :
//  - les enseignes (ex : Carrefour), avec un libellé et une couleur : création, couleur modifiable, suppression ;
//  - les supermarchés : une enseigne (facultative), un nom de magasin et une adresse ; ajout, modification, suppression.
export default function StoresSettings({ stores, chains, onChange }: Props) {
  // Formulaire d'ajout d'une enseigne
  const [chainName, setChainName] = useState('');
  const [chainColor, setChainColor] = useState(DEFAULT_COLOR);

  // Formulaire d'ajout d'un supermarché
  const [chainId, setChainId] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [search, setSearch] = useState('');
  // Message d'erreur affiché à l'écran
  const [errorMessage, setErrorMessage] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Ligne en cours de modification (null = aucune) et ses valeurs temporaires
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editChainId, setEditChainId] = useState('');
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');

  // Enseignes par ordre alphabétique
  const sortedChains = useMemo(() => chains.slice().sort((a, b) => a.name.localeCompare(b.name)), [chains]);

  // Recherche sur l'enseigne, le nom et l'adresse ; tri par enseigne puis par nom
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores
      .filter((s) => [s.chain?.name, s.name, s.address].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => (a.chain?.name ?? '').localeCompare(b.chain?.name ?? '') || a.name.localeCompare(b.name));
  }, [stores, search]);

  function showError(error: { code?: string; message: string }) {
    console.error(error);
    setErrorMessage(
      error.code === '23505'
        ? 'Cette enseigne existe déjà.'
        : error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703'
          ? 'La table « chains » (enseignes) manque dans Supabase : lance le SQL fourni.'
          : error.message
    );
  }

  // ----- ENSEIGNES -----

  // AJOUT D'UNE ENSEIGNE
  async function handleAddChain(e: React.FormEvent) {
    e.preventDefault();
    if (!chainName.trim()) return;
    setErrorMessage('');
    const { error } = await supabase.from('chains').insert({ name: chainName.trim(), color: chainColor });
    if (error) return showError(error);
    setChainName('');
    onChange();
  }

  // CHANGEMENT DE COULEUR D'UNE ENSEIGNE (enregistré dès qu'on a choisi la couleur)
  async function saveChainColor(c: Chain, color: string) {
    if (color === c.color) return;
    const { error } = await supabase.from('chains').update({ color }).eq('id', c.id);
    if (error) showError(error);
    else onChange();
  }

  // SUPPRESSION D'UNE ENSEIGNE, après confirmation : ses magasins sont gardés, sans enseigne
  async function handleDeleteChain(c: Chain) {
    const count = stores.filter((s) => s.chain_id === c.id).length;
    const detail = count > 0 ? ` Ses ${count} magasin(s) seront gardés, sans enseigne.` : '';
    if (!(await confirm("Supprimer l'enseigne", `Supprimer « ${c.name} » ?${detail}`))) return;
    setErrorMessage('');
    const error = await deleteChain(c.id);
    if (error) showError(error);
    else onChange();
  }

  // ----- SUPERMARCHÉS -----

  // AJOUT D'UN SUPERMARCHÉ
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMessage('');
    const { error } = await supabase
      .from('stores')
      .insert({ chain_id: chainId || null, name: name.trim(), address: address.trim() || null });
    if (error) return showError(error);
    setName('');
    setAddress('');
    onChange();
  }

  // PASSAGE EN MODE ÉDITION : on pré-remplit les champs avec les valeurs actuelles
  function startEdit(s: Store) {
    setEditingId(s.id);
    setEditChainId(s.chain_id ?? '');
    setEditName(s.name);
    setEditAddress(s.address ?? '');
  }

  // ENREGISTREMENT DES MODIFICATIONS
  async function saveEdit(s: Store) {
    if (!editName.trim()) return;
    setErrorMessage('');
    const newAddress = editAddress.trim() || null;
    const { error } = await supabase
      .from('stores')
      .update({
        chain_id: editChainId || null,
        name: editName.trim(),
        address: newAddress,
        // Nouvelle adresse : la position du magasin sera recalculée à la prochaine optimisation
        ...(newAddress !== s.address ? { latitude: null, longitude: null } : {})
      })
      .eq('id', s.id);
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

  // Liste déroulante des enseignes (formulaires d'ajout et de modification)
  const chainOptions = (
    <>
      <option value="">— aucune</option>
      {sortedChains.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );

  return (
    <div>
      {confirmDialog}
      <p className="opacity-70 mb-4">Tes enseignes, et les supermarchés où tu fais tes courses, rangés par enseigne.</p>

      {/* ENSEIGNES : libellé + couleur ; repliable comme les formulaires d'ajout */}
      <CollapsibleForm title={`Enseignes (${chains.length})`} storageKey="settings-chains">
        {sortedChains.length === 0 ? (
          <p className="text-sm opacity-60 mb-4">Aucune enseigne pour le moment.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 mb-4">
            {sortedChains.map((c) => (
              <li key={c.id} className="flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-full border-2 border-ink bg-paper">
                <ChainColorInput chain={c} onSave={(color) => saveChainColor(c, color)} />
                <span className="text-sm">{c.name}</span>
                <span className="text-xs opacity-60">({stores.filter((s) => s.chain_id === c.id).length})</span>
                <button
                  onClick={() => handleDeleteChain(c)}
                  aria-label={`Supprimer l'enseigne ${c.name}`}
                  title="Supprimer"
                  className="p-0.5 opacity-60 hover:opacity-100 hover:text-brick"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddChain} className="form-grid">
          <div>
            <label className="field-label">Nouvelle enseigne</label>
            <input value={chainName} onChange={(e) => setChainName(e.target.value)} placeholder="Carrefour" className="input-hand" />
          </div>
          <div>
            <label className="field-label">Couleur</label>
            <input value={chainColor} onChange={(e) => setChainColor(e.target.value)} type="color" className="h-9 w-14 border-2 border-ink rounded" />
          </div>
          <button type="submit" className="btn-hand">
            + Ajouter
          </button>
        </form>
      </CollapsibleForm>

      {/* Formulaire d'ajout d'un supermarché, repliable pour laisser de la place à la liste */}
      <CollapsibleForm title="+ Ajouter un supermarché" storageKey="settings-stores">
        <form onSubmit={handleAdd} className="form-grid">
          <div>
            <label className="field-label">Enseigne</label>
            <select value={chainId} onChange={(e) => setChainId(e.target.value)} className="input-hand">
              {chainOptions}
            </select>
          </div>
          <div>
            <label className="field-label">Nom du magasin</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="City Bastille" className="input-hand" />
          </div>
          <div>
            <label className="field-label">Adresse</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optionnel" className="input-hand" />
          </div>
          <button type="submit" className="btn-hand">
            + Ajouter
          </button>
        </form>
      </CollapsibleForm>
      {/* Erreurs (ajout, suppression...) affichées hors des formulaires, visibles même quand ils sont repliés */}
      {errorMessage && <p className="text-sm text-brick mb-4">{errorMessage}</p>}

      <input
        type="text"
        placeholder="Rechercher une enseigne, un magasin, une adresse..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-hand w-full mb-4"
      />

      <ul className="space-y-3">
        {filtered.length === 0 && <p className="opacity-60">Aucun supermarché ne correspond à ta recherche.</p>}
        {/* Les magasins d'une même enseigne sont regroupés sous une bannière dépliable (ex : Carrefour (3)) ;
            sans enseigne = magasin seul. Pendant une recherche, tous les groupes sont ouverts pour voir les résultats. */}
        <FamilyList
          items={filtered}
          nameOf={(s) => s.name}
          groupOf={(s) => ({ key: s.chain_id ?? '', label: s.chain?.name ?? '' })}
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
                    <select value={editChainId} onChange={(e) => setEditChainId(e.target.value)} className="input-hand">
                      {chainOptions}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Nom du magasin</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-hand" />
                  </div>
                  <div>
                    <label className="field-label">Adresse</label>
                    <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="input-hand" />
                  </div>
                  <button onClick={() => saveEdit(s)} className="btn-hand">
                    Enregistrer
                  </button>
                  <button onClick={() => setEditingId(null)} className="btn-ghost">
                    annuler
                  </button>
                </div>
              ) : (
                // MODE LECTURE : couleur de l'enseigne, enseigne en gras, puis nom du magasin et adresse
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-3.5 h-3.5 rounded-full border border-ink shrink-0" style={{ background: storeColor(s) }} />
                    <span className="text-lg">
                      {s.chain && <strong>{s.chain.name} </strong>}
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
