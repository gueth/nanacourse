'use client';

import { useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useActiveLists } from '@/lib/activeLists';
import { listTotal } from '@/lib/lists';
import { formatEuros } from '@/lib/finance';
import { useShake } from '@/lib/shake';
import { cyclePhase, PHASES, useCycle } from '@/lib/cycle';

// Première partie de la page de titre : l'heure, une grande salutation, et des cartes posées en vrac
// (phrase du jour, liste de courses active, date, défis). Toucher une carte la fait rebondir,
// secouer le téléphone les fait toutes valser. En faisant défiler vers le bas, on arrive au napperon.
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

// Défis proposés, trois par jour à tour de rôle
const DEFIS = ['Boire 1,5 L d’eau', 'Marcher 30 min', 'Cuisiner maison', 'Zéro dépense', 'Lire 10 pages'];

// Heure du navigateur, relue toutes les 15 s (null pendant le rendu côté serveur)
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(id);
}
const readMinute = () => Math.floor(Date.now() / 60_000);

// Numéro du jour (change à minuit) : choisit la phrase et les défis du jour
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

// Secousse : la carte part dans une direction au hasard, puis revient en oscillant de moins en moins
function wobble(el: HTMLElement, delay: number) {
  const [x, y, r] = [sign() * random(14, 34), sign() * random(10, 28), sign() * random(6, 14)];
  const at = (k: number) => ({ transform: `translate(${x * k}px, ${y * k}px) rotate(${r * k}deg)` });
  el.animate([at(0), at(1), at(-0.6), at(0.35), at(-0.15), at(0)], { duration: 1000, delay, easing: 'ease-in-out' });
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

export function MorningCards({ onContinue }: { onContinue: () => void }) {
  const minute = useSyncExternalStore(subscribeClock, readMinute, () => null);
  const now = minute == null ? null : new Date(minute * 60_000);
  const lists = useActiveLists().data;
  const list = lists?.[0];
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
  const defis = [0, 1, 2].map((i) => DEFIS[(day + i) % DEFIS.length]);
  const [line1, line2] = now ? greeting(now) : ['', ''];
  const weekday = now?.toLocaleDateString('fr-FR', { weekday: 'long' }) ?? '';
  const date = now?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) ?? '';
  const items = list?.items ?? [];
  const names = items.map((it) => it.ingredient?.name).filter((n): n is string => !!n);

  return (
    <section className="morning-page relative flex h-dvh snap-start flex-col overflow-hidden" style={theme ? themeVars(theme.colors) : undefined}>
      {/* Halos de couleur flous derrière le titre et les cartes */}
      <div aria-hidden className="morning-glow pointer-events-none absolute inset-0" />

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
            <p className="mt-[1cqw] line-clamp-2 text-[5cqw] font-bold leading-tight">{list?.name ?? 'Aucune liste active'}</p>
            {list ? (
              <ul className="mt-[3cqw] flex-1 space-y-[1.2cqw] overflow-hidden text-[3.8cqw] leading-snug">
                {names.slice(0, 4).map((n, i) => (
                  <li key={i} className="flex gap-[1.5cqw] truncate">
                    <span aria-hidden>•</span>
                    <span className="truncate">{n}</span>
                  </li>
                ))}
                {names.length > 4 && <li className="text-white/75">+ {names.length - 4} autres</li>}
              </ul>
            ) : (
              <p className="mt-[3cqw] flex-1 text-[3.8cqw] leading-snug text-white/85">Prépare ta prochaine liste dans les paramètres.</p>
            )}
            {list && (
              <p className="text-[3.6cqw] font-semibold">
                {items.length} article{items.length > 1 ? 's' : ''} · {formatEuros(listTotal(items))}
              </p>
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

          {/* Défis du jour */}
          <Card index={3} register={register} place={{ left: '53%', top: '65%', width: '43%', rotate: 5, z: 10 }} className="bg-white/90">
            <ul className="mb-[3cqw] space-y-[1.6cqw] text-[3.8cqw] leading-tight text-neutral-800">
              {defis.map((d) => (
                <li key={d} className="flex items-start gap-[1.8cqw]">
                  <span aria-hidden className="mt-[0.4cqw] size-[3.4cqw] shrink-0 rounded-full border-2 border-[var(--m-accent,#c58db7)] opacity-70" />
                  {d}
                </li>
              ))}
            </ul>
            <Label>Défis du jour</Label>
          </Card>
        </div>
      </div>

      {/* Invitation à faire défiler vers la page de titre (un toucher y descend aussi) */}
      <div className="relative px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
        <button
          type="button"
          onClick={onContinue}
          className="morning-hint mx-auto block px-5 py-3 text-center text-neutral-600"
        >
          Fais défiler pour entrer
        </button>
      </div>
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
