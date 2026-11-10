'use client';

import { useState } from 'react';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { ErrorNote, FIN, FinButton, FinModal, NumberField, Panel } from '@/components/finance/FinanceParts';
import { formatEuros, SECTIONS } from '@/lib/finance';
import { describeDbError } from '@/lib/financePlans';
import { useCategoryLimits } from '@/lib/financeQueries';
import {
  addCategoryGroup,
  addCustomCategory,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  deleteCategory,
  deleteCategoryGroup,
  dissolveCategoryGroup,
  groupKindOf,
  groupMembers,
  isLockedCategory,
  renameCategory,
  setCategoryGroup,
  updateCategoryGroup,
  type Budget,
  type Category,
  type CategoryGroup,
  type CustomCategory,
  type GroupKind
} from '@/lib/transactions';

// Gestion des catégories de la page Gestion : sorties à gauche, entrées à droite.
// Dans chaque colonne, les grandes catégories (avec leurs sous-catégories), puis les catégories sans regroupement.
// Les opérations ne vont que dans les sous-catégories ; une grande catégorie sert à regrouper et peut avoir
// une limite mensuelle. Elle peut être dissoute (ses sous-catégories restent) ou supprimée avec ses sous-catégories
// (leurs opérations vont alors dans « Autres »). Création et modification se font dans une popin.

const inputClass = 'w-full min-w-0 rounded-sm border bg-white px-3 py-2 text-[14px] outline-none focus:border-current';
const selectClass = 'fin-select w-full py-2 pl-2 text-[13px]';
const sameLabel = (a: string, b: string) => a.localeCompare(b.trim(), 'fr', { sensitivity: 'base' }) === 0;

// Champ d'un formulaire, avec son intitulé
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label}
      </span>
      {children}
    </label>
  );
}

// Liste déroulante des grandes catégories d'un sens (sorties ou entrées), avec « aucune »
function GroupSelect({ kind, value, onChange }: { kind: GroupKind; value: string | null; onChange: (id: string | null) => void }) {
  // « Dépenses annuelles » se remplit seulement depuis la liste des dépenses annuelles
  const list = categoryGroups().filter((g) => g.kind === kind && !g.virtual);
  if (list.length === 0) return null;
  return (
    <Field label="Grande catégorie">
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={selectClass}>
        <option value="">Sans grande catégorie</option>
        {[...list].sort((a, b) => a.label.localeCompare(b.label, 'fr')).map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// Bouton d'une action destructive (suppression, dissolution), sous les boutons principaux d'une popin
function DangerButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em]"
      style={{ borderColor: FIN.rose, color: FIN.rose }}
    >
      {children}
    </button>
  );
}

// Boutons d'une popin : enregistrer / annuler, puis les actions destructives séparées par un filet
function FormActions({ saveLabel, disabled, onSave, onCancel, danger }: { saveLabel: string; disabled: boolean; onSave: () => void; onCancel: () => void; danger?: React.ReactNode }) {
  return (
    <>
      <div className="mt-5 flex flex-wrap gap-2">
        <FinButton onClick={onSave} disabled={disabled}>
          {saveLabel}
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
      {danger && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: FIN.line }}>
          {danger}
        </div>
      )}
    </>
  );
}

