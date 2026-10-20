'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { fetchLinesRange, formatEuros, monthKey, monthLabel, shiftMonth, snapshot } from '@/lib/finance';
import {
  addInvestment,
  deleteInvestment,
  describeDbError,
  fetchInvestments,
  INVESTMENT_KINDS,
  investmentKind,
  reportInvestments,
  updateInvestment,
  type Investment,
  type InvestmentKind
} from '@/lib/financePlans';
import { annualizedReturn, BAD_YEAR_DROP, feesCost, realRate } from '@/lib/financeCalc';
import { notion } from '@/lib/financeGlossary';
import { Certainty, ErrorNote, FIN, FinanceHeader, FinancePage, FinButton, Meter, NumberField, Panel, SummaryTile } from '@/components/finance/FinanceParts';

const noSubscribe = () => () => {};
const readToday = () => new Date().toISOString().slice(0, 10);
const INFLATION = 0.02; // hypothèse d'inflation annuelle, pour le rendement réel
const FEES_YEARS = 10; // durée sur laquelle on montre le coût des frais
const HIGH_FEES = 0.01;

const pct = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${(n * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits })} %`;
const ratePct = (r: number) => `${(r * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const toPercent = (r: number) => Math.round(r * 10000) / 100;
const yearsBetween = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 24 * 3600 * 1000);
const shortDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

// Groupes de risque : sécurisé (capital garanti ou presque), équilibré, dynamique
const RISK_GROUPS = [
  { title: 'Sécurisé', range: [1, 2], color: FIN.sage },
  { title: 'Équilibré', range: [3, 4], color: FIN.gold },
  { title: 'Dynamique', range: [5, 7], color: FIN.rose }
];
const riskGroup = (risk: number) => RISK_GROUPS.find((g) => risk >= g.range[0] && risk <= g.range[1])!;

// Échelle de risque 1 à 7, la case du placement remplie
function RiskScale({ risk }: { risk: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`Risque ${risk} sur 7`}>
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <span
          key={n}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] text-[8px]"
          style={n === risk ? { backgroundColor: riskGroup(n).color, color: '#fff' } : { backgroundColor: FIN.mist, color: FIN.slate }}
        >
          {n}
        </span>
      ))}
    </span>
  );
}

