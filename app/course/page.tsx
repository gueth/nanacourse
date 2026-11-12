'use client';

import { useSyncExternalStore } from 'react';
import { CUISINE_BG, CUISINE_INK, KitchenPage } from '@/components/KitchenPage';

// Page des courses, façon application de cuisine : séparée du journal, on l'ouvre depuis le menu des cartes du jour
// (menu du bas), et son bouton de retour y ramène. La messagerie n'est accessible que depuis l'accueil.

const noSubscribe = () => () => {};
const readToday = () => new Date().toDateString();

export default function CoursePage() {
  const todayKey = useSyncExternalStore(noSubscribe, readToday, () => null);
  const today = todayKey ? new Date(todayKey) : null;
  return (
    <>
      <div className="cuisine-page overflow-x-clip pb-4" style={{ backgroundColor: CUISINE_BG, color: CUISINE_INK }}>
        <KitchenPage today={today} />
      </div>
    </>
  );
}
