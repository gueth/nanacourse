import { supabase } from '@/lib/supabase';
import { monthKey, shiftMonth } from '@/lib/finance';
import { saveIncomePlan, type IncomePart, type IncomePlan } from '@/lib/budget';
import { ANNUAL_GROUP_ID, CATEGORIES, categoryGroups, groupMembers, summarize, type Transaction } from '@/lib/transactions';

// Répartition du revenu, mois par mois (Finances > Budget et Finances > Gestion).
//  - La répartition par défaut (table income_plan) vaut pour le mois en cours et les suivants ; on la choisit dans Gestion.
//  - Un mois passé garde la sienne (table month_plans, supabase/month_plans.sql) : quand la répartition par défaut change,
//    les mois passés qui n'en avaient pas encore reçoivent l'ancienne. On peut aussi la retoucher depuis Budget.
//  - Chaque partie rassemble des grandes catégories ou catégories de dépenses ; la partie « épargne » est ce qui reste
//    des revenus du mois. La comparaison avec ce que disent les relevés n'est qu'indicative : elle ne compte nulle part
//    (ni dans le budget du mois, ni dans la santé financière).

export type MonthPlan = { month: string; parts: IncomePart[] };

export async function fetchMonthPlans() {
  const { data, error } = await supabase.from('month_plans').select('month, parts');
  // Table absente (script pas encore lancé) : chaque mois suit la répartition par défaut
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { monthPlans: [] as MonthPlan[], error: null };
  return { monthPlans: ((data as MonthPlan[]) ?? []).filter((m) => Array.isArray(m.parts)), error };
}

// Répartition d'un mois : la sienne s'il en a une, sinon la répartition par défaut
export const ownPlan = (month: string, monthPlans: MonthPlan[]) => monthPlans.find((m) => m.month === month) ?? null;
export const partsFor = (month: string, plan: IncomePlan, monthPlans: MonthPlan[]) => ownPlan(month, monthPlans)?.parts ?? plan.parts;

export async function saveMonthPlan(month: string, parts: IncomePart[]) {
  const { error } = await supabase.from('month_plans').upsert({ month, parts, updated_at: new Date().toISOString() }, { onConflict: 'month' });
  return error;
}

// Nouvelle répartition par défaut : avant de l'enregistrer, les mois passés (depuis la première opération) qui n'ont pas
// la leur gardent l'ancienne. Sans la table month_plans, rien n'est retenu et les mois passés suivent le changement.
export async function saveDefaultRepartition(previous: IncomePart[], next: IncomePlan) {
  const current = monthKey(new Date());
  const { data } = await supabase.from('bank_transactions').select('date').order('date').limit(1);
  const first = (data as { date: string }[] | null)?.[0]?.date.slice(0, 7);
  if (first && first < current) {
    const rows = [];
    for (let month = first; month < current; month = shiftMonth(month, 1)) rows.push({ month, parts: previous });
    await supabase.from('month_plans').upsert(rows, { onConflict: 'month', ignoreDuplicates: true });
  }
  return saveIncomePlan(next);
}

// --- Ce que chaque partie peut rassembler ---

// Poste de dépenses : une grande catégorie (« groupe:<id> »), ou une catégorie qui n'est dans aucune grande catégorie.
// essential : dépense indispensable (rangée par défaut dans « Charges »), sinon dans « Investissement personnel »
export type ExpenseTarget = { id: string; label: string; categories: string[]; essential: boolean };

const isExpense = (c: (typeof CATEGORIES)[number]) => c.kind !== 'income' && c.kind !== 'transfer';

// À appeler une fois les catégories chargées (useCategories)
export function expenseTargets(): ExpenseTarget[] {
  const groups = categoryGroups().filter((g) => g.kind === 'expense');
  const grouped = groups.map((g) => {
    const members = groupMembers(g.id).filter(isExpense);
    return {
      id: `groupe:${g.id}`,
      label: g.label,
      categories: members.map((c) => c.id),
      // Dépenses annuelles (assurance, impôts...) : des charges ; sinon, la majorité de ses catégories décide
      essential: g.id === ANNUAL_GROUP_ID || members.filter((c) => c.essential).length * 2 > members.length
    };
  });
  const loose = CATEGORIES.filter((c) => isExpense(c) && (!c.group || !groups.some((g) => g.id === c.group))).map((c) => ({
    id: c.id,
    label: c.label,
    categories: [c.id],
    essential: !!c.essential
  }));
  return [...grouped, ...loose];
}

