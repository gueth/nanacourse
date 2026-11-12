'use client';

import { createContext, useCallback, useContext, useState } from 'react';
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

// Vit au niveau du layout (jamais démonté entre deux pages), pour que l'animation de
// sortie des barres joue vraiment par-dessus la page de destination déjà affichée.
export function PageTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState<TransitionKind | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  // Page de destination affichée (l'adresse change quand la nouvelle page est en place)
  const arrived = target != null && pathname === target.split(/[?#]/)[0];

  const startTransition = useCallback((href: string, kind: TransitionKind = 'wipe') => {
    setTarget(href);
    setActive(kind);
  }, []);

  const handleCovered = useCallback(() => {
    if (target) router.push(target);
  }, [router, target]);

  const handleFinished = useCallback(() => {
    setActive(null);
    setTarget(null);
  }, []);

  return (
    <PageTransitionContext.Provider value={{ startTransition }}>
      {children}
      <PageWipeTransition active={active === 'wipe'} onCovered={handleCovered} onFinished={handleFinished} />
      {active === 'fade' && <PageFadeTransition ready={arrived} onCovered={handleCovered} onFinished={handleFinished} />}
    </PageTransitionContext.Provider>
  );
}
