import { refreshBalanceLinks } from '@/lib/balanceLinks';
import { refreshStatements } from '@/lib/transactions';

// Remet les Finances d'accord avec les opérations, après tout changement (import, reclassement, opération ajoutée ou
// supprimée à la main) : compte de résultat des mois touchés, puis lignes du bilan reliées à des catégories
// (dettes, créances), recalculées depuis leur départ. Renvoie une erreur, ou null.
export async function syncFinances(months: string[]) {
  if (months.length) {
    const { error } = await refreshStatements(months);
    if (error) return error;
  }
  return refreshBalanceLinks();
}
