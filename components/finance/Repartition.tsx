'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatEuros, monthLabel } from '@/lib/finance';
import { DEFAULT_PLAN, newPartId, type IncomePart } from '@/lib/budget';
import { useIncomePlan } from '@/lib/coursesQueries';
import { useMonthPlans } from '@/lib/financeQueries';
import { assignTargets, expenseTargets, ownPlan, partsFor, repartitionCheck, saveDefaultRepartition, saveMonthPlan } from '@/lib/repartition';
import type { Transaction } from '@/lib/transactions';
import { FIN, FinButton, FinModal, Meter, Panel, parseAmount } from '@/components/finance/FinanceParts';

// Répartition du revenu dans les Finances (lib/repartition) :
//  - Gestion : la répartition par défaut, pour le mois en cours et les suivants (les mois passés gardent la leur) ;
//  - Budget : pour le mois affiché, ce que disent les relevés face à la répartition choisie, comme pour les limites des
//    catégories, mais à titre indicatif seulement (rien ne compte dans la dette à moi-même).

const pct = (n: number) => `${Math.round(n * 100)} %`;

function describeError(err: { code?: string; message: string }) {
  // Colonne « parts » de income_plan absente : script des budgets de courses pas (entièrement) lancé
  if (/income_plan|'parts'/.test(err.message))
    return 'La répartition n’est pas encore prête dans Supabase : lance le script supabase/shopping_budgets.sql dans l’éditeur SQL, puis recharge la page.';
  if (err.code === '42P01' || err.code === 'PGRST205' || /month_plans/.test(err.message))
    return 'La répartition propre à chaque mois n’est pas encore prête dans Supabase : lance le script supabase/month_plans.sql dans l’éditeur SQL.';
  return err.message;
}

