'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Store } from '@/lib/types';

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [color, setColor] = useState('#4b6043');

  async function loadStores() {
    const { data, error } = await supabase.from('stores').select('*').order('name');
    if (error) console.error(error);
    else setStores(data);
    setLoading(false);
  }

  useEffect(() => {
    supabase
      .from('stores')
      .select('*')
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
    const { error } = await supabase.from('stores').insert({ name: name.trim(), address: address.trim() || null, color });
    if (error) return console.error(error);
    setName('');
    setAddress('');
    loadStores();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('stores').delete().eq('id', id);
    if (error) console.error(error);
    else loadStores();
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      <h1 className="title-hand text-4xl mb-1">Magasins</h1>
      <p className="opacity-70 mb-6">Les enseignes où tu fais tes courses.</p>

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-4">
        <span className="tape" />
        <div>
          <label className="field-label">Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carrefour City" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Adresse</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optionnel" className="input-hand w-48" />
        </div>
        <div>
          <label className="field-label">Couleur</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} type="color" className="h-9 w-14 border-2 border-ink rounded" />
        </div>
        <button type="submit" className="btn-hand">
          Ajouter
        </button>
      </form>

      <ul className="space-y-3">
        {stores.map((s) => (
          <li key={s.id} className="card flex items-center justify-between">
            <span className="tape" />
            <span className="flex items-center gap-3">
              <span className="w-3.5 h-3.5 rounded-full border border-ink" style={{ background: s.color ?? '#ccc' }} />
              <span className="text-lg">{s.name}</span>
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
}
