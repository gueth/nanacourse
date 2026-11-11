'use client';

import { useCached } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import type { Category, Ingredient, IngredientGroup } from '@/lib/types';

// Bannières d'ingrédients (table ingredient_groups, script supabase/ingredient_groups.sql) : elles regroupent les
// variantes d'un même produit (« Œufs » : 12 oeufs, 20 oeufs, 6 œufs plein air...). Dans la création d'une liste,
// c'est la bannière qui s'affiche, et on y choisit la variante. Un ingrédient sans bannière s'affiche seul.
// La bannière porte la photo et la catégorie : ses ingrédients prennent sa catégorie (voir saveIngredientGroup).

// Table absente (script SQL pas encore lancé) : aucune bannière, les ingrédients s'affichent seuls comme avant
const missingTable = (error: { code?: string } | null) => !!error && ['42P01', 'PGRST205', '42703', 'PGRST200'].includes(error.code ?? '');

export async function fetchIngredientGroups(): Promise<IngredientGroup[]> {
  const { data, error } = await supabase
    .from('ingredient_groups')
    .select('id, name, photo_url, category_id, category:categories(id, name, budget_limit)')
    .order('name');
  if (missingTable(error)) return [];
  if (error) throw error;
  return (data as unknown as IngredientGroup[]) ?? [];
}

// Modification d'une bannière : nom et catégorie. La catégorie est aussi donnée à tous ses ingrédients.
export async function saveIngredientGroup(groupId: string, values: { name: string; category_id: string | null }) {
  const { error } = await supabase.from('ingredient_groups').update({ name: values.name.trim(), category_id: values.category_id }).eq('id', groupId);
  if (error) return error;
  if (!values.category_id) return null;
  const { error: itemsError } = await supabase.from('ingredients').update({ category_id: values.category_id }).eq('group_id', groupId);
  return itemsError;
}

// Photo d'une bannière : envoi dans le stockage des photos d'ingrédients, puis enregistrement de son adresse
export async function uploadGroupPhoto(groupId: string, file: File) {
  const path = `banniere-${groupId}-${Date.now()}.${file.name.split('.').pop()}`;
  const { error: uploadError } = await supabase.storage.from('ingredient-photos').upload(path, file);
  if (uploadError) return uploadError;
  const { data } = supabase.storage.from('ingredient-photos').getPublicUrl(path);
  const { error } = await supabase.from('ingredient_groups').update({ photo_url: data.publicUrl }).eq('id', groupId);
  return error;
}

// Bannières gardées en mémoire (lib/cache), par ordre alphabétique
export function useIngredientGroups() {
  return useCached('courses:bannieres', fetchIngredientGroups);
}

// Rattache un ingrédient à une bannière existante (groupId), à une nouvelle bannière (newName), ou le détache (rien).
// Une bannière restée sans ingrédient est supprimée.
export async function setIngredientGroup(ingredientId: string, previousGroupId: string | null, choice: { groupId?: string | null; newName?: string }) {
  let groupId = choice.groupId ?? null;
  const newName = choice.newName?.trim();
  if (newName) {
    // Même nom qu'une bannière existante : on la reprend
    const { data: existing } = await supabase.from('ingredient_groups').select('id').ilike('name', newName).maybeSingle();
    if (existing) groupId = existing.id;
    else {
      // Nouvelle bannière : elle part avec la catégorie et la photo de l'ingrédient
      const { data: ing } = await supabase.from('ingredients').select('category_id, photo_url').eq('id', ingredientId).single();
      const { data, error } = await supabase
        .from('ingredient_groups')
        .insert({ name: newName, category_id: ing?.category_id ?? null, photo_url: ing?.photo_url ?? null })
        .select('id')
        .single();
      if (error) return error;
      groupId = data.id;
    }
  }
  // L'ingrédient prend la catégorie de sa bannière (si elle en a une)
  const { data: group } = groupId ? await supabase.from('ingredient_groups').select('category_id').eq('id', groupId).single() : { data: null };
  const { error } = await supabase
    .from('ingredients')
    .update(group?.category_id ? { group_id: groupId, category_id: group.category_id } : { group_id: groupId })
    .eq('id', ingredientId);
  if (error) return error;
  if (previousGroupId && previousGroupId !== groupId) {
    const { count } = await supabase.from('ingredients').select('id', { count: 'exact', head: true }).eq('group_id', previousGroupId);
    if (count === 0) await supabase.from('ingredient_groups').delete().eq('id', previousGroupId);
  }
  return null;
}

// Une entrée de la création de liste : une bannière avec ses variantes, ou un ingrédient seul (variantes = lui-même)
export type IngredientEntry<T extends Ingredient & { category?: Category | null }> = {
  key: string; // id de la bannière, ou "ing:<id>" pour un ingrédient seul
  name: string;
  photo_url: string | null;
  category: Category | null;
  group: IngredientGroup | null;
  variants: T[];
};

// Regroupe les ingrédients sous leurs bannières, dans l'ordre alphabétique des noms affichés.
// Une bannière affiche sa photo et sa catégorie (à défaut, celles de sa première variante qui en a) ;
// un ingrédient seul garde les siennes.
export function toEntries<T extends Ingredient & { category?: Category | null }>(ingredients: T[], groups: IngredientGroup[]): IngredientEntry<T>[] {
  const byGroup = new Map(groups.map((g) => [g.id, g]));
  const entries = new Map<string, IngredientEntry<T>>();
  for (const ing of ingredients) {
    const group = ing.group_id ? byGroup.get(ing.group_id) ?? null : null;
    const key = group ? group.id : `ing:${ing.id}`;
    if (!entries.has(key))
      entries.set(key, { key, name: group?.name ?? ing.name, photo_url: group?.photo_url ?? null, category: group?.category ?? null, group, variants: [] });
    entries.get(key)!.variants.push(ing);
  }
  return Array.from(entries.values())
    .map((e) => ({
      ...e,
      photo_url: e.photo_url ?? e.variants.find((v) => v.photo_url)?.photo_url ?? null,
      category: e.category ?? e.variants.find((v) => v.category)?.category ?? null
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
