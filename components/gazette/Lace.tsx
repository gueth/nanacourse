'use client';

import { useId } from 'react';

// Ornements en dentelle de la gazette de l'accueil, en SVG, dans les deux couleurs du journal :
// bleu nuit (le fil) et blanc cassé (le papier qui transparaît dans les jours de la dentelle).

export const NAVY = '#1d2b4a';
// Gris papier journal, à peine bleuté : plus doux pour les yeux qu'un blanc pur, et accordé au bleu nuit de l'écriture
export const PAPER = '#d6d5d1';
// Bleu très pâle, pour les fonds de tulle et les filets discrets (un ton plus soutenu que le papier pour s'en détacher)
export const MIST = '#c6c6c4';

// Bordure festonnée sur toute la largeur (haut ou bas de la page) : un galon plein percé de petits jours,
// puis une rangée de festons ronds ajourés, terminés chacun par un picot. "flip" : festons tournés vers le haut.
export function LaceEdge({ flip = false, color = NAVY }: { flip?: boolean; color?: string }) {
  const id = useId();
  return (
    <svg width="100%" height={28} aria-hidden className="block" style={flip ? { transform: 'scaleY(-1)' } : undefined}>
      <defs>
        <pattern id={id} width={24} height={28} patternUnits="userSpaceOnUse">
          {/* Galon : bande pleine avec une rangée de jours */}
          <rect width={24} height={8} fill={color} />
          <circle cx={6} cy={4} r={1.3} fill={PAPER} />
          <circle cx={18} cy={4} r={1.3} fill={PAPER} />
          {/* Feston : demi-cercle plein, percé d'un œillet entouré de quatre petits jours */}
          <path d="M0 8 A12 12 0 0 0 24 8Z" fill={color} />
          <circle cx={12} cy={11} r={3.2} fill={PAPER} />
          {[-1, 1].map((s) => (
            <circle key={s} cx={12 + s * 6.5} cy={10.5} r={1.2} fill={PAPER} />
          ))}
          <circle cx={12} cy={16.5} r={1.1} fill={PAPER} />
          {/* Picot au bout du feston, et petit anneau entre deux festons */}
          <circle cx={12} cy={23.5} r={1.8} fill={color} />
          <circle cx={0} cy={11} r={2} fill="none" stroke={color} strokeWidth={0.9} />
          <circle cx={24} cy={11} r={2} fill="none" stroke={color} strokeWidth={0.9} />
        </pattern>
      </defs>
      <rect width="100%" height={28} fill={`url(#${id})`} />
    </svg>
  );
}

