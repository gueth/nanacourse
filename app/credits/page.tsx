'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, SlidersHorizontal, X } from 'lucide-react';
import { Flourish, NAVY, PAPER } from '@/components/gazette/Lace';
import { usePageTransition } from '@/components/PageTransitionProvider';
import { CREDITS, CREDITS_SECONDS, DECEL_SECONDS } from '@/lib/credits';
import { creditsAudioReady, getCreditsAudio, unlockCreditsAudio } from '@/lib/creditsAudio';

// Page Crédits : la danseuse tourne sur sa boîte à musique pendant deux chansons, et les crédits défilent par-dessus.
// À la fin, « Merci d'avoir joué », la danseuse ralentit jusqu'à l'arrêt et la musique s'éteint en fondu,
// puis les boutons « Rejouer » et « Retour » apparaissent.
// La scène 3D (Three.js r128, chargé depuis un CDN) est dans public/credits/scene.js.

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const GLTF_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
const SCENE_URL = '/credits/scene.js';

type CreditsScene = {
  start: () => void;
  setVolume: (v: number) => void;
  setQuality: (m: number) => void;
  previewNote: () => void;
  setFrozen: (v: boolean) => void;
  dispose: () => void;
};
type SceneOptions = {
  container: HTMLElement;
  audio: AudioContext;
  totalSeconds: number;
  decelSeconds: number;
  volume: number;
  quality: number;
  onLoaded: () => void;
  onError: (message: string) => void;
  onEnding: () => void;
  onStopped: () => void;
};
declare global {
  interface Window {
    createCreditsScene?: (opts: SceneOptions) => CreditsScene;
  }
}

// Chaque script n'est chargé qu'une fois, même en revenant sur la page
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string) {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        s.remove();
        reject(new Error(`Impossible de charger ${src}`));
      };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

// Réglages gardés d'une visite à l'autre (mêmes clés que le réveil)
function readSetting(key: string, fallback: number) {
  try {
    const v = localStorage.getItem(key);
    return v === null || Number.isNaN(+v) ? fallback : +v;
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {}
}

type Phase = 'loading' | 'ready' | 'playing' | 'ending' | 'done';

const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };
const gothic = { fontFamily: 'var(--font-gothic), serif' };
const blackletter = { fontFamily: 'var(--font-blackletter), serif' };
// Léger halo clair autour des lettres bleu nuit : lisibles sur le mur clair comme sur la danseuse
const glow = { textShadow: '0 0 2px rgba(247,244,239,0.9), 0 0 10px rgba(247,244,239,0.75), 0 1px 1px rgba(255,255,255,0.6)' };
// Halo plus marqué pour les crédits qui défilent (aucun cadre derrière : seul le halo les détache du fond)
const strongGlow = { textShadow: '0 0 2px rgba(247,244,239,1), 0 0 6px rgba(247,244,239,0.95), 0 0 14px rgba(247,244,239,0.8)' };
const cartouche = 'px-3 py-2';
const button = 'border px-5 py-2 text-[12px] uppercase tracking-[0.18em] shadow-[0_2px_8px_rgba(29,43,74,0.18)]';

