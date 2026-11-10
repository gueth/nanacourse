import { toJpeg } from '@/lib/image';
import { supabase } from '@/lib/supabase';

// Textes libres de la page Profil (à propos, nom, position, objectifs, carte d'identité) et adresses des photos.
// Enregistrés dans la colonne "texts" de la table "profile" (voir supabase/profile_texts.sql), avec une copie
// dans le navigateur pour les afficher tout de suite à l'ouverture de la page.
export type ProfileTexts = {
  name: string;
  about: string; // paragraphes séparés par une ligne vide
  positionAddress: string;
  positionNote: string;
  goalsLabel: string;
  goals: string; // une ligne par objectif
  birth: string;
  phone: string;
  email: string;
  handle: string;
  quote: string;
  photoStanding: string; // photo en pied de la carte « À propos » ('' : dessin par défaut)
  photoPortrait: string; // photo d'identité du carnet ('' : dessin par défaut)
};

export type ProfilePhoto = 'photoStanding' | 'photoPortrait';

export const DEFAULT_PROFILE_TEXTS: ProfileTexts = {
  name: 'Nana',
  about: [
    "Bonjour, je m'appelle Ana mais tout le monde m'appelle Nana. Je vis à Lyon et je tiens ici mes courses, mon budget et mes défis de la semaine.",
    "J'aime cuisiner de saison, comparer les prix d'un magasin à l'autre et mettre un peu de côté chaque mois. Mon objectif : tenir mes courses sous 80 € par semaine et partir au Japon l'an prochain.",
    'Merci de passer sur mon profil, bonne visite !'
  ].join('\n\n'),
  positionAddress: '12 rue des Lilas, 69003 Lyon',
  positionNote: 'Point de départ, pour conseiller le magasin le plus proche',
  goalsLabel: 'Épargne · 2026',
  goals: "Voyage au Japon : 1 200 € sur 3 000 €\nFonds d'urgence : 3 mois de dépenses",
  birth: '12.03.1999',
  phone: '06 12 34 56 78',
  email: 'nana.courses@exemple.fr',
  handle: '@nana.courses',
  quote: "Une bonne liste, c'est déjà la moitié des courses",
  photoStanding: '',
  photoPortrait: ''
};

const KEY = 'profil:textes';
const listeners = new Set<() => void>();
let cache: { raw: string | null; texts: ProfileTexts } = { raw: null, texts: DEFAULT_PROFILE_TEXTS };

// Textes connus (copie du navigateur), complétés par les valeurs par défaut.
// Même objet tant que le stockage n'a pas changé, pour useSyncExternalStore.
export function getProfileTexts(): ProfileTexts {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (raw !== cache.raw) {
    let saved = {};
    try {
      saved = raw ? JSON.parse(raw) : {};
    } catch {}
    cache = { raw, texts: { ...DEFAULT_PROFILE_TEXTS, ...saved } };
  }
  return cache.texts;
}

export const getDefaultProfileTexts = () => DEFAULT_PROFILE_TEXTS;

export function subscribeProfileTexts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Met à jour la copie du navigateur et prévient la page
function storeLocally(texts: ProfileTexts) {
  const raw = JSON.stringify(texts);
  cache = { raw, texts };
  try {
    localStorage.setItem(KEY, raw);
  } catch {}
  listeners.forEach((l) => l());
}

// Message lisible pour une erreur Supabase (colonne "texts" absente : script à lancer)
function describeError(error: { code?: string; message: string }) {
  return error.code === '42703' || /texts/.test(error.message)
    ? 'Les textes ne sont pas encore enregistrables dans Supabase : lance le script supabase/profile_texts.sql dans l’éditeur SQL.'
    : error.message;
}

// Recharge les textes depuis Supabase (à l'ouverture de la page) ; on garde la copie locale si rien n'y est enregistré
export async function syncProfileTexts() {
  const { data, error } = await supabase.from('profile').select('texts').limit(1);
  if (error) return console.error(error);
  const saved = data?.[0]?.texts as Partial<ProfileTexts> | null | undefined;
  if (saved) storeLocally({ ...DEFAULT_PROFILE_TEXTS, ...saved });
}

// Enregistre les textes dans Supabase (ligne de profil existante, ou première ligne), puis localement.
// Renvoie un message d'erreur, ou null.
export async function saveProfileTexts(texts: ProfileTexts): Promise<string | null> {
  const { data, error: readError } = await supabase.from('profile').select('id').limit(1);
  if (readError) return describeError(readError);
  const id = data?.[0]?.id;
  const { error } = id ? await supabase.from('profile').update({ texts }).eq('id', id) : await supabase.from('profile').insert({ texts });
  if (error) return describeError(error);
  storeLocally(texts);
  return null;
}

// Remplace une photo du profil : réduite en JPEG, envoyée dans le stockage Supabase ("profile-photos"),
// puis son adresse est enregistrée avec les textes. Renvoie un message d'erreur, ou null.
export async function uploadProfilePhoto(photo: ProfilePhoto, file: File): Promise<string | null> {
  const jpeg = await toJpeg(file);
  if (!jpeg) return 'Cette image ne peut pas être lue : essaie une autre photo.';
  const path = `${photo}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(path, jpeg, { contentType: 'image/jpeg' });
  if (error)
    return /bucket/i.test(error.message)
      ? 'Le stockage des photos n’existe pas encore dans Supabase : lance le script supabase/profile_texts.sql dans l’éditeur SQL.'
      : error.message;
  const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
  return saveProfileTexts({ ...getProfileTexts(), [photo]: data.publicUrl });
}

// Remet le dessin par défaut à la place d'une photo
export const resetProfilePhoto = (photo: ProfilePhoto) => saveProfileTexts({ ...getProfileTexts(), [photo]: '' });

// Lignes non vides d'un texte saisi sur plusieurs lignes
export const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

// Paragraphes d'un texte (séparés par une ligne vide)
export const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
