'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, House, ListChecks, Palette, Plus, ReceiptText, ShoppingBasket, Trophy, Volume2, X, type LucideIcon } from 'lucide-react';
import Modal, { ModalVariantContext } from '@/components/Modal';
import ReceiptScan from '@/components/ReceiptScan';
import { useCatalog } from '@/lib/coursesQueries';
import { useRouter, useSearchParams } from 'next/navigation';
import ListsSettings from '@/components/settings/ListsSettings';
import ChallengesSettings from '@/components/settings/ChallengesSettings';
import HomeSettings from '@/components/settings/HomeSettings';
import SoundSettings from '@/components/settings/SoundSettings';
import FinanceThemeSettings from '@/components/settings/FinanceThemeSettings';

// Les onglets de la page Paramètres.
// Les ingrédients, catégories et supermarchés se gèrent depuis le menu de la page des courses (components/KitchenManager).
const TABS: readonly { id: 'lists' | 'defis' | 'accueil' | 'finances' | 'sons'; label: string; title: string; icon: LucideIcon }[] = [
  { id: 'lists', label: 'Listes', title: 'Mes listes de courses', icon: ListChecks },
  { id: 'defis', label: 'Défis', title: 'Mes défis et mes points', icon: Trophy },
  { id: 'accueil', label: 'Accueil', title: 'La page de titre', icon: House },
  { id: 'finances', label: 'Finances', title: 'Les couleurs des finances', icon: Palette },
  { id: 'sons', label: 'Sons', title: 'Les bruitages', icon: Volume2 }
];

type TabId = (typeof TABS)[number]['id'];

// Anciens onglets des Paramètres -> gestion correspondante sur la page des courses
const MOVED: Record<string, string> = { ingredients: 'ingredients', categories: 'categories', stores: 'supermarches' };

// Couleurs « Material expressif » de la page (voir aussi la classe .m3 de globals.css)
const BG = '#e6e1f9';
const SURFACE = '#f8f3fb';

// Indicateur de chargement ondulé (vague violette qui avance, puis la piste grise)
function WavyLoader() {
  return (
    <div className="m3 flex min-h-page items-center justify-center" style={{ backgroundColor: BG }} role="status" aria-label="Chargement">
      <svg width="180" height="16" viewBox="0 0 180 16" aria-hidden>
        <defs>
          <clipPath id="wave-clip">
            <rect width="96" height="16" />
          </clipPath>
        </defs>
        <g clipPath="url(#wave-clip)">
          <path
            className="m3-wave"
            d={`M0 8 ${'q 6 -7 12 0 t 12 0 '.repeat(6)}`}
            fill="none"
            stroke="#65558f"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
        <path d="M106 8 H172" stroke="#cac4d0" strokeWidth="4" strokeLinecap="round" />
        <circle cx="177" cy="8" r="2" fill="#65558f" />
      </svg>
    </div>
  );
}

// Pastille festonnée (forme ondulée façon Material expressif) avec l'icône de l'onglet ouvert
function ScallopBadge({ icon: Icon }: { icon: LucideIcon }) {
  const points = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    const r = 26 + 2.4 * Math.cos(a * 12);
    return `${(32 + r * Math.cos(a)).toFixed(2)},${(32 + r * Math.sin(a)).toFixed(2)}`;
  });
  return (
    <span className="relative flex size-16 shrink-0 items-center justify-center rounded-full bg-[#cbbdfc]" aria-hidden>
      <svg viewBox="0 0 64 64" className="absolute inset-1.5">
        <polygon points={points.join(' ')} fill="#4f3f7f" />
      </svg>
      <Icon size={22} className="relative text-[#f3edff]" />
    </span>
  );
}

