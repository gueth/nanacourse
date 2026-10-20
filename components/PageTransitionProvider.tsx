'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageWipeTransition } from '@/components/PageWipeTransition';
import { PageFadeTransition } from '@/components/PageFadeTransition';

// "wipe" : barres beige en diagonale ; "fade" : fondu
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
  const [active, setActive] = useState<TransitionKind | null>(null);
  const targetRef = useRef<string | null>(null);

  const startTransition = useCallback((href: string, kind: TransitionKind = 'wipe') => {
    targetRef.current = href;
    setActive(kind);
  }, []);

  const handleCovered = useCallback(() => {
    if (targetRef.current) router.push(targetRef.current);
  }, [router]);

  const handleFinished = useCallback(() => {
    setActive(null);
    targetRef.current = null;
  }, []);

  return (
    <PageTransitionContext.Provider value={{ startTransition }}>
      {children}
      <PageWipeTransition active={active === 'wipe'} onCovered={handleCovered} onFinished={handleFinished} />
      <PageFadeTransition active={active === 'fade'} onCovered={handleCovered} onFinished={handleFinished} />
    </PageTransitionContext.Provider>
  );
}
