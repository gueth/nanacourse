'use client';

import { useRef, useState } from 'react';

type Props = {
  pages: React.ReactNode[];
  labels: string[];
  // Couleur des points en bas de l'écran, et du soulignement des intitulés (encre par défaut)
  color?: string;
  // Intitulés en haut (« Actif · Passif »), avec la page affichée soulignée ; "caption" : petite ligne au-dessus (date…)
  tabs?: boolean;
  caption?: string;
  // Intitulés en grand, dans la police calligraphiée des titres (sinon petites capitales)
  scriptLabels?: boolean;
  // Page affichée, si le parent la pilote (sinon gérée ici)
  page?: number;
  onPageChange?: (page: number) => void;
};

// Pages côte à côte sur une même page : on passe de l'une à l'autre en glissant le doigt, en touchant leur intitulé
// (souligné quand on y est) ou avec les points en bas de l'écran. Le contenu glisse vers la gauche ou la droite, la
// partie qu'on quitte et celle qui arrive bougent ensemble : on reste sur la même page.
// Toutes les pages restent montées (leur état est gardé). Pas de transform permanent : seulement pendant la glissade,
// pour que les fenêtres en position fixe qu'elles contiennent restent calées sur l'écran.
export function SwipePages({ pages, labels, color, tabs, caption, scriptLabels, page: controlled, onPageChange }: Props) {
  const [own, setOwn] = useState(0);
  const page = controlled ?? own;
  // Glissade en cours : la page qu'on quitte et le sens (null : au repos)
  const [slide, setSlide] = useState<{ from: number; dir: 'next' | 'prev' } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const ink = color ?? 'var(--color-ink)';

  function go(next: number) {
    const target = Math.max(0, Math.min(next, pages.length - 1));
    if (target === page) return;
    setSlide({ from: page, dir: target > page ? 'next' : 'prev' });
    setOwn(target);
    onPageChange?.(target);
    // Si l'on était descendu plus bas que le haut des pages, on remonte à leur début
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top, behavior: 'smooth' });
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
      {/* INTITULÉS : celui de la partie affichée est souligné, le trait glisse de l'un à l'autre */}
      {tabs && (
        <div className="mt-4">
          {caption && (
            <p className="mb-1 text-center text-[10px] uppercase tracking-[0.25em]" style={{ color: 'inherit', opacity: 0.7 }}>
              {caption}
            </p>
          )}
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
            {labels.map((l, i) => (
              <button
                key={l}
                type="button"
                onClick={() => go(i)}
                aria-current={page === i ? 'true' : undefined}
                className={
                  scriptLabels
                    ? 'pb-1 text-[34px] leading-tight transition-opacity duration-300'
                    : 'py-1.5 text-[11px] uppercase tracking-[0.25em] transition-opacity duration-300'
                }
                style={
                  scriptLabels
                    ? { fontFamily: 'var(--font-script), cursive', opacity: page === i ? 1 : 0.35 }
                    : { fontWeight: page === i ? 700 : 400, opacity: page === i ? 1 : 0.5 }
                }
              >
                {l}
              </button>
            ))}
            <span
              aria-hidden
              className="absolute bottom-0 h-[2px] rounded-full transition-[left] duration-300 ease-out"
              style={{ width: `${100 / labels.length}%`, left: `${(page * 100) / labels.length}%`, backgroundColor: ink }}
            />
          </div>
        </div>
      )}

      {/* Toutes les pages dans la même case : pendant la glissade, celle qu'on quitte part d'un côté pendant que l'autre arrive */}
      <div className="grid overflow-x-clip pb-16" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {pages.map((content, i) => {
          const leaving = slide?.from === i;
          const shown = i === page || leaving;
          return (
            <div
              key={i}
              hidden={!shown}
              aria-hidden={leaving || undefined}
              className={slide ? (leaving ? `slide-out-${slide.dir}` : i === page ? `slide-in-${slide.dir}` : undefined) : undefined}
              style={{ gridArea: '1 / 1', ...(leaving ? { pointerEvents: 'none' } : {}) }}
              // Seulement la fin de sa propre glissade (pas celle d'une animation à l'intérieur de la page)
              onAnimationEnd={leaving ? (e) => e.target === e.currentTarget && setSlide(null) : undefined}
            >
              {content}
            </div>
          );
        })}
      </div>

      {/* INDICATEUR DE PAGE, FIXÉ EN BAS DE L'ÉCRAN, au-dessus du menu du bas (60 px) */}
      <div className="fixed bottom-[calc(60px+0.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex justify-center gap-2 z-20">
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
