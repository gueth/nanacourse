// Éléments de décor de la page Profil, façon « portfolio » : enveloppe, napperon, ruban, trombone,
// photos teintées en bleu, ticket de caisse et timbre. Tout est dessiné en SVG/CSS (aucune image).

// Palette : fond pervenche, papier, encre bleue et gris de l'enveloppe
export const PF = {
  bg: '#8494c6',
  paper: '#f6f5f1',
  ink: '#2c3442',
  blue: '#3563a8',
  pale: '#c9d6ec',
  envelope: '#5d5f63'
};

export const script = { fontFamily: 'var(--font-script), cursive' };
export const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };
export const mono = { fontFamily: 'var(--font-type)' };

// Grain de papier léger, par-dessus un fond uni
export const paperGrain = {
  backgroundColor: PF.paper,
  backgroundImage:
    'radial-gradient(circle at 20% 30%, rgba(0,0,0,0.025) 0, transparent 40%), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.03) 0, transparent 45%), repeating-linear-gradient(0deg, rgba(0,0,0,0.012) 0 1px, transparent 1px 3px)'
};

const round = (n: number) => Math.round(n * 100) / 100;

// Enveloppe grise : rabats en diagonale, grand « Profil » calligraphié
export function Envelope({ name, year, handle, email }: { name: string; year: string; handle: string; email: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-[3px] text-white shadow-[0_10px_24px_rgba(20,30,60,0.35)]"
      style={{ aspectRatio: '1.75', background: `radial-gradient(ellipse at 50% 40%, #6c6e72 0%, ${PF.envelope} 55%, #464749 100%)` }}
    >
      {/* Rabats : deux diagonales qui se rejoignent au centre, et le rabat du haut */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 350 200" preserveAspectRatio="none" aria-hidden>
        <path d="M0 0 L175 118 L350 0" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
        <path d="M0 200 L150 100 M350 200 L200 100" stroke="rgba(0,0,0,0.18)" strokeWidth={1.2} />
      </svg>
      {/* Poussière de papier */}
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.25) 0.6px, transparent 0.8px)', backgroundSize: '23px 19px' }} />

      <p className="absolute left-1/2 top-[22%] text-[8px] uppercase tracking-[0.25em] opacity-90" style={serif}>
        ( mon — profil )
      </p>
      <h1
        className="absolute inset-x-0 top-[24%] text-center text-[96px] leading-none"
        style={{ ...script, color: 'rgba(255,255,255,0.88)', textShadow: '0 2px 6px rgba(0,0,0,0.35)' }}
      >
        Profil
      </h1>
      <p className="absolute left-[7%] top-[62%] text-[8px] uppercase tracking-[0.2em] opacity-90" style={serif}>
        ({name})
      </p>
      <p className="absolute right-[6%] top-[48%] text-[8px] tracking-[0.15em] opacity-90" style={serif}>
        ({year})
      </p>
      <p className="absolute bottom-2 left-3 text-[7px] opacity-70" style={serif}>
        {handle}
      </p>
      <p className="absolute bottom-2 right-3 text-[7px] opacity-70" style={serif}>
        {email}
      </p>
    </div>
  );
}

// Napperon rond en dentelle : bord festonné, couronnes de jours et de fleurettes
export function Doily({ size = 320, className = '' }: { size?: number; className?: string }) {
  const c = 100;
  const scallops = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return { x: round(c + 92 * Math.cos(a)), y: round(c + 92 * Math.sin(a)) };
  });
  const ring = (r: number, n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i + offset) / n) * Math.PI * 2;
      return { x: round(c + r * Math.cos(a)), y: round(c + r * Math.sin(a)) };
    });
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-hidden>
      <g fill="#fff" opacity={0.85}>
        {scallops.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={8.5} />
        ))}
        <circle cx={c} cy={c} r={92} />
      </g>
      <g fill="none" stroke="#9fb2d8" strokeWidth={0.6}>
        <circle cx={c} cy={c} r={84} strokeDasharray="1.5 2.5" />
        <circle cx={c} cy={c} r={62} />
        <circle cx={c} cy={c} r={40} strokeDasharray="2 2" />
      </g>
      {/* Jours (petits trous) et fleurettes */}
      <g fill="#c9d4ea">
        {ring(76, 30).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.4} />
        ))}
        {ring(51, 18, 0.5).map((p, i) => (
          <g key={i}>
            {[0, 72, 144, 216, 288].map((d) => (
              <ellipse key={d} cx={p.x} cy={p.y - 3} rx={1.4} ry={3} transform={`rotate(${d} ${p.x} ${p.y})`} />
            ))}
          </g>
        ))}
        {ring(28, 12).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.6} />
        ))}
      </g>
    </svg>
  );
}

