import { supabase } from '@/lib/supabase';

// Budgets de courses (Profil > Budget) : on peut en avoir plusieurs (ex : « Courses de la semaine », « Gros
// plein du mois »), chacun avec sa période. Chaque liste de courses et chaque reçu scanné est rattaché à un budget :
// à la validation, son prix est déduit de ce qui reste sur la période en cours de ce budget.
// Tables Supabase : "budget_settings" (un budget par ligne) et "expenses" (les dépenses) ; voir supabase/shopping_budgets.sql.

export type PeriodUnit = 'day' | 'week' | 'month';

// --- Répartition du revenu (40/40/20 au départ) ---
// Le revenu du mois est divisé en parties (lignes de répartition), chacune avec son pourcentage. Au départ :
//  - charges : tout ce qui est nécessaire (loyer, nourriture, abonnements...) ;
//  - investissement personnel : ce qu'on s'offre (sorties, cours de tennis...) ;
//  - épargne.
// On peut en ajouter, les renommer ou les supprimer (Finances > Gestion pour la répartition par défaut, Finances > Budget
// pour un mois passé). Chaque partie regroupe des grandes catégories ou catégories de dépenses (targets), sauf l'épargne
// (savings), qui est ce qui reste des revenus du mois. Voir lib/repartition : la vérification, mois par mois, n'est qu'indicative.
// Table Supabase "income_plan" (une seule ligne, parties dans la colonne "parts") ; voir supabase/shopping_budgets.sql.
export type BudgetPart = string; // identifiant d'une partie
// targets : « groupe:<id> » (grande catégorie) ou identifiant de catégorie ; absent : choix par défaut (lib/repartition)
export type IncomePart = { id: BudgetPart; label: string; hint?: string; pct: number; targets?: string[]; savings?: boolean };
export type IncomePlan = { income: number; parts: IncomePart[] };

export const DEFAULT_PARTS: IncomePart[] = [
  { id: 'charges', label: 'Charges', hint: 'Loyer, nourriture, abonnements…', pct: 40 },
  { id: 'plaisirs', label: 'Investissement personnel', hint: 'Sorties, cours de tennis…', pct: 40 },
  { id: 'epargne', label: 'Épargne', hint: 'Ce que tu mets de côté', pct: 20, savings: true }
];
export const DEFAULT_PLAN: IncomePlan = { income: 0, parts: DEFAULT_PARTS };

// Identifiant d'une nouvelle partie
export const newPartId = () => `partie-${Date.now().toString(36)}`;

type IncomePlanRow = { income: number; parts?: IncomePart[] | null; charges_pct?: number; plaisirs_pct?: number; epargne_pct?: number };

export async function fetchIncomePlan() {
  const { data, error } = await supabase.from('income_plan').select('*').eq('id', 1).maybeSingle();
  const row = data as IncomePlanRow | null;
  if (!row) return { plan: DEFAULT_PLAN, error };
  // Colonne "parts" pas encore remplie : les trois parties d'origine, avec leurs pourcentages enregistrés
  const legacy = { charges: row.charges_pct, plaisirs: row.plaisirs_pct, epargne: row.epargne_pct } as Record<string, number | undefined>;
  const parts =
    Array.isArray(row.parts) && row.parts.length > 0
      ? row.parts.map((p) => ({ ...p, pct: Number(p.pct) || 0 }))
      : DEFAULT_PARTS.map((p) => ({ ...p, pct: legacy[p.id] != null ? Number(legacy[p.id]) : p.pct }));
  // Ancienne répartition sans partie « épargne » marquée : celle d'identifiant « epargne » l'est
  if (!parts.some((p) => p.savings)) for (const p of parts) if (p.id === 'epargne') p.savings = true;
  return { plan: { income: Number(row.income), parts }, error };
}

