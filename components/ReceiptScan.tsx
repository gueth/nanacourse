'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Store as StoreIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, Ingredient, Store, Chain } from '@/lib/types';
import { createIngredient, saveIngredientPrice } from '@/lib/ingredients';
import { budgetFor, recordExpense, today } from '@/lib/budget';
import { useShoppingBudgets } from '@/lib/coursesQueries';
import { storeLabel, STORE_SELECT, chainIdFor } from '@/lib/stores';
import { normalizeQuantity, quantityRule, TYPE_SUGGESTIONS } from '@/lib/quantity';
import StoreOptions from '@/components/StoreOptions';
import PhotoPicker, { usePhotos } from '@/components/PhotoPicker';
// Lecture gratuite dans le navigateur (Tesseract.js) puis analyse du texte du reçu
import { readLines } from '@/lib/ocr';
import { countArticles, parseReceipt, printedTotal, type ReceiptItem, type ReceiptScanResult, type ReceiptSource } from '@/lib/receiptParser';
import { loadAliases, rememberAliases } from '@/lib/receiptAliases';

const MAX_PHOTOS = 4;
// Valeur des listes déroulantes pour "créer un nouvel élément" (marque, magasin)
const NEW = '__new__';

type Props = {
  ingredients: Ingredient[];
  // Appelée une fois le reçu enregistré (ingrédients, prix, magasin, budget)
  onDone: () => void;
  // Budget proposé pour compter le reçu (ex : celui de la liste de courses active) ; sinon le premier budget
  defaultBudgetId?: string | null;
  // Le reçu devient la nouvelle liste de courses active (ses articles, quantités et prix) : son prix sera compté
  // dans le budget à la validation de la liste, et non à l'enregistrement du reçu
  asActiveList?: boolean;
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
  sources: ReceiptSource[]; // lignes du ticket d'où vient le produit (extraits de la photo affichés pour vérifier)
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

// Extrait de la photo du ticket : la ligne d'où vient ce qui a été lu, pour comparer avec le texte proposé
function LineCrop({ src, box }: { src: string; box: ReceiptSource['box'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (!canvas) return;
      // Un peu de marge autour de la ligne
      const pad = (box.y1 - box.y0) * 0.3;
      const x = Math.max(0, box.x0 - pad);
      const y = Math.max(0, box.y0 - pad);
      const w = Math.min(img.naturalWidth - x, box.x1 - box.x0 + 2 * pad);
      const h = Math.min(img.naturalHeight - y, box.y1 - box.y0 + 2 * pad);
      if (w <= 0 || h <= 0) return;
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      canvas.getContext('2d')?.drawImage(img, x, y, w, h, 0, 0, w, h);
    };
    img.src = src;
  }, [src, box]);
  return <canvas ref={ref} role="img" aria-label="Extrait du ticket" className="block h-auto max-h-14 w-full rounded-sm border border-line bg-white object-contain object-left" />;
}

// Informations du magasin lues sur le reçu (enseigne, nom, adresse)
type StoreDetails = { chain: string; name: string; address: string };

// Informations proposées pour le magasin : celles du magasin connu quand elles sont renseignées
// (on ne les écrase pas), sinon celles lues sur le reçu (elles complètent le magasin).
function storeDetails(store: Store | undefined, scanned: StoreDetails): StoreDetails {
  return {
    chain: store?.chain?.name ?? scanned.chain,
    name: store?.name ?? scanned.name,
    address: store?.address ?? scanned.address
  };
}

