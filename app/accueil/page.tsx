'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArcNav } from '@/components/ArcNav';
import { DateBanner } from '@/components/DateBanner';
import { DefiCards, DEFIS_HEIGHT } from '@/components/DefiCards';
import { MessagesButton } from '@/components/MessagesButton';
import { CoursesSection, COURSES_HEIGHT, FinanceSection, FINANCE_HEIGHT, SLATE } from '@/components/HomeThemes';
import { ScaledStage } from '@/components/ScaledStage';
import { usePageTransition } from '@/components/PageTransitionProvider';
import { ShoppingCart, Wallet, Shirt, Settings } from "lucide-react";

// Vignette (412 x 170 réduite à 380 de large, soit ~157 de haut) avec une marge de 16 sur les côtés
// et en bas, mais seulement 6 en haut pour la rapprocher du haut de l'écran,
// + la ligne de cartes "Liste de défis" + les deux sections thématiques
const BANNER_MARGIN = 16;
const BANNER_TOP = 6;
const BANNER_HEIGHT = BANNER_TOP + BANNER_MARGIN + Math.round((170 * (412 - BANNER_MARGIN * 2)) / 412);

export default function Accueil() {
  const router = useRouter();
  const { startTransition } = usePageTransition();

  useEffect(() => {
    router.prefetch('/course');
  }, [router]);

  return (
    <>
    <ScaledStage height={BANNER_HEIGHT + DEFIS_HEIGHT + FINANCE_HEIGHT + COURSES_HEIGHT}>
     {/* Fond bleu ardoise, le même que la section finances, pour que le haut se fonde avec elle */}
     <div className="relative h-full w-full" style={{ backgroundColor: SLATE }}>
        {/* VIGNETTE DU HAUT : rayures bleues et date du jour */}
        <div style={{ padding: BANNER_MARGIN, paddingTop: BANNER_TOP }}>
          <DateBanner />
        </div>

        {/* LISTE DE DÉFIS : une ligne de cartes à aile, qui défile horizontalement */}
        <DefiCards />

        {/* THÈMES QUI SE SUIVENT AU DÉFILEMENT : finances puis courses */}
        <div>
          <FinanceSection />
          <CoursesSection onOpen={() => startTransition('/course')} />
        </div>

        {/* MENU EN HAUT À DROITE, posé sur la vignette (position recalée sur la vignette réduite) : déploie la navigation circulaire */}
          <ArcNav
            className="left-[368px] top-[37px]"
            items={[
              { label: "Parametre", href: "/parametre", icon: <Settings size={20} /> },
              { label: "Dressing", href: "/dressing", icon: <Shirt size={20} /> },
              { label: "Banque", href: "/banque", icon: <Wallet size={20} />},
              {
                label: "Course",
                href: "/course",
                icon: <ShoppingCart size={20} />,
                onClick: (e) => {
                  e.preventDefault();
                  startTransition('/course');
                }
              }
            ]}
          />
    </div>
    </ScaledStage>

    {/* LETTRE FIXÉE EN BAS À DROITE : messagerie de nana, hors de ScaledStage pour rester fixe au défilement */}
    <MessagesButton />
    </>
  );
}
