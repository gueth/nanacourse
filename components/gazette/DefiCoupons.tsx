'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { MIST, NAVY } from '@/components/gazette/Lace';

// Défis de l'accueil en coupons de réduction détachables : talon avec code-barres, perforation,
// le défi en gros, un cachet ovale, et la date de validité sous un filet en pointillés.
// Sous chaque coupon, son trou gris (même forme de ticket, vide) est déjà là : quand on arrache le coupon
// (même animation que l'ancienne liste de tâches), il se découvre progressivement, sans saut,
// et reste à sa place jusqu'au lendemain.

const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };
const script = { fontFamily: 'var(--font-script), cursive' };

// Teintes des coupons, en alternance (comme une planche de bons de couleurs différentes)
const TONES = ['#eceef1', MIST, '#b9c5d6'];
// Gris du trou laissé par un coupon arraché, plus sombre que le papier
const HOLE = '#a9adb3';
// Hauteur d'un coupon, et mesures de sa forme (les mêmes que la classe .ticket de globals.css)
const HEIGHT = 108;
const RADIUS = 14; // coins arrondis
const SIDE_NOTCH = 9; // encoches au milieu des petits côtés
const STUB = 64; // largeur du talon
const STUB_NOTCH = 7; // demi-cercles en haut et en bas de la perforation

// Contour d'un ticket de w x h, rentré de "d" pour que le trait reste entièrement visible :
// coins arrondis, encoches des côtés et de la perforation creusées vers l'intérieur
function ticketPath(w: number, h: number, d: number) {
  const r = RADIUS - d;
  const n = SIDE_NOTCH + d;
  const s = STUB_NOTCH + d;
  const [l, t, rt, b, m] = [d, d, w - d, h - d, h / 2];
  return [
    `M ${l + r} ${t}`,
    `H ${STUB - s} A ${s} ${s} 0 0 0 ${STUB + s} ${t}`,
    `H ${rt - r} A ${r} ${r} 0 0 1 ${rt} ${t + r}`,
    `V ${m - n} A ${n} ${n} 0 0 0 ${rt} ${m + n}`,
    `V ${b - r} A ${r} ${r} 0 0 1 ${rt - r} ${b}`,
    `H ${STUB + s} A ${s} ${s} 0 0 0 ${STUB - s} ${b}`,
    `H ${l + r} A ${r} ${r} 0 0 1 ${l} ${b - r}`,
    `V ${m + n} A ${n} ${n} 0 0 0 ${l} ${m - n}`,
    `V ${t + r} A ${r} ${r} 0 0 1 ${l + r} ${t} Z`
  ].join(' ');
}

