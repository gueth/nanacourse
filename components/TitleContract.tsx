'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { BluePhoto } from '@/components/profile/ProfileParts';
import { formatIssue, gazetteIssue } from '@/lib/gazette';
import { getDefaultProfileTexts, getProfileTexts, subscribeProfileTexts, syncProfileTexts } from '@/lib/profileTexts';
import { contractDay, readSignature, saveSignature, subscribeSignature } from '@/lib/signature';

// Page de titre (2ᵉ écran) : une carte-contrat « Nana & Co » sur fond bleu uni, façon carte de membre.
// La personne (prénom et photo d'identité de la page Profil) s'engage à faire de son mieux pour la journée,
// puis signe avec le doigt ou la souris sur la ligne prévue : une fois signé, le tampon tombe et l'accueil s'ouvre.
// On ne signe qu'à la première visite de la journée : ensuite la signature et le tampon restent affichés
// et il suffit de faire défiler pour entrer, jusqu'à 4 h du matin où ils s'effacent (lib/signature).

const INK = '#1d2b4a';
// Tailles proportionnelles à la largeur de la carte (1 unité = 1 % de la carte)
const u = (n: number) => `calc(var(--u) * ${n})`;
const narrow = { fontFamily: 'var(--font-narrow), "Arial Narrow", sans-serif' };
const type = { fontFamily: 'var(--font-courier), monospace' };
const pen = { fontFamily: 'var(--font-pen), cursive' };
const serif = { fontFamily: 'var(--font-serif), Georgia, serif' };

const noSubscribe = () => () => {};
// Journée du contrat : elle change à 4 h du matin, comme la signature
const readToday = () => contractDay();

// Longueur minimale du trait (en pixels) pour compter comme une signature
const MIN_SIGNATURE = 120;

export function TitleContract({ onSigned, onContinue }: { onSigned: () => void; onContinue: () => void }) {
  const txt = useSyncExternalStore(subscribeProfileTexts, getProfileTexts, getDefaultProfileTexts);
  const todayKey = useSyncExternalStore(noSubscribe, readToday, () => null);
  const today = todayKey ? new Date(todayKey) : null;
  // Signature déjà faite aujourd'hui (image), ou signature qui vient d'être faite
  const savedSignature = useSyncExternalStore(subscribeSignature, readSignature, () => null);
  const [justSigned, setJustSigned] = useState(false);
  const signed = justSigned || !!savedSignature;

  // Prénom et photo à jour depuis Supabase (la copie du navigateur s'affiche en attendant)
  useEffect(() => {
    syncProfileTexts();
  }, []);

  const day = today?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) ?? '';
  const year = today?.getFullYear() ?? '';
  const issue = today ? formatIssue(gazetteIssue(today)) : '—';

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-4">
      <div
        className="contract-card relative w-[min(92vw,560px)] rounded-[calc(var(--u)*2.2)] text-left"
        style={{ ['--u' as string]: 'min(0.92vw, 5.6px)', backgroundColor: '#f7f9fc', color: INK, padding: `${u(5)} ${u(5)} ${u(4)}` }}
      >
        <div className="flex gap-[calc(var(--u)*4)]">
          {/* COLONNE DE GAUCHE : la maison, la déclaration et les champs remplis au stylo */}
          <div className="min-w-0 flex-1">
            <p className="uppercase leading-none tracking-[0.01em]" style={{ ...narrow, fontSize: u(6.4) }}>
              Nana &amp; Co
            </p>
            <p className="mt-[calc(var(--u)*2.4)] uppercase leading-[1.35]" style={{ ...type, fontSize: u(2.7) }}>
              La personne qui tient
              <br />
              cette carte est une
              <br />
              faiseuse de mieux certifiée
            </p>

            <div className="mt-[calc(var(--u)*5)] space-y-[calc(var(--u)*2.6)]">
              <Field label="Je soussigné(e)">{txt.name}</Field>
              <Field label="M'engage à">faire de mon mieux</Field>
              <Field label="Pour la journée du">{day}</Field>
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

        {/* SIGNATURE : au doigt ou à la souris, sur toute la largeur de la carte */}
        <div className="mt-[calc(var(--u)*3.4)] flex items-end gap-[calc(var(--u)*1.5)]">
          <span className="shrink-0 uppercase leading-none" style={{ ...type, fontSize: u(2.7), paddingBottom: u(1.2) }}>
            Signature :
          </span>
          {savedSignature && !justSigned ? (
            // eslint-disable-next-line @next/next/no-img-element -- image du trait enregistrée dans le navigateur
            <img src={savedSignature} alt={`Signature de ${txt.name}`} className="block min-w-0 flex-1 border-b object-fill" style={{ height: u(13), borderColor: INK }} />
          ) : (
            <SignaturePad
              disabled={signed}
              onSigned={(image) => {
                setJustSigned(true);
                saveSignature(image);
                setTimeout(onSigned, 1300);
              }}
            />
          )}
        </div>

        <div className="mt-[calc(var(--u)*2.6)] flex items-end justify-between">
          <p className="font-bold leading-none" style={{ ...narrow, fontSize: u(2.9) }}>
            ID No. {issue}
          </p>
          <p className={`leading-none transition-opacity ${signed ? 'opacity-0' : 'opacity-60'}`} style={{ ...type, fontSize: u(2.4) }}>
            signe sur la ligne pour entrer
          </p>
        </div>

        {/* Tampon de la maison, qui tombe sur la carte une fois signée */}
        <div
          className={`pointer-events-none absolute ${signed ? 'contract-stamp' : 'opacity-0'}`}
          style={{ width: u(32), right: u(-6), top: u(44) }}
          aria-hidden
        >
          <Stamp />
        </div>
      </div>

      {/* Déjà signé aujourd'hui : il suffit de faire défiler (ou de toucher ce texte) pour entrer, sans resigner */}
      {savedSignature && !justSigned && (
        <button type="button" onClick={onContinue} className="morning-hint mt-6 px-4 py-2 text-[13px] text-neutral-600" style={type}>
          Fais défiler pour entrer
        </button>
      )}

      {/* Pour le clavier : entrer sans signer (visible seulement quand il a le focus) */}
      <button type="button" onClick={onSigned} className="sr-only focus:not-sr-only focus:mt-4 focus:text-sm focus:text-neutral-700">
        Entrer sans signer
      </button>
    </div>
  );
}

