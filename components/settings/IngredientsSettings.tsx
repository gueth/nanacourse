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
      <p className="opacity-70 mb-4">Ajoute un ingrédient ou modifie toutes les informations des existants.</p>

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

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Rechercher un ingrédient..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-hand flex-1 min-w-0"
        />
        <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)} className="input-hand">
          <option value="">Toutes les catégories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      <ul className="space-y-3">
        {/* Liste vide ou recherche sans résultat : on propose de créer l'ingrédient */}
        {filtered.length === 0 && (
          <div className="card">
            <span className="tape" />
            <p className="opacity-70 mb-3">
              {ingredients.length === 0
                ? "Tu n'as encore aucun ingrédient."
                : 'Aucun ingrédient ne correspond à ta recherche.'}
            </p>
            <button onClick={() => prefillNewIngredient(search.trim())} className="btn-hand">
              {search.trim() ? `+ Ajouter « ${search.trim()} »` : '+ Ajouter un ingrédient'}
            </button>
          </div>
        )}
        {/* Les variantes d'un même produit sont regroupées sous une bannière dépliable (ex : Œufs (3)).
            Pendant une recherche ou un filtre, tous les groupes sont ouverts pour voir les résultats. */}
        <FamilyList
          items={filtered}
          nameOf={(ing) => ing.name}
          collapsible
          forceOpen={!!search.trim() || !!filterCategoryId}
          renderItem={(ing, nested) => (
            // Dans une bannière de famille : simple ligne ; seul : carte avec scotch
            <li key={ing.id} className={nested ? 'py-3' : 'card'}>
              {!nested && <span className="tape" />}

              {/* EN-TÊTE : photo, nom, infos résumées et boutons */}
              <div className="flex items-center gap-3">
                {ing.photo_url && (
                  <img src={ing.photo_url} alt={ing.name} className="w-12 h-12 object-cover rounded border-2 border-ink" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-lg">
                    <strong>{ing.name}</strong>{' '}
                    <span className="text-sm opacity-60">
                      ({ing.category?.name ?? 'sans catégorie'}
                      {ing.type ? ` — ${ing.type}` : ''}
                      {ing.brand ? ` — ${ing.brand.name}` : ''})
                    </span>
                  </p>
                  {ing.note && <p className="text-sm italic opacity-70">{ing.note}</p>}
                  {/* PRIX : un par magasin, du moins cher au plus cher (le moins cher en gras), pour une unité du type */}
                  <p className="text-sm mt-0.5">
                    {ing.prices.length === 0 ? (
                      <span className="opacity-60">prix inconnu</span>
                    ) : (
                      ing.prices
                        .slice()
                        .sort((a, b) => a.price - b.price)
                        .map((p, i) => (
                          <span key={p.id} className={i === 0 ? 'font-bold' : 'opacity-70'}>
                            {i > 0 && ' · '}
                            {p.price.toFixed(2)} €{ing.type ? ` / ${quantityRule(ing.type).unit}` : ''}
                            <span className="font-normal opacity-70"> ({storeLabel(p.store)})</span>
                          </span>
                        ))
                    )}
                  </p>
                </div>
                <button onClick={() => (editingId === ing.id ? setEditingId(null) : startEdit(ing))} className="btn-ghost">
                  {editingId === ing.id ? 'fermer' : 'modifier'}
                </button>
                <button onClick={() => handleDelete(ing)} className="btn-ghost">
                  supprimer
                </button>
              </div>

              {/* FORMULAIRE D'ÉDITION, visible seulement pour l'ingrédient sélectionné */}
              {editingId === ing.id && (
                <div className="mt-4 pt-3 border-t-2 border-dashed border-line">
                  <div className="form-grid">
                    <div>
                      <label className="field-label">Nom</label>
                      <input value={form.name} onChange={(e) => setField('name', e.target.value)} className="input-hand" />
                    </div>
                    <div>
                      <label className="field-label">Catégorie</label>
                      <select value={form.category_id} onChange={(e) => setField('category_id', e.target.value)} className="input-hand">
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
                      <select value={form.brand_id} onChange={(e) => setField('brand_id', e.target.value)} className="input-hand">
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
                      <label className="field-label">Type</label>
                      <input
                        value={form.type}
                        onChange={(e) => setField('type', e.target.value)}
                        list="settings-type-suggestions"
                        className="input-hand w-32"
                      />
                      <datalist id="settings-type-suggestions">
                        {TYPE_SUGGESTIONS.map((t) => (
                          <option key={t} value={t} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="field-label">Note</label>
                      <input value={form.note} onChange={(e) => setField('note', e.target.value)} className="input-hand w-48" />
                    </div>
                    <button onClick={() => saveEdit(ing.id)} className="btn-hand">
                      Enregistrer
                    </button>
                  </div>

                  {/* PHOTO : affichée seulement si l'ingrédient en a une, avec juste "changer" et "supprimer".
                      Enregistrée immédiatement, indépendamment du bouton "Enregistrer". */}
                  {ing.photo_url && (
                    <div className="mt-4 flex flex-wrap items-center gap-4">
                      {/* Le vrai champ fichier est caché : le bouton "changer" l'ouvre */}
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
                        supprimer
                      </button>
                    </div>
                  )}

                  {/* PRIX PAR MAGASIN : ajout, modification et retrait, enregistrés immédiatement */}
                  <PriceEditor ingredientId={ing.id} stores={stores} prices={ing.prices} onChange={onChange} />
                </div>
              )}
            </li>
          )}
        />
      </ul>
    </div>
  );
}
