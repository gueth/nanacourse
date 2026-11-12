'use client';

import { supabase } from '@/lib/supabase';
import { orThrow, useCached } from '@/lib/cache';
import type { IncomePart } from '@/lib/budget';
import type { HealthState } from '@/lib/health';
import { CATEGORIES } from '@/lib/transactions';
import { DEFAULT_SAVINGS_EXCLUDED, setSavingsRule } from '@/lib/savingsRule';

// Réglages des couleurs des Finances (Paramètres > Finances) :
//  - les règles qui donnent sa couleur à un mois (lib/health, assessHealth) : pour chaque couleur (sauf le gris, qui
//    est la couleur « sinon »), une liste de conditions, toutes de la même forme : un type (catégorie, compte de
//    résultat, bilan, épargne, patrimoine), ce qu'on mesure, une comparaison (==, !=, <, <=, >, >=) et une valeur.
//    La couleur s'applique si l'une des conditions est vraie (ou toutes, au choix) ;
//  - la répartition du revenu propre à chaque couleur (pourcentage par partie de la répartition par défaut) : un mois
//    de cette couleur est comparé à elle (Finances > Budget, « En bref ») ; une couleur sans répartition propre suit
//    la répartition par défaut (Finances > Gestion).
// Table Supabase "finance_health" (une ligne, voir supabase/finance_health.sql) ; sans elle, les valeurs par défaut.

export type RuleOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export const RULE_OPS: RuleOp[] = ['==', '!=', '<', '<=', '>', '>='];

export type ConditionKind = 'categorie' | 'resultat' | 'bilan' | 'epargne' | 'patrimoine' | 'budget';
// flow et target : pour une catégorie (sens, puis catégorie ou grande catégorie « groupe:<id> ») ; target seul pour un
// budget (vide : le budget global du mois, sinon celui d'une catégorie ou d'une grande catégorie « groupe:<id> »)
export type HealthCondition = { kind: ConditionKind; measure: string; flow?: 'income' | 'expense'; target?: string; op: RuleOp; value: number };
export type ColorRule = { match: 'any' | 'all'; conditions: HealthCondition[] };
export type RuledState = Exclude<HealthState, 'neutre'>;
export type HealthRules = Record<RuledState, ColorRule>;

// Ce que chaque type de condition peut mesurer, avec son unité
export type Measure = { id: string; label: string; unit: '€' | '%' | '% par an' };
export const CONDITION_KINDS: { id: ConditionKind; label: string; measures: Measure[] }[] = [
  { id: 'categorie', label: 'Catégorie', measures: [{ id: 'montant', label: 'Montant du mois', unit: '€' }] },
  {
    id: 'resultat',
    label: 'Compte de résultat',
    measures: [
      { id: 'resultat', label: 'Résultat (produits − charges)', unit: '€' },
      { id: 'produits', label: 'Total des produits', unit: '€' },
      { id: 'charges', label: 'Total des charges', unit: '€' },
      { id: 'revenus_activite', label: "Revenus d'activité", unit: '€' }
    ]
  },
  {
    id: 'bilan',
    label: 'Bilan',
    measures: [
      { id: 'patrimoine', label: 'Patrimoine net', unit: '€' },
      { id: 'actif', label: "Total de l'actif", unit: '€' },
      { id: 'liquidites', label: 'Liquidités (comptes, livrets)', unit: '€' },
      { id: 'dettes', label: 'Total des dettes', unit: '€' },
      { id: 'decouvert', label: 'Découvert', unit: '€' }
    ]
  },
  {
    id: 'epargne',
    label: 'Épargne',
    measures: [
      { id: 'taux', label: 'Part des revenus épargnée', unit: '%' },
      { id: 'montant', label: 'Montant épargné', unit: '€' }
    ]
  },
  {
    // Budget du mois (limites des catégories, Finances > Budget), global ou d'une catégorie : de combien il est dépassé
    // (négatif : ce qu'il en reste)
    id: 'budget',
    label: 'Budget',
    measures: [
      { id: 'depassement_pct', label: 'Dépassement du budget', unit: '%' },
      { id: 'depassement', label: 'Dépassement du budget', unit: '€' }
    ]
  },
  {
    id: 'patrimoine',
    label: 'Patrimoine',
    measures: [
      { id: 'croissance', label: 'Progression du patrimoine', unit: '% par an' },
      { id: 'progression', label: 'Progression du patrimoine', unit: '€' }
    ]
  }
];
export const measureOf = (c: Pick<HealthCondition, 'kind' | 'measure'>) =>
  CONDITION_KINDS.find((k) => k.id === c.kind)?.measures.find((m) => m.id === c.measure) ?? null;

