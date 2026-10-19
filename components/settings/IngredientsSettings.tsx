'use client';

import { useMemo, useState } from 'react';
import { quantityRule, TYPE_SUGGESTIONS } from '@/lib/quantity';
import { storeLabel } from '@/lib/stores';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, IngredientWithRelations, Store } from '@/lib/types';
import FamilyList from '@/components/FamilyList';
import PriceEditor from '@/components/PriceEditor';
import NewIngredientForm from '@/components/NewIngredientForm';
import CollapsibleForm from '@/components/settings/CollapsibleForm';
import { deleteIngredient } from '@/lib/deletions';
import { useConfirm } from '@/components/ConfirmDialog';
import { EditActions, EditFields, RowActions, RowList, SearchBar } from '@/components/settings/ui';


type Props = {
  ingredients: IngredientWithRelations[];
  categories: Category[];
  brands: Brand[];
  stores: Store[];
  // Appelée après chaque modification pour recharger les données depuis Supabase
  onChange: () => void;
};

// Valeurs du formulaire d'édition d'un ingrédient (tout en texte, comme les <input>)
type EditForm = {
  name: string;
  note: string;
  category_id: string;
  brand_id: string;
  type: string;
};

// Onglet "Ingrédients" des paramètres : liste de tous les ingrédients,
// avec modification de toutes leurs informations (nom, catégorie, marque, type, note, photo, prix).
export default function IngredientsSettings({ ingredients, categories, brands, stores, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  // Message d'erreur affiché à l'écran (ex : suppression refusée par Supabase)
  const [errorMessage, setErrorMessage] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Ingrédient en cours de modification (null = aucun) et ses valeurs temporaires
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({ name: '', note: '', category_id: '', brand_id: '', type: '' });

  // Formulaire d'ajout : nom pré-rempli, et compteur qui force sa réinitialisation (via "key")
  const [newIngredientName, setNewIngredientName] = useState('');
  const [formKey, setFormKey] = useState(0);

  // Formulaire d'ajout ouvert ou replié (fermé par défaut, sauf si on l'avait laissé ouvert)
  const [addOpen, setAddOpen] = useState<boolean | undefined>(undefined);

  // Pré-remplit le formulaire d'ajout avec le texte recherché, l'ouvre et remonte en haut de l'onglet
  function prefillNewIngredient(value: string) {
    setNewIngredientName(value);
    setFormKey((k) => k + 1);
    setAddOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // RECHERCHE ET FILTRAGE PAR CATÉGORIE
  const filtered = useMemo(
    () =>
      ingredients.filter((ing) => {
        const matchesSearch = ing.name.toLowerCase().includes(search.trim().toLowerCase());
        const matchesCategory = !filterCategoryId || ing.category_id === filterCategoryId;
        return matchesSearch && matchesCategory;
      }),
    [ingredients, search, filterCategoryId]
  );

  // Met à jour un seul champ du formulaire d'édition
  function setField(field: keyof EditForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // PASSAGE EN MODE ÉDITION : on pré-remplit le formulaire avec les valeurs actuelles
  function startEdit(ing: IngredientWithRelations) {
    setEditingId(ing.id);
    setForm({
      name: ing.name,
      note: ing.note ?? '',
      category_id: ing.category_id ?? '',
      brand_id: ing.brand_id ?? '',
      type: ing.type ?? ''
    });
  }

  // ENREGISTREMENT DES MODIFICATIONS (les champs vides deviennent null en base)
  async function saveEdit(id: string) {
    if (!form.name.trim()) return;
    const { error } = await supabase
      .from('ingredients')
      .update({
        name: form.name.trim(),
        note: form.note.trim() || null,
        category_id: form.category_id || null,
        brand_id: form.brand_id || null,
        type: form.type.trim() || null
      })
      .eq('id', id);
    if (error) return console.error(error);
    setEditingId(null);
    onChange();
  }

  // REMPLACEMENT DE LA PHOTO : envoi dans le stockage Supabase puis mise à jour de l'URL
  async function handlePhotoUpload(ingredientId: string, file: File) {
    const path = `${ingredientId}-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('ingredient-photos').upload(path, file);
    if (uploadError) return console.error(uploadError);
    const { data } = supabase.storage.from('ingredient-photos').getPublicUrl(path);
    const { error: updateError } = await supabase.from('ingredients').update({ photo_url: data.publicUrl }).eq('id', ingredientId);
    if (updateError) console.error(updateError);
    else onChange();
  }

  // RETRAIT DE LA PHOTO
  async function removePhoto(ingredientId: string) {
    const { error } = await supabase.from('ingredients').update({ photo_url: null }).eq('id', ingredientId);
    if (error) console.error(error);
    else onChange();
  }

  // SUPPRESSION D'UN INGRÉDIENT, après confirmation : il est aussi retiré des listes de courses,
  // de l'inventaire et des prix
  async function handleDelete(ing: IngredientWithRelations) {
    if (!(await confirm("Supprimer l'ingrédient", `Supprimer « ${ing.name} » ? Il sera aussi retiré des listes de courses, de l'inventaire et de ses prix.`))) return;
    setErrorMessage('');
    const error = await deleteIngredient(ing.id);
    if (error) {
      console.error(error);
      setErrorMessage(error.message);
    } else onChange();
  }

  return (
    <div>
      {confirmDialog}
      {errorMessage && <p className="text-sm text-brick mb-4">{errorMessage}</p>}
      <p className="text-sm opacity-70 mb-4">Ajoute un ingrédient, ou modifie les informations et les prix des existants.</p>

      {/* AJOUT D'UN NOUVEL INGRÉDIENT, repliable pour laisser de la place à la liste */}
      <CollapsibleForm title="+ Ajouter un ingrédient" storageKey="settings-ingredients" open={addOpen} onOpenChange={setAddOpen}>
        <NewIngredientForm
          key={formKey}
          initialName={newIngredientName}
          categories={categories}
          brands={brands}
          stores={stores}
          onCreated={() => {
            setNewIngredientName('');
            setFormKey((k) => k + 1);
            setSearch('');
            onChange();
          }}
        />
      </CollapsibleForm>

      {/* RECHERCHE, et filtre par catégorie juste en dessous */}
      <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un ingrédient...">
        <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)} className="input-hand w-full text-sm">
          <option value="">Toutes les catégories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </SearchBar>

      {/* Liste vide ou recherche sans résultat : on propose de créer l'ingrédient */}
      {filtered.length === 0 && (
        <div className="card">
          <span className="tape" />
          <p className="opacity-70 mb-3">
            {ingredients.length === 0 ? "Tu n'as encore aucun ingrédient." : 'Aucun ingrédient ne correspond à ta recherche.'}
          </p>
          <button onClick={() => prefillNewIngredient(search.trim())} className="btn-hand">
            {search.trim() ? `+ Ajouter « ${search.trim()} »` : '+ Ajouter un ingrédient'}
          </button>
        </div>
      )}

      {/* LISTE : une ligne par ingrédient (photo, nom, résumé, prix le moins cher), avec modifier / supprimer.
          Les variantes d'un même produit sont regroupées sous une ligne dépliable (ex : Œufs (3)) ;
          pendant une recherche ou un filtre, tous les groupes sont ouverts. */}
      {filtered.length > 0 && (
        <RowList>
          <FamilyList
            rows
            items={filtered}
            nameOf={(ing) => ing.name}
            collapsible
            forceOpen={!!search.trim() || !!filterCategoryId}
            renderItem={(ing, nested) => {
              const editing = editingId === ing.id;
              // Prix connus, du moins cher au plus cher
              const prices = ing.prices.slice().sort((x, y) => x.price - y.price);
              return (
                <li key={ing.id} className={`py-2 pr-4 ${nested ? 'pl-10' : 'pl-4'}`}>
                  <div className="flex items-center gap-3">
                    {ing.photo_url && (
                      <img src={ing.photo_url} alt="" className="w-10 h-10 object-cover rounded border-2 border-ink shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold leading-snug line-clamp-2">{ing.name}</p>
                      {/* Résumé : catégorie · unité · marque */}
                      <p className="text-xs opacity-60 truncate">
                        {[ing.category?.name ?? 'sans catégorie', ing.type, ing.brand?.name].filter(Boolean).join(' · ')}
                      </p>
                      {/* Prix : le moins cher (avec son magasin), et le nombre d'autres prix connus */}
                      <p className="text-xs truncate">
                        {prices.length === 0 ? (
                          <span className="opacity-60">prix inconnu</span>
                        ) : (
                          <>
                            <strong className="text-mustard">
                              {prices[0].price.toFixed(2)} €{ing.type ? ` / ${quantityRule(ing.type).unit}` : ''}
                            </strong>
                            <span className="opacity-70"> {storeLabel(prices[0].store)}</span>
                            {prices.length > 1 && <span className="opacity-60"> · +{prices.length - 1} prix</span>}
                          </>
                        )}
                      </p>
                      {ing.note && <p className="text-xs italic opacity-70 truncate">{ing.note}</p>}
                    </div>
                    <RowActions
                      editing={editing}
                      onEdit={() => (editing ? setEditingId(null) : startEdit(ing))}
                      onDelete={() => handleDelete(ing)}
                    />
                  </div>

                  {/* MODIFICATION, dans la ligne : informations, photo, prix par magasin */}
                  {editing && (
                    <div className="pt-2 pb-3 space-y-4">
                      <EditFields>
                        <div className="sm:col-span-2">
                          <label className="field-label">Nom</label>
                          <input value={form.name} onChange={(e) => setField('name', e.target.value)} className="input-hand w-full" />
                        </div>
                        <div>
                          <label className="field-label">Catégorie</label>
                          <select value={form.category_id} onChange={(e) => setField('category_id', e.target.value)} className="input-hand w-full">
                            <option value="">—</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="field-label">Marque</label>
                          <select value={form.brand_id} onChange={(e) => setField('brand_id', e.target.value)} className="input-hand w-full">
                            <option value="">—</option>
                            {brands.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                                {b.rating != null ? ` (${b.rating}/5)` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="field-label">Type (unité)</label>
                          <input
                            value={form.type}
                            onChange={(e) => setField('type', e.target.value)}
                            list="settings-type-suggestions"
                            className="input-hand w-full"
                          />
                          <datalist id="settings-type-suggestions">
                            {TYPE_SUGGESTIONS.map((t) => (
                              <option key={t} value={t} />
                            ))}
                          </datalist>
                        </div>
                        <div>
                          <label className="field-label">Note</label>
                          <input value={form.note} onChange={(e) => setField('note', e.target.value)} className="input-hand w-full" />
                        </div>
                      </EditFields>
                      <EditActions onSave={() => saveEdit(ing.id)} onCancel={() => setEditingId(null)} />

                      {/* PHOTO : affichée seulement si l'ingrédient en a une, avec "changer" et "retirer".
                          Enregistrée immédiatement, indépendamment du bouton "Enregistrer". */}
                      {ing.photo_url && (
                        <div className="flex flex-wrap items-center gap-4">
                          <span className="field-label mb-0">Photo</span>
                          {/* Le vrai champ fichier est caché : le lien "changer" l'ouvre */}
                          <label className="btn-ghost text-sm cursor-pointer">
                            changer
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => e.target.files?.[0] && handlePhotoUpload(ing.id, e.target.files[0])}
                              className="hidden"
                            />
                          </label>
                          <button onClick={() => removePhoto(ing.id)} className="btn-ghost text-sm">
                            retirer
                          </button>
                        </div>
                      )}

                      {/* PRIX PAR MAGASIN : ajout, modification et retrait, enregistrés immédiatement */}
                      <PriceEditor ingredientId={ing.id} stores={stores} prices={ing.prices} onChange={onChange} />
                    </div>
                  )}
                </li>
              );
            }}
          />
        </RowList>
      )}
    </div>
  );
}
