'use client';

// Les deux petits points de l'accueil, fixés en bas au centre de l'écran : accueil 1 (les cartes du jour)
// et accueil 2 (le journal). Le point plein est la page affichée ; toucher l'autre point y mène.
// Sur les cartes du jour, ils sont posés juste au-dessus du bouton du menu en trèfle ; sur le journal, tout en bas.
export const HOME_DOTS_BOTTOM = 'calc(max(env(safe-area-inset-bottom), 0.75rem) + 70px)';

export function HomeDots({ current, onGo, color, bottom = HOME_DOTS_BOTTOM }: { current: 0 | 1; onGo: (page: 0 | 1) => void; color: string; bottom?: string }) {
  const labels = ['Accueil 1 : les cartes du jour', 'Accueil 2 : le journal'];
  return (
    <nav aria-label="Pages de l'accueil" className="fixed left-1/2 z-40 flex -translate-x-1/2 gap-1" style={{ bottom }}>
      {([0, 1] as const).map((i) => (
        <button
          key={i}
          type="button"
          aria-label={labels[i]}
          aria-current={current === i ? 'page' : undefined}
          onClick={() => current !== i && onGo(i)}
          className="flex size-6 items-center justify-center"
        >
          <span
            className="block size-2.5 rounded-full border-2 transition-colors"
            style={{ borderColor: color, backgroundColor: current === i ? color : 'transparent' }}
          />
        </button>
      ))}
    </nav>
  );
}