// Ruban de satin bleu, noué en boucle
export function Ribbon({ className = '' }: { className?: string }) {
  return (
    <svg width={90} height={150} viewBox="0 0 90 150" className={className} aria-hidden>
      <defs>
        <linearGradient id="satin" x1="0" x2="1">
          <stop offset="0" stopColor="#3f62a8" />
          <stop offset="0.5" stopColor="#7d9ad3" />
          <stop offset="1" stopColor="#3a5a9c" />
        </linearGradient>
      </defs>
      <path d="M-10 20 C 30 10, 70 30, 60 60 C 50 85, 10 70, 25 55 C 40 40, 80 70, 70 105 C 62 130, 30 140, -10 135" fill="none" stroke="url(#satin)" strokeWidth={13} strokeLinecap="round" />
    </svg>
  );
}

// Trombone argenté
export function PaperClip({ className = '' }: { className?: string }) {
  return (
    <svg width={14} height={40} viewBox="0 0 14 40" className={className} aria-hidden>
      <path d="M4 30 V8 a3 3 0 0 1 6 0 V32 a5 5 0 0 1 -10 0 V12" fill="none" stroke="#9aa3ad" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

// Photo teintée en bleu (bichromie) : silhouette dessinée, en pied ou en buste
export function BluePhoto({ kind }: { kind: 'standing' | 'portrait' }) {
  return (
    <svg viewBox="0 0 100 150" className="block h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`sky-${kind}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a74b8" />
          <stop offset="1" stopColor="#24457f" />
        </linearGradient>
      </defs>
      <rect width="100" height="150" fill={`url(#sky-${kind})`} />
      {kind === 'standing' ? (
        <>
          {/* Devanture de boutique et enseigne */}
          <rect x="0" y="0" width="100" height="22" fill="#2b4f8c" />
          <rect x="8" y="5" width="18" height="12" fill="#9bb6e3" opacity={0.6} />
          <rect x="34" y="5" width="18" height="12" fill="#9bb6e3" opacity={0.6} />
          <rect x="70" y="22" width="22" height="128" fill="#3a63a6" />
          <rect x="0" y="128" width="100" height="22" fill="#5b82c2" />
          {/* Silhouette en pied, écharpe et bottes */}
          <g fill="#cfdcf2">
            <circle cx="48" cy="40" r="8" />
            <path d="M38 52 Q48 46 58 52 L61 84 L35 84 Z" />
            <rect x="37" y="84" width="22" height="12" rx="2" fill="#a9bfe6" />
            <rect x="40" y="96" width="5" height="26" />
            <rect x="51" y="96" width="5" height="26" />
            <rect x="38" y="118" width="9" height="12" rx="2" fill="#f2f6fd" />
            <rect x="49" y="118" width="9" height="12" rx="2" fill="#f2f6fd" />
          </g>
          <path d="M40 50 L56 50 L58 66 L52 62" fill="none" stroke="#e8eef9" strokeWidth={3} strokeDasharray="2 1.5" />
          <path d="M34 34 Q48 22 62 34 L60 46 Q48 38 36 46 Z" fill="#1d3561" />
        </>
      ) : (
        <>
          <rect x="0" y="0" width="100" height="150" fill="#e7eef9" opacity={0.25} />
          {/* Portrait en buste, cheveux longs, col et cravate */}
          <path d="M26 62 Q24 28 50 26 Q76 28 74 62 L78 112 L22 112 Z" fill="#1d3561" />
          <ellipse cx="50" cy="60" rx="17" ry="21" fill="#cfdcf2" />
          <path d="M14 150 Q16 108 50 104 Q84 108 86 150 Z" fill="#f2f6fd" />
          <path d="M42 106 L50 118 L58 106" fill="#cfdcf2" />
          <path d="M47 116 L53 116 L55 140 L50 146 L45 140 Z" fill="#2b4f8c" />
          <path d="M33 48 Q50 34 67 48 Q60 40 50 40 Q40 40 33 48" fill="#1d3561" />
        </>
      )}
    </svg>
  );
}

// Cadre de timbre-poste : bord perforé autour d'une carte
export function Stamp({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`p-[6px] drop-shadow-[0_3px_5px_rgba(20,30,60,0.25)] ${className}`}
      style={{ background: 'radial-gradient(circle, transparent 3px, #fbfaf7 3.5px) -5px -5px / 10px 10px' }}
    >
      <div className="border px-3 py-2" style={{ backgroundColor: '#fbfaf7', borderColor: PF.blue }}>
        {children}
      </div>
    </div>
  );
}

// Section de la page de droite du carnet : titre calligraphié numéroté, puis son contenu
export function NoteSection({ title, n, children }: { title: string; n: number; children: React.ReactNode }) {
  return (
    <section className="mt-3 text-center">
      <h3 className="text-[26px] leading-none" style={{ ...script, color: PF.blue }}>
        {title}
        <sup className="ml-0.5 text-[8px]" style={serif}>
          ({n})
        </sup>
      </h3>
      <div className="mt-1 text-[10px] leading-snug" style={{ ...serif, color: PF.ink }}>
        {children}
      </div>
    </section>
  );
}