// Comparaison d'une valeur (null : inconnue, la condition est alors fausse)
export function compare(value: number | null, op: RuleOp, threshold: number) {
  if (value === null || !Number.isFinite(value)) return false;
  const v = Math.round(value * 100) / 100;
  switch (op) {
    case '==':
      return v === threshold;
    case '!=':
      return v !== threshold;
    case '<':
      return v < threshold;
    case '<=':
      return v <= threshold;
    case '>':
      return v > threshold;
    case '>=':
      return v >= threshold;
  }
}

// Ordre de vérification des couleurs : la première dont la règle est vraie donne sa couleur au mois, le gris sinon
export const CHECK_ORDER: HealthState[] = ['hemorragie', 'maladie', 'fatigue', 'sante', 'olympique', 'neutre'];

// Règles par défaut : orange si le résultat est négatif ou s'il y a un découvert, jaune si le patrimoine progresse
// moins vite que l'inflation (2 % par an), bleu si l'on épargne au moins 20 % de ses revenus, vert si le résultat
// est positif ou nul (le gris, quand aucune règle n'est vraie, reste alors pour les mois sans chiffres) ; le rouge n'a pas de
// condition tant qu'on ne lui en donne pas
export const DEFAULT_RULES: HealthRules = {
  hemorragie: { match: 'any', conditions: [] },
  maladie: {
    match: 'any',
    conditions: [
      { kind: 'resultat', measure: 'resultat', op: '<', value: 0 },
      { kind: 'bilan', measure: 'decouvert', op: '>', value: 0 }
    ]
  },
  fatigue: { match: 'any', conditions: [{ kind: 'patrimoine', measure: 'croissance', op: '<', value: 2 }] },
  sante: { match: 'any', conditions: [{ kind: 'epargne', measure: 'taux', op: '>=', value: 20 }] },
  olympique: { match: 'any', conditions: [{ kind: 'resultat', measure: 'resultat', op: '>=', value: 0 }] }
};

// Repère d'épargne (accueil) : le seuil de la part des revenus épargnée du bleu, 20 % sinon
export function savingsTargetPct(rules: HealthRules | undefined) {
  const c = rules?.sante.conditions.find((x) => x.kind === 'epargne' && x.measure === 'taux');
  return c ? c.value : 20;
}

