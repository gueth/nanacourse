'use client';

import { useEffect, useState } from 'react';
import { Carrot, LayoutGrid, Store as StoreIcon } from 'lucide-react';
import Modal, { ModalVariantContext } from '@/components/Modal';
import { useCatalog } from '@/lib/coursesQueries';
import CategoriesSettings from '@/components/settings/CategoriesSettings';
import IngredientsSettings from '@/components/settings/IngredientsSettings';
import StoresSettings from '@/components/settings/StoresSettings';

// MENU DE LA PAGE DES COURSES : gérer les ingrédients, les catégories et les supermarchés
// (anciennement dans les Paramètres). Chaque bouton ouvre la gestion dans une grande popin au style cuisine ;
// les popins et confirmations ouvertes depuis là prennent aussi ce style (ModalVariantContext).
// /course?gerer=ingredients (ou categories, supermarches) ouvre directement la bonne gestion
// (anciens liens /ingredients et /stores).

const SECTIONS = [
  { id: 'ingredients', label: 'Ingrédients', icon: Carrot, tone: 'from-[#f9b08c] to-[#ef7d57]' },
  { id: 'categories', label: 'Catégories', icon: LayoutGrid, tone: 'from-[#c9d6a8] to-[#8fa868]' },
  { id: 'supermarches', label: 'Supermarchés', icon: StoreIcon, tone: 'from-[#f6dc96] to-[#e5b14c]' }
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export function KitchenManager() {
  const [open, setOpen] = useState<SectionId | null>(null);

  // Ouverture directe depuis l'adresse, puis on retire le paramètre
  useEffect(() => {
    const url = new URL(window.location.href);
    const asked = url.searchParams.get('gerer');
    if (!asked || !SECTIONS.some((s) => s.id === asked)) return;
    url.searchParams.delete('gerer');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'adresse n'est lisible qu'une fois dans le navigateur
    setOpen(asked as SectionId);
  }, []);

  const section = SECTIONS.find((s) => s.id === open);
  return (
    <>
      {/* Le menu : trois tuiles colorées, côte à côte */}
      <nav aria-label="Gérer" className="mt-5 grid grid-cols-3 gap-2.5">
        {SECTIONS.map(({ id, label, icon: Icon, tone }) => (
          <button
            key={id}
            type="button"
            onClick={() => setOpen(id)}
            className={`flex flex-col items-start gap-3 rounded-[20px] bg-gradient-to-br ${tone} p-3 text-left text-[#2e3a24] shadow-[0_10px_22px_-16px_rgba(46,58,36,0.6)] transition-transform active:scale-[0.96]`}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-white/55" aria-hidden>
              <Icon size={17} />
            </span>
            <span className="text-[13px] font-semibold leading-tight">{label}</span>
          </button>
        ))}
      </nav>

      {section && (
        <ModalVariantContext.Provider value="cuisine">
          <Modal title={`Mes ${section.label.toLowerCase()}`} onClose={() => setOpen(null)} wide>
            <SectionContent id={section.id} />
          </Modal>
        </ModalVariantContext.Provider>
      )}
    </>
  );
}

// Contenu d'une gestion, avec les données du catalogue (rechargées après chaque modification)
function SectionContent({ id }: { id: SectionId }) {
  const query = useCatalog();
  const data = query.data;
  if (!data) return <p className="py-6 text-center opacity-60">Chargement…</p>;
  const { categories, stores, chains, ingredients } = data;
  switch (id) {
    case 'ingredients':
      return <IngredientsSettings ingredients={ingredients} categories={categories} stores={stores} onChange={query.reload} />;
    case 'categories':
      return <CategoriesSettings categories={categories} onChange={query.reload} />;
    case 'supermarches':
      return <StoresSettings stores={stores} chains={chains} onChange={query.reload} />;
  }
}
