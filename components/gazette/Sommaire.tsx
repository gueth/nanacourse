'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Flourish, LaceEdge, NAVY, PAPER } from '@/components/gazette/Lace';

// Menu de la gazette : l'icône de menu ouvre une feuille de papier
// qui se déplie vers le bas, comme un encart glissé dans le journal, avec une table des matières
// (points de conduite, numéros de page) et une bordure de dentelle. Elle se replie au toucher à côté,
// sur la croix ou avec la touche Échap.

export type SommaireEntry = {
  label: string;
  href: string;
  page: number;
  current?: boolean; // page affichée : marquée d'un fleuron, et son lien referme simplement le sommaire
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

type State = 'closed' | 'open' | 'closing';

const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };
// Gothique lisible (Grenze Gotisch) pour le titre de la feuille
const gothic = { fontFamily: 'var(--font-gothic), serif' };

// "top" : position du haut de la feuille dans l'en-tête (juste sous la barre de séparation)
export function Sommaire({ entries, top }: { entries: SommaireEntry[]; top: number }) {
  const [state, setState] = useState<State>('closed');
  const panelId = useId();
  const firstLink = useRef<HTMLAnchorElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Repli : avec l'animation, la feuille disparaît à la fin du repli ; sans animation (réglage
  // « réduire les animations » du téléphone), elle disparaît tout de suite
  const close = useCallback(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setState(reduced ? 'closed' : 'closing');
    button.current?.focus();
  }, []);

  // Touche Échap pour refermer, et focus sur la première entrée à l'ouverture
  useEffect(() => {
    if (state !== 'open') return;
    firstLink.current?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => (state === 'open' ? close() : setState('open'))}
        aria-label={state === 'open' ? 'Fermer le sommaire' : 'Ouvrir le sommaire'}
        aria-expanded={state === 'open'}
        aria-controls={panelId}
        className="-m-2 inline-flex p-2"
        style={{ color: NAVY }}
      >
        <Menu size={22} strokeWidth={1.8} />
      </button>

      {state !== 'closed' && (
        <>
          {/* Toucher à côté de la feuille : la replie */}
          {state === 'open' && <div className="fixed inset-0 z-20" onClick={close} aria-hidden />}

          <div
            id={panelId}
            role="dialog"
            aria-label="Sommaire"
            className={`absolute inset-x-0 z-30 origin-top ${state === 'open' ? 'sommaire-unfold' : 'sommaire-fold'}`}
            style={{ top }}
            onAnimationEnd={(e) => e.target === e.currentTarget && state === 'closing' && setState('closed')}
          >
            <div className="relative px-5 pb-3 pt-4 text-left shadow-[0_6px_14px_rgba(29,43,74,0.28)]" style={{ backgroundColor: PAPER, color: NAVY }}>
              {/* Ombre du pli, qui s'efface quand la feuille finit de se déplier */}
              <div className="sommaire-crease pointer-events-none absolute inset-0" aria-hidden />
              {/* Marque du pli, au milieu de la feuille */}
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px opacity-25" style={{ backgroundColor: NAVY }} aria-hidden />

              <button type="button" onClick={close} aria-label="Fermer le sommaire" className="absolute right-2 top-2 p-1.5">
                <X size={18} />
              </button>

              <p className="text-center text-[32px] leading-none" style={gothic}>
                Sommaire
              </p>
              <div className="mt-2">
                <Flourish width={120} />
              </div>

              <nav className="mt-3">
                <ul className="space-y-2.5" style={serif}>
                  {entries.map((entry, i) => (
                    <li key={entry.href}>
                      <Link
                        ref={i === 0 ? firstLink : undefined}
                        href={entry.href}
                        aria-current={entry.current ? 'page' : undefined}
                        onClick={(e) => {
                          if (entry.current) {
                            e.preventDefault();
                            return close();
                          }
                          setState('closed');
                          entry.onClick?.(e);
                        }}
                        className="flex items-baseline gap-1.5 text-[15px]"
                      >
                        <span className="w-3 shrink-0 text-[10px]" aria-hidden>
                          {entry.current ? '✦' : ''}
                        </span>
                        <span className={`shrink-0 ${entry.current ? 'italic' : ''}`}>{entry.label}</span>
                        <span className="min-w-[12px] flex-1 -translate-y-[4px] border-b border-dotted" style={{ borderColor: NAVY }} aria-hidden />
                        <span className="shrink-0 text-[12px] italic">p. {entry.page}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            {/* Bordure de dentelle au bas de la feuille */}
            <div className="sommaire-lace" style={{ backgroundColor: 'transparent' }}>
              <LaceEdge />
            </div>
          </div>
        </>
      )}
    </>
  );
}
