'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { fetchLinesRange, formatEuros, monthKey, shiftMonth, snapshot } from '@/lib/finance';
import { addDebt, deleteDebt, describeDbError, fetchDebts, updateDebt, type Debt } from '@/lib/financePlans';
import { durationLabel, futureValue, loanSchedule, monthsFromNow, simulateDebts } from '@/lib/financeCalc';
import { notion } from '@/lib/financeGlossary';
import { Certainty, ErrorNote, FIN, FinanceHeader, FinancePage, FinButton, NumberField, Panel, SummaryTile } from '@/components/finance/FinanceParts';

const noSubscribe = () => () => {};
const readMonth = () => monthKey(new Date());
const pct = (n: number) => `${Math.round(n * 100)} %`;
const ratePct = (r: number) => `${(r * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

// Carte d'une dette : les cinq indicateurs utiles, et ses réglages
function DebtCard({ debt, onChange, onDelete }: { debt: Debt; onChange: (c: Partial<Debt>) => void; onDelete: () => void }) {
  const schedule = loanSchedule(debt.principal, debt.annual_rate, debt.monthly);
  const rows: [string, string, string][] = [
    ['Capital restant dû', formatEuros(debt.principal), 'Ce que tu dois encore'],
    ['Taux d’intérêt', ratePct(debt.annual_rate), 'Le coût de la dette, par an'],
    ['Mensualité', formatEuros(debt.monthly), 'Ton engagement chaque mois'],
    ['Date de fin', schedule ? monthsFromNow(schedule.months) : '—', schedule ? `Dans ${durationLabel(schedule.months)}` : 'La mensualité ne couvre pas les intérêts'],
    ['Intérêts restant à payer', schedule ? formatEuros(schedule.interest) : '—', 'Ce que le crédit te coûte encore']
  ];
  return (
    <div className="mt-3 rounded-sm border px-3 py-3" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-bold">{debt.name}</p>
        <button type="button" onClick={onDelete} aria-label={`Supprimer ${debt.name}`} className="opacity-50 hover:opacity-100" style={{ color: FIN.rose }}>
          <X size={14} />
        </button>
      </div>
      <table className="mt-1 w-full text-[11px]">
        <tbody>
          {rows.map(([label, value, help]) => (
            <tr key={label} className="border-b last:border-0" style={{ borderColor: FIN.mist }}>
              <td className="py-1 pr-2">
                {label}
                <span className="block text-[9px]" style={{ color: FIN.slate }}>
                  {help}
                </span>
              </td>
              <td className="py-1 text-right font-bold" style={{ color: !schedule && label === 'Date de fin' ? FIN.rose : FIN.navy }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberField label="Capital dû" value={debt.principal} onChange={(n) => onChange({ principal: n ?? 0 })} />
        <NumberField label="Taux" unit="%" value={Math.round(debt.annual_rate * 10000) / 100} onChange={(n) => onChange({ annual_rate: (n ?? 0) / 100 })} />
        <NumberField label="Mensualité" value={debt.monthly} onChange={(n) => onChange({ monthly: n ?? 0 })} />
      </div>
    </div>
  );
}

// Remboursement anticipé : intérêts économisés (certain) comparés à ce que la même somme rapporterait placée (estimation)
function EarlyRepayment({ debts }: { debts: Debt[] }) {
  const [debtId, setDebtId] = useState(debts[0]?.id ?? '');
  const [amount, setAmount] = useState<number | null>(2000);
  const [placementRate, setPlacementRate] = useState<number | null>(3);
  const debt = debts.find((d) => d.id === debtId) ?? debts[0];
  if (!debt) return null;
  const x = Math.min(amount ?? 0, debt.principal);
  const before = loanSchedule(debt.principal, debt.annual_rate, debt.monthly);
  const after = loanSchedule(debt.principal - x, debt.annual_rate, debt.monthly);
  if (!before || !after) return null;
  const saved = before.interest - after.interest;
  const freed = before.months - after.months;
  // Placement : la même somme placée pendant toute la durée restante du crédit
  const placed = futureValue(x, 0, (placementRate ?? 0) / 100, before.months) - x;
  const better = saved >= placed;

  return (
    <Panel title="Rembourser plus tôt ?" subtitle="Compare un remboursement anticipé à un placement de la même somme.">
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
            Dette
          </span>
          <select value={debt.id} onChange={(e) => setDebtId(e.target.value)} className="rounded-sm border bg-white px-1 py-1.5 text-[12px]" style={{ borderColor: FIN.line }}>
            {debts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Somme" value={amount} onChange={setAmount} />
        <NumberField label="Placement" unit="%" value={placementRate} onChange={setPlacementRate} />
      </div>
      <div className="mt-2 text-[12px]">
        <div className="flex items-baseline justify-between py-1">
          <span className="flex items-center gap-1.5">
            Intérêts économisés <Certainty />
          </span>
          <b style={{ color: FIN.sage }}>{formatEuros(saved)}</b>
        </div>
        <div className="flex items-baseline justify-between py-1">
          <span className="flex items-center gap-1.5">
            Fin du crédit avancée de <Certainty />
          </span>
          <b>{durationLabel(freed)}</b>
        </div>
        <div className="flex items-baseline justify-between py-1">
          <span className="flex items-center gap-1.5">
            Gain si la somme était placée <Certainty estimate />
          </span>
          <b style={{ color: FIN.gold }}>{formatEuros(placed)}</b>
        </div>
      </div>
      <p className="mt-2 rounded-sm px-3 py-2 text-[12px] leading-relaxed" style={{ backgroundColor: FIN.mist }}>
        {better
          ? `Rembourser semble plus intéressant : c'est un gain sûr de ${formatEuros(saved)}, quand le placement n'est qu'une estimation.`
          : `Placer la somme pourrait rapporter davantage, à condition que le rendement de ${placementRate ?? 0} % se réalise. Rembourser reste un gain garanti.`}{' '}
        Garde toujours ta réserve de sécurité avant de rembourser par anticipation.
      </p>
      <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
        Calcul en gardant la même mensualité (le crédit se termine plus tôt). Un crédit immobilier peut prévoir des indemnités de
        remboursement anticipé (au plus 6 mois d&apos;intérêts et 3 % du capital remboursé) : vérifie ton contrat.
      </p>
    </Panel>
  );
}

