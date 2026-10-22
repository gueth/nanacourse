'use client';

import { useRef, useState } from 'react';

type Props = {
  pages: React.ReactNode[];
  labels: string[];
  // Couleur des points en bas de l'écran (encre par défaut)
  color?: string;
  // Page affichée, si le parent la pilote (sinon gérée ici)
  page?: number;
  onPageChange?: (page: number) => void;
};

// Pages côte à côte, que l'on fait défiler en glissant le doigt ou avec les points en bas de l'écran.
// Toutes restent montées (leur état est gardé) ; seule la page affichée est visible. Pas de transform
// permanent sur les pages : les fenêtres en position fixe qu'elles contiennent restent calées sur l'écran.
export function SwipePages({ pages, labels, color, page: controlled, onPageChange }: Props) {
  const [own, setOwn] = useState(0);
  const page = controlled ?? own;
  // Sens de la dernière arrivée, pour l'animation (null : pas encore changé de page)
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  function go(next: number) {
    const target = Math.max(0, Math.min(next, pages.length - 1));
    if (target === page) return;
    setDir(target > page ? 'next' : 'prev');
    setOwn(target);
    onPageChange?.(target);
    // Si l'on était descendu plus bas que le haut des pages, on remonte à leur début
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top });
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // Geste horizontal seulement : un défilement vertical un peu de travers ne change pas de page
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? page + 1 : page - 1);
  }

  return (
    <div ref={root}>
      <div className="overflow-x-clip pb-16" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {pages.map((content, i) => (
          <div key={i} hidden={i !== page} className={i === page && dir ? `swipe-in-${dir}` : undefined}>
            {content}
          </div>
        ))}
      </div>

      {/* INDICATEUR DE PAGE, FIXÉ EN BAS DE L'ÉCRAN */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex justify-center gap-2 z-20">
        {pages.map((_, i) => (
          <button
            key={i}
            aria-label={labels[i]}
            aria-current={page === i ? 'page' : undefined}
            onClick={() => go(i)}
            className={`w-2.5 h-2.5 rounded-full border-2 border-ink ${page === i ? 'bg-ink' : 'bg-transparent'}`}
            style={color ? { borderColor: color, backgroundColor: page === i ? color : 'transparent' } : undefined}
          />
        ))}
      </div>
    </div>
  );
}
