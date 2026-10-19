import { supabase } from '@/lib/supabase';
import type { Chain } from '@/lib/types';

// Colonnes à lire pour un supermarché : les siennes, et son enseigne (libellé + couleur).
// À utiliser partout où l'on lit la table "stores", y compris en jointure : "store:stores(...)".
export const STORE_SELECT = '*, chain:chains(*)';

// Nom affiché d'un supermarché : "Enseigne — nom du magasin" si l'enseigne est renseignée.
// Exemple : { chain: { name: 'Carrefour' }, name: 'Bastille' } -> "Carrefour — Bastille"
export function storeLabel(store: { name: string; chain?: Pick<Chain, 'name'> | null }) {
  return store.chain ? `${store.chain.name} — ${store.name}` : store.name;
}

// Couleur d'un supermarché : celle de son enseigne (gris si aucune)
export function storeColor(store: { chain?: Pick<Chain, 'color'> | null }) {
  return store.chain?.color ?? '#ccc';
}

// Identifiant de l'enseigne qui porte ce libellé (sans tenir compte des majuscules), créée si elle n'existe pas.
// Renvoie null pour un libellé vide, ou si la création échoue.
export async function chainIdFor(name: string, chains: Chain[]) {
  const label = name.trim();
  if (!label) return null;
  const known = chains.find((c) => c.name.trim().toLowerCase() === label.toLowerCase());
  if (known) return known.id;
  const { data, error } = await supabase.from('chains').insert({ name: label }).select().single();
  if (error || !data) {
    console.error(error);
    return null;
  }
  return data.id as string;
}
