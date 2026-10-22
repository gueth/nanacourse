'use client';

import { useState } from 'react';
import { Pencil, Trash2, Ungroup, X } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { ErrorNote, FIN, FinButton, NumberField, Panel } from '@/components/finance/FinanceParts';
import { formatEuros, SECTIONS } from '@/lib/finance';
import { describeDbError } from '@/lib/financePlans';
import {
  addCategoryGroup,
  addCustomCategory,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  DEFAULT_CATEGORY_IDS,
  deleteCategory,
  deleteCategoryGroup,
  dissolveCategoryGroup,
  groupKindOf,
  groupMembers,
  removedBaseCategories,
  renameCategory,
  restoreBaseCategories,
  setCategoryGroup,
  updateCategoryGroup,
  type Category,
  type CategoryGroup,
  type CustomCategory,
  type GroupKind
} from '@/lib/transactions';

// Gestion des catégories de la page Budget : sorties à gauche, entrées à droite.
// Dans chaque colonne, les grandes catégories (avec leurs sous-catégories), puis les catégories sans regroupement.
// Les opérations ne vont que dans les sous-catégories ; une grande catégorie sert à regrouper et peut avoir
// une limite mensuelle. Elle peut être dissoute (ses sous-catégories restent) ou supprimée avec ses sous-catégories
// (leurs opérations vont alors dans « Autres »).

const inputClass = 'w-full min-w-0 rounded-sm border bg-white px-2 py-1 text-[12px] outline-none';
const sameLabel = (a: string, b: string) => a.localeCompare(b.trim(), 'fr', { sensitivity: 'base' }) === 0;

// Liste déroulante des grandes catégories d'un sens (sorties ou entrées), avec « aucune »
function GroupSelect({ kind, value, onChange }: { kind: GroupKind; value: string | null; onChange: (id: string | null) => void }) {
  const list = categoryGroups().filter((g) => g.kind === kind);
  if (list.length === 0) return null;
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded-sm border bg-white px-1 py-1 text-[11px]"
      style={{ borderColor: FIN.line }}
      aria-label="Grande catégorie"
    >
      <option value="">Sans grande catégorie</option>
      {[...list].sort((a, b) => a.label.localeCompare(b.label, 'fr')).map((g) => (
        <option key={g.id} value={g.id}>
          {g.label}
        </option>
      ))}
    </select>
  );
}

// Création d'une catégorie personnelle : nom, sens (dépense ou entrée), rubrique du compte de résultat
// où reporter son total, et grande catégorie éventuelle
export function NewCategoryForm({
  kind: fixedKind,
  group: initialGroup = null,
  onCreated,
  onCancel
}: {
  kind?: CustomCategory['kind'];
  group?: string | null;
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
    <div className="mt-1 w-full rounded-sm border px-2 py-2" style={{ borderColor: FIN.gold, backgroundColor: '#fff' }}>
      <ErrorNote message={error} />
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
        placeholder="Nom de la catégorie (ex. Animaux)"
        className={inputClass}
        style={{ borderColor: FIN.line }}
      />
      {taken && (
        <p className="mt-0.5 text-[10px]" style={{ color: FIN.rose }}>
          Cette catégorie existe déjà.
        </p>
      )}
      <div className="mt-1.5 grid gap-1.5">
        {!fixedKind && (
          <select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as CustomCategory['kind'];
              setKind(k);
              setSection(k === 'income' ? 'autres_revenus' : 'vie_courante');
              setGroup(null);
            }}
            className="rounded-sm border bg-white px-1 py-1 text-[11px]"
            style={{ borderColor: FIN.line }}
          >
            <option value="variable">Dépense</option>
            <option value="income">Entrée d&apos;argent</option>
          </select>
        )}
        <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-sm border bg-white px-1 py-1 text-[11px]" style={{ borderColor: FIN.line }} aria-label="Rubrique du compte de résultat">
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <GroupSelect kind={kind === 'income' ? 'income' : 'expense'} value={group} onChange={setGroup} />
      </div>
      <div className="mt-2 flex gap-2">
        <FinButton onClick={create} disabled={busy || !label.trim() || taken}>
          Créer
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
    </div>
  );
}

