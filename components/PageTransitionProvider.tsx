'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageWipeTransition } from '@/components/PageWipeTransition';

type PageTransitionContextValue = {
  startTransition: (href: string) => void;
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
  const [active, setActive] = useState(false);
  const targetRef = useRef<string | null>(null);

  const startTransition = useCallback((href: string) => {
    targetRef.current = href;
    setActive(true);
  }, []);

  const handleCovered = useCallback(() => {
    if (targetRef.current) router.push(targetRef.current);
  }, [router]);

  const handleFinished = useCallback(() => {
    setActive(false);
    targetRef.current = null;
  }, []);

  return (
    <PageTransitionContext.Provider value={{ startTransition }}>
      {children}
      <PageWipeTransition active={active} onCovered={handleCovered} onFinished={handleFinished} />
    </PageTransitionContext.Provider>
  );
}
