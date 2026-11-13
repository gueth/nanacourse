'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getCreditsAudio } from '@/lib/creditsAudio';

// BRUITAGES DE L'APPLICATION, façon jeu de boutique de mode sur console portable :
// petits « pop » ronds, tintements de verre et arpèges pétillants, tous fabriqués à la volée (aucun fichier son).
// Ils restent doux : le volume réglé dans Paramètres > Sons est multiplié par un plafond bas (MAX_GAIN),
// donc même à 100 % les bruitages ne couvrent jamais la musique du téléphone.

export type Sfx = 'tap' | 'open' | 'close' | 'toggle' | 'select' | 'success' | 'error' | 'page' | 'pageTurn';

const KEY = 'nana-sfx-volume';
const DEFAULT_VOLUME = 0.5;
// Plafond du volume : 100 % dans les Paramètres = ce gain-là
const MAX_GAIN = 0.16;

// --- Volume (0 à 1), gardé dans le navigateur ---
let volume = DEFAULT_VOLUME;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved !== null && !Number.isNaN(Number(saved))) volume = Math.min(1, Math.max(0, Number(saved)));
  } catch {
    // navigation privée : volume par défaut
  }
  // Réglage changé dans un autre onglet
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || e.newValue === null) return;
    volume = Math.min(1, Math.max(0, Number(e.newValue) || 0));
    listeners.forEach((l) => l());
  });
}

export function getSfxVolume() {
  load();
  return volume;
}

export function setSfxVolume(v: number) {
  load();
  volume = Math.min(1, Math.max(0, v));
  try {
    window.localStorage.setItem(KEY, String(volume));
  } catch {
    // pas de stockage : le réglage vaut jusqu'à la fermeture
  }
  listeners.forEach((l) => l());
}

// Volume courant, pour l'écran de réglage
export function useSfxVolume() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSfxVolume,
    () => DEFAULT_VOLUME
  );
}

// --- Synthèse ---
// Note de musique -> fréquence (A4 = 440 Hz)
const NOTE: Record<string, number> = {
  C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093
};

type Tone = {
  freq: number;
  to?: number; // glissé vers cette fréquence
  at?: number; // départ (secondes après maintenant)
  dur: number;
  type?: OscillatorType;
  gain?: number;
};

// Une note : attaque très courte puis extinction douce (pas de clic)
function tone(ctx: AudioContext, out: AudioNode, { freq, to, at = 0, dur, type = 'sine', gain = 1 }: Tone) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Tintement de verre : la note et une harmonique aiguë plus discrète
function glass(ctx: AudioContext, out: AudioNode, freq: number, at: number, dur: number, gain = 1) {
  tone(ctx, out, { freq, at, dur, gain });
  tone(ctx, out, { freq: freq * 2.01, at, dur: dur * 0.6, gain: gain * 0.25 });
}

// Petit souffle (page qui tourne) : bruit filtré, très bref
function swish(ctx: AudioContext, out: AudioNode) {
  const len = Math.floor(ctx.sampleRate * 0.16);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  const t = ctx.currentTime;
  filter.frequency.setValueAtTime(1800, t);
  filter.frequency.exponentialRampToValueAtTime(4200, t + 0.15);
  const env = ctx.createGain();
  env.gain.value = 0.35;
  src.connect(filter).connect(env).connect(out);
  src.start(t);
}

// Grande page de papier qu'on tourne (carnet du profil) : un « fffouip » feutré.
// Bruit rose (plus doux que le bruit blanc), léger frémissement régulier de la feuille dans l'air,
// filtre qui s'ouvre quand la page passe au milieu puis se referme quand elle retombe. Aucun crépitement.
function pageTurn(ctx: AudioContext, out: AudioNode, dur = 0.5) {
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Bruit rose (méthode de Paul Kellet, version courte)
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const pink = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    const p = i / len;
    // Enveloppe en cloche, un peu plus longue à retomber qu'à monter
    const env = Math.pow(Math.sin(Math.PI * Math.pow(p, 0.8)), 1.6);
    // Frémissement doux de la feuille (ondulation régulière, de plus en plus lente)
    const flutter = 0.8 + 0.2 * Math.sin(2 * Math.PI * (28 - 12 * p) * (i / ctx.sampleRate));
    data[i] = pink * env * flutter;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.Q.value = 0.5;
  low.frequency.setValueAtTime(1200, t);
  low.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.45);
  low.frequency.exponentialRampToValueAtTime(1400, t + dur);
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 180;
  const gain = ctx.createGain();
  gain.gain.value = 1.6;
  src.connect(low).connect(high).connect(gain).connect(out);
  src.start(t);
}

