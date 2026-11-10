import { supabase } from '@/lib/supabase';
import { SHOPPING_CATEGORY } from '@/lib/budget';
import { DEFAULT_CATEGORY_IDS, isSavingsAccount, updateCategory } from '@/lib/transactions';

// Courses enregistrées dans l'appli (listes validées, reçus scannés : table "expenses") rapprochées des opérations
// d'un relevé importé. Une course correspond à une dépense du même montant (à quelques centimes près), passée sur
// le compte le jour même ou dans les 5 jours qui suivent (délai de la banque).
//  - opération retrouvée et encore dans « Autres dépenses » : classée dans la catégorie du budget de la course
//    (« Courses » par défaut) ;
//  - course sans opération correspondante sur la période du relevé : signalée, c'est peut-être une erreur
//    (montant mal saisi, course payée en espèces ou depuis un autre compte, opération manquante sur le relevé).

export type UnmatchedGrocery = { label: string; amount: number; day: string };

const DAY = 86400000;
const shiftDay = (date: string, days: number) => new Date(new Date(date).getTime() + days * DAY).toISOString().slice(0, 10);
const POSTING_DAYS = 5;
const TOLERANCE = 0.05;

export async function checkGroceries(account: string, from: string, to: string) {
  const none = { unmatched: [] as UnmatchedGrocery[], reclassified: 0, error: null as { message: string } | null };
  // Les courses se paient depuis un compte courant, jamais depuis un livret
  if (isSavingsAccount(account)) return none;
  const [expenses, budgets, transactions] = await Promise.all([
    supabase.from('expenses').select('id, amount, label, spent_at, budget_id').gte('spent_at', `${shiftDay(from, -POSTING_DAYS)}T00:00:00`).lte('spent_at', `${to}T23:59:59`),
    supabase.from('budget_settings').select('*'),
    supabase.from('bank_transactions').select('id, date, amount, category').eq('account', account).gte('date', from).lte('date', shiftDay(to, POSTING_DAYS))
  ]);
  if (expenses.error) return { ...none, error: expenses.error };
  if (transactions.error) return { ...none, error: transactions.error };
  const categoryOf = new Map(((budgets.data as { id: string; category?: string | null }[]) ?? []).map((b) => [b.id, b.category || SHOPPING_CATEGORY]));
  const pool = ((transactions.data as { id: string; date: string; amount: number; category: string }[]) ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
  const used = new Set<string>();
  const unmatched: UnmatchedGrocery[] = [];
  const toClassify = new Map<string, string[]>(); // catégorie -> opérations à y classer

  const list = ((expenses.data as { id: string; amount: number; label: string | null; spent_at: string; budget_id: string | null }[]) ?? []).sort((a, b) =>
    a.spent_at.localeCompare(b.spent_at)
  );
  for (const e of list) {
    const day = e.spent_at.slice(0, 10);
    const amount = Number(e.amount);
    // L'opération la plus proche en date parmi celles qui conviennent
    const match = pool
      .filter((t) => !used.has(t.id) && t.amount < 0 && Math.abs(-t.amount - amount) <= TOLERANCE && t.date >= shiftDay(day, -1) && t.date <= shiftDay(day, POSTING_DAYS))
      .sort((a, b) => Math.abs(new Date(a.date).getTime() - new Date(day).getTime()) - Math.abs(new Date(b.date).getTime() - new Date(day).getTime()))[0];
    if (match) {
      used.add(match.id);
      const category = categoryOf.get(e.budget_id ?? '') ?? SHOPPING_CATEGORY;
      if (DEFAULT_CATEGORY_IDS.includes(match.category) && match.category !== category) toClassify.set(category, [...(toClassify.get(category) ?? []), match.id]);
    } else if (day >= from && day <= shiftDay(to, -POSTING_DAYS)) {
      // Seulement les courses assez anciennes pour que leur opération soit forcément sur ce relevé
      unmatched.push({ label: e.label || 'Course', amount, day });
    }
  }
  let reclassified = 0;
  for (const [category, ids] of toClassify) {
    const err = await updateCategory(ids, category);
    if (err) return { unmatched, reclassified, error: err };
    reclassified += ids.length;
  }
  return { unmatched, reclassified, error: null };
}
