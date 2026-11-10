import { supabase } from '@/lib/supabase';
import { monthKey, SECTIONS, setLineAmount, shiftMonth } from '@/lib/finance';
import { CATEGORIES, lastDayOf, monthOf, type Transaction } from '@/lib/transactions';

// Lignes du bilan complétées par des catégories du Budget (Finances > Gestion, « Compléter les tableaux ») :
//  - une ligne de l'actif (sommes à recevoir) prend la somme de catégories d'entrée ;
//  - une ligne du passif (emprunts, autres dettes) prend la somme de catégories de sortie.
// Le montant inscrit chaque fin de mois est le cumul de ces catégories (plus un montant de départ facultatif), depuis le mois
// de départ s'il est donné, sinon depuis la première opération. Le bilan reste non modifiable : c'est ici qu'on décide d'où viennent ses montants.
// Table "balance_links" (voir supabase/finances_coherence.sql).

export type BalanceLink = {
  id: string;
  section: string; // rubrique du bilan : creances, emprunts ou dettes
  label: string; // ligne de cette rubrique
  targets: string[]; // catégories, ou grandes catégories ("groupe:<id>")
  opening: number; // montant au dernier jour du mois de départ (0 par défaut)
  opening_month: string | null; // AAAA-MM, facultatif : sans lui, tout l'historique des catégories compte
};

// Rubriques du bilan qu'on peut relier : celles des dettes et des créances
export const LINKABLE_SECTIONS = SECTIONS.filter((s) => ['creances', 'emprunts', 'dettes'].includes(s.id));

export const groupTarget = (groupId: string) => `groupe:${groupId}`;

// Catégories suivies par une ligne (les sous-catégories des grandes catégories choisies)
export function linkCategories(link: Pick<BalanceLink, 'targets'>) {
  const ids = new Set<string>();
  for (const target of link.targets) {
    if (target.startsWith('groupe:')) CATEGORIES.filter((c) => c.group === target.slice(7)).forEach((c) => ids.add(c.id));
    else ids.add(target);
  }
  return [...ids];
}

const round = (n: number) => Math.round(n * 100) / 100;
// Côté du bilan d'une rubrique : l'actif se complète avec des entrées, le passif avec des sorties
export const sideOf = (section: string) => SECTIONS.find((s) => s.id === section)?.side ?? 'passif';
export const isAsset = (link: Pick<BalanceLink, 'section'>) => sideOf(link.section) === 'actif';

// Montant de la ligne à la fin de chaque mois, jusqu'à "lastMonth" : cumul des entrées (actif) ou des sorties (passif)
export function linkBalances(link: BalanceLink, transactions: Pick<Transaction, 'date' | 'amount' | 'category'>[], lastMonth: string) {
  const ids = new Set(linkCategories(link));
  const start = link.opening_month ? lastDayOf(link.opening_month) : '';
  const moves = transactions.filter((t) => ids.has(t.category) && t.date > start);
  const result: { month: string; balance: number }[] = [];
  let balance = link.opening;
  let month = link.opening_month ?? moves.map((t) => monthOf(t.date)).sort()[0] ?? lastMonth;
  if (link.opening_month) {
    result.push({ month, balance: round(balance) });
    month = shiftMonth(month, 1);
  }
  for (; month <= lastMonth; month = shiftMonth(month, 1)) {
    const moved = moves.filter((t) => monthOf(t.date) === month).reduce((s, t) => s + t.amount, 0);
    balance += isAsset(link) ? moved : -moved;
    result.push({ month, balance: round(balance) });
  }
  return result;
}

export async function fetchBalanceLinks() {
  const { data, error } = await supabase.from('balance_links').select('id, section, label, targets, opening, opening_month').order('created_at');
  return { links: ((data as BalanceLink[]) ?? []).map((l) => ({ ...l, opening: Number(l.opening), targets: l.targets ?? [] })), error };
}

export async function saveBalanceLink(link: Omit<BalanceLink, 'id'> & { id?: string }) {
  const row = { ...link, label: link.label.trim(), opening_month: link.opening_month || null };
  const { error } = link.id ? await supabase.from('balance_links').update(row).eq('id', link.id) : await supabase.from('balance_links').insert(row);
  return error;
}

// Retire le lien ; les montants qu'il avait inscrits au bilan sont remis à zéro
export async function deleteBalanceLink(link: BalanceLink) {
  const { error } = await supabase.from('balance_links').delete().eq('id', link.id);
  if (error) return error;
  return (await supabase.from('finance_lines').update({ amount: 0 }).eq('section', link.section).ilike('label', link.label).eq('auto', true)).error;
}

// Inscrit au bilan le solde de chaque ligne reliée, pour chaque mois déjà ouvert (qui a des lignes) depuis son mois de départ.
// À relancer après un import, un reclassement ou une opération ajoutée à la main : tout est recalculé depuis le départ.
export async function refreshBalanceLinks() {
  const { links, error } = await fetchBalanceLinks();
  if (error) return /balance_links/.test(error.message) ? null : error; // table pas encore créée : rien à faire
  if (links.length === 0) return null;
  const currentMonth = monthKey(new Date());
  const { data: periodRows, error: periodError } = await supabase.from('finance_lines').select('period').lte('period', currentMonth);
  if (periodError) return periodError;
  const opened = new Set(((periodRows as { period: string }[]) ?? []).map((r) => r.period));
  for (const link of links) {
    const categories = linkCategories(link);
    const query = supabase.from('bank_transactions').select('date, amount, category').in('category', categories);
    const { data, error: txError } = categories.length
      ? await (link.opening_month ? query.gt('date', lastDayOf(link.opening_month)) : query)
      : { data: [], error: null };
    if (txError) return txError;
    const transactions = ((data as Transaction[]) ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
    for (const { month, balance } of linkBalances(link, transactions, currentMonth)) {
      if (!opened.has(month)) continue;
      const err = await setLineAmount(month, link.section, link.label, balance, true, true);
      if (err) return err;
    }
  }
  return null;
}
