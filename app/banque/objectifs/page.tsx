'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatEuros, monthKey, snapshot, type Snapshot } from '@/lib/finance';
import { addGoal, deleteGoal, describeDbError, updateGoal, type Goal } from '@/lib/financePlans';
import { useDebts, useFinanceLines, useGoals } from '@/lib/financeQueries';
import { durationLabel, loanPayment, loanSchedule, monthsFromNow, monthsToTarget, realRate, requiredMonthly } from '@/lib/financeCalc';
import { notion } from '@/lib/financeGlossary';
import { Certainty, ErrorNote, FIN, FinanceHeader, FinancePage, FinButton, Meter, NumberField, Panel, StatementTabs } from '@/components/finance/FinanceParts';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
const pct = (n: number) => `${Math.round(n * 100)} %`;
const roundUp = (n: number, step = 100) => Math.ceil(n / step) * step;

// Une ligne de résultat de simulation, avec son niveau de certitude
function Result({ label, value, estimate, tone }: { label: string; value: string; estimate?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-[12px]">
      <span className="flex items-center gap-1.5">
        {label} <Certainty estimate={estimate} />
      </span>
      <b style={{ color: tone === 'good' ? FIN.sage : tone === 'bad' ? FIN.rose : FIN.navy }}>{value}</b>
    </div>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-sm px-3 py-2 text-[12px] leading-relaxed" style={{ backgroundColor: ok ? '#dfe9e2' : '#f3dfe1', color: ok ? FIN.sage : FIN.rose }}>
      {children}
    </p>
  );
}

// Carte d'un objectif : progression, date estimée, et réglages
function GoalCard({ goal, inflation, onChange, onDelete }: { goal: Goal; inflation: number; onChange: (c: Partial<Goal>) => void; onDelete: () => void }) {
  const rate = realRate(goal.annual_rate, inflation);
  const months = monthsToTarget(goal.saved, goal.target, goal.monthly, rate);
  const progress = goal.target > 0 ? goal.saved / goal.target : 0;
  return (
    <div className="mt-3 rounded-sm border px-3 py-3" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-bold">{goal.name}</p>
        <button type="button" onClick={onDelete} aria-label={`Supprimer ${goal.name}`} className="opacity-50 hover:opacity-100" style={{ color: FIN.rose }}>
          <X size={14} />
        </button>
      </div>
      <p className="mb-1 text-[11px]" style={{ color: FIN.slate }}>
        {formatEuros(goal.saved)} sur {formatEuros(goal.target)} · {pct(progress)}
      </p>
      <Meter value={progress} color={FIN.gold} />
      <p className="mt-2 text-[12px] leading-relaxed">
        {months === 0 ? (
          <span style={{ color: FIN.sage }}>Objectif atteint, bravo !</span>
        ) : months === null ? (
          <span style={{ color: FIN.rose }}>Avec ce versement, l&apos;objectif ne sera pas atteint : augmente le versement mensuel.</span>
        ) : (
          <>
            Atteint en <b>{monthsFromNow(months)}</b>, dans {durationLabel(months)}. <Certainty estimate={goal.annual_rate > 0} />
          </>
        )}
      </p>
      {months !== 0 && (
        <p className="mt-1 text-[11px]" style={{ color: FIN.slate }}>
          Pour y arriver en 1 an : {formatEuros(requiredMonthly(goal.saved, goal.target, 12, rate))}/mois · en 3 ans :{' '}
          {formatEuros(requiredMonthly(goal.saved, goal.target, 36, rate))}/mois
        </p>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberField label="Déjà épargné" value={goal.saved} onChange={(n) => onChange({ saved: n ?? 0 })} />
        <NumberField label="Par mois" value={goal.monthly} onChange={(n) => onChange({ monthly: n ?? 0 })} />
        <NumberField
          label="Rendement"
          unit="%"
          value={goal.annual_rate ? Math.round(goal.annual_rate * 1000) / 10 : 0}
          onChange={(n) => onChange({ annual_rate: (n ?? 0) / 100 })}
        />
      </div>
    </div>
  );
}

type Scenario = 'comptant' | 'credit' | 'epargne' | 'revenus' | 'loyer';
const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'comptant', label: 'Achat' },
  { id: 'credit', label: 'Crédit' },
  { id: 'epargne', label: 'Épargne' },
  { id: 'revenus', label: 'Revenus' },
  { id: 'loyer', label: 'Loyer' }
];

