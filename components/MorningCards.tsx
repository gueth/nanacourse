'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useActiveLists } from '@/lib/activeLists';
import { listTotal } from '@/lib/lists';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import { useShoppingBudgets, useStores, useUncategorizedCount } from '@/lib/coursesQueries';
import { useCoverage } from '@/lib/financeQueries';
import { missingAccounts, monthsToVerify, readTransfersToVerify, subscribeTransfersToVerify } from '@/lib/coverage';
import { useShake } from '@/lib/shake';
import { cyclePhase, PHASES, useCycle } from '@/lib/cycle';
import { noticeIndex, useNoticeHours } from '@/lib/noticeRotation';
import { LogOut, Settings, ShoppingBasket, UserRound, Wallet } from 'lucide-react';
import { useHorizontalSwipe } from '@/lib/swipe';
import { QuatrefoilMenu } from '@/components/QuatrefoilMenu';
import { HomeDots } from '@/components/HomeDots';
import { MessagesButton } from '@/components/MessagesButton';
import { usePageTransition } from '@/components/PageTransitionProvider';
import Portal from '@/components/Portal';
import { NAVY, PAPER } from '@/components/gazette/Lace';

// Écran « La Gazette de nana » affiché avant d'ouvrir le journal
const GAZETTE_SPLASH_MS = 900;

// Page des cartes du jour (/cartes), ouverte après la connexion : l'heure, une grande salutation, et des cartes posées en vrac
// (phrase du jour, liste de courses active, date, notifications). Toucher une carte la fait rebondir,
// secouer le téléphone les fait toutes valser.
// Le menu en trèfle, au centre en bas de l'écran, mène au profil, aux finances, aux courses et aux paramètres.
// Le journal est la page de droite : en glissant le doigt vers la gauche, l'écran
// « La Gazette de nana » s'affiche un instant (le temps que l'accueil se prépare), puis l'accueil s'ouvre en fondu.
// Les couleurs suivent la phase du cycle (Profil > Mon cycle) : rouge pour les règles, violet en phase folliculaire,
// orange à l'ovulation, rose en phase lutéale ; des bulles autour du titre proposent des activités de la phase.

const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };

// Phrases du jour, une par jour, dans l'ordre
const PHRASES = [
  "J'avance à mon rythme, et chaque petit pas compte.",
  "Je prends soin de moi comme d'un être cher.",
  "Aujourd'hui, je choisis la douceur et la curiosité.",
  "Je mérite les belles choses que je construis.",
  "Je fais de la place pour ce qui me fait du bien.",
  "Mon calme est ma force.",
  "J'accueille la journée avec le sourire.",
  "Je regarde avec joie le chemin déjà parcouru."
];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

// Heure du navigateur, relue toutes les 15 s (null pendant le rendu côté serveur)
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(id);
}
const readMinute = () => Math.floor(Date.now() / 60_000);

// Numéro du jour (change à minuit) : choisit la phrase du jour
const dayNumber = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);

function greeting(d: Date) {
  const h = d.getHours();
  if (h >= 5 && h < 18) return ['Bonne', 'journée'];
  if (h >= 18 && h < 22) return ['Bonne', 'soirée'];
  return ['Bonne', 'nuit'];
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = (min: number, max: number) => min + Math.random() * (max - min);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

// Places des bulles d'activités autour du titre (en % de l'en-tête)
const BUBBLES: CSSProperties[] = [
  { left: '4%', top: '36%' },
  { right: '4%', top: '30%' },
  { left: '7%', top: '80%' },
  { right: '6%', top: '76%' }
];

// Rebond d'une carte touchée : elle s'enfonce, se redresse un peu trop, puis revient en place en oscillant
function bounce(el: HTMLElement) {
  const r = sign() * random(4, 8);
  el.animate(
    [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: `scale(0.9) rotate(${r}deg)`, offset: 0.2 },
      { transform: `scale(1.07) rotate(${-r * 0.6}deg)`, offset: 0.45 },
      { transform: `scale(0.98) rotate(${r * 0.3}deg)`, offset: 0.7 },
      { transform: 'scale(1) rotate(0deg)' }
    ],
    { duration: 650, easing: 'ease-out' }
  );
}

