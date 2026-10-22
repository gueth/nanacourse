'use client';

import { useState } from 'react';
import { FIN, FinButton, Panel } from '@/components/finance/FinanceParts';
import { formatEuros, type FinanceLine } from '@/lib/finance';
import { forecastHemorrhage, HEALTH_TONES, saveHemorrhagePlan, type HemorrhagePlan } from '@/lib/health';

// Prévision d'une hémorragie (période sans revenu d'activité) sur la page Santé :
// quand elle commence (date saisie, ou arrêt des revenus constaté dans les relevés) et quand elle se termine
// (reprise saisie, ou date à laquelle les liquidités seraient épuisées au rythme des dépenses des 6 derniers mois).

const day = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const monthsText = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`;

export function HemorrhageForecast({ lines, currentMonth, plan }: { lines: FinanceLine[]; currentMonth: string; plan: HemorrhagePlan }) {
  const f = forecastHemorrhage(lines, currentMonth, plan);
  const now = new Date();
  const started = !!f.start && f.start <= now;
  // Champs de saisie (texte AAAA-MM-JJ, comme les <input type="date">)
  const [start, setStart] = useState(plan.start ?? '');
  const [resume, setResume] = useState(plan.resume ?? '');
  const [editing, setEditing] = useState(false);
  const red = HEALTH_TONES.hemorragie.dark;

  return (
    <Panel title="Prévision d'hémorragie" subtitle="Une période sans revenu d'activité : quand elle commence, et quand elle se termine.">
      <ul className="space-y-1.5 text-[12px] leading-relaxed">
        {/* DÉBUT */}
        <li>
          <b>Début : </b>
          {f.source === 'saisie' && f.start
            ? started
              ? `en cours depuis le ${day(f.start)} (date que tu as indiquée).`
              : `prévu le ${day(f.start)} (date que tu as indiquée).`
            : f.source === 'releves' && f.start
              ? `constaté dans tes relevés : plus de revenu d'activité depuis ${f.start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}.`
              : f.drop !== null
                ? `pas encore, mais tes revenus d'activité ont baissé de ${Math.round(f.drop * 100)} % le dernier mois : surveille-les.`
                : "aucune hémorragie en vue : tes revenus d'activité rentrent normalement."}
        </li>

        {/* FIN */}
        {f.start ? (
          <li>
            <b>Fin : </b>
            {f.resume
              ? `prévue le ${day(f.resume)}, à la reprise. ${
                  f.shortfall > 0 ? '' : 'Tes liquidités suffisent pour tenir jusque-là.'
                }`
              : f.runwayMonths === null
                ? 'tes revenus passifs couvrent tes dépenses : ton argent tient sans limite.'
                : `sans reprise, tes liquidités seraient épuisées vers le ${day(f.runOut!)}.`}
            {f.resume && f.shortfall > 0 && (
              <span style={{ color: red }}> Il te manquerait {formatEuros(f.shortfall)} pour tenir jusqu&apos;à la reprise.</span>
            )}
          </li>
        ) : (
          <li>
            <b>Si tes revenus s&apos;arrêtaient aujourd&apos;hui : </b>
            {f.runwayMonths === null ? 'tes revenus passifs couvriraient tes dépenses.' : `tes liquidités tiendraient ${monthsText(f.runwayMonths)}.`}
          </li>
        )}
        <li className="text-[11px]" style={{ color: FIN.slate }}>
          Calcul : {formatEuros(f.liquid)} de liquidités, et {formatEuros(f.burn)} de dépenses par mois (moyenne des 6 derniers mois, moins tes
          revenus passifs)
          {f.runwayMonths !== null && <>, soit {monthsText(f.runwayMonths)} d&apos;autonomie</>}.
        </li>
      </ul>

      {/* DATES CONNUES : fin de contrat, reprise prévue */}
      {editing ? (
        <div className="mt-3 rounded-sm px-3 py-3" style={{ backgroundColor: FIN.mist }}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Arrêt des revenus
              </span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-sm border bg-white px-2 py-1 text-[12px]" style={{ borderColor: FIN.line }} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Reprise prévue
              </span>
              <input type="date" value={resume} onChange={(e) => setResume(e.target.value)} className="rounded-sm border bg-white px-2 py-1 text-[12px]" style={{ borderColor: FIN.line }} />
            </label>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            Ex : la fin de ton contrat, et le début du prochain emploi si tu le connais. Ces dates restent sur ton téléphone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <FinButton
              onClick={() => {
                saveHemorrhagePlan({ start: start || null, resume: resume || null });
                setEditing(false);
              }}
            >
              Enregistrer
            </FinButton>
            {(plan.start || plan.resume) && (
              <FinButton
                outline
                onClick={() => {
                  saveHemorrhagePlan({ start: null, resume: null });
                  setStart('');
                  setResume('');
                  setEditing(false);
                }}
              >
                Effacer les dates
              </FinButton>
            )}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-3 text-[11px] underline" style={{ color: FIN.slate }}>
          {plan.start || plan.resume ? 'Modifier les dates d’arrêt et de reprise' : 'Je connais la date d’arrêt de mes revenus'}
        </button>
      )}
    </Panel>
  );
}
