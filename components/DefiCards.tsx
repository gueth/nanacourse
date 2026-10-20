'use client';

import { PAPER } from '@/components/HomeThemes';

// Bandeau "Liste de défis" de l'accueil : une ligne de cartes qui défile horizontalement.
// Chaque carte est un rectangle aux coins arrondis, tracé à main levée, dont le coin
// haut-droit est remplacé par une petite aile. En px de référence (largeur 412).

export const DEFIS_HEIGHT = 190;

// Posées sur le fond bleu ardoise : trait et texte couleur papier
const INK = PAPER;

// Défis d'exemple, en attendant une vraie source de données
const DEFIS = ['Boire 1,5 L d’eau', 'Marcher 30 min', 'Cuisiner maison', 'Zéro dépense', 'Lire 10 pages'];

// Carte de 140 x 126 (cadre de 116 x 106, presque carré, un peu plus large que haut) :
// le cadre s'interrompt en haut à droite pour laisser passer l'aile
function WingCard({ label }: { label: string }) {
  return (
    <div className="relative h-[126px] w-[140px] shrink-0 snap-start">
      <svg className="absolute inset-0" width={140} height={126} viewBox="0 0 140 126" aria-hidden>
        <g fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          {/* Cadre aux coins arrondis réguliers : du bord haut (avant l'aile) jusqu'au bord droit (après l'aile) */}
          <path d="M88 14 H18 A12 12 0 0 0 6 26 V108 A12 12 0 0 0 18 120 H110 A12 12 0 0 0 122 108 V48" />
          {/* Aile : spirale au centre, qui s'enroule vers l'intérieur depuis le haut */}
          <path d="M106 12 C94 9 84 18 85 28 C86 38 97 42 104 37 C110 32 108 23 101 22 C95 21 93 28 98 30" />
          {/* Bord supérieur qui file vers la droite et finit en plume arrondie */}
          <path d="M106 12 Q121 7 136 8 C139 16 133 23 122 23" />
          {/* Deux plumes arrondies, en forme de "3" */}
          <path d="M117 26 C126 25 129 30 125 33 C122 36 116 35 113 34" />
          <path d="M111 38 C118 38 120 43 116 45 C113 47 108 46 105 45" />
        </g>
      </svg>
      <p
        className="absolute inset-x-[16px] top-[34px] bottom-[12px] flex items-center justify-center text-center text-[20px] leading-tight"
        style={{ color: INK, fontFamily: 'var(--font-caveat), cursive' }}
      >
        {label}
      </p>
    </div>
  );
}

export function DefiCards() {
  return (
    <section className="w-full" style={{ height: DEFIS_HEIGHT }}>
      <h2 className="px-4 text-center text-[34px] leading-none" style={{ color: PAPER, fontFamily: 'var(--font-script), cursive' }}>
        Liste de défis
      </h2>
      <div className="no-scrollbar mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scroll-px-4">
        {DEFIS.map((defi) => (
          <WingCard key={defi} label={defi} />
        ))}
      </div>
    </section>
  );
}
