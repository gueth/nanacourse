'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { House, Newspaper, Settings, ShoppingBasket, Wallet } from 'lucide-react';
import { usePageTransition } from '@/components/PageTransitionProvider';
import Portal from '@/components/Portal';
import { forgetFinanceMonth } from '@/lib/health';
import { NAVY, PAPER } from '@/components/gazette/Lace';

// Menu du bas, comme dans une application de téléphone : accueil, journal, finances, courses et paramètres.
// Fixé contre la barre du bas du téléphone, sur les pages qu'il dessert (voir TAB_PATHS).
//
// Sa couleur est celle du bas de l'accueil (les cartes du jour), et c'est aussi la couleur de la barre du téléphone dans
// l'application installée (theme_color de app/manifest.ts) : une fois installée, Chrome peint cette barre d'une couleur
// fixe, il ne suit pas la page. Le menu et la barre ne font ainsi qu'un, quelle que soit la page.
export const TAB_BAR_BG = '#ecdde8';
const INK = '#5b4a5f';
const ACTIVE = '#9b6a92';
// Hauteur du menu, sans la barre du téléphone en dessous
export const TAB_BAR_HEIGHT = 60;

const TABS = [
  { label: 'Accueil', icon: House, href: '/cartes', match: (p: string) => p === '/cartes' },
  { label: 'Journal', icon: Newspaper, href: '/accueil', match: (p: string) => p === '/accueil' },
  { label: 'Finances', icon: Wallet, href: '/banque/comptes', match: (p: string) => p.startsWith('/banque') },
  { label: 'Courses', icon: ShoppingBasket, href: '/course', match: (p: string) => p === '/course' || p === '/ingredients' },
  { label: 'Paramètres', icon: Settings, href: '/settings', match: (p: string) => p === '/settings' }
];

// Pages où le menu est affiché
export const hasTabBar = (pathname: string) => TABS.some((t) => t.match(pathname));

// Écran « La Gazette de nana » affiché un instant en ouvrant le journal, le temps qu'il se prépare
const GAZETTE_SPLASH_MS = 900;

export function TabBar() {
  const pathname = usePathname();
  const { startTransition } = usePageTransition();
  // Ouverture du journal demandée depuis cette page (un nouvel objet à chaque demande) ; l'écran de la gazette
  // reste affiché tant qu'on n'a pas quitté la page de départ
  const [journal, setJournal] = useState<{ from: string } | null>(null);
  const toJournal = journal?.from === pathname;
  useEffect(() => {
    if (!journal) return;
    const timer = window.setTimeout(() => startTransition('/accueil', 'fade'), GAZETTE_SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, [journal, startTransition]);

  return (
    <>
      {toJournal && (
        <Portal>
          <div
            role="status"
            aria-label="Ouverture du journal"
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center"
            style={{ backgroundColor: PAPER, color: NAVY, animation: 'page-fade-in 250ms ease-in both' }}
          >
            <p className="text-[58px] leading-none" style={{ fontFamily: 'var(--font-blackletter), serif' }}>
              La Gazette
            </p>
            <p className="-mt-1 text-[30px] leading-none" style={{ fontFamily: 'var(--font-script), cursive' }}>
              de nana
            </p>
          </div>
        </Portal>
      )}
      <nav
        aria-label="Menu principal"
        data-tab-bar
        className="fixed inset-x-0 -bottom-px z-40 border-t pb-[calc(env(safe-area-inset-bottom)+1px)]"
        // Descendu d'un pixel et prolongé vers le bas par son ombre : selon l'écran, l'arrondi des pixels laissait un
        // mince trait sombre entre le menu et la barre du téléphone
        style={{ backgroundColor: TAB_BAR_BG, borderColor: 'rgba(91,74,95,0.12)', boxShadow: `0 48px 0 0 ${TAB_BAR_BG}` }}
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-around" style={{ height: TAB_BAR_HEIGHT }}>
          {TABS.map(({ label, icon: Icon, href, match }) => {
            const active = match(pathname);
            return (
              <li key={href} className="flex flex-1">
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    if (active) return window.scrollTo({ top: 0, behavior: 'smooth' });
                    // En quittant les Finances, elles se rouvriront sur le mois précédent (le dernier terminé)
                    if (pathname.startsWith('/banque')) forgetFinanceMonth();
                    if (href === '/accueil') setJournal({ from: pathname });
                    else {
                      // Un autre onglet touché pendant l'écran de la gazette : le journal ne s'ouvre plus
                      setJournal(null);
                      startTransition(href, 'fade');
                    }
                  }}
                  className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors active:scale-95"
                  style={{ color: active ? ACTIVE : INK, fontFamily: 'var(--font-cuisine), system-ui, sans-serif' }}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
