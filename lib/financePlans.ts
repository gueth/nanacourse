import { supabase } from '@/lib/supabase';
import { addLine, fetchLines, SECTIONS, updateLine } from '@/lib/finance';

// Objectifs d'épargne, dettes en cours et placements. Tables : voir supabase/finance_coach.sql

export type Goal = {
  id: string;
  name: string;
  target: number; // montant visé, en euros d'aujourd'hui
  saved: number; // déjà mis de côté
  monthly: number; // versement mensuel prévu
  annual_rate: number; // rendement annuel espéré du placement (0.03 = 3 %), une estimation
};

export type Debt = {
  id: string;
  name: string;
  principal: number; // capital restant dû
  annual_rate: number; // taux annuel (0.035 = 3,5 %)
  monthly: number; // mensualité
};

const toNumbers = <T extends object>(row: T, keys: (keyof T)[]) => {
  const copy = { ...row };
  for (const k of keys) copy[k] = Number(copy[k]) as T[keyof T];
  return copy;
};

export async function fetchGoals() {
  const { data, error } = await supabase.from('finance_goals').select('*').order('created_at');
  return { goals: ((data as Goal[]) ?? []).map((g) => toNumbers(g, ['target', 'saved', 'monthly', 'annual_rate'])), error };
}

export async function addGoal(goal: Omit<Goal, 'id'>) {
  const { data, error } = await supabase.from('finance_goals').insert(goal).select().single();
  return { goal: data ? toNumbers(data as Goal, ['target', 'saved', 'monthly', 'annual_rate']) : null, error };
}

export async function updateGoal(id: string, changes: Partial<Omit<Goal, 'id'>>) {
  const { error } = await supabase.from('finance_goals').update(changes).eq('id', id);
  return error;
}

export async function deleteGoal(id: string) {
  const { error } = await supabase.from('finance_goals').delete().eq('id', id);
  return error;
}

export async function fetchDebts() {
  const { data, error } = await supabase.from('debts').select('*').order('created_at');
  return { debts: ((data as Debt[]) ?? []).map((d) => toNumbers(d, ['principal', 'annual_rate', 'monthly'])), error };
}

export async function addDebt(debt: Omit<Debt, 'id'>) {
  const { data, error } = await supabase.from('debts').insert(debt).select().single();
  return { debt: data ? toNumbers(data as Debt, ['principal', 'annual_rate', 'monthly']) : null, error };
}

export async function updateDebt(id: string, changes: Partial<Omit<Debt, 'id'>>) {
  const { error } = await supabase.from('debts').update(changes).eq('id', id);
  return error;
}

export async function deleteDebt(id: string) {
  const { error } = await supabase.from('debts').delete().eq('id', id);
  return error;
}

export type InvestmentKind = 'livret' | 'fonds_euros' | 'av_uc' | 'pea' | 'per' | 'scpi' | 'crypto' | 'autre';

export type Investment = {
  id: string;
  name: string;
  kind: InvestmentKind;
  invested: number; // total des versements, retraits déduits
  value: number; // valeur actuelle
  fees: number; // frais annuels (0.008 = 0,8 %)
  expected_rate: number; // rendement annuel espéré avant frais, une estimation
  risk: number; // 1 (aucun risque de perte) à 7 (très risqué), comme l'indicateur SRI des documents d'information
  opened_on: string | null; // AAAA-MM-JJ
  updated_at: string;
};

// Types de placement, avec des valeurs de départ réalistes (à corriger d'après ton contrat)
export const INVESTMENT_KINDS: {
  id: InvestmentKind;
  label: string;
  fees: number;
  rate: number;
  risk: number;
  section: 'liquidites' | 'placements';
  help: string;
}[] = [
  { id: 'livret', label: 'Livret (A, LDDS, LEP…)', fees: 0, rate: 0.017, risk: 1, section: 'liquidites', help: 'Capital garanti, disponible à tout moment, sans frais ni impôt.' },
  { id: 'fonds_euros', label: 'Assurance-vie – fonds euros', fees: 0.007, rate: 0.03, risk: 1, section: 'placements', help: 'Capital garanti par l’assureur ; frais de gestion souvent entre 0,5 et 1 % par an.' },
  { id: 'av_uc', label: 'Assurance-vie – unités de compte', fees: 0.017, rate: 0.05, risk: 4, section: 'placements', help: 'Investi en fonds (actions, obligations) : peut baisser. Frais du contrat + frais des fonds, souvent 1,5 à 2,5 % par an au total.' },
  { id: 'pea', label: 'PEA / compte-titres', fees: 0.003, rate: 0.06, risk: 5, section: 'placements', help: 'Actions ou ETF en direct. Avec des ETF « monde », les frais restent souvent sous 0,5 % par an.' },
  { id: 'per', label: 'Épargne retraite (PER)', fees: 0.015, rate: 0.045, risk: 4, section: 'placements', help: 'Bloqué jusqu’à la retraite (sauf achat de la résidence principale) ; versements déductibles des impôts.' },
  { id: 'scpi', label: 'Immobilier papier (SCPI)', fees: 0.012, rate: 0.045, risk: 3, section: 'placements', help: 'Revente parfois longue ; frais d’entrée élevés (souvent 8 à 12 %), déjà déduits de la valeur.' },
  { id: 'crypto', label: 'Cryptomonnaies', fees: 0.01, rate: 0, risk: 7, section: 'placements', help: 'Très volatil : une baisse de plus de moitié en quelques mois est déjà arrivée plusieurs fois.' },
  { id: 'autre', label: 'Autre placement', fees: 0, rate: 0.02, risk: 3, section: 'placements', help: '' }
];