// Carte d'un placement : gains, frais et risque, puis ses réglages
function InvestmentCard({ inv, today, onChange, onDelete }: { inv: Investment; today: string; onChange: (c: Partial<Investment>) => void; onDelete: () => void }) {
  const kind = investmentKind(inv.kind);
  const gain = inv.value - inv.invested;
  const years = inv.opened_on ? yearsBetween(inv.opened_on, today) : 0;
  const yearly = annualizedReturn(inv.invested, inv.value, years);
  const netRate = inv.expected_rate - inv.fees;
  const real = realRate(netRate, INFLATION);
  const rows: [React.ReactNode, string, string, string?][] = [
    ['Versé', formatEuros(inv.invested), 'Tes versements, retraits déduits'],
    ['Valeur actuelle', formatEuros(inv.value), `Mise à jour le ${shortDate(inv.updated_at)}`],
    [
      <>Gain ou perte <Certainty /></>,
      `${formatEuros(gain)}${inv.invested > 0 ? ` (${pct(gain / inv.invested)})` : ''}`,
      'Ce que le placement a rapporté jusqu’ici',
      gain >= 0 ? FIN.sage : FIN.rose
    ],
    [
      <>Rendement par an <Certainty estimate /></>,
      yearly === null ? '—' : pct(yearly),
      yearly === null ? 'Indique la date d’ouverture (plus d’un an) pour le calculer' : 'Moyenne depuis l’ouverture ; un peu sous-estimée si tu as versé petit à petit',
      yearly === null ? undefined : yearly >= 0 ? FIN.sage : FIN.rose
    ],
    ['Frais par an', `${formatEuros(inv.value * inv.fees)} (${ratePct(inv.fees)})`, 'Prélevés que le placement gagne ou perde', inv.fees > HIGH_FEES ? FIN.rose : undefined],
    [
      <>Frais sur {FEES_YEARS} ans <Certainty estimate /></>,
      formatEuros(feesCost(inv.value, inv.expected_rate, inv.fees, FEES_YEARS)),
      'Manque à gagner si rien ne change'
    ],
    [
      <>Après frais et inflation <Certainty estimate /></>,
      pct(real),
      `Rendement espéré de ${ratePct(inv.expected_rate)}, moins les frais et ${ratePct(INFLATION)} d’inflation`,
      real < 0 ? FIN.rose : FIN.sage
    ]
  ];

  return (
    <div className="mt-3 rounded-sm border px-3 py-3" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-bold">{inv.name}</p>
          <p className="text-[10px]" style={{ color: FIN.slate }}>
            {kind.label}
          </p>
        </div>
        <button type="button" onClick={onDelete} aria-label={`Supprimer ${inv.name}`} className="opacity-50 hover:opacity-100" style={{ color: FIN.rose }}>
          <X size={14} />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px]" style={{ color: FIN.slate }}>
        Risque <RiskScale risk={inv.risk} /> {riskGroup(inv.risk).title.toLowerCase()}
      </div>
      <table className="mt-1 w-full text-[11px]">
        <tbody>
          {rows.map(([label, value, help, color], i) => (
            <tr key={i} className="border-b last:border-0" style={{ borderColor: FIN.mist }}>
              <td className="py-1 pr-2">
                <span className="flex items-center gap-1.5">{label}</span>
                <span className="block text-[9px]" style={{ color: FIN.slate }}>
                  {help}
                </span>
              </td>
              <td className="whitespace-nowrap py-1 text-right font-bold" style={{ color: color ?? FIN.navy }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {real < 0 && (
        <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.rose }}>
          Une fois les frais et l&apos;inflation retirés, ce placement fait perdre du pouvoir d&apos;achat.
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField label="Versé" value={inv.invested} onChange={(n) => onChange({ invested: n ?? 0 })} />
        <NumberField label="Valeur actuelle" value={inv.value} onChange={(n) => onChange({ value: n ?? 0, updated_at: new Date().toISOString() })} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberField label="Frais / an" unit="%" value={toPercent(inv.fees)} onChange={(n) => onChange({ fees: (n ?? 0) / 100 })} />
        <NumberField label="Rendement espéré" unit="%" value={toPercent(inv.expected_rate)} onChange={(n) => onChange({ expected_rate: (n ?? 0) / 100 })} />
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
            Risque
          </span>
          <select
            value={inv.risk}
            onChange={(e) => onChange({ risk: Number(e.target.value) })}
            className="rounded-sm border bg-white px-1 py-1.5 text-[12px]"
            style={{ borderColor: FIN.line }}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n} / 7
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
          Ouvert en
        </span>
        <input
          type="month"
          value={inv.opened_on?.slice(0, 7) ?? ''}
          onChange={(e) => onChange({ opened_on: e.target.value ? `${e.target.value}-01` : null })}
          className="rounded-sm border bg-white px-2 py-1 text-[12px]"
          style={{ borderColor: FIN.line }}
        />
      </label>
    </div>
  );
}

type Draft = { name: string; kind: InvestmentKind; invested: number | null; value: number | null; opened: string };

export default function InvestmentsPage() {
  const today = useSyncExternalStore(noSubscribe, readToday, () => null);
  const currentMonth = today ? monthKey(new Date(today)) : null;
  const [investments, setInvestments] = useState<Investment[] | null>(null);
  const [essentials, setEssentials] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!currentMonth) return;
    let cancelled = false;
    (async () => {
      const [i, l] = await Promise.all([fetchInvestments(), fetchLinesRange(shiftMonth(currentMonth, -12), currentMonth)]);
      if (cancelled) return;
      const err = i.error ?? l.error;
      setError(err ? describeDbError(err.message) : null);
      setInvestments(i.investments);
      setEssentials(snapshot(l.lines, currentMonth).essentials);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMonth]);

  function report(err: { message: string } | null) {
    if (err) setError(describeDbError(err.message));
  }

  async function change(inv: Investment, changes: Partial<Investment>) {
    setInvestments((list) => list!.map((x) => (x.id === inv.id ? { ...x, ...changes } : x)));
    report(await updateInvestment(inv.id, changes));
  }

  async function create() {
    if (!draft?.name.trim() || draft.value === null) return;
    const kind = investmentKind(draft.kind);
    const { investment, error: err } = await addInvestment({
      name: draft.name.trim(),
      kind: draft.kind,
      invested: draft.invested ?? draft.value,
      value: draft.value,
      fees: kind.fees,
      expected_rate: kind.rate,
      risk: kind.risk,
      opened_on: draft.opened ? `${draft.opened}-01` : null
    });
    report(err);
    if (investment) setInvestments((list) => [...(list ?? []), investment]);
    setDraft(null);
  }

  async function toBalanceSheet() {
    if (!currentMonth || !investments) return;
    const err = await reportInvestments(currentMonth, investments);
    report(err);
    if (!err) setNotice(`Valeurs reportées dans le bilan de ${monthLabel(currentMonth)}.`);
  }

  const list = investments ?? [];
  const value = list.reduce((s, i) => s + i.value, 0);
  const invested = list.reduce((s, i) => s + i.invested, 0);
  const gain = value - invested;
  const yearlyFees = list.reduce((s, i) => s + i.value * i.fees, 0);
  const fees10 = list.reduce((s, i) => s + feesCost(i.value, i.expected_rate, i.fees, FEES_YEARS), 0);
  const expensive = list.filter((i) => i.fees > HIGH_FEES);

  // Risque du portefeuille, pondéré par la valeur de chaque placement
  const groups = RISK_GROUPS.map((g) => ({ ...g, amount: list.filter((i) => riskGroup(i.risk) === g).reduce((s, i) => s + i.value, 0) }));
  const avgRisk = value > 0 ? list.reduce((s, i) => s + i.risk * i.value, 0) / value : 0;
  const badYear = list.reduce((s, i) => s + i.value * BAD_YEAR_DROP[i.risk], 0);
  const available = list.filter((i) => i.kind === 'livret').reduce((s, i) => s + i.value, 0);
  const reserveTarget = essentials * 3;
  const risky = groups[1].amount + groups[2].amount;
  const biggest = [...list].sort((a, b) => b.value - a.value)[0];

  const advice: { tone: 'warn' | 'good'; text: string }[] = [];
  if (risky > 0 && reserveTarget > 0 && available < reserveTarget)
    advice.push({
      tone: 'warn',
      text: `Ta réserve disponible (${formatEuros(available)} sur tes livrets) couvre moins de 3 mois de dépenses indispensables (${formatEuros(reserveTarget)}). En cas d'imprévu, tu risquerais de devoir vendre un placement au mauvais moment : complète d'abord ta réserve.`
    });
  if (biggest && list.length > 1 && biggest.risk >= 3 && biggest.value / value > 0.6)
    advice.push({ tone: 'warn', text: `« ${biggest.name} » représente ${Math.round((biggest.value / value) * 100)} % de tes placements. ${notion('diversification').text}` });
  if (groups[2].amount / (value || 1) > 0.5)
    advice.push({ tone: 'warn', text: `Plus de la moitié de tes placements est dynamique : garde-les seulement pour des projets à plus de 8 ans.` });
  if (value > 0 && groups[0].amount === value)
    advice.push({
      tone: 'good',
      text: `Tout est en sécurité. Pour un projet lointain (plus de 8 ans), une petite part en actions diversifiées pourrait faire mieux que l'inflation, au prix de variations.`
    });

  return (
    <FinancePage header={<FinanceHeader subtitle="placements · rendement" />}>
      <ErrorNote message={error} />

      {list.length > 0 && (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <SummaryTile label="Valeur" value={formatEuros(value)} color={FIN.navy} />
          <SummaryTile label="Gain" value={formatEuros(gain)} color={gain >= 0 ? FIN.sage : FIN.rose} note={invested > 0 ? pct(gain / invested) : undefined} />
          <SummaryTile label="Frais / an" value={formatEuros(yearlyFees)} color={FIN.rose} note={value > 0 ? ratePct(yearlyFees / value) : undefined} />
        </div>
      )}

      <Panel
        title="Tes placements"
        subtitle="Livrets, assurance-vie, PEA, PER… La valeur, les versements et les frais figurent sur ton relevé annuel ou ton espace client. Mets à jour la valeur de temps en temps."
      >
        {investments === null ? (
          <p className="text-[11px] uppercase tracking-[0.3em]" style={{ color: FIN.slate }}>
            Chargement…
          </p>
        ) : (
          today &&
          list.map((inv) => (
            <InvestmentCard
              key={inv.id}
              inv={inv}
              today={today}
              onChange={(c) => change(inv, c)}
              onDelete={async () => {
                setInvestments((l) => l!.filter((x) => x.id !== inv.id));
                report(await deleteInvestment(inv.id));
              }}
            />
          ))
        )}
        {draft ? (
          <div className="mt-3 rounded-sm border px-3 py-3" style={{ borderColor: FIN.gold }}>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Type
              </span>
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as InvestmentKind })}
                className="rounded-sm border bg-white px-1 py-1.5 text-[12px]"
                style={{ borderColor: FIN.line }}
              >
                {INVESTMENT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {investmentKind(draft.kind).help && (
              <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
                {investmentKind(draft.kind).help}
              </p>
            )}
            <label className="mt-2 flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Nom
              </span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Livret A"
                className="rounded-sm border bg-white px-2 py-1 text-[13px] outline-none"
                style={{ borderColor: FIN.line }}
              />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberField label="Versé" value={draft.invested} onChange={(n) => setDraft({ ...draft, invested: n })} />
              <NumberField label="Valeur actuelle" value={draft.value} onChange={(n) => setDraft({ ...draft, value: n })} />
            </div>
            <label className="mt-2 flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
                Ouvert en (facultatif)
              </span>
              <input
                type="month"
                value={draft.opened}
                onChange={(e) => setDraft({ ...draft, opened: e.target.value })}
                className="rounded-sm border bg-white px-2 py-1 text-[12px]"
                style={{ borderColor: FIN.line }}
              />
            </label>
            <p className="mt-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
              Frais, rendement espéré et risque sont pré-remplis selon le type : corrige-les ensuite d&apos;après ton contrat.
            </p>
            <div className="mt-2 flex gap-2">
              <FinButton onClick={create} disabled={!draft.name.trim() || draft.value === null}>
                Ajouter
              </FinButton>
              <FinButton outline onClick={() => setDraft(null)}>
                Annuler
              </FinButton>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <FinButton outline onClick={() => setDraft({ name: '', kind: 'livret', invested: null, value: null, opened: '' })}>
              + Ajouter un placement
            </FinButton>
            {list.length > 0 && <FinButton onClick={toBalanceSheet}>Reporter dans le bilan</FinButton>}
          </div>
        )}
        {notice && (
          <p className="mt-2 text-[11px]" style={{ color: FIN.sage }}>
            {notice}
          </p>
        )}
      </Panel>

      {list.length > 0 && (
        <Panel title="Ce que coûtent les frais" subtitle={notion('frais_placement').text}>
          <div className="text-[12px]">
            <div className="flex items-baseline justify-between py-1">
              <span className="flex items-center gap-1.5">
                Frais prélevés cette année <Certainty estimate />
              </span>
              <b style={{ color: FIN.rose }}>{formatEuros(yearlyFees)}</b>
            </div>
            <div className="flex items-baseline justify-between py-1">
              <span className="flex items-center gap-1.5">
                Manque à gagner sur {FEES_YEARS} ans <Certainty estimate />
              </span>
              <b style={{ color: FIN.rose }}>{formatEuros(fees10)}</b>
            </div>
          </div>
          <p className="mt-2 rounded-sm px-3 py-2 text-[12px] leading-relaxed" style={{ backgroundColor: FIN.mist }}>
            {expensive.length > 0
              ? `${expensive.map((i) => `« ${i.name} » (${ratePct(i.fees)})`).join(', ')} : plus de 1 % de frais par an. Compare avec un contrat en ligne ou des ETF, souvent 2 à 4 fois moins chers ; un transfert est parfois possible sans perdre l'antériorité fiscale.`
              : 'Tes frais restent raisonnables (1 % par an ou moins). Continue de les vérifier sur ton relevé annuel.'}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            Calcul sur la valeur actuelle, sans nouveaux versements, avec le rendement espéré de chaque placement. Les frais d&apos;entrée et
            d&apos;arbitrage ne sont pas comptés.
          </p>
        </Panel>
      )}

      {value > 0 && (
        <Panel title="Ton niveau de risque" subtitle={notion('risque').text}>
          <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ backgroundColor: FIN.line }}>
            {groups.map((g) => (
              <div key={g.title} style={{ width: `${(g.amount / value) * 100}%`, backgroundColor: g.color }} />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: g.color }}>
                  {g.title}
                </p>
                <p className="text-[12px] font-bold">{Math.round((g.amount / value) * 100)} %</p>
                <p className="text-[10px]" style={{ color: FIN.slate }}>
                  {formatEuros(g.amount)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[12px]">
            <div className="flex items-center justify-between py-1">
              <span>Risque moyen</span>
              <span className="flex items-center gap-2">
                <b>{avgRisk.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / 7</b>
              </span>
            </div>
            <Meter value={avgRisk / 7} color={riskGroup(Math.round(avgRisk) || 1).color} />
            <div className="mt-2 flex items-baseline justify-between py-1">
              <span className="flex items-center gap-1.5">
                Baisse possible une mauvaise année <Certainty estimate />
              </span>
              <b style={{ color: FIN.rose }}>{badYear > 0 ? `−${formatEuros(badYear)}` : 'aucune'}</b>
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
              Ordre de grandeur selon le niveau de risque de chaque placement. Une baisse n&apos;est une perte que si tu vends à ce moment-là.
            </p>
          </div>
          {advice.map((a, i) => (
            <p
              key={i}
              className="mt-2 rounded-sm border-l-2 px-3 py-2 text-[12px] leading-relaxed"
              style={{ backgroundColor: FIN.mist, borderColor: a.tone === 'warn' ? FIN.rose : FIN.sage }}
            >
              {a.text}
            </p>
          ))}
        </Panel>
      )}

      <p className="mt-4 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
        Ces chiffres t&apos;aident à comprendre tes placements ; ce ne sont pas des conseils en investissement. Les rendements passés ne
        préjugent pas des rendements futurs.
      </p>
    </FinancePage>
  );
}