// Création ou modification d'une grande catégorie : nom, et limite mensuelle pour les sorties
function GroupForm({ kind, group, onDone, onCancel }: { kind: GroupKind; group?: CategoryGroup; onDone: (message: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(group?.label ?? '');
  const [limit, setLimit] = useState<number | null>(group?.monthly_limit ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taken = categoryGroups().some((g) => g.id !== group?.id && sameLabel(g.label, label));

  async function save() {
    if (!label.trim() || taken) return;
    setBusy(true);
    let err;
    if (group) err = await updateCategoryGroup(group.id, { label: label.trim(), monthly_limit: kind === 'expense' ? limit : null });
    else {
      const created = await addCategoryGroup(label, kind);
      err = created.error ?? (created.group && limit !== null && kind === 'expense' ? await updateCategoryGroup(created.group.id, { monthly_limit: limit }) : null);
    }
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    onDone(group ? `Grande catégorie « ${label.trim()} » modifiée.` : `Grande catégorie « ${label.trim()} » créée : range-y des catégories avec le crayon.`);
  }

  return (
    <div className="mt-1 w-full rounded-sm border px-2 py-2" style={{ borderColor: FIN.gold, backgroundColor: '#fff' }}>
      <ErrorNote message={error} />
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder={kind === 'expense' ? 'Ex. Maison, Plaisirs…' : 'Ex. Revenus du travail…'}
        className={inputClass}
        style={{ borderColor: FIN.line }}
      />
      {taken && (
        <p className="mt-0.5 text-[10px]" style={{ color: FIN.rose }}>
          Cette grande catégorie existe déjà.
        </p>
      )}
      {kind === 'expense' && (
        <div className="mt-1.5">
          <NumberField label="Limite par mois" value={limit} onChange={setLimit} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <FinButton onClick={save} disabled={busy || !label.trim() || taken}>
          {group ? 'Enregistrer' : 'Créer'}
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
    </div>
  );
}

// Modification d'une catégorie : nouveau nom, et grande catégorie où la ranger
function CategoryForm({ category, onDone, onCancel }: { category: Category; onDone: (message: string) => void; onCancel: () => void }) {
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
    <div className="mt-1 w-full rounded-sm border px-2 py-2" style={{ borderColor: FIN.gold, backgroundColor: '#fff' }}>
      <ErrorNote message={error} />
      <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className={inputClass} style={{ borderColor: FIN.line }} />
      {taken && (
        <p className="mt-0.5 text-[10px]" style={{ color: FIN.rose }}>
          Ce nom est déjà pris.
        </p>
      )}
      {kind && (
        <div className="mt-1.5">
          <GroupSelect kind={kind} value={group} onChange={setGroup} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <FinButton onClick={save} disabled={busy || !label.trim() || taken}>
          Enregistrer
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
    </div>
  );
}

const iconButton = 'shrink-0 p-0.5 opacity-50 hover:opacity-100';

// Une colonne : sorties ou entrées
function Column({
  kind,
  editing,
  setEditing,
  onChanged,
  onError
}: {
  kind: GroupKind;
  editing: string | null;
  setEditing: (key: string | null) => void;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [confirm, confirmDialog] = useConfirm();
  const groups = categoryGroups()
    .filter((g) => g.kind === kind)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const loose = CATEGORIES.filter((c) => groupKindOf(c) === kind && !c.group).sort(byLabel);
  const done = (message: string) => {
    setEditing(null);
    onChanged(message);
  };

  async function removeCategory(c: Category) {
    const other = kind === 'income' ? '« Autres entrées »' : '« Autres dépenses »';
    if (!(await confirm('Supprimer la catégorie', `Supprimer la catégorie « ${c.label} » ? Ses opérations iront dans ${other}.`))) return;
    const err = await deleteCategory(c);
    if (err) return onError(describeDbError(err.message));
    onChanged(`Catégorie « ${c.label} » supprimée : ses opérations sont maintenant dans ${other}.`);
  }

  async function dissolve(g: CategoryGroup) {
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
    const members = groupMembers(g.id);
    const deletable = members.filter((c) => !DEFAULT_CATEGORY_IDS.includes(c.id));
    const other = kind === 'income' ? '« Autres entrées »' : '« Autres dépenses »';
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

  // Une catégorie (sous-catégorie ou sans regroupement) : nom, crayon (renommer, changer de grande catégorie), suppression
  function categoryRow(c: Category) {
    const key = `cat:${c.id}`;
    return (
      <li key={c.id} className="py-0.5">
        <div className="flex items-start justify-between gap-1">
          <span className="min-w-0 break-words">
            {c.label}
            {c.custom && (
              <span className="text-[9px]" style={{ color: FIN.slate }}>
                {' '}
                · perso
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center">
            <button type="button" onClick={() => setEditing(editing === key ? null : key)} aria-label={`Modifier ${c.label}`} className={iconButton} style={{ color: FIN.slate }}>
              <Pencil size={12} />
            </button>
            {!DEFAULT_CATEGORY_IDS.includes(c.id) && (
              <button type="button" onClick={() => removeCategory(c)} aria-label={`Supprimer ${c.label}`} className={iconButton} style={{ color: FIN.rose }}>
                <X size={13} />
              </button>
            )}
          </span>
        </div>
        {editing === key && <CategoryForm category={c} onDone={done} onCancel={() => setEditing(null)} />}
      </li>
    );
  }

  return (
    <div className="min-w-0 text-[12px]">
      {confirmDialog}
      <p className="mb-1 border-b pb-0.5 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ borderColor: FIN.line, color: kind === 'income' ? FIN.sage : FIN.rose }}>
        {kind === 'income' ? 'Entrées' : 'Sorties'}
      </p>

      {/* Grandes catégories et leurs sous-catégories */}
      {groups.map((g) => {
        const key = `groupe:${g.id}`;
        const members = groupMembers(g.id);
        return (
          <div key={g.id} className="mb-2">
            <div className="flex items-start justify-between gap-1">
              <span className="min-w-0 break-words font-bold uppercase tracking-[0.05em]" style={{ color: FIN.navy }}>
                {g.label}
                {g.kind === 'expense' && g.monthly_limit !== null && (
                  <span className="block text-[9px] font-normal normal-case tracking-normal" style={{ color: FIN.slate }}>
                    limite {formatEuros(g.monthly_limit)} / mois
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center">
                <button type="button" onClick={() => setEditing(editing === key ? null : key)} aria-label={`Modifier ${g.label}`} className={iconButton} style={{ color: FIN.slate }}>
                  <Pencil size={12} />
                </button>
                <button type="button" onClick={() => dissolve(g)} aria-label={`Dissoudre ${g.label}`} title="Dissoudre (garder les sous-catégories)" className={iconButton} style={{ color: FIN.slate }}>
                  <Ungroup size={13} />
                </button>
                <button type="button" onClick={() => removeGroup(g)} aria-label={`Supprimer ${g.label} et ses sous-catégories`} title="Supprimer avec ses sous-catégories" className={iconButton} style={{ color: FIN.rose }}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            {editing === key && <GroupForm kind={kind} group={g} onDone={done} onCancel={() => setEditing(null)} />}
            <ul className="ml-1 border-l pl-2" style={{ borderColor: FIN.line }}>
              {members.length === 0 && (
                <li className="py-0.5 text-[10px] italic" style={{ color: FIN.slate }}>
                  Vide : range-y une catégorie avec son crayon.
                </li>
              )}
              {members.map(categoryRow)}
            </ul>
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

      {/* Ajouts dans cette colonne */}
      {editing === `nouveau-groupe:${kind}` ? (
        <GroupForm kind={kind} onDone={done} onCancel={() => setEditing(null)} />
      ) : editing === `nouvelle:${kind}` ? (
        <NewCategoryForm
          kind={kind === 'income' ? 'income' : 'variable'}
          onCancel={() => setEditing(null)}
          onCreated={(id) => done(`Catégorie « ${categoryById(id).label} » créée.`)}
        />
      ) : (
        <div className="mt-2 flex flex-col items-start gap-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: FIN.gold }}>
          <button type="button" onClick={() => setEditing(`nouvelle:${kind}`)} className="underline underline-offset-2">
            + Catégorie
          </button>
          <button type="button" onClick={() => setEditing(`nouveau-groupe:${kind}`)} className="underline underline-offset-2">
            + Grande catégorie
          </button>
        </div>
      )}
    </div>
  );
}

// Panneau « Catégories » de la page Budget
export function CategoriesPanel({ onChanged }: { onChanged: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  // Formulaire ouvert (un seul à la fois) : "cat:<id>", "groupe:<id>", "nouvelle:<sens>", "nouveau-groupe:<sens>"
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const removed = removedBaseCategories();
  const transfers = CATEGORIES.filter((c) => groupKindOf(c) === null);

  async function restore() {
    const err = await restoreBaseCategories();
    if (err) return setError(describeDbError(err.message));
    onChanged(`${removed.length} catégorie${removed.length > 1 ? 's' : ''} de base rétablie${removed.length > 1 ? 's' : ''}, et les opérations « Autres » reclassées.`);
  }

  const changed = (message: string) => {
    setError(null);
    onChanged(message);
  };

  return (
    <Panel
      title="Catégories"
      subtitle="Sorties à gauche, entrées à droite. Regroupe tes catégories dans de grandes catégories (avec une limite par mois) : les opérations vont toujours dans les sous-catégories. Les opérations d'une catégorie supprimée vont dans « Autres », qui ne se supprime pas."
    >
      <ErrorNote message={error} />
      {open && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Column kind="expense" editing={editing} setEditing={setEditing} onChanged={changed} onError={setError} />
            <Column kind="income" editing={editing} setEditing={setEditing} onChanged={changed} onError={setError} />
          </div>
          {transfers.length > 0 && (
            <p className="mt-3 text-[10px]" style={{ color: FIN.slate }}>
              Ni sortie ni entrée : {transfers.map((c) => c.label).join(', ')}.
            </p>
          )}
          {removed.length > 0 && (
            <p className="mt-2 text-[11px]" style={{ color: FIN.slate }}>
              Supprimées : {removed.map((c) => c.label).join(', ')}.{' '}
              <button type="button" onClick={restore} className="underline" style={{ color: FIN.gold }}>
                Les rétablir
              </button>
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
