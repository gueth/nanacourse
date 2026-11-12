import { refreshBalanceLinks } from '@/lib/balanceLinks';
import { refreshStatements } from '@/lib/transactions';

// Remet les Finances d'accord avec les opérations, après tout changement (import, reclassement, opération ajoutée ou
// supprimée à la main) : compte de résultat des mois touchés, puis lignes du bilan reliées à des catégories
// (dettes, créances), recalculées depuis leur départ. Renvoie une erreur, ou null.
// Plusieurs changements rapprochés (reclassements à la suite) sont regroupés : pendant qu'une mise à jour tourne, les
// mois touchés ensuite s'accumulent et sont traités en une seule fois juste après, au lieu d'un recalcul par changement.
let running: Promise<{ message: string } | null> | null = null;
let queued: { months: Set<string>; promise: Promise<{ message: string } | null> } | null = null;

async function run(months: string[]) {
  if (months.length) {
    const { error } = await refreshStatements(months);
    if (error) return error;
  }
  return refreshBalanceLinks();
}

export function syncFinances(months: string[]): Promise<{ message: string } | null> {
  if (!running) {
    running = run(months).finally(() => (running = null));
    return running;
  }
  if (queued) {
    months.forEach((m) => queued!.months.add(m));
    return queued.promise;
  }
  const next = { months: new Set(months), promise: null as unknown as Promise<{ message: string } | null> };
  next.promise = running.then(() => {
    queued = null;
    return syncFinances([...next.months]);
  });
  queued = next;
  return next.promise;
}
