import { supabase } from '@/lib/supabase';

// Profil (une seule ligne dans la table "profile") : l'adresse de départ des courses,
// utilisée pour conseiller un magasin proche lors de l'optimisation
export type Profile = {
  id?: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export const EMPTY_PROFILE: Profile = { address: null, latitude: null, longitude: null };

// Charge le profil (profil vide si rien n'est enregistré ou si la table n'existe pas encore)
export async function fetchProfile(): Promise<Profile> {
  const { data, error } = await supabase.from('profile').select('*').limit(1);
  if (error) console.error(error);
  return data?.[0] ?? EMPTY_PROFILE;
}

// Enregistre le profil : met à jour la ligne existante, ou crée la première.
// Renvoie le profil enregistré, ou l'erreur Supabase rencontrée.
export async function saveProfile(current: Profile, values: Omit<Profile, 'id'>) {
  const { data, error } = current.id
    ? await supabase.from('profile').update(values).eq('id', current.id).select().single()
    : await supabase.from('profile').insert(values).select().single();
  return { profile: (data as Profile | null) ?? null, error };
}

// Position de départ du profil, ou null si elle n'est pas renseignée
export function profileCoords(profile: Profile) {
  return profile.latitude != null && profile.longitude != null ? { lat: profile.latitude, lng: profile.longitude } : null;
}
