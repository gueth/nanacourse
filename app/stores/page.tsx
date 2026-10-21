'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { storeLabel, STORE_SELECT, storeColor } from '@/lib/stores';
import type { Store } from '@/lib/types';
import { SwipePages } from '@/components/SwipePages';
import { useConfirm } from '@/components/ConfirmDialog';

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [confirm, confirmDialog] = useConfirm();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => stores.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase())),
    [stores, search]
  );

  async function loadStores() {
    const { data, error } = await supabase.from('stores').select(STORE_SELECT).order('name');
    if (error) console.error(error);
    else setStores(data);
    setLoading(false);
  }

  useEffect(() => {
    supabase
      .from('stores').select(STORE_SELECT)
      .order('name')
      .then(({ data, error }) => {
        if (error) console.error(error);
        else setStores(data);
        setLoading(false);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from('stores').insert({ name: name.trim(), address: address.trim() || null });
    if (error) return console.error(error);
    setName('');
    setAddress('');
    loadStores();
  }

  async function handleDelete(id: string) {
    const s = stores.find((x) => x.id === id);
    if (!(await confirm('Supprimer le magasin', `Supprimer « ${s ? storeLabel(s) : 'ce magasin'} » ?`))) return;
    const { error } = await supabase.from('stores').delete().eq('id', id);
    if (error) console.error(error);
    else loadStores();
  }

  if (loading) return <p>Chargement...</p>;

  const formPage = (
    <div>
      <h1 className="title-hand text-4xl mb-1">Magasins</h1>
      <p className="opacity-70 mb-6">Les enseignes où tu fais tes courses.</p>

      <h2 className="title-hand text-2xl mb-3">Ajouter un magasin</h2>

      <form onSubmit={handleSubmit} className="card form-grid">
        <span className="tape" />
        <div>
          <label className="field-label">Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carrefour City" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Adresse</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optionnel" className="input-hand w-48" />
        </div>
        <button type="submit" className="btn-hand">
          Ajouter
        </button>
      </form>
    </div>
  );

  const listPage = (
    <div>
      <h2 className="title-hand text-4xl mb-1">Tes magasins</h2>
      <p className="opacity-70 mb-6">Recherche et gère tes magasins.</p>

      <input
        type="text"
        placeholder="Rechercher un magasin..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-hand w-full mb-4"
      />

      <ul className="space-y-3">
        {filtered.length === 0 && <p className="opacity-60">Aucun magasin ne correspond à ta recherche.</p>}
        {filtered.map((s) => (
          <li key={s.id} className="card flex items-center justify-between">
            <span className="tape" />
            <span className="flex items-center gap-3">
              <span className="w-3.5 h-3.5 rounded-full border border-ink" style={{ background: storeColor(s) }} />
              <span className="text-lg">{storeLabel(s)}</span>
              {s.address && <span className="text-sm opacity-60">— {s.address}</span>}
            </span>
            <button onClick={() => handleDelete(s.id)} className="btn-ghost">
              supprimer
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      {confirmDialog}
      <SwipePages pages={[formPage, listPage]} labels={['Ajouter un magasin', 'Liste des magasins']} />
    </>
  );
}