// Anciens réglages (seuils fixes et conditions sur les grandes catégories) : convertis en conditions
type LegacyRules = {
  maladieSavings?: number;
  maladieOverdraft?: boolean;
  olympiqueRate?: number;
  inflation?: number;
  groupRules?: { state: string; group: string; op: 'max' | 'min'; amount: number; kind?: 'income' | 'expense' }[];
};
function fromLegacy(old: LegacyRules): HealthRules {
  const rules: HealthRules = {
    hemorragie: { match: 'any', conditions: [] },
    maladie: {
      match: 'any',
      conditions: [
        { kind: 'resultat', measure: 'resultat', op: '<', value: old.maladieSavings ?? 0 },
        ...(old.maladieOverdraft === false ? [] : [{ kind: 'bilan' as const, measure: 'decouvert', op: '>' as const, value: 0 }])
      ]
    },
    fatigue: { match: 'any', conditions: [{ kind: 'patrimoine', measure: 'croissance', op: '<', value: old.inflation ?? 2 }] },
    sante: { match: 'any', conditions: [{ kind: 'epargne', measure: 'taux', op: '>=', value: old.olympiqueRate ?? 20 }] },
    olympique: DEFAULT_RULES.olympique
  };
  // Le vert était vérifié avant le bleu : ses conditions passent au bleu (ordre et règles inversés)
  const state = (s: string): RuledState => (s === 'olympique' ? 'sante' : (s as RuledState));
  for (const g of old.groupRules ?? [])
    rules[state(g.state)]?.conditions.push({ kind: 'categorie', measure: 'montant', target: `groupe:${g.group}`, flow: g.kind, op: g.op === 'max' ? '<=' : '>=', value: g.amount });
  return rules;
}
function normalize(raw: unknown): HealthRules {
  const r = (raw ?? {}) as Partial<HealthRules> & { olympique?: ColorRule } & LegacyRules;
  const isNew = (['hemorragie', 'maladie', 'fatigue', 'sante', 'olympique'] as const).some((s) => r[s] && Array.isArray((r[s] as ColorRule).conditions));
  if (!isNew) return Object.keys(r).length ? fromLegacy(r) : DEFAULT_RULES;
  // Réglages enregistrés quand le vert avait la règle et le bleu était la couleur « sinon » : la règle du vert va au
  // bleu, et le vert prend sa règle par défaut
  const before = !r.sante;
  const one = (s: RuledState): ColorRule => {
    const c = (before && s === 'sante' ? r.olympique : before && s === 'olympique' ? DEFAULT_RULES.olympique : r[s]) as ColorRule | undefined;
    return c && Array.isArray(c.conditions) ? { match: c.match === 'all' ? 'all' : 'any', conditions: c.conditions } : { match: 'any', conditions: [] };
  };
  return { hemorragie: one('hemorragie'), maladie: one('maladie'), fatigue: one('fatigue'), sante: one('sante'), olympique: one('olympique') };
}

// Répartition propre à une couleur : pourcentage par identifiant de partie
export type StateRepartition = Record<string, number>;
// savingsExcluded : catégories d'entrée écartées de l'épargne (règle de lib/savingsRule : épargne = entrées − ces
// entrées − charges), par défaut les aides et allocations
// budgets : limites par défaut des mois de chaque couleur, en pourcentage de sa partie de la répartition, par grande
// catégorie (identifiant du groupe) ; les grandes catégories d'une même partie font 100 % (lib/repartition, colorLimits)
export type StateBudgets = Record<string, number>;
export type HealthSettings = {
  rules: HealthRules;
  repartitions: Partial<Record<HealthState, StateRepartition>>;
  savingsExcluded: string[];
  budgets: Partial<Record<HealthState, StateBudgets>>;
};
export const DEFAULT_HEALTH_SETTINGS: HealthSettings = { rules: DEFAULT_RULES, repartitions: {}, savingsExcluded: DEFAULT_SAVINGS_EXCLUDED, budgets: {} };
// Les budgets par couleur sont rangés dans la colonne « repartitions », sous cette clé (pas de script SQL à relancer)
const BUDGETS_KEY = '_budgets';

// Pose la règle de l'épargne pour toute l'application (lignes du compte de résultat : celles des catégories écartées)
export function applySavingsRule(excluded: string[]) {
  setSavingsRule(excluded, (ids) => CATEGORIES.filter((c) => ids.includes(c.id) && c.line).map((c) => c.line!));
}

// Les couleurs, de la plus grave à la meilleure, avec leur nom
export const HEALTH_STATES: { id: HealthState; color: string; name: string }[] = [
  { id: 'hemorragie', color: 'Rouge', name: 'Hémorragie' },
  { id: 'maladie', color: 'Jaune', name: 'Maladie' },
  { id: 'fatigue', color: 'Orange', name: 'Fatigue' },
  { id: 'sante', color: 'Bleu', name: 'Santé' },
  { id: 'olympique', color: 'Vert', name: 'Olympique' },
  { id: 'neutre', color: 'Gris', name: 'Neutre' }
];