const SOUNDS: Record<Sfx, (ctx: AudioContext, out: AudioNode) => void> = {
  // Carnet du profil qui s'ouvre ou se referme
  pageTurn: (c, o) => pageTurn(c, o),
  // Toucher un bouton : bulle ronde qui éclate
  tap: (c, o) => tone(c, o, { freq: 820, to: 1250, dur: 0.07, gain: 0.7 }),
  // Ouvrir une popin : deux notes qui montent
  open: (c, o) => {
    glass(c, o, NOTE.E6, 0, 0.14, 0.55);
    glass(c, o, NOTE.B6, 0.06, 0.2, 0.5);
  },
  // Fermer : les mêmes, qui redescendent
  close: (c, o) => {
    glass(c, o, NOTE.B5, 0, 0.12, 0.45);
    glass(c, o, NOTE.E5, 0.05, 0.16, 0.4);
  },
  // Case à cocher, interrupteur : petit « tic » de verre
  toggle: (c, o) => glass(c, o, NOTE.A6, 0, 0.09, 0.5),
  // Choix dans une liste : note claire
  select: (c, o) => glass(c, o, NOTE.D6, 0, 0.12, 0.55),
  // Réussite (liste validée, défi réussi, coupon gagné) : arpège pétillant
  success: (c, o) => {
    [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7].forEach((f, i) => glass(c, o, f, i * 0.07, 0.28, 0.45));
    tone(c, o, { freq: NOTE.C7 * 2, at: 0.3, dur: 0.35, gain: 0.08 });
  },
  // Erreur : deux « boup » graves et ronds, sans agressivité
  error: (c, o) => {
    tone(c, o, { freq: 330, to: 300, dur: 0.12, type: 'triangle', gain: 0.6 });
    tone(c, o, { freq: 262, to: 240, at: 0.12, dur: 0.18, type: 'triangle', gain: 0.6 });
  },
  // Changement de page : souffle et tintement léger
  page: (c, o) => {
    swish(c, o);
    glass(c, o, NOTE.G6, 0.05, 0.15, 0.25);
  }
};

// Son d'ouverture et de fermeture d'une popin (components/Modal.tsx).
// La fermeture attend un instant : si une popin se remonte aussitôt (mode strict de React en développement),
// elle ne sonne pas comme fermée.
let modalEpoch = 0;
export function useModalSfx() {
  useEffect(() => {
    const id = ++modalEpoch;
    playSfx('open');
    return () => {
      setTimeout(() => {
        if (modalEpoch === id) playSfx('close');
      }, 30);
    };
  }, []);
}

// Anti-rafale : un même bruitage n'est pas rejoué dans les 40 ms
const lastPlayed = new Map<Sfx, number>();

export function playSfx(name: Sfx) {
  if (typeof window === 'undefined') return;
  const v = getSfxVolume();
  if (v <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < 40) return;
  lastPlayed.set(name, now);
  try {
    const ctx = getCreditsAudio();
    // Tant qu'aucun toucher n'a déverrouillé le son, on n'insiste pas
    if (ctx.state === 'suspended') void ctx.resume();
    if (ctx.state === 'closed') return;
    // Volume perçu : courbe au carré, plus fine en bas de la réglette
    const master = ctx.createGain();
    master.gain.value = v * v * MAX_GAIN;
    master.connect(ctx.destination);
    SOUNDS[name](ctx, master);
    // Débranche le volume une fois le son fini
    setTimeout(() => master.disconnect(), 1200);
  } catch {
    // pas de son disponible : on ignore
  }
}
