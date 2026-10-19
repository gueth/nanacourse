import { supabase } from '@/lib/supabase';
import type { Store } from '@/lib/types';
import type { StoreOption } from '@/lib/optimize';

export type Coords = { lat: number; lng: number };

// Coût estimé d'un kilomètre en voiture (carburant), compté aller-retour pour comparer les magasins
export const TRAVEL_COST_PER_KM = 0.3;
// Au-delà de cette distance de ta position, un magasin est jugé "trop loin" pour être conseillé
export const MAX_DISTANCE_KM = 20;

// Position actuelle du téléphone (le navigateur demande l'autorisation).
// Utilisée seulement depuis le profil, pour enregistrer sa position de départ.
// Renvoie null si elle est refusée, indisponible, ou si le site n'est pas en https (hors localhost).
export function getPosition(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  });
}

// Coordonnées d'une adresse française, via la Base Adresse Nationale (api-adresse.data.gouv.fr :
// service public gratuit, sans clé), avec l'adresse complète trouvée.
// Renvoie null si l'adresse n'est pas trouvée avec assez de certitude.
export async function geocodeAddress(address: string): Promise<(Coords & { label?: string }) | null> {
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature || feature.properties?.score < 0.4) return null;
    const [lng, lat] = feature.geometry.coordinates;
    return { lat, lng, label: feature.properties?.label };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Adresse la plus proche d'une position (même service), ou null si aucune n'est trouvée
export async function reverseGeocode(pos: Coords): Promise<string | null> {
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${pos.lng}&lat=${pos.lat}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0]?.properties?.label ?? null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Distance à vol d'oiseau entre deux points, en kilomètres (formule de haversine)
export function distanceKm(a: Coords, b: Coords) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Position d'un magasin : celle déjà enregistrée, sinon calculée depuis son adresse puis enregistrée
// (pour ne la demander qu'une fois). Null si le magasin n'a pas d'adresse ou qu'elle est introuvable.
async function storeCoords(store: Store): Promise<Coords | null> {
  if (store.latitude != null && store.longitude != null) return { lat: store.latitude, lng: store.longitude };
  if (!store.address?.trim()) return null;
  const coords = await geocodeAddress(store.address);
  if (coords) {
    // Échec possible si les colonnes latitude / longitude manquent : la position est alors recalculée la prochaine fois
    const { error } = await supabase.from('stores').update({ latitude: coords.lat, longitude: coords.lng }).eq('id', store.id);
    if (error) console.warn(error);
  }
  return coords;
}

// Magasin conseillé parmi les meilleures options (classées par articles trouvés, puis prix) :
//  - sans position de départ (profil), le moins cher ;
//  - sinon, parmi ceux où l'on trouve le plus d'articles et à moins de MAX_DISTANCE_KM,
//    celui dont "prix + trajet aller-retour" est le plus bas ;
//  - si tous sont trop loin (ou sans adresse), le moins cher.
// Renvoie null s'il n'y a aucune option.
export async function chooseNearbyOption(options: StoreOption[], home: Coords | null): Promise<StoreOption | null> {
  const cheapest = options[0] ?? null;
  if (!home || !cheapest) return cheapest;

  const candidates = (
    await Promise.all(
      options
        .filter((o) => o.covered === cheapest.covered)
        .map(async (o) => {
          const coords = await storeCoords(o.store);
          return coords ? { ...o, distanceKm: distanceKm(home, coords) } : null;
        })
    )
  ).filter((o): o is StoreOption & { distanceKm: number } => o != null && o.distanceKm <= MAX_DISTANCE_KM);

  if (candidates.length === 0) return cheapest;
  const cost = (o: StoreOption & { distanceKm: number }) => o.total + 2 * o.distanceKm * TRAVEL_COST_PER_KM;
  return candidates.reduce((best, o) => (cost(o) < cost(best) ? o : best));
}
