'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { ErrorNote, FIN, FinButton, FinModal, NumberField, Panel } from '@/components/finance/FinanceParts';
import { orThrow, useCached } from '@/lib/cache';
import { formatEuros, monthLabel } from '@/lib/finance';
import { describeDbError } from '@/lib/financePlans';
import {
  deleteBalanceLinks,
  fetchBalanceLinks,
  groupTarget,
  isProches,
  LINKABLE_SECTIONS,
  PROCHES,
  prochesPart,
  refreshBalanceLinks,
  removeBalanceLink,
  saveBalanceLink,
  sideOf,
  type BalanceLink,
  type ProchesPart
} from '@/lib/balanceLinks';
import { byLabel, CATEGORIES, categoryById, categoryGroups, groupKindOf, type GroupKind } from '@/lib/transactions';

// Panneau « Compléter les tableaux » de la page Gestion : on choisit une ligne de l'actif (somme à recevoir) ou du passif
// (emprunt, dette), puis les catégories du Budget qui l'augmentent et celles qui la diminuent (remboursements).
// « Proches » règle d'un coup la créance et la dette envers des proches. Le bilan reste non modifiable : c'est ici qu'on
// décide d'où viennent ces montants (calcul dans lib/balanceLinks).

type Side = 'actif' | 'passif' | 'proches';

const inputClass = 'w-full min-w-0 rounded-sm border bg-white px-3 py-2 text-[14px] outline-none focus:border-current';
const sectionTitle = (id: string) => LINKABLE_SECTIONS.find((s) => s.id === id)?.title ?? id;
const validMonth = (month: string) => !month || /^\d{4}-\d{2}$/.test(month);

function targetLabel(target: string) {
  if (!target.startsWith('groupe:')) return categoryById(target).label;
  return categoryGroups().find((g) => groupTarget(g.id) === target)?.label ?? 'Grande catégorie supprimée';
}

// « + Prêt à un proche · − Remboursement reçu »
function movesLabel(link: Pick<BalanceLink, 'targets' | 'decreases'>) {
  return [...link.targets.map((t) => `+ ${targetLabel(t)}`), ...link.decreases.map((t) => `− ${targetLabel(t)}`)].join(', ');
}

function openingLabel(link: BalanceLink) {
  if (link.opening_month) return ` · départ ${formatEuros(link.opening)} fin ${monthLabel(link.opening_month)}`;
  return link.opening ? ` · départ ${formatEuros(link.opening)}` : '';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label}
      </span>
      {children}
    </div>
  );
}

// Cases à cocher des catégories (et grandes catégories) d'entrée et/ou de sortie
function CategoryPicker({ label, kinds, value, onChange }: { label: string; kinds: GroupKind[]; value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (target: string) => onChange(value.includes(target) ? value.filter((t) => t !== target) : [...value, target]);
  const heading = (text: string) => (
    <p className="pt-2 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
      {text}
    </p>
  );
  const checkbox = (target: string, text: string) => (
    <label key={target} className="flex items-center gap-2 py-1 text-[13px]">
      <input type="checkbox" checked={value.includes(target)} onChange={() => toggle(target)} className="h-4 w-4 shrink-0" />
      {text}
    </label>
  );
  return (
    <Field label={label}>
      <div className="max-h-48 overflow-y-auto rounded-sm border px-3 pb-1" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
        {kinds.map((kind) => {
          const groups = categoryGroups()
            .filter((g) => !g.virtual && g.kind === kind)
            .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
          const categories = CATEGORIES.filter((c) => groupKindOf(c) === kind).sort(byLabel);
          const prefix = kinds.length > 1 ? (kind === 'income' ? 'Entrées · ' : 'Sorties · ') : '';
          return (
            <div key={kind}>
              {groups.length > 0 && heading(`${prefix}Grandes catégories`)}
              {groups.map((g) => checkbox(groupTarget(g.id), g.label))}
              {heading(`${prefix}Catégories`)}
              {categories.map((c) => checkbox(c.id, c.label))}
            </div>
          );
        })}
      </div>
    </Field>
  );
}

function MonthField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        À la fin de (facultatif)
      </span>
      <input
        type="month"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
        style={{ borderColor: FIN.line }}
      />
    </label>
  );
}

