'use client';

import { Suspense, useState } from 'react';
import { ArrowLeft, ReceiptText } from 'lucide-react';
import Modal from '@/components/Modal';
import ReceiptScan from '@/components/ReceiptScan';
import { STORE_SELECT } from '@/lib/stores';
import { useCached } from '@/lib/cache';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Category, Chain, IngredientWithRelations, Store } from '@/lib/types';
import CategoriesSettings from '@/components/settings/CategoriesSettings';
import IngredientsSettings from '@/components/settings/IngredientsSettings';
import StoresSettings from '@/components/settings/StoresSettings';
import ListsSettings from '@/components/settings/ListsSettings';
import ChallengesSettings from '@/components/settings/ChallengesSettings';

// Les onglets de la page Paramètres
const TABS = [
  { id: 'categories', label: 'Catégories' },
  { id: 'stores', label: 'Supermarchés' },
  { id: 'ingredients', label: 'Ingrédients' },
  { id: 'lists', label: 'Listes' },
  { id: 'defis', label: 'Défis' }
] as const;

type TabId = (typeof TABS)[number]['id'];

// Charge en une fois tout ce dont les onglets Catégories, Supermarchés et Ingrédients ont besoin
function fetchAll() {
  return Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('stores').select(STORE_SELECT).order('name'),
    supabase
      .from('ingredients')
      .select(`*, category:categories(*), prices:ingredient_prices(*, store:stores(${STORE_SELECT}))`)
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
  // CHARGEMENT (ET RECHARGEMENT APRÈS CHAQUE MODIFICATION) DES DONNÉES
  // Gardées en mémoire entre deux visites (lib/cache) : affichées tout de suite, puis rechargées en arrière-plan
  const query = useCached('courses:parametres', async () => {
    const [{ data: cats }, { data: sts }, { data: ings, error }, { data: chs }] = await fetchAll();
    if (error) console.error(error);
    return {
      categories: (cats as Category[]) ?? [],
      stores: (sts as Store[]) ?? [],
      chains: (chs as Chain[]) ?? [],
      ingredients: (ings as unknown as IngredientWithRelations[]) ?? []
    };
  });
  const loadAll = query.reload;
  // Cadre du scan de reçu ouvert ou non
  const [receiptOpen, setReceiptOpen] = useState(false);

  const data = query.data;

  // Contenu du dossier ouvert
  function content(id: TabId) {
    if (!data) return <p>Chargement...</p>;
    const { categories, stores, chains, ingredients } = data;
    switch (id) {
      case 'categories':
        return <CategoriesSettings categories={categories} onChange={loadAll} />;
      case 'stores':
        return <StoresSettings stores={stores} chains={chains} onChange={loadAll} />;
      case 'ingredients':
        return <IngredientsSettings ingredients={ingredients} categories={categories} stores={stores} onChange={loadAll} />;
      // Les listes chargent elles-mêmes leurs données (avec leurs articles)
      case 'lists':
        return <ListsSettings />;
      // Les défis chargent eux-mêmes leurs données (défis, points, bons récupérés)
      case 'defis':
        return <ChallengesSettings />;
    }
  }

  // UN CLASSEUR : les dossiers roses sont empilés les uns sous les autres. D'un dossier fermé on ne voit que le bord
  // du haut et son onglet, décalé d'un dossier à l'autre comme des intercalaires. Toucher un dossier l'ouvre :
  // il s'agrandit et pousse les autres en haut et en bas, où il ne reste que leur bord.
  return (
    <div className="classeur fixed inset-0 flex flex-col">
      {/* En haut de la page, au-dessus des dossiers : retour, et scan d'un reçu
          (il met à jour les ingrédients, leurs prix et les magasins) */}
      <div className="classeur-bar flex shrink-0 items-center justify-between gap-2 whitespace-nowrap px-4 sm:px-6">
        <button type="button" onClick={() => router.back()} className="folder-small inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Retour
        </button>
        <button type="button" onClick={() => setReceiptOpen(true)} className="folder-small inline-flex items-center gap-1">
          <ReceiptText size={14} /> Scanner un reçu
        </button>
      </div>
      {TABS.map((t, i) => {
        const open = tab === t.id;
        // Onglets en escalier, de gauche à droite
        const tabLeft = `calc(10px + ${i} * (100% - 20px - var(--tab-w)) / ${TABS.length - 1})`;
        return (
          <section key={t.id} className={`folder ${open ? 'folder-open' : ''}`} style={{ zIndex: i + 1 }} aria-label={t.label}>
            {/* Bord du dossier, avec l'onglet qui dépasse en haut et son étiquette */}
            <button
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={open ? 'page' : undefined}
              aria-label={open ? `${t.label} (ouvert)` : `Ouvrir ${t.label}`}
              className="folder-spine"
            >
              <span className="folder-bump" style={{ left: tabLeft }}>
                <span className="folder-label">{t.label}</span>
              </span>
            </button>

            {/* Intérieur du dossier : seulement celui qui est ouvert */}
            <div className="folder-body">
              {open && (
                <div className="folder-content h-full overflow-y-auto overscroll-contain px-4 pb-10 pt-5 sm:px-6">
                  {/* En-tête : nom de l'application et titre du dossier */}
                  <div className="mx-auto max-w-3xl">
                  <p className="folder-script text-[26px] leading-none">nana</p>
                  <h1 className="mb-5 mt-1 leading-none">
                    <span className="folder-serif text-[34px] sm:text-[44px]">mes </span>
                    <span className="folder-script text-[42px] sm:text-[54px]">{t.label.toLowerCase()}</span>
                  </h1>
                  {content(t.id)}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}

      {receiptOpen && data && (
        <Modal title="Scanner un reçu" onClose={() => setReceiptOpen(false)} wide>
          <ReceiptScan
            ingredients={data.ingredients}
            onDone={() => {
              setReceiptOpen(false);
              loadAll();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