// Enregistre la répartition par défaut (voir saveDefaultRepartition dans lib/repartition, qui garde celle des mois passés)
export async function saveIncomePlan(plan: IncomePlan) {
  const { error } = await supabase.from('income_plan').upsert({ id: 1, income: plan.income, parts: plan.parts, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  return error;
}

// Nombre de périodes d'un budget dans un mois (en moyenne) : 1 pour un budget au mois, ~4,35 pour une semaine...
const DAYS_PER_MONTH = 365.25 / 12;
export function periodsPerMonth(settings: Pick<BudgetSettings, 'period_value' | 'period_unit'>) {
  const n = Math.max(1, settings.period_value);
  return settings.period_unit === 'month' ? 1 / n : settings.period_unit === 'week' ? DAYS_PER_MONTH / (7 * n) : DAYS_PER_MONTH / n;
}

// Plafond par période d'un budget : son montant, ou son pourcentage de la limite mensuelle de sa catégorie des Finances
// (limit, voir categoryLimit), ramené à sa période. Sans limite connue, le montant enregistré.
export function ceilingFor(settings: BudgetSettings, limit: number | null) {
  if (settings.amount_mode !== 'percent' || limit === null) return Number(settings.amount) || 0;
  const monthly = (limit * (Number(settings.percent) || 0)) / 100;
  return Math.round((monthly / periodsPerMonth(settings)) * 100) / 100;
}

// Plus grand plafond par période d'un budget : la limite mensuelle de sa catégorie, ramenée à sa période
export const maxCeiling = (settings: Pick<BudgetSettings, 'period_value' | 'period_unit'>, limit: number) =>
  Math.floor((limit / periodsPerMonth(settings)) * 100) / 100;

// Limite mensuelle d'une catégorie des Finances : la sienne (Finances > Budget), sinon celle de sa grande catégorie
export type CategoryLimit = { limit: number; from: 'category' | 'group'; label?: string };
export function categoryLimit(
  category: string,
  limits: { category: string; monthly_limit: number }[],
  groupOf: (category: string) => { label: string; monthly_limit: number | null } | null
): CategoryLimit | null {
  const own = limits.find((b) => b.category === category);
  if (own) return { limit: Number(own.monthly_limit), from: 'category' };
  const group = groupOf(category);
  return group?.monthly_limit != null ? { limit: Number(group.monthly_limit), from: 'group', label: group.label } : null;
}

// Mêmes limites, lues directement dans Supabase (hors des pages Finances, qui gardent les catégories en mémoire)
async function fetchLimitOf() {
  const [budgets, settings, groups] = await Promise.all([
    supabase.from('budgets').select('category, monthly_limit'),
    supabase.from('category_settings').select('category, group_id'),
    supabase.from('category_groups').select('id, label, monthly_limit')
  ]);
  const limits = (budgets.data as { category: string; monthly_limit: number }[] | null) ?? [];
  const groupIds = new Map(((settings.data as { category: string; group_id: string | null }[] | null) ?? []).map((r) => [r.category, r.group_id]));
  const groupRows = (groups.data as { id: string; label: string; monthly_limit: number | null }[] | null) ?? [];
  return (category: string) => categoryLimit(category, limits, (c) => groupRows.find((g) => g.id === groupIds.get(c)) ?? null)?.limit ?? null;
}

export type BudgetSettings = {
  id?: string;
  name: string; // nom du budget (ex : « Courses de la semaine »)
  amount: number; // somme à ne pas dépasser sur une période (ex : 50 €)
  missing_margin: number; // marge de sécurité quand des articles n'ont pas de prix (ex : 10 € -> limite à 40 €)
  period_value: number; // durée de la période (ex : 2)...
  period_unit: PeriodUnit; // ...en jours, semaines ou mois
  start_date: string; // début de la première période (AAAA-MM-JJ) ; les suivantes s'enchaînent
  restarted_at?: string | null; // budget recommencé avant la fin de sa période : les dépenses d'avant ne comptent plus
  part?: BudgetPart | null; // partie du revenu dans laquelle il entre (charges par défaut)
  amount_mode?: 'euros' | 'percent'; // plafond en euros, ou en pourcentage de sa partie
  percent?: number | null; // pourcentage de la partie (plafond en pourcentage)
  category?: string | null; // catégorie des Finances de ces achats (« Courses » par défaut) : son plafond ne dépasse pas sa limite
};

// Catégorie des Finances d'un budget de courses : ses achats y sont classés à l'import des relevés, et son plafond
// (ramené au mois) ne peut pas dépasser la limite mensuelle de cette catégorie
export const SHOPPING_CATEGORY = 'courses';
export const shoppingCategoryOf = (settings: Pick<BudgetSettings, 'category'>) => settings.category || SHOPPING_CATEGORY;

// Catégories des Finances reliées à au moins un budget de courses (signalées dans Finances > Budget)
export async function fetchShoppingCategories() {
  const { data, error } = await supabase.from('budget_settings').select('*');
  return { categories: [...new Set(((data as BudgetSettings[]) ?? []).map(shoppingCategoryOf))], error };
}

// Une dépense : le prix d'une course validée ou d'un reçu scanné
export type Expense = { id: string; amount: number; label: string | null; spent_at: string; budget_id?: string | null };

export type BudgetState = {
  settings: BudgetSettings;
  period: { start: Date; end: Date }; // période en cours (fin exclue)
  expenses: Expense[]; // dépenses de la période en cours
  spent: number;
  remaining: number; // ce qu'on peut encore dépenser sur la période (jamais négatif)
};

// Date du jour au format AAAA-MM-JJ (heure locale)
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Réglages proposés pour un nouveau budget : 50 € par semaine, limite à 40 € si des prix manquent
export const newBudget = (): BudgetSettings => ({
  name: 'Courses',
  part: 'charges',
  amount_mode: 'euros',
  percent: null,
  amount: 50,
  missing_margin: 10,
  period_value: 1,
  period_unit: 'week',
  start_date: today()
});

// Période en cours : on part de la date de début et on enchaîne des périodes de même durée.
// Exemples : début le 1er, période de 2 jours -> 1er-2, 3-4, 5-6... ; période d'un mois, début le 15 -> 15/01-14/02, 15/02-14/03...
export function currentPeriod(settings: BudgetSettings, now = new Date()) {
  const [y, m, d] = settings.start_date.split('-').map(Number);
  const length = Math.max(1, settings.period_value);

  if (settings.period_unit === 'month') {
    // Nombre de mois entiers écoulés depuis le début (un mois n'est complet qu'une fois le jour de début atteint)
    let months = (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1));
    if (now.getDate() < d) months--;
    const index = Math.max(0, Math.floor(months / length));
    return { start: new Date(y, m - 1 + index * length, d), end: new Date(y, m - 1 + (index + 1) * length, d) };
  }

  const lengthDays = length * (settings.period_unit === 'week' ? 7 : 1);
  // Nombre de jours écoulés depuis le début (calcul en UTC pour ignorer les changements d'heure)
  const elapsedDays = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000);
  const index = Math.max(0, Math.floor(elapsedDays / lengthDays));
  return { start: new Date(y, m - 1, d + index * lengthDays), end: new Date(y, m - 1, d + (index + 1) * lengthDays) };
}