export const investmentKind = (id: string) => INVESTMENT_KINDS.find((k) => k.id === id) ?? INVESTMENT_KINDS[INVESTMENT_KINDS.length - 1];

const INVESTMENT_NUMBERS: (keyof Investment)[] = ['invested', 'value', 'fees', 'expected_rate', 'risk'];

export async function fetchInvestments() {
  const { data, error } = await supabase.from('investments').select('*').order('created_at');
  return { investments: ((data as Investment[]) ?? []).map((i) => toNumbers(i, INVESTMENT_NUMBERS)), error };
}

export async function addInvestment(investment: Omit<Investment, 'id' | 'updated_at'>) {
  const { data, error } = await supabase.from('investments').insert(investment).select().single();
  return { investment: data ? toNumbers(data as Investment, INVESTMENT_NUMBERS) : null, error };
}

export async function updateInvestment(id: string, changes: Partial<Omit<Investment, 'id'>>) {
  const { error } = await supabase.from('investments').update(changes).eq('id', id);
  return error;
}

export async function deleteInvestment(id: string) {
  const { error } = await supabase.from('investments').delete().eq('id', id);
  return error;
}

// Après l'import d'un relevé de livret : met à jour la valeur du livret dans les placements (même nom), ou l'ajoute.
// À la création, les versements sont pris égaux au solde (le relevé ne dit pas ce qui a été versé depuis l'ouverture).
export async function syncSavingsAccount(name: string, balance: number, asOf: string) {
  const { investments, error } = await fetchInvestments();
  if (error) return { created: false, error };
  const updated_at = new Date(asOf).toISOString();
  const existing = investments.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (existing) {
    // Un relevé plus ancien que la dernière mise à jour ne remplace pas une valeur plus récente
    if (existing.updated_at > updated_at) return { created: false, error: null };
    return { created: false, error: await updateInvestment(existing.id, { value: balance, updated_at }) };
  }
  const kind = investmentKind('livret');
  const { error: err } = await addInvestment({
    name,
    kind: 'livret',
    invested: balance,
    value: balance,
    fees: kind.fees,
    expected_rate: kind.rate,
    risk: kind.risk,
    opened_on: null
  });
  if (!err) await supabase.from('investments').update({ updated_at }).eq('name', name);
  return { created: !err, error: err };
}

// Reporte la valeur de chaque placement dans le bilan du mois (une ligne par placement, créée si besoin)
export async function reportInvestments(period: string, investments: Investment[]) {
  const { lines, error } = await fetchLines(period);
  if (error) return error;
  for (const inv of investments) {
    const sectionId = investmentKind(inv.kind).section;
    const existing = lines.find((l) => l.section === sectionId && l.label === inv.name);
    if (existing) {
      const err = await updateLine(existing.id, { amount: inv.value });
      if (err) return err;
    } else {
      const { line, error: err } = await addLine(period, SECTIONS.find((s) => s.id === sectionId)!, inv.name, 100);
      if (err) return err;
      if (line) await updateLine(line.id, { amount: inv.value });
    }
  }
  return null;
}

// Message lisible quand une table n'existe pas encore dans Supabase
export function describeDbError(message: string) {
  if (/'auto' column|column .*auto/i.test(message)) {
    return "Il manque la colonne « auto » dans la table finance_lines : exécute dans l'éditeur SQL de Supabase la ligne « alter table finance_lines add column if not exists auto boolean not null default false; » (fin du script supabase/finance_coach.sql).";
  }
  const table = message.match(/(bank_transactions|category_rules|budgets|planned_expenses|finance_goals|debts|finance_lines|investments|custom_categories|removed_categories)/)?.[1];
  if (table && /(does not exist|schema cache|not find)/i.test(message)) {
    return `La table « ${table} » n'existe pas encore dans Supabase : exécute le script supabase/finance_coach.sql dans l'éditeur SQL.`;
  }
  // Sécurité au niveau des lignes activée sans règle d'accès : le bloc final du script ajoute ces règles
  const blocked = message.match(/row-level security policy for table "(\w+)"/)?.[1];
  if (blocked) {
    return `Supabase refuse l'écriture dans « ${blocked} » (sécurité RLS sans règle d'accès) : exécute le bloc « Accès depuis l'appli » à la fin de supabase/finance_coach.sql dans l'éditeur SQL.`;
  }
  return `Erreur : ${message}`;
}
