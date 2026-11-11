'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Carte mise au premier plan : partant de sa place sur la page (rect), elle s'avance au centre de l'écran en grandissant
// et en se redressant, sur un fond assombri. Un toucher sur le fond (ou Échap) la renvoie à sa place, par le même chemin.
// La carte est dessinée à la même largeur que sur la page, puis agrandie : son contenu reste identique.
export function CardSpotlight({ rect, label, onClose, children }: { rect: DOMRect; label: string; onClose: () => void; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  // Déplacement et agrandissement qui mènent la carte de sa place au centre de l'écran
  const target = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min((vw * 0.9) / rect.width, (vh * 0.85) / rect.height, 2.2);
    const dx = vw / 2 - (rect.left + rect.width / 2);
    const dy = vh / 2 - (rect.top + rect.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }, [rect]);

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const to = target();
    el.style.transform = to;
    if (reduced()) return;
    el.animate([{ transform: 'none', boxShadow: '0 0 0 rgba(0,0,0,0)' }, { transform: to }], { duration: 480, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.1)' });
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
  }, [target]);

  const close = useCallback(() => {
    const el = card.current;
    if (closing.current) return;
    closing.current = true;
    if (!el || reduced()) return onClose();
    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'ease-in', fill: 'forwards' });
    const anim = el.animate([{ transform: el.style.transform }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.5, 0, 0.6, 1)', fill: 'forwards' });
    anim.onfinish = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40">
      <div ref={backdrop} className="absolute inset-0 bg-[rgba(15,25,50,0.55)] backdrop-blur-[3px]" onClick={close} />
      <div
        ref={card}
        className="absolute origin-center"
        style={{ left: rect.left, top: rect.top, width: rect.width }}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={close}
        className="absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),1.25rem)] mx-auto w-max px-4 py-2 text-[11px] uppercase tracking-[0.25em] text-white/90 underline underline-offset-4"
      >
        Remettre en place
      </button>
    </div>,
    document.body
  );
}