// Début effectif de la période : celui du calendrier, ou le moment où le budget a été recommencé s'il est plus tard
function countedFrom(settings: BudgetSettings, period: { start: Date }) {
  const restarted = settings.restarted_at ? new Date(settings.restarted_at) : null;
  return restarted && restarted > period.start ? restarted : period.start;
}

// Tous les budgets, avec la période en cours, ses dépenses et ce qui reste, dans l'ordre de création.
// Les dépenses d'avant les budgets multiples comptent dans le premier budget.
// Un plafond en pourcentage est converti en montant pour la période, d'après la limite de sa catégorie des Finances.
export async function fetchBudgets(): Promise<{ budgets: BudgetState[]; error: { code?: string; message: string } | null }> {
  const [{ data: rows, error }, limitOf] = await Promise.all([supabase.from('budget_settings').select('*').order('created_at'), fetchLimitOf()]);
  if (error) return { budgets: [], error };
  const settingsList = ((rows as BudgetSettings[]) ?? []).map((r) => {
    const s = { ...r, amount: Number(r.amount), missing_margin: Number(r.missing_margin), percent: r.percent === null || r.percent === undefined ? null : Number(r.percent) };
    return { ...s, amount: ceilingFor(s, limitOf(shoppingCategoryOf(s))) };
  });
  if (settingsList.length === 0) return { budgets: [], error: null };

  const periods = settingsList.map((s) => currentPeriod(s));
  const from = new Date(Math.min(...periods.map((p) => p.start.getTime())));
  const { data: exp, error: expError } = await supabase
    .from('expenses')
    .select('*')
    .gte('spent_at', from.toISOString())
    .order('spent_at', { ascending: false });
  if (expError) return { budgets: [], error: expError };
  const expenses = (exp as Expense[]) ?? [];

  const budgets = settingsList.map((settings, i) => {
    const period = periods[i];
    const start = countedFrom(settings, period);
    const mine = expenses.filter((e) => {
      const at = new Date(e.spent_at);
      // Colonne budget_id absente (script SQL pas encore lancé) : tout compte dans le premier budget.
      // Dépense détachée (son budget a été supprimé) : elle ne compte plus nulle part.
      const owner = e.budget_id === undefined ? settingsList[0].id : e.budget_id;
      return owner === settings.id && at >= start && at < period.end;
    });
    const spent = mine.reduce((s, e) => s + Number(e.amount), 0);
    return { settings, period, expenses: mine, spent, remaining: Math.max(0, settings.amount - spent) };
  });
  return { budgets, error: null };
}

// Budget d'une liste de courses (ou d'un reçu) : celui choisi, sinon le premier budget
export function budgetFor(budgets: BudgetState[] | undefined, budgetId: string | null | undefined) {
  if (!budgets?.length) return null;
  return budgets.find((b) => b.settings.id === budgetId) ?? budgets[0];
}