// Champ du contrat : intitulé en machine à écrire, valeur écrite au stylo sur une ligne
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex items-end gap-[calc(var(--u)*0.8)]">
      <span className="shrink-0 uppercase leading-none" style={{ ...type, fontSize: u(2.45), paddingBottom: u(0.8) }}>
        {label} :
      </span>
      <span className="min-w-0 flex-1 truncate border-b leading-[0.9]" style={{ ...pen, fontSize: u(5.2), borderColor: INK }}>
        {children}
      </span>
    </p>
  );
}

// Ligne de signature : on trace avec le doigt ou la souris ; au-delà d'une certaine longueur de trait,
// la signature est validée quand on lève le doigt
function SignaturePad({ disabled, onSigned }: { disabled: boolean; onSigned: (image: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const length = useRef(0);

  // Toile à la résolution de l'écran
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const g = c.getContext('2d');
      if (!g) return;
      g.scale(dpr, dpr);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = INK;
      length.current = 0;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas
      ref={canvas}
      aria-label="Zone de signature : trace ta signature avec le doigt ou la souris"
      className="block min-w-0 flex-1 cursor-crosshair touch-none border-b"
      style={{ height: u(13), borderColor: INK }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        last.current = point(e);
      }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return;
        const g = e.currentTarget.getContext('2d');
        const p = point(e);
        const d = Math.hypot(p.x - last.current.x, p.y - last.current.y);
        if (!g || d < 0.5) return;
        // trait un peu plus fin quand on va vite, comme un stylo
        g.lineWidth = Math.max(1.2, 2.6 - d / 12);
        g.beginPath();
        g.moveTo(last.current.x, last.current.y);
        g.lineTo(p.x, p.y);
        g.stroke();
        length.current += d;
        last.current = p;
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
        if (!disabled && length.current >= MIN_SIGNATURE && canvas.current) onSigned(canvas.current.toDataURL('image/png'));
      }}
      onPointerCancel={() => {
        drawing.current = false;
        last.current = null;
      }}
    />
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
