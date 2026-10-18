import type { Store } from './types';
import { halveQuantity, quantityRule } from './quantity';

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

export type ListItemToAnalyze = {
  id: string;
  ingredientId: string;
  quantity: number;
  // Prix estimé de la ligne, ou null s'il n'est pas encore connu
  expectedPrice: number | null;
  // Famille de l'ingrédient (ex : « oeuf ») : un seul article par famille est gardé
  family?: string;
  // Type de l'ingrédient (kg, pièce, paquet...) : fixe les quantités possibles
  type?: string | null;
};

export type ListAnalysis = {
  // Boutique qui propose le plus d'articles de la liste, puis la moins chère à égalité
  bestStore: Store | null;
  // Économie totale : prix actuel - prix en allant dans la meilleure boutique,
  // sans les articles en rouge et avec les articles en orange divisés par deux
  savings: number;
  // Par id d'article : "remove" (rouge) si le stock suffit ou si un autre article de la même famille
  // est déjà gardé, "reduce" (orange) s'il y en a une partie en stock
  status: Record<string, 'remove' | 'reduce'>;
  // Nouvelles quantités des articles en orange (moitié, arrondie au pas supérieur selon le type)
  newQuantities: Record<string, number>;
};

/**
 * Analyse une liste de courses à partir des prix en magasin et de l'inventaire.
 */
export function analyzeList(
  items: ListItemToAnalyze[],
  prices: { ingredient_id: string; store_id: string; price: number; available: boolean }[],
  stores: Store[],
  stockByIngredient: Record<string, number>,
  // Articles à ne pas réanalyser : on leur garde le statut donné ici (absent = aucun statut)
  overrides: Record<string, { status?: 'remove' | 'reduce'; newQty?: number }> = {}
): ListAnalysis {
  // 1. Comparaison avec l'inventaire
  const status: ListAnalysis['status'] = {};
  const newQuantities: ListAnalysis['newQuantities'] = {};
  for (const item of items) {
    const inStock = stockByIngredient[item.ingredientId] ?? 0;
    if (inStock <= 0) continue;
    if (inStock >= item.quantity) status[item.id] = 'remove';
    else {
      status[item.id] = 'reduce';
      // Moitié arrondie selon le type (0,5 kg possible, mais pas 0,5 pièce)
      const half = halveQuantity(item.quantity, quantityRule(item.type));
      if (half != null) newQuantities[item.id] = half;
    }
  }

  // Articles figés : on remplace le résultat calculé par celui fourni
  for (const [id, o] of Object.entries(overrides)) {
    delete status[id];
    delete newQuantities[id];
    if (o.status) status[id] = o.status;
    if (o.newQty != null) newQuantities[id] = o.newQty;
  }

  // Plusieurs articles d'une même famille (ex : plusieurs sortes d'œufs) :
  // on garde le premier qui reste à acheter, les autres passent en rouge
  const keptFamilies = new Set<string>();
  for (const item of items) {
    if (!item.family || status[item.id] === 'remove') continue;
    if (keptFamilies.has(item.family)) {
      status[item.id] = 'remove';
      delete newQuantities[item.id];
    } else keptFamilies.add(item.family);
  }

  // Quantité après optimisation : 0 pour le rouge, moitié pour l'orange
  const adjustedQty = (item: ListItemToAnalyze) =>
    status[item.id] === 'remove' ? 0 : (newQuantities[item.id] ?? item.quantity);

  // Prix unitaire de chaque ingrédient, magasin par magasin
  const unitPrice = new Map<string, number>();
  for (const p of prices) if (p.available) unitPrice.set(`${p.ingredient_id}|${p.store_id}`, p.price);

  // 2. Meilleure boutique : le plus d'articles restants disponibles, puis le total le plus bas
  const remaining = items.filter((i) => adjustedQty(i) > 0);
  let bestStore: Store | null = null;
  let bestCovered = 0;
  let bestTotal = Infinity;
  for (const store of stores) {
    let covered = 0;
    let total = 0;
    for (const item of remaining) {
      const price = unitPrice.get(`${item.ingredientId}|${store.id}`);
      if (price == null) continue;
      covered += 1;
      total += price * adjustedQty(item);
    }
    if (covered > bestCovered || (covered === bestCovered && covered > 0 && total < bestTotal)) {
      bestStore = store;
      bestCovered = covered;
      bestTotal = total;
    }
  }

  // 3. Économie, calculée sur les articles dont le prix actuel est connu
  let currentTotal = 0;
  let optimizedTotal = 0;
  for (const item of items) {
    if (!item.expectedPrice) continue;
    currentTotal += item.expectedPrice;
    const qty = adjustedQty(item);
    const storePrice = bestStore ? unitPrice.get(`${item.ingredientId}|${bestStore.id}`) : undefined;
    const unit = storePrice ?? item.expectedPrice / item.quantity;
    optimizedTotal += unit * qty;
  }

  return { bestStore, savings: Math.max(0, currentTotal - optimizedTotal), status, newQuantities };
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
