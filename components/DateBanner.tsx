'use client';

import { useSyncExternalStore } from 'react';

// Vignette du haut de l'accueil : fond à rayures bleues, cadre blanc aux coins ouvragés,
// bouquets de fleurs brodées sur les côtés et, au centre, une étiquette avec la date du jour.
// Dessinée en SVG dans un cadre de 412 x 170.

const W = 412;
const H = 170;
const WHITE = '#fbfaf6';
const BLUE = '#5f87ba';
const LABEL = '#f6f2e9';

// Date du jour en français, calculée uniquement dans le navigateur : le serveur peut être
// dans un autre fuseau horaire, et la date affichée ne correspondrait pas à l'hydratation
function readToday() {
  const now = new Date();
  const weekday = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}|${date}`;
}
const noSubscribe = () => () => {};

// Cadre à coins rentrants (quart de cercle concave), en retrait de "inset" depuis les bords
function framePath(inset: number, r: number) {
  const x0 = inset;
  const y0 = inset;
  const x1 = W - inset;
  const y1 = H - inset;
  return `M${x0 + r} ${y0} H${x1 - r} A${r} ${r} 0 0 0 ${x1} ${y0 + r} V${y1 - r} A${r} ${r} 0 0 0 ${x1 - r} ${y1} H${x0 + r} A${r} ${r} 0 0 0 ${x0} ${y1 - r} V${y0 + r} A${r} ${r} 0 0 0 ${x0 + r} ${y0}Z`;
}

// Ornement d'un coin (dessiné pour le coin haut-gauche, retourné pour les autres)
// ("flowerOnly" : juste la fleur, pour laisser la place au bouton menu en haut à droite)
function CornerOrnament({ flipX, flipY, flowerOnly }: { flipX?: boolean; flipY?: boolean; flowerOnly?: boolean }) {
  const transform = `translate(${flipX ? W : 0} ${flipY ? H : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`;
  return (
    <g transform={transform} fill="none" stroke={WHITE} strokeLinecap="round">
      {/* Petite fleur dans le creux du coin */}
      <g transform="translate(13 13)">
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx={0} cy={-3.2} rx={1.8} ry={2.8} transform={`rotate(${a})`} fill={WHITE} stroke="none" />
        ))}
        <circle r={1.3} fill={BLUE} stroke="none" />
      </g>
      {!flowerOnly && <CornerScrolls />}
    </g>
  );
}

function CornerScrolls() {
  return (
    <>
      {/* Volutes le long des deux bords */}
      <path d="M30 14 q8 -6 16 0 q5 4 1 7 q-3 2 -5 -1" strokeWidth={1.1} />
      <path d="M14 30 q-6 8 0 16 q4 5 7 1 q2 -3 -1 -5" strokeWidth={1.1} />
      <path d="M48 13 q6 2 10 0" strokeWidth={0.9} />
      <path d="M13 48 q2 6 0 10" strokeWidth={0.9} />
      <circle cx={62} cy={13} r={1.1} fill={WHITE} stroke="none" />
      <circle cx={13} cy={62} r={1.1} fill={WHITE} stroke="none" />
      {/* Petites feuilles */}
      <path d="M26 24 q6 -1 8 4 q-6 1 -8 -4z" fill={WHITE} stroke="none" />
      <path d="M24 26 q-1 6 4 8 q1 -6 -4 -8z" fill={WHITE} stroke="none" />
    </>
  );
}

// Fleur brodée à six pétales ronds
function Flower({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <circle key={a} cx={0} cy={-r} r={r * 0.62} transform={`rotate(${a})`} fill={WHITE} />
      ))}
      <circle r={r * 0.55} fill={BLUE} />
      <circle r={r * 0.25} fill={WHITE} />
    </g>
  );
}

// Bouquet sur un côté de la vignette : une grande fleur, deux petites, tiges, feuilles et pois
function Bouquet({ x, flip }: { x: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${H / 2}) scale(${flip ? -1 : 1} 1)`}>
      <path d="M0 6 q-2 14 2 26 M0 -6 q2 -14 -2 -26" fill="none" stroke={WHITE} strokeWidth={1} />
      <path d="M0 18 q-9 -2 -11 -9 q8 0 11 9z M1 -18 q9 2 11 9 q-8 0 -11 -9z" fill={WHITE} />
      <path d="M1 24 q8 -3 11 2 q-7 3 -11 -2z M-1 -24 q-8 3 -11 -2 q7 -3 11 2z" fill={WHITE} />
      <Flower x={0} y={0} r={6} />
      <Flower x={2} y={34} r={3.6} />
      <Flower x={-2} y={-34} r={3.6} />
      {[[-12, -2], [12, 3], [-9, 12], [9, -13], [-5, 46], [6, -46], [14, 18], [-14, -18]].map(([dx, dy], i) => (
        <circle key={i} cx={dx} cy={dy} r={1.1} fill={WHITE} />
      ))}
    </g>
  );
}

export function DateBanner() {
  const today = useSyncExternalStore(noSubscribe, readToday, () => null);
  const [weekday, date] = today ? today.split('|') : ['', ''];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={today ? `${weekday} ${date}` : 'Date du jour'}>
      <defs>
        {/* Rayures verticales, deux bleus séparés d'un fin filet clair */}
        <pattern id="banner-stripes" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="7" height="14" fill="#7096c6" />
          <rect x="7" width="7" height="14" fill="#86a7d1" />
          <path d="M7 0 V14 M0 0 V14" stroke={WHITE} strokeWidth="0.5" opacity="0.35" />
        </pattern>
        <filter id="label-shadow" x="-10%" y="-20%" width="120%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#24406b" floodOpacity="0.3" />
        </filter>
      </defs>

      <rect width={W} height={H} fill="url(#banner-stripes)" />

      {/* Double cadre blanc et ornements des quatre coins */}
      <path d={framePath(6, 14)} fill="none" stroke={WHITE} strokeWidth={1.4} />
      <path d={framePath(10, 12)} fill="none" stroke={WHITE} strokeWidth={0.6} />
      <CornerOrnament />
      <CornerOrnament flipX flowerOnly />
      <CornerOrnament flipY />
      <CornerOrnament flipX flipY />

      <Bouquet x={58} />
      <Bouquet x={W - 58} flip />

      {/* Étiquette centrale avec la date du jour */}
      <g filter="url(#label-shadow)">
        <rect x={W / 2 - 98} y={H / 2 - 42} width={196} height={84} fill={LABEL} />
      </g>
      <rect x={W / 2 - 93} y={H / 2 - 37} width={186} height={74} fill="none" stroke={BLUE} strokeWidth={0.8} />
      <text
        x={W / 2}
        y={H / 2 + 2}
        textAnchor="middle"
        fill={BLUE}
        style={{ fontFamily: 'var(--font-script), cursive', fontSize: 34 }}
      >
        {weekday}
      </text>
      {/* Petit filet ornemental entre le jour et la date */}
      <path
        d={`M${W / 2 - 40} ${H / 2 + 10} H${W / 2 - 6} M${W / 2 + 6} ${H / 2 + 10} H${W / 2 + 40}`}
        stroke={BLUE}
        strokeWidth={0.7}
      />
      <circle cx={W / 2} cy={H / 2 + 10} r={1.6} fill={BLUE} />
      <text
        x={W / 2}
        y={H / 2 + 27}
        textAnchor="middle"
        fill={BLUE}
        style={{ fontFamily: 'var(--font-type)', fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase' }}
      >
        {date}
      </text>
    </svg>
  );
}
