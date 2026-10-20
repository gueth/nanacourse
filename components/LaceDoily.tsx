// Napperon ovale en dentelle (roses brodées, rameaux de feuilles, tulle à pois, bord festonné),
// dessiné en SVG dans un cadre de 412 x 922 (mêmes dimensions de référence que l'accueil).

const W = 412;
const H = 922;
const CX = W / 2;
const CY = H / 2 - 10;

// Rayons des différentes couronnes de l'ovale
const OUTER = { rx: 186, ry: 310 };
const ROSE_RING = { rx: 152, ry: 272 };
const INNER = { rx: 120, ry: 230 };

// Fil de la dentelle, et teinte du fond qui transparaît entre les fils
const LACE = '#ffffff';
const THREAD = '#7c9bc4';

// Arrondi au centième : Math.cos/Math.sin peuvent différer d'un chiffre en fin de décimales
// entre le serveur (Node) et le navigateur, ce qui casserait l'hydratation
function round(n: number) {
  return Math.round(n * 100) / 100;
}

function onEllipse(e: { rx: number; ry: number }, t: number, grow = 0) {
  return { x: round(CX + (e.rx + grow) * Math.cos(t)), y: round(CY + (e.ry + grow) * Math.sin(t)) };
}

// Point "x y" à une distance r du centre, à l'angle deg (0° = vers le haut)
function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${round(r * Math.cos(a))} ${round(r * Math.sin(a))}`;
}

// Bord festonné : une bosse (courbe quadratique) par feston, tournée vers l'extérieur
function scallopPath(e: { rx: number; ry: number }, count: number, amp: number) {
  const start = onEllipse(e, 0);
  let d = `M${start.x} ${start.y}`;
  for (let i = 0; i < count; i++) {
    const c = onEllipse(e, ((i + 0.5) / count) * Math.PI * 2, amp * 2);
    const p = onEllipse(e, ((i + 1) / count) * Math.PI * 2);
    d += ` Q${c.x} ${c.y} ${p.x} ${p.y}`;
  }
  return d + 'Z';
}

// Angle (en degrés) de la tangente à l'ellipse au paramètre t
function tangentDeg(e: { rx: number; ry: number }, t: number) {
  return round((Math.atan2(e.ry * Math.cos(t), -e.rx * Math.sin(t)) * 180) / Math.PI);
}

// Pétale centré sur l'angle a, entre les rayons rIn et rOut, d'ouverture ±w degrés,
// avec un bord ondulé en "bumps" petites vagues
function petalPath(a: number, rIn: number, rOut: number, w: number, bumps: number) {
  const mid = rIn + (rOut - rIn) * 0.4;
  let d = `M${polar(rIn, a - w * 0.5)} C${polar(mid, a - w * 1.1)} ${polar(rOut * 0.9, a - w * 1.15)} ${polar(rOut * 0.93, a - w)}`;
  const step = (2 * w) / bumps;
  for (let k = 0; k < bumps; k++) {
    const from = a - w + k * step;
    d += ` Q${polar(rOut * 1.08, from + step / 2)} ${polar(k === bumps - 1 ? rOut * 0.93 : rOut * 0.96, from + step)}`;
  }
  return d + ` C${polar(rOut * 0.9, a + w * 1.15)} ${polar(mid, a + w * 1.1)} ${polar(rIn, a + w * 0.5)} Q${polar(rIn * 0.7, a)} ${polar(rIn, a - w * 0.5)}Z`;
}

// Tracés d'une rose (rayon 22), calculés une seule fois puis réutilisés à chaque rose
const OUTER_PETALS = [0, 60, 120, 180, 240, 300].map((a) => ({
  shape: petalPath(a, 6, 22, 26, 3),
  contour: petalPath(a, 8, 18, 19, 3),
  veins: [-12, 0, 12].map((v) => `M${polar(9, a + v * 0.4)} L${polar(16.5, a + v)}`).join(' ')
}));
const MIDDLE_PETALS = [36, 108, 180, 252, 324].map((a) => ({
  shape: petalPath(a, 4, 15, 34, 2),
  contour: petalPath(a, 6, 12.5, 24, 2)
}));
const ROSE_SEEDS = [30, 90, 150, 210, 270, 330].map((a) => polar(21, a).split(' ').map(Number));

function Rose({ x, y, size, rotate }: { x: number; y: number; size: number; rotate: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${round(size / 22)})`}>
      {/* Pétales extérieurs : point de toile, cerné d'un cordonnet, avec nervures */}
      {OUTER_PETALS.map((p, i) => (
        <g key={i}>
          <path d={p.shape} fill="url(#cloth)" stroke={LACE} strokeWidth={1.8} strokeLinejoin="round" />
          <path d={p.shape} fill="none" stroke={THREAD} strokeWidth={0.5} strokeLinejoin="round" />
          <path d={p.contour} fill="none" stroke={THREAD} strokeWidth={0.45} />
          <path d={p.veins} fill="none" stroke={THREAD} strokeWidth={0.45} strokeLinecap="round" />
        </g>
      ))}
      {ROSE_SEEDS.map(([sx, sy], i) => (
        <circle key={i} cx={sx} cy={sy} r={0.9} fill={LACE} />
      ))}
      {/* Pétales du milieu, plus pleins */}
      {MIDDLE_PETALS.map((p, i) => (
        <g key={i}>
          <path d={p.shape} fill={LACE} stroke={THREAD} strokeWidth={0.6} strokeLinejoin="round" />
          <path d={p.contour} fill="none" stroke={THREAD} strokeWidth={0.4} />
        </g>
      ))}
      {/* Cœur : pétales enroulés */}
      <circle r={7.5} fill={LACE} stroke={THREAD} strokeWidth={0.6} />
      <path
        d="M-6 1.5 Q0 -7.5 6 1.5 M-4.6 4 Q0 -2.5 4.6 4 M-3 -4.5 Q2 -6 4.5 -2 M0 0 a1.5 1.5 0 0 1 3 0 a3 3 0 0 1 -6 0"
        fill="none"
        stroke={THREAD}
        strokeWidth={0.6}
        strokeLinecap="round"
      />
    </g>
  );
}

