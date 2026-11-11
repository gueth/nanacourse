'use client';

import { useState } from 'react';
import {
  categoryLimit,
  ceilingFor,
  describeBudgetError,
  maxCeiling,
  periodLabel,
  saveBudget,
  shoppingCategoryOf,
  type BudgetSettings as Settings,
  type PeriodUnit
} from '@/lib/budget';
import { useCategories, useCategoryLimits } from '@/lib/financeQueries';
import { byLabel, CATEGORIES, categoryById, categoryGroups } from '@/lib/transactions';

// Formulaire d'un budget (Profil > Budgets) : un nom, sa catégorie des Finances, la somme à ne pas dépasser sur une
// période (en euros, ou en pourcentage de la limite mensuelle de la catégorie), la marge si des prix manquent, et la durée
// de la période (en jours, semaines ou mois) au bout de laquelle le budget se réactive.
// La catégorie choisie affiche sa limite mensuelle (Finances > Budget, ou à défaut celle de sa grande catégorie) :
// le plafond, ramené au mois, ne peut pas la dépasser.
// Chaque liste de courses (Paramètres > Listes) et chaque reçu scanné est rattaché à l'un de ces budgets ; ses achats sont
// retrouvés dans cette catégorie à l'import des relevés.

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const toNumber = (v: string) => Number(v.replace(',', '.')) || 0;

export function BudgetForm({ initial, onSaved, onCancel }: { initial: Settings; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState<'euros' | 'percent'>(initial.amount_mode ?? 'euros');
  const [percent, setPercent] = useState(initial.percent != null ? String(initial.percent) : '');
  const [amount, setAmount] = useState(String(initial.amount));
  const [margin, setMargin] = useState(String(initial.missing_margin));
  const [periodValue, setPeriodValue] = useState(String(initial.period_value));
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>(initial.period_unit);
  const [startDate, setStartDate] = useState(initial.start_date);
  const [category, setCategory] = useState(shoppingCategoryOf(initial));
  // Catégories des Finances et leurs limites (chargées une fois, partagées avec les pages Finances)
  const categoriesLoaded = useCategories().data !== undefined;
  const limitsQuery = useCategoryLimits();
  const expenseCategories = categoriesLoaded ? CATEGORIES.filter((c) => c.kind === 'variable' || c.kind === 'fixed').sort(byLabel) : [];
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // Limite mensuelle de la catégorie choisie : la sienne, sinon celle de sa grande catégorie
  const limit =
    categoriesLoaded && limitsQuery.data
      ? categoryLimit(category, limitsQuery.data, (id) => categoryGroups().find((g) => g.id === categoryById(id).group) ?? null)
      : null;
  const period = { period_value: Math.max(1, Number(periodValue) || 1), period_unit: periodUnit };
  const max = limit ? maxCeiling(period, limit.limit) : null;
  const percentValue = Math.min(100, toNumber(percent));
  // Plafond par période d'un budget en pourcentage : pourcentage de la limite de la catégorie, ramené à la période
  const preview = ceilingFor({ ...initial, ...period, amount_mode: 'percent', percent: percentValue }, limit?.limit ?? null);
  const ceiling = mode === 'percent' ? preview : toNumber(amount);
  const tooHigh = max !== null && ceiling > max + 0.005;
  const loading = !categoriesLoaded || limitsQuery.data === undefined;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (tooHigh || (mode === 'percent' && !limit)) return;
    setSaving(true);
    setErrorMessage('');
    const error = await saveBudget({
      id: initial.id,
      name,
      part: initial.part,
      amount_mode: mode,
      percent: mode === 'percent' ? percentValue : null,
      amount: ceiling,
      missing_margin: Number(margin),
      period_value: Number(periodValue),
      period_unit: periodUnit,
      start_date: startDate,
      category
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
        <label className="field-label">Catégorie dans les Finances</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-hand w-full">
          {!expenseCategories.some((c) => c.id === category) && <option value={category}>Courses</option>}
          {expenseCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {/* Limite de la catégorie : le plafond du budget ne peut pas la dépasser */}
        <p className="mt-1 text-xs opacity-75">
          {loading
            ? 'Chargement de la limite…'
            : limit
              ? `Limite : ${euros(limit.limit)} par mois${limit.from === 'group' ? ` (celle de « ${limit.label} »)` : ''}, soit au plus ${euros(max!)} par période (${periodLabel({ ...initial, ...period })}).`
              : 'Pas de limite pour cette catégorie : fixe-la dans Finances > Budget pour plafonner ce budget.'}
        </p>
      </div>
      <div>
        <label className="field-label">Plafond</label>
        <span className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'euros'} onChange={() => setMode('euros')} /> en €
          </label>
          <label className={`flex items-center gap-1 ${limit ? '' : 'opacity-50'}`}>
            <input type="radio" checked={mode === 'percent'} disabled={!limit} onChange={() => setMode('percent')} /> en % de la limite
          </label>
        </span>
      </div>
      {mode === 'euros' ? (
        <div>
          <label className="field-label">Budget par période (€)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} max={max ?? undefined} step="0.01" className="input-hand" />
        </div>
      ) : (
        <div>
          <label className="field-label">Part de la limite (%)</label>
          <input value={percent} onChange={(e) => setPercent(e.target.value)} type="number" min={0} max={100} step="0.1" className="input-hand" />
          <p className="mt-1 text-xs opacity-70">
            {limit
              ? `Soit ${euros(preview)} par période (${periodLabel({ ...initial, ...period })})`
              : 'Choisis une catégorie qui a une limite.'}
          </p>
        </div>
      )}
      {tooHigh && <p className="w-full text-xs text-brick">Le plafond dépasse la limite de la catégorie : au plus {euros(max!)} par période.</p>}
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
        <button type="submit" disabled={saving || tooHigh || (mode === 'percent' && !limit)} className="btn-hand">
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
