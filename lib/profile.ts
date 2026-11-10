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

// Position de départ du profil, ou null si elle n'est pas renseignée
export function profileCoords(profile: Profile) {
  return profile.latitude != null && profile.longitude != null ? { lat: profile.latitude, lng: profile.longitude } : null;
}
