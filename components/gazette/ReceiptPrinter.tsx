'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ShoppingReceipts from '@/components/ShoppingReceipts';
import { useActiveLists } from '@/lib/activeLists';

// Impression du ticket de caisse, dans la gazette de l'accueil, juste sous la réclame d'épicerie :
// la liste de courses active (même ticket et mêmes fonctionnalités qu'avant sur la page Courses, qui n'existe plus)
// sort d'une fente d'imprimante, par à-coups, puis est arrachée d'un petit coup sec. Le haut du ticket reste droit.
// Lancée par les boutons Courses de l'accueil (openTicket), ou en arrivant sur /accueil#ticket
// (après l'activation d'une liste dans les paramètres).

const HASH = '#ticket';

// Ticket imprimé ou non (une fois imprimé, il reste dans la page)
let opened = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const readOpen = () => opened || window.location.hash === HASH;

// Demande d'aller voir le ticket : la page défile jusqu'à lui (et l'imprime s'il ne l'est pas encore)
let scrollRequest: (() => void) | null = null;

export function openTicket() {
  if (readOpen()) return scrollRequest?.();
  opened = true;
  notify();
}

// Étapes : le ticket sort de la fente, il est arraché (petit sursaut), puis il est posé (plus d'animation)
type Phase = 'printing' | 'tearing' | 'done';

function Printer() {
  const lists = useActiveLists().data;
  const loaded = lists !== undefined;
  const [phase, setPhase] = useState<Phase>('printing');
  const slotRef = useRef<HTMLDivElement>(null);
  // Durée et nombre d'à-coups selon la longueur de la liste (environ 1 à 2,5 secondes)
  const lines = lists?.reduce((n, l) => n + l.items.length, 0) ?? 0;
  const duration = Math.min(700 + lines * 60, 2500);
  const steps = 10 + lines * 2;

  // La page défile jusqu'à la fente de l'imprimante, à l'impression puis à chaque nouvelle demande
  useEffect(() => {
    const scroll = () => slotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scroll();
    scrollRequest = scroll;
    return () => {
      scrollRequest = null;
    };
  }, []);

  const printing = loaded && phase === 'printing';
  return (
    <div className="mt-6 scroll-mt-4" ref={slotRef}>
      {/* Fente de l'imprimante, qui s'efface une fois le ticket arraché */}
      <div className="printer-slot transition-opacity duration-500" style={{ opacity: phase === 'done' ? 0 : 1 }} aria-hidden />
      {/* Le ticket sort de sous la fente. Un toucher pendant l'impression la termine aussitôt. */}
      <div
        className={phase === 'done' ? undefined : 'printer-out'}
        onClickCapture={(e) => {
          if (phase === 'done') return;
          e.preventDefault();
          e.stopPropagation();
          setPhase('done');
        }}
      >
        <div
          className={printing ? 'receipt-printing' : phase === 'tearing' ? 'receipt-tearing' : undefined}
          style={printing ? ({ '--print-ms': `${duration}ms`, '--print-steps': steps } as React.CSSProperties) : undefined}
          onAnimationEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            setPhase((p) => (p === 'printing' ? 'tearing' : 'done'));
          }}
        >
          <ShoppingReceipts blue />
        </div>
      </div>
    </div>
  );
}

export function ReceiptPrinter() {
  const open = useSyncExternalStore(subscribe, readOpen, () => false);
  useEffect(() => {
    // Arrivée sur l'accueil par /accueil#ticket (l'adresse n'est à jour qu'après l'affichage) : on imprime,
    // et on retire #ticket de l'adresse pour ne pas réimprimer en rechargeant la page
    if (window.location.hash === HASH) {
      opened = true;
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
    notify();
    // En quittant l'accueil, le ticket est rangé : il ne se réimprime qu'à la prochaine demande
    return () => {
      opened = false;
    };
  }, []);
  return open ? <Printer /> : null;
}
