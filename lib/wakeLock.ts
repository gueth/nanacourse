'use client';

import { useEffect } from 'react';

// Empêche l'écran de s'éteindre tant que l'application est affichée (API "Screen Wake Lock" du navigateur).
// Le navigateur libère ce verrou dès que l'onglet est caché (changement d'appli, écran verrouillé) :
// on le redemande quand l'application redevient visible.
// Sans effet si le navigateur ne le permet pas (ancien navigateur, ou site ouvert en http:// hors localhost).
export function useKeepScreenOn() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    async function request() {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        // Démontage pendant la demande : on rend le verrou tout de suite
        if (stopped) lock.release();
      } catch (err) {
        // Refus possible (économie d'énergie, onglet pas au premier plan) : on réessaiera au prochain retour
        console.warn("Impossible de garder l'écran allumé :", err);
      }
    }

    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      lock?.release();
    };
  }, []);
}
