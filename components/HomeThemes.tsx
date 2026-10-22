'use client';

import Link from 'next/link';

// Sections de l'accueil qui se suivent au défilement, chacune avec son thème :
// bleu ardoise pour les finances, rouge profond pour les courses.
// Chaque section porte une carte découpée, en px de référence (largeur 412).

// Cartes presque carrées, un peu plus hautes que larges ; découpes faites uniquement d'arcs de cercle et de droites
const CARD_W = 320;
const CARD_H = 380;
const CARD_LEFT = (412 - CARD_W) / 2;
const SECTION_PAD = 50;

export const FINANCE_HEIGHT = CARD_H + SECTION_PAD * 2;
export const COURSES_HEIGHT = CARD_H + SECTION_PAD * 2;

// Étoile à quatre branches, longue et fine
function Sparkle({ x, y, h, w = h / 6, color }: { x: number; y: number; h: number; w?: number; color: string }) {
  return (
    <path
      transform={`translate(${x} ${y})`}
      d={`M0 ${-h} Q${w * 0.15} ${-w * 0.15} ${w} 0 Q${w * 0.15} ${w * 0.15} 0 ${h} Q${-w * 0.15} ${w * 0.15} ${-w} 0 Q${-w * 0.15} ${-w * 0.15} 0 ${-h}Z`}
      fill={color}
    />
  );
}

// Carte des finances : coins rentrants en quart de cercle, dôme en arc de cercle en haut et en bas
const FINANCE_CARD = (() => {
  const t = 30; // hauteur du dôme
  const b = CARD_H - t;
  const notch = 18;
  const half = 50; // demi-largeur du dôme
  const r = (half * half + t * t) / (2 * t); // rayon de l'arc qui monte de t sur une corde de 2 x half
  const mid = CARD_W / 2;
  return (
    `M0 ${t + notch} A${notch} ${notch} 0 0 0 ${notch} ${t} H${mid - half} A${r} ${r} 0 0 1 ${mid + half} ${t} ` +
    `H${CARD_W - notch} A${notch} ${notch} 0 0 0 ${CARD_W} ${t + notch} V${b - notch} A${notch} ${notch} 0 0 0 ${CARD_W - notch} ${b} ` +
    `H${mid + half} A${r} ${r} 0 0 1 ${mid - half} ${b} H${notch} A${notch} ${notch} 0 0 0 0 ${b - notch}Z`
  );
})();

// Carte des courses : arc brisé (deux arcs de cercle qui se rejoignent en pointe) en haut et en bas,
// coins arrondis, et une encoche ronde au milieu de chaque côté
const COURSES_CARD = (() => {
  const t = 40; // hauteur de l'arc brisé
  const b = CARD_H - t;
  const corner = 14;
  const half = 60; // demi-largeur de l'arc brisé
  const arc = 64; // rayon de chacun des deux arcs
  const notch = 12;
  const mid = CARD_W / 2;
  const midY = CARD_H / 2;
  return (
    `M0 ${t + corner} A${corner} ${corner} 0 0 1 ${corner} ${t} H${mid - half} A${arc} ${arc} 0 0 1 ${mid} 0 A${arc} ${arc} 0 0 1 ${mid + half} ${t} ` +
    `H${CARD_W - corner} A${corner} ${corner} 0 0 1 ${CARD_W} ${t + corner} V${midY - notch} A${notch} ${notch} 0 0 0 ${CARD_W} ${midY + notch} ` +
    `V${b - corner} A${corner} ${corner} 0 0 1 ${CARD_W - corner} ${b} H${mid + half} A${arc} ${arc} 0 0 1 ${mid} ${CARD_H} A${arc} ${arc} 0 0 1 ${mid - half} ${b} ` +
    `H${corner} A${corner} ${corner} 0 0 1 0 ${b - corner} V${midY + notch} A${notch} ${notch} 0 0 0 0 ${midY - notch}Z`
  );
})();

// Carte pleine + liseré intérieur qui suit exactement la découpe à "inset" px du bord :
// la découpe est tracée en trait épais (couleur du liseré) puis un peu moins épais (couleur de la carte),
// le tout coupé à l'intérieur de la carte, ce qui laisse un filet net de 1 px
function CardShape({ id, d, fill, line, inset }: { id: string; d: string; fill: string; line: string; inset: number }) {
  return (
    <>
      <defs>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
      </defs>
      <path d={d} fill={fill} />
      <g clipPath={`url(#${id})`} fill="none">
        <path d={d} stroke={line} strokeWidth={inset * 2 + 2} />
        <path d={d} stroke={fill} strokeWidth={inset * 2} />
      </g>
    </>
  );
}

// Ornement symétrique : filet horizontal, losange au centre, points aux extrémités
function Rule({ x, y, half, color }: { x: number; y: number; half: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} fill={color}>
      <path d={`M${-half} 0 H-7 M7 0 H${half}`} stroke={color} strokeWidth={0.8} />
      <path d="M0 -4 L4 0 L0 4 L-4 0Z" />
      <circle cx={-half - 3} cy={0} r={1.4} />
      <circle cx={half + 3} cy={0} r={1.4} />
    </g>
  );
}

export const SLATE = '#4a566b';
export const PAPER = '#f8f7f4';

// Fondu entre la section finances (bleu ardoise) et la section courses (bordeaux) :
// les 100 derniers px des finances vont vers la couleur intermédiaire, les 100 premiers
// px des courses en repartent, pour un passage continu sur 200 px au total.
const BLEND = 100;
const SLATE_WINE_MID = "color-mix(in oklab, #4a566b, #5e0a0f)";