// Une ligne de l'actif ou du passif
function LineFields({ link, side, onSaved, actions }: { link?: BalanceLink; side: 'actif' | 'passif'; onSaved: (message: string) => void; actions: (save: SaveButton) => React.ReactNode }) {
  const firstSection = LINKABLE_SECTIONS.find((s) => s.side === side)!;
  const own = link && sideOf(link.section) === side ? link : undefined;
  const [section, setSection] = useState(own?.section ?? firstSection.id);
  const [label, setLabel] = useState(own?.label ?? firstSection.template[0]);
  // Ligne hors de la liste proposée : son nom se saisit à la main
  const [custom, setCustom] = useState(() => !!own && !LINKABLE_SECTIONS.find((s) => s.id === own.section)?.template.includes(own.label));
  const [targets, setTargets] = useState<string[]>(own?.targets ?? []);
  const [decreases, setDecreases] = useState<string[]>(own?.decreases ?? []);
  const [opening, setOpening] = useState<number | null>(own?.opening || null);
  const [openingMonth, setOpeningMonth] = useState(own?.opening_month ?? '');
  const sections = LINKABLE_SECTIONS.filter((s) => s.side === side);
  const template = LINKABLE_SECTIONS.find((s) => s.id === section)?.template ?? [];
  // L'actif monte avec des catégories d'entrée, le passif avec des catégories de sortie ; un remboursement peut être l'un ou l'autre
  const kind: GroupKind = side === 'actif' ? 'income' : 'expense';
  const ready = !!label.trim() && targets.length + decreases.length > 0 && validMonth(openingMonth);

  // Changer de rubrique propose sa première ligne
  function pickSection(next: string) {
    setSection(next);
    setCustom(false);
    setLabel(LINKABLE_SECTIONS.find((s) => s.id === next)?.template[0] ?? '');
  }

  async function save() {
    // Une ligne qui change de côté remplace la liaison d'origine
    const replaced = link && !own ? await removeBalanceLink(link.id) : null;
    const err =
      replaced ??
      (await saveBalanceLink({ id: own?.id, section, label, targets, decreases, opening: opening ?? 0, opening_month: openingMonth || null })) ??
      (await refreshBalanceLinks());
    if (err) return describeDbError(err.message);
    onSaved(`« ${label.trim()} » (${side}) suit désormais ses catégories${openingMonth ? ` depuis ${monthLabel(openingMonth)}` : ''} : le bilan est à jour.`);
    return null;
  }

  return (
    <>
      {sections.length > 1 && (
        <Field label="Rubrique">
          <select value={section} onChange={(e) => pickSection(e.target.value)} className="fin-select w-full py-2 pl-2 text-[13px]">
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Ligne">
        <select
          value={custom ? '' : label}
          onChange={(e) => {
            setCustom(!e.target.value);
            setLabel(e.target.value);
          }}
          className="fin-select w-full py-2 pl-2 text-[13px]"
        >
          {template.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="">Autre ligne…</option>
        </select>
        {custom && (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nom de la ligne"
            className={`${inputClass} mt-2`}
            style={{ borderColor: FIN.line }}
            autoFocus
          />
        )}
      </Field>
      <CategoryPicker label={side === 'actif' ? "L'augmentent (entrées)" : "L'augmentent (sorties)"} kinds={[kind]} value={targets} onChange={setTargets} />
      <CategoryPicker label="La diminuent (remboursements)" kinds={['income', 'expense']} value={decreases} onChange={setDecreases} />
      <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
        Chaque mois, la ligne {side === 'actif' ? "de l'actif" : 'du passif'} augmente du montant des premières catégories et diminue de celui des secondes.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Montant de départ (facultatif)" value={opening} onChange={setOpening} />
        <MonthField value={openingMonth} onChange={setOpeningMonth} />
      </div>
      {actions({ ready, save, editing: !!link })}
    </>
  );
}

// Créance et dette envers des proches, réglées ensemble
function ProchesFields({ links, onSaved, actions }: { links: BalanceLink[]; onSaved: (message: string) => void; actions: (save: SaveButton) => React.ReactNode }) {
  const creance = prochesPart(links, 'creance');
  const dette = prochesPart(links, 'dette');
  const [lent, setLent] = useState<string[]>(creance?.targets ?? []);
  const [repaidToMe, setRepaidToMe] = useState<string[]>(creance?.decreases ?? []);
  const [borrowed, setBorrowed] = useState<string[]>(dette?.targets ?? []);
  const [repaidByMe, setRepaidByMe] = useState<string[]>(dette?.decreases ?? []);
  const [creanceOpening, setCreanceOpening] = useState<number | null>(creance?.opening || null);
  const [detteOpening, setDetteOpening] = useState<number | null>(dette?.opening || null);
  const [openingMonth, setOpeningMonth] = useState(creance?.opening_month ?? dette?.opening_month ?? '');
  const ready = lent.length + repaidToMe.length + borrowed.length + repaidByMe.length > 0 && validMonth(openingMonth);

  async function savePart(part: ProchesPart, existing: BalanceLink | undefined, targets: string[], decreases: string[], opening: number | null) {
    // Rien de choisi pour ce côté : sa liaison est retirée (la ligne revient à zéro)
    if (targets.length + decreases.length === 0 && !opening) return existing ? removeBalanceLink(existing.id) : null;
    return saveBalanceLink({ id: existing?.id, ...PROCHES[part], targets, decreases, opening: opening ?? 0, opening_month: openingMonth || null });
  }

  async function save() {
    const err =
      (await savePart('creance', creance, lent, repaidToMe, creanceOpening)) ??
      (await savePart('dette', dette, borrowed, repaidByMe, detteOpening)) ??
      (await refreshBalanceLinks());
    if (err) return describeDbError(err.message);
    onSaved('La créance et la dette envers tes proches suivent désormais leurs catégories : le bilan est à jour.');
    return null;
  }

  return (
    <>
      <p className="mt-3 text-[11px] font-semibold" style={{ color: FIN.navy }}>
        {PROCHES.creance.label} <span className="font-normal">(actif)</span>
      </p>
      <CategoryPicker label="Monte quand tu prêtes (sorties)" kinds={['expense']} value={lent} onChange={setLent} />
      <CategoryPicker label="Baisse quand on te rembourse (entrées)" kinds={['income']} value={repaidToMe} onChange={setRepaidToMe} />
      <p className="mt-4 text-[11px] font-semibold" style={{ color: FIN.navy }}>
        {PROCHES.dette.label} <span className="font-normal">(passif)</span>
      </p>
      <CategoryPicker label="Monte quand on te prête (entrées)" kinds={['income']} value={borrowed} onChange={setBorrowed} />
      <CategoryPicker label="Baisse quand tu rembourses (sorties)" kinds={['expense']} value={repaidByMe} onChange={setRepaidByMe} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Créance de départ" value={creanceOpening} onChange={setCreanceOpening} />
        <NumberField label="Dette de départ" value={detteOpening} onChange={setDetteOpening} />
      </div>
      <div className="mt-3">
        <MonthField value={openingMonth} onChange={setOpeningMonth} />
      </div>
      {actions({ ready, save, editing: !!(creance || dette) })}
    </>
  );
}

type SaveButton = { ready: boolean; save: () => Promise<string | null>; editing: boolean };

// Création ou modification d'une liaison : ligne de l'actif, du passif, ou créance et dette envers des proches
function LinkForm({ link, links, onSaved, onCancel }: { link?: BalanceLink; links: BalanceLink[]; onSaved: (message: string) => void; onCancel: () => void }) {
  const [side, setSide] = useState<Side>(link ? (isProches(link) ? 'proches' : sideOf(link.section) === 'actif' ? 'actif' : 'passif') : 'actif');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = ({ ready, save, editing }: SaveButton) => (
    <div className="mt-5 flex flex-wrap gap-2">
      <FinButton
        onClick={async () => {
          setBusy(true);
          setError(await save());
          setBusy(false);
        }}
        disabled={busy || !ready}
      >
        {busy ? 'Calcul…' : editing ? 'Enregistrer' : 'Relier'}
      </FinButton>
      <FinButton outline onClick={onCancel}>
        Annuler
      </FinButton>
    </div>
  );

  return (
    <>
      <ErrorNote message={error} />
      <Field label="Côté du bilan">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['actif', 'Actif (entrées)'],
              ['passif', 'Passif (sorties)'],
              ['proches', 'Proches (créance et dette)']
            ] as const
          ).map(([s, text]) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
              style={side === s ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper } : { borderColor: FIN.line, color: FIN.slate }}
            >
              {text}
            </button>
          ))}
        </div>
      </Field>
      {side === 'proches' ? (
        <ProchesFields links={links} onSaved={onSaved} actions={actions} />
      ) : (
        <LineFields key={side} link={link && !isProches(link) ? link : undefined} side={side} onSaved={onSaved} actions={actions} />
      )}
    </>
  );
}

