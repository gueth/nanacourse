'use client';

import { useState } from 'react';
import { FIN } from '@/components/finance/FinanceParts';

// Couleurs des séries, validées (daltonisme, contraste) sur le fond papier : bleu puis or, toujours dans cet ordre
export const SERIES_COLORS = ['#3f6fa8', '#b5832e'];

export type Series = { name: string; color: string; values: (number | null)[] };

// Graphique d'évolution mois par mois : barres (côte à côte si plusieurs séries) ou courbe.
// Un toucher sur un mois affiche ses valeurs ; "Voir les chiffres" déplie le tableau.
export function TrendChart({
  months,
  series,
  kind,
  format,
  reference,
  width = 340,
  height = 150
}: {
  months: string[]; // AAAA-MM
  series: Series[];
  kind: 'bar' | 'line';
  format: (n: number) => string;
  reference?: { value: number; label: string }; // ligne repère (ex : objectif de 10 %)
  // Taille du dessin : un graphique placé dans une colonne étroite prend un dessin plus étroit,
  // pour que ses textes ne soient pas réduits au point d'être illisibles
  width?: number;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const W = width;
  const H = height;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (reference) values.push(reference.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => pad.top + ((max - v) / span) * plotH;
  const step = plotW / months.length;
  const cx = (i: number) => pad.left + step * (i + 0.5);
  const monthShort = (p: string) => {
    const [yy, mm] = p.split('-').map(Number);
    return new Date(yy, mm - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
  };
  const monthLong = (p: string) => {
    const [yy, mm] = p.split('-').map(Number);
    return new Date(yy, mm - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  // Barre avec coins arrondis (4 px) seulement du côté de la valeur, l'autre bout posé sur la ligne zéro
  const bar = (x: number, w: number, v: number) => {
    const y0 = y(0);
    const y1 = y(v);
    const h = Math.abs(y0 - y1);
    const r = Math.min(4, w / 2, h);
    if (h < 0.5) return '';
    return v >= 0
      ? `M${x} ${y0} V${y1 + r} Q${x} ${y1} ${x + r} ${y1} H${x + w - r} Q${x + w} ${y1} ${x + w} ${y1 + r} V${y0}Z`
      : `M${x} ${y0} V${y1 - r} Q${x} ${y1} ${x + r} ${y1} H${x + w - r} Q${x + w} ${y1} ${x + w} ${y1 - r} V${y0}Z`;
  };

  const groupW = Math.min(step * 0.6, 26 * series.length);
  const barW = (groupW - 2 * (series.length - 1)) / series.length;
  const ticks = [max, (max + min) / 2, min];

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-1 flex gap-4 text-[10px]" style={{ color: FIN.slate }}>
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
          {/* Grille discrète */}
          {ticks.map((t, i) => (
            <line key={i} x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={FIN.line} strokeWidth={0.6} strokeDasharray={t === 0 ? undefined : '2 3'} />
          ))}
          {min < 0 && <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke={FIN.slate} strokeWidth={0.8} />}
          {reference && (
            <>
              <line x1={pad.left} x2={W - pad.right} y1={y(reference.value)} y2={y(reference.value)} stroke={FIN.slate} strokeWidth={1} strokeDasharray="4 3" />
              <text x={W - pad.right} y={y(reference.value) - 3} textAnchor="end" fontSize={8} fill={FIN.slate}>
                {reference.label}
              </text>
            </>
          )}

          {kind === 'bar' &&
            series.map((s, si) =>
              s.values.map((v, i) =>
                v === null ? null : (
                  <path
                    key={`${si}-${i}`}
                    d={bar(cx(i) - groupW / 2 + si * (barW + 2), barW, v)}
                    fill={s.color}
                    opacity={active === null || active === i ? 1 : 0.45}
                  />
                )
              )
            )}

          {kind === 'line' &&
            series.map((s) => {
              const pts = s.values.map((v, i) => (v === null ? null : ([cx(i), y(v)] as const)));
              const d = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? ' L' : ' M'}${p[0]} ${p[1]}` : acc), '');
              const lastIndex = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
              return (
                <g key={s.name}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p, i) =>
                    p ? <circle key={i} cx={p[0]} cy={p[1]} r={active === i ? 5 : 4} fill={s.color} stroke={FIN.paper} strokeWidth={2} /> : null
                  )}
                  {/* Libellé direct sur le dernier point seulement */}
                  {lastIndex !== undefined && active === null && (
                    <text x={cx(lastIndex)} y={y(s.values[lastIndex]!) - 9} textAnchor="middle" fontSize={9} fontWeight="bold" fill={FIN.navy}>
                      {format(s.values[lastIndex]!)}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Mois en abscisse */}
          {months.map((m, i) => (
            <text key={m} x={cx(i)} y={H - 6} textAnchor="middle" fontSize={9} fill={active === i ? FIN.navy : FIN.slate} fontWeight={active === i ? 'bold' : 'normal'}>
              {monthShort(m)}
            </text>
          ))}

          {/* Zones de toucher : toute la colonne du mois, plus large que les marques */}
          {months.map((m, i) => (
            <rect
              key={m}
              x={pad.left + step * i}
              y={0}
              width={step}
              height={H}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
            />
          ))}
        </svg>

        {active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-sm border px-2 py-1.5 text-[10px] shadow-sm"
            style={{
              backgroundColor: '#fff',
              borderColor: FIN.line,
              color: FIN.navy,
              left: `${(cx(active) / W) * 100}%`,
              transform: `translateX(${active >= months.length / 2 ? '-105%' : '5%'})`
            }}
          >
            <p className="mb-0.5 font-bold first-letter:uppercase">{monthLong(months[active])}</p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.name} : <b>{s.values[active] === null ? '—' : format(s.values[active]!)}</b>
              </p>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setTable(!table)} className="mt-1 text-[10px] underline" style={{ color: FIN.slate }}>
        {table ? 'Masquer les chiffres' : 'Voir les chiffres'}
      </button>
      {table && (
        <table className="mt-1 w-full text-[11px]">
          <thead>
            <tr style={{ color: FIN.slate }}>
              <th className="text-left font-normal">Mois</th>
              {series.map((s) => (
                <th key={s.name} className="text-right font-normal">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m} className="border-t" style={{ borderColor: FIN.line }}>
                <td className="py-0.5 first-letter:uppercase">{monthLong(m)}</td>
                {series.map((s) => (
                  <td key={s.name} className="text-right">
                    {s.values[i] === null ? '—' : format(s.values[i]!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