// useSearchParams doit être entouré d'un <Suspense> (sinon la compilation de production échoue)
export default function SettingsPage() {
  return (
    <Suspense fallback={<WavyLoader />}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  // Onglet affiché : celui indiqué dans l'adresse (ex : /settings?tab=defis), sinon Listes.
  // Changer d'onglet met à jour l'adresse : un lien comme "Gérer mes listes" ouvre donc directement le bon onglet.
  const searchParams = useSearchParams();
  const router = useRouter();
  const asked = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === asked) ? (asked as TabId) : 'lists';
  // Anciens onglets, déplacés dans le menu de la page des courses : on y renvoie
  const moved = asked ? MOVED[asked] : undefined;
  useEffect(() => {
    if (moved) router.replace(moved === 'ingredients' ? '/ingredients' : `/course?gerer=${moved}`);
  }, [moved, router]);
  function setTab(id: TabId) {
    setFabOpen(false);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  }
  // Ingrédients connus, pour le scan d'un reçu (mis à jour après le scan)
  const query = useCatalog();
  // Cadre du scan de reçu ouvert ou non, et menu flottant déplié ou non (téléphone)
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const current = TABS.find((t) => t.id === tab)!;

  function openScan() {
    setFabOpen(false);
    setReceiptOpen(true);
  }

  // Contenu de l'onglet ouvert
  function content(id: TabId) {
    switch (id) {
      // Les listes chargent elles-mêmes leurs données (avec leurs articles)
      case 'lists':
        return <ListsSettings />;
      // Les défis chargent eux-mêmes leurs données (défis, points, bons récupérés)
      case 'defis':
        return <ChallengesSettings />;
      // Réglages de la page de titre (gardés dans le navigateur)
      case 'accueil':
        return <HomeSettings />;
      // Couleurs des Finances : règles de chaque situation et sa répartition (Supabase, table finance_health)
      case 'finances':
        return <FinanceThemeSettings />;
      // Volume des bruitages (gardé dans le navigateur)
      case 'sons':
        return <SoundSettings />;
    }
  }

  // MISE EN PAGE FAÇON « MATERIAL EXPRESSIF » :
  //  - sur grand écran, un panneau de navigation à gauche (scan d'un reçu en pilule rose, puis les onglets) ;
  //  - sur téléphone, les onglets en boutons segmentés sous le titre, et un menu flottant en bas à droite
  //    (scanner un reçu, page des courses, accueil) qui se déplie en pilules ;
  //  - le contenu de l'onglet sur une grande surface presque blanche aux coins très arrondis.
  // Les popins ouvertes depuis la page prennent le même style (ModalVariantContext « m3 »).
  return (
    <ModalVariantContext.Provider value="m3">
      <div className="m3 m3-page min-h-page" style={{ backgroundColor: BG }}>
        <div className="mx-auto flex max-w-5xl gap-5 px-4 pb-36 pt-4 lg:px-6 lg:pb-12 lg:pt-6">
          {/* PANNEAU DE NAVIGATION (grand écran) */}
          <aside className="sticky top-6 hidden w-64 shrink-0 flex-col gap-1 self-start rounded-[28px] p-3 lg:flex" style={{ backgroundColor: SURFACE }}>
            <button
              type="button"
              onClick={openScan}
              className="mb-6 inline-flex items-center gap-3 self-start rounded-[16px] bg-[#f8b4f8] px-4 py-3.5 text-[14px] font-medium text-[#3a0f3d] transition-shadow hover:shadow-md"
            >
              <ReceiptText size={18} /> Scanner un reçu
            </button>
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = id === tab;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-full px-4 py-3.5 text-left text-[14px] font-medium transition-colors ${
                    active ? 'bg-[#e0dcf5] text-[#2b1f4f]' : 'hover:bg-black/5'
                  }`}
                >
                  <Icon size={19} strokeWidth={active ? 2.5 : 2} /> {label}
                </button>
              );
            })}
            <div className="my-3 border-t border-[#cac4d0]" />
            <Link href="/course" className="flex items-center gap-3 rounded-full px-4 py-3.5 text-[14px] font-medium hover:bg-black/5">
              <ShoppingBasket size={19} /> Page des courses
            </Link>
          </aside>

          <main className="min-w-0 flex-1">
            {/* EN-TÊTE : pastille festonnée et titre (le retour se fait par le menu du bas) */}
            <div className="flex items-center gap-4">
              <ScallopBadge icon={current.icon} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[#65558f]">Paramètres</p>
                <h1 className="text-[28px] font-medium leading-tight tracking-tight sm:text-[32px]">{current.title}</h1>
              </div>
            </div>

            {/* ONGLETS EN BOUTONS SEGMENTÉS (téléphone) : celui ouvert en pilule prune avec une coche */}
            <nav aria-label="Onglets" className="no-scrollbar -mx-4 mt-5 flex gap-1.5 overflow-x-auto px-4 lg:hidden">
              {TABS.map(({ id, label, icon: Icon }) => {
                const active = id === tab;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-[14px] font-medium transition-all ${
                      active ? 'rounded-full bg-[#7b3f86] text-white' : 'rounded-[12px] text-[#1d1b20]'
                    }`}
                    style={active ? undefined : { backgroundColor: SURFACE }}
                  >
                    {active ? <CircleCheck size={17} /> : <Icon size={17} />} {label}
                  </button>
                );
              })}
            </nav>

            {/* CONTENU DE L'ONGLET, sur une grande surface arrondie */}
            <section aria-label={current.label} className="mt-5 rounded-[28px] p-4 sm:p-6" style={{ backgroundColor: SURFACE }}>
              {content(tab)}
            </section>
          </main>
        </div>

        {/* MENU FLOTTANT (téléphone) : bouton carré « + », qui se déplie en pilules au-dessus d'un bouton rond « × » */}
        <div className="fixed bottom-[calc(60px+0.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex flex-col items-end gap-2 lg:hidden">
          {fabOpen && (
            <>
              {/* Toucher ailleurs replie le menu */}
              <div className="fixed inset-0 -z-10" onClick={() => setFabOpen(false)} aria-hidden />
              {(
                [
                  { label: 'Accueil', icon: House, href: '/cartes' },
                  { label: 'Page des courses', icon: ShoppingBasket, href: '/course' },
                  { label: 'Scanner un reçu', icon: ReceiptText, onClick: openScan }
                ] as const
              ).map((item, i, all) => {
                const inner = (
                  <>
                    <item.icon size={22} /> {item.label}
                  </>
                );
                const cls =
                  'm3-pop inline-flex items-center gap-3 rounded-full bg-[#cbbdfc] px-6 py-4 text-[17px] font-medium text-[#2b1f4f] shadow-[0_6px_16px_-8px_rgba(43,31,79,0.6)]';
                const style = { animationDelay: `${(all.length - 1 - i) * 40}ms` };
                return 'href' in item ? (
                  <Link key={item.label} href={item.href} className={cls} style={style}>
                    {inner}
                  </Link>
                ) : (
                  <button key={item.label} type="button" onClick={item.onClick} className={cls} style={style}>
                    {inner}
                  </button>
                );
              })}
            </>
          )}
          <button
            type="button"
            onClick={() => setFabOpen((o) => !o)}
            aria-expanded={fabOpen}
            aria-label={fabOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            className={`flex size-16 items-center justify-center text-white shadow-[0_8px_20px_-8px_rgba(43,31,79,0.7)] transition-all ${
              fabOpen ? 'rounded-full bg-[#65558f]' : 'rounded-[18px] bg-[#5a5870]'
            }`}
          >
            {fabOpen ? <X size={26} /> : <Plus size={28} />}
          </button>
        </div>

        {receiptOpen && query.data && (
          <Modal title="Scanner un reçu" onClose={() => setReceiptOpen(false)} wide>
            <ReceiptScan
              ingredients={query.data.ingredients}
              onDone={() => {
                setReceiptOpen(false);
                query.reload();
              }}
            />
          </Modal>
        )}
      </div>
    </ModalVariantContext.Provider>
  );
}
