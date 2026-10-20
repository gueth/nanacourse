'use client';

import { useEffect } from 'react';

// Fondu : un voile beige apparaît par-dessus la page, on change de page, puis il s'efface.
// Doit rester synchronisé avec les paliers de @keyframes page-fade (globals.css).
const FADE_IN_MS = 500;
const HOLD_MS = 150; // court palier opaque, laisse à la page suivante le temps de s'afficher
const FADE_OUT_MS = 700;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

type Props = {
  active: boolean;
  onCovered: () => void;
  onFinished: () => void;
};

export function PageFadeTransition({ active, onCovered, onFinished }: Props) {
  useEffect(() => {
    if (!active) return;
    const coverTimer = setTimeout(onCovered, FADE_IN_MS);
    const finishTimer = setTimeout(onFinished, TOTAL_MS);
    return () => {
      clearTimeout(coverTimer);
      clearTimeout(finishTimer);
    };
  }, [active, onCovered, onFinished]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-paper pointer-events-none"
      style={{ animation: `page-fade ${TOTAL_MS}ms ease-in-out both` }}
    />
  );
}
