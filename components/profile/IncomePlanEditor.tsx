'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { describeBudgetError, newPartId, saveIncomePlan, type BudgetState, type IncomePlan } from '@/lib/budget';
import { PaperModal, PF, script, serif, type ConfirmFn } from '@/components/profile/ProfileParts';

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const toNumber = (v: string) => Number(v.replace(',', '.')) || 0;

type Row = { id: string; label: string; hint?: string; pct: string };

// Fenêtre « Répartition » de la page Profil : le revenu du mois et ses lignes de répartition
// (nom et pourcentage), qu'on peut modifier, supprimer ou compléter. Le total doit faire 100 %.
// Les budgets d'une ligne supprimée passent dans la première ligne à l'enregistrement.
export default function IncomePlanEditor({
  plan,
  budgets,
  confirm,
  onSaved,
  onClose
}: {
  plan: IncomePlan;
  budgets: BudgetState[];
  confirm: ConfirmFn;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [income, setIncome] = useState(plan.income ? String(plan.income) : '');
  const [rows, setRows] = useState<Row[]>(plan.parts.map((p) => ({ ...p, pct: String(p.pct) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = Math.round(rows.reduce((sum, r) => sum + toNumber(r.pct), 0) * 100) / 100;
  const incomeValue = toNumber(income);
  const update = (id: string, change: Partial<Row>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
  // Budgets rangés dans une ligne supprimée : ils iront dans la première ligne restante
  const orphans = budgets.filter((b) => !rows.some((r) => r.id === (b.settings.part ?? 'charges')));
  const invalid = rows.length === 0 || total !== 100 || rows.some((r) => !r.label.trim());

  async function save() {
    setSaving(true);
    setError('');
    const err = await saveIncomePlan({ income: incomeValue, parts: rows.map((r) => ({ id: r.id, label: r.label.trim(), hint: r.hint, pct: toNumber(r.pct) })) });
    setSaving(false);
    if (err) return setError(describeBudgetError(err));
    onSaved();
  }

  const inputClass = 'rounded border bg-white/80 px-2 py-1.5 text-sm';
  return (
    <PaperModal
      title="Répartition"
      onClose={onClose}
      footer={
        <div style={serif}>
          {total !== 100 && rows.length > 0 && <p className="mb-1 text-xs text-brick">Les lignes font {total} % : elles doivent faire 100 %.</p>}
          {orphans.length > 0 && rows.length > 0 && (
            <p className="mb-1 text-xs opacity-75">
              {orphans.map((b) => b.settings.name).join(', ')} {orphans.length > 1 ? 'passeront' : 'passera'} dans « {rows[0].label || 'la première ligne'} ».
            </p>
          )}
          {error && <p className="mb-1 text-xs text-brick">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm">
              Annuler
            </button>
            <button type="button" onClick={save} disabled={saving || invalid} className="rounded px-4 py-2 text-sm text-white disabled:opacity-50" style={{ backgroundColor: PF.blue }}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      }
    >
      <div style={serif}>
        <label className="mt-1 block text-xs">
          <span style={{ color: PF.blue }}>Revenu du mois (€)</span>
          <input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" placeholder="1 800" className={`${inputClass} w-full`} style={{ borderColor: PF.pale }} />
        </label>

        <h3 className="mt-4 text-[24px] leading-none" style={{ ...script, color: PF.blue }}>
          Lignes de répartition
        </h3>
        <ul className="mt-1">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-dotted py-2" style={{ borderColor: PF.pale }}>
              <div className="flex items-center gap-1.5">
                <input
                  value={r.label}
                  onChange={(e) => update(r.id, { label: e.target.value })}
                  placeholder="Nom de la ligne"
                  aria-label="Nom de la ligne"
                  className={`${inputClass} min-w-0 flex-1`}
                  style={{ borderColor: PF.pale }}
                />
                <input
                  value={r.pct}
                  onChange={(e) => update(r.id, { pct: e.target.value })}
                  inputMode="decimal"
                  aria-label={`Pourcentage ${r.label}`}
                  className={`${inputClass} w-14 text-right`}
                  style={{ borderColor: PF.pale }}
                />
                <span className="text-sm">%</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await confirm('Supprimer la ligne', `Supprimer la ligne « ${r.label || 'sans nom'} » de la répartition ?`))) return;
                    setRows((list) => list.filter((x) => x.id !== r.id));
                  }}
                  aria-label={`Supprimer la ligne ${r.label}`}
                  className="p-1.5 opacity-70 hover:opacity-100"
                  style={{ color: PF.blue }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <p className="mt-0.5 flex justify-between text-[11px] opacity-70">
                <span className="truncate">{r.hint}</span>
                {incomeValue > 0 && <span className="shrink-0 pr-9">{euros((incomeValue * toNumber(r.pct)) / 100)}</span>}
              </p>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="mt-2 text-xs text-brick">Ajoute au moins une ligne.</p>}
        <button
          type="button"
          onClick={() => setRows((list) => [...list, { id: newPartId(), label: '', pct: '0' }])}
          className="mt-3 inline-flex items-center gap-1 text-sm"
          style={{ color: PF.blue }}
        >
          <Plus size={14} /> Ajouter une ligne
        </button>
      </div>
    </PaperModal>
  );
}
