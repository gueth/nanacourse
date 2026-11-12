'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Portal from '@/components/Portal';
import { useModalSfx } from '@/lib/sfx';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatEuros, monthLabel, type FinanceLine, type Section } from '@/lib/finance';
import { useFinanceTone } from '@/lib/health';

// Palette de la page Finances : bleu dominant, rehaussé d'or, de vert sauge (ce qui entre / ce que l'on possède)
// et de vieux rose (ce qui sort / ce que l'on doit)
export const FIN = {
  navy: '#2b3a55',
  slate: '#4a566b',
  // Fond des pages, et couleur forte (en-tête, onglet actif, boutons pleins) : teintées selon l'état de santé
  // (variables posées par FinancePage, voir useFinanceTone dans lib/health) ; gris neutre tant qu'aucune teinte n'est connue
  mist: 'var(--fin-bg, #efede9)',
  accent: 'var(--fin-accent, #5e5b57)',
  paper: '#f8f7f4',
  line: '#c9d2df',
  gold: '#b08d57',
  sage: '#5f7d6a',
  rose: '#a2525a'
};

// Précisions des lignes du bilan, par « rubrique|nom de la ligne en minuscules »
const LINE_NOTES: Record<string, string> = {
  'dettes|dette': 'ce que je dois'
};

const script = { fontFamily: 'var(--font-script), cursive' };

// Hauteur unique de toutes les lignes des tableaux (titres de rubrique, lignes, lignes vides) : deux tableaux côte à côte
// qui ont le même nombre de lignes ont ainsi exactement la même longueur. Elle laisse la place à l'intitulé et, en dessous,
// à une précision sur une ligne.
const ROW = 'h-[40px]';

// Intitulé d'une ligne sur une seule ligne, et sa précision seule en dessous (coupés par « … » s'ils sont trop longs)
function RowLabel({ label, note, italicNote }: { label: React.ReactNode; note?: string; italicNote?: boolean }) {
  return (
    <div className="min-w-0 px-1">
      <p className="truncate text-[12px] leading-4" style={{ color: FIN.navy }}>
        {label}
      </p>
      {note && (
        <p className={`truncate text-[9px] leading-3 ${italicNote ? 'italic' : ''}`} style={{ color: FIN.slate }}>
          {note}
        </p>
      )}
    </div>
  );
}

