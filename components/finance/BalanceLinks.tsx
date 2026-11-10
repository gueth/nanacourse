'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { ErrorNote, FIN, FinButton, FinModal, NumberField, Panel } from '@/components/finance/FinanceParts';
import { orThrow, useCached } from '@/lib/cache';
import { formatEuros, monthKey, monthLabel, shiftMonth } from '@/lib/finance';
import { describeDbError } from '@/lib/financePlans';
import {
  deleteBalanceLink,
  fetchBalanceLinks,
  groupTarget,
  LINKABLE_SECTIONS,
  refreshBalanceLinks,
  saveBalanceLink,
  type BalanceLink
} from '@/lib/balanceLinks';
import { byLabel, CATEGORIES, categoryById, categoryGroups, groupKindOf } from '@/lib/transactions';

// Panneau « Dettes et créances » de la page Gestion : une ligne du bilan (emprunt, dette, somme à recevoir) reliée
// à des catégories ou des grandes catégories suit leurs opérations mois après mois, à partir d'un solde de départ.
// Le bilan reste non modifiable : c'est ici qu'on décide d'où viennent ces montants (calcul dans lib/balanceLinks).

const inputClass = 'w-full min-w-0 rounded-sm border bg-white px-3 py-2 text-[14px] outline-none focus:border-current';
const sectionTitle = (id: string) => LINKABLE_SECTIONS.find((s) => s.id === id)?.title ?? id;

function targetLabel(target: string) {
  if (!target.startsWith('groupe:')) return categoryById(target).label;
  return categoryGroups().find((g) => groupTarget(g.id) === target)?.label ?? 'Grande catégorie supprimée';
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

// Création ou modification d'une ligne reliée
function LinkForm({ link, onSaved, onCancel }: { link?: BalanceLink; onSaved: (message: string) => void; onCancel: () => void }) {
  const [section, setSection] = useState(link?.section ?? 'dettes');
  const [label, setLabel] = useState(link?.label ?? '');
  const [targets, setTargets] = useState<string[]>(link?.targets ?? []);
  const [opening, setOpening] = useState<number | null>(link?.opening ?? 0);
  const [openingMonth, setOpeningMonth] = useState(link?.opening_month ?? shiftMonth(monthKey(new Date()), -1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = LINKABLE_SECTIONS.find((s) => s.id === section)?.template ?? [];
  const groups = categoryGroups()
    .filter((g) => !g.virtual)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const categories = CATEGORIES.filter((c) => groupKindOf(c) !== null).sort(byLabel);
  const ready = !!label.trim() && targets.length > 0 && /^\d{4}-\d{2}$/.test(openingMonth);
  const toggle = (target: string) => setTargets((ts) => (ts.includes(target) ? ts.filter((t) => t !== target) : [...ts, target]));

  async function save() {
    if (!ready) return;
    setBusy(true);
    const err = (await saveBalanceLink({ id: link?.id, section, label, targets, opening: opening ?? 0, opening_month: openingMonth })) ?? (await refreshBalanceLinks());
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    onSaved(`Ligne « ${label.trim()} » du bilan reliée : ses montants sont recalculés depuis ${monthLabel(openingMonth)}.`);
  }

  const checkbox = (target: string, text: string) => (
    <label key={target} className="flex items-center gap-2 py-1 text-[13px]">
      <input type="checkbox" checked={targets.includes(target)} onChange={() => toggle(target)} className="h-4 w-4 shrink-0" />
      {text}
    </label>
  );

  return (
    <>
      <ErrorNote message={error} />
      <Field label="Rubrique du bilan">
        <select value={section} onChange={(e) => setSection(e.target.value)} className="fin-select w-full py-2 pl-2 text-[13px]">
          {LINKABLE_SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.side === 'actif' ? 'actif' : 'passif'})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ligne">
        <input value={label} onChange={(e) => setLabel(e.target.value)} list="lignes-bilan" placeholder={template[0]} className={inputClass} style={{ borderColor: FIN.line }} />
        <datalist id="lignes-bilan">
          {template.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <Field label="Catégories suivies">
        <div className="max-h-56 overflow-y-auto rounded-sm border px-3 py-1" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
          {groups.length > 0 && (
            <p className="pt-1 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
              Grandes catégories
            </p>
          )}
          {groups.map((g) => checkbox(groupTarget(g.id), g.label))}
          <p className="pt-2 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
            Catégories
          </p>
          {categories.map((c) => checkbox(c.id, c.label))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          {section === 'creances'
            ? 'Argent prêté : ce qu’on te doit augmente quand tu verses, diminue quand on te rembourse.'
            : 'Argent emprunté : la dette augmente quand tu le reçois, diminue quand tu rembourses.'}{' '}
          Coche aussi bien la catégorie des versements que celle des remboursements.
        </p>
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Solde de départ" value={opening} onChange={setOpening} />
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
            À la fin de
          </span>
          <input
            type="month"
            value={openingMonth}
            onChange={(e) => setOpeningMonth(e.target.value)}
            className="w-full min-w-0 rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
            style={{ borderColor: FIN.line }}
          />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <FinButton onClick={save} disabled={busy || !ready}>
          {busy ? 'Calcul…' : link ? 'Enregistrer' : 'Relier'}
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
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

  async function remove(link: BalanceLink) {
    if (!(await confirm('Délier la ligne', `Ne plus relier « ${link.label} » à ses catégories ? Les montants qu'elle avait au bilan sont remis à zéro.`, { confirm: 'Délier', cancel: 'Annuler' })))
      return;
    const err = await deleteBalanceLink(link);
    if (err) return onError(describeDbError(err.message));
    query.reload();
    onChanged(`« ${link.label} » n'est plus reliée à des catégories.`);
  }

  const saved = (message: string) => {
    setEditing(null);
    query.reload();
    onChanged(message);
  };

  return (
    <Panel
      collapsible
      title="Dettes et créances"
      subtitle="Relie une ligne du bilan (emprunt, dette, argent prêté) à des catégories : son montant suit leurs opérations, mois après mois."
    >
      {confirmDialog}
      {query.error && <ErrorNote message={describeDbError(query.error)} />}
      {ready && (
        <ul className="space-y-2 text-[12px]">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-words">
                <b>{link.label}</b>
                <span className="block text-[10px]" style={{ color: FIN.slate }}>
                  {sectionTitle(link.section)} · {link.targets.map(targetLabel).join(', ')} · départ {formatEuros(link.opening)} fin {monthLabel(link.opening_month)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {[
                  { label: `Modifier ${link.label}`, color: FIN.slate, icon: <Pencil size={14} />, onClick: () => setEditing(link) },
                  { label: `Délier ${link.label}`, color: FIN.rose, icon: <Trash2 size={14} />, onClick: () => remove(link) }
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
          ))}
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
        <FinModal title={editing === 'nouveau' ? 'Relier une ligne' : 'Modifier la ligne reliée'} onClose={() => setEditing(null)}>
          <LinkForm link={editing === 'nouveau' ? undefined : editing} onSaved={saved} onCancel={() => setEditing(null)} />
        </FinModal>
      )}
    </Panel>
  );
}