// Création d'une catégorie personnelle : nom, sens (dépense ou entrée), rubrique du compte de résultat
// où reporter son total, et grande catégorie éventuelle. "framed" : dans un encadré (formulaire posé dans la page)
export function NewCategoryForm({
  kind: fixedKind,
  group: initialGroup = null,
  framed = true,
  onCreated,
  onCancel
}: {
  kind?: CustomCategory['kind'];
  group?: string | null;
  framed?: boolean;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CustomCategory['kind']>(fixedKind ?? 'variable');
  const [section, setSection] = useState(fixedKind === 'income' ? 'autres_revenus' : 'vie_courante');
  const [group, setGroup] = useState<string | null>(initialGroup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sections = SECTIONS.filter((s) => s.side === (kind === 'income' ? 'produits' : 'charges'));
  const taken = CATEGORIES.some((c) => sameLabel(c.label, label));

  async function create() {
    if (!label.trim() || taken) return;
    setBusy(true);
    const { category, error: err } = await addCustomCategory(label, kind, section);
    const groupErr = category && group ? await setCategoryGroup(category.id, group) : null;
    setBusy(false);
    if (err || groupErr) return setError(describeDbError((err ?? groupErr)!.message));
    if (category) onCreated(category.id);
  }

  return (
    <div className={framed ? 'mt-1 w-full rounded-sm border px-3 py-2' : ''} style={framed ? { borderColor: FIN.gold, backgroundColor: '#fff' } : undefined}>
      <ErrorNote message={error} />
      <Field label="Nom">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="Ex. Animaux"
          className={inputClass}
          style={{ borderColor: FIN.line }}
        />
      </Field>
      {taken && (
        <p className="mt-1 text-[11px]" style={{ color: FIN.rose }}>
          Cette catégorie existe déjà.
        </p>
      )}
      {!fixedKind && (
        <Field label="Sens">
          <select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as CustomCategory['kind'];
              setKind(k);
              setSection(k === 'income' ? 'autres_revenus' : 'vie_courante');
              setGroup(null);
            }}
            className={selectClass}
          >
            <option value="variable">Dépense</option>
            <option value="income">Entrée d&apos;argent</option>
          </select>
        </Field>
      )}
      <Field label="Rubrique du compte de résultat">
        <select value={section} onChange={(e) => setSection(e.target.value)} className={selectClass}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </Field>
      <GroupSelect kind={kind === 'income' ? 'income' : 'expense'} value={group} onChange={setGroup} />
      <FormActions saveLabel="Créer" disabled={busy || !label.trim() || taken} onSave={create} onCancel={onCancel} />
    </div>
  );
}