// RÉPARTITION PAR DÉFAUT (Finances > Gestion)
export function DefaultRepartitionPanel({ ready, onError }: { ready: boolean; onError: (message: string) => void }) {
  const planQuery = useIncomePlan();
  const monthPlansQuery = useMonthPlans();
  const [editing, setEditing] = useState(false);
  const plan = planQuery.data ?? DEFAULT_PLAN;
  const all = ready ? expenseTargets() : [];
  const owner = assignTargets(plan.parts, all);

  async function save(parts: IncomePart[]) {
    const err = await saveDefaultRepartition(plan.parts, { ...plan, parts });
    if (err) return onError(describeError(err));
    setEditing(false);
    planQuery.reload();
    monthPlansQuery.reload();
  }

  return (
    <Panel
      title="Ma répartition"
      subtitle="Comment tes revenus se partagent, par défaut pour le mois en cours et les suivants (les mois passés gardent la leur). Chaque mois, la page Budget la compare à tes relevés, à titre indicatif."
    >
      {planQuery.data === undefined ? (
        <p className="text-[11px]" style={{ color: FIN.slate }}>
          {planQuery.error ?? 'Chargement…'}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {plan.parts.map((p) => {
              const labels = all.filter((t) => owner.get(t.id) === p.id).map((t) => t.label);
              return (
                <li key={p.id} className="border-b pb-2 last:border-b-0" style={{ borderColor: FIN.line }}>
                  <p className="flex items-baseline justify-between gap-2 text-[12px] font-bold">
                    <span>{p.label}</span>
                    <span>{p.pct} %</span>
                  </p>
                  <p className="text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
                    {p.savings ? 'Ce qui reste des revenus du mois' : labels.length ? labels.join(' · ') : 'Aucun poste de dépenses'}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <FinButton outline disabled={!ready} onClick={() => setEditing(true)}>
              Modifier
            </FinButton>
          </div>
        </>
      )}
      {editing && <RepartitionEditor title="Ma répartition" initial={plan.parts} onSave={save} onClose={() => setEditing(false)} />}
    </Panel>
  );
}

// RÉPARTITION DU MOIS AFFICHÉ (Finances > Budget), à titre indicatif
export function MonthRepartitionPanel({
  period,
  currentMonth,
  monthTx,
  onError
}: {
  period: string;
  currentMonth: string | null;
  monthTx: Transaction[];
  onError: (message: string) => void;
}) {
  const planQuery = useIncomePlan();
  const monthPlansQuery = useMonthPlans();
  const [editing, setEditing] = useState(false);
  if (planQuery.data === undefined || monthPlansQuery.data === undefined) return null;
  const plan = planQuery.data;
  const monthPlans = monthPlansQuery.data;
  const past = !!currentMonth && period < currentMonth;
  const own = ownPlan(period, monthPlans);
  const parts = partsFor(period, plan, monthPlans);
  const { income, rows, unassigned, unassignedTargets } = repartitionCheck(parts, monthTx);

  // Mois passé : sa propre répartition ; mois en cours (ou à venir) : la répartition par défaut
  async function save(next: IncomePart[]) {
    const err = past ? await saveMonthPlan(period, next) : await saveDefaultRepartition(plan.parts, { ...plan, parts: next });
    if (err) return onError(describeError(err));
    setEditing(false);
    planQuery.reload();
    monthPlansQuery.reload();
  }

  return (
    <Panel
      collapsible
      title="Répartition du mois"
      subtitle={`À titre indicatif : la part de tes revenus de ${monthLabel(period)} allée dans chaque partie, face à ${
        own ? 'la répartition propre à ce mois' : 'ta répartition'
      }. Elle ne compte ni dans la dette à moi-même ni dans la santé financière.`}
    >
      {income <= 0 ? (
        <p className="text-[11px]" style={{ color: FIN.slate }}>
          Aucun revenu relevé ce mois-ci : la répartition ne peut pas encore être vérifiée.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px]" style={{ color: FIN.slate }}>
            Revenus du mois : <b style={{ color: FIN.navy }}>{formatEuros(income)}</b>
          </p>
          <ul className="space-y-3">
            {rows.map(({ part, goal, actual, share }) => {
              const ratio = goal > 0 ? actual / goal : actual > 0 ? 2 : 0;
              // Dépenses : rester sous l'objectif ; épargne : l'atteindre
              const color = part.savings
                ? ratio >= 1
                  ? FIN.sage
                  : ratio >= 0.5
                    ? FIN.gold
                    : FIN.rose
                : ratio > 1.005
                  ? FIN.rose
                  : ratio >= 0.8
                    ? FIN.gold
                    : FIN.sage;
              const gap = actual - goal;
              return (
                <li key={part.id}>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="font-bold">{part.label}</span>
                    <span className="text-right" style={{ color }}>
                      {share !== null ? pct(share) : '—'}
                      <span style={{ color: FIN.slate }}>{` / ${part.pct} %`}</span>
                    </span>
                  </div>
                  <Meter value={goal > 0 ? actual / goal : 0} color={color} />
                  <p className="mt-0.5 text-[10px]" style={{ color: FIN.slate }}>
                    {formatEuros(actual)} pour {formatEuros(goal)} voulus
                    {Math.abs(gap) >= 1 &&
                      (part.savings
                        ? gap < 0
                          ? ` · il manque ${formatEuros(-gap)}`
                          : ` · ${formatEuros(gap)} de plus que prévu`
                        : gap > 0
                          ? ` · ${formatEuros(gap)} de trop`
                          : ` · ${formatEuros(-gap)} de marge`)}
                  </p>
                </li>
              );
            })}
          </ul>
          {unassigned > 0 && (
            <p className="mt-3 border-t pt-2 text-[10px] leading-relaxed" style={{ borderColor: FIN.line, color: FIN.slate }}>
              Hors répartition : {formatEuros(unassigned)} ({unassignedTargets.map((t) => t.label).join(', ')}). Range ces postes dans une partie pour les
              compter.
            </p>
          )}
        </>
      )}
      <div className="mt-3">
        <FinButton outline onClick={() => setEditing(true)}>
          {past ? 'Modifier pour ce mois' : 'Modifier ma répartition'}
        </FinButton>
      </div>
      {editing && (
        <RepartitionEditor title={past ? `Répartition de ${monthLabel(period)}` : 'Ma répartition'} initial={parts} onSave={save} onClose={() => setEditing(false)} />
      )}
    </Panel>
  );
}

type Row = { id: string; label: string; hint?: string; pct: string; savings: boolean };

// Fenêtre de modification : les parties (nom, pourcentage, laquelle est l'épargne), puis la partie de chaque poste de dépenses.
// Le total doit faire 100 %.
function RepartitionEditor({ title, initial, onSave, onClose }: { title: string; initial: IncomePart[]; onSave: (parts: IncomePart[]) => Promise<void>; onClose: () => void }) {
  const all = expenseTargets();
  const [rows, setRows] = useState<Row[]>(() => initial.map((p) => ({ id: p.id, label: p.label, hint: p.hint, pct: String(p.pct).replace('.', ','), savings: !!p.savings })));
  const [owner, setOwner] = useState<Map<string, string>>(() => assignTargets(initial, all));
  const [saving, setSaving] = useState(false);

  const total = Math.round(rows.reduce((s, r) => s + (parseAmount(r.pct) ?? 0), 0) * 100) / 100;
  const spendingRows = rows.filter((r) => !r.savings);
  const invalid = rows.length === 0 || total !== 100 || rows.some((r) => !r.label.trim());
  const update = (id: string, change: Partial<Row>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));

  async function save() {
    setSaving(true);
    await onSave(
      rows.map((r) => ({
        id: r.id,
        label: r.label.trim(),
        ...(r.hint ? { hint: r.hint } : {}),
        pct: parseAmount(r.pct) ?? 0,
        ...(r.savings ? { savings: true } : { targets: all.filter((t) => owner.get(t.id) === r.id).map((t) => t.id) })
      }))
    );
    setSaving(false);
  }

  const input = 'rounded-sm border bg-white px-2 py-1 text-[12px] outline-none';
  return (
    <FinModal title={title} onClose={onClose}>
      <ul className="mt-1 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="border-b pb-2" style={{ borderColor: FIN.line }}>
            <div className="flex items-center gap-1.5">
              <input
                value={r.label}
                onChange={(e) => update(r.id, { label: e.target.value })}
                placeholder="Nom de la partie"
                aria-label="Nom de la partie"
                className={`${input} min-w-0 flex-1`}
                style={{ borderColor: FIN.line, color: FIN.navy }}
              />
              <input
                value={r.pct}
                onChange={(e) => update(r.id, { pct: e.target.value })}
                inputMode="decimal"
                aria-label={`Pourcentage ${r.label}`}
                className={`${input} w-14 text-right`}
                style={{ borderColor: FIN.line, color: FIN.navy }}
              />
              <span className="text-[12px]">%</span>
              <button
                type="button"
                onClick={() => {
                  setRows((list) => list.filter((x) => x.id !== r.id));
                  setOwner((m) => new Map([...m].filter(([, p]) => p !== r.id)));
                }}
                aria-label={`Supprimer la partie ${r.label}`}
                className="p-1.5"
                style={{ color: FIN.rose }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <label className="mt-1 flex items-center gap-1.5 text-[10px]" style={{ color: FIN.slate }}>
              <input
                type="checkbox"
                checked={r.savings}
                onChange={(e) => {
                  // Une seule partie d'épargne : ce qui reste des revenus ; ses postes de dépenses sont libérés
                  setRows((list) => list.map((x) => ({ ...x, savings: x.id === r.id ? e.target.checked : e.target.checked ? false : x.savings })));
                  if (e.target.checked) setOwner((m) => new Map([...m].filter(([, p]) => p !== r.id)));
                }}
              />
              C&apos;est l&apos;épargne (ce qui reste des revenus du mois)
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setRows((list) => [...list, { id: newPartId(), label: '', pct: '0', savings: false }])}
        className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]"
        style={{ color: FIN.accent }}
      >
        <Plus size={13} /> Ajouter une partie
      </button>

      {/* Partie de chaque poste de dépenses */}
      <p className="mt-4 text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        Postes de dépenses
      </p>
      <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto pr-1">
        {all.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className={`min-w-0 truncate ${t.id.startsWith('groupe:') ? 'font-bold' : ''}`}>{t.label}</span>
            <select
              value={owner.get(t.id) ?? ''}
              onChange={(e) =>
                setOwner((m) => {
                  const next = new Map(m);
                  if (e.target.value) next.set(t.id, e.target.value);
                  else next.delete(t.id);
                  return next;
                })
              }
              aria-label={`Partie de ${t.label}`}
              className="fin-select max-w-[55%] py-0.5 pl-1.5 text-[11px]"
            >
              <option value="">Aucune</option>
              {spendingRows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || 'Sans nom'}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      {total !== 100 && rows.length > 0 && (
        <p className="mt-3 text-[11px]" style={{ color: FIN.rose }}>
          Les parties font {String(total).replace('.', ',')} % : elles doivent faire 100 %.
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <FinButton outline onClick={onClose}>
          Annuler
        </FinButton>
        <FinButton disabled={saving || invalid} onClick={save}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </FinButton>
      </div>
    </FinModal>
  );
}
