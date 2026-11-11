'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { BluePhoto } from '@/components/profile/ProfileParts';
import { formatIssue, gazetteIssue } from '@/lib/gazette';
import { getDefaultProfileTexts, getProfileTexts, subscribeProfileTexts, syncProfileTexts } from '@/lib/profileTexts';
import { contractDay } from '@/lib/signature';

// Page de connexion (page de titre) : une carte « Nana & Co » sur fond bleu uni, façon carte de membre,
// avec l'allure d'une connexion : identifiant (le prénom de la page Profil, modifiable), mot de passe et photo
// d'identité. Rien n'est vérifié : « Se connecter » fait tomber le tampon, puis ouvre la page des cartes du jour.

const INK = '#1d2b4a';
// Tailles proportionnelles à la largeur de la carte (1 unité = 1 % de la carte)
const u = (n: number) => `calc(var(--u) * ${n})`;
const narrow = { fontFamily: 'var(--font-narrow), "Arial Narrow", sans-serif' };
const type = { fontFamily: 'var(--font-courier), monospace' };
const pen = { fontFamily: 'var(--font-pen), cursive' };
const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };

const noSubscribe = () => () => {};
// Journée affichée sur la carte : elle change à 4 h du matin
const readToday = () => contractDay();

export function TitleContract({ onEnter }: { onEnter: () => void }) {
  const txt = useSyncExternalStore(subscribeProfileTexts, getProfileTexts, getDefaultProfileTexts);
  const todayKey = useSyncExternalStore(noSubscribe, readToday, () => null);
  const today = todayKey ? new Date(todayKey) : null;
  // Identifiant : le prénom du profil tant qu'on ne l'a pas modifié ; mot de passe : jamais vérifié
  const [login, setLogin] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);

  // Prénom et photo à jour depuis Supabase (la copie du navigateur s'affiche en attendant)
  useEffect(() => {
    syncProfileTexts();
  }, []);

  const day = today?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) ?? '';
  const year = today?.getFullYear() ?? '';
  const issue = today ? formatIssue(gazetteIssue(today)) : '—';

  // Connexion : le tampon tombe sur la carte, puis la page des cartes du jour s'ouvre
  function connect(e: React.FormEvent) {
    e.preventDefault();
    if (connected) return;
    setConnected(true);
    window.setTimeout(onEnter, 1100);
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-4">
      <form
        onSubmit={connect}
        className="contract-card relative w-[min(92vw,560px)] rounded-[calc(var(--u)*2.2)] text-left"
        style={{ ['--u' as string]: 'min(0.92vw, 5.6px)', backgroundColor: '#f7f9fc', color: INK, padding: `${u(5)} ${u(5)} ${u(4)}` }}
      >
        <div className="flex gap-[calc(var(--u)*4)]">
          {/* COLONNE DE GAUCHE : la maison, l'intitulé et les champs de connexion, remplis au stylo */}
          <div className="min-w-0 flex-1">
            <p className="uppercase leading-none tracking-[0.01em]" style={{ ...narrow, fontSize: u(6.4) }}>
              Nana &amp; Co
            </p>
            <p className="mt-[calc(var(--u)*2.4)] uppercase leading-[1.35]" style={{ ...type, fontSize: u(2.7) }}>
              connexion à l&apos;application
            </p>

            <div className="mt-[calc(var(--u)*4.4)] space-y-[calc(var(--u)*2.6)]">
              <Field label="Identifiant">
                <input
                  value={login ?? txt.name}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  aria-label="Identifiant"
                  className="w-full bg-transparent outline-none"
                />
              </Field>
              <Field label="Mot de passe">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  aria-label="Mot de passe"
                  className="w-full bg-transparent outline-none"
                />
              </Field>
              <Field label="Le">{day}</Field>
            </div>
          </div>

          {/* COLONNE DE DROITE : validité, et photo d'identité entre ses coins de montage */}
          <div className="shrink-0" style={{ width: u(26) }}>
            <p className="uppercase leading-none" style={{ ...type, fontSize: u(2.7), fontWeight: 700 }}>
              Valable :
            </p>
            <p className="mt-[calc(var(--u)*0.6)] whitespace-nowrap leading-none" style={{ ...type, fontSize: u(2.7), fontWeight: 700 }}>
              {year} -{' '}
              <span className="font-normal" style={{ ...pen, fontSize: u(4.4) }}>
                aujourd&apos;hui
              </span>
            </p>
            <div className="relative mt-[calc(var(--u)*2.4)]" style={{ padding: u(1.3) }}>
              {/* coins de montage */}
              {['left-0 top-0 border-l border-t', 'right-0 top-0 border-r border-t', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'].map((c) => (
                <span key={c} className={`absolute ${c}`} style={{ width: u(3), height: u(3), borderColor: INK, borderWidth: u(0.35) }} aria-hidden />
              ))}
              <div className="aspect-[3/4] overflow-hidden" style={{ border: `${u(0.7)} solid #111` }}>
                {txt.photoPortrait ? (
                  // eslint-disable-next-line @next/next/no-img-element -- photo du stockage Supabase, taille déjà réduite
                  <img src={txt.photoPortrait} alt={`Photo de ${txt.name}`} className="block h-full w-full object-cover grayscale contrast-[1.05]" />
                ) : (
                  <div className="h-full grayscale">
                    <BluePhoto kind="portrait" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* BOUTON DE CONNEXION, sur toute la largeur de la carte */}
        <button
          type="submit"
          disabled={connected}
          className="mt-[calc(var(--u)*4)] block w-full rounded-full uppercase tracking-[0.2em] transition-transform active:scale-[0.98] disabled:opacity-70"
          style={{ ...type, fontSize: u(2.9), padding: `${u(2.4)} 0`, backgroundColor: INK, color: '#f7f9fc' }}
        >
          {connected ? 'Connexion…' : 'Se connecter'}
        </button>

        <div className="mt-[calc(var(--u)*2.6)] flex items-end justify-between">
          <p className="font-bold leading-none" style={{ ...narrow, fontSize: u(2.9) }}>
            ID No. {issue}
          </p>
          <p className="leading-none opacity-60" style={{ ...type, fontSize: u(2.4) }}>
            espace membre
          </p>
        </div>

        {/* Tampon de la maison, qui tombe sur la carte à la connexion */}
        <div
          className={`pointer-events-none absolute ${connected ? 'contract-stamp' : 'opacity-0'}`}
          style={{ width: u(32), right: u(-6), top: u(44) }}
          aria-hidden
        >
          <Stamp />
        </div>
      </form>
    </div>
  );
}