// Création ou modification d'une grande catégorie : nom, et montant par mois (limite des sorties, entrées prévues)
function GroupForm({
  kind,
  group,
  onDone,
  onCancel,
  danger
}: {
  kind: GroupKind;
  group?: CategoryGroup;
  onDone: (message: string) => void;
  onCancel: () => void;
  danger?: React.ReactNode;
}) {
  const [label, setLabel] = useState(group?.label ?? '');
  const [limit, setLimit] = useState<number | null>(group?.monthly_limit ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taken = categoryGroups().some((g) => g.id !== group?.id && sameLabel(g.label, label));

  async function save() {
    if (!label.trim() || taken) return;
    setBusy(true);
    let err;
    if (group) err = await updateCategoryGroup(group.id, { label: label.trim(), monthly_limit: limit });
    else {
      const created = await addCategoryGroup(label, kind);
      err = created.error ?? (created.group && limit !== null ? await updateCategoryGroup(created.group.id, { monthly_limit: limit }) : null);
    }
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    onDone(group ? `Grande catégorie « ${label.trim()} » modifiée.` : `Grande catégorie « ${label.trim()} » créée : range-y des catégories avec le crayon.`);
  }

  return (
    <>
      <ErrorNote message={error} />
      <Field label="Nom">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={kind === 'expense' ? 'Ex. Maison, Plaisirs…' : 'Ex. Revenus du travail…'}
          className={inputClass}
          style={{ borderColor: FIN.line }}
        />
      </Field>
      {taken && (
        <p className="mt-1 text-[11px]" style={{ color: FIN.rose }}>
          Cette grande catégorie existe déjà.
        </p>
      )}
      <div className="mt-3">
        <NumberField label="Limite par mois" value={limit} onChange={setLimit} />
      </div>
      <FormActions saveLabel={group ? 'Enregistrer' : 'Créer'} disabled={busy || !label.trim() || taken} onSave={save} onCancel={onCancel} danger={danger} />
    </>
  );
}

// Modification d'une catégorie : nouveau nom, et grande catégorie où la ranger
function CategoryForm({ category, onDone, onCancel, danger }: { category: Category; onDone: (message: string) => void; onCancel: () => void; danger?: React.ReactNode }) {
  const [label, setLabel] = useState(category.label);
  const [group, setGroup] = useState<string | null>(category.group ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = groupKindOf(category);
  const taken = CATEGORIES.some((c) => c.id !== category.id && sameLabel(c.label, label));

  async function save() {
    if (!label.trim() || taken) return;
    setBusy(true);
    const err =
      (label.trim() !== category.label ? await renameCategory(category.id, label) : null) ??
      (group !== (category.group ?? null) ? await setCategoryGroup(category.id, group) : null);
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    onDone(`Catégorie « ${label.trim()} » modifiée.`);
  }

  return (
    <>
      <ErrorNote message={error} />
      <Field label="Nom">
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className={inputClass} style={{ borderColor: FIN.line }} />
      </Field>
      {taken && (
        <p className="mt-1 text-[11px]" style={{ color: FIN.rose }}>
          Ce nom est déjà pris.
        </p>
      )}
      {kind && <GroupSelect kind={kind} value={group} onChange={setGroup} />}
      <FormActions saveLabel="Enregistrer" disabled={busy || !label.trim() || taken} onSave={save} onCancel={onCancel} danger={danger} />
    </>
  );
}

// Bouton rond d'une ligne (modifier, supprimer) : assez grand pour le doigt, toujours visible
function RowButton({ label, color, onClick, children }: { label: string; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white"
      style={{ borderColor: FIN.line, color }}
    >
      {children}
    </button>
  );
}

// Popin ouverte : modification d'une catégorie ou d'une grande catégorie, ou création dans la colonne
type Editing =
  | { type: 'categorie'; category: Category }
  | { type: 'groupe'; group: CategoryGroup }
  | { type: 'nouvelle' }
  | { type: 'nouveau-groupe' };

// Total des limites d'un sens : la limite de chaque grande catégorie (à défaut, celles de ses catégories),
// plus celles des catégories sans regroupement
function limitsTotal(kind: GroupKind, budgets: Budget[]) {
  const limitOf = (c: Category) => budgets.find((b) => b.category === c.id)?.monthly_limit ?? 0;
  const groups = categoryGroups().filter((g) => g.kind === kind);
  const fromGroups = groups.reduce((sum, g) => sum + (g.monthly_limit ?? groupMembers(g.id).reduce((s, c) => s + limitOf(c), 0)), 0);
  const loose = CATEGORIES.filter((c) => groupKindOf(c) === kind && !groups.some((g) => g.id === c.group));
  return fromGroups + loose.reduce((s, c) => s + limitOf(c), 0);
}

// Une colonne : sorties ou entrées
function Column({ kind, budgets, onChanged, onError }: { kind: GroupKind; budgets: Budget[]; onChanged: (message: string) => void; onError: (message: string) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);
  // Grandes catégories dépliées (toutes pliées au départ)
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const toggle = (id: string) => setUnfolded((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const close = () => setEditing(null);
  const limitOf = (c: Category) => budgets.find((b) => b.category === c.id)?.monthly_limit ?? null;
  const groups = categoryGroups()
    .filter((g) => g.kind === kind)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const loose = CATEGORIES.filter((c) => groupKindOf(c) === kind && !c.group).sort(byLabel);
  const other = kind === 'income' ? '« Autres entrées »' : '« Autres dépenses »';
  const done = (message: string) => {
    close();
    onChanged(message);
  };

  async function removeCategory(c: Category) {
    close();
    if (!(await confirm('Supprimer la catégorie', `Supprimer la catégorie « ${c.label} » ? Ses opérations iront dans ${other}.`))) return;
    const err = await deleteCategory(c);
    if (err) return onError(describeDbError(err.message));
    onChanged(`Catégorie « ${c.label} » supprimée : ses opérations sont maintenant dans ${other}.`);
  }

  async function dissolve(g: CategoryGroup) {
    close();
    const n = groupMembers(g.id).length;
    if (
      !(await confirm(
        'Dissoudre la grande catégorie',
        `Dissoudre « ${g.label} » ? ${n ? `Ses ${n} sous-catégorie${n > 1 ? 's' : ''} restent, sans regroupement.` : 'Elle est vide.'}`,
        { confirm: 'Dissoudre', cancel: 'Annuler' }
      ))
    )
      return;
    const err = await dissolveCategoryGroup(g.id);
    if (err) return onError(describeDbError(err.message));
    onChanged(`Grande catégorie « ${g.label} » dissoute.`);
  }

  async function removeGroup(g: CategoryGroup) {
    close();
    const deletable = groupMembers(g.id).filter((c) => !isLockedCategory(c));
    if (
      !(await confirm(
        'Supprimer la grande catégorie',
        deletable.length
          ? `Supprimer « ${g.label} » et ses ${deletable.length} sous-catégorie${deletable.length > 1 ? 's' : ''} (${deletable.map((c) => c.label).join(', ')}) ? Leurs opérations iront dans ${other}.`
          : `Supprimer « ${g.label} » ?`
      ))
    )
      return;
    const err = await deleteCategoryGroup(g.id);
    if (err) return onError(describeDbError(err.message));
    onChanged(`Grande catégorie « ${g.label} » supprimée${deletable.length ? ` avec ses sous-catégories : leurs opérations sont dans ${other}` : ''}.`);
  }

  // Une catégorie (sous-catégorie ou sans regroupement) : nom (qui ouvre la popin), crayon, suppression
  function categoryRow(c: Category) {
    const deletable = !isLockedCategory(c);
    // Sous-catégorie d'une dépense annuelle : elle se renomme ou se supprime avec la dépense, plus haut sur la page
    if (c.annual)
      return (
        <li key={c.id} className="py-1">
          {c.label}
          <span className="text-[9px]" style={{ color: FIN.slate }}>
            {' '}
            · dépense annuelle
          </span>
        </li>
      );
    return (
      <li key={c.id} className="flex items-center justify-between gap-1 py-1">
        <button type="button" onClick={() => setEditing({ type: 'categorie', category: c })} className="min-w-0 break-words text-left">
          {c.label}
          {c.custom && (
            <span className="text-[9px]" style={{ color: FIN.slate }}>
              {' '}
              · perso
            </span>
          )}
          {limitOf(c) !== null && (
            <span className="block text-[9px]" style={{ color: FIN.slate }}>
              limite {formatEuros(limitOf(c)!)} / mois
            </span>
          )}
        </button>
        <span className="flex shrink-0 items-center gap-1">
          <RowButton label={`Modifier ${c.label}`} color={FIN.slate} onClick={() => setEditing({ type: 'categorie', category: c })}>
            <Pencil size={14} />
          </RowButton>
          {deletable && (
            <RowButton label={`Supprimer ${c.label}`} color={FIN.rose} onClick={() => removeCategory(c)}>
              <Trash2 size={14} />
            </RowButton>
          )}
        </span>
      </li>
    );
  }

  return (
    <div className="min-w-0 text-[12px]">
      {confirmDialog}
      <div className="mb-1 border-b pb-0.5" style={{ borderColor: FIN.line }}>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: kind === 'income' ? FIN.sage : FIN.rose }}>
          {kind === 'income' ? 'Entrées' : 'Sorties'}
        </p>
        <p className="text-[10px]" style={{ color: FIN.slate }}>
          Limites : <b style={{ color: FIN.navy }}>{formatEuros(limitsTotal(kind, budgets))}</b> / mois
        </p>
      </div>

      {/* Ajouts dans cette colonne */}
      <div className="mb-3 mt-2 flex flex-col items-stretch gap-1.5">
        {[
          { label: 'Catégorie', open: { type: 'nouvelle' } as const },
          { label: 'Grande catégorie', open: { type: 'nouveau-groupe' } as const }
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={() => setEditing(b.open)}
            className="flex items-center justify-center gap-1 rounded-full border px-2 py-2 text-[10px] uppercase tracking-[0.12em]"
            style={{ borderColor: FIN.gold, color: FIN.gold }}
          >
            <Plus size={13} /> {b.label}
          </button>
        ))}
      </div>

      {/* Grandes catégories et leurs sous-catégories */}
      {groups.map((g) => {
        const members = groupMembers(g.id);
        const open = unfolded.includes(g.id);
        return (
          <div key={g.id} className="mb-2">
            <div className="flex items-center justify-between gap-1 py-1">
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={open}
                className="flex min-w-0 items-start gap-1 break-words text-left font-bold uppercase tracking-[0.05em]"
                style={{ color: FIN.navy }}
              >
                <ChevronRight size={14} className={`mt-px shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="min-w-0">
                  {g.label}
                  <span className="block text-[9px] font-normal normal-case tracking-normal" style={{ color: FIN.slate }}>
                    {members.length} catégorie{members.length > 1 ? 's' : ''}
                    {g.monthly_limit !== null && ` · limite ${formatEuros(g.monthly_limit)} / mois`}
                  </span>
                </span>
              </button>
              {!g.virtual && (
                <span className="flex shrink-0 items-center gap-1">
                  <RowButton label={`Modifier ${g.label}`} color={FIN.slate} onClick={() => setEditing({ type: 'groupe', group: g })}>
                    <Pencil size={14} />
                  </RowButton>
                  <RowButton label={`Supprimer ${g.label} et ses sous-catégories`} color={FIN.rose} onClick={() => removeGroup(g)}>
                    <Trash2 size={14} />
                  </RowButton>
                </span>
              )}
            </div>
            {open && (
              <ul className="ml-1 border-l pl-2" style={{ borderColor: FIN.line }}>
                {members.length === 0 && (
                  <li className="py-0.5 text-[10px] italic" style={{ color: FIN.slate }}>
                    Vide : range-y une catégorie avec son crayon.
                  </li>
                )}
                {members.map(categoryRow)}
              </ul>
            )}
          </div>
        );
      })}

      {/* Catégories sans regroupement */}
      {groups.length > 0 && loose.length > 0 && (
        <p className="mt-1 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
          Sans grande catégorie
        </p>
      )}
      <ul>{loose.map(categoryRow)}</ul>

      {/* Popins de création et de modification */}
      {editing?.type === 'categorie' && (
        <FinModal title="Modifier la catégorie" onClose={close}>
          <CategoryForm
            category={editing.category}
            onDone={done}
            onCancel={close}
            danger={
              !isLockedCategory(editing.category) && (
                <DangerButton onClick={() => removeCategory(editing.category)}>
                  <Trash2 size={13} /> Supprimer la catégorie
                </DangerButton>
              )
            }
          />
        </FinModal>
      )}
      {editing?.type === 'groupe' && (
        <FinModal title="Modifier la grande catégorie" onClose={close}>
          <GroupForm
            kind={kind}
            group={editing.group}
            onDone={done}
            onCancel={close}
            danger={
              <>
                <DangerButton onClick={() => dissolve(editing.group)}>Dissoudre (garder les sous-catégories)</DangerButton>
                <DangerButton onClick={() => removeGroup(editing.group)}>
                  <Trash2 size={13} /> Supprimer avec ses sous-catégories
                </DangerButton>
              </>
            }
          />
        </FinModal>
      )}
      {editing?.type === 'nouvelle' && (
        <FinModal title={kind === 'income' ? 'Nouvelle entrée' : 'Nouvelle dépense'} onClose={close}>
          <NewCategoryForm
            kind={kind === 'income' ? 'income' : 'variable'}
            framed={false}
            onCancel={close}
            onCreated={(id) => done(`Catégorie « ${categoryById(id).label} » créée.`)}
          />
        </FinModal>
      )}
      {editing?.type === 'nouveau-groupe' && (
        <FinModal title="Nouvelle grande catégorie" onClose={close}>
          <GroupForm kind={kind} onDone={done} onCancel={close} />
        </FinModal>
      )}
    </div>
  );
}

// Panneau « Catégories » de la page Gestion
// Une catégorie supprimée l'est pour de bon (après confirmation) : on ne la rétablit pas
export function CategoriesPanel({ onChanged }: { onChanged: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budgets = useCategoryLimits().data ?? [];
  const transfers = CATEGORIES.filter((c) => groupKindOf(c) === null);

  const changed = (message: string) => {
    setError(null);
    onChanged(message);
  };

  return (
    <Panel title="Catégories">
      <ErrorNote message={error} />
      {open && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Column kind="expense" budgets={budgets} onChanged={changed} onError={setError} />
            <Column kind="income" budgets={budgets} onChanged={changed} onError={setError} />
          </div>
          {transfers.length > 0 && (
            <p className="mt-3 text-[10px]" style={{ color: FIN.slate }}>
              Ni sortie ni entrée : {transfers.map((c) => c.label).join(', ')}.
            </p>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <FinButton outline onClick={() => setOpen(!open)}>
          {open ? 'Masquer les catégories' : `Voir les ${CATEGORIES.length} catégories`}
        </FinButton>
      </div>
    </Panel>
  );
}
