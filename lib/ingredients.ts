import { supabase } from '@/lib/supabase';

export type NewIngredient = {
  name: string;
  note?: string;
  category_id?: string;
  brand_id?: string;
  type?: string;
};

// Crée un ingrédient (les champs vides deviennent null), et son prix dans un magasin si fourni.
// Renvoie l'id du nouvel ingrédient, ou null en cas d'erreur.
export async function createIngredient(fields: NewIngredient, storeId?: string, price?: number) {
  const { data: created, error } = await supabase
    .from('ingredients')
    .insert({
      name: fields.name.trim(),
      note: fields.note?.trim() || null,
      category_id: fields.category_id || null,
      brand_id: fields.brand_id || null,
      type: fields.type?.trim() || null
    })
    .select()
    .single();
  if (error || !created) {
    console.error(error);
    return null;
  }

  if (storeId && price != null) {
    const { error: priceError } = await supabase
      .from('ingredient_prices')
      .insert({ ingredient_id: created.id, store_id: storeId, price, available: true });
    if (priceError) console.error(priceError);
  }

  return created.id as string;
}

// Mots ignorés en début de nom : quantités et unités (« 12 », « 500g », « x6 », « 1,5 », « kg »...)
// et petits mots de liaison (« de », « d' »), pour que « 12 oeufs » et « 6 œufs plein air »
// tombent dans la même famille que « Œufs bio ».
const LEADING_NOISE = /^(\d+([.,]\d+)?(g|kg|mg|l|cl|ml|x)?|x\d+|x|g|kg|mg|l|cl|ml|de|d|du|des|lot|pack)$/i;

// Premier mot significatif d'un nom (voir LEADING_NOISE)
function mainWord(name: string) {
  const words = name.trim().split(/[\s,'’-]+/).filter(Boolean);
  return words.find((w) => !LEADING_NOISE.test(w)) ?? words[0] ?? '';
}

// Famille d'un ingrédient, déduite du premier mot significatif de son nom, pour regrouper les variantes
// d'un même produit (ex : « Œufs bio », « 12 oeuf » et « 6 œufs plein air » -> « oeuf »).
// Sans accents, en minuscules et au singulier, pour que les variantes d'écriture se rejoignent.
export function familyKey(name: string) {
  return mainWord(name)
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(?<=..)[sx]$/, '');
}

// Nom affiché sur la bannière d'une famille : le mot principal tel qu'il est écrit, avec une majuscule
export function familyLabel(name: string) {
  const word = mainWord(name);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Regroupe des éléments par famille (d'après leur nom), dans l'ordre d'apparition :
// le premier élément d'une famille reste le premier de son groupe.
export function groupByFamily<T>(items: T[], nameOf: (item: T) => string) {
  const groups = new Map<string, { label: string; items: T[] }>();
  items.forEach((item, index) => {
    const name = nameOf(item);
    // Sans nom, l'élément reste seul (clé unique)
    const key = familyKey(name) || `__${index}`;
    if (!groups.has(key)) groups.set(key, { label: familyLabel(name), items: [] });
    groups.get(key)!.items.push(item);
  });
  return Array.from(groups.entries()).map(([key, g]) => ({ key, ...g }));
}