export default function CreditsPage() {
  const { startTransition } = usePageTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CreditsScene | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  // Numéro de la séquence : change à chaque « Rejouer », pour relancer le défilement depuis le bas
  const [run, setRun] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [quality, setQuality] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const begin = () => {
      sceneRef.current?.start();
      setRun((r) => r + 1);
      setPhase('playing');
    };
    // Scène prête : la musique démarre seule si le toucher sur « Crédits » a déverrouillé le son, sinon bouton « Lancer »
    const whenReady = () => {
      if (cancelled) return;
      if (creditsAudioReady()) begin();
      else setPhase('ready');
    };

    (async () => {
      try {
        await loadScript(THREE_URL);
        await loadScript(GLTF_URL);
        await loadScript(SCENE_URL);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        return;
      }
      if (cancelled || !containerRef.current || !window.createCreditsScene) return;
      const vol = readSetting('rv.vol', 0.8);
      const q = readSetting('rv.q', 0);
      setVolume(vol);
      setQuality(q);
      sceneRef.current = window.createCreditsScene({
        container: containerRef.current,
        audio: getCreditsAudio(),
        totalSeconds: CREDITS_SECONDS,
        decelSeconds: DECEL_SECONDS,
        volume: vol,
        quality: q,
        onLoaded: whenReady,
        onError: (message) => {
          setError(`Le modèle 3D n'a pas pu être lu : ${message}`);
          whenReady();
        },
        onEnding: () => setPhase('ending'),
        onStopped: () => setPhase('done')
      });
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Rendu figé tant que le réglage est ouvert (quand la danseuse ne tourne pas)
  useEffect(() => {
    sceneRef.current?.setFrozen(settingsOpen);
  }, [settingsOpen]);

  // « Lancer » et « Rejouer » : le toucher déverrouille le son, puis toute la séquence repart du début
  const play = () => {
    unlockCreditsAudio();
    sceneRef.current?.start();
    setRun((r) => r + 1);
    setPhase('playing');
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    saveSetting('rv.vol', v);
    sceneRef.current?.setVolume(v);
  };
  const changeQuality = (q: number) => {
    setQuality(q);
    saveSetting('rv.q', q);
    sceneRef.current?.setQuality(q);
  };

  const rolling = phase === 'playing' || phase === 'ending';

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ backgroundColor: '#d9d4cc', color: NAVY, ...serif }}>
      {/* La scène 3D */}
      <div ref={containerRef} className="absolute inset-0" aria-hidden />

      {/* LES CRÉDITS, qui défilent de bas en haut pendant toute la danse, de part et d'autre de la danseuse
          (une section à gauche, la suivante à droite, le milieu reste libre) ; ils s'effacent avant la boîte, en bas */}
      <div className="credits-mask pointer-events-none absolute inset-0 overflow-hidden" aria-live="off">
        {rolling && (
          <div
            key={run}
            className="credits-roll absolute inset-x-0 top-0 mx-auto max-w-[760px] px-3 pb-8"
            style={{ animationDuration: `${CREDITS_SECONDS}s`, ...strongGlow }}
          >
            <div className={`inline-block ${cartouche}`}>
              <h1 className="text-[38px] leading-none" style={blackletter}>
                Crédits
              </h1>
              <div className="mt-2 flex">
                <Flourish width={90} />
              </div>
            </div>
            <dl className="mt-7 space-y-7">
              {CREDITS.map((section, i) => {
                const right = i % 2 === 0;
                return (
                  <div key={section.role} className={`w-[36%] ${cartouche} ${right ? 'ml-auto text-right' : 'text-left'}`}>
                    <dt className="text-[11px] font-semibold uppercase leading-snug tracking-[0.14em]">{section.role}</dt>
                    {section.names.map((name) => (
                      <dd key={name} className="mt-1 text-[19px] font-semibold italic leading-tight">
                        {name}
                      </dd>
                    ))}
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>

      {/* Lien de retour, toujours accessible */}
      <button
        type="button"
        onClick={() => startTransition('/cartes', 'fade')}
        className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 px-2 py-2 text-[12px] uppercase tracking-[0.18em]"
        style={glow}
      >
        <ArrowLeft size={16} /> Retour
      </button>

      {/* Réglages : volume et qualité de l'image */}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="Réglages du son et de l'image"
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border"
        style={{ borderColor: NAVY, backgroundColor: `${PAPER}e6` }}
      >
        <SlidersHorizontal size={20} />
      </button>

      {/* Message de chargement, d'erreur, ou bouton « Lancer » au centre */}
      {(phase === 'loading' || phase === 'ready' || error) && (
        <div className="absolute inset-x-0 bottom-10 z-10 flex flex-col items-center gap-3 px-6 text-center">
          {error && (
            <p className="text-[14px] italic" style={glow}>
              {error}
            </p>
          )}
          {phase === 'loading' && !error && (
            <p className="text-[16px] italic" style={glow}>
              Chargement de la danseuse…
            </p>
          )}
          {phase === 'ready' && (
            <button type="button" onClick={play} className={button} style={{ borderColor: NAVY, backgroundColor: PAPER }}>
              Lancer
            </button>
          )}
        </div>
      )}

      {/* FIN : « Merci d'avoir joué », puis Rejouer et Retour une fois la danseuse arrêtée */}
      {(phase === 'ending' || phase === 'done') && (
        <div className="credits-thanks pointer-events-none absolute inset-x-0 top-[14%] z-10 px-6 text-center" style={glow}>
          <p className="text-[46px] leading-tight" style={gothic}>
            Merci d&apos;avoir joué
          </p>
          <div className="mt-2">
            <Flourish width={140} />
          </div>
        </div>
      )}
      {phase === 'done' && (
        <div className="credits-thanks absolute inset-x-0 bottom-10 z-10 flex justify-center gap-3 px-6">
          <button type="button" onClick={play} className={button} style={{ borderColor: NAVY, backgroundColor: PAPER }}>
            Rejouer
          </button>
          <button
            type="button"
            onClick={() => startTransition('/cartes', 'fade')}
            className={button}
            style={{ borderColor: NAVY, backgroundColor: PAPER }}
          >
            Retour
          </button>
        </div>
      )}

      {/* Feuille de réglages */}
      {settingsOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-[rgba(29,43,74,0.25)] backdrop-blur-[6px]" onClick={() => setSettingsOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="Réglages"
            className="absolute left-1/2 top-1/2 z-30 w-[min(88vw,340px)] -translate-x-1/2 -translate-y-1/2 px-5 pb-5 pt-4 shadow-[0_10px_30px_rgba(29,43,74,0.35)]"
            style={{ backgroundColor: PAPER }}
          >
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Fermer les réglages" className="absolute right-2 top-2 p-1.5">
              <X size={18} />
            </button>
            <p className="text-center text-[28px] leading-none" style={gothic}>
              Réglages
            </p>
            <label className="mt-5 block">
              <span className="flex justify-between text-[11px] uppercase tracking-[0.18em]">
                <span>Volume</span>
                <span>{Math.round(volume * 100)} %</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(e) => changeVolume(+e.target.value / 100)}
                onPointerUp={() => {
                  unlockCreditsAudio();
                  sceneRef.current?.previewNote();
                }}
                className="mt-2 w-full"
                style={{ accentColor: NAVY }}
              />
            </label>
            <div className="mt-5">
              <span className="text-[11px] uppercase tracking-[0.18em]">Qualité de l&apos;image</span>
              <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Qualité de l'image">
                {['Auto', 'Max', 'Éco'].map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={quality === i}
                    onClick={() => changeQuality(i)}
                    className="flex-1 border py-2 text-[13px]"
                    style={{ borderColor: NAVY, backgroundColor: quality === i ? NAVY : 'transparent', color: quality === i ? PAPER : NAVY }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