// Simulateur : conséquences d'une décision sur le budget, l'épargne et la réserve
function Simulator({ snap, goals, debtMonthly, inflation }: { snap: Snapshot; goals: Goal[]; debtMonthly: number; inflation: number }) {
  const [scenario, setScenario] = useState<Scenario>('comptant');
  const [price, setPrice] = useState<number | null>(8000);
  const [loanRate, setLoanRate] = useState<number | null>(5);
  const [loanMonths, setLoanMonths] = useState<number | null>(48);
  const [extra, setExtra] = useState<number | null>(200);
  const [goalId, setGoalId] = useState<string>(goals[0]?.id ?? '');
  const [incomeChange, setIncomeChange] = useState<number | null>(-20);
  const [rentChange, setRentChange] = useState<number | null>(150);

  const { savings, income, essentials, liquid } = snap;
  const reserveMonths = (cash: number, need = essentials) => (need > 0 ? cash / need : 0);
  const credit = Math.max(snap.credit, debtMonthly);
  const months1 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`;

  let body: React.ReactNode = null;
  if (scenario === 'comptant') {
    const p = price ?? 0;
    const after = liquid - p;
    body = (
      <>
        <NumberField label="Prix de l'achat, payé avec ton épargne" value={price} onChange={setPrice} />
        <div className="mt-2">
          <Result label="Liquidités après l'achat" value={formatEuros(after)} tone={after >= 0 ? undefined : 'bad'} />
          <Result label="Réserve de sécurité" value={`${months1(reserveMonths(liquid))} → ${months1(reserveMonths(Math.max(0, after)))}`} />
          {savings > 0 && <Result label="Temps pour reconstituer" value={durationLabel(Math.ceil(p / savings))} estimate />}
        </div>
        <Verdict ok={after >= essentials * 3}>
          {after < 0
            ? "Tu n'as pas assez de liquidités pour cet achat."
            : after >= essentials * 3
              ? "C'est possible : il te restera au moins 3 mois de dépenses indispensables de côté."
              : `C'est faisable, mais ta réserve de sécurité tomberait sous 3 mois. Attendre ${durationLabel(Math.max(1, Math.ceil((essentials * 3 - after) / Math.max(1, savings))))} d'épargne de plus serait plus prudent.`}
        </Verdict>
      </>
    );
  } else if (scenario === 'credit') {
    const p = price ?? 0;
    const r = (loanRate ?? 0) / 100;
    const n = loanMonths ?? 12;
    const payment = loanPayment(p, r, n);
    const cost = (loanSchedule(p, r, payment)?.interest ?? 0);
    const newSavings = savings - payment;
    const ratio = income > 0 ? (credit + payment) / income : 1;
    body = (
      <>
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Montant" value={price} onChange={setPrice} />
          <NumberField label="Taux (TAEG)" unit="%" value={loanRate} onChange={setLoanRate} />
          <NumberField label="Durée" unit="mois" value={loanMonths} onChange={setLoanMonths} />
        </div>
        <div className="mt-2">
          <Result label="Mensualité" value={formatEuros(payment)} />
          <Result label="Coût total des intérêts" value={formatEuros(cost)} tone="bad" />
          <Result label="Épargne mensuelle après" value={formatEuros(newSavings)} tone={newSavings >= 0 ? undefined : 'bad'} />
          <Result label="Taux d'endettement" value={`${pct(income > 0 ? credit / income : 0)} → ${pct(ratio)}`} tone={ratio > 0.35 ? 'bad' : undefined} />
        </div>
        <Verdict ok={newSavings > 0 && ratio <= 0.35}>
          {newSavings <= 0
            ? 'Cette mensualité dépasse ce que tu épargnes chaque mois : ton budget passerait dans le rouge.'
            : ratio > 0.35
              ? "Ton taux d'endettement dépasserait 35 % : c'est le seuil au-delà duquel le budget devient fragile."
              : `C'est supportable : il te resterait ${formatEuros(newSavings)} d'épargne par mois. Le crédit te coûte ${formatEuros(cost)} de plus qu'un achat comptant.`}
        </Verdict>
        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          {notion('taeg').text}
        </p>
      </>
    );
  } else if (scenario === 'epargne') {
    const goal = goals.find((g) => g.id === goalId) ?? goals[0];
    if (!goal) {
      body = <p className="text-[12px]">Crée d&apos;abord un objectif ci-dessus pour simuler un effort d&apos;épargne.</p>;
    } else {
      const rate = realRate(goal.annual_rate, inflation);
      const before = monthsToTarget(goal.saved, goal.target, goal.monthly, rate);
      const after = monthsToTarget(goal.saved, goal.target, goal.monthly + (extra ?? 0), rate);
      body = (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Objectif
              </span>
              <select value={goal.id} onChange={(e) => setGoalId(e.target.value)} className="rounded-sm border bg-white px-2 py-1.5 text-[12px]" style={{ borderColor: FIN.line }}>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="En plus par mois" value={extra} onChange={setExtra} />
          </div>
          <div className="mt-2">
            <Result label="Date actuelle" value={before === null ? 'jamais' : before === 0 ? 'atteint' : monthsFromNow(before)} estimate={goal.annual_rate > 0} />
            <Result label="Nouvelle date" value={after === null ? 'jamais' : after === 0 ? 'atteint' : monthsFromNow(after)} estimate={goal.annual_rate > 0} tone="good" />
          </div>
          {before !== null && after !== null && before > after && (
            <Verdict ok>
              Tu gagnerais {durationLabel(before - after)}. Il te resterait {formatEuros(savings - goal.monthly - (extra ?? 0))} par mois d&apos;épargne libre.
            </Verdict>
          )}
        </>
      );
    }
  } else if (scenario === 'revenus') {
    const delta = (income * (incomeChange ?? 0)) / 100;
    const newSavings = savings + delta;
    body = (
      <>
        <NumberField label="Variation des revenus" unit="%" value={incomeChange} onChange={setIncomeChange} />
        <div className="mt-2">
          <Result label="Revenus mensuels" value={`${formatEuros(income)} → ${formatEuros(income + delta)}`} />
          <Result label="Épargne mensuelle" value={`${formatEuros(savings)} → ${formatEuros(newSavings)}`} tone={newSavings >= 0 ? undefined : 'bad'} />
          {credit > 0 && <Result label="Taux d'endettement" value={pct(income + delta > 0 ? credit / (income + delta) : 1)} />}
        </div>
        <Verdict ok={newSavings >= 0}>
          {newSavings >= 0
            ? 'Ton budget resterait à l’équilibre.'
            : `Il te manquerait ${formatEuros(-newSavings)} par mois : tes liquidités tiendraient environ ${months1(liquid / -newSavings)}, sans changer tes dépenses.`}
        </Verdict>
      </>
    );
  } else {
    const r = rentChange ?? 0;
    const newSavings = savings - r;
    body = (
      <>
        <NumberField label="Hausse du loyer par mois" value={rentChange} onChange={setRentChange} />
        <div className="mt-2">
          <Result label="Épargne mensuelle" value={`${formatEuros(savings)} → ${formatEuros(newSavings)}`} tone={newSavings >= 0 ? undefined : 'bad'} />
          <Result label="Sur un an" value={formatEuros(-r * 12)} tone="bad" />
          <Result label="Réserve de sécurité" value={`${months1(reserveMonths(liquid))} → ${months1(reserveMonths(liquid, essentials + r))}`} />
        </div>
        <Verdict ok={newSavings >= income * 0.1}>
          {newSavings < 0
            ? 'Ce logement ferait passer ton budget dans le rouge.'
            : newSavings < income * 0.1
              ? 'C’est possible, mais ton épargne passerait sous 10 % de tes revenus.'
              : `C'est supportable : tu épargnerais encore ${formatEuros(newSavings)} par mois.`}
        </Verdict>
      </>
    );
  }

  return (
    <Panel
      title="Et si… ?"
      subtitle={`Simulations à partir de tes chiffres : revenus ${formatEuros(income)}/mois, épargne ${formatEuros(savings)}/mois, liquidités ${formatEuros(liquid)}.`}
    >
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <StatementTabs tabs={SCENARIOS} value={scenario} onChange={setScenario} />
      </div>
      <div className="mt-3">{body}</div>
    </Panel>
  );
}

