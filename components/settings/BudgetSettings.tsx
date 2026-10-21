'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchBudget, shortDate, type BudgetState } from '@/lib/budget';
import { useConfirm } from '@/components/ConfirmDialog';

// Partie "Budget" de la page Profil :
//  - la somme à ne pas dépasser sur une période, et la marge si des prix manquent ;
//  - la durée de la période (en jours ou en semaines) au bout de laquelle le budget se réactive ;
//  - le suivi de la période en cours : dépensé, reste, et les courses validées (supprimables en cas d'erreur).
export default function BudgetSettings() {
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [errorMessage, setErrorMessage] = useState('');
  const [saved, setSaved] = useState(false);

  // Champs du formulaire (texte, comme dans les <input>)
  const [amount, setAmount] = useState('');
  const [margin, setMargin] = useState('');
  const [periodValue, setPeriodValue] = useState('');
  const [periodUnit, setPeriodUnit] = useState<'day' | 'week'>('week');
  const [startDate, setStartDate] = useState('');

  // Remplit le formulaire avec les réglages chargés
  function fill(b: BudgetState) {
    setBudget(b);
    setAmount(String(b.settings.amount));
    setMargin(String(b.settings.missing_margin));
    setPeriodValue(String(b.settings.period_value));
    setPeriodUnit(b.settings.period_unit);
    setStartDate(b.settings.start_date);
  }

  useEffect(() => {
    fetchBudget().then(fill);
  }, []);

  // ENREGISTREMENT DES RÉGLAGES (mise à jour de la ligne existante, ou création de la première)
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!budget) return;
    setErrorMessage('');
    setSaved(false);
    const values = {
      amount: Number(amount) || 0,
      missing_margin: Number(margin) || 0,
      period_value: Math.max(1, Math.round(Number(periodValue) || 1)),
      period_unit: periodUnit,
      start_date: startDate
    };
    const { error } = budget.settings.id
      ? await supabase.from('budget_settings').update(values).eq('id', budget.settings.id)
      : await supabase.from('budget_settings').insert(values);
    if (error) {
      console.error(error);
      // 42P01 = table inconnue : les tables du budget n'ont pas encore été créées dans Supabase
      return setErrorMessage(
        error.code === '42P01' || error.code === 'PGRST205'
          ? 'Les tables « budget_settings » et « expenses » manquent dans Supabase (voir le SQL à lancer).'
          : error.message
      );
    }
    setSaved(true);
    fill(await fetchBudget());
  }

  // SUPPRESSION D'UNE DÉPENSE (ex : course validée par erreur) : son montant redevient disponible
  async function deleteExpense(id: string) {
    const expense = budget?.expenses.find((e) => e.id === id);
    if (!(await confirm('Supprimer la dépense', `Supprimer « ${expense?.label ?? 'Course'} » ? Son montant redeviendra disponible dans le budget.`))) return;
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) return setErrorMessage(error.message);
    fill(await fetchBudget());
  }

  if (!budget) return <p>Chargement...</p>;

  const lastDay = new Date(budget.period.end.getTime() - 86_400_000); // fin exclue -> dernier jour inclus
  const percent = budget.settings.amount > 0 ? Math.min(100, (budget.spent / Number(budget.settings.amount)) * 100) : 0;

  return (
    <div>
      {confirmDialog}
      <p className="text-sm opacity-70 mb-4">
        Fixe la somme à ne pas dépasser sur une période. Chaque course validée est déduite de ce qui reste, puis le budget se
        réactive au début de la période suivante.
      </p>

      {/* RÉGLAGES */}
      <form onSubmit={handleSave} className="card form-grid">
        <span className="tape" />
        <div>
          <label className="field-label">Budget par période (€)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} step="0.01" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Marge si des prix manquent (€)</label>
          <input value={margin} onChange={(e) => setMargin(e.target.value)} type="number" min={0} step="0.01" className="input-hand" />
        </div>
        <div>
          <label className="field-label">Réactivation tous les</label>
          <span className="flex items-center gap-2">
            <input
              value={periodValue}
              onChange={(e) => setPeriodValue(e.target.value)}
              type="number"
              min={1}
              step={1}
              className="input-hand w-16"
            />
            <select value={periodUnit} onChange={(e) => setPeriodUnit(e.target.value as 'day' | 'week')} className="input-hand">
              <option value="day">jour(s)</option>
              <option value="week">semaine(s)</option>
            </select>
          </span>
        </div>
        <div>
          <label className="field-label">À partir du</label>
          <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" className="input-hand" />
        </div>
        <button type="submit" className="btn-hand">
          Enregistrer
        </button>
        {saved && <p className="text-sm text-herb w-full">Réglages enregistrés.</p>}
        {errorMessage && <p className="text-sm text-brick w-full">{errorMessage}</p>}
      </form>

      {/* PÉRIODE EN COURS */}
      <div className="card card-plain">
        <span className="tape" />
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="title-hand text-2xl">
            Du {shortDate(budget.period.start)} au {shortDate(lastDay)}
          </h3>
          <p className="font-bold">
            Reste <span className={budget.remaining > 0 ? 'text-herb' : 'text-brick'}>{budget.remaining.toFixed(2)} €</span> sur{' '}
            {Number(budget.settings.amount).toFixed(2)} €
          </p>
        </div>

        {/* Jauge : part du budget déjà dépensée */}
        <div className="h-3 border-2 border-ink rounded-sm overflow-hidden mb-4" aria-label={`${percent.toFixed(0)} % dépensé`}>
          <div className={`h-full ${percent >= 100 ? 'bg-brick' : 'bg-mustard'}`} style={{ width: `${percent}%` }} />
        </div>

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
                  onClick={() => deleteExpense(e.id)}
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
    </div>
  );
}
