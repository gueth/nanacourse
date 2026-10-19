'use client';

import { Suspense, useEffect, useState } from 'react';
import { STORE_SELECT } from '@/lib/stores';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Brand, Category, Chain, IngredientWithRelations, Store } from '@/lib/types';
import CategoriesSettings from '@/components/settings/CategoriesSettings';
import BrandsSettings from '@/components/settings/BrandsSettings';
import IngredientsSettings from '@/components/settings/IngredientsSettings';
import StoresSettings from '@/components/settings/StoresSettings';
import ListsSettings from '@/components/settings/ListsSettings';

// Les onglets de la page Paramètres
const TABS = [
  { id: 'categories', label: 'Catégories' },
  { id: 'brands', label: 'Marques' },
  { id: 'stores', label: 'Supermarchés' },
  { id: 'ingredients', label: 'Ingrédients' },
  { id: 'lists', label: 'Listes' }
] as const;

type TabId = (typeof TABS)[number]['id'];

// Charge en une fois tout ce dont les onglets Catégories, Marques, Supermarchés et Ingrédients ont besoin
function fetchAll() {
  return Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('brands').select('*').order('name'),
    supabase.from('stores').select(STORE_SELECT).order('name'),
    supabase
      .from('ingredients')
      .select(`*, category:categories(*), brand:brands(*), prices:ingredient_prices(*, store:stores(${STORE_SELECT}))`)
      .order('name'),
    // Enseignes (libellé + couleur), gérées dans l'onglet Supermarchés
    supabase.from('chains').select('*').order('name')
  ]);
}

// useSearchParams doit être entouré d'un <Suspense> (sinon la compilation de production échoue)
export default function SettingsPage() {
  return (
    <Suspense fallback={<p>Chargement...</p>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  // Onglet affiché : celui indiqué dans l'adresse (ex : /settings?tab=lists), sinon Catégories.
  // Changer d'onglet met à jour l'adresse : un lien comme "Gérer mes listes" ouvre donc directement le bon onglet.
  const searchParams = useSearchParams();
  const router = useRouter();
  const asked = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === asked) ? (asked as TabId) : 'categories';
  function setTab(id: TabId) {
    router.replace(`/settings?tab=${id}`, { scroll: false });
  }
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [ingredients, setIngredients] = useState<IngredientWithRelations[]>([]);

  // CHARGEMENT (ET RECHARGEMENT APRÈS CHAQUE MODIFICATION) DES DONNÉES
  // Range les données reçues dans les états de la page
  function applyData([{ data: cats }, { data: brs }, { data: sts }, { data: ings, error }, { data: chs }]: Awaited<ReturnType<typeof fetchAll>>) {
    if (error) console.error(error);
    setChains(chs ?? []);
    setCategories(cats ?? []);
    setBrands(brs ?? []);
    setStores(sts ?? []);
    setIngredients((ings as unknown as IngredientWithRelations[]) ?? []);
    setLoading(false);
  }

  async function loadAll() {
    applyData(await fetchAll());
  }

  useEffect(() => {
    fetchAll().then(applyData);
  }, []);

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      <h1 className="title-hand text-3xl sm:text-4xl mb-3">Paramètres</h1>

      {/* BARRE D'ONGLETS : une seule ligne, qui défile horizontalement sur téléphone ; l'onglet actif est mis en avant */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar border-b-2 border-ink mb-5 -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`nav-tab shrink-0 whitespace-nowrap ${tab === t.id ? '' : 'opacity-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesSettings categories={categories} onChange={loadAll} />}
      {tab === 'brands' && <BrandsSettings brands={brands} onChange={loadAll} />}
      {tab === 'stores' && <StoresSettings stores={stores} chains={chains} onChange={loadAll} />}
      {/* Les listes chargent elles-mêmes leurs données (avec leurs articles) */}
      {tab === 'lists' && <ListsSettings />}
      {/* Le budget charge lui-même ses réglages et les dépenses de la période */}
      {tab === 'ingredients' && (
        <IngredientsSettings
          ingredients={ingredients}
          categories={categories}
          brands={brands}
          stores={stores}
          onChange={loadAll}
        />
      )}
    </div>
  );
}