// Postes d'une partie : ceux choisis, ou par défaut les dépenses indispensables pour « charges » et les autres pour « plaisirs »
export function targetsOfPart(part: IncomePart, all: ExpenseTarget[]) {
  if (part.savings) return [];
  if (part.targets) return part.targets;
  if (part.id === 'charges') return all.filter((t) => t.essential).map((t) => t.id);
  if (part.id === 'plaisirs') return all.filter((t) => !t.essential).map((t) => t.id);
  return [];
}

// Chaque poste n'appartient qu'à une partie (la première qui le prend)
export function assignTargets(parts: IncomePart[], all: ExpenseTarget[]) {
  const owner = new Map<string, string>();
  for (const p of parts) for (const t of targetsOfPart(p, all)) if (!owner.has(t) && all.some((x) => x.id === t)) owner.set(t, p.id);
  return owner;
}

// --- Vérification d'un mois (à titre indicatif) ---

export type RepartitionRow = { part: IncomePart; goal: number; actual: number; share: number | null; targets: ExpenseTarget[] };

// Revenus du mois, et pour chaque partie : la somme voulue (pourcentage des revenus), ce que disent les relevés et la part
// des revenus que cela représente ; unassigned : dépenses des postes rangés dans aucune partie
export function repartitionCheck(parts: IncomePart[], monthTx: Transaction[]) {
  // Épargne : la règle de lib/savingsRule (entrées − entrées écartées, aides… − sorties)
  const { income, savings, byCategory } = summarize(monthTx);
  const all = expenseTargets();
  const owner = assignTargets(parts, all);
  const spentOn = (t: ExpenseTarget) => t.categories.reduce((s, c) => s + (byCategory.get(c) ?? 0), 0);
  const rows: RepartitionRow[] = parts.map((part) => {
    const targets = all.filter((t) => owner.get(t.id) === part.id);
    const actual = part.savings ? savings : targets.reduce((s, t) => s + spentOn(t), 0);
    return { part, goal: (income * part.pct) / 100, actual, share: income > 0 ? actual / income : null, targets };
  });
  const unassignedTargets = all.filter((t) => !owner.has(t.id) && spentOn(t) > 0);
  const unassigned = unassignedTargets.reduce((s, t) => s + spentOn(t), 0);
  return { income, rows, unassigned, unassignedTargets };
}

// --- Limites par défaut d'un mois selon sa couleur (Paramètres > Finances) ---

// Grandes catégories de chaque partie (hors épargne et dépenses annuelles, dont la limite vient de leur montant)
export function groupsByPart(parts: IncomePart[]) {
  const all = expenseTargets();
  const owner = assignTargets(parts, all);
  return parts
    .filter((p) => !p.savings)
    .map((part) => ({
      part,
      groups: all
        .filter((t) => owner.get(t.id) === part.id && t.id.startsWith('groupe:') && t.id !== `groupe:${ANNUAL_GROUP_ID}`)
        .map((t) => ({ id: t.id.slice('groupe:'.length), label: t.label }))
    }))
    .filter((x) => x.groups.length > 0);
}

// Limite de chaque grande catégorie (« groupe:<id> ») : revenus du mois × part de sa partie × son pourcentage de la partie.
// Par exemple Charges à 40 % et Courses à 30 % des charges : 12 % des revenus. null : pas de budgets pour cette couleur
export function colorLimits(parts: IncomePart[], pcts: Record<string, number> | undefined, income: number): Map<string, number> | null {
  if (!pcts) return null;
  const limits = new Map<string, number>();
  for (const { part, groups } of groupsByPart(parts))
    for (const g of groups) limits.set(`groupe:${g.id}`, Math.round((income * part.pct * Number(pcts[g.id] ?? 0)) / 100) / 100);
  return limits;
}

// Range un poste (« groupe:<id> » ou catégorie) dans une partie de la répartition (null : dans aucune).
// Les parties qui suivaient leur rangement par défaut reçoivent leur liste explicite, sans ce poste.
export function moveTarget(parts: IncomePart[], all: ExpenseTarget[], target: string, partId: string | null): IncomePart[] {
  return parts.map((p) => {
    if (p.savings) return p;
    const targets = targetsOfPart(p, all).filter((t) => t !== target);
    return { ...p, targets: p.id === partId ? [...targets, target] : targets };
  });
}
