'use client';

import { useEffect, useState } from 'react';
import { applySystemBarsColor } from '@/lib/barsColor';

// Fondu entre deux pages : un voile de la couleur de la page de départ apparaît par-dessus elle, on change de page,
// le voile prend la couleur de la page d'arrivée, puis il s'efface. Jamais de bleu par défaut entre les deux.
// La couleur d'une page est celle de son fond, lue à l'écran (lib/barsColor) : le voile est ignoré pendant cette
// lecture (data-bars-ignore), pour que les barres du téléphone suivent elles aussi la page dessous.
// Le voile reste opaque tant que la page suivante n'est pas affichée ("ready") : sinon, si elle tarde,
// on reverrait la page de départ entre le fondu d'entrée et celui de sortie.
// Le composant est monté à chaque transition (et démonté à la fin) : il repart toujours de la phase d'entrée.
const FADE_IN_MS = 250;
const HOLD_MS = 160; // palier opaque une fois la page suivante affichée : le voile passe à sa couleur
const FADE_OUT_MS = 350;
// Sécurité : si la page suivante ne s'affiche jamais, le voile s'efface quand même au bout de ce délai
const MAX_WAIT_MS = 6000;

type Props = {
  ready: boolean;
  onCovered: () => void;
  onFinished: () => void;
};

// Couleur du fond de la page affichée (posée sur body par lib/barsColor)
function pageColor() {
  const body = document.body;
  return body.style.backgroundColor || getComputedStyle(body).backgroundColor || 'var(--color-backdrop)';
}

export function PageFadeTransition({ ready, onCovered, onFinished }: Props) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');
  // Couleur du voile : celle de la page de départ, puis celle de la page d'arrivée
  const [color, setColor] = useState(pageColor);

  // 1. Fondu d'entrée, puis changement de page sous le voile opaque
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('hold');
      onCovered();
    }, FADE_IN_MS);
    return () => clearTimeout(timer);
  }, [onCovered]);

  // 2. Page suivante affichée : le voile prend sa couleur (dès qu'elle est dessinée), court palier, puis fondu de sortie
  useEffect(() => {
    if (phase !== 'hold') return;
    if (!ready) {
      const timer = setTimeout(() => setPhase('out'), MAX_WAIT_MS);
      return () => clearTimeout(timer);
    }
    const frame = requestAnimationFrame(() => {
      applySystemBarsColor();
      setColor(pageColor());
    });
    const timer = setTimeout(() => setPhase('out'), HOLD_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [phase, ready]);

  // 3. Fin du fondu de sortie
  useEffect(() => {
    if (phase !== 'out') return;
    const timer = setTimeout(onFinished, FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [phase, onFinished]);

  const animation =
    phase === 'in' ? `page-fade-in ${FADE_IN_MS}ms ease-in both` : phase === 'out' ? `page-fade-out ${FADE_OUT_MS}ms ease-out both` : undefined;

  return (
    <div
      data-bars-ignore
      className="fixed inset-0 z-50 pointer-events-none"
      style={{ backgroundColor: color, transition: `background-color ${HOLD_MS - 40}ms ease-out`, animation }}
    />
  );
}
