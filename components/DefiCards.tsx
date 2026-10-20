'use client';

import { PAPER, SLATE } from '@/components/HomeThemes';

// Bandeau "Liste de défis" de l'accueil : une ligne de cartes qui défile horizontalement.
// Chaque carte est un rectangle aux coins arrondis, tracé à main levée, dont le coin
// haut-droit est remplacé par une petite aile. En px de référence (largeur 412).

export const DEFIS_HEIGHT = 190;

// Cartes pleines couleur papier sur le fond bleu ardoise : traits et texte en bleu ardoise
const INK = SLATE;

// Défis d'exemple, en attendant une vraie source de données
const DEFIS = ['Boire 1,5 L d’eau', 'Marcher 30 min', 'Cuisiner maison', 'Zéro dépense', 'Lire 10 pages'];

// Carte de 140 x 126 (corps de 116 x 106, presque carré, un peu plus large que haut) : carte pleine
// couleur papier avec une ombre douce, une piqûre en pointillés qui s'interrompt sous l'aile,
// et l'aile pleine posée sur le coin haut-droit, dont la spirale et les plumes sont tracées en bleu ardoise
function WingCard({ label }: { label: string }) {
  return (
    <div className="relative h-[126px] w-[140px] shrink-0 snap-start">
      <svg className="absolute inset-0" width={140} height={126} viewBox="0 0 140 126" aria-hidden>
        <defs>
          <filter id="wing-card-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#1b2a4a" floodOpacity="0.35" />
          </filter>
        </defs>
        <g filter="url(#wing-card-shadow)" fill={PAPER}>
          {/* Corps de la carte */}
          <path d="M18 14 H110 A12 12 0 0 1 122 26 V108 A12 12 0 0 1 110 120 H18 A12 12 0 0 1 6 108 V26 A12 12 0 0 1 18 14Z" />
          {/* Silhouette de l'aile : bord supérieur, deux plumes arrondies, puis retour sous la spirale */}
          <path d="M106 12 Q121 7 136 8 C139 16 133 23 122 23 C129 26 129 33 120 34 C122 40 119 46 110 46 C99 46 86 40 85 28 C84 18 94 9 106 12Z" />
        </g>
        <g fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          {/* Piqûre intérieure, interrompue sous l'aile */}
          <path d="M17 20 H84 M12 26 V106 A8 8 0 0 0 20 114 H108 A8 8 0 0 0 116 106 V50" strokeDasharray="2 3" strokeWidth={0.9} />
          {/* Spirale au centre de l'aile, qui s'enroule vers l'intérieur depuis le haut */}
          <path d="M106 12 C94 9 84 18 85 28 C86 38 97 42 104 37 C110 32 108 23 101 22 C95 21 93 28 98 30" />
          {/* Bord supérieur et plumes en forme de "3" */}
          <path d="M106 12 Q121 7 136 8 C139 16 133 23 122 23" />
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
