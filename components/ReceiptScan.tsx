'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, Ingredient, Store } from '@/lib/types';
import { createIngredient, saveIngredientPrice } from '@/lib/ingredients';
import { addToInventory } from '@/lib/inventory';
import { recordExpense } from '@/lib/budget';
import { storeLabel } from '@/lib/stores';
import { normalizeQuantity, quantityRule, TYPE_SUGGESTIONS } from '@/lib/quantity';
import StoreOptions from '@/components/StoreOptions';
import PhotoPicker, { usePhotos } from '@/components/PhotoPicker';
// Lecture gratuite dans le navigateur (Tesseract.js) puis analyse du texte du reçu
import { readLines } from '@/lib/ocr';
import { parseReceipt, type ReceiptItem } from '@/lib/receiptParser';
import { loadAliases, rememberAliases } from '@/lib/receiptAliases';

const MAX_PHOTOS = 4;
// Valeur des listes déroulantes pour "créer un nouvel élément" (marque, magasin)
const NEW = '__new__';

type Props = {
  ingredients: Ingredient[];
  // Appelée une fois l'inventaire mis à jour
  onDone: () => void;
};

// Une ligne du reçu, modifiable avant d'être enregistrée
type ResultRow = {
  key: number;
  apply: boolean; // ligne cochée = sera enregistrée
  raw: string; // texte imprimé sur le reçu (mémorisé avec l'ingrédient choisi pour la prochaine fois)
  ingredientId: string; // '' = nouvel ingrédient, créé avec le nom ci-dessous
  name: string;
  quantity: string;
  unitPrice: string; // prix d'une unité, '' = inconnu
  type: string;
  categoryId: string;
  brandId: string; // '' = aucune, NEW = nouvelle marque créée avec brandName
  brandName: string;
  confidence: ReceiptItem['confidence'];
};

// Valeurs proposées pour une ligne : celles de l'ingrédient connu quand elles sont renseignées
// (on ne les écrase pas), sinon celles lues sur le reçu (elles complètent l'ingrédient).
function rowDetails(known: Ingredient | undefined, it: Pick<ReceiptItem, 'type' | 'category_id' | 'brand_id' | 'brand_name'>) {
  return {
    type: known?.type ?? it.type ?? '',
    categoryId: known?.category_id ?? it.category_id ?? '',
    brandId: known?.brand_id ?? it.brand_id ?? (it.brand_name ? NEW : ''),
    brandName: it.brand_name ?? ''
  };
}

// Informations du magasin lues sur le reçu (enseigne, nom, adresse)
type StoreDetails = { chain: string; name: string; address: string };

// Informations proposées pour le magasin : celles du magasin connu quand elles sont renseignées
// (on ne les écrase pas), sinon celles lues sur le reçu (elles complètent le magasin).
function storeDetails(store: Store | undefined, scanned: StoreDetails): StoreDetails {
  return {
    chain: store?.chain ?? scanned.chain,
    name: store?.name ?? scanned.name,
    address: store?.address ?? scanned.address
  };
}

