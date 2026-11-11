'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MorningCards } from '@/components/MorningCards';

// Page des cartes du jour (après la connexion) : phrase, liste de courses, date, notifications, et le menu en trèfle.
// Le journal est la page de droite : on y passe en glissant le doigt vers la gauche.
export default function CardsPage() {
  const router = useRouter();
  useEffect(() => {
    router.prefetch('/accueil');
  }, [router]);
  return <MorningCards />;
}
