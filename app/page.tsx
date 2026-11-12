'use client';

import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { TitleContract } from '@/components/TitleContract';
import { usePageTransition } from '@/components/PageTransitionProvider';
import { cyclePhase, PHASES, useCycle } from '@/lib/cycle';

const noSubscribe = () => () => {};
const readToday = () => new Date().toDateString();

// Page de titre : la page de connexion, une carte « Nana & Co » sur fond uni (rien n'est vérifié).
// « Se connecter » ouvre la page des cartes du jour (/cartes), d'où le menu du bas mène au journal.
export default function TitlePage() {
  const router = useRouter();
  const { startTransition } = usePageTransition();
  // Fond uni de la couleur du haut de la page des cartes (selon la phase du cycle), pour un passage continu
  const cycleSettings = useCycle().data;
  const today = useSyncExternalStore(noSubscribe, readToday, () => null);
  const cycle = today ? cyclePhase(cycleSettings, new Date(today)) : null;
  const titleBg = cycle ? PHASES[cycle.phase].colors.bg[0] : undefined;

  useEffect(() => {
    router.prefetch('/cartes');
  }, [router]);

  return (
    <section
      className="title-page relative flex h-dvh w-full items-center justify-center overflow-hidden"
      style={titleBg ? ({ '--title-bg': titleBg } as CSSProperties) : undefined}
    >
      <div className="lace-enter w-full">
        <TitleContract onEnter={() => startTransition('/cartes', 'fade')} />
      </div>
    </section>
  );
}
