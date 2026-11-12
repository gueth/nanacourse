'use client';

import Link from 'next/link';
import { RewardsCorner } from '@/components/gazette/ChallengeCorner';
import ShoppingReceipts from '@/components/ShoppingReceipts';
import { KitchenManager } from '@/components/KitchenManager';
import { unlockCreditsAudio } from '@/lib/creditsAudio';

// Page des courses (/course), ouverte depuis le menu des cartes du jour : le ticket de caisse de la liste de courses
// active et les coupons à gagner avec les points des défis (les défis en cours restent dans Paramètres > Défis).

// LES COURSES, FAÇON APPLICATION DE CUISINE (loin du journal) :
// fond crème, encre vert olive, grandes cartes arrondies, pilules, caractères sans empattements (classe .cuisine).
export const CUISINE_BG = '#fbf7ef';
export const CUISINE_INK = '#2e3a24';
const CUISINE_FONT = { fontFamily: 'var(--font-cuisine), system-ui, sans-serif' };
// Coupons aux couleurs de la cuisine : pêche, sauge, miel ; trou beige
const KITCHEN_COUPONS = {
  ink: CUISINE_INK,
  tones: ['#fcd6bd', '#dfe6cf', '#f6dc96'],
  hole: '#d9d0bf',
  font: CUISINE_FONT,
  kicker: { ...CUISINE_FONT, fontStyle: 'italic', fontSize: 14 }
};

// Titre de rubrique de la page des courses
function KitchenTitle({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-10 flex items-end justify-between gap-3">
      <h2 className="text-[22px] font-bold leading-tight tracking-tight">{children}</h2>
      {note && <span className="shrink-0 pb-0.5 text-[12px] opacity-60">{note}</span>}
    </div>
  );
}

export function KitchenPage({ today }: { today: Date | null }) {
  const day = today?.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="cuisine mx-auto max-w-[430px] px-4 pt-4">
      {/* EN-TÊTE : la date et la question du jour (le retour se fait par le menu du bas) */}
      <p className="mt-2 text-[13px] capitalize opacity-60">{day ?? ' '}</p>
      <h1 className="mt-1 text-[34px] font-bold leading-[1.05] tracking-tight">
        Qu&apos;est-ce qu&apos;on <span className="font-normal italic">mange</span> ?
      </h1>

      {/* MENU : gérer les ingrédients, les catégories et les supermarchés */}
      <KitchenManager />

      {/* COURSES : la liste active (ou le panier vide pour en créer une) */}
      <div id="ticket" className="pt-6">
        <ShoppingReceipts theme="cuisine" />
      </div>

      {/* BONS D'ACHAT : récupérés avec les points des défis réussis */}
      <RewardsCorner ribbon={(title) => <KitchenTitle>{title}</KitchenTitle>} variant="cuisine" palette={KITCHEN_COUPONS} />

      {/* PIED DE PAGE */}
      <div className="mt-10 text-center">
        <p className="text-[22px] italic">Bon appétit !</p>
        {/* Les crédits (le toucher déverrouille le son, la musique de la page démarre toute seule) */}
        <Link
          href="/credits"
          onClick={() => unlockCreditsAudio()}
          className="mt-4 inline-block rounded-full bg-[#ebe3d5] px-4 py-2 text-[12px] font-medium"
        >
          Crédits
        </Link>
      </div>
    </div>
  );
}
