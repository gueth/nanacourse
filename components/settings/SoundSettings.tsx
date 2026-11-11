'use client';

import { useRef } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { playSfx, setSfxVolume, useSfxVolume, type Sfx } from '@/lib/sfx';

// Onglet « Sons » des paramètres : volume des bruitages (gardé dans le navigateur), et écoute de chacun.
// Même à 100 %, les bruitages restent discrets (plafond dans lib/sfx.ts).

const SAMPLES: { name: Sfx; label: string }[] = [
  { name: 'tap', label: 'Bouton' },
  { name: 'toggle', label: 'Case cochée' },
  { name: 'open', label: 'Popin ouverte' },
  { name: 'close', label: 'Popin fermée' },
  { name: 'page', label: 'Changement de page' },
  { name: 'success', label: 'Réussite' },
  { name: 'error', label: 'Erreur' }
];

export default function SoundSettings() {
  const volume = useSfxVolume();
  const percent = Math.round(volume * 100);
  const muted = percent === 0;
  // Volume d'avant la coupure, rendu par le bouton « Remettre le son »
  const before = useRef(0.5);
  const Icon = muted ? VolumeX : percent < 50 ? Volume1 : Volume2;

  function toggleMute() {
    if (muted) {
      setSfxVolume(before.current || 0.5);
      playSfx('toggle');
    } else {
      before.current = volume;
      setSfxVolume(0);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] bg-white/70 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#e0dcf5] text-[#2b1f4f]">
            <Icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[18px] font-medium leading-tight">Volume des bruitages</h3>
            <p className="text-[13px] opacity-70">Petits sons des boutons, des popins et des pages. Ils restent doux, même au maximum.</p>
          </div>
          <span className="shrink-0 text-[15px] font-medium tabular-nums">{percent} %</span>
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          aria-label="Volume des bruitages"
          data-sfx="off"
          onChange={(e) => setSfxVolume(Number(e.target.value) / 100)}
          // Aperçu une fois la réglette lâchée
          onPointerUp={() => playSfx('select')}
          onKeyUp={() => playSfx('select')}
          className="mt-5 w-full accent-[#7b3f86]"
        />

        <button
          type="button"
          onClick={toggleMute}
          data-sfx="off"
          className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-medium ${
            muted ? 'bg-[#7b3f86] text-white' : 'bg-[#e0dcf5] text-[#2b1f4f]'
          }`}
        >
          {muted ? <Volume2 size={17} /> : <VolumeX size={17} />} {muted ? 'Remettre le son' : 'Couper les bruitages'}
        </button>
      </div>

      <div className="rounded-[24px] bg-white/70 p-5">
        <h3 className="text-[18px] font-medium leading-tight">Écouter</h3>
        <p className="text-[13px] opacity-70">Touche un bruitage pour l&apos;entendre au volume choisi.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.name}
              type="button"
              data-sfx={s.name}
              disabled={muted}
              className="rounded-[12px] bg-[#e6e1f9] px-3.5 py-2 text-[14px] font-medium text-[#2b1f4f] disabled:opacity-40"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
