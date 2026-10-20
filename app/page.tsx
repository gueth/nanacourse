'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LaceDoily } from '@/components/LaceDoily';
import { usePageTransition } from '@/components/PageTransitionProvider';

// Page de titre : napperon en dentelle sur fond bordeaux, un toucher mène à l'accueil
export default function TitlePage() {
  const router = useRouter();
  const { startTransition } = usePageTransition();

  useEffect(() => {
    router.prefetch('/accueil');
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => startTransition('/accueil', 'fade')}
      className="title-page relative flex h-dvh w-full cursor-pointer flex-col items-center justify-center overflow-hidden"
    >
      <div className="lace-enter h-full w-full max-w-[520px]">
        <LaceDoily title="nana" />
      </div>
      <span className="lace-hint absolute bottom-6 font-type text-xs uppercase tracking-[0.3em]">
        Touche pour entrer
      </span>
    </button>
  );
}