// Feuille en dentelle : point de toile, cordonnet, nervure centrale et nervures latérales
function Leaf({ x, y, rotate, len = 11 }: { x: number; y: number; rotate: number; len?: number }) {
  const w = len * 0.38;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <path
        d={`M0 0 Q${len * 0.3} ${-w * 1.3} ${len} 0 Q${len * 0.3} ${w * 1.3} 0 0Z`}
        fill="url(#cloth)"
        stroke={LACE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d={`M1 0 L${len * 0.85} 0 M${len * 0.3} 0 l${len * 0.18} ${-w * 0.6} M${len * 0.3} 0 l${len * 0.18} ${w * 0.6} M${len * 0.55} 0 l${len * 0.14} ${-w * 0.45} M${len * 0.55} 0 l${len * 0.14} ${w * 0.45}`}
        fill="none"
        stroke={THREAD}
        strokeWidth={0.4}
      />
    </g>
  );
}

// Rameau entre deux roses : tige, feuilles alternées, vrille et petit bouton de rose
function Sprig({ x, y, rotate }: { x: number; y: number; rotate: number }) {
  const leaves = [
    { x: -18, y: -0.5, rotate: -140 },
    { x: -16, y: 0.5, rotate: 140 },
    { x: -9, y: -1, rotate: -45 },
    { x: -3, y: 1, rotate: 45 },
    { x: 4, y: -1, rotate: -40 },
    { x: 10, y: 1, rotate: 40 }
  ];
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <path d="M-22 0 Q0 -3 18 0" fill="none" stroke={LACE} strokeWidth={1.3} />
      <path d="M-6 -1 q-3 -8 2 -10 q3 -1 3 2" fill="none" stroke={LACE} strokeWidth={0.7} strokeLinecap="round" />
      {leaves.map((l, i) => (
        <Leaf key={i} {...l} />
      ))}
      {/* Bouton de rose avec ses sépales */}
      <path d="M17 0 l5 -4 M17 0 l5 4" stroke={LACE} strokeWidth={0.9} strokeLinecap="round" />
      <ellipse cx={23} cy={0} rx={4.2} ry={3.4} fill="url(#cloth)" stroke={LACE} strokeWidth={1} />
      <path d="M20.5 0 q2.5 -2.5 5 0 q-2.5 1.8 -5 0" fill="none" stroke={THREAD} strokeWidth={0.45} />
    </g>
  );
}

