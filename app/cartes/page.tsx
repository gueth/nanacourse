'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MorningCards } from '@/components/MorningCards';

// Page des cartes du jour (après la connexion) : phrase, liste de courses, date, notifications ; menu du bas (components/TabBar).
// Le journal s'ouvre par le menu du bas.
export default function CardsPage() {
  const router = useRouter();
  useEffect(() => {
    router.prefetch('/accueil');
  }, [router]);
  return <MorningCards />;
}