// Champ de la carte : intitulé en machine à écrire, valeur écrite au stylo sur une ligne
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-[calc(var(--u)*0.8)]">
      <span className="shrink-0 uppercase leading-none" style={{ ...type, fontSize: u(2.45), paddingBottom: u(0.8) }}>
        {label} :
      </span>
      <span className="min-w-0 flex-1 truncate border-b leading-[0.9]" style={{ ...pen, fontSize: u(5.2), borderColor: INK }}>
        {children}
      </span>
    </div>
  );
}

// Tampon octogonal « Nana & Co », texte en couronne
function Stamp() {
  const id = useId();
  const octagon = (r: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      return `${100 + r * Math.cos(a)},${100 + r * Math.sin(a)}`;
    }).join(' ');
  return (
    <svg viewBox="0 0 200 200" className="block h-auto w-full" style={{ color: INK, opacity: 0.78 }}>
      <defs>
        <path id={id} d="M 100 100 m -68 0 a 68 68 0 1 1 136 0 a 68 68 0 1 1 -136 0" />
      </defs>
      <polygon points={octagon(96)} fill="none" stroke="currentColor" strokeWidth={2.4} />
      <polygon points={octagon(54)} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <text fill="currentColor" style={{ ...narrow, fontSize: 16 }}>
        <textPath href={`#${id}`} startOffset="0" textLength={420} lengthAdjust="spacing">
          FAIRE DE SON MIEUX · CHAQUE JOUR ·
        </textPath>
      </text>
      <text x="92" y="100" textAnchor="middle" fill="currentColor" style={{ ...serif, fontSize: 34 }}>
        N&amp;
      </text>
      <text x="110" y="128" textAnchor="middle" fill="currentColor" style={{ ...serif, fontSize: 34 }}>
        Co
      </text>
    </svg>
  );
}
