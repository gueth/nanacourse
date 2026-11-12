'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PageWipeTransition } from '@/components/PageWipeTransition';
import { PageFadeTransition } from '@/components/PageFadeTransition';

// "wipe" : barres bleues en diagonale ; "fade" : fondu de la couleur de la page de départ à celle de la page d'arrivée
type TransitionKind = 'wipe' | 'fade';

type PageTransitionContextValue = {
  startTransition: (href: string, kind?: TransitionKind) => void;
};

const PageTransitionContext = createContext<PageTransitionContextValue | null>(null);

export function usePageTransition() {
  const ctx = useContext(PageTransitionContext);
  if (!ctx) throw new Error('usePageTransition doit être utilisé dans PageTransitionProvider');
  return ctx;
}

// Une transition en cours : son genre, sa page de destination et son numéro
type Transition = { kind: TransitionKind; target: string; id: number };

// Vit au niveau du layout (jamais démonté entre deux pages), pour que l'animation de
// sortie des barres joue vraiment par-dessus la page de destination déjà affichée.
// Chaque transition a son numéro : une nouvelle demande (un onglet touché pendant que la précédente finit de s'effacer)
// repart de zéro avec son propre voile, et la fin de l'ancienne ne peut plus l'annuler (avant, le clic était perdu :
// la fin de l'ancienne effaçait la destination avant que la nouvelle page soit demandée).
export function PageTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [current, setCurrent] = useState<Transition | null>(null);
  const nextId = useRef(0);
  // Page de destination affichée (l'adresse change quand la nouvelle page est en place)
  const arrived = current != null && pathname === current.target.split(/[?#]/)[0];

  const startTransition = useCallback((href: string, kind: TransitionKind = 'wipe') => {
    nextId.current += 1;
    setCurrent({ kind, target: href, id: nextId.current });
  }, []);

  const target = current?.target;
  const id = current?.id;
  const handleCovered = useCallback(() => {
    if (target) router.push(target);
  }, [router, target]);

  // Seule la transition en cours peut se terminer
  const handleFinished = useCallback(() => {
    setCurrent((c) => (c && c.id === id ? null : c));
  }, [id]);

  return (
    <PageTransitionContext.Provider value={{ startTransition }}>
      {children}
      <PageWipeTransition key={current?.kind === 'wipe' ? current.id : 'wipe'} active={current?.kind === 'wipe'} onCovered={handleCovered} onFinished={handleFinished} />
      {current?.kind === 'fade' && <PageFadeTransition key={current.id} ready={arrived} onCovered={handleCovered} onFinished={handleFinished} />}
    </PageTransitionContext.Provider>
  );
}
