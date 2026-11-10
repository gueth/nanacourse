import { supabase } from '@/lib/supabase';
import { monthKey, SECTIONS, setLineAmount, shiftMonth } from '@/lib/finance';
import { CATEGORIES, lastDayOf, monthOf, type Transaction } from '@/lib/transactions';

// Lignes du bilan reliées à des catégories (Finances > Gestion) : dettes, emprunts et sommes à recevoir.
// Une ligne suit ses catégories (ou grandes catégories) mois après mois, à partir d'un solde de départ :
//  - au passif (emprunts, autres dettes) : l'argent reçu (emprunter) augmente la dette, l'argent versé (rembourser) la diminue ;
//  - à l'actif (sommes à recevoir) : l'argent versé (prêter) augmente ce qu'on te doit, l'argent reçu (être remboursé) le diminue.
// Le solde de chaque fin de mois est inscrit sur la ligne du bilan, comme un solde de relevé : le bilan reste non modifiable.
// Table "balance_links" (voir supabase/finances_coherence.sql).

export type BalanceLink = {
  id: string;
  section: string; // rubrique du bilan : creances, emprunts ou dettes
  label: string; // ligne de cette rubrique
  targets: string[]; // catégories, ou grandes catégories ("groupe:<id>")
  opening: number; // solde au dernier jour du mois de départ
  opening_month: string; // AAAA-MM
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
const isAsset = (link: Pick<BalanceLink, 'section'>) => link.section === 'creances';

// Solde de la ligne à la fin de chaque mois, du mois de départ jusqu'à "lastMonth"
export function linkBalances(link: BalanceLink, transactions: Pick<Transaction, 'date' | 'amount' | 'category'>[], lastMonth: string) {
  const ids = new Set(linkCategories(link));
  const start = lastDayOf(link.opening_month);
  const moves = transactions.filter((t) => ids.has(t.category) && t.date > start);
  const result: { month: string; balance: number }[] = [];
  let balance = link.opening;
  result.push({ month: link.opening_month, balance: round(balance) });
  for (let month = shiftMonth(link.opening_month, 1); month <= lastMonth; month = shiftMonth(month, 1)) {
    const moved = moves.filter((t) => monthOf(t.date) === month).reduce((s, t) => s + t.amount, 0);
    balance += isAsset(link) ? -moved : moved;
    result.push({ month, balance: round(balance) });
  }
  return result;
}

export async function fetchBalanceLinks() {
  const { data, error } = await supabase.from('balance_links').select('id, section, label, targets, opening, opening_month').order('created_at');
  return { links: ((data as BalanceLink[]) ?? []).map((l) => ({ ...l, opening: Number(l.opening), targets: l.targets ?? [] })), error };
}

export async function saveBalanceLink(link: Omit<BalanceLink, 'id'> & { id?: string }) {
  const row = { ...link, label: link.label.trim() };
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
  const firstMonth = links.map((l) => l.opening_month).sort()[0];
  const { data: periodRows, error: periodError } = await supabase.from('finance_lines').select('period').gte('period', firstMonth).lte('period', currentMonth);
  if (periodError) return periodError;
  const opened = new Set(((periodRows as { period: string }[]) ?? []).map((r) => r.period));
  for (const link of links) {
    const categories = linkCategories(link);
    const { data, error: txError } = categories.length
      ? await supabase.from('bank_transactions').select('date, amount, category').in('category', categories).gt('date', lastDayOf(link.opening_month))
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
