'use client';

import { useEffect } from 'react';

// Secousse : écart d'accélération (m/s²) entre deux mesures, et nombre d'à-coups rapprochés pour la valider.
// Il faut vraiment secouer : 4 à-coups violents en moins d'une seconde (poser ou attraper le téléphone ne suffit pas).
const SHAKE_THRESHOLD = 30;
const SHAKE_HITS = 4;
const SHAKE_WINDOW_MS = 1000;
// Délai minimal entre deux tintements, pour ne pas sonner en boucle pendant qu'on secoue
const COOLDOWN_MS = 1200;

// Tintement de clochette synthétisé (pas de fichier son) : quelques harmoniques non entières,
// qui s'éteignent chacune à leur rythme, comme le métal d'une vraie cloche.
function ringBell(ctx: AudioContext) {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);

  const base = 1320; // note aiguë et claire (Mi 6)
  const partials = [
    { ratio: 1, gain: 1, decay: 1.6 },
    { ratio: 2.76, gain: 0.45, decay: 0.9 },
    { ratio: 5.4, gain: 0.25, decay: 0.5 },
    { ratio: 8.93, gain: 0.12, decay: 0.3 }
  ];

  for (const p of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = base * p.ratio;
    // Attaque immédiate puis extinction progressive
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(p.gain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + p.decay + 0.05);
  }
}

// Fait tinter une clochette (et vibrer brièvement) quand on secoue le téléphone.
// Le navigateur n'autorise le son qu'après un premier geste de l'utilisateur :
// le moteur audio est donc préparé au premier toucher de l'écran.
// Sur iPhone, ce même toucher sert à demander l'autorisation d'accéder aux capteurs de mouvement.
// Sans effet sur un appareil sans accéléromètre (ordinateur).
export function useShakeBell() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;

    let ctx: AudioContext | null = null;
    let last: { x: number; y: number; z: number } | null = null;
    let hits: number[] = [];
    let lastRing = 0;

    function unlock() {
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
      }
      if (ctx.state === 'suspended') ctx.resume();
      // iPhone (Safari 13+) : accès aux capteurs sur autorisation explicite
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
        if (delta > SHAKE_THRESHOLD) {
          hits = hits.filter((h) => t - h < SHAKE_WINDOW_MS);
          hits.push(t);
          if (hits.length >= SHAKE_HITS && t - lastRing > COOLDOWN_MS && ctx?.state === 'running') {
            lastRing = t;
            hits = [];
            ringBell(ctx);
            navigator.vibrate?.(40);
          }
        }
      }
      last = cur;
    }

    window.addEventListener('pointerdown', unlock);
    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('devicemotion', onMotion);
      ctx?.close();
    };
  }, []);
}