// Création ou modification d'un budget
export async function saveBudget(values: BudgetSettings) {
  const { id, ...fields } = values;
  const row = {
    name: fields.name.trim() || 'Courses',
    part: fields.part ?? 'charges',
    amount_mode: fields.amount_mode ?? 'euros',
    percent: fields.amount_mode === 'percent' ? Number(fields.percent) || 0 : null,
    amount: Number(fields.amount) || 0,
    missing_margin: Number(fields.missing_margin) || 0,
    period_value: Math.max(1, Math.round(Number(fields.period_value) || 1)),
    period_unit: fields.period_unit,
    start_date: fields.start_date,
    category: fields.category || SHOPPING_CATEGORY
  };
  const write = async (values: Partial<typeof row>) =>
    (id ? await supabase.from('budget_settings').update(values).eq('id', id) : await supabase.from('budget_settings').insert(values)).error;
  let error = await write(row);
  // Colonne "category" pas encore créée (script SQL à lancer) : le budget s'enregistre quand même, sans sa catégorie
  if (error && /category/.test(error.message)) {
    const { category: _skip, ...rest } = row;
    void _skip;
    error = await write(rest);
  }
  return error;
}

// Suppression d'un budget : ses dépenses ne comptent plus nulle part, et ses listes passent sur le premier budget
export async function deleteBudget(id: string) {
  const { error } = await supabase.from('budget_settings').delete().eq('id', id);
  return error;
}

// Enregistre le prix d'une course validée ou d'un reçu : il est déduit de ce qui reste sur la période du budget
// "day" : jour réel des achats (AAAA-MM-JJ) quand la liste est validée plus tard ; sans lui, maintenant
export async function recordExpense(amount: number, label: string, budgetId?: string | null, day?: string | null) {
  const [y, m, d] = (day ?? '').split('-').map(Number);
  // Un jour passé est daté de midi (heure locale), pour ne pas glisser à la veille ou au lendemain
  const spentAt = day ? new Date(y, m - 1, d, 12).toISOString() : new Date().toISOString();
  const { error } = await supabase
    .from('expenses')
    .insert({ amount: Math.round(amount * 100) / 100, label, budget_id: budgetId ?? null, spent_at: spentAt });
  if (error) console.error(error);
  return error;
}

// Budget dépassé ? Plus que ce qui reste, ou plus que (reste - marge) si des articles n'ont pas de prix
export function isOverBudget(total: number, hasMissingPrice: boolean, budget: BudgetState) {
  return total > budget.remaining || (hasMissingPrice && total > budget.remaining - Number(budget.settings.missing_margin));
}

// Fenêtre de fin de période pendant laquelle on peut recommencer le budget pour valider une liste qui dépasse le reste :
// les 3 derniers jours pour un budget à la semaine, la dernière semaine pour un budget au mois, le dernier jour sinon
export function restartWindowDays(settings: BudgetSettings) {
  return settings.period_unit === 'month' ? 7 : settings.period_unit === 'week' ? 3 : 1;
}

// Peut-on valider une liste de ce montant sur ce budget ?
//  - "ok" : elle tient dans ce qui reste ;
//  - "restart" : elle dépasse, mais la période se termine bientôt : on peut commencer le budget suivant dès maintenant
//    (le reste de la période en cours est abandonné) ;
//  - "blocked" : elle dépasse et la fin de période est trop loin ; "from" = date à partir de laquelle on pourra recommencer.
export type ValidationCheck = { kind: 'ok' } | { kind: 'restart' } | { kind: 'blocked'; from: Date };
export function validationCheck(total: number, hasMissingPrice: boolean, budget: BudgetState, now = new Date()): ValidationCheck {
  if (!isOverBudget(total, hasMissingPrice, budget)) return { kind: 'ok' };
  const end = budget.period.end;
  const from = new Date(end.getFullYear(), end.getMonth(), end.getDate() - restartWindowDays(budget.settings));
  return now >= from ? { kind: 'restart' } : { kind: 'blocked', from };
}

// Commence le budget suivant dès maintenant : la nouvelle période part d'aujourd'hui (avec la même durée),
// et les dépenses d'avant ne comptent plus
export async function restartBudget(budget: BudgetState) {
  if (!budget.settings.id) return null;
  const { error } = await supabase
    .from('budget_settings')
    .update({ start_date: today(), restarted_at: new Date().toISOString() })
    .eq('id', budget.settings.id);
  return error;
}

// Libellé d'une période : « 1 semaine », « 2 mois », « 3 jours »
export function periodLabel(settings: BudgetSettings) {
  const n = Math.max(1, settings.period_value);
  const unit = settings.period_unit === 'month' ? 'mois' : settings.period_unit === 'week' ? `semaine${n > 1 ? 's' : ''}` : `jour${n > 1 ? 's' : ''}`;
  return `${n} ${unit}`;
}

// Message lisible quand les tables ou colonnes du budget manquent dans Supabase
export function describeBudgetError(error: { code?: string; message: string }) {
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || /budget_id|restarted_at|income_plan|amount_mode|percent|part|column/i.test(error.message)) {
    return 'La répartition du revenu et les budgets ne sont pas encore à jour dans Supabase : lance le script supabase/shopping_budgets.sql dans l’éditeur SQL.';
  }
  return error.message;
}

// Date courte à la française (ex : 18/10)
export function shortDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