// Secousse : la carte part dans une direction au hasard (en ralentissant), puis revient à sa place comme tirée par
// un ressort, en oscillant de moins en moins. Le retour est calculé image par image (oscillation amortie) pour
// rester aussi fluide que le départ : pas d'arrêt brusque à chaque changement de sens.
const WOBBLE_MS = 1300;
const WOBBLE_OUT = 0.2; // part du temps passée à partir
function wobbleAmount(t: number) {
  if (t <= WOBBLE_OUT) {
    const p = t / WOBBLE_OUT;
    return 1 - (1 - p) ** 3; // départ qui ralentit jusqu'au point le plus loin
  }
  const s = (t - WOBBLE_OUT) / (1 - WOBBLE_OUT);
  // retour en ressort : vitesse nulle au départ, puis oscillations qui s'éteignent jusqu'à zéro
  return Math.exp(-4.2 * s) * Math.cos(Math.PI * 2.4 * s) * (1 - s ** 6);
}
function wobble(el: HTMLElement, delay: number) {
  const [x, y, r] = [sign() * random(14, 34), sign() * random(10, 28), sign() * random(6, 14)];
  const frames = Array.from({ length: 49 }, (_, i) => {
    const k = wobbleAmount(i / 48);
    return { transform: `translate(${x * k}px, ${y * k}px) rotate(${r * k}deg)` };
  });
  el.animate(frames, { duration: WOBBLE_MS, delay, easing: 'linear' });
}