export default function GoalsPage() {
  const [confirm, confirmDialog] = useConfirm();
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  // Données gardées en mémoire entre deux visites (lib/financeQueries) : affichées tout de suite, puis rafraîchies
  const linesQuery = useFinanceLines(currentMonth, 12);
  const goalsQuery = useGoals();
  const debtsQuery = useDebts();
  const lines = linesQuery.data;
  const snap = useMemo(() => (currentMonth && lines ? snapshot(lines, currentMonth) : null), [lines, currentMonth]);
  const goals = goalsQuery.data ?? [];
  const setGoals = goalsQuery.setData;
  const debtMonthly = (debtsQuery.data ?? []).reduce((s, x) => s + x.monthly, 0);
  const [actionError, setError] = useState<string | null>(null);
  const loadError = linesQuery.error ?? goalsQuery.error ?? debtsQuery.error;
  const error = actionError ?? (loadError && describeDbError(loadError));
  const [inflation, setInflation] = useState(0.02);
  const [draft, setDraft] = useState<{ name: string; target: number | null } | null>(null);

  function report(err: { message: string } | null) {
    if (err) setError(describeDbError(err.message));
  }

  async function change(goal: Goal, changes: Partial<Goal>) {
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, ...changes } : g)));
    report(await updateGoal(goal.id, changes));
  }

  async function create() {
    if (!draft?.name.trim() || !draft.target) return;
    const { goal, error: err } = await addGoal({ name: draft.name.trim(), target: draft.target, saved: 0, monthly: 0, annual_rate: 0 });
    report(err);
    if (goal) setGoals((gs) => [...gs, goal]);
    setDraft(null);
  }

  // Objectifs proposés, calculés à partir des chiffres
  const presets = snap
    ? [
        { name: 'Réserve de sécurité', target: snap.essentials > 0 ? roundUp(snap.essentials * 3) : null, hint: '3 mois de dépenses indispensables' },
        { name: 'Indépendance financière', target: snap.charges > 0 ? roundUp(snap.charges * 12 * 25, 1000) : null, hint: '25 fois tes dépenses annuelles (règle des 4 %)' },
        { name: 'Apport pour un logement', target: null, hint: 'souvent 10 % du prix, plus les frais de notaire' },
        { name: '', target: null, hint: 'objectif personnalisé' }
      ]
    : [];

  return (
    <FinancePage header={<FinanceHeader subtitle="objectifs · simulations" />}>
      {confirmDialog}
      <ErrorNote message={error} />

      <Panel title="Tes objectifs" subtitle="Les montants sont en euros d'aujourd'hui : le rendement est corrigé de l'inflation.">
        {goals.length === 0 && !draft && (
          <p className="text-[12px] leading-relaxed" style={{ color: FIN.slate }}>
            Pas encore d&apos;objectif. Choisis-en un ci-dessous : l&apos;appli calculera combien épargner et en combien de temps.
          </p>
        )}
        {goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            inflation={inflation}
            onChange={(c) => change(g, c)}
            onDelete={async () => {
              if (!(await confirm("Supprimer l'objectif", `Supprimer « ${g.name} » ?`))) return;
              setGoals((gs) => gs.filter((x) => x.id !== g.id));
              report(await deleteGoal(g.id));
            }}
          />
        ))}

        {draft ? (
          <div className="mt-3 rounded-sm border px-3 py-3" style={{ borderColor: FIN.gold }}>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                  Nom
                </span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Voyage au Japon"
                  className="rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
                  style={{ borderColor: FIN.line }}
                />
              </label>
              <NumberField label="Montant visé" value={draft.target} onChange={(n) => setDraft({ ...draft, target: n })} />
            </div>
            <div className="mt-2 flex gap-2">
              <FinButton onClick={create} disabled={!draft.name.trim() || !draft.target}>
                Créer
              </FinButton>
              <FinButton outline onClick={() => setDraft(null)}>
                Annuler
              </FinButton>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {presets.map((p) => (
              <button
                key={p.hint}
                type="button"
                onClick={() => setDraft({ name: p.name, target: p.target })}
                className="rounded-sm border px-2 py-2 text-left"
                style={{ borderColor: FIN.line, backgroundColor: '#fff' }}
              >
                <span className="block text-[12px] font-bold">{p.name || '+ Autre objectif'}</span>
                <span className="block text-[10px] leading-snug" style={{ color: FIN.slate }}>
                  {p.target ? `${formatEuros(p.target)} · ` : ''}
                  {p.hint}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 border-t pt-3 text-[11px]" style={{ borderColor: FIN.line, color: FIN.slate }}>
          <span className="flex-1">Inflation supposée</span>
          {[0, 0.02, 0.03].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setInflation(r)}
              className="rounded-full border px-2.5 py-0.5"
              style={inflation === r ? { backgroundColor: FIN.slate, color: FIN.paper, borderColor: FIN.slate } : { borderColor: FIN.line }}
            >
              {r * 100} %
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          {notion('inflation').text} Un rendement de placement n&apos;est jamais garanti, sauf sur les livrets réglementés (taux fixé par
          l&apos;État, révisable).
        </p>
      </Panel>

      {snap?.ref && <Simulator snap={snap} goals={goals} debtMonthly={debtMonthly} inflation={inflation} />}
      {snap && !snap.ref && (
        <p className="mt-2 text-center text-[11px]" style={{ color: FIN.slate }}>
          Remplis ton bilan et ton compte de résultat pour débloquer le simulateur « Et si… ? » : il part de tes vrais chiffres.
        </p>
      )}
    </FinancePage>
  );
}
