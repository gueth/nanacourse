'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  BUDGET_PARTS,
  ceilingFor,
  DEFAULT_PLAN,
  deleteBudget,
  describeBudgetError,
  newBudget,
  partAmount,
  partLabel,
  periodLabel,
  periodsPerMonth,
  restartWindowDays,
  saveBudget,
  saveIncomePlan,
  shortDate,
  type BudgetPart,
  type BudgetSettings as Settings,
  type BudgetState,
  type IncomePlan,
  type PeriodUnit
} from '@/lib/budget';
import { useIncomePlan, useShoppingBudgets } from '@/lib/coursesQueries';
import { useConfirm } from '@/components/ConfirmDialog';

// Partie "Budget" de la page Profil :
//  - la répartition du revenu (méthode 40/40/20, pourcentages modulables) : charges, investissement personnel, épargne ;
//  - plusieurs budgets, chacun rangé dans l'une de ces parties, avec :
//  - un nom, la somme à ne pas dépasser sur une période (en euros, ou en pourcentage de sa partie), et la marge si des prix manquent ;
//  - la durée de la période (en jours, semaines ou mois) au bout de laquelle le budget se réactive ;
//  - le suivi de la période en cours : dépensé, reste, et les courses validées (supprimables en cas d'erreur).
// Chaque liste de courses (Paramètres > Listes) et chaque reçu scanné est rattaché à l'un de ces budgets.

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

