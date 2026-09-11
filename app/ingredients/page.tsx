'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, IngredientWithRelations, Store } from '@/lib/types';
import PriceEditor from '@/components/PriceEditor';
import { SwipePages } from '@/components/SwipePages';

const TYPE_SUGGESTIONS = ['pièce', 'kg', 'g', 'litre', 'paquet', 'conserve', 'bouteille'];

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [price, setPrice] = useState('');
  const [storeId, setStoreId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [search, setSearch] = useState('');

  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandRating, setNewBrandRating] = useState('');

  // RECHERCHE ET FILTRAGE DES INGRÉDIENTS
  const filteredIngredients = useMemo(() => {
    return ingredients.filter((ing) => {
      const matchesSearch = ing.name.toLowerCase().includes(search.trim().toLowerCase());
      const matchesCategory = !filterCategoryId || ing.category_id === filterCategoryId;
      return matchesSearch && matchesCategory;
    });
  }, [ingredients, search, filterCategoryId]);

  // CHARGEMENT DES DONNÉES
  async function loadAll() {
    const [{ data: cats }, { data: sts }, { data: brs }, { data: ings, error }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      supabase
        .from('ingredients')
        .select('*, category:categories(*), brand:brands(*), prices:ingredient_prices(*, store:stores(*))')
        .order('name')
    ]);
    if (error) console.error(error);
    setCategories(cats ?? []);
    setStores(sts ?? []);
    setBrands(brs ?? []);
    setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      supabase
        .from('ingredients')
        .select('*, category:categories(*), brand:brands(*), prices:ingredient_prices(*, store:stores(*))')
        .order('name')
    ]).then(([{ data: cats }, { data: sts }, { data: brs }, { data: ings, error }]) => {
      if (error) console.error(error);
      setCategories(cats ?? []);
      setStores(sts ?? []);
      setBrands(brs ?? []);
      setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
      setLoading(false);
    });
  }, []);

  // AJOUT D'UNE MARQUE (pas de page dédiée, juste nom + avis)
  async function handleAddBrand() {
    if (!newBrandName.trim()) return;
    const { data: created, error } = await supabase
      .from('brands')
      .insert({ name: newBrandName.trim(), rating: newBrandRating ? Number(newBrandRating) : null })
      .select()
      .single();
    if (error) return console.error(error);
    setBrands((b) => [...b, created].sort((a, c) => a.name.localeCompare(c.name)));
    setBrandId(created.id);
    setNewBrandName('');
    setNewBrandRating('');
  }

  // AJOUT D'UN INGRÉDIENT
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { data: created, error } = await supabase
      .from('ingredients')
      .insert({
        name: name.trim(),
        note: note.trim() || null,
        category_id: categoryId || null,
        brand_id: brandId || null,
        type: type.trim() || null
      })
      .select()
      .single();
    if (error) return console.error(error);

    if (created && storeId && price) {
      const { error: priceError } = await supabase
        .from('ingredient_prices')
        .insert({ ingredient_id: created.id, store_id: storeId, price: Number(price), available: true });
      if (priceError) console.error(priceError);
    }

    setName('');
    setNote('');
    setCategoryId('');
    setBrandId('');
    setType('');
    setPrice('');
    setStoreId('');
    loadAll();
  }

  // SCAN D'UNE PHOTO D'ÉTIQUETTE POUR EXTRAIRE LE NOM ET LE PRIX
  async function handleScan(file: File) {
    setScanning(true);
    setScanError('');
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/api/scan-price', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data.error ?? "Échec de l'analyse de la photo.");
        return;
      }
      if (data.name) setName(data.name);
      if (data.price != null) setPrice(String(data.price));
    } catch (err) {
      console.error(err);
      setScanError("Échec de l'analyse de la photo.");
    } finally {
      setScanning(false);
    }
  }

  // SUPPRESSION D'UN INGRÉDIENT
  async function handleDelete(id: string) {
    const { error } = await supabase.from('ingredients').delete().eq('id', id);
    if (error) console.error(error);
    else loadAll();
  }

  // AJOUT D'UNE PHOTO D'INGRÉDIENT
  async function handlePhotoUpload(ingredientId: string, file: File) {
    const path = `${ingredientId}-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage.from('ingredient-photos').upload(path, file);
    if (uploadError) return console.error(uploadError);
    const { data } = supabase.storage.from('ingredient-photos').getPublicUrl(path);
    const { error: updateError } = await supabase.from('ingredients').update({ photo_url: data.publicUrl }).eq('id', ingredientId);
    if (updateError) console.error(updateError);
    else loadAll();
  }

  if (loading) return <p>Chargement...</p>;

  const formPage = (
    <div>
      <h1 className="title-hand text-4xl mb-1">Ingrédients</h1>
      <p className="opacity-70 mb-6">Note, photo, catégorie, marque, type, prix par magasin.</p>

      <h2 className="title-hand text-2xl mb-3">Ajouter un nouvel ingrédient</h2>

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-4">
        <span className="tape" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={scanning}
          onChange={(e) => e.target.files?.[0] && handleScan(e.target.files[0])}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanning}
          title="Prendre une photo de l'étiquette"
          className="flex items-center justify-center w-11 h-11 rounded-full border-2 border-ink bg-paper shrink-0"
        >
          <Camera size={20} />
        </button>

        <div>
          <label className="field-label">Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tomates cerises" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Catégorie</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-hand">
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
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-hand">
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
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="pièce, kg, paquet..."
            list="type-suggestions"
            className="input-hand w-32"
          />
          <datalist id="type-suggestions">
            {TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="field-label">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bio de préférence" className="input-hand w-48" />
        </div>
        <div>
          <label className="field-label">Magasin</label>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-hand">
            <option value="">—</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Prix (€)</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="2.50" className="input-hand w-24" />
        </div>

        {scanning && <p className="text-sm opacity-70 w-full">Lecture de la photo... vérifie les champs avant d&apos;ajouter.</p>}
        {scanError && <p className="text-sm text-brick w-full">{scanError}</p>}

        <button type="submit" className="btn-hand">
          Ajouter
        </button>
      </form>

      {/* MINI-FORMULAIRE MARQUE : pas de page dédiée, juste nom + avis sur 5 */}
      <div className="card flex flex-wrap items-end gap-4">
        <span className="tape" />
        <div>
          <label className="field-label">Nouvelle marque</label>
          <input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Bonduelle" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Avis (/5)</label>
          <input
            value={newBrandRating}
            onChange={(e) => setNewBrandRating(e.target.value)}
            type="number"
            min={0}
            max={5}
            step="0.5"
            placeholder="4"
            className="input-hand w-20"
          />
        </div>
        <button type="button" onClick={handleAddBrand} className="btn-ghost">
          + ajouter la marque
        </button>
      </div>
    </div>
  );

  const listPage = (
    <div>
      <h2 className="title-hand text-4xl mb-1">Tes ingrédients</h2>
      <p className="opacity-70 mb-6">Recherche, filtre par catégorie, gère photo et prix.</p>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Rechercher un ingrédient..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-hand flex-1"
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
        {filteredIngredients.length === 0 && <p className="opacity-60">Aucun ingrédient ne correspond à ta recherche.</p>}
        {filteredIngredients.map((ing) => (
          <li key={ing.id} className="card">
            <span className="tape" />
            <div className="flex items-center gap-3">
              {ing.photo_url && (
                <img src={ing.photo_url} alt={ing.name} className="w-12 h-12 object-cover rounded border-2 border-ink" />
              )}
              <div className="flex-1">
                <p className="text-lg">
                  <strong>{ing.name}</strong>{' '}
                  <span className="text-sm opacity-60">
                    ({ing.category?.name ?? 'sans catégorie'}
                    {ing.type ? ` — ${ing.type}` : ''}
                    {ing.brand ? ` — ${ing.brand.name}` : ''})
                  </span>
                </p>
                {ing.note && <p className="text-sm italic opacity-70">{ing.note}</p>}
              </div>
              <button onClick={() => setExpandedId(expandedId === ing.id ? null : ing.id)} className="btn-ghost">
                {expandedId === ing.id ? 'fermer' : 'photo / prix'}
              </button>
              <button onClick={() => handleDelete(ing.id)} className="btn-ghost">
                supprimer
              </button>
            </div>

            {expandedId === ing.id && (
              <div className="mt-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files?.[0] && handlePhotoUpload(ing.id, e.target.files[0])}
                  className="text-sm mb-2"
                />
                <PriceEditor ingredientId={ing.id} stores={stores} prices={ing.prices} onChange={loadAll} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  return <SwipePages pages={[formPage, listPage]} labels={['Ajouter un ingrédient', 'Liste des ingrédients']} />;
}
