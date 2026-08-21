import type { Store } from './types';

export type PriceOption = { storeId: string; storeName: string; price: number };

export type ShoppingItem = {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  options: PriceOption[]; // un par magasin qui vend cet ingrédient
};

export type StoreBreakdown = {
  store: Store;
  items: { ingredientId: string; ingredientName: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
};

export type OptimizationResult = {
  breakdown: StoreBreakdown[];
  totalPrice: number;
  storeCount: number;
  missingIngredients: string[];
};

/**
 * Cherche, parmi les magasins qui vendent au moins un ingrédient demandé, la combinaison
 * qui (1) minimise le nombre de magasins nécessaires pour tout couvrir, puis (2) parmi les
 * combinaisons de taille minimale, minimise le prix total.
 * Recherche exhaustive par bitmask — largement suffisant pour un nombre réaliste de magasins (<16).
 */
export function optimizeShoppingList(items: ShoppingItem[], allStores: Store[]): OptimizationResult {
  const findable = items.filter((i) => i.options.length > 0);
  const missingIngredients = items.filter((i) => i.options.length === 0).map((i) => i.ingredientName);

  const candidateStoreIds = Array.from(new Set(findable.flatMap((i) => i.options.map((o) => o.storeId))));
  if (candidateStoreIds.length === 0) {
    return { breakdown: [], totalPrice: 0, storeCount: 0, missingIngredients };
  }

  const n = candidateStoreIds.length;
  let bestSize = Infinity;
  let bestPrice = Infinity;
  let bestMask = 0;

  for (let mask = 1; mask < 1 << n; mask++) {
    const size = popcount(mask);
    if (size > bestSize) continue;

    let covers = true;
    let total = 0;
    for (const item of findable) {
      let cheapest: number | null = null;
      item.options.forEach((opt) => {
        const idx = candidateStoreIds.indexOf(opt.storeId);
        if ((mask & (1 << idx)) !== 0 && (cheapest === null || opt.price < cheapest)) cheapest = opt.price;
      });
      if (cheapest === null) {
        covers = false;
        break;
      }
      total += cheapest * item.quantity;
    }

    if (covers && (size < bestSize || (size === bestSize && total < bestPrice))) {
      bestSize = size;
      bestPrice = total;
      bestMask = mask;
    }
  }

  const chosenStoreIds = candidateStoreIds.filter((_, idx) => (bestMask & (1 << idx)) !== 0);
  const storeMap = new Map(allStores.map((s) => [s.id, s]));

  const breakdown: StoreBreakdown[] = chosenStoreIds
    .map((storeId) => {
      const store = storeMap.get(storeId)!;
      const storeItems = findable
        .map((item) => {
          const optsInStore = item.options.filter((o) => chosenStoreIds.includes(o.storeId));
          const cheapestHere = optsInStore.reduce<PriceOption | null>(
            (min, o) => (min === null || o.price < min.price ? o : min),
            null
          );
          if (!cheapestHere || cheapestHere.storeId !== storeId) return null;
          return {
            ingredientId: item.ingredientId,
            ingredientName: item.ingredientName,
            quantity: item.quantity,
            unitPrice: cheapestHere.price,
            lineTotal: cheapestHere.price * item.quantity
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const subtotal = storeItems.reduce((s, it) => s + it.lineTotal, 0);
      return { store, items: storeItems, subtotal };
    })
    .filter((b) => b.items.length > 0);

  return {
    breakdown,
    totalPrice: breakdown.reduce((s, b) => s + b.subtotal, 0),
    storeCount: breakdown.length,
    missingIngredients
  };
}

function popcount(x: number) {
  let count = 0;
  while (x) {
    count += x & 1;
    x >>= 1;
  }
  return count;
}
