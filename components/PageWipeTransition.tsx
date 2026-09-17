'use client';

import { useEffect } from 'react';

const BARS = 9;
const BAR_ANIM_MS = 2200;
const STAGGER_MS = 26; // reste sous la marge calculée plus bas, pour garantir un instant de recouvrement total
const OVERLAP = 2; // points de % de hauteur en plus par barre, pour ne jamais laisser de liseré entre elles

// Géométrie du conteneur tourné (toutes ces valeurs sont en % de la largeur de l'écran, Vw) :
const CONTAINER_LEFT = -0.5; // left: -50%
const CONTAINER_WIDTH = 2; // width: 200%
const BAR_WIDTH = CONTAINER_WIDTH * 1.4; // largeur de chaque barre : 140% du conteneur, pour l'allonger

// Doit rester synchronisé avec les valeurs 0%/100% de @keyframes bar-sweep (globals.css).
// translateX est exprimé en % de la largeur PROPRE de la barre. La barre recouvre tout
// l'écran tant que son bord gauche est <= 0 et son bord droit >= Vw ; on en déduit la plage
// de translateX (en %) qui correspond à un recouvrement total.
const START_PCT = -140;
const END_PCT = 180;
const RANGE = END_PCT - START_PCT;
const COVER_LOWER_PCT = (100 * (1 - CONTAINER_LEFT - BAR_WIDTH)) / BAR_WIDTH;
const COVER_START_FRACTION = (COVER_LOWER_PCT - START_PCT) / RANGE;

// Changement de page dès le tout début de la fenêtre de recouvrement (pas au milieu) :
// ça laisse le maximum de temps au chargement réel de la page suivante (requêtes Supabase,
// rendu) pour se terminer avant que les barres n'aient fini de se retirer.
const COVER_MS = (BARS - 1) * STAGGER_MS + COVER_START_FRACTION * BAR_ANIM_MS;

// Durée totale : toutes les barres ont fini de ressortir
const TOTAL_MS = (BARS - 1) * STAGGER_MS + BAR_ANIM_MS;

type Props = {
  active: boolean;
  onCovered: () => void;
  onFinished: () => void;
};

export function PageWipeTransition({ active, onCovered, onFinished }: Props) {
  useEffect(() => {
    if (!active) return;
    const coverTimer = setTimeout(onCovered, COVER_MS);
    const finishTimer = setTimeout(onFinished, TOTAL_MS);
    return () => {
      clearTimeout(coverTimer);
      clearTimeout(finishTimer);
    };
  }, [active, onCovered, onFinished]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none">
      <div
        className="absolute"
        style={{ top: '-5%', left: `${CONTAINER_LEFT * 100}%`, width: `${CONTAINER_WIDTH * 100}%`, height: '130%', transform: 'rotate(30deg)' }}
      >
        {Array.from({ length: BARS }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 bg-paper rounded-full"
            style={{
              width: `${(BAR_WIDTH / CONTAINER_WIDTH) * 100}%`,
              top: `${(i / BARS) * 100 - OVERLAP / 2}%`,
              height: `${100 / BARS + OVERLAP}%`,
              animation: `bar-sweep ${BAR_ANIM_MS}ms ease-in-out ${i * STAGGER_MS}ms both`
            }}
          />
        ))}
      </div>
    </div>
  );
}