export default function DebtsPage() {
  const currentMonth = useSyncExternalStore(noSubscribe, readMonth, () => null);
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [income, setIncome] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState<number | null>(100);
  const [draft, setDraft] = useState<{ name: string; principal: number | null; rate: number | null; monthly: number | null } | null>(null);

  useEffect(() => {
    if (!currentMonth) return;
    let cancelled = false;
    (async () => {
      const [d, l] = await Promise.all([fetchDebts(), fetchLinesRange(shiftMonth(currentMonth, -12), currentMonth)]);
      if (cancelled) return;
      const err = d.error ?? l.error;
      setError(err ? describeDbError(err.message) : null);
      setDebts(d.debts);
      setIncome(snapshot(l.lines, currentMonth).income);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMonth]);

  function report(err: { message: string } | null) {
    if (err) setError(describeDbError(err.message));
  }

  async function change(debt: Debt, changes: Partial<Debt>) {
    setDebts((ds) => ds!.map((d) => (d.id === debt.id ? { ...d, ...changes } : d)));
    report(await updateDebt(debt.id, changes));
  }

  async function create() {
    if (!draft?.name.trim() || !draft.principal || !draft.monthly) return;
    const { debt, error: err } = await addDebt({
      name: draft.name.trim(),
      principal: draft.principal,
      annual_rate: (draft.rate ?? 0) / 100,
      monthly: draft.monthly
    });
    report(err);
    if (debt) setDebts((ds) => [...(ds ?? []), debt]);
    setDraft(null);
  }

  const list = debts ?? [];
  const total = list.reduce((s, d) => s + d.principal, 0);
  const monthly = list.reduce((s, d) => s + d.monthly, 0);
  const inputs = list.map((d) => ({ id: d.id, name: d.name, principal: d.principal, rate: d.annual_rate, monthly: d.monthly }));
  const base = list.length > 1 ? simulateDebts(inputs, 0, 'avalanche') : null;
  const avalanche = list.length > 1 ? simulateDebts(inputs, extra ?? 0, 'avalanche') : null;
  const snowball = list.length > 1 ? simulateDebts(inputs, extra ?? 0, 'snowball') : null;

  return (
    <FinancePage header={<FinanceHeader subtitle="crédits · dettes" />}>
      <ErrorNote message={error} />

      {list.length > 0 && (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <SummaryTile label="Total dû" value={formatEuros(total)} color={FIN.rose} />
          <SummaryTile label="Par mois" value={formatEuros(monthly)} color={FIN.navy} />
          <SummaryTile
            label="Endettement"
            value={income > 0 ? pct(monthly / income) : '—'}
            color={income > 0 && monthly / income > 0.35 ? FIN.rose : FIN.sage}
            note="max. conseillé 35 %"
          />
        </div>
      )}

      <Panel title="Tes crédits" subtitle="Crédit immobilier, auto, conso, dette envers un proche… Le capital restant dû figure sur ton tableau d'amortissement ou ton espace client.">
        {debts === null ? (
          <p className="text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
            Chargement…
          </p>
        ) : (
          list.map((d) => (
            <DebtCard
              key={d.id}
              debt={d}
              onChange={(c) => change(d, c)}
              onDelete={async () => {
                setDebts((ds) => ds!.filter((x) => x.id !== d.id));
                report(await deleteDebt(d.id));
              }}
            />
          ))
        )}
        {draft ? (
          <div className="mt-3 rounded-sm border px-3 py-3" style={{ borderColor: FIN.gold }}>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Nom
              </span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Crédit auto"
                className="rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
                style={{ borderColor: FIN.line }}
              />
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <NumberField label="Capital dû" value={draft.principal} onChange={(n) => setDraft({ ...draft, principal: n })} />
              <NumberField label="Taux" unit="%" value={draft.rate} onChange={(n) => setDraft({ ...draft, rate: n })} />
              <NumberField label="Mensualité" value={draft.monthly} onChange={(n) => setDraft({ ...draft, monthly: n })} />
            </div>
            <div className="mt-2 flex gap-2">
              <FinButton onClick={create} disabled={!draft.name.trim() || !draft.principal || !draft.monthly}>
                Ajouter
              </FinButton>
              <FinButton outline onClick={() => setDraft(null)}>
                Annuler
              </FinButton>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <FinButton outline onClick={() => setDraft({ name: '', principal: null, rate: null, monthly: null })}>
              + Ajouter un crédit
            </FinButton>
          </div>
        )}
      </Panel>

      {base && avalanche && snowball && (
        <Panel title="Quelle dette d'abord ?" subtitle={notion('avalanche').text}>
          <NumberField label="Je peux ajouter chaque mois" value={extra} onChange={setExtra} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              { title: 'Avalanche', sub: 'taux le plus élevé d’abord', r: avalanche },
              { title: 'Boule de neige', sub: 'plus petite dette d’abord', r: snowball }
            ].map(({ title, sub, r }) => (
              <div key={title} className="rounded-sm border px-3 py-2" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
                <p className="text-[13px] font-bold">{title}</p>
                <p className="text-[10px]" style={{ color: FIN.slate }}>
                  {sub}
                </p>
                <p className="mt-2 text-[11px]">
                  Libre de dettes en <b>{monthsFromNow(r.months)}</b>
                </p>
                <p className="text-[11px]">
                  Intérêts : <b style={{ color: FIN.rose }}>{formatEuros(r.interest)}</b>
                </p>
                <ol className="mt-1 list-decimal pl-4 text-[10px]" style={{ color: FIN.slate }}>
                  {r.order.map((o) => (
                    <li key={o.name}>
                      {o.name} · {monthsFromNow(o.month)}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed">
            Sans effort supplémentaire : fin en {monthsFromNow(base.months)}, {formatEuros(base.interest)} d&apos;intérêts.
            {(extra ?? 0) > 0 && (
              <>
                {' '}
                Avec {formatEuros(extra ?? 0)} de plus par mois, tu économises jusqu&apos;à{' '}
                <b style={{ color: FIN.sage }}>{formatEuros(base.interest - Math.min(avalanche.interest, snowball.interest))}</b> et gagnes{' '}
                {durationLabel(base.months - Math.min(avalanche.months, snowball.months))}.
              </>
            )}
          </p>
        </Panel>
      )}

      {list.length > 0 && <EarlyRepayment debts={list} />}
    </FinancePage>
  );
}
