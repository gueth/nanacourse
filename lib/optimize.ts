import type { Store } from './types';

export type ListItemToAnalyze = {
  id: string;
  ingredientId: string;
  quantity: number;
  // Prix estimé de la ligne, ou null s'il n'est pas encore connu
  expectedPrice: number | null;
  // Famille de l'ingrédient (ex : « oeuf ») : un seul article par famille est gardé, le moins cher
  family?: string;
};

// Un magasin possible pour faire les courses
export type StoreOption = {
  store: Store;
  covered: number; // nombre d'articles restants qu'on y trouve
  total: number; // prix de ces articles dans ce magasin
  savings: number; // économie en allant dans ce magasin
  distanceKm?: number; // distance depuis ta position (ajoutée après coup, si elle est connue)
};

export type ListAnalysis = {
  // Magasin conseillé : au départ le premier des options (le plus d'articles, puis le moins cher),
  // éventuellement remplacé par un magasin plus proche (voir lib/geo.ts)
  bestStore: Store | null;
  // Les 3 meilleurs magasins, du meilleur au moins bon (articles trouvés, puis prix)
  options: StoreOption[];
  // Économie totale : prix actuel - prix en allant dans la meilleure boutique, sans les articles en rouge
  savings: number;
  // Par id d'article : "remove" (rouge) si un article moins cher de la même famille est gardé
  status: Record<string, 'remove'>;
};

/**
 * Analyse une liste de courses à partir des prix en magasin.
 */
export function analyzeList(
  items: ListItemToAnalyze[],
  prices: { ingredient_id: string; store_id: string; price: number; available: boolean }[],
  stores: Store[]
): ListAnalysis {
  // 1. Plusieurs articles d'une même famille (ex : deux sortes de lait) : on garde le moins cher
  // (prix de la ligne ; sans prix = en dernier ; à égalité, le premier de la liste), les autres passent en rouge
  const status: ListAnalysis['status'] = {};
  const kept = new Map<string, ListItemToAnalyze>();
  for (const item of items) {
    if (!item.family) continue;
    const current = kept.get(item.family);
    if (!current || (item.expectedPrice ?? Infinity) < (current.expectedPrice ?? Infinity)) kept.set(item.family, item);
  }
  for (const item of items) {
    if (item.family && kept.get(item.family) !== item) status[item.id] = 'remove';
  }

  // Quantité après optimisation : 0 pour le rouge
  const adjustedQty = (item: ListItemToAnalyze) => (status[item.id] === 'remove' ? 0 : item.quantity);

  // Prix unitaire de chaque ingrédient, magasin par magasin
  const unitPrice = new Map<string, number>();
  for (const p of prices) if (p.available) unitPrice.set(`${p.ingredient_id}|${p.store_id}`, p.price);

  // 2. Magasins classés : le plus d'articles restants disponibles, puis le total le plus bas
  const remaining = items.filter((i) => adjustedQty(i) > 0);
  const ranked = stores
    .map((store) => {
      let covered = 0;
      let total = 0;
      for (const item of remaining) {
        const price = unitPrice.get(`${item.ingredientId}|${store.id}`);
        if (price == null) continue;
        covered += 1;
        total += price * adjustedQty(item);
      }
      return { store, covered, total };
    })
    .filter((o) => o.covered > 0)
    .sort((a, b) => b.covered - a.covered || a.total - b.total);

  // 3. Économie en allant dans un magasin (ou sans magasin : seulement les articles en rouge),
  // calculée sur les articles dont le prix actuel est connu
  function savingsWith(store: Store | null) {
    let currentTotal = 0;
    let optimizedTotal = 0;
    for (const item of items) {
      if (!item.expectedPrice) continue;
      currentTotal += item.expectedPrice;
      const storePrice = store ? unitPrice.get(`${item.ingredientId}|${store.id}`) : undefined;
      const unit = storePrice ?? item.expectedPrice / item.quantity;
      optimizedTotal += unit * adjustedQty(item);
    }
    return Math.max(0, currentTotal - optimizedTotal);
  }

  const options = ranked.slice(0, 3).map((o) => ({ ...o, savings: savingsWith(o.store) }));
  return {
    bestStore: options[0]?.store ?? null,
    options,
    savings: options[0]?.savings ?? savingsWith(null),
    status
  };
}

export type TotalSummary = { kind: 'full' | 'min' | 'none'; total: number };

/**
 * Résume un total quand certains prix manquent (null) :
 *  - tous connus           -> "full" (total exact)
 *  - au moins la moitié    -> "min"  (le total est supérieur à la somme connue)
 *  - moins de la moitié    -> "none" (total indisponible)
 */
export function summarizeTotal(values: (number | null)[]): TotalSummary {
  const known = values.filter((v): v is number => v != null);
  const total = known.reduce((s, v) => s + v, 0);
  if (known.length === values.length) return { kind: 'full', total };
  if (known.length * 2 >= values.length) return { kind: 'min', total };
  return { kind: 'none', total };
}
