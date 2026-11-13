'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ModalVariantContext } from '@/components/Modal';
import { CUISINE_BG, CUISINE_INK } from '@/components/KitchenPage';
import IngredientsSettings from '@/components/settings/IngredientsSettings';
import { useCatalog } from '@/lib/coursesQueries';

// Page des ingrédients : ouverte depuis la tuile « Ingrédients » de la page des courses. On y ajoute un ingrédient,
// on modifie ses prix par magasin et sa photo, ou on le supprime. Même style que la page des courses (cuisine),
// popins comprises (ModalVariantContext). Le menu du bas y reste, avec « Courses » allumé.
export default function IngredientsPage() {
  const query = useCatalog();
  const data = query.data;
  return (
    <ModalVariantContext.Provider value="cuisine">
      <div className="cuisine-page min-h-page overflow-x-clip pb-4" style={{ backgroundColor: CUISINE_BG, color: CUISINE_INK }}>
        <div className="cuisine mx-auto max-w-[430px] px-4 pt-4">
          {/* Retour à la page des courses, d'où s'ouvre cette page */}
          <Link href="/course" className="-ml-2 inline-flex items-center gap-1 px-2 py-2 text-[13px] font-medium opacity-70">
            <ArrowLeft size={16} /> Courses
          </Link>
          <h1 className="mt-1 text-[34px] font-bold leading-[1.05] tracking-tight">Mes ingrédients</h1>
          <div className="mt-5">
            {data ? (
              <IngredientsSettings ingredients={data.ingredients} categories={data.categories} stores={data.stores} onChange={query.reload} />
            ) : (
              <p className="py-6 text-center opacity-60">Chargement…</p>
            )}
          </div>
        </div>
      </div>
    </ModalVariantContext.Provider>
  );
}