const missingTable = (error: { code?: string } | null) => !!error && (error.code === '42P01' || error.code === 'PGRST205');
// Colonne « savings » absente (script supabase/finance_health.sql pas encore relancé)
const missingSavingsColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204' || /savings/i.test(error.message ?? ''));
let savingsColumnMissing = false;

export async function fetchHealthSettings(): Promise<{ settings: HealthSettings; error: { message: string } | null; missing: boolean }> {
  let { data, error } = await supabase.from('finance_health').select(savingsColumnMissing ? 'rules, repartitions' : 'rules, repartitions, savings').eq('id', 1).maybeSingle();
  if (!savingsColumnMissing && missingSavingsColumn(error)) {
    savingsColumnMissing = true;
    ({ data, error } = await supabase.from('finance_health').select('rules, repartitions').eq('id', 1).maybeSingle());
  }
  if (missingTable(error)) return { settings: DEFAULT_HEALTH_SETTINGS, error: null, missing: true };
  const row = data as { rules?: unknown; repartitions?: HealthSettings['repartitions'] | null; savings?: { exclure?: unknown } | null } | null;
  const exclure = row?.savings?.exclure;
  const savingsExcluded = Array.isArray(exclure) ? exclure.filter((x): x is string => typeof x === 'string') : DEFAULT_SAVINGS_EXCLUDED;
  const { [BUDGETS_KEY]: budgets, ...repartitions } = (row?.repartitions ?? {}) as HealthSettings['repartitions'] & { [BUDGETS_KEY]?: HealthSettings['budgets'] };
  return { settings: { rules: normalize(row?.rules), repartitions, savingsExcluded, budgets: budgets ?? {} }, error, missing: false };
}

// "savingsMissing" : la règle de l'épargne n'a pas pu être enregistrée (colonne absente), le reste l'a été
export async function saveHealthSettings(settings: HealthSettings): Promise<{ message: string } | null> {
  const repartitions = { ...settings.repartitions, [BUDGETS_KEY]: settings.budgets };
  const base = { id: 1, rules: settings.rules, repartitions, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('finance_health').upsert({ ...base, savings: { exclure: settings.savingsExcluded } }, { onConflict: 'id' });
  if (missingSavingsColumn(error)) {
    savingsColumnMissing = true;
    const retry = await supabase.from('finance_health').upsert(base, { onConflict: 'id' });
    return retry.error ?? { message: 'savings' };
  }
  return error;
}

export const HEALTH_SETTINGS_KEY = 'finances:couleurs-reglages';
export function useHealthSettings() {
  return useCached(HEALTH_SETTINGS_KEY, async () => {
    const { settings, error, missing } = await fetchHealthSettings();
    // La règle de l'épargne vaut tout de suite pour tous les calculs (avant que les pages ne se redessinent)
    if (!error) applySavingsRule(settings.savingsExcluded);
    return orThrow({ ...settings, missing }, error);
  });
}

// Une règle porte-t-elle sur le budget du mois ?
export const needsBudget = (rules: HealthRules | undefined) =>
  !!rules && Object.values(rules).some((r) => r.conditions.some((c) => c.kind === 'budget'));

// Une règle demande-t-elle les montants du mois par catégorie ?
export const needsCategoryTotals = (rules: HealthRules | undefined) =>
  !!rules && Object.values(rules).some((r) => r.conditions.some((c) => c.kind === 'categorie'));

// Parties de la répartition pour un mois de cette couleur : celles de la répartition par défaut, avec les pourcentages
// propres à la couleur s'il y en a (une partie ajoutée depuis compte pour 0 % tant qu'on ne lui en donne pas) ;
// null : la couleur n'a pas de répartition propre
export function stateParts(parts: IncomePart[], settings: HealthSettings | undefined, state: HealthState | null): IncomePart[] | null {
  const own = state ? settings?.repartitions[state] : undefined;
  if (!own) return null;
  return parts.map((p) => ({ ...p, pct: Number(own[p.id] ?? 0) }));
}
