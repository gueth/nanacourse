'use client';

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { MorningCards } from '@/components/MorningCards';
import { TitleContract } from '@/components/TitleContract';
import { usePageTransition } from '@/components/PageTransitionProvider';
import { NAVY, PAPER } from '@/components/gazette/Lace';
import { readSignature, subscribeSignature } from '@/lib/signature';
import { cyclePhase, PHASES, useCycle } from '@/lib/cycle';

const noSubscribe = () => () => {};
const readToday = () => new Date().toDateString();

// Page de titre en écrans qui s'enchaînent en faisant défiler :
//  1. les cartes du jour (phrase, liste de courses, date, défis), qui bougent quand on les touche ou qu'on secoue le téléphone ;
//  2. plus bas, sur fond bleu uni, la carte-contrat « Nana & Co » : on s'engage à faire de son mieux pour la journée
//     et on signe du doigt, ce qui ouvre l'accueil ;
//  3. une fois le contrat signé dans la journée, la une de la gazette apparaît sous la carte : il suffit de continuer
//     à faire défiler pour arriver à l'accueil.
export default function TitlePage() {
  const router = useRouter();
  const { startTransition } = usePageTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const contract = useRef<HTMLElement>(null);
  const gazette = useRef<HTMLElement>(null);
  const signed = useSyncExternalStore(subscribeSignature, () => !!readSignature(), () => false);
  // Couleur du bas de l'écran des cartes du jour (selon la phase du cycle), reprise en fond uni sous la carte-contrat
  const cycleSettings = useCycle().data;
  const today = useSyncExternalStore(noSubscribe, readToday, () => null);
  const cycle = today ? cyclePhase(cycleSettings, new Date(today)) : null;
  const bg3 = cycle ? PHASES[cycle.phase].colors.bg[2] : undefined;

  useEffect(() => {
    router.prefetch('/accueil');
  }, [router]);

  // Déjà signé : arrivé sur la une de la gazette (sous la carte), on entre dans l'accueil
  useEffect(() => {
    const target = gazette.current;
    if (!signed || !target) return;
    let entered = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !entered) {
          entered = true;
          startTransition('/accueil', 'fade');
        }
      },
      { root: scroller.current, threshold: 0.6 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [signed, startTransition]);

  return (
    <div
      ref={scroller}
      className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-auto overscroll-none"
      style={bg3 ? ({ '--m-bg3': bg3 } as CSSProperties) : undefined}
    >
      <MorningCards onContinue={() => contract.current?.scrollIntoView({ behavior: 'smooth' })} />

      <section ref={contract} className="title-page relative flex h-dvh w-full snap-start items-center justify-center overflow-hidden">
        <div className="lace-enter w-full">
          <TitleContract
            onSigned={() => startTransition('/accueil', 'fade')}
            onContinue={() => gazette.current?.scrollIntoView({ behavior: 'smooth' })}
          />
        </div>
      </section>

      {signed && (
        <section
          ref={gazette}
          aria-hidden
          className="flex h-dvh w-full snap-start flex-col items-center justify-center"
          style={{ backgroundColor: PAPER, color: NAVY }}
        >
          <p className="text-[58px] leading-none" style={{ fontFamily: 'var(--font-blackletter), serif' }}>
            La Gazette
          </p>
          <p className="-mt-1 text-[30px] leading-none" style={{ fontFamily: 'var(--font-script), cursive' }}>
            de nana
          </p>
        </section>
      )}
    </div>
  );
}