// Une carte posée sur la pile : position et inclinaison (en % de la scène), entrée décalée, et léger flottement.
// Trois couches pour que les animations ne se gênent pas : position (entrée), rebond / secousse, flottement.
function Card({
  place,
  index,
  register,
  className = '',
  style,
  children
}: {
  place: { left: string; top: string; width: string; height?: string; rotate: number; z: number };
  index: number;
  register: (index: number, el: HTMLDivElement | null) => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className="morning-card-in absolute"
      style={{
        left: place.left,
        top: place.top,
        width: place.width,
        height: place.height,
        zIndex: place.z,
        rotate: `${place.rotate}deg`,
        animationDelay: `${200 + index * 120}ms`
      }}
    >
      <div
        ref={(el) => register(index, el)}
        onClick={(e) => {
          if (reducedMotion()) return;
          bounce(e.currentTarget);
          navigator.vibrate?.(8);
        }}
        className="h-full cursor-pointer select-none"
      >
        <div
          className={`morning-card-float h-full rounded-[6cqw] p-[5cqw] shadow-[0_18px_40px_-14px_rgba(90,40,90,0.45)] ${className}`}
          style={{ animationDelay: `${-index * 1.7}s`, ...style }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// Petit libellé gris en bas des cartes blanches (« Phrase du jour », « Aperçu du jour »...)
function Label({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <p className={`text-[3.4cqw] leading-tight ${light ? 'text-white/80' : 'text-neutral-500'}`}>{children}</p>;
}

export function MorningCards() {
  const minute = useSyncExternalStore(subscribeClock, readMinute, () => null);
  const now = minute == null ? null : new Date(minute * 60_000);
  const lists = useActiveLists().data;
  const list = lists?.[0];
  const stores = useStores().data;
  // Données des notifications : relevés et virements, budgets de courses, aliments sans catégorie
  const coverage = useCoverage().data;
  const budgets = useShoppingBudgets().data;
  const uncategorized = useUncategorizedCount().data ?? 0;
  const noticeHours = useNoticeHours();
  const { startTransition } = usePageTransition();
  // Journal (la page de droite) : on y passe en glissant le doigt vers la gauche ; l'écran de la gazette s'affiche,
  // puis l'accueil s'ouvre en fondu
  const [toJournal, setToJournal] = useState(false);
  useEffect(() => {
    if (!toJournal) return;
    const timer = window.setTimeout(() => startTransition('/accueil', 'fade'), GAZETTE_SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, [toJournal, startTransition]);
  const swipe = useHorizontalSwipe({ onLeft: () => setToJournal(true) });
  // Menu en trèfle : le profil, les finances, les courses et les paramètres (pages séparées, on n'y accède que par ce menu)
  const menu = [
    { label: 'Mon profil', icon: UserRound, onSelect: () => startTransition('/profile', 'fade') },
    { label: 'Finances', icon: Wallet, onSelect: () => startTransition('/banque/comptes', 'fade') },
    { label: 'Courses', icon: ShoppingBasket, onSelect: () => startTransition('/course', 'fade') },
    { label: 'Paramètres', icon: Settings, onSelect: () => startTransition('/settings', 'fade') }
  ];
  const verifySnapshot = useSyncExternalStore(subscribeTransfersToVerify, readTransfersToVerify, () => '');
  // Phase du cycle du jour (null si le cycle n'est pas renseigné : couleurs par défaut, sans bulles)
  const cycleSettings = useCycle().data;
  const cycle = now ? cyclePhase(cycleSettings, now) : null;
  const theme = cycle ? PHASES[cycle.phase] : null;
  // Bulle d'activité touchée : son nom s'affiche un instant
  const [tip, setTip] = useState<number | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  function showTip(i: number) {
    setTip(i);
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(null), 1800);
  }

  // Cartes affichées (pour les faire toutes valser quand on secoue le téléphone)
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const register = (index: number, el: HTMLDivElement | null) => {
    cards.current[index] = el;
  };
  useShake(() => {
    if (reducedMotion()) return;
    cards.current.forEach((el, i) => el && wobble(el, i * 60));
    navigator.vibrate?.([20, 40, 20]);
  });

  const day = now ? dayNumber(now) : 0;
  const phrase = PHRASES[day % PHRASES.length];

  // Notifications, de la plus importante à la moins importante
  const notices: string[] = [];
  if (coverage) {
    // Mois où les comptes ne concordent pas : virements à préciser, opérations estimées qui ne collent plus, ou à revérifier
    const toCheck = [
      ...new Set([...coverage.mismatches.map((m) => m.month), ...coverage.questions.map((q) => q.date.slice(0, 7)), ...monthsToVerify(verifySnapshot)])
    ].sort();
    if (toCheck.length === 1) notices.push(`Incohérence possible dans les comptes de ${monthLabel(toCheck[0])}`);
    else if (toCheck.length > 1) notices.push(`Incohérences possibles dans les comptes sur ${toCheck.length} mois`);
    // Relevés du mois dernier pas encore importés
    if (now) {
      const last = shiftMonth(monthKey(now), -1);
      const missing = missingAccounts(coverage, last);
      if (missing.length === 1) notices.push(`Relevé ${missing[0]} de ${monthLabel(last)} manquant`);
      else if (missing.length > 1) notices.push(`${missing.length} relevés de ${monthLabel(last)} manquants`);
    }
  }
  if (uncategorized > 0) notices.push(`${plural(uncategorized, 'aliment')} sans catégorie`);
  for (const b of budgets ?? []) notices.push(`Reste ${formatEuros(b.remaining)} sur ${b.settings.name}`);
  // Notification affichée en ce moment (elles se relaient toutes les N heures)
  const shown = now ? noticeIndex(now, noticeHours, notices.length) : 0;
  const notice = notices[shown];
  const [line1, line2] = now ? greeting(now) : ['', ''];
  const weekday = now?.toLocaleDateString('fr-FR', { weekday: 'long' }) ?? '';
  const date = now?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) ?? '';
  const items = list?.items ?? [];
  // Magasin choisi pour la liste active (rien d'affiché s'il n'y en a pas)
  const store = list?.store_id ? stores?.find((s) => s.id === list.store_id) : undefined;

  return (
    <section {...swipe} className="morning-page relative flex h-dvh flex-col overflow-hidden" style={theme ? themeVars(theme.colors) : undefined}>
      {/* Écran de la gazette, le temps d'ouvrir le journal */}
      {toJournal && (
        <Portal>
          <div
            role="status"
            aria-label="Ouverture du journal"
            className="fixed inset-0 z-40 flex flex-col items-center justify-center"
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

      {/* Halos de couleur flous derrière le titre et les cartes */}
      <div aria-hidden className="morning-glow pointer-events-none absolute inset-0" />

      {/* Déconnexion, en haut à gauche : retour à la page de connexion (la carte « Nana & Co ») */}
      <button
        type="button"
        onClick={() => startTransition('/', 'fade')}
        className="absolute left-2 top-[max(env(safe-area-inset-top),0.75rem)] z-20 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium text-neutral-600"
      >
        <LogOut size={15} aria-hidden /> Déconnexion
      </button>

      {/* Heure, puis la salutation en très grandes lettres, que les cartes viennent recouvrir en partie */}
      <header className="relative pt-[max(env(safe-area-inset-top),1.5rem)] text-center">
        <p className="text-sm font-medium tracking-wide text-neutral-600 tabular-nums">
          {now ? now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ' '}
        </p>
        <h1 className="morning-title mt-4 text-[clamp(56px,20vw,112px)] font-black leading-[0.86] tracking-[-0.04em]">
          {line1}
          <br />
          {line2}
        </h1>

        {/* Bulles d'activités de la phase, qui flottent autour du titre ; un toucher affiche leur nom */}
        {theme?.activities.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => showTip(i)}
            aria-label={a.label}
            className="morning-card-float absolute z-10 flex size-10 items-center justify-center rounded-full bg-white/70 shadow-[0_6px_16px_-6px_rgba(90,40,90,0.5)] backdrop-blur-sm"
            style={{ ...BUBBLES[i], color: 'var(--m-accent)', animationDelay: `${-i * 1.3}s` }}
          >
            <a.icon size={19} strokeWidth={2.2} aria-hidden />
            {tip === i && (
              <span className="absolute top-full mt-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold shadow" style={{ color: 'var(--m-accent)' }}>
                {a.label}
              </span>
            )}
          </button>
        ))}
      </header>

      {/* Scène des cartes : garde ses proportions et tient dans la place qui reste, quelle que soit la hauteur de l'écran */}
      <div className="relative -mt-3 flex min-h-0 flex-1 items-start justify-center px-4 [container-type:size]">
        <div className="relative [container-type:inline-size]" style={{ width: 'min(100cqw, 440px, calc(100cqh * 0.76))', aspectRatio: '400 / 526' }}>
          {/* Phrase du jour */}
          <Card index={0} register={register} place={{ left: '3%', top: '0%', width: '55%', rotate: -4, z: 20 }} className="bg-white">
            <p className="mb-[4cqw] text-[5.2cqw] font-bold leading-[1.22] text-neutral-900" style={serif}>
              {phrase}
            </p>
            <Label>Phrase du jour</Label>
          </Card>

          {/* Liste de courses active */}
          <Card
            index={1}
            register={register}
            place={{ left: '47%', top: '17%', width: '50%', height: '44%', rotate: 3, z: 30 }}
            className="morning-list flex flex-col text-white"
          >
            <p className="text-[3.4cqw] uppercase tracking-[0.18em] text-white/75">Courses</p>
            {list ? (
              <>
                <p className="mt-[1cqw] line-clamp-3 text-[5cqw] font-bold leading-tight">{list.name}</p>
                {store && <p className="mt-[2cqw] truncate text-[3.8cqw] text-white/85">{store.name}</p>}
                <div className="flex-1" />
                <p className="text-[3.8cqw] text-white/85">
                  {items.length} élément{items.length > 1 ? 's' : ''}
                </p>
                <p className="text-[5cqw] font-bold leading-tight">{formatEuros(listTotal(items))}</p>
                <p className="text-[3cqw] text-white/75">total estimé</p>
              </>
            ) : (
              <p className="mt-[1cqw] text-[5cqw] font-bold leading-tight">Pas de courses prévues</p>
            )}
          </Card>

          {/* Date du jour */}
          <Card
            index={2}
            register={register}
            place={{ left: '7%', top: '56%', width: '47%', height: '31%', rotate: -2, z: 40 }}
            className="flex flex-col bg-white"
          >
            <p className="text-[8.4cqw] font-black capitalize leading-none tracking-[-0.03em] text-neutral-900">{weekday}</p>
            <p className="mt-[1cqw] text-[7.2cqw] font-semibold leading-none tracking-[-0.03em] text-[var(--m-accent,#9b6a92)]">{date}</p>
            <div className="flex-1" />
            <Label>Aperçu du jour</Label>
          </Card>

          {/* Notifications : incohérences dans les comptes, relevés manquants, aliments sans catégorie, reste des budgets */}
          <Card index={3} register={register} place={{ left: '53%', top: '65%', width: '43%', rotate: 5, z: 10 }} className="bg-white/90">
            {/* Une seule notification à la fois : la suivante prend sa place toutes les N heures (Paramètres > Accueil) */}
            <p className="mb-[3cqw] flex items-start gap-[1.8cqw] text-[3.4cqw] leading-tight text-neutral-800">
              {notice ? (
                <>
                  <span aria-hidden className="mt-[0.6cqw] size-[2.4cqw] shrink-0 rounded-full bg-[var(--m-accent,#c58db7)] opacity-80" />
                  {notice}
                </>
              ) : (
                'Rien à signaler'
              )}
            </p>
            <Label>Notifications{notices.length > 1 ? ` · ${shown + 1}/${notices.length}` : ''}</Label>
          </Card>
        </div>
      </div>

      {/* Place réservée au bouton du menu et aux deux points de l'accueil, sous les cartes */}
      <div aria-hidden className="h-[calc(60px+max(env(safe-area-inset-bottom),1rem)+2.25rem)] shrink-0" />

      {/* Deux points pour passer de l'accueil 1 (ici) à l'accueil 2 (le journal) */}
      <HomeDots current={0} onGo={() => setToJournal(true)} color="var(--m-accent, #9b6a92)" />

      {/* Lettre fixée en bas à droite : messagerie de nana */}
      <MessagesButton />

      {/* Menu en trèfle, au centre en bas de l'écran : seul accès aux grandes parties de l'application */}
      <QuatrefoilMenu
        entries={menu}
        anchor="bottom"
        className="absolute left-1/2 z-50 -translate-x-1/2"
        style={{ bottom: 'max(calc(env(safe-area-inset-bottom) - 4px), 0.75rem)' }}
      />
    </section>
  );
}

// Couleurs de la phase en variables CSS, reprises par .morning-page, .morning-glow, .morning-title et .morning-list (globals.css)
function themeVars(c: (typeof PHASES)[keyof typeof PHASES]['colors']) {
  return {
    '--m-bg1': c.bg[0],
    '--m-bg2': c.bg[1],
    '--m-bg3': c.bg[2],
    '--m-glow1': c.glow[0],
    '--m-glow2': c.glow[1],
    '--m-glow3': c.glow[2],
    '--m-title1': c.title[0],
    '--m-title2': c.title[1],
    '--m-card1': c.card[0],
    '--m-card2': c.card[1],
    '--m-accent': c.accent
  } as CSSProperties;
}