// Fine bande de picots (petits anneaux reliés par un fil), horizontale ou verticale, pour les cadres
function PicotStrip({ vertical = false, color }: { vertical?: boolean; color: string }) {
  const id = useId();
  return (
    <svg width={vertical ? 8 : '100%'} height={vertical ? '100%' : 8} aria-hidden className="block">
      <defs>
        <pattern id={id} width={vertical ? 8 : 10} height={vertical ? 10 : 8} patternUnits="userSpaceOnUse">
          {vertical ? (
            <>
              <path d="M4 0 V10" stroke={color} strokeWidth={0.7} />
              <circle cx={4} cy={5} r={2.4} fill={PAPER} stroke={color} strokeWidth={0.9} />
              <circle cx={4} cy={5} r={0.8} fill={color} />
            </>
          ) : (
            <>
              <path d="M0 4 H10" stroke={color} strokeWidth={0.7} />
              <circle cx={5} cy={4} r={2.4} fill={PAPER} stroke={color} strokeWidth={0.9} />
              <circle cx={5} cy={4} r={0.8} fill={color} />
            </>
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// Cadre de dentelle autour d'un encart : bande de picots sur les quatre côtés, rosace dans chaque coin
export function LaceFrame({ children, className = '', color = NAVY }: { children: React.ReactNode; className?: string; color?: string }) {
  return (
    <div className={`relative p-[14px] ${className}`}>
      <div className="pointer-events-none absolute inset-x-[10px] top-[3px]">
        <PicotStrip color={color} />
      </div>
      <div className="pointer-events-none absolute inset-x-[10px] bottom-[3px]">
        <PicotStrip color={color} />
      </div>
      <div className="pointer-events-none absolute inset-y-[10px] left-[3px]">
        <PicotStrip vertical color={color} />
      </div>
      <div className="pointer-events-none absolute inset-y-[10px] right-[3px]">
        <PicotStrip vertical color={color} />
      </div>
      {['left-0 top-0', 'right-0 top-0', 'left-0 bottom-0', 'right-0 bottom-0'].map((pos) => (
        <svg key={pos} width={14} height={14} viewBox="-7 -7 14 14" aria-hidden className={`pointer-events-none absolute ${pos}`}>
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <ellipse key={a} cx={0} cy={-3.6} rx={1.6} ry={2.6} transform={`rotate(${a})`} fill={color} />
          ))}
          <circle r={1.6} fill={PAPER} />
        </svg>
      ))}
      <div className="relative border px-3 py-3" style={{ borderColor: color }}>
        {children}
      </div>
    </div>
  );
}

// Médaillon rond au bord festonné (comme un napperon), avec un chiffre ou un court texte au centre
export function Rosette({ size = 64, children }: { size?: number; children: React.ReactNode }) {
  const scallops = 18;
  const R = 46;
  const bump = 4;
  // Contour festonné : une suite d'arcs de cercle autour du médaillon
  let d = '';
  for (let i = 0; i < scallops; i++) {
    const a0 = (i / scallops) * Math.PI * 2;
    const a1 = ((i + 1) / scallops) * Math.PI * 2;
    const p0 = [R * Math.cos(a0), R * Math.sin(a0)].map((n) => Math.round(n * 100) / 100);
    const p1 = [R * Math.cos(a1), R * Math.sin(a1)].map((n) => Math.round(n * 100) / 100);
    d += `${i === 0 ? `M${p0[0]} ${p0[1]}` : ''} A${bump * 2.1} ${bump * 2.1} 0 0 1 ${p1[0]} ${p1[1]} `;
  }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="-56 -56 112 112" width={size} height={size} aria-hidden className="absolute inset-0">
        <path d={`${d}Z`} fill={NAVY} />
        <circle r={38} fill="none" stroke={PAPER} strokeWidth={1} strokeDasharray="1.5 2.5" />
        <circle r={33} fill="none" stroke={PAPER} strokeWidth={0.8} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none" style={{ color: PAPER }}>
        {children}
      </div>
    </div>
  );
}

// Petit nœud de ruban, pour l'en-tête
export function Bow({ width = 46, color = NAVY }: { width?: number; color?: string }) {
  return (
    <svg width={width} height={(width * 30) / 46} viewBox="0 0 46 30" aria-hidden>
      <g fill="none" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
        {/* Boucles gauche et droite */}
        <path d="M23 11 C18 3 6 1 5 8 C4 14 15 15 23 11Z" fill={PAPER} />
        <path d="M23 11 C28 3 40 1 41 8 C42 14 31 15 23 11Z" fill={PAPER} />
        {/* Plis des boucles */}
        <path d="M21 10 C15 7 10 7 9 9" strokeWidth={0.8} />
        <path d="M25 10 C31 7 36 7 37 9" strokeWidth={0.8} />
        {/* Pans qui retombent, coupés en queue d'aronde */}
        <path d="M21 13 L14 27 L17 25 L19 28 L23 14" fill={PAPER} />
        <path d="M25 13 L32 27 L29 25 L27 28 L23 14" fill={PAPER} />
      </g>
      {/* Nœud central */}
      <ellipse cx={23} cy={11.5} rx={3} ry={3.4} fill={color} />
    </svg>
  );
}

// Filet ornemental : trait fin, petit losange au centre, points aux extrémités
export function Flourish({ width = 140, color = NAVY }: { width?: number; color?: string }) {
  const half = width / 2;
  return (
    <svg width={width} height={10} aria-hidden className="mx-auto block">
      <path d={`M4 5 H${half - 9} M${half + 9} 5 H${width - 4}`} stroke={color} strokeWidth={0.8} />
      <path d={`M${half} 1 L${half + 4} 5 L${half} 9 L${half - 4} 5Z`} fill={color} />
      <circle cx={half - 7} cy={5} r={1} fill={color} />
      <circle cx={half + 7} cy={5} r={1} fill={color} />
      <circle cx={2} cy={5} r={1.3} fill={color} />
      <circle cx={width - 2} cy={5} r={1.3} fill={color} />
    </svg>
  );
}