// Répartition du revenu : le revenu du mois et le pourcentage de chaque partie (40 / 40 / 20 par défaut, modulables).
// Pour chaque partie : son montant, ce que ses budgets en utilisent par mois, et ce qui reste à répartir.
function IncomePlanCard({ plan, budgets, onSaved }: { plan: IncomePlan; budgets: BudgetState[]; onSaved: () => void }) {
  const [income, setIncome] = useState(plan.income ? String(plan.income) : '');
  const [pcts, setPcts] = useState<Record<BudgetPart, string>>({
    charges: String(plan.charges_pct),
    plaisirs: String(plan.plaisirs_pct),
    epargne: String(plan.epargne_pct)
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const draft: IncomePlan = {
    income: Number(income.replace(',', '.')) || 0,
    charges_pct: Number(pcts.charges.replace(',', '.')) || 0,
    plaisirs_pct: Number(pcts.plaisirs.replace(',', '.')) || 0,
    epargne_pct: Number(pcts.epargne.replace(',', '.')) || 0
  };
  const total = draft.charges_pct + draft.plaisirs_pct + draft.epargne_pct;
  const changed = JSON.stringify(draft) !== JSON.stringify(plan);

  async function save() {
    setSaving(true);
    setMessage('');
    const error = await saveIncomePlan(draft);
    setSaving(false);
    if (error) return setMessage(describeBudgetError(error));
    setMessage('Répartition enregistrée.');
    onSaved();
  }

  return (
    <div className="card card-plain mb-6">
      <span className="tape" />
      <h3 className="title-hand text-2xl">Répartition du revenu</h3>
      <p className="text-xs opacity-70 mb-3">
        Ton revenu du mois est divisé en trois parties. Chaque budget entre dans l&apos;une d&apos;elles, et son plafond peut être un pourcentage de sa partie.
      </p>
      <div className="mb-3">
        <label className="field-label">Revenu du mois (€)</label>
        <input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" placeholder="1 800" className="input-hand w-full" />
      </div>
      <ul className="space-y-3">
        {BUDGET_PARTS.map((part) => {
          const amount = partAmount(draft, part.id);
          // Ce que les budgets de cette partie utilisent par mois (leur plafond ramené au mois)
          const used = budgets
            .filter((b) => (b.settings.part ?? 'charges') === part.id)
            .reduce((sum, b) => sum + Number(b.settings.amount) * periodsPerMonth(b.settings), 0);
          return (
            <li key={part.id}>
              <div className="flex items-end gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{part.label}</span>
                  <span className="block text-xs opacity-60">{part.hint}</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <input
                    value={pcts[part.id]}
                    onChange={(e) => setPcts((p) => ({ ...p, [part.id]: e.target.value }))}
                    inputMode="decimal"
                    aria-label={`Pourcentage ${part.label}`}
                    className="input-hand w-12 text-right"
                  />
                  <span>%</span>
                </span>
                <span className="w-24 shrink-0 text-right font-bold">{euros(amount)}</span>
              </div>
              {used > 0 && (
                <p className={`text-xs text-right ${used > amount ? 'text-brick' : 'opacity-60'}`}>
                  Budgets : {euros(used)} / mois · {used > amount ? `dépasse de ${euros(used - amount)}` : `reste ${euros(amount - used)} à répartir`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {total !== 100 && <p className="mt-2 text-sm text-brick">Les trois parties font {total} % : elles doivent faire 100 %.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving || total !== 100 || !changed} className="btn-hand">
          Enregistrer la répartition
        </button>
        {message && <span className="text-sm opacity-70">{message}</span>}
      </div>
    </div>
  );
}

// Formulaire de création ou de modification d'un budget : sa partie du revenu, et son plafond en euros ou en pourcentage
function BudgetForm({ initial, plan, onSaved, onCancel }: { initial: Settings; plan: IncomePlan; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [part, setPart] = useState<BudgetPart>(initial.part ?? 'charges');
  const [mode, setMode] = useState<'euros' | 'percent'>(initial.amount_mode ?? 'euros');
  const [percent, setPercent] = useState(initial.percent != null ? String(initial.percent) : '');
  const [amount, setAmount] = useState(String(initial.amount));
  const [margin, setMargin] = useState(String(initial.missing_margin));
  const [periodValue, setPeriodValue] = useState(String(initial.period_value));
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>(initial.period_unit);
  const [startDate, setStartDate] = useState(initial.start_date);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // Plafond par période d'un budget en pourcentage : pourcentage de la partie, ramené à la période du budget
  const preview = ceilingFor(
    { ...initial, part, amount_mode: 'percent', percent: Number(percent.replace(',', '.')) || 0, period_value: Number(periodValue) || 1, period_unit: periodUnit },
    plan
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMessage('');
    const error = await saveBudget({
      id: initial.id,
      name,
      part,
      amount_mode: mode,
      percent: mode === 'percent' ? Number(percent.replace(',', '.')) || 0 : null,
      amount: mode === 'percent' ? preview : Number(amount),
      missing_margin: Number(margin),
      period_value: Number(periodValue),
      period_unit: periodUnit,
      start_date: startDate
    });
    setSaving(false);
    if (error) return setErrorMessage(describeBudgetError(error));
    onSaved();
  }

  return (
    <form onSubmit={handleSave} className="form-grid mt-3">
      <div className="w-full">
        <label className="field-label">Nom du budget</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Courses de la semaine" className="input-hand" />
      </div>
      <div className="w-full">
        <label className="field-label">Partie du revenu</label>
        <select value={part} onChange={(e) => setPart(e.target.value as BudgetPart)} className="input-hand w-full">
          {BUDGET_PARTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({euros(partAmount(plan, p.id))} / mois)
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label">Plafond</label>
        <span className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'euros'} onChange={() => setMode('euros')} /> en €
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'percent'} onChange={() => setMode('percent')} /> en % de la partie
          </label>
        </span>
      </div>
      {mode === 'euros' ? (
        <div>
          <label className="field-label">Budget par période (€)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} step="0.01" className="input-hand" />
        </div>
      ) : (
        <div>
          <label className="field-label">Part de « {partLabel(part)} » (%)</label>
          <input value={percent} onChange={(e) => setPercent(e.target.value)} type="number" min={0} max={100} step="0.1" className="input-hand" />
          <p className="mt-1 text-xs opacity-70">
            Soit {euros(preview)} par période ({periodLabel({ ...initial, period_value: Number(periodValue) || 1, period_unit: periodUnit })})
            {plan.income === 0 && ' — renseigne ton revenu dans la répartition'}
          </p>
        </div>
      )}
      <div>
        <label className="field-label">Marge si des prix manquent (€)</label>
        <input value={margin} onChange={(e) => setMargin(e.target.value)} type="number" min={0} step="0.01" className="input-hand" />
      </div>
      <div>
        <label className="field-label">Réactivation tous les</label>
        <span className="flex items-center gap-2">
          <input value={periodValue} onChange={(e) => setPeriodValue(e.target.value)} type="number" min={1} step={1} className="input-hand w-16" />
          <select value={periodUnit} onChange={(e) => setPeriodUnit(e.target.value as PeriodUnit)} className="input-hand">
            <option value="day">jour(s)</option>
            <option value="week">semaine(s)</option>
            <option value="month">mois</option>
          </select>
        </span>
      </div>
      <div>
        <label className="field-label">À partir du</label>
        <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" className="input-hand" />
      </div>
      <div className="flex flex-wrap items-center gap-3 w-full">
        <button type="submit" disabled={saving} className="btn-hand">
          {initial.id ? 'Enregistrer' : 'Créer le budget'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          annuler
        </button>
      </div>
      {errorMessage && <p className="text-sm text-brick w-full">{errorMessage}</p>}
    </form>
  );
}

// Un budget : période en cours, ce qui reste, jauge, et les dépenses de la période
function BudgetCard({
  budget,
  onEdit,
  onDelete,
  onDeleteExpense
}: {
  budget: BudgetState;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteExpense: (id: string, label: string) => void;
}) {
  const lastDay = new Date(budget.period.end.getTime() - 86_400_000); // fin exclue -> dernier jour inclus
  const amount = Number(budget.settings.amount);
  const percent = amount > 0 ? Math.min(100, (budget.spent / amount) * 100) : 0;
  const restartDays = restartWindowDays(budget.settings);

  return (
    <div className="card card-plain">
      <span className="tape" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="title-hand text-2xl">{budget.settings.name}</h3>
          <p className="text-xs opacity-70">
            {partLabel(budget.settings.part)}
            {budget.settings.amount_mode === 'percent' && ` · ${budget.settings.percent} % de la partie`} · {amount.toFixed(2)} € tous les{' '}
            {periodLabel(budget.settings)} · du {shortDate(budget.period.start)} au {shortDate(lastDay)}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <button onClick={onEdit} aria-label={`Modifier le budget ${budget.settings.name}`} title="Modifier" className="p-1.5 opacity-60 hover:opacity-100">
            <Pencil size={16} />
          </button>
          <button onClick={onDelete} aria-label={`Supprimer le budget ${budget.settings.name}`} title="Supprimer" className="p-1.5 opacity-60 hover:opacity-100 hover:text-brick">
            <Trash2 size={16} />
          </button>
        </span>
      </div>

      <p className="mt-2 font-bold">
        Reste <span className={budget.remaining > 0 ? 'text-herb' : 'text-brick'}>{budget.remaining.toFixed(2)} €</span> sur {amount.toFixed(2)} €
      </p>
      {/* Jauge : part du budget déjà dépensée */}
      <div className="h-3 border-2 border-ink rounded-sm overflow-hidden my-2" aria-label={`${percent.toFixed(0)} % dépensé`}>
        <div className={`h-full ${percent >= 100 ? 'bg-brick' : 'bg-mustard'}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs opacity-60 mb-3">
        Une liste plus chère que le reste ne peut être validée que pendant {restartDays === 7 ? 'la dernière semaine' : restartDays === 1 ? 'le dernier jour' : `les ${restartDays} derniers jours`}{' '}
        de la période, en commençant alors le budget suivant.
      </p>

      {budget.expenses.length === 0 ? (
        <p className="text-sm opacity-60">Aucune course validée sur cette période.</p>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-line text-sm">
          {budget.expenses.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-1.5">
              <span className="opacity-60 w-12">{shortDate(new Date(e.spent_at))}</span>
              <span className="flex-1 min-w-0 truncate">{e.label ?? 'Course'}</span>
              <span className="font-bold">{Number(e.amount).toFixed(2)} €</span>
              <button
                onClick={() => onDeleteExpense(e.id, e.label ?? 'Course')}
                aria-label="Supprimer cette dépense"
                title="Supprimer (le montant redevient disponible)"
                className="p-1 opacity-60 hover:opacity-100 hover:text-brick"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BudgetSettings() {
  const { data: budgets, error, reload } = useShoppingBudgets();
  const planQuery = useIncomePlan();
  const plan = planQuery.data ?? DEFAULT_PLAN;
  const [confirm, confirmDialog] = useConfirm();
  const [errorMessage, setErrorMessage] = useState('');
  // Budget en cours de modification (son id), ou « nouveau » pour le formulaire de création
  const [editing, setEditing] = useState<string | null>(null);

  async function removeBudget(b: BudgetState) {
    if (
      !(await confirm(
        'Supprimer le budget',
        `Supprimer le budget « ${b.settings.name} » ? Ses dépenses ne compteront plus, et les listes qui en dépendent passeront sur le premier budget.`
      ))
    )
      return;
    const err = await deleteBudget(b.settings.id!);
    if (err) return setErrorMessage(describeBudgetError(err));
    reload();
  }

  // SUPPRESSION D'UNE DÉPENSE (ex : course validée par erreur) : son montant redevient disponible
  async function deleteExpense(id: string, label: string) {
    if (!(await confirm('Supprimer la dépense', `Supprimer « ${label} » ? Son montant redeviendra disponible dans le budget.`))) return;
    const { error: err } = await supabase.from('expenses').delete().eq('id', id);
    if (err) return setErrorMessage(err.message);
    reload();
  }

  if (!budgets && !error) return <p>Chargement...</p>;
  const list = budgets ?? [];

  return (
    <div>
      {confirmDialog}
      <p className="text-sm opacity-70 mb-4">
        Répartis ton revenu entre charges, investissement personnel et épargne, puis crée tes budgets (ex : les courses de la semaine,
        les sorties du mois) dans l&apos;une de ces parties. Chaque liste de courses et chaque reçu scanné est rattaché à un budget : son prix
        est déduit de ce qui reste, puis le budget se réactive au début de la période suivante.
      </p>
      {(error || errorMessage) && <p className="text-sm text-brick mb-3">{errorMessage || describeBudgetError({ message: error! })}</p>}

      {planQuery.data !== undefined && (
        <IncomePlanCard
          key={JSON.stringify(plan)}
          plan={plan}
          budgets={list}
          onSaved={() => {
            planQuery.reload();
            // Les plafonds en pourcentage changent avec la répartition
            reload();
          }}
        />
      )}
      {planQuery.error && <p className="text-sm text-brick mb-3">{describeBudgetError({ message: planQuery.error })}</p>}

      {list.map((b) =>
        editing === b.settings.id ? (
          <div key={b.settings.id} className="card">
            <span className="tape" />
            <h3 className="title-hand text-2xl">Modifier « {b.settings.name} »</h3>
            <BudgetForm
              initial={b.settings}
              plan={plan}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          </div>
        ) : (
          <BudgetCard
            key={b.settings.id}
            budget={b}
            onEdit={() => setEditing(b.settings.id!)}
            onDelete={() => removeBudget(b)}
            onDeleteExpense={deleteExpense}
          />
        )
      )}

      {list.length === 0 && !error && <p className="text-sm opacity-70 mb-4">Aucun budget pour l&apos;instant : crée le premier.</p>}

      {editing === 'nouveau' ? (
        <div className="card">
          <span className="tape" />
          <h3 className="title-hand text-2xl">Nouveau budget</h3>
          <BudgetForm
            initial={newBudget()}
            plan={plan}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        </div>
      ) : (
        <button onClick={() => setEditing('nouveau')} className="btn-hand inline-flex items-center gap-1.5">
          <Plus size={16} /> Nouveau budget
        </button>
      )}
    </div>
  );
}
