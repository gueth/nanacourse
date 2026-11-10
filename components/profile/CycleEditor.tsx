'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { PaperModal, PF, serif } from '@/components/profile/ProfileParts';
import { addPeriod, buildCycle, CYCLE_LIMITS, cyclePhase, daysBetween, deletePeriod, PHASES, saveCycle, type CycleSettings } from '@/lib/cycle';

// Fenêtre « Mon cycle » du Profil :
//  - noter le premier jour de chaque règles (enregistré tout de suite) ; la durée moyenne du cycle se calcule
//    à partir des écarts entre ces dates ;
//  - la durée de départ du cycle (tant qu'il n'y a pas deux dates) et la durée des règles, enregistrées avec le bouton.
// Un aperçu montre la phase du jour avec ces valeurs.
export default function CycleEditor({
  cycle,
  onChanged,
  onClose,
  onSaved
}: {
  cycle: CycleSettings;
  onChanged: () => void; // une date a été ajoutée ou retirée : recharger le cycle
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [newDate, setNewDate] = useState(todayKey);
  const [baseLength, setBaseLength] = useState(String(cycle.base_length));
  const [period, setPeriod] = useState(String(cycle.period_length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const baseValue = Number(baseLength);
  const periodValue = Number(period);
  const inRange = (v: number, [min, max]: readonly [number, number]) => Number.isInteger(v) && v >= min && v <= max;
  const invalid = !inRange(baseValue, CYCLE_LIMITS.cycle) || !inRange(periodValue, CYCLE_LIMITS.period);
  // Cycle tel qu'il serait avec les valeurs saisies (moyenne recalculée sur les dates notées)
  const draft = buildCycle({ id: cycle.id, base_length: invalid ? cycle.base_length : baseValue, period_length: invalid ? cycle.period_length : periodValue }, cycle.periods);
  const preview = cyclePhase(draft, today);
  // Dates notées, de la plus récente à la plus ancienne, avec la durée du cycle qu'elles terminent
  const history = cycle.periods.map((p, i) => ({ ...p, gap: i > 0 ? daysBetween(cycle.periods[i - 1].start_date, p.start_date) : null })).reverse();

  async function run(action: () => Promise<string | null>, after: () => void) {
    setBusy(true);
    setError('');
    const err = await action();
    setBusy(false);
    if (err) return setError(err);
    after();
  }

  const formatDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const inputClass = 'rounded border bg-white/80 px-2 py-1.5 text-sm';
  return (
    <PaperModal
      title="Mon cycle"
      onClose={onClose}
      footer={
        <div style={serif}>
          {error && <p className="mb-1 text-xs text-brick">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm">
              Fermer
            </button>
            <button
              type="button"
              onClick={() => run(() => saveCycle(cycle, { base_length: baseValue, period_length: periodValue }), onSaved)}
              disabled={busy || invalid}
              className="rounded px-4 py-2 text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: PF.blue }}
            >
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-sm" style={serif}>
        {/* DÉBUT DES RÈGLES : ajouté tout de suite à l'historique */}
        <div>
          <p className="text-xs">Premier jour de mes règles</p>
          <div className="mt-0.5 flex gap-2">
            <input
              type="date"
              value={newDate}
              max={todayKey}
              onChange={(e) => setNewDate(e.target.value)}
              className={`${inputClass} min-w-0 flex-1`}
              style={{ borderColor: PF.pale }}
            />
            <button
              type="button"
              onClick={() => run(() => addPeriod(newDate), onChanged)}
              disabled={busy || !newDate || newDate > todayKey}
              className="shrink-0 rounded px-3 py-1.5 text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: PF.blue }}
            >
              Noter
            </button>
          </div>

          {history.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-y-auto">
              {history.map((p) => (
                <li key={p.id} className="flex items-center gap-2 border-b border-dotted py-1" style={{ borderColor: PF.pale }}>
                  <span className="flex-1">{formatDate(p.start_date)}</span>
                  {p.gap != null && <span className="text-xs opacity-70">cycle de {p.gap} j</span>}
                  <button
                    type="button"
                    onClick={() => run(() => deletePeriod(p.id), onChanged)}
                    disabled={busy}
                    aria-label={`Retirer le ${formatDate(p.start_date)}`}
                    className="p-1 text-brick opacity-70 hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* DURÉE DU CYCLE : la moyenne des dates notées, sinon la durée de départ saisie */}
        <div className="grid grid-cols-2 gap-3">
          {draft.averaged_over > 0 ? (
            <div className="text-xs">
              Durée moyenne du cycle
              <p className="mt-0.5 text-lg leading-tight">{draft.cycle_length} jours</p>
              <p className="opacity-70">
                sur {draft.averaged_over} cycle{draft.averaged_over > 1 ? 's' : ''}
              </p>
            </div>
          ) : (
            <label className="block text-xs">
              Durée du cycle (jours)
              <input
                value={baseLength}
                onChange={(e) => setBaseLength(e.target.value)}
                type="number"
                inputMode="numeric"
                min={CYCLE_LIMITS.cycle[0]}
                max={CYCLE_LIMITS.cycle[1]}
                className={`${inputClass} mt-0.5 w-full`}
                style={{ borderColor: PF.pale }}
              />
              <span className="mt-0.5 block opacity-70">en attendant deux dates notées</span>
            </label>
          )}
          <label className="block text-xs">
            Durée des règles (jours)
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              type="number"
              inputMode="numeric"
              min={CYCLE_LIMITS.period[0]}
              max={CYCLE_LIMITS.period[1]}
              className={`${inputClass} mt-0.5 w-full`}
              style={{ borderColor: PF.pale }}
            />
          </label>
        </div>
        {invalid && (
          <p className="text-xs text-brick">
            Cycle de {CYCLE_LIMITS.cycle[0]} à {CYCLE_LIMITS.cycle[1]} jours, règles de {CYCLE_LIMITS.period[0]} à {CYCLE_LIMITS.period[1]} jours.
          </p>
        )}

        {/* Aperçu de la phase du jour, dans sa couleur */}
        {preview ? (
          <p className="rounded px-3 py-2 text-white" style={{ backgroundColor: PHASES[preview.phase].colors.accent }}>
            Aujourd&apos;hui : {PHASES[preview.phase].label.toLowerCase()}, jour {preview.day}
            <span className="block text-xs opacity-90">
              Prochaines règles dans {preview.nextPeriodIn} jour{preview.nextPeriodIn > 1 ? 's' : ''} environ
            </span>
          </p>
        ) : (
          <p className="text-xs opacity-75">Note le premier jour de tes règles pour que la page de titre prenne la couleur de ta phase.</p>
        )}
        <p className="text-[11px] opacity-70">
          La durée du cycle est la moyenne de tes 6 derniers cycles notés (un écart de moins de 15 ou plus de 60 jours, comme des règles
          oubliées, n&apos;est pas compté). Estimation à partir d&apos;un cycle régulier : ce n&apos;est ni un avis médical, ni une contraception.
        </p>
      </div>
    </PaperModal>
  );
}