export function FinanceSection() {
  return (
    <section className="relative w-full" style={{ height: FINANCE_HEIGHT, background: `linear-gradient(in oklab to bottom, ${SLATE} calc(100% - ${BLEND}px), ${SLATE_WINE_MID})` }}>
      {/* Petites étoiles sur le fond, une par coin */}
      <svg className="absolute inset-0" width={412} height={FINANCE_HEIGHT} aria-hidden>
        <Sparkle x={22} y={SECTION_PAD + 30} h={10} color={PAPER} />
        <Sparkle x={390} y={SECTION_PAD + 30} h={10} color={PAPER} />
        <Sparkle x={22} y={SECTION_PAD + CARD_H - 30} h={10} color={PAPER} />
        <Sparkle x={390} y={SECTION_PAD + CARD_H - 30} h={10} color={PAPER} />
      </svg>

      <div className="absolute" style={{ left: CARD_LEFT, top: SECTION_PAD, width: CARD_W, height: CARD_H }}>
        <svg className="absolute inset-0" width={CARD_W} height={CARD_H} aria-hidden>
          <CardShape id="finance-card" d={FINANCE_CARD} fill={PAPER} line={SLATE} inset={8} />
          {/* Étoiles de part et d'autre, à la même hauteur */}
          <Sparkle x={34} y={CARD_H / 2} h={34} w={5} color={SLATE} />
          <Sparkle x={CARD_W - 34} y={CARD_H / 2} h={34} w={5} color={SLATE} />
          {/* Un losange dans chaque dôme */}
          <path d={`M${CARD_W / 2} 10 l5 6 l-5 6 l-5 -6z M${CARD_W / 2} ${CARD_H - 22} l5 6 l-5 6 l-5 -6z`} fill={SLATE} />
        </svg>

        <div className="relative flex h-full flex-col items-center pt-[64px] text-center" style={{ color: SLATE }}>
          <p className="text-[10px] uppercase tracking-[0.3em] opacity-70">budget · comptes · épargne</p>
          <h2 className="mt-1 text-[58px] leading-none" style={{ fontFamily: 'var(--font-script), cursive' }}>
            Finances
          </h2>
          <svg width={140} height={12} className="mt-4" aria-hidden>
            <Rule x={70} y={6} half={56} color={SLATE} />
          </svg>
          <p className="mt-5 max-w-[200px] text-[11px] leading-relaxed opacity-80">
            Suis tes dépenses, tes comptes et ce qu&apos;il reste pour le mois.
          </p>
          <Link
            href="/banque/comptes"
            className="mt-6 rounded-full px-6 py-2 text-[11px] uppercase tracking-[0.3em] text-white"
            style={{ backgroundColor: SLATE }}
          >
            Ouvrir
          </Link>
        </div>
      </div>
    </section>
  );
}

const WINE = '#5e0a0f';
const BLUSH = '#dccdc2';
const PINE = '#2f3d2c';

export function CoursesSection({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="relative w-full" style={{ height: COURSES_HEIGHT, background: `linear-gradient(in oklab to bottom, ${SLATE_WINE_MID}, ${WINE} ${BLEND}px)` }}>
      {/* Étoiles discrètes sur le fond, une par coin */}
      <svg className="absolute inset-0" width={412} height={COURSES_HEIGHT} aria-hidden>
        {[
          [22, SECTION_PAD + 30], [390, SECTION_PAD + 30], [22, SECTION_PAD + CARD_H - 30], [390, SECTION_PAD + CARD_H - 30]
        ].map(([x, y], i) => (
          <g key={i} opacity={0.5}>
            <Sparkle x={x} y={y} h={10} color={BLUSH} />
            <g transform={`rotate(45 ${x} ${y})`}>
              <Sparkle x={x} y={y} h={5} color={BLUSH} />
            </g>
          </g>
        ))}
      </svg>

      <div className="absolute" style={{ left: CARD_LEFT, top: SECTION_PAD, width: CARD_W, height: CARD_H }}>
        <svg className="absolute inset-0" width={CARD_W} height={CARD_H} aria-hidden>
          <CardShape id="courses-card" d={COURSES_CARD} fill={BLUSH} line={WINE} inset={8} />
          {/* Étoile dans la pointe de l'arc du haut, losange dans celle du bas */}
          <g transform={`translate(${CARD_W / 2} 36)`}>
            <Sparkle x={0} y={0} h={16} w={4} color={WINE} />
            <g transform="rotate(45)">
              <Sparkle x={0} y={0} h={8} w={2.5} color={PINE} />
            </g>
          </g>
          <path d={`M${CARD_W / 2} ${CARD_H - 42} l5 6 l-5 6 l-5 -6z`} fill={WINE} />
        </svg>

        <div className="relative flex h-full flex-col items-center pt-[72px] text-center" style={{ color: WINE }}>
          <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">liste · magasins · ingrédients</p>
          <h2 className="mt-1 text-[58px] leading-none" style={{ fontFamily: 'var(--font-script), cursive' }}>
            Courses
          </h2>
          <div className="mt-4 flex gap-2" aria-hidden>
            <span className="block h-3 w-3 rounded-full" style={{ backgroundColor: PINE }} />
            <span className="block h-3 w-3 rounded-full" style={{ backgroundColor: WINE }} />
          </div>
          <p className="mt-5 max-w-[190px] text-[11px] leading-relaxed opacity-80">
            Prépare ta liste, compare les prix et coche au fil des rayons.
          </p>
          <button
            type="button"
            onClick={onOpen}
            className="mt-6 rounded-full px-6 py-2 text-[11px] uppercase tracking-[0.3em]"
            style={{ backgroundColor: WINE, color: BLUSH }}
          >
            Voir la liste
          </button>
        </div>
      </div>
    </section>
  );
}