// "1 234,5" -> 1234.5 (espaces, virgule ou point acceptés) ; null si ce n'est pas un nombre
export function parseAmount(text: string) {
  const n = Number(text.replace(/[\s  €]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Filet ornemental : trait fin, losange au centre
export function Ornament({ color = FIN.gold, width = 120 }: { color?: string; width?: number }) {
  const half = width / 2;
  return (
    <svg width={width} height={10} aria-hidden className="mx-auto block">
      <path d={`M2 5 H${half - 8} M${half + 8} 5 H${width - 2}`} stroke={color} strokeWidth={0.8} />
      <path d={`M${half} 1 L${half + 4} 5 L${half} 9 L${half - 4} 5Z`} fill={color} />
    </svg>
  );
}

// Pages de la partie Finances, dans l'ordre du menu
const FINANCE_PAGES = [
  { href: '/banque/comptes', label: 'Bilan' },
  { href: '/banque/budget', label: 'Budget' },
  { href: '/banque/releves', label: 'Gestion' }
];

// Menu des pages Finances, en pastilles
function FinanceNav() {
  const pathname = usePathname();
  return (
    // Centré seulement quand tout tient ("justify-center-safe") : sinon la première pastille serait coupée à gauche
    <nav className="no-scrollbar -mx-4 mt-2 flex justify-center-safe gap-1.5 overflow-x-auto px-4">
      {FINANCE_PAGES.map((p) => {
        const active = pathname === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            className="shrink-0 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
            style={active ? { backgroundColor: FIN.paper, color: FIN.accent, borderColor: FIN.paper } : { borderColor: 'rgba(248,247,244,0.45)' }}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}

// En-tête bleu : retour à l'écran titre (cartes du jour, d'où s'ouvre le menu), titre, menu des pages et, si fourni, choix du mois
// (avec, à sa droite, un bouton d'action facultatif)
export function FinanceHeader({
  subtitle = 'bilan · compte de résultat',
  month,
  onPrev,
  onNext,
  canNext = true,
  action
}: {
  subtitle?: string;
  month?: string;
  onPrev?: () => void;
  onNext?: () => void;
  // false : le mois affiché est le mois en cours, on ne peut pas aller plus loin (les Finances retranscrivent le passé)
  canNext?: boolean;
  action?: React.ReactNode;
}) {
  return (
    // En-tête compact : titre, sous-titre juste dessous (le retour se fait par le menu du bas)
    <header className="relative px-4 pb-5 pt-2 text-center" style={{ backgroundColor: FIN.accent, color: FIN.paper }}>
      <h1 className="pt-6 text-[32px] leading-none" style={script}>
        Finances
      </h1>
      <p className="text-[9px] uppercase tracking-[0.3em] opacity-70">{subtitle}</p>
      <FinanceNav />
      {month !== undefined && (
        // Trois colonnes : le mois reste centré, l'action se place à droite
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center">
          <span />
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={onPrev} aria-label="Mois précédent" className="rounded-full p-1 opacity-80 hover:opacity-100">
              <ChevronLeft size={20} />
            </button>
            <span className="min-w-[140px] text-[13px] uppercase tracking-[0.25em]">{month}</span>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Mois suivant" className="rounded-full p-1 opacity-80 hover:opacity-100 disabled:opacity-20">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="flex justify-end">{action}</div>
        </div>
      )}
      {/* Bas de l'en-tête : petit dôme central, comme les cartes de l'accueil */}
      <svg className="absolute -bottom-px left-0 w-full" height={18} viewBox="0 0 412 18" preserveAspectRatio="none" aria-hidden>
        <path d="M0 18 H156 A60 60 0 0 1 256 18 H412 V18Z" style={{ fill: FIN.mist }} />
      </svg>
    </header>
  );
}

// Tuile de synthèse : intitulé, montant, et une précision facultative
// "corner" : petit bouton posé sur le coin haut droit de la case (alerte…)
export function SummaryTile({ label, value, color, note, corner }: { label: string; value: string; color: string; note?: string; corner?: React.ReactNode }) {
  return (
    // Hauteur fixe, ligne de précision toujours réservée : deux synthèses (bilan, compte de résultat) ont la même taille,
    // avec ou sans précision, et rien ne bouge en passant de l'une à l'autre
    <div className="relative flex h-[84px] min-w-0 flex-col justify-center rounded-sm border px-2 text-center" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      {corner && <div className="absolute -right-2 -top-2 z-[1]">{corner}</div>}
      <p className="truncate text-[9px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
        {label}
      </p>
      <p className="mt-1 truncate text-[18px] font-bold leading-tight" style={{ color }}>
        {value}
      </p>
      <p className="mt-0.5 h-[15px] truncate text-[10px] leading-[15px]" style={{ color: FIN.slate }}>
        {note ?? ''}
      </p>
    </div>
  );
}

// Choix du document affiché : bilan ou compte de résultat
export function StatementTabs<T extends string>({
  tabs,
  value,
  onChange
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex rounded-full border p-1" style={{ borderColor: FIN.accent, backgroundColor: FIN.paper }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className="flex-1 rounded-full py-2 text-[11px] uppercase tracking-[0.2em] transition-colors"
          style={t.id === value ? { backgroundColor: FIN.accent, color: FIN.paper } : { color: FIN.slate }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Montant d'un tableau, ou une barre quand il n'est pas connu (relevé manquant)
function Amount({ value }: { value: number | null }) {
  return value === null ? (
    <span aria-label="Montant inconnu : relevé manquant" style={{ opacity: 0.6 }}>
      —
    </span>
  ) : (
    <>{formatEuros(value)}</>
  );
}

// Somme de montants, inconnue si l'un d'eux l'est
const sumKnown = (values: (number | null)[]) => (values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0));

// Tableau d'un côté du document (Actif, Passif, Produits, Charges) : colonnes Poste / Montant,
// une rubrique par groupe de lignes, et le total en pied de tableau (null : inconnu, il manque un relevé)
export function Ledger({
  title,
  total,
  color,
  totalLabel,
  open = true,
  onToggle,
  alert = false,
  children
}: {
  // Bilan déséquilibré (connecteurs, lib/balanceLinks checkBalance) : la ligne du total passe en rouge
  alert?: boolean;
  // Repliable ("onToggle") : toucher la ligne du total déplie (ou replie) les lignes du tableau ; c'est la page qui
  // choisit quelles lignes se replient (open : état affiché par la flèche)
  open?: boolean;
  onToggle?: () => void;
  // Sans titre : celui-ci est déjà donné au-dessus (intitulés soulignés des pages du Bilan, « Actif · Passif »)
  title?: string;
  total: number | null;
  color: string;
  totalLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className={title ? 'mt-7' : 'mt-3'}>
      {title && (
        <h2 className="mb-2 text-[38px] leading-none" style={{ ...script, color: FIN.navy }}>
          {title}
        </h2>
      )}
      <table className="w-full table-fixed border-collapse overflow-hidden rounded-sm text-[12px]" style={{ backgroundColor: FIN.paper }}>
        <colgroup>
          <col />
          <col className="w-[118px]" />
          <col className="w-[28px]" />
        </colgroup>
        <thead>
          <tr style={{ backgroundColor: FIN.accent, color: FIN.paper }}>
            <th className="px-2 py-1.5 text-left text-[9px] font-normal uppercase tracking-[0.25em]">Poste</th>
            <th className="px-2 py-1.5 text-right text-[9px] font-normal uppercase tracking-[0.25em]">Montant</th>
            <th />
          </tr>
        </thead>
        {children}
        <tfoot>
          <tr
            style={{ backgroundColor: alert ? FIN.rose : FIN.navy, color: FIN.paper }}
            className={onToggle ? 'cursor-pointer select-none' : undefined}
            onClick={onToggle}
            role={onToggle ? 'button' : undefined}
            tabIndex={onToggle ? 0 : undefined}
            aria-expanded={onToggle ? open : undefined}
            aria-label={onToggle ? `${totalLabel} : ${open ? 'replier' : 'déplier'} le tableau` : undefined}
            onKeyDown={
              onToggle
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggle();
                    }
                  }
                : undefined
            }
          >
            <td className="px-2 py-2 text-[10px] uppercase tracking-[0.2em]">{totalLabel}</td>
            <td className="px-2 py-2 text-right text-[14px] font-bold" style={{ color: alert ? FIN.paper : color }}>
              <Amount value={total} />
            </td>
            <td className="pr-1.5 text-center">
              {onToggle && <ChevronDown size={14} aria-hidden className={`inline transition-transform ${open ? 'rotate-180' : ''}`} />}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Ligne de titre d'une rubrique dans le tableau, avec son sous-total
// "folded" : nombre de lignes repliées dans cette rubrique ; le bouton à côté de l'intitulé les montre ou les replie
function LedgerGroupRow({
  title,
  subtotal,
  folded = 0,
  open = false,
  onToggle
}: {
  title: string;
  subtotal: number | null;
  folded?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <tr className={ROW} style={{ backgroundColor: FIN.mist }}>
      <th className="truncate border-b px-2 py-0 text-left text-[9px] font-bold uppercase tracking-[0.25em]" style={{ borderColor: FIN.line, color: FIN.slate }}>
        {title}
        {folded > 0 && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            title={open ? 'Replier les lignes' : 'Montrer les lignes repliées'}
            className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border px-1.5 align-middle text-[9px] normal-case tracking-normal"
            style={{ borderColor: FIN.line, color: FIN.slate, backgroundColor: FIN.paper }}
          >
            {open ? '−' : '+'}
            {folded}
            <ChevronDown size={10} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </th>
      <td className="border-b px-2 py-0 text-right text-[11px] font-bold" style={{ borderColor: FIN.line, color: FIN.slate }}>
        <Amount value={subtotal} />
      </td>
      <td className="border-b" style={{ borderColor: FIN.line }} />
    </tr>
  );
}

// Rubrique calculée : ex. capitaux propres au passif, dont le résultat du mois
export function LedgerComputed({
  title,
  rows,
  folded = false,
  open = false,
  onToggle
}: {
  title: string;
  rows: { label: string; value: number | null; note?: string; color?: string }[];
  // Repliée comme les autres rubriques : seuls le titre et le sous-total restent, « +N » montre les lignes
  folded?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <tbody>
      <LedgerGroupRow title={title} subtotal={sumKnown(rows.map((r) => r.value))} folded={folded ? rows.length : 0} open={open} onToggle={onToggle} />
      {(!folded || open ? rows : []).map((r) => (
        <tr key={r.label} className={`${ROW} border-b`} style={{ borderColor: FIN.line }}>
          <td className="border-r px-1 py-0" style={{ borderColor: FIN.line }} title={r.note ? `${r.label} : ${r.note}` : r.label}>
            <RowLabel label={r.label} note={r.note} />
          </td>
          <td className="px-2 py-0 text-right font-bold" style={{ color: r.color ?? FIN.navy }}>
            <Amount value={r.value} />
          </td>
          <td />
        </tr>
      ))}
    </tbody>
  );
}

// Montant d'une ligne, sans le symbole € (affiché à côté) ; vide pour zéro
const amountText = (n: number) => (n === 0 ? '' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

// Une rubrique (ex : Liquidités) dans le tableau : titre et sous-total, puis ses lignes.
// Rien n'y est modifiable : les montants viennent des relevés et des budgets. "missing" : ligne dont le relevé manque (barre à la place du montant) ;
// "estimated" : ligne dont le relevé manque mais dont le solde est estimé (précédé de « ≈ »).
export function SectionBlock({
  section,
  lines,
  missing,
  estimated,
  folded,
  open = false,
  onToggle
}: {
  section: Section;
  lines: FinanceLine[];
  missing?: (line: FinanceLine) => boolean;
  estimated?: (line: FinanceLine) => boolean;
  // Lignes repliables (jamais remplies) : cachées tant que la rubrique n'est pas dépliée ("open")
  folded?: Set<string>;
  open?: boolean;
  onToggle?: () => void;
}) {
  const value = (line: FinanceLine) => (missing?.(line) ? null : line.amount);
  const foldedCount = folded ? lines.filter((l) => folded.has(l.id)).length : 0;
  const shown = open || !folded ? lines : lines.filter((l) => !folded.has(l.id));
  return (
    <tbody>
      <LedgerGroupRow title={section.title} subtotal={sumKnown(lines.map(value))} folded={foldedCount} open={open} onToggle={onToggle} />
      {shown.map((line) => {
        const amount = value(line);
        // Précision affichée sous certaines lignes (le nom enregistré ne change pas), ou sous un solde estimé
        const lineNote = LINE_NOTES[`${line.section}|${line.label.trim().toLowerCase()}`];
        const note = estimated?.(line) ? [lineNote, 'relevé manquant · solde estimé'].filter(Boolean).join(' · ') : lineNote;
        return (
          <tr key={line.id} className={`${ROW} border-b`} style={{ borderColor: FIN.line }}>
            <td className="border-r px-1 py-0" style={{ borderColor: FIN.line }} title={note ? `${line.label} : ${note}` : line.label}>
              <RowLabel label={line.label} note={note} italicNote={estimated?.(line)} />
            </td>
            <td className="px-1 py-0">
              <div className="flex items-baseline gap-0.5">
                <span className={`w-full min-w-0 px-1 py-1 text-right text-[12px] ${estimated?.(line) ? 'italic' : ''}`} style={{ color: FIN.navy }}>
                  {amount !== null && estimated?.(line) && '≈ '}
                  {amount === null ? <Amount value={null} /> : amountText(amount) || <span style={{ opacity: 0.4 }}>0</span>}
                </span>
                <span className="text-[11px]" style={{ color: FIN.slate }}>
                  €
                </span>
              </div>
            </td>
            <td />
          </tr>
        );
      })}
    </tbody>
  );
}

// Lignes vides en bas d'un tableau, de la même hauteur qu'une ligne : pour qu'il ait autant de lignes que celui d'à côté
// "group" : habillée comme un titre de rubrique (même fond, sans trait au milieu), sous des rubriques repliées
export function LedgerFiller({ count, variant = 'line' }: { count: number; variant?: 'line' | 'group' }) {
  if (count <= 0) return null;
  const group = variant === 'group';
  return (
    <tbody aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className={ROW} style={{ backgroundColor: group ? FIN.mist : undefined }}>
          <td className={group ? 'border-b' : 'border-b border-r'} style={{ borderColor: FIN.line }} />
          <td className="border-b" style={{ borderColor: FIN.line }} />
          <td className="border-b" style={{ borderColor: FIN.line }} />
        </tr>
      ))}
    </tbody>
  );
}

// Encadré de contenu : titre calligraphié, sous-titre facultatif
export function Panel({
  title,
  subtitle,
  count,
  collapsible = false,
  preview,
  action,
  children
}: {
  title: string;
  subtitle?: string;
  // Nombre facultatif affiché à côté du titre (ex. nombre de transactions)
  count?: number;
  // Bouton facultatif placé à droite du titre
  action?: React.ReactNode;
  // true : le panneau s'ouvre et se referme en touchant son titre, et commence plié
  collapsible?: boolean;
  // Panneau repliable : ce qui reste visible même replié (les chiffres principaux), sous le titre
  preview?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Nombre à côté du titre : dans une pastille, avec la police des libellés (les chiffres calligraphiés se lisent mal)
  const badge = count !== undefined && (
    <span
      className="ml-2 inline-block translate-y-[-6px] rounded-full border px-2 py-0.5 align-middle text-[10px] font-semibold tracking-[0.1em]"
      style={{ fontFamily: 'inherit', borderColor: FIN.gold, color: FIN.gold }}
    >
      {count}
    </span>
  );
  if (collapsible)
    return (
      <details className="group mt-5 rounded-sm border px-4 pb-3 pt-3" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
        <summary className="block cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <h2 className="text-[32px] leading-tight" style={{ color: FIN.navy }}>
                <span style={script}>{title}</span>
                {badge}
              </h2>
              {subtitle && (
                <p className="-mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
                  {subtitle}
                </p>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {action}
              <ChevronDown size={20} aria-hidden className="mt-3 shrink-0 transition-transform group-open:rotate-180" style={{ color: FIN.gold }} />
            </span>
          </span>
          {preview && <span className="mt-2 block">{preview}</span>}
        </summary>
        <div className="mt-2 pb-1">{children}</div>
      </details>
    );
  return (
    <section className="mt-5 rounded-sm border px-4 pb-4 pt-3" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[32px] leading-tight" style={{ color: FIN.navy }}>
          <span style={script}>{title}</span>
          {badge}
        </h2>
        {action && <span className="mt-2 shrink-0">{action}</span>}
      </div>
      {subtitle && (
        <p className="-mt-1 mb-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

// Barre de progression (0 à 1), avec la couleur fournie
export function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: FIN.line }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, backgroundColor: color }} />
    </div>
  );
}

// Champ numérique compact, avec son unité ; renvoie null si vide ou illisible
export function NumberField({
  label,
  value,
  onChange,
  unit = '€',
  placeholder = '0'
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <input
          key={value ?? 'vide'}
          defaultValue={value === null ? '' : String(value).replace('.', ',')}
          placeholder={placeholder}
          inputMode="decimal"
          onFocus={(e) => e.target.select()}
          onBlur={(e) => onChange(e.target.value.trim() ? parseAmount(e.target.value) : null)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-full min-w-0 rounded-sm border bg-white px-2 py-1 text-right text-[13px] outline-none focus:border-current"
          style={{ borderColor: FIN.line, color: FIN.navy }}
        />
        <span className="text-[11px]" style={{ color: FIN.slate }}>
          {unit}
        </span>
      </span>
    </label>
  );
}

// « du mois de mars 2026 », « du mois d'octobre 2026 »
export const ofMonth = (period: string) => {
  const label = monthLabel(period);
  return /^[aeiouyhàâéèê]/i.test(label) ? `du mois d'${label}` : `du mois de ${label}`;
};

// Mois en cours sans relevé importé : seulement le bouton d'import, au-dessus de la page affichée sans données
export function ImportStatementButton({ period }: { period: string }) {
  return (
    <Link
      href="/banque/releves"
      className="mt-5 block rounded-full py-2.5 text-center text-[11px] uppercase tracking-[0.2em]"
      style={{ backgroundColor: FIN.accent, color: FIN.paper }}
    >
      Importer le relevé {ofMonth(period)}
    </Link>
  );
}

// Mois sans relevé importé : les Finances retranscrivent ce qui a été fait, on ne remplit donc pas un mois à la main,
// on importe son relevé de compte
export function NewMonthCard({ period }: { period: string }) {
  return (
    <div className="mt-6 rounded-sm border px-5 py-8 text-center" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <p className="text-[32px] leading-none" style={script}>
        Nouveau mois
      </p>
      <div className="my-3">
        <Ornament />
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: FIN.slate }}>
        Aucun relevé n&apos;est encore importé pour {monthLabel(period)}.
      </p>
      <Link
        href="/banque/releves"
        className="mt-6 block rounded-full py-2.5 text-[11px] uppercase tracking-[0.2em]"
        style={{ backgroundColor: FIN.accent, color: FIN.paper }}
      >
        Importer le relevé {ofMonth(period)}
      </Link>
    </div>
  );
}

// Bouton principal (plein) ou secondaire (contour)
export function FinButton({
  children,
  onClick,
  outline,
  disabled,
  type = 'button'
}: {
  children: React.ReactNode;
  onClick?: () => void;
  outline?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] disabled:opacity-40"
      style={outline ? { borderColor: FIN.accent, color: FIN.accent } : { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper }}
    >
      {children}
    </button>
  );
}

// Popin des Finances : cadre papier au-dessus de la page, titre calligraphié.
// Se ferme avec la croix, la touche Échap ou un toucher en dehors du cadre.
export function FinModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useModalSfx();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ backgroundColor: 'rgba(43,58,85,0.55)' }} onClick={onClose}>
      {/* stopPropagation : un toucher DANS le cadre ne doit pas le fermer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative mt-16 w-full max-w-sm rounded-sm border px-5 pb-5 pt-3"
        style={{ backgroundColor: FIN.paper, borderColor: FIN.line, color: FIN.navy }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[32px] leading-tight" style={{ ...script, color: FIN.navy }}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center" style={{ color: FIN.slate }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
    </Portal>
  );
}

// Message d'erreur en haut de page
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-4 rounded-sm border px-3 py-2 text-[11px]" style={{ borderColor: FIN.rose, color: FIN.rose, backgroundColor: FIN.paper }}>
      {message}
    </p>
  );
}

// Teinte de la partie Finances selon l'état de santé (rouge, orange, jaune, bleu, vert) : variables CSS
// lues par FIN.accent et FIN.mist, à poser sur le conteneur de chaque page Finances
// Tant qu'aucune teinte n'est connue, rien n'est posé ici : la page garde celle mise sur la racine du document (par le
// script de app/layout.tsx au chargement, ou par une page Finances précédente), sinon un fond neutre (jamais de bleu par défaut).
export function useFinanceToneVars() {
  const tone = useFinanceTone();
  // Même teinte sur la racine : fond de la page entière (zones visibles quand on tire la page au-delà de ses bords,
  // voir globals.css), et point de départ de la prochaine page Finances
  useEffect(() => {
    if (!tone.dark || !tone.pale) return;
    const root = document.documentElement;
    root.style.setProperty('--fin-page-bg', tone.pale);
    root.style.setProperty('--fin-bg', tone.pale);
    root.style.setProperty('--fin-accent', tone.dark);
  }, [tone.dark, tone.pale]);
  return (tone.dark && tone.pale ? { '--fin-accent': tone.dark, '--fin-bg': tone.pale } : {}) as React.CSSProperties;
}

// Fond et largeur communs aux pages Finances
export function FinancePage({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const toneVars = useFinanceToneVars();
  return (
    <div className="finance-screen min-h-dvh pb-16 transition-colors duration-700" style={{ ...toneVars, backgroundColor: FIN.mist, color: FIN.navy }}>
      {header}
      <main className="mx-auto max-w-md px-4">{children}</main>
    </div>
  );
}

// Confirmation au style des Finances (même cadre que FinModal), même usage que useConfirm (components/ConfirmDialog) :
//   const [confirm, confirmDialog] = useFinConfirm();
//   if (!(await confirm('Délier', 'Ne plus relier… ?', { confirm: 'Délier', cancel: 'Annuler' }))) return;
// Le bouton prudent (refus) a le focus.
export function useFinConfirm() {
  const [request, setRequest] = useState<{ title: string; message: string; labels?: { confirm?: string; cancel?: string } } | null>(null);
  const resolveRef = useRef<(ok: boolean) => void>(() => {});

  const confirm = useCallback((title: string, message: string, labels?: { confirm?: string; cancel?: string }) => {
    setRequest({ title, message, labels });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const answer = (ok: boolean) => {
    setRequest(null);
    resolveRef.current(ok);
  };

  const dialog = request && (
    <FinModal title={request.title} onClose={() => answer(false)}>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: FIN.navy }}>
        {request.message}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          autoFocus
          onClick={() => answer(false)}
          className="rounded-full border px-4 py-1.5 text-[11px] uppercase tracking-[0.15em]"
          style={{ borderColor: FIN.line, color: FIN.slate, backgroundColor: '#fff' }}
        >
          {request.labels?.cancel ?? 'Annuler'}
        </button>
        <button
          type="button"
          onClick={() => answer(true)}
          className="rounded-full border px-4 py-1.5 text-[11px] uppercase tracking-[0.15em]"
          style={{ backgroundColor: FIN.rose, borderColor: FIN.rose, color: FIN.paper }}
        >
          {request.labels?.confirm ?? 'Supprimer'}
        </button>
      </div>
    </FinModal>
  );

  return [confirm, dialog] as const;
}
