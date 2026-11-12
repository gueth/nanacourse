'use client';

import { formatEuros } from '@/lib/finance';
import { useIncomePlan } from '@/lib/coursesQueries';
import { useCategoryLimits, useMonthBudgets, useMonthPlans } from '@/lib/financeQueries';
import { partsFor, repartitionCheck } from '@/lib/repartition';
import { useFinanceTone } from '@/lib/health';
import { useColorLimits } from '@/lib/colorBudgets';
import { stateParts, useHealthSettings } from '@/lib/healthSettings';
import { budgetOfMonth } from '@/lib/monthBudget';
import { annualPlans, monthOf, type Transaction } from '@/lib/transactions';
import { FIN, Panel } from '@/components/finance/FinanceParts';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEuros(Math.abs(n))}`;

// Petit chiffre clé : intitulé, valeur, précision
function Figure({ label, value, note, color = FIN.navy }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <div className="rounded-sm border px-2 py-2 text-center" style={{ backgroundColor: FIN.paper, borderColor: FIN.line }}>
      <p className="text-[8px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-bold" style={{ color }}>
        {value}
      </p>
      {note && (
        <p className="text-[9px] leading-tight" style={{ color: FIN.slate }}>
          {note}
        </p>
      )}
    </div>
  );
}

// « En bref » du Budget, pour le mois affiché :
//  - le total des charges (partie « Charges » de la répartition) et la part du budget utilisée ;
//  - le nombre d'opérations des catégories rangées dans les charges (Répartition du revenu) ;
//  - la répartition effective : comment l'argent du mois a été utilisé, partagé entre les parties de la répartition
//    (charges, investissement personnel, épargne) qui font 100 % à elles trois. L'épargne est ce qui reste des revenus
//    une fois les sorties payées, 0 % s'il ne reste rien (jamais négative).
// "transactions" : opérations du mois affiché et des mois d'avant, sans celles qui vont au bilan (créances, dettes…).
export function KeyFigures({ period, transactions }: { period: string; transactions: Transaction[] }) {
  const budgets = useCategoryLimits().data;
  const monthBudgets = useMonthBudgets().data;
  const plan = useIncomePlan().data;
  const monthPlans = useMonthPlans().data;
  // Couleur du mois affiché (la page suit son mois : useViewedMonth) et sa répartition propre, s'il y en a une
  const { state } = useFinanceTone();
  const healthSettings = useHealthSettings().data;
  const monthTx = transactions.filter((t) => monthOf(t.date) === period);

  // Limites du mois : les siennes, sinon celles de sa couleur (Paramètres > Finances), sinon les limites générales
  const colorLimits = useColorLimits(period, monthTx);
  const budget = budgets && monthBudgets ? budgetOfMonth(period, monthTx, budgets, annualPlans(), monthBudgets, colorLimits) : null;

  // Répartition effective du mois, et opérations des charges (sorties des catégories de la partie « charges »).
  // Hors calcul : les virements entre mes comptes (écartés par summarize) et les catégories reliées au bilan (déjà
  // retirées de "transactions" par la page)
  const repartitionTx = monthTx;
  // Répartition voulue : celle de la couleur du mois (Paramètres > Finances), sinon celle du mois, sinon celle par défaut
  const ownOfState = plan ? stateParts(plan.parts, healthSettings, state) : null;
  const check = plan && monthPlans ? repartitionCheck(ownOfState ?? partsFor(period, plan, monthPlans), repartitionTx) : null;
  const chargesRow = check?.rows.find((r) => r.part.id === 'charges') ?? null;
  const chargeCategories = new Set(chargesRow?.targets.flatMap((t) => t.categories) ?? []);
  const chargeOps = monthTx.filter((t) => t.amount < 0 && chargeCategories.has(t.category)).length;

  // Montant de chaque partie (l'épargne à 0 si les sorties dépassent les revenus), et sa part du total, en pourcentages
  // entiers qui font exactement 100 (les arrondis sont répartis sur les plus grands restes)
  const used = check?.rows.map((r) => ({ ...r, amount: Math.max(0, r.actual) })) ?? [];
  const total = used.reduce((sum, r) => sum + r.amount, 0);
  const exact = used.map((r) => (total > 0 ? (r.amount / total) * 100 : 0));
  const pcts = exact.map(Math.floor);
  const missing = total > 0 ? 100 - pcts.reduce((a, b) => a + b, 0) : 0;
  exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest)
    .slice(0, missing)
    .forEach(({ i }) => pcts[i]++);

  return (
    <Panel title="En bref">
      <div className="grid grid-cols-3 gap-1.5">
        {/* Total des charges : les sorties des catégories rangées dans la partie « Charges » (comme les opérations à droite) */}
        <Figure label="Total des charges" value={chargesRow ? formatEuros(chargesRow.actual) : '—'} note="ce mois-ci" />

        <Figure
          label="Budget utilisé"
          // + ce qui dépasse le budget, − ce qu'il en reste ; en dessous, juste « dépassement » ou « excédent »
          value={!budget || budget.allowed === 0 ? '—' : signed(budget.spent - budget.allowed)}
          note={!budget || budget.allowed === 0 || budget.spent === budget.allowed ? undefined : budget.spent > budget.allowed ? 'dépassement' : 'excédent'}
          color={!budget || budget.allowed === 0 ? FIN.slate : budget.spent > budget.allowed ? FIN.rose : budget.spent >= budget.allowed * 0.8 ? FIN.gold : FIN.sage}
        />
        <Figure label="Opérations" value={check ? String(chargeOps) : '—'} note="en charges" />
      </div>

      {/* Répartition effective : comment l'argent du mois a été utilisé (les parties font 100 % à elles trois), face à la part voulue */}
      {check && (
        <>
          <p className="mb-1 mt-3 text-center text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
            Distribution effective des possessions
          </p>
          {/* Aucune opération ce mois-ci : les mêmes cartes, avec un tiret à la place du pourcentage */}
          {total <= 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {used.map(({ part }) => (
                <Figure key={part.id} label={part.label} value="—" note={`${part.pct} % voulu`} color={FIN.slate} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {used.map(({ part }, i) => {
                const pct = pcts[i];
                // Épargne : verte si elle atteint au moins la part voulue ; les autres parties : vertes si elles n'en dépassent pas la part
                const ok = part.savings ? pct >= part.pct : pct <= part.pct;
                const color = ok ? FIN.sage : FIN.rose;
                return <Figure key={part.id} label={part.label} value={`${pct} %`} note={`${part.pct} % voulu`} color={color} />;
              })}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