// Coupons découpés du jour, gardés dans le navigateur (en mémoire si le stockage est indisponible)
const dayKey = () => `defis:decoupes:${new Date().toDateString()}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readTorn() {
  try {
    return localStorage.getItem(dayKey()) ?? memory.get(dayKey()) ?? '[]';
  } catch {
    return memory.get(dayKey()) ?? '[]';
  }
}

function saveTorn(list: string[]) {
  const value = JSON.stringify(list);
  memory.set(dayKey(), value);
  try {
    localStorage.setItem(dayKey(), value);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const noSubscribe = () => () => {};
const readDate = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

// Code-barres décoratif du talon : traits horizontaux d'épaisseurs variées, tirés du texte du défi
function Barcode({ seed }: { seed: string }) {
  const bars = [...seed.padEnd(22, '·')].slice(0, 22).map((c) => 1 + (c.charCodeAt(0) % 3));
  return (
    <span className="flex w-9 flex-col gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <span key={i} style={{ height: h, backgroundColor: NAVY }} />
      ))}
    </span>
  );
}

function Coupon({ defi, index, date, tone }: { defi: string; index: number; date: string | null; tone: string }) {
  return (
    <span className="ticket flex h-full" style={{ backgroundColor: tone, color: NAVY }}>
      {/* Talon : code-barres */}
      <span className="flex w-[var(--stub)] shrink-0 items-center justify-center">
        <Barcode seed={defi} />
      </span>
      {/* Perforation */}
      <span className="my-3 border-l-[1.5px] border-dashed" style={{ borderColor: NAVY }} />
      <span className="flex min-w-0 flex-1 flex-col px-3 pb-2 pt-2.5">
        <span className="flex flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[22px] leading-none" style={script}>
              Défi n° {String(index + 1).padStart(2, '0')}
            </span>
            <span className="mt-1 block text-[19px] font-black uppercase leading-[1.05] tracking-tight">{defi}</span>
          </span>
          {/* Cachet ovale */}
          <span className="flex h-[52px] w-[74px] shrink-0 flex-col items-center justify-center rounded-[50%] border text-[9px] font-bold uppercase leading-tight" style={{ borderColor: NAVY }}>
            <span>Bon pour</span>
            <span className="text-[15px] leading-none">1</span>
            <span>victoire</span>
          </span>
        </span>
        <span className="mt-2 flex justify-between gap-2 border-t border-dashed pt-1 text-[8px] uppercase tracking-[0.12em]" style={{ borderColor: NAVY }}>
          <span>À relever aujourd&apos;hui</span>
          <span>*Valable le {date ?? '—'}</span>
        </span>
      </span>
    </span>
  );
}

export function DefiCoupons({ defis }: { defis: string[] }) {
  const tornRaw = useSyncExternalStore(subscribe, readTorn, () => '[]');
  const torn = useMemo(() => new Set<string>(JSON.parse(tornRaw)), [tornRaw]);
  const date = useSyncExternalStore(noSubscribe, readDate, () => null);
  // Coupons en cours d'arrachage (animation), avant de laisser leur trou
  const [tearing, setTearing] = useState<Set<string>>(new Set());
  // Largeur des coupons, mesurée, pour tracer les tirets du contour des trous à la bonne taille
  const [width, setWidth] = useState(0);
  const listRef = useCallback((ul: HTMLUListElement | null) => {
    if (!ul) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ul);
    return () => observer.disconnect();
  }, []);

  function tear(defi: string) {
    if (tearing.has(defi) || torn.has(defi)) return;
    setTearing((t) => new Set(t).add(defi));
  }

  function finishTear(defi: string) {
    setTearing((t) => {
      const next = new Set(t);
      next.delete(defi);
      return next;
    });
    saveTorn([...torn, defi]);
  }

  return (
    <ul ref={listRef} className="mt-3 flex flex-col gap-3" style={serif}>
      {defis.map((defi, i) => {
        const done = torn.has(defi);
        const going = tearing.has(defi);
        return (
          <li key={defi} className="relative" style={{ height: HEIGHT }}>
            {/* Trou laissé par le coupon : même forme de ticket, gris, vide, bordé de tirets qui suivent son contour
                (coins arrondis et encoches). Toujours présent sous le coupon, il se découvre pendant l'arrachage. */}
            <span className="ticket absolute inset-0 shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)]" style={{ backgroundColor: HOLE }} aria-hidden />
            {width > 0 && (
              <svg className="pointer-events-none absolute inset-0" width={width} height={HEIGHT} aria-hidden>
                <path d={ticketPath(width, HEIGHT, 1)} fill="none" stroke={NAVY} strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" />
              </svg>
            )}
            {!done && (
              <button
                type="button"
                onClick={() => tear(defi)}
                onAnimationEnd={() => going && finishTear(defi)}
                aria-label={`Arracher le coupon du défi « ${defi} »`}
                className={`relative block h-full w-full drop-shadow-[0_2px_2px_rgba(29,43,74,0.25)] ${going ? 'tear-off-animate' : ''}`}
              >
                <Coupon defi={defi} index={i} date={date} tone={TONES[i % TONES.length]} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