// Scan d'un reçu de supermarché :
//  1. on prend ou choisit jusqu'à 4 photos du reçu ;
//  2. le texte est lu dans le navigateur (gratuit), puis analysé : magasin, produits, quantités, prix, marque ;
//     les correspondances déjà validées (texte du reçu -> ingrédient) sont reconnues directement ;
//  3. on vérifie / corrige chaque ligne ;
//  4. les lignes cochées : nouveaux ingrédients créés, informations des ingrédients connus complétées
//     ou corrigées, prix mémorisés pour ce magasin (il n'y a plus d'inventaire à mettre à jour) ;
//     le magasin est créé ou complété (enseigne, nom, adresse lus sur le reçu).
export default function ReceiptScan({ ingredients, onDone, defaultBudgetId, asActiveList = false }: Props) {
  const { photos, add: addPhotos, remove: removePhoto, error: photoError } = usePhotos(MAX_PHOTOS);
  const [step, setStep] = useState<'pick' | 'analyzing' | 'review' | 'saving'>('pick');
  const [error, setError] = useState('');
  // Avancement de la lecture des photos (0 à 1)
  const [progress, setProgress] = useState(0);

  // Listes de choix
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  // Enseignes connues (une enseigne lue sur le reçu est créée si elle n'existe pas)
  const [chainList, setChainList] = useState<Chain[]>([]);

  // Résultat modifiable
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [storeId, setStoreId] = useState(''); // '' = aucun, NEW = nouveau magasin créé avec les informations ci-dessous
  // Informations du magasin lues sur le reçu, et celles modifiables (proposées pour le magasin choisi)
  const [scannedStore, setScannedStore] = useState<StoreDetails>({ chain: '', name: '', address: '' });
  const [store, setStore] = useState<StoreDetails>({ chain: '', name: '', address: '' });
  // Compter le reçu dans le budget (décoché par défaut : la validation d'une liste le fait déjà)
  const [countInBudget, setCountInBudget] = useState(false);
  // Budget dans lequel le reçu compte ('' = le premier budget)
  const budgets = useShoppingBudgets().data;
  const [budgetId, setBudgetId] = useState(defaultBudgetId ?? '');
  // Affichage : informations du magasin dépliées, et détails dépliés par ligne (clé de la ligne)
  const [storeOpen, setStoreOpen] = useState(false);
  const [openDetails, setOpenDetails] = useState<Record<number, boolean>>({});
  // Lu sur le ticket : nombre d'articles annoncé et totaux imprimés (pour vérifier la lecture)
  const [articleCount, setArticleCount] = useState<number | null>(null);
  const [printedTotals, setPrintedTotals] = useState<ReceiptScanResult['totals']>([]);

  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('brands').select('*').order('name'),
      supabase.from('stores').select(STORE_SELECT).order('name'),
      supabase.from('chains').select('*').order('name')
    ]).then(([{ data: cats }, { data: brs }, { data: sts }, { data: chs }]) => {
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setStores(sts ?? []);
      setChainList(chs ?? []);
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
      const result = parseReceipt(lines, {
        ingredients,
        brands,
        // L'analyse compare les enseignes par leur libellé
        stores: stores.map((s) => ({ id: s.id, name: s.name, address: s.address, chain: s.chain?.name ?? null })),
        aliases: loadAliases()
      });
      if (result.items.length === 0) {
        setStep('pick');
        return setError('Aucun produit lu : reprends la photo bien à plat, nette et éclairée, le ticket en entier dans le cadre.');
      }
      const scanned = { chain: result.store_chain ?? '', name: result.store_name ?? '', address: result.store_address ?? '' };
      const matchedId = result.store_id ?? (scanned.chain || scanned.name ? NEW : '');
      setScannedStore(scanned);
      setArticleCount(result.article_count);
      setPrintedTotals(result.totals);
      setStoreId(matchedId);
      // Magasin nouveau : ses informations lues sont dépliées, pour être vérifiées
      setStoreOpen(matchedId === NEW);
      setOpenDetails({});
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
          sources: it.sources,
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
  // Enseignes connues, proposées pendant la saisie
  const chains = chainList.map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const total = applied.reduce((sum, r) => sum + (Number(r.unitPrice) || 0) * (Number(r.quantity.replace(',', '.')) || 0), 0);

  // ENREGISTREMENT des lignes cochées
  async function save() {
    setError('');
    setStep('saving');
    const failures: string[] = [];

    // 1. Le magasin : créé s'il est nouveau, sinon complété avec les informations qui ont changé
    // (sans nom de magasin, l'enseigne sert de nom). L'enseigne lue est retrouvée, ou créée si elle est nouvelle.
    const chainName = store.chain.trim();
    const chainId = await chainIdFor(chainName, chainList);
    if (chainName && !chainId) failures.push(`enseigne « ${chainName} »`);
    const fields = { chain_id: chainId, name: store.name.trim() || chainName, address: store.address.trim() || null };
    // Libellé du magasin, pour les messages et le budget
    const label = storeLabel({ name: fields.name, chain: chainName ? { name: chainName } : null });
    let targetStoreId = storeId === NEW ? '' : storeId;
    if (storeId === NEW && fields.name) {
      const { data, error: storeError } = await supabase.from('stores').insert(fields).select().single();
      if (storeError || !data) failures.push(`magasin « ${label} »`);
      else targetStoreId = data.id;
    } else if (knownStore) {
      const changes: Record<string, string | null> = {};
      if ((knownStore.chain_id ?? null) !== (fields.chain_id ?? null)) changes.chain_id = fields.chain_id;
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

    // 3. Chaque ligne : ingrédient créé ou complété, et prix mémorisé pour ce magasin
    // Correspondances validées (texte du reçu -> ingrédient), reconnues directement au prochain reçu
    const aliases: { raw: string; ingredientId: string }[] = [];
    // Articles de la nouvelle liste active (mode asActiveList) : prix de la ligne = prix unitaire x quantité
    const listItems: { ingredient_id: string; quantity: number; expected_price: number | null; store_id: string | null }[] = [];
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

      aliases.push({ raw: row.raw, ingredientId: id });
      const quantity = normalizeQuantity(Number(row.quantity.replace(',', '.')) || 1, quantityRule(row.type));
      const unit = Number(row.unitPrice);
      listItems.push({
        ingredient_id: id,
        quantity,
        expected_price: unit > 0 ? Math.round(unit * quantity * 100) / 100 : null,
        store_id: targetStoreId || null
      });
    }

    rememberAliases(aliases);

    // 4. Mode « liste active » : le reçu devient une liste de courses, activée à la place de l'ancienne
    if (asActiveList && listItems.length > 0) {
      const { error: offError } = await supabase.from('shopping_lists').update({ is_active: false }).eq('is_active', true);
      if (offError) failures.push("désactivation de l'ancienne liste");
      const listBudget = budgetFor(budgets, budgetId || null)?.settings.id;
      const { data: created, error: listError } = await supabase
        .from('shopping_lists')
        .insert({
          name: fields.name ? `Reçu ${label}` : 'Reçu',
          estimated_price: Math.round(total * 100) / 100,
          is_active: true,
          activated_at: new Date().toISOString(),
          date: today(),
          store_id: targetStoreId || null,
          ...(listBudget ? { budget_id: listBudget } : {})
        })
        .select()
        .single();
      if (listError || !created) failures.push('liste de courses du reçu');
      else {
        const { error: itemsError } = await supabase.from('shopping_list_items').insert(listItems.map((item) => ({ ...item, shopping_list_id: created.id })));
        if (itemsError) failures.push('articles de la liste du reçu');
      }
    }

    // 5. Le reçu compte dans le budget choisi, si demandé (pas en mode « liste active » : la validation de la liste le fera)
    if (!asActiveList && countInBudget && total > 0) {
      await recordExpense(total, fields.name ? `Reçu ${label}` : 'Reçu', budgetFor(budgets, budgetId || null)?.settings.id);
    }

    if (failures.length > 0) {
      // Le reste est enregistré, mais certains éléments n'ont pas pu l'être : on le signale
      setStep('review');
      setRows([]);
      return setError(`Reçu enregistré, mais échec pour : ${failures.join(', ')}.`);
    }
    onDone();
  }

  // Étapes du scan, affichées en haut : photos, vérification, enregistrement
  const stepIndex = step === 'pick' || step === 'analyzing' ? 0 : step === 'review' ? 1 : 2;
  const stepper = (
    <ol className="mb-4 grid grid-cols-3 gap-1 text-center text-[10px] uppercase tracking-[0.12em]" aria-label="Étapes du scan">
      {['Photos', 'Vérification', 'Enregistrement'].map((label, i) => (
        <li key={label} aria-current={i === stepIndex ? 'step' : undefined} className={i <= stepIndex ? '' : 'opacity-40'}>
          <span className={`mx-auto mb-1 block h-1.5 rounded-full ${i <= stepIndex ? 'bg-ink' : 'bg-line'}`} />
          {label}
        </li>
      ))}
    </ol>
  );

  // ----- ÉTAPE 1 : CHOIX DES PHOTOS -----
  if (step === 'pick' || step === 'analyzing') {
    const analyzing = step === 'analyzing';
    return (
      <div>
        {stepper}
        <p className="mb-3 text-sm opacity-70">
          Photographie le ticket <strong>bien à plat</strong>, en entier et bien éclairé. Pour un long ticket, prends-le en plusieurs
          fois (jusqu&apos;à {MAX_PHOTOS} photos).
        </p>

        <PhotoPicker photos={photos} max={MAX_PHOTOS} onAdd={addPhotos} onRemove={removePhoto} disabled={analyzing} />
        {photos.length > 0 && (
          <p className="-mt-2 mb-3 text-xs opacity-60">
            {photos.length} / {MAX_PHOTOS} photo{photos.length > 1 ? 's' : ''}
          </p>
        )}

        {(error || photoError) && <p className="mb-3 text-sm text-brick">{error || photoError}</p>}

        {analyzing ? (
          // Lecture en cours : barre d'avancement
          <div role="status" aria-live="polite">
            <div className="flex items-baseline justify-between text-sm">
              <span>Lecture du reçu…</span>
              <b>{Math.round(progress * 100)} %</b>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs opacity-60">
              Lecture gratuite sur ton téléphone. La première fois, le moteur de lecture se télécharge (quelques Mo).
            </p>
          </div>
        ) : (
          <button onClick={analyze} disabled={photos.length === 0} className="btn-hand w-full py-3">
            Lire le reçu
          </button>
        )}
      </div>
    );
  }

  // ----- ÉTAPE 2 : VÉRIFICATION DES PRODUITS LUS -----
  const toCheck = rows.filter((r) => r.confidence === 'basse').length;
  // Contrôles de la lecture, sur toutes les lignes lues (cochées ou non) : nombre d'articles et somme des prix,
  // comparés à ce qui est imprimé sur le ticket
  const readArticles = countArticles(rows.map((r) => ({ quantity: Number(r.quantity.replace(',', '.')) || 0, type: r.type.trim() || null })));
  const readSum = Math.round(rows.reduce((sum, r) => sum + (Number(r.unitPrice) || 0) * (Number(r.quantity.replace(',', '.')) || 0), 0) * 100) / 100;
  const ticketTotal = printedTotal(printedTotals);
  const distinctTotals = [...new Set(printedTotals.map((t) => t.amount.toFixed(2)))];
  const sumOk = ticketTotal !== null && Math.abs(readSum - ticketTotal) < 0.01;
  const countOk = articleCount !== null && readArticles === articleCount;
  const storeTitle = storeId === NEW ? `Nouveau : ${store.name || store.chain || 'magasin'}` : knownStore ? storeLabel(knownStore) : 'Aucun (prix non mémorisés)';
  return (
    <div>
      {stepper}
      {rows.length === 0 && !error && <p className="mb-4 opacity-70">Aucun produit lu sur ce reçu.</p>}

      {rows.length > 0 && (
        <>
          {/* Contrôles : enseigne (en gros en haut du ticket), nombre d'articles et total, comparés à ce qui a été lu */}
          <div className="mb-3 space-y-1.5 rounded-sm border-2 border-line px-3 py-2 text-sm">
            <p className="flex items-center gap-2">
              <StoreIcon size={15} className="shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">
                Enseigne : <b>{scannedStore.chain || 'non lue'}</b>
              </span>
            </p>
            <p className={`flex items-start gap-2 ${articleCount === null ? 'opacity-70' : countOk ? 'text-herb' : 'text-brick'}`}>
              {articleCount !== null && countOk ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
              <span>
                {articleCount === null
                  ? `${readArticles} article${readArticles > 1 ? 's' : ''} lu${readArticles > 1 ? 's' : ''} (le nombre d'articles n'est pas indiqué sur le ticket)`
                  : countOk
                    ? `${articleCount} articles, comme sur le ticket`
                    : `Le ticket indique ${articleCount} articles, ${readArticles} ont été lus : il manque ou il y a en trop ${Math.abs(articleCount - readArticles)} article${Math.abs(articleCount - readArticles) > 1 ? 's' : ''}.`}
              </span>
            </p>
            <p className={`flex items-start gap-2 ${ticketTotal === null ? 'opacity-70' : sumOk ? 'text-herb' : 'text-brick'}`}>
              {ticketTotal !== null && sumOk ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
              <span>
                {ticketTotal === null
                  ? `Somme des produits lus : ${readSum.toFixed(2)} € (total du ticket non lu)`
                  : sumOk
                    ? `Total du ticket ${ticketTotal.toFixed(2)} € = somme des produits lus`
                    : `Total du ticket ${ticketTotal.toFixed(2)} €, somme des produits lus ${readSum.toFixed(2)} € : écart de ${Math.abs(ticketTotal - readSum).toFixed(2)} €. Corrige les prix ou les quantités.`}
                {distinctTotals.length > 1 && (
                  <span className="block text-xs opacity-80">Totaux imprimés : {distinctTotals.map((t) => `${t.replace('.', ',')} €`).join(' · ')}</span>
                )}
              </span>
            </p>
            {/* Ligne du total sur la photo, pour vérifier sa lecture */}
            {printedTotals.length > 0 && photos[printedTotals[printedTotals.length - 1].source.image] && (
              <LineCrop src={photos[printedTotals[printedTotals.length - 1].source.image].url} box={printedTotals[printedTotals.length - 1].source.box} />
            )}
          </div>

          {/* Résumé de la lecture */}
          <p className="mb-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-line px-2 py-0.5">
              {rows.length} produit{rows.length > 1 ? 's' : ''} lu{rows.length > 1 ? 's' : ''}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5">{applied.length} à enregistrer</span>
            {toCheck > 0 && (
              <span className="rounded-full border border-orange-500 px-2 py-0.5 text-orange-600">
                {toCheck} à vérifier
              </span>
            )}
          </p>

          {/* MAGASIN : les prix lus sont mémorisés pour ce magasin, qui est créé ou complété
              avec l'enseigne, le nom et l'adresse lus sur le reçu. Replié pour laisser la place aux produits. */}
          <div className="mb-4 rounded-sm border-2 border-line">
            <button
              type="button"
              onClick={() => setStoreOpen((o) => !o)}
              aria-expanded={storeOpen}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
            >
              <StoreIcon size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-[0.15em] opacity-60">Magasin</span>
                <span className="block truncate font-bold">{storeTitle}</span>
              </span>
              <ChevronDown size={18} className={`shrink-0 transition-transform ${storeOpen ? 'rotate-180' : ''}`} />
            </button>
            {storeOpen && (
              <div className="grid gap-2 border-t-2 border-dashed border-line px-3 pb-3 pt-2 text-sm">
                <select value={storeId} onChange={(e) => changeStore(e.target.value)} className="input-hand w-full" aria-label="Magasin">
                  <option value="">— (prix non mémorisés)</option>
                  <option value={NEW}>+ Nouveau magasin</option>
                  <StoreOptions stores={stores} />
                </select>
                {storeId && (
                  <>
                    <label>
                      <span className="field-label">Enseigne</span>
                      <input
                        value={store.chain}
                        onChange={(e) => setStore((s) => ({ ...s, chain: e.target.value }))}
                        list="receipt-chains"
                        placeholder="Carrefour"
                        className="input-hand w-full"
                      />
                    </label>
                    <datalist id="receipt-chains">
                      {chains.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <label>
                      <span className="field-label">Nom du magasin</span>
                      <input
                        value={store.name}
                        onChange={(e) => setStore((s) => ({ ...s, name: e.target.value }))}
                        placeholder="Market Le Puy"
                        className="input-hand w-full"
                      />
                    </label>
                    <label>
                      <span className="field-label">Adresse</span>
                      <input
                        value={store.address}
                        onChange={(e) => setStore((s) => ({ ...s, address: e.target.value }))}
                        placeholder="optionnel"
                        className="input-hand w-full"
                      />
                    </label>
                    {storeCompletes.length > 0 && <span className="text-xs text-herb">complète : {storeCompletes.join(', ')}</span>}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Produits : une carte par ligne du reçu */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs opacity-70">Vérifie chaque produit. Les lignes peu sûres sont décochées.</p>
            <button
              type="button"
              onClick={() => setRows((r) => r.map((row) => ({ ...row, apply: applied.length !== rows.length })))}
              className="shrink-0 text-xs underline decoration-dotted underline-offset-4"
            >
              {applied.length === rows.length ? 'Tout décocher' : 'Tout cocher'}
            </button>
          </div>

          <ul className="mb-4 space-y-2 text-sm">
            {rows.map((row, index) => {
              const known = ingredients.find((i) => i.id === row.ingredientId);
              const rule = quantityRule(row.type);
              const low = row.confidence === 'basse';
              // Détails (catégorie, marque, unité) dépliés d'office pour un nouvel ingrédient
              const detailsOpen = openDetails[row.key] ?? !row.ingredientId;
              const lineTotal = (Number(row.unitPrice) || 0) * (Number(row.quantity.replace(',', '.')) || 0);
              // Informations que la ligne va ajouter à un ingrédient connu (champ vide jusque-là)
              const completes = known
                ? [
                    !known.category_id && row.categoryId && 'catégorie',
                    !known.brand_id && row.brandId && 'marque',
                    !known.type && row.type.trim() && 'unité'
                  ].filter(Boolean)
                : [];
              return (
                <li
                  key={row.key}
                  className={`rounded-sm border-2 p-2.5 transition-opacity ${low ? 'border-orange-400 border-l-[6px]' : 'border-line'} ${row.apply ? '' : 'opacity-55'}`}
                >
                  {/* Case (grande zone de toucher) et ingrédient rattaché */}
                  <div className="flex items-start gap-2">
                    <label className="-m-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={row.apply}
                        onChange={(e) => updateRow(row.key, { apply: e.target.checked })}
                        className="h-5 w-5 accent-brick"
                        aria-label={`Enregistrer ${row.name}`}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <select
                        value={row.ingredientId}
                        onChange={(e) => changeIngredient(row, e.target.value)}
                        className="input-hand w-full font-bold"
                        aria-label="Ingrédient"
                      >
                        <option value="">+ Nouveau : {row.name}</option>
                        {ingredients.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                      {/* Numéro dans l'ordre du ticket, texte lu, et extrait de la photo pour comparer */}
                      <p className="mt-0.5 truncate text-[11px] italic opacity-60">
                        <span className="not-italic font-bold">n° {index + 1}</span> · Lu : « {row.raw} »
                        {low && <span className="not-italic font-bold text-orange-600"> · à vérifier</span>}
                      </p>
                      {row.sources.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {row.sources.map((src, i) =>
                            photos[src.image] ? <LineCrop key={i} src={photos[src.image].url} box={src.box} /> : null
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quantité, prix unitaire et total de la ligne */}
                  <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2 pl-9">
                    <label>
                      <span className="field-label">Quantité</span>
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={rule.step}
                          min={0}
                          value={row.quantity}
                          onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                          className="input-hand w-full min-w-0 text-right"
                          aria-label={`Quantité de ${row.name}`}
                        />
                        <span className="shrink-0 opacity-60">{rule.unit}</span>
                      </span>
                    </label>
                    <label>
                      <span className="field-label">Prix unitaire</span>
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          placeholder="?"
                          value={row.unitPrice}
                          onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                          className="input-hand w-full min-w-0 text-right"
                          aria-label={`Prix unitaire de ${row.name}`}
                        />
                        <span className="shrink-0 opacity-60">€</span>
                      </span>
                    </label>
                    <span className="pb-1.5 text-right font-bold">{lineTotal > 0 ? `${lineTotal.toFixed(2)} €` : '—'}</span>
                  </div>

                  {/* Détails de l'ingrédient : nom (nouvel ingrédient), catégorie, marque, unité */}
                  <button
                    type="button"
                    onClick={() => setOpenDetails((d) => ({ ...d, [row.key]: !detailsOpen }))}
                    aria-expanded={detailsOpen}
                    className="ml-9 mt-1.5 flex items-center gap-1 py-1 text-xs opacity-70"
                  >
                    <ChevronDown size={14} className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
                    Catégorie, marque, unité
                    {completes.length > 0 && <span className="text-herb">· complète : {completes.join(', ')}</span>}
                  </button>
                  {detailsOpen && (
                    <div className="mt-1 grid grid-cols-2 gap-2 pl-9 text-xs">
                      {!row.ingredientId && (
                        <label className="col-span-2">
                          <span className="field-label">Nom du nouvel ingrédient</span>
                          <input value={row.name} onChange={(e) => updateRow(row.key, { name: e.target.value })} className="input-hand w-full" />
                        </label>
                      )}
                      <select
                        value={row.categoryId}
                        onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                        className="input-hand w-full min-w-0"
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
                        className="input-hand w-full min-w-0"
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
                        placeholder="unité (kg, pièce…)"
                        className="input-hand col-span-2 w-full"
                        aria-label="Unité"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <datalist id="receipt-types">
            {TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          {asActiveList && (
            <p className="mb-3 text-sm">
              Le reçu deviendra ta <strong>nouvelle liste de courses active</strong> (à la place de l&apos;actuelle) : son prix sera
              compté dans le budget quand tu la valideras.
            </p>
          )}
          {!asActiveList && (
            <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={countInBudget}
                onChange={(e) => setCountInBudget(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brick"
              />
              <span>
                Compter ce reçu dans le budget
                <span className="block text-xs opacity-60">Inutile si tu valides aussi la liste de courses correspondante.</span>
              </span>
            </label>
          )}
          {/* Budget auquel le reçu est associé (Profil > Budget) : celui du reçu, ou celui de la nouvelle liste active */}
          {(countInBudget || asActiveList) && budgets && budgets.length > 0 && (
            <label className="mb-3 block text-sm">
              <span className="field-label">{asActiveList ? 'Budget de la liste' : 'Budget'}</span>
              <select
                value={budgetFor(budgets, budgetId || null)?.settings.id ?? ''}
                onChange={(e) => setBudgetId(e.target.value)}
                className="input-hand w-full"
              >
                {budgets.map((b) => (
                  <option key={b.settings.id} value={b.settings.id}>
                    {b.settings.name} (reste {b.remaining.toFixed(2)} €)
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {error && <p className="mb-3 text-sm text-brick">{error}</p>}

      {/* Barre d'action fixée en bas de l'écran : total et enregistrement, toujours à portée de pouce */}
      <div className="sticky bottom-0 -mx-1 mt-2 rounded-sm border-t-2 border-line bg-white/90 px-2 pb-3 pt-2 backdrop-blur">
        {rows.length > 0 && (
          <p className="mb-2 flex items-baseline justify-between text-sm">
            <span className="opacity-70">
              {applied.length} produit{applied.length > 1 ? 's' : ''} coché{applied.length > 1 ? 's' : ''}
            </span>
            <b className="text-base">{total.toFixed(2)} €</b>
          </p>
        )}
        <div className="flex items-center gap-3">
          {rows.length > 0 && (
            <button onClick={save} disabled={step === 'saving' || applied.length === 0} className="btn-hand flex-1 py-3">
              {step === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          )}
          {rows.length === 0 && error ? (
            <button onClick={onDone} className="btn-hand flex-1 py-3">
              Fermer
            </button>
          ) : (
            <button onClick={() => setStep('pick')} disabled={step === 'saving'} className="btn-ghost shrink-0 text-sm">
              reprendre les photos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
