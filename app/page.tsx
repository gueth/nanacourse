'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArcNav } from '@/components/ArcNav';
import { TodoCard } from '@/components/TodoCard';
import { ProgressBar } from '@/components/ProgressBar';
import { ScaledStage } from '@/components/ScaledStage';
import { usePageTransition } from '@/components/PageTransitionProvider';
import { ShoppingCart, Wallet, Shirt, Settings } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const { startTransition } = usePageTransition();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number>();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      setCardHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    router.prefetch('/course');
  }, [router]);

  return (
    <ScaledStage>
     <div className="relative bg-paper h-full w-full">
        {/* FOND ECRAN */}
         <div
            className="h-full w-full bg-no-repeat rounded-b-3xl" style={{ backgroundImage: "url('/photo_fond_1.jpe')", backgroundPosition: "right top" }}
        >
        </div>

        {/* BARE DE NAVIGATION CIRCULAIRE */}
          <ArcNav
            items={[
              { label: "Parametre", href: "/parametre", icon: <Settings size={20} /> },
              { label: "Dressing", href: "/dressing", icon: <Shirt size={20} /> },
              { label: "Banque", href: "/banque", icon: <Wallet size={20} />},
              {
                label: "Course",
                href: "/course",
                icon: <ShoppingCart size={20} />,
                onClick: (e) => {
                  e.preventDefault();
                  startTransition('/course');
                }
              }
            ]}
          />

        {/* BULLE + TO DO LIST, empilées avec 2% de la hauteur du cadre (922px) entre les deux */}
        <div className="absolute top-[43%] left-1/2 -translate-x-1/2 w-[90%] flex flex-col items-center gap-[18px]">
          {/* BULLE DE DIALOGUE */}
          <p className="speech-bubble w-full text-center text-2xl">
            (soupire) ... ha te revoilà, je te previens on a du pain sur la planche ...
          </p>

          {/* TO DO LIST + BARRE DE PROGRESSION, côte à côte */}
          <div className="flex items-start gap-3">
            <div ref={cardRef} className="w-[320px] sm:w-[420px]">
              <TodoCard onProgressChange={(torn, total) => setProgress(total === 0 ? 0 : torn / total)} />
            </div>

            {/* FLEURS DE PROGRESSION : chacune change de couleur à mesure que les tâches sont arrachées */}
            <ProgressBar progress={progress} height={cardHeight} />
          </div>
        </div>
    </div>
    </ScaledStage>
  );
}