const ROSE_COUNT = 14;
const roses = Array.from({ length: ROSE_COUNT }, (_, i) => {
  const t = (i / ROSE_COUNT) * Math.PI * 2 - Math.PI / 2;
  return { ...onEllipse(ROSE_RING, t), rotate: i * 37 };
});
const sprigs = Array.from({ length: ROSE_COUNT }, (_, i) => {
  const t = ((i + 0.5) / ROSE_COUNT) * Math.PI * 2 - Math.PI / 2;
  return { ...onEllipse(ROSE_RING, t), rotate: tangentDeg(ROSE_RING, t) };
});

// Bord extérieur : une boucle (picot) au sommet de chaque feston, un pois entre deux festons
const SCALLOP_COUNT = 46;
const picotLoops = Array.from({ length: SCALLOP_COUNT }, (_, i) =>
  onEllipse(OUTER, ((i + 0.5) / SCALLOP_COUNT) * Math.PI * 2, 9)
);
const picotDots = Array.from({ length: SCALLOP_COUNT }, (_, i) =>
  onEllipse(OUTER, (i / SCALLOP_COUNT) * Math.PI * 2, 3)
);
// Petits picots tournés vers l'intérieur, le long de la bordure intérieure
const innerPicots = Array.from({ length: 60 }, (_, i) => onEllipse(INNER, ((i + 0.5) / 60) * Math.PI * 2, -10));

// Pois brodés ("point d'esprit") dans le tulle du centre, en laissant de la place pour le titre
const dots: { x: number; y: number }[] = [];
for (let row = -10; row <= 10; row++) {
  for (let col = -5; col <= 5; col++) {
    const x = col * 22 + (row % 2 ? 11 : 0);
    const y = row * 22;
    const inside = (x / (INNER.rx - 18)) ** 2 + (y / (INNER.ry - 18)) ** 2 < 1;
    const nearTitle = Math.abs(x) < 68 && Math.abs(y) < 20;
    if (inside && !nearTitle) dots.push({ x: CX + x, y: CY + y });
  }
}

