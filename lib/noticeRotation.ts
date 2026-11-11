'use client';

import { useSyncExternalStore } from 'react';

// Carte « Notifications » de la page de titre : une seule notification à la fois, qui laisse sa place à la suivante
// toutes les N heures (3 par défaut). Le nombre d'heures se règle dans Paramètres > Accueil et reste dans le navigateur.

export const NOTICE_HOURS_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export const DEFAULT_NOTICE_HOURS = 3;

const KEY = 'accueil:notifs-heures';
const listeners = new Set<() => void>();

export function getNoticeHours(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : DEFAULT_NOTICE_HOURS;
  } catch {
    return DEFAULT_NOTICE_HOURS;
  }
}

export function setNoticeHours(hours: number) {
  try {
    localStorage.setItem(KEY, String(hours));
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Réglage changé dans un autre onglet du navigateur
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useNoticeHours() {
  return useSyncExternalStore(subscribe, getNoticeHours, () => DEFAULT_NOTICE_HOURS);
}

// Rang de la notification à montrer à cet instant : les créneaux suivent l'heure locale (0 h, 3 h, 6 h... pour 3 heures),
// et l'on reprend au début de la liste une fois arrivé au bout (avec deux notifications : l'une, puis l'autre, puis l'une...)
export function noticeIndex(now: Date, hours: number, count: number) {
  if (count <= 0) return 0;
  const localMinutes = Math.floor(now.getTime() / 60_000) - now.getTimezoneOffset();
  return Math.floor(localMinutes / (hours * 60)) % count;
}