// Scan d'un reçu de supermarché :
//  1. on prend ou choisit jusqu'à 4 photos du reçu ;
//  2. le texte est lu dans le navigateur (gratuit), puis analysé : magasin, produits, quantités, prix, marque ;
//     les correspondances déjà validées (texte du reçu -> ingrédient) sont reconnues directement ;
//  3. on vérifie / corrige chaque ligne ;
//  4. les lignes cochées : quantités ajoutées à l'inventaire, nouveaux ingrédients créés,
//     informations manquantes des ingrédients connus complétées, prix mémorisés pour ce magasin ;
//     le magasin est créé ou complété (enseigne, nom, adresse lus sur le reçu).
export default function ReceiptScan({ ingredients, onDone }: Props) {
  const { photos, add: addPhotos, remove: removePhoto, error: photoError } = usePhotos(MAX_PHOTOS);
  const [step, setStep] = useState<'pick' | 'analyzing' | 'review' | 'saving'>('pick');
  const [error, setError] = useState('');
  // Avancement de la lecture des photos (0 à 1)
  const [progress, setProgress] = useState(0);

  // Listes de choix
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);

  // Résultat modifiable
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [storeId, setStoreId] = useState(''); // '' = aucun, NEW = nouveau magasin créé avec les informations ci-dessous
  // Informations du magasin lues sur le reçu, et celles modifiables (proposées pour le magasin choisi)
  const [scannedStore, setScannedStore] = useState<StoreDetails>({ chain: '', name: '', address: '' });
  const [store, setStore] = useState<StoreDetails>({ chain: '', name: '', address: '' });
  // Compter le reçu dans le budget (décoché par défaut : la validation d'une liste le fait déjà)
  const [countInBudget, setCountInBudget] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      supabase.from('stores').select('*').order('name')
    ]).then(([{ data: cats }, { data: brs }, { data: sts }]) => {
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setStores(sts ?? []);
    });
  }, []);

  // ANALYSE : lecture du texte des photos dans le navigateur, puis analyse du reçu
  async function analyze() {
    setError('');
    setProgress(0);
    setStep('analyzing');
    try {
      const lines = await readLines(
        photos.map((p) => p.file),
        setProgress
      );
      const result = parseReceipt(lines, { ingredients, brands, stores, aliases: loadAliases() });
      if (result.items.length === 0) {
        setStep('pick');
        return setError('Aucun produit lu : reprends la photo bien à plat, nette et éclairée, le ticket en entier dans le cadre.');
      }
      const scanned = { chain: result.store_chain ?? '', name: result.store_name ?? '', address: result.store_address ?? '' };
      const matchedId = result.store_id ?? (scanned.chain || scanned.name ? NEW : '');
      setScannedStore(scanned);
      setStoreId(matchedId);
      setStore(storeDetails(stores.find((s) => s.id === matchedId), scanned));
      setRows(
        result.items.map((it, key) => ({
          key,
          // Les lignes peu sûres sont décochées : à vérifier avant de les enregistrer
          apply: it.confidence !== 'basse',
          raw: it.raw,
          ingredientId: it.ingredient_id ?? '',
          name: it.name,
          quantity: String(it.quantity),
          unitPrice: it.unit_price != null ? String(it.unit_price) : '',
          confidence: it.confidence,
          ...rowDetails(
            ingredients.find((i) => i.id === it.ingredient_id),
            it
          )
        }))
      );
      setStep('review');
    } catch (err) {
      console.error(err);
      setStep('pick');
      setError("Échec de l'analyse du reçu.");
    }
  }

  // Changement de magasin : on reprend ses informations connues, complétées par celles du reçu
  function changeStore(id: string) {
    setStoreId(id);
    setStore(storeDetails(stores.find((s) => s.id === id), scannedStore));
  }

  function updateRow(key: number, changes: Partial<ResultRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  // Changement d'ingrédient rattaché : on reprend les informations déjà connues de cet ingrédient
  function changeIngredient(row: ResultRow, ingredientId: string) {
    const known = ingredients.find((i) => i.id === ingredientId);
    updateRow(row.key, {
      ingredientId,
      type: known?.type ?? row.type,
      categoryId: known?.category_id ?? row.categoryId,
      brandId: known?.brand_id ?? row.brandId
    });
  }

  const applied = rows.filter((r) => r.apply);
  // Magasin connu choisi, et informations que le reçu va lui ajouter (champ vide jusque-là)
  const knownStore = stores.find((s) => s.id === storeId);
  const storeCompletes = knownStore
    ? [!knownStore.chain && store.chain.trim() && 'enseigne', !knownStore.address && store.address.trim() && 'adresse'].filter(Boolean)
    : [];
  // Enseignes déjà utilisées, proposées pendant la saisie
  const chains = Array.from(new Set(stores.map((s) => s.chain).filter((c): c is string => !!c))).sort();
  const total = applied.reduce((sum, r) => sum + (Number(r.unitPrice) || 0) * (Number(r.quantity.replace(',', '.')) || 0), 0);

  // ENREGISTREMENT des lignes cochées
  async function save() {
    setError('');
    setStep('saving');
    const failures: string[] = [];

    // 1. Le magasin : créé s'il est nouveau, sinon complété avec les informations qui ont changé
    // (sans nom de magasin, l'enseigne sert de nom)
    const fields = { chain: store.chain.trim() || null, name: store.name.trim() || store.chain.trim(), address: store.address.trim() || null };
    let targetStoreId = storeId === NEW ? '' : storeId;
    if (storeId === NEW && fields.name) {
      const { data, error: storeError } = await supabase.from('stores').insert(fields).select().single();
      if (storeError || !data) failures.push(`magasin « ${storeLabel(fields)} »`);
      else targetStoreId = data.id;
    } else if (knownStore) {
      const changes: Record<string, string | null> = {};
      if ((knownStore.chain ?? '') !== (fields.chain ?? '')) changes.chain = fields.chain;
      if (fields.name && knownStore.name !== fields.name) changes.name = fields.name;
      if ((knownStore.address ?? '') !== (fields.address ?? '')) changes.address = fields.address;
      if (Object.keys(changes).length > 0) {
        const { error: storeError } = await supabase.from('stores').update(changes).eq('id', knownStore.id);
        if (storeError) failures.push(`informations du magasin « ${storeLabel(knownStore)} »`);
      }
    }

    // 2. Les nouvelles marques (une seule création par nom, même si plusieurs lignes l'utilisent)
    const createdBrands = new Map<string, string>();
    async function brandIdFor(row: ResultRow) {
      if (row.brandId !== NEW) return row.brandId;
      const name = row.brandName.trim();
      if (!name) return '';
      const key = name.toLowerCase();
      if (!createdBrands.has(key)) {
        const { data, error: brandError } = await supabase.from('brands').insert({ name }).select().single();
        if (brandError || !data) {
          failures.push(`marque « ${name} »`);
          return '';
        }
        createdBrands.set(key, data.id);
      }
      return createdBrands.get(key)!;
    }

    // 3. Chaque ligne : ingrédient créé ou complété, prix mémorisé, quantité à ajouter au stock
    const entries: { ingredientId: string; quantity: number }[] = [];
    // Correspondances validées (texte du reçu -> ingrédient), reconnues directement au prochain reçu
    const aliases: { raw: string; ingredientId: string }[] = [];
    for (const row of applied) {
      const brandId = await brandIdFor(row);
      let id = row.ingredientId;
      const known = ingredients.find((i) => i.id === id);
      if (!id) {
        const created = await createIngredient({ name: row.name, type: row.type, category_id: row.categoryId, brand_id: brandId });
        if (!created) {
          failures.push(`ingrédient « ${row.name} »`);
          continue;
        }
        id = created;
      } else if (known) {
        // Ingrédient connu : on enregistre seulement les informations qui ont changé (complétées ou corrigées)
        const changes: Record<string, string | null> = {};
        if ((known.category_id ?? '') !== row.categoryId) changes.category_id = row.categoryId || null;
        if ((known.brand_id ?? '') !== brandId) changes.brand_id = brandId || null;
        if ((known.type ?? '') !== row.type.trim()) changes.type = row.type.trim() || null;
        if (Object.keys(changes).length > 0) {
          const { error: updateError } = await supabase.from('ingredients').update(changes).eq('id', id);
          if (updateError) failures.push(`informations de « ${known.name} »`);
        }
      }

      if (targetStoreId && row.unitPrice) {
        const priceError = await saveIngredientPrice(id, targetStoreId, Number(row.unitPrice));
        if (priceError) failures.push(`prix de « ${row.name} »`);
      }

      const qty = normalizeQuantity(Number(row.quantity.replace(',', '.')), quantityRule(row.type));
      entries.push({ ingredientId: id, quantity: qty });
      aliases.push({ raw: row.raw, ingredientId: id });
    }

    rememberAliases(aliases);

    // 4. Les quantités achetées s'ajoutent au stock
    const inventoryError = await addToInventory(entries);
    if (inventoryError) {
      console.error(inventoryError);
      setStep('review');
      return setError(`L'inventaire n'a pas pu être mis à jour : ${inventoryError.message}`);
    }

    // 5. Le reçu compte dans le budget, si demandé
    if (countInBudget && total > 0) {
      await recordExpense(total, fields.name ? `Reçu ${storeLabel(fields)}` : 'Reçu');
    }

    if (failures.length > 0) {
      // L'inventaire est à jour, mais certains éléments n'ont pas pu être enregistrés : on le signale
      setStep('review');
      setRows([]);
      return setError(`Inventaire mis à jour, mais échec pour : ${failures.join(', ')}.`);
    }
    onDone();
  }

  // ----- ÉTAPE 1 : CHOIX DES PHOTOS -----
  if (step === 'pick' || step === 'analyzing') {
    return (
      <div>
        <p className="opacity-70 mb-4">
          Prends ton reçu en photo, bien à plat (jusqu&apos;à {MAX_PHOTOS} photos pour un long ticket). Les produits lus te
          seront proposés avant de mettre à jour l&apos;inventaire, les ingrédients et les prix.
        </p>

        <PhotoPicker photos={photos} max={MAX_PHOTOS} onAdd={addPhotos} onRemove={removePhoto} disabled={step === 'analyzing'} />

        {(error || photoError) && <p className="text-sm text-brick mb-3">{error || photoError}</p>}

        <button onClick={analyze} disabled={photos.length === 0 || step === 'analyzing'} className="btn-hand">
          {step === 'analyzing' ? `Lecture du reçu... ${Math.round(progress * 100)} %` : 'Lire le reçu'}
        </button>
        {step === 'analyzing' && (
          <p className="text-sm opacity-70 mt-2">
            Lecture gratuite sur ton appareil. La première fois, le moteur de lecture se télécharge (quelques Mo).
          </p>
        )}
      </div>
    );
  }

  // ----- ÉTAPE 2 : VÉRIFICATION DES PRODUITS LUS -----
  return (
    <div>
      {rows.length === 0 && !error && <p className="opacity-70 mb-4">Aucun produit lu sur ce reçu.</p>}

      {rows.length > 0 && (
        <>
          {/* MAGASIN : les prix lus sont mémorisés pour ce magasin, qui est créé ou complété
              avec l'enseigne, le nom et l'adresse lus sur le reçu */}
          <div className="mb-4 pb-4 border-b-2 border-dashed border-line">
            <label className="field-label">Magasin</label>
            <select value={storeId} onChange={(e) => changeStore(e.target.value)} className="input-hand w-full mb-3">
              <option value="">— (prix non mémorisés)</option>
              <option value={NEW}>+ Nouveau magasin</option>
              <StoreOptions stores={stores} />
            </select>
            {storeId && (
              <div className="flex flex-wrap items-end gap-3 text-sm">
                <div className="w-36">
                  <label className="field-label">Enseigne</label>
                  <input
                    value={store.chain}
                    onChange={(e) => setStore((s) => ({ ...s, chain: e.target.value }))}
                    list="receipt-chains"
                    placeholder="Carrefour"
                    className="input-hand w-full"
                  />
                  <datalist id="receipt-chains">
                    {chains.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="w-40">
                  <label className="field-label">Nom du magasin</label>
                  <input
                    value={store.name}
                    onChange={(e) => setStore((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Market Le Puy"
                    className="input-hand w-full"
                  />
                </div>
                <div className="flex-1 min-w-48">
                  <label className="field-label">Adresse</label>
                  <input
                    value={store.address}
                    onChange={(e) => setStore((s) => ({ ...s, address: e.target.value }))}
                    placeholder="optionnel"
                    className="input-hand w-full"
                  />
                </div>
                {storeCompletes.length > 0 && <span className="text-herb text-xs w-full">complète : {storeCompletes.join(', ')}</span>}
              </div>
            )}
          </div>

          <p className="opacity-70 mb-3 text-sm">
            Vérifie chaque ligne : la quantité <strong>s&apos;ajoute</strong> au stock. Catégorie, marque et unité complètent
            l&apos;ingrédient. Les lignes peu sûres (en orange) sont décochées.
          </p>

          <ul className="divide-y-2 divide-dashed divide-line text-sm mb-4">
            {rows.map((row) => {
              const known = ingredients.find((i) => i.id === row.ingredientId);
              const rule = quantityRule(row.type);
              // Informations que la ligne va ajouter à un ingrédient connu (champ vide jusque-là)
              const completes = known
                ? [
                    !known.category_id && row.categoryId && 'catégorie',
                    !known.brand_id && row.brandId && 'marque',
                    !known.type && row.type.trim() && 'unité'
                  ].filter(Boolean)
                : [];
              return (
                <li key={row.key} className={`py-3 ${row.confidence === 'basse' ? 'text-orange-500' : ''}`}>
                  {/* Ligne 1 : case, ingrédient rattaché, quantité, prix unitaire */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <input
                      type="checkbox"
                      checked={row.apply}
                      onChange={(e) => updateRow(row.key, { apply: e.target.checked })}
                      className="w-4 h-4 accent-brick"
                      aria-label={`Enregistrer ${row.name}`}
                    />
                    <select
                      value={row.ingredientId}
                      onChange={(e) => changeIngredient(row, e.target.value)}
                      className="input-hand flex-1 min-w-40"
                    >
                      <option value="">+ Nouveau : {row.name}</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        step={rule.step}
                        min={0}
                        value={row.quantity}
                        onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                        className="input-hand w-16 text-right"
                        aria-label={`Quantité de ${row.name}`}
                      />
                      <span className="opacity-60">{rule.unit}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="prix ?"
                        value={row.unitPrice}
                        onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                        className="input-hand w-20 text-right"
                        aria-label={`Prix unitaire de ${row.name}`}
                      />
                      <span className="opacity-60">€</span>
                    </span>
                  </div>

                  {/* Ligne 2 : nom (nouvel ingrédient), catégorie, marque, unité */}
                  <div className="flex flex-wrap items-center gap-2 mt-2 pl-7 text-xs">
                    {!row.ingredientId && (
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(row.key, { name: e.target.value })}
                        className="input-hand w-36"
                        aria-label="Nom du nouvel ingrédient"
                      />
                    )}
                    <select
                      value={row.categoryId}
                      onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                      className="input-hand w-36"
                      aria-label="Catégorie"
                    >
                      <option value="">Catégorie —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.brandId}
                      onChange={(e) => updateRow(row.key, { brandId: e.target.value })}
                      className="input-hand w-36"
                      aria-label="Marque"
                    >
                      <option value="">Marque —</option>
                      {row.brandName && <option value={NEW}>+ Nouvelle : {row.brandName}</option>}
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={row.type}
                      onChange={(e) => updateRow(row.key, { type: e.target.value })}
                      list="receipt-types"
                      placeholder="unité"
                      className="input-hand w-24"
                      aria-label="Unité"
                    />
                    {completes.length > 0 && <span className="text-herb">complète : {completes.join(', ')}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <datalist id="receipt-types">
            {TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <p className="font-bold text-right mb-3">Total des lignes cochées : {total.toFixed(2)} €</p>
          <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={countInBudget}
              onChange={(e) => setCountInBudget(e.target.checked)}
              className="w-4 h-4 accent-brick"
            />
            Compter ce reçu dans le budget (inutile si tu valides aussi la liste de courses correspondante)
          </label>
        </>
      )}

      {error && <p className="text-sm text-brick mb-3">{error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        {rows.length > 0 && (
          <button onClick={save} disabled={step === 'saving' || applied.length === 0} className="btn-hand">
            {step === 'saving' ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        )}
        {rows.length === 0 && error ? (
          <button onClick={onDone} className="btn-hand">
            Fermer
          </button>
        ) : (
          <button onClick={() => setStep('pick')} disabled={step === 'saving'} className="btn-ghost">
            reprendre les photos
          </button>
        )}
      </div>
    </div>
  );
}