// "nana" en Edwardian Script ITC, converti en tracé vectoriel (centré sur le napperon) :
// la police n'existe pas en police web, elle ne s'afficherait pas sur un téléphone qui ne l'a pas
const TITLE_PATH =
  'M180.97 449.03L180.97 449.03Q180.97 449.81 175.59 456.23L175.59 456.23Q171.17 461.50 168.65 461.50L168.65 461.50Q166.98 461.50 165.85 460.20Q164.72 458.90 164.72 457.01L164.72 457.01Q164.72 455.34 165.40 453.91Q166.09 452.48 168.98 448.25L168.98 448.25Q171.99 443.80 171.99 442.58L171.99 442.58Q171.99 441.05 170.39 441.05L170.39 441.05Q164.98 441.05 153.69 461.17L153.69 461.17Q151.88 461.02 151.50 461.02L151.50 461.02Q150.21 461.02 149.06 461.17L149.06 461.17L154.84 452.00Q159.78 444.13 159.78 442.17L159.78 442.17Q159.78 441.05 158.85 441.05L158.85 441.05Q156.96 441.05 151.39 449.03L151.39 449.03Q151.06 449.52 150.87 449.55L150.87 449.55Q150.69 449.55 150.65 449.33L150.65 449.33Q150.69 449.14 150.80 449.03L150.80 449.03L151.50 448.11Q157.18 440.50 159.15 440.50L159.15 440.50Q160.41 440.50 161.30 441.65Q162.19 442.80 162.19 444.39L162.19 444.39Q162.19 446.77 159.41 451L159.41 451Q163.79 444.95 166.14 442.72Q168.50 440.50 170.50 440.50L170.50 440.50Q172.14 440.50 173.25 441.83Q174.36 443.17 174.36 445.14L174.36 445.14Q174.36 447.62 170.95 452.74L170.95 452.74Q167.46 457.98 167.46 459.42L167.46 459.42Q167.46 460.95 168.98 460.95L168.98 460.95Q172.29 460.95 180.38 449.18L180.38 449.18Q180.56 448.81 180.75 448.81L180.75 448.81Q180.97 448.81 180.97 449.03ZM207.06 449.03L207.06 449.03Q207.06 449.81 201.64 456.23L201.64 456.23Q197.26 461.50 194.74 461.50L194.74 461.50Q193.03 461.50 191.95 460.22Q190.88 458.94 190.88 457.01L190.88 457.01Q190.88 455.01 192.07 452.67L192.07 452.67Q188.35 457.87 186.39 459.68Q184.42 461.50 182.57 461.50L182.57 461.50Q180.60 461.50 179.26 459.81Q177.93 458.13 177.93 455.56L177.93 455.56Q177.93 448.44 187.98 442.95L187.98 442.95Q192.40 440.50 195.11 440.50L195.11 440.50Q197.41 440.50 197.41 442.72L197.41 442.72Q197.41 443.36 197.11 444.39L197.11 444.39L199.00 440.79Q200.12 441.05 200.97 441.05L200.97 441.05Q201.97 441.05 203.57 440.79L203.57 440.79L197.00 451.67Q193.59 457.38 193.59 459.20L193.59 459.20Q193.59 460.95 195.03 460.95L195.03 460.95Q196.52 460.95 199.78 457.55Q203.05 454.15 206.43 449.18L206.43 449.18Q206.65 448.81 206.83 448.81L206.83 448.81Q207.06 448.81 207.06 449.03ZM196.85 442.87L196.85 442.87Q196.85 441.05 195.18 441.05L195.18 441.05Q191.77 441.05 186.22 447.73Q180.67 454.41 180.67 458.53L180.67 458.53Q180.67 460.95 182.83 460.95L182.83 460.95Q185.39 460.95 191.69 452.45L191.69 452.45Q196.85 445.47 196.85 442.87ZM236.86 449.03L236.86 449.03Q236.86 449.81 231.48 456.23L231.48 456.23Q227.06 461.50 224.54 461.50L224.54 461.50Q222.87 461.50 221.73 460.20Q220.60 458.90 220.60 457.01L220.60 457.01Q220.60 455.34 221.29 453.91Q221.98 452.48 224.87 448.25L224.87 448.25Q227.88 443.80 227.88 442.58L227.88 442.58Q227.88 441.05 226.28 441.05L226.28 441.05Q220.86 441.05 209.58 461.17L209.58 461.17Q207.76 461.02 207.39 461.02L207.39 461.02Q206.09 461.02 204.94 461.17L204.94 461.17L210.73 452.00Q215.67 444.13 215.67 442.17L215.67 442.17Q215.67 441.05 214.74 441.05L214.74 441.05Q212.85 441.05 207.28 449.03L207.28 449.03Q206.95 449.52 206.76 449.55L206.76 449.55Q206.58 449.55 206.54 449.33L206.54 449.33Q206.58 449.14 206.69 449.03L206.69 449.03L207.39 448.11Q213.07 440.50 215.04 440.50L215.04 440.50Q216.30 440.50 217.19 441.65Q218.08 442.80 218.08 444.39L218.08 444.39Q218.08 446.77 215.30 451L215.30 451Q219.67 444.95 222.03 442.72Q224.39 440.50 226.39 440.50L226.39 440.50Q228.02 440.50 229.14 441.83Q230.25 443.17 230.25 445.14L230.25 445.14Q230.25 447.62 226.84 452.74L226.84 452.74Q223.35 457.98 223.35 459.42L223.35 459.42Q223.35 460.95 224.87 460.95L224.87 460.95Q228.17 460.95 236.26 449.18L236.26 449.18Q236.45 448.81 236.63 448.81L236.63 448.81Q236.86 448.81 236.86 449.03ZM262.94 449.03L262.94 449.03Q262.94 449.81 257.53 456.23L257.53 456.23Q253.15 461.50 250.62 461.50L250.62 461.50Q248.92 461.50 247.84 460.22Q246.76 458.94 246.76 457.01L246.76 457.01Q246.76 455.01 247.95 452.67L247.95 452.67Q244.24 457.87 242.27 459.68Q240.31 461.50 238.45 461.50L238.45 461.50Q236.49 461.50 235.15 459.81Q233.81 458.13 233.81 455.56L233.81 455.56Q233.81 448.44 243.87 442.95L243.87 442.95Q248.29 440.50 251.00 440.50L251.00 440.50Q253.30 440.50 253.30 442.72L253.30 442.72Q253.30 443.36 253.00 444.39L253.00 444.39L254.89 440.79Q256.00 441.05 256.86 441.05L256.86 441.05Q257.86 441.05 259.46 440.79L259.46 440.79L252.89 451.67Q249.47 457.38 249.47 459.20L249.47 459.20Q249.47 460.95 250.92 460.95L250.92 460.95Q252.41 460.95 255.67 457.55Q258.94 454.15 262.31 449.18L262.31 449.18Q262.54 448.81 262.72 448.81L262.72 448.81Q262.94 448.81 262.94 449.03ZM252.74 442.87L252.74 442.87Q252.74 441.05 251.07 441.05L251.07 441.05Q247.66 441.05 242.11 447.73Q236.56 454.41 236.56 458.53L236.56 458.53Q236.56 460.95 238.71 460.95L238.71 460.95Q241.27 460.95 247.58 452.45L247.58 452.45Q252.74 445.47 252.74 442.87Z';