export function BalanceLinksPanel({ ready, onError, onChanged }: { ready: boolean; onError: (message: string) => void; onChanged: (message: string) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState<BalanceLink | 'nouveau' | null>(null);
  const query = useCached('finances:lignes-reliees', async () => {
    const { links, error } = await fetchBalanceLinks();
    return orThrow(links, error);
  });
  const links = query.data ?? [];
  // La créance et la dette envers des proches s'affichent ensemble, en une seule liaison
  const proches = links.filter(isProches);
  const others = links.filter((l) => !isProches(l));

  async function remove(removed: BalanceLink[], name: string) {
    if (!(await confirm('Délier', `Ne plus relier « ${name} » à ses catégories ? Les montants inscrits au bilan sont remis à zéro.`, { confirm: 'Délier', cancel: 'Annuler' })))
      return;
    const err = await deleteBalanceLinks(removed);
    if (err) return onError(describeDbError(err.message));
    query.reload();
    onChanged(`« ${name} » n'est plus reliée à des catégories.`);
  }

  const saved = (message: string) => {
    setEditing(null);
    query.reload();
    onChanged(message);
  };

  const row = (key: string, name: string, details: React.ReactNode, onEdit: () => void, onRemove: () => void) => (
    <li key={key} className="flex items-center justify-between gap-2">
      <span className="min-w-0 break-words">
        <b>{name}</b>
        <span className="block text-[10px]" style={{ color: FIN.slate }}>
          {details}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {[
          { label: `Modifier ${name}`, color: FIN.slate, icon: <Pencil size={14} />, onClick: onEdit },
          { label: `Délier ${name}`, color: FIN.rose, icon: <Trash2 size={14} />, onClick: onRemove }
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.onClick}
            aria-label={b.label}
            title={b.label}
            className="flex h-8 w-8 items-center justify-center rounded-full border bg-white"
            style={{ borderColor: FIN.line, color: b.color }}
          >
            {b.icon}
          </button>
        ))}
      </span>
    </li>
  );

  return (
    <Panel
      collapsible
      title="Compléter les tableaux"
      subtitle="Choisis une ligne de l'actif ou du passif, puis les catégories du Budget qui l'augmentent et celles qui la diminuent (remboursements) : le cumul est inscrit sur cette ligne du bilan."
    >
      {confirmDialog}
      {query.error && <ErrorNote message={describeDbError(query.error)} />}
      {ready && (
        <ul className="space-y-2 text-[12px]">
          {proches.length > 0 &&
            row(
              'proches',
              'Proches',
              proches.map((l) => (
                <span key={l.id} className="block">
                  {sideOf(l.section) === 'actif' ? 'Créance' : 'Dette'} · {movesLabel(l)}
                  {openingLabel(l)}
                </span>
              )),
              () => setEditing(proches[0]),
              () => remove(proches, 'Proches')
            )}
          {others.map((link) =>
            row(
              link.id,
              link.label,
              <>
                {sideOf(link.section) === 'actif' ? 'Actif' : 'Passif'} · {sectionTitle(link.section)} · {movesLabel(link)}
                {openingLabel(link)}
              </>,
              () => setEditing(link),
              () => remove([link], link.label)
            )
          )}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setEditing('nouveau')}
        className="mt-3 flex items-center gap-1 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.15em]"
        style={{ borderColor: FIN.gold, color: FIN.gold }}
      >
        <Plus size={13} /> Relier une ligne du bilan
      </button>
      {editing && (
        <FinModal title={editing === 'nouveau' ? 'Relier une ligne' : 'Modifier la liaison'} onClose={() => setEditing(null)}>
          <LinkForm link={editing === 'nouveau' ? undefined : editing} links={links} onSaved={saved} onCancel={() => setEditing(null)} />
        </FinModal>
      )}
    </Panel>
  );
}
