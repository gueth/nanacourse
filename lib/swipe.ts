'use client';

import { useRef } from 'react';

// Glissement horizontal du doigt sur une page, pour passer à la page voisine :
//  - onLeft : le doigt glisse vers la gauche (on va à la page de droite) ;
//  - onRight : le doigt glisse vers la droite (on revient à la page de gauche).
// Un défilement vertical un peu de travers ne compte pas. Les éléments marqués data-no-swipe (zone de dessin,
// liste qui défile de côté...) sont ignorés.
export function useHorizontalSwipe({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart(e: React.TouchEvent) {
      const target = e.target as HTMLElement;
      start.current = target.closest('[data-no-swipe]') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd(e: React.TouchEvent) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.changedTouches[0].clientX - s.x;
      const dy = e.changedTouches[0].clientY - s.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onLeft?.();
      else onRight?.();
    }
  };
}
