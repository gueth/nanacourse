'use client';

import { useEffect, useState } from 'react';

// Fondu entre deux pages : un voile du bleu de fond de l'application (--color-backdrop, bleu du profil)
// apparaît par-dessus la page, on change de page, puis il s'efface.
// Le voile reste opaque tant que la page suivante n'est pas affichée ("ready") : sinon, si elle tarde,
// on reverrait la page de départ entre le fondu d'entrée et celui de sortie.
// Le composant est monté à chaque transition (et démonté à la fin) : il repart toujours de la phase d'entrée.
const FADE_IN_MS = 250;
const HOLD_MS = 120; // court palier opaque une fois la page suivante affichée, le temps qu'elle se dessine
const FADE_OUT_MS = 350;
// Sécurité : si la page suivante ne s'affiche jamais, le voile s'efface quand même au bout de ce délai
const MAX_WAIT_MS = 6000;

type Props = {
  ready: boolean;
  onCovered: () => void;
  onFinished: () => void;
};

export function PageFadeTransition({ ready, onCovered, onFinished }: Props) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  // 1. Fondu d'entrée, puis changement de page sous le voile opaque
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('hold');
      onCovered();
    }, FADE_IN_MS);
    return () => clearTimeout(timer);
  }, [onCovered]);

  // 2. Page suivante affichée (ou attente trop longue) : court palier, puis fondu de sortie
  useEffect(() => {
    if (phase !== 'hold') return;
    const timer = setTimeout(() => setPhase('out'), ready ? HOLD_MS : MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [phase, ready]);

  // 3. Fin du fondu de sortie
  useEffect(() => {
    if (phase !== 'out') return;
    const timer = setTimeout(onFinished, FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [phase, onFinished]);

  const animation =
    phase === 'in' ? `page-fade-in ${FADE_IN_MS}ms ease-in both` : phase === 'out' ? `page-fade-out ${FADE_OUT_MS}ms ease-out both` : undefined;

  return <div className="fixed inset-0 z-50 pointer-events-none" style={{ backgroundColor: 'var(--color-backdrop)', animation }} />;
}
