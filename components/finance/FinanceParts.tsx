'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { formatEuros, monthLabel, type FinanceLine, type Section } from '@/lib/finance';
import { useFinanceTone } from '@/lib/health';

// Palette de la page Finances : bleu dominant, rehaussé d'or, de vert sauge (ce qui entre / ce que l'on possède)
// et de vieux rose (ce qui sort / ce que l'on doit)
export const FIN = {
  navy: '#2b3a55',
  slate: '#4a566b',
  // Fond des pages, et couleur forte (en-tête, onglet actif, boutons pleins) : teintées selon l'état de santé
  // (variables posées par FinancePage, voir useFinanceTone dans lib/health) ; bleu par défaut
  mist: 'var(--fin-bg, #e8edf4)',
  accent: 'var(--fin-accent, #4a566b)',
  paper: '#f8f7f4',
  line: '#c9d2df',
  gold: '#b08d57',
  sage: '#5f7d6a',
  rose: '#a2525a'
};

const script = { fontFamily: 'var(--font-script), cursive' };

// "1 234,5" -> 1234.5 (espaces, virgule ou point acceptés) ; null si ce n'est pas un nombre
export function parseAmount(text: string) {
  const n = Number(text.replace(/[\s  €]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Montant affiché dans le champ, sans le symbole € (ajouté à côté)
function amountText(n: number) {
  return n === 0 ? '' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
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
  { href: '/banque/releves', label: 'Relevés' }
];

// Menu des pages Finances, en pastilles
function FinanceNav() {
  const pathname = usePathname();
  return (
    // Centré seulement quand tout tient ("justify-center-safe") : sinon la première pastille serait coupée à gauche
    <nav className="no-scrollbar -mx-4 mt-4 flex justify-center-safe gap-1.5 overflow-x-auto px-4">
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

// En-tête bleu : retour à l'accueil, titre, menu des pages et, si fourni, choix du mois
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
    <header className="relative px-4 pb-10 pt-4 text-center" style={{ backgroundColor: FIN.accent, color: FIN.paper }}>
      {/* z-10 : sinon le sous-titre (rendu au-dessus à cause de son opacité) recouvre le lien et bloque le toucher */}
      <Link href="/accueil" className="absolute left-1 top-2 z-10 flex items-center gap-1 px-2 py-2 text-[11px] uppercase tracking-[0.25em] opacity-80">
        <ChevronLeft size={16} /> Accueil
      </Link>
      <p className="pt-8 text-[10px] uppercase tracking-[0.35em] opacity-70">{subtitle}</p>
      <h1 className="mt-1 text-[56px] leading-none" style={script}>
        Finances
      </h1>
      <div className="mt-2">
        <Ornament color={FIN.gold} />
      </div>
      <FinanceNav />
      {month !== undefined && (
        // Trois colonnes : le mois reste centré, l'action se place à droite
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center">
          <span />
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={onPrev} aria-label="Mois précédent" className="rounded-full p-1.5 opacity-80 hover:opacity-100">
              <ChevronLeft size={20} />
            </button>
            <span className="min-w-[140px] text-[13px] uppercase tracking-[0.25em]">{month}</span>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Mois suivant" className="rounded-full p-1.5 opacity-80 hover:opacity-100 disabled:opacity-20">
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
export function SummaryTile({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <div className="rounded-sm border px-3 py-3 text-center" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <p className="text-[9px] uppercase tracking-[0.25em]" style={{ color: FIN.slate }}>
        {label}
      </p>
      <p className="mt-1 text-[18px] font-bold" style={{ color }}>
        {value}
      </p>
      {note && (
        <p className="mt-0.5 text-[10px]" style={{ color: FIN.slate }}>
          {note}
        </p>
      )}
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

// Tableau d'un côté du document (Actif, Passif, Produits, Charges) : colonnes Poste / Montant,
// une rubrique par groupe de lignes, et le total en pied de tableau
export function Ledger({
  title,
  total,
  color,
  totalLabel,
  children
}: {
  title: string;
  total: number;
  color: string;
  totalLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-7">
      <h2 className="mb-2 text-[38px] leading-none" style={{ ...script, color: FIN.navy }}>
        {title}
      </h2>
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
          <tr style={{ backgroundColor: FIN.navy, color: FIN.paper }}>
            <td className="px-2 py-2 text-[10px] uppercase tracking-[0.2em]">{totalLabel}</td>
            <td className="px-2 py-2 text-right text-[14px] font-bold" style={{ color }}>
              {formatEuros(total)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Ligne de titre d'une rubrique dans le tableau, avec son sous-total
function LedgerGroupRow({ title, subtotal }: { title: string; subtotal: number }) {
  return (
    <tr style={{ backgroundColor: FIN.mist }}>
      <th className="border-b px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-[0.25em]" style={{ borderColor: FIN.line, color: FIN.slate }}>
        {title}
      </th>
      <td className="border-b px-2 py-1.5 text-right text-[11px] font-bold" style={{ borderColor: FIN.line, color: FIN.slate }}>
        {formatEuros(subtotal)}
      </td>
      <td className="border-b" style={{ borderColor: FIN.line }} />
    </tr>
  );
}

// Rubrique calculée (non modifiable) : ex. capitaux propres au passif, dont le résultat du mois
export function LedgerComputed({
  title,
  rows
}: {
  title: string;
  rows: { label: string; value: number; note?: string; color?: string }[];
}) {
  return (
    <tbody>
      <LedgerGroupRow title={title} subtotal={rows.reduce((s, r) => s + r.value, 0)} />
      {rows.map((r) => (
        <tr key={r.label} className="border-b" style={{ borderColor: FIN.line }}>
          <td className="border-r px-2 py-1.5" style={{ borderColor: FIN.line }}>
            {r.label}
            {r.note && (
              <span className="block text-[9px] leading-snug" style={{ color: FIN.slate }}>
                {r.note}
              </span>
            )}
          </td>
          <td className="px-2 py-1.5 text-right font-bold" style={{ color: r.color ?? FIN.navy }}>
            {formatEuros(r.value)}
          </td>
          <td />
        </tr>
      ))}
    </tbody>
  );
}

// Une ligne du tableau : intitulé modifiable, montant modifiable, suppression
function LineRow({
  line,
  warning,
  onRename,
  onAmount,
  onDelete
}: {
  line: FinanceLine;
  warning?: string | null; // alerte sous l'intitulé (ex. relevé du mois pas encore ajouté)
  onRename: (label: string) => void;
  onAmount: (amount: number) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b" style={{ borderColor: FIN.line }}>
      <td className="border-r px-1 py-0.5" style={{ borderColor: FIN.line }}>
        <input
          // Clé liée à l'intitulé : le champ se remet à jour si l'intitulé change ailleurs
          key={line.label}
          defaultValue={line.label}
          aria-label="Intitulé"
          onBlur={(e) => {
            const label = e.target.value.trim();
            if (label && label !== line.label) onRename(label);
            else e.target.value = line.label;
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-full bg-transparent px-1 py-1 text-[12px] outline-none focus:bg-white"
          style={{ color: FIN.navy }}
        />
        {warning && (
          <p className="flex items-start gap-1 px-1 pb-1 text-[9px] leading-tight" style={{ color: FIN.rose }}>
            <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden />
            {warning}
          </p>
        )}
      </td>
      <td className="px-1 py-0.5">
        <div className="flex items-baseline gap-0.5">
          <input
            key={line.amount}
            defaultValue={amountText(line.amount)}
            placeholder="0"
            inputMode="decimal"
            aria-label={`Montant de ${line.label}`}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const amount = parseAmount(e.target.value || '0');
              if (amount !== null && amount !== line.amount) onAmount(amount);
              else e.target.value = amountText(line.amount);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full min-w-0 bg-transparent px-1 py-1 text-right text-[12px] outline-none focus:bg-white"
            style={{ color: FIN.navy }}
          />
          <span className="text-[11px]" style={{ color: FIN.slate }}>
            €
          </span>
        </div>
      </td>
      <td className="text-center">
        <button type="button" onClick={onDelete} aria-label={`Supprimer ${line.label}`} className="p-1 opacity-40 hover:opacity-100" style={{ color: FIN.rose }}>
          <X size={13} />
        </button>
      </td>
    </tr>
  );
}

// Une rubrique (ex : Liquidités) dans le tableau : titre et sous-total, ses lignes, l'ajout d'une ligne
export function SectionBlock({
  section,
  lines,
  onAdd,
  onRename,
  onAmount,
  onDelete,
  warningFor,
  children
}: {
  section: Section;
  lines: FinanceLine[];
  warningFor?: (line: FinanceLine) => string | null;
  onAdd: () => void;
  onRename: (line: FinanceLine, label: string) => void;
  onAmount: (line: FinanceLine, amount: number) => void;
  onDelete: (line: FinanceLine) => void;
  children?: React.ReactNode;
}) {
  return (
    <tbody>
      <LedgerGroupRow title={section.title} subtotal={lines.reduce((s, l) => s + l.amount, 0)} />
      {lines.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          warning={warningFor?.(line)}
          onRename={(label) => onRename(line, label)}
          onAmount={(amount) => onAmount(line, amount)}
          onDelete={() => onDelete(line)}
        />
      ))}
      {children && (
        <tr>
          <td colSpan={3} className="px-2">
            {children}
          </td>
        </tr>
      )}
      <tr className="border-b" style={{ borderColor: FIN.line }}>
        <td colSpan={3} className="px-2">
          <button type="button" onClick={onAdd} className="flex items-center gap-1 py-1.5 text-[10px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
            <Plus size={12} /> Ajouter une ligne
          </button>
        </td>
      </tr>
    </tbody>
  );
}

// Ligne de total mise en valeur (patrimoine net, épargne du mois...)
export function TotalRow({ label, value, color, note }: { label: string; value: number; color: string; note?: string }) {
  return (
    <div className="mt-2 rounded-sm px-4 py-3" style={{ backgroundColor: FIN.navy, color: FIN.paper }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.25em]">{label}</span>
        <span className="text-[17px] font-bold" style={{ color }}>
          {formatEuros(value)}
        </span>
      </div>
      {note && <p className="mt-1 text-[10px] opacity-70">{note}</p>}
    </div>
  );
}

// Encadré de contenu : titre calligraphié, sous-titre facultatif
export function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-sm border px-4 pb-4 pt-3" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <h2 className="text-[32px] leading-tight" style={{ ...script, color: FIN.navy }}>
        {title}
      </h2>
      {subtitle && (
        <p className="-mt-1 mb-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

// Fenêtre au-dessus de la page, aux couleurs des Finances.
// Se ferme avec la croix, la touche Échap ou un clic en dehors du cadre.
export function FinanceModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ backgroundColor: 'rgba(43,58,85,0.55)' }} onClick={onClose}>
      {/* stopPropagation : un clic DANS le cadre ne doit pas le fermer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="mt-12 w-full max-w-md rounded-sm border px-4 pb-4 pt-3"
        style={{ backgroundColor: FIN.paper, borderColor: FIN.line, color: FIN.navy }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[32px] leading-tight" style={script}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="mt-2 p-1" style={{ color: FIN.slate }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
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

// Étiquette "certain" / "estimation", pour distinguer les résultats sûrs des projections
export function Certainty({ estimate }: { estimate?: boolean }) {
  return (
    <span
      className="rounded-full px-1.5 py-px text-[8px] uppercase tracking-[0.15em]"
      style={estimate ? { backgroundColor: '#f1e6d2', color: FIN.gold } : { backgroundColor: '#dfe9e2', color: FIN.sage }}
    >
      {estimate ? 'estimation' : 'certain'}
    </span>
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
export function useFinanceToneVars() {
  const tone = useFinanceTone();
  return { '--fin-accent': tone.dark, '--fin-bg': tone.pale } as React.CSSProperties;
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
