'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { geocodeAddress, getPosition, reverseGeocode } from '@/lib/geo';
import { EMPTY_PROFILE, fetchProfile, saveProfile, type Profile } from '@/lib/profile';

// Partie "Ma position" du profil : l'adresse d'où l'on part faire les courses.
// Elle sert à conseiller un magasin proche lors de l'optimisation (rien n'est demandé à ce moment-là).
// On la saisit (convertie en coordonnées par la Base Adresse Nationale), ou on prend la position actuelle du téléphone.
export default function LocationSettings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    fetchProfile().then((p) => {
      setProfile(p);
      setAddress(p.address ?? '');
    });
  }, []);

  async function save(values: Omit<Profile, 'id'>, success: string) {
    if (!profile) return;
    const { profile: saved, error } = await saveProfile(profile, values);
    if (error || !saved) {
      console.error(error);
      return setMessage({
        text:
          error?.code === 'PGRST205' || error?.code === '42P01'
            ? 'La table « profile » manque dans Supabase (voir le SQL à lancer).'
            : (error?.message ?? 'Enregistrement impossible.'),
        error: true
      });
    }
    setProfile(saved);
    setAddress(saved.address ?? '');
    setMessage({ text: success });
  }

  // ADRESSE SAISIE : convertie en coordonnées avant d'être enregistrée
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    setMessage(null);
    const coords = await geocodeAddress(address.trim());
    if (!coords) {
      setBusy(false);
      return setMessage({ text: 'Adresse introuvable : vérifie-la (numéro, rue, ville).', error: true });
    }
    await save({ address: coords.label ?? address.trim(), latitude: coords.lat, longitude: coords.lng }, 'Position enregistrée.');
    setBusy(false);
  }

  // POSITION ACTUELLE DU TÉLÉPHONE : prise une seule fois, puis enregistrée avec l'adresse la plus proche
  async function useCurrentPosition() {
    setBusy(true);
    setMessage(null);
    const pos = await getPosition();
    if (!pos) {
      setBusy(false);
      return setMessage({
        text: 'Position indisponible (refusée, ou site non sécurisé en http). Saisis plutôt ton adresse.',
        error: true
      });
    }
    const label = await reverseGeocode(pos);
    await save({ address: label, latitude: pos.lat, longitude: pos.lng }, 'Position actuelle enregistrée.');
    setBusy(false);
  }

  async function clear() {
    setMessage(null);
    await save(EMPTY_PROFILE, 'Position effacée : le magasin le moins cher sera conseillé.');
  }

  if (!profile) return <p>Chargement...</p>;

  const hasPosition = profile.latitude != null && profile.longitude != null;

  return (
    <div>
      <p className="text-sm opacity-70 mb-4">
        D&apos;où pars-tu faire tes courses ? Cette adresse sert à conseiller un magasin proche quand tu optimises une
        liste. Sans adresse, ou si les meilleurs magasins sont trop loin, c&apos;est le moins cher qui est conseillé.
      </p>

      {hasPosition && (
        <p className="flex items-center gap-2 mb-4">
          <MapPin size={18} className="shrink-0" />
          <strong>{profile.address ?? `${profile.latitude!.toFixed(4)}, ${profile.longitude!.toFixed(4)}`}</strong>
        </p>
      )}

      <form onSubmit={handleSubmit} className="card form-grid">
        <span className="tape" />
        <div className="col-span-full">
          <label className="field-label">Adresse</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="12 rue des Tables, 43000 Le Puy-en-Velay"
            className="input-hand"
          />
        </div>
        <button type="submit" disabled={busy || !address.trim()} className="btn-hand">
          {busy ? 'Recherche...' : 'Enregistrer'}
        </button>
        <button type="button" onClick={useCurrentPosition} disabled={busy} className="btn-ghost">
          utiliser ma position actuelle
        </button>
        {hasPosition && (
          <button type="button" onClick={clear} disabled={busy} className="btn-ghost">
            effacer
          </button>
        )}
        {message && <p className={`col-span-full text-sm ${message.error ? 'text-brick' : 'text-herb'}`}>{message.text}</p>}
      </form>
    </div>
  );
}
