'use client';

import { useEffect, useRef } from 'react';

// Secousse légère (pour animer l'écran, pas pour la clochette de lib/shakeBell.ts qui demande de vraiment secouer) :
// 3 à-coups de plus de 18 m/s² en moins d'une seconde.
const THRESHOLD = 18;
const HITS = 3;
const WINDOW_MS = 1000;
// Délai minimal entre deux secousses signalées
const COOLDOWN_MS = 700;

// Appelle onShake quand on secoue le téléphone. Sans effet sur un appareil sans accéléromètre.
// Sur iPhone, l'accès aux capteurs est demandé au premier toucher de l'écran.
export function useShake(onShake: () => void) {
  const callback = useRef(onShake);
  useEffect(() => {
    callback.current = onShake;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;
    let last: { x: number; y: number; z: number } | null = null;
    let hits: number[] = [];
    let lastShake = 0;

    function askPermission() {
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      DME.requestPermission?.().catch(() => {});
    }

    function onMotion(e: DeviceMotionEvent) {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const cur = { x: a.x, y: a.y, z: a.z };
      if (last) {
        const delta = Math.abs(cur.x - last.x) + Math.abs(cur.y - last.y) + Math.abs(cur.z - last.z);
        const t = Date.now();
        if (delta > THRESHOLD) {
          hits = hits.filter((h) => t - h < WINDOW_MS);
          hits.push(t);
          if (hits.length >= HITS && t - lastShake > COOLDOWN_MS) {
            lastShake = t;
            hits = [];
            callback.current();
          }
        }
      }
      last = cur;
    }

    window.addEventListener('pointerdown', askPermission, { once: true });
    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('pointerdown', askPermission);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, []);
}
