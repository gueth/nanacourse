'use client';

import { useState } from 'react';
import { ceilingFor, describeBudgetError, partAmount, partLabel, partOf, periodLabel, saveBudget, type BudgetPart, type BudgetSettings as Settings, type IncomePlan, type PeriodUnit } from '@/lib/budget';

// Formulaire d'un budget (Profil > Budgets) : un nom, sa partie de la répartition du revenu, la somme à ne pas
// dépasser sur une période (en euros, ou en pourcentage de sa partie), la marge si des prix manquent, et la durée
// de la période (en jours, semaines ou mois) au bout de laquelle le budget se réactive.
// Chaque liste de courses (Paramètres > Listes) et chaque reçu scanné est rattaché à l'un de ces budgets.

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

// Formulaire de création ou de modification d'un budget : sa partie du revenu, et son plafond en euros ou en pourcentage
export function BudgetForm({ initial, plan, onSaved, onCancel }: { initial: Settings; plan: IncomePlan; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  // Partie du budget (la première si la sienne a été supprimée)
  const [part, setPart] = useState<BudgetPart>(partOf(plan, initial.part)?.id ?? 'charges');
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
          {plan.parts.map((p) => (
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
          <label className="field-label">Part de « {partLabel(plan, part)} » (%)</label>
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
