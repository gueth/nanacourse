'use client';

import { Bow, Flourish, NAVY, PAPER } from '@/components/gazette/Lace';
import { useActiveLists } from '@/lib/activeLists';
import { shortDate } from '@/lib/budget';
import { useShoppingBudget, useStores } from '@/lib/coursesQueries';
import { formatEuros } from '@/lib/finance';
import { storeLabel } from '@/lib/stores';

// Réclame d'épicerie d'antan, comme les encarts publicitaires des vieux journaux :
// « Une nouvelle épicerie a vu le jour dans le quartier ! », un panier dessiné au trait, puis ce qui reste
// du budget courses. Le bouton « Vite, à vos courses » imprime le ticket de la liste active.

const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };
const script = { fontFamily: 'var(--font-script), cursive' };

// Panier à provisions en osier, avec une baguette, une pomme et des fanes qui dépassent
function Basket() {
  return (
    <svg viewBox="0 0 140 110" width={150} height={118} aria-hidden className="mx-auto block">
      <defs>
        <clipPath id="basket-body">
          <path d="M20 64 H120 L111 101 Q110 106 105 106 H35 Q30 106 29 101Z" />
        </clipPath>
      </defs>
      <g fill="none" stroke={NAVY} strokeLinecap="round" strokeLinejoin="round">
        {/* Anse */}
        <path d="M32 62 C32 6 108 6 108 62" strokeWidth={3} />
        <path d="M38 62 C38 14 102 14 102 62" strokeWidth={1} />
        {/* Fanes de carotte, à gauche */}
        <path d="M40 60 C36 46 30 40 24 38 M44 60 C44 44 40 36 36 30 M48 60 C50 48 54 42 58 40" strokeWidth={1.3} />
        {/* Baguette, penchée à droite, avec ses grignes */}
        <path d="M82 62 L98 22 Q102 16 106 20 Q108 24 104 30 L90 64Z" fill={PAPER} strokeWidth={1.5} />
        <path d="M95 34 l5 3 M92 42 l5 3 M89 50 l5 3" strokeWidth={1} />
        {/* Pomme, avec sa queue et sa feuille */}
        <circle cx={64} cy={54} r={10} fill={PAPER} strokeWidth={1.5} />
        <path d="M64 44 q1 -5 3 -7" strokeWidth={1.2} />
        <path d="M66 41 q6 -4 9 0 q-5 3 -9 0Z" fill={NAVY} strokeWidth={0.8} />
      </g>
      {/* Corps du panier, tressé : rangs horizontaux et brins verticaux alternés */}
      <path d="M20 64 H120 L111 101 Q110 106 105 106 H35 Q30 106 29 101Z" fill={PAPER} stroke={NAVY} strokeWidth={2} />
      <g clipPath="url(#basket-body)" stroke={NAVY} strokeWidth={1}>
        {[76, 88, 100].map((y) => (
          <path key={y} d={`M10 ${y} H130`} />
        ))}
        {Array.from({ length: 11 }, (_, i) => 24 + i * 9).map((x, i) => (
          <path key={x} d={`M${x} 64 V108`} strokeDasharray="6 6" strokeDashoffset={i % 2 ? 6 : 0} strokeWidth={1.6} />
        ))}
      </g>
      {/* Rebord du panier */}
      <rect x={14} y={58} width={112} height={9} rx={4} fill={NAVY} />
      <path d="M20 62.5 H120" stroke={PAPER} strokeWidth={0.8} strokeDasharray="3 3" />
    </svg>
  );
}

export function GroceryAd({ onOpen }: { onOpen: () => void }) {
  const { data: lists } = useActiveLists();
  const budget = useShoppingBudget().data;
  const stores = useStores().data ?? [];
  const list = lists?.[0];
  const store = list ? stores.find((s) => s.id === list.store_id) : undefined;

  return (
    <div className="mt-4">
      <p className="mb-1 text-center text-[8px] uppercase tracking-[0.35em] opacity-70">— Publicité —</p>
      <div className="border-[3px] border-double p-1.5" style={{ borderColor: NAVY }}>
        <div className="border border-dashed px-4 pb-4 pt-3 text-center" style={{ borderColor: NAVY }}>
          {/* Bandeau de la réclame */}
          <p className="mx-auto inline-block px-3 py-0.5 text-[9px] font-bold uppercase tracking-[0.3em]" style={{ backgroundColor: NAVY, color: PAPER }}>
            ✦ Grande ouverture ✦
          </p>
          <p className="mt-2 text-[17px] font-bold leading-tight" style={serif}>
            Une nouvelle épicerie a vu le jour dans le quartier&nbsp;!
          </p>

          {/* Panier, avec un nœud sur l'anse */}
          <div className="relative mt-2">
            <Basket />
            <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1">
              <Bow width={30} />
            </div>
          </div>

          <p className="-mt-1 text-[42px] leading-none" style={script}>
            L&apos;épicerie de nana
          </p>
          <div className="mt-2">
            <Flourish width={150} />
          </div>
          {/* Ce qui reste du budget courses de la période (réglé dans Profil > Budget) */}
          <p className="mt-3 text-[9px] uppercase tracking-[0.3em] opacity-80">Il vous reste pour vos courses</p>
          <p className="mt-1 text-[26px] font-bold leading-none" style={serif}>
            {budget ? formatEuros(budget.remaining) : '…'}
          </p>
          {budget && (
            <p className="mt-1 text-[11px] italic" style={serif}>
              jusqu&apos;au {shortDate(new Date(budget.period.end.getTime() - 86_400_000))}
            </p>
          )}

          {/* Imprime le ticket de la liste de courses active */}
          <button
            type="button"
            onClick={onOpen}
            className="mt-4 inline-block rounded-full px-6 py-2 text-[10px] uppercase tracking-[0.28em]"
            style={{ backgroundColor: NAVY, color: PAPER, ...serif }}
          >
            Vite, à vos courses →
          </button>
          <p className="mt-2 text-[8px] uppercase tracking-[0.25em] opacity-70">
            Ouvert tous les jours{store ? ` · ${storeLabel(store)}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
