'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Plus, type LucideIcon } from 'lucide-react';

// Menu en forme de trèfle à quatre feuilles arrondies, posé en bas de l'écran des cartes du jour.
// Le bouton « + » ouvre le trèfle (il glisse alors en son centre) ; chaque feuille (en diagonale) mène à une partie de l'application.

export type MenuEntry = { label: string; icon: LucideIcon; onSelect: () => void };

// Taille du trèfle ouvert (px) et du bouton du milieu
const SIZE = 184;
const BUTTON = 60;
// Fermé, le bouton attend au bord du cadre (coin bas-droit, ou milieu du bas) ; ouvert, il glisse au centre du trèfle qui se déplie.
// Décalage (px) entre ces deux places
const SHIFT = SIZE / 2 - BUTTON / 2 - 4;

// Contour du trèfle : un carré aux coins très arrondis dont les côtés se creusent un peu,
// les quatre feuilles bombant vers les diagonales (là où sont les icônes)
function quatrefoilPath(size: number) {
  const points: string[] = [];
  const steps = 120;
  const raw = Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const squircle = Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), -0.25);
    const r = squircle * (1 - 0.1 * Math.cos(4 * t));
    return [r * c, r * s];
  });
  const max = Math.max(...raw.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const half = size / 2;
  for (const [x, y] of raw) points.push(`${(half + (x / max) * half).toFixed(1)} ${(half + (y / max) * half).toFixed(1)}`);
  return `path('M ${points.join(' L ')} Z')`;
}
const CLIP = quatrefoilPath(SIZE);

// Places des quatre feuilles : haut-gauche, haut-droite, bas-gauche, bas-droite
const CORNERS = [
  { left: '23%', top: '23%' },
  { left: '77%', top: '23%' },
  { left: '23%', top: '77%' },
  { left: '77%', top: '77%' }
];

export function QuatrefoilMenu({
  entries,
  anchor = 'corner',
  className = '',
  style
}: {
  entries: MenuEntry[];
  // corner : bouton fermé dans le coin bas-droit ; bottom : au milieu du bas (menu centré)
  anchor?: 'corner' | 'bottom';
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const dx = anchor === 'corner' ? SHIFT : 0;
  const dy = SHIFT;
  // Point d'où le trèfle se déplie : là où attend le bouton fermé
  const origin = `${SIZE / 2 + dx}px ${SIZE / 2 + dy}px`;
  const root = useRef<HTMLDivElement>(null);

  // Toucher en dehors du trèfle, ou la touche Échap, le referme
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={`pointer-events-none ${className || 'relative'}`} style={{ width: SIZE, height: SIZE, ...style }}>
      {/* Le trèfle, qui se déplie depuis le bouton du milieu */}
      <div
        aria-hidden
        className="absolute inset-0 backdrop-blur-md transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)]"
        style={{
          clipPath: CLIP,
          backgroundColor: 'color-mix(in srgb, var(--m-accent, #9b6a92) 12%, rgba(255,255,255,0.88))',
          transform: open ? 'scale(1)' : `scale(${BUTTON / SIZE})`,
          transformOrigin: origin,
          opacity: open ? 1 : 0
        }}
      />

      {/* Les quatre feuilles : une partie de l'application chacune */}
      <ul id="quatrefoil-entries" className="absolute inset-0" hidden={!open}>
        {entries.slice(0, 4).map((entry, i) => (
          <li key={entry.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={CORNERS[i]}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                entry.onSelect();
              }}
              aria-label={entry.label}
              title={entry.label}
              className="quatrefoil-entry pointer-events-auto flex size-12 items-center justify-center rounded-full"
              style={{ color: 'var(--m-accent, #9b6a92)', animationDelay: `${60 + i * 40}ms` }}
            >
              <entry.icon size={26} strokeWidth={2} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {/* Bouton du milieu : « + » qui tourne en croix une fois le trèfle ouvert */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="quatrefoil-entries"
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        className="pointer-events-auto absolute flex items-center justify-center rounded-[22px] text-white shadow-[0_10px_24px_-8px_rgba(90,40,90,0.6)] transition-transform duration-300 ease-[cubic-bezier(0.3,1.2,0.5,1)]"
        style={{
          width: BUTTON,
          height: BUTTON,
          left: (SIZE - BUTTON) / 2,
          top: (SIZE - BUTTON) / 2,
          transform: open ? undefined : `translate(${dx}px, ${dy}px)`,
          backgroundColor: 'var(--m-accent, #9b6a92)'
        }}
      >
        <Plus size={30} strokeWidth={2.2} className="transition-transform duration-300" style={{ transform: open ? 'rotate(45deg)' : undefined }} aria-hidden />
      </button>
    </div>
  );
}