export function LaceDoily({ title }: { title: string }) {
  const outerPath = scallopPath(OUTER, SCALLOP_COUNT, 6);
  const innerPath = scallopPath(INNER, 30, 3.5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-label={title} role="img">
      <defs>
        {/* Tulle à mailles hexagonales */}
        <pattern id="tulle" width="6" height="10.392" patternUnits="userSpaceOnUse" patternTransform="scale(0.6)">
          <path
            d="M0 1.732 L3 0 L6 1.732 M0 1.732 V5.196 L3 6.928 L6 5.196 V1.732 M3 6.928 V10.392"
            fill="none"
            stroke={LACE}
            strokeWidth="0.55"
            opacity="0.5"
          />
        </pattern>
        {/* Point de toile : fils serrés des motifs (pétales, feuilles) */}
        <pattern id="cloth" width="1.8" height="1.8" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <rect width="1.8" height="1.8" fill={LACE} opacity="0.4" />
          <path d="M0 0.9 H1.8" stroke={LACE} strokeWidth="0.55" />
        </pattern>
        <clipPath id="doily-clip">
          <path d={outerPath} />
        </clipPath>
        <filter id="lace-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#2c4670" floodOpacity="0.4" />
        </filter>
      </defs>

      <g filter="url(#lace-shadow)">
        {/* Fond du napperon : tulle transparent */}
        <path d={outerPath} fill={LACE} fillOpacity={0.06} />
        <rect width={W} height={H} fill="url(#tulle)" clipPath="url(#doily-clip)" />

        {/* Bord extérieur festonné, doublé d'une ligne intérieure, avec picots */}
        <path d={outerPath} fill="none" stroke={LACE} strokeWidth={2.6} />
        <path d={scallopPath({ rx: OUTER.rx - 7, ry: OUTER.ry - 7 }, SCALLOP_COUNT, 4)} fill="none" stroke={LACE} strokeWidth={0.9} />
        {picotLoops.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2} fill="none" stroke={LACE} strokeWidth={0.9} />
        ))}
        {picotDots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.1} fill={LACE} />
        ))}

        {/* Couronne de rameaux et de roses */}
        {sprigs.map((s, i) => (
          <Sprig key={i} {...s} />
        ))}
        {roses.map((r, i) => (
          <Rose key={i} x={r.x} y={r.y} size={i % 2 === 0 ? 27 : 24} rotate={r.rotate} />
        ))}

        {/* Bordure intérieure festonnée (double trait) et ses picots */}
        <path d={innerPath} fill="none" stroke={LACE} strokeWidth={2.2} />
        <path d={scallopPath({ rx: INNER.rx - 5, ry: INNER.ry - 5 }, 30, 2.5)} fill="none" stroke={LACE} strokeWidth={0.8} />
        {innerPicots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.9} fill={LACE} />
        ))}

        {/* Pois du centre */}
        {dots.map((d, i) => (
          <g key={i}>
            <circle cx={d.x} cy={d.y} r={1.7} fill={LACE} />
            <circle cx={d.x} cy={d.y} r={3} fill="none" stroke={LACE} strokeWidth={0.4} opacity={0.6} />
          </g>
        ))}
      </g>

      {/* Inscription centrale, brodée au fil : lettres pleines en blanc, comme le reste de la dentelle */}
      <path
        d={TITLE_PATH}
        fill={LACE}
        stroke={LACE}
        strokeWidth={0.6}
        strokeLinejoin="round"
        filter="url(#lace-shadow)"
      />
    </svg>
  );
}
