import { familyKey } from '@/lib/family';

// Texte simplifié pour comparer : minuscules, sans accents ni ponctuation
// (ex : « Lait DEMI-ÉCRÉMÉ » -> « lait demi ecreme »)
export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Mots ignorés pour la comparaison : quantités, unités et petits mots
const NOISE = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'a', 'au', 'aux', 'en', 'x', 'g', 'kg', 'l', 'cl', 'ml', 'pce', 'pcs', 'lot']);

// Mots significatifs d'un nom (sans nombres ni unités)
export function keywords(s: string) {
  return normalizeText(s)
    .split(' ')
    .filter((w) => w.length >= 2 && !NOISE.has(w) && !/^\d/.test(w));
}

// Deux mots correspondent s'ils sont égaux, ou si l'un est l'abréviation de l'autre
// (les tickets abrègent : « ecr » = « ecreme », « choc » = « chocolat »)
function sameWord(a: string, b: string) {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

// Ressemblance entre deux noms, de 0 (rien en commun) à 1 (mêmes mots)
export function similarity(a: string, b: string) {
  const ka = keywords(a);
  const kb = keywords(b);
  if (ka.length === 0 || kb.length === 0) return 0;
  const shared = ka.filter((w) => kb.some((x) => sameWord(w, x))).length;
  let score = (2 * shared) / (ka.length + kb.length);
  // Même famille de produit (premier mot significatif, au singulier) : bonus
  if (familyKey(a) && familyKey(a) === familyKey(b)) score = Math.min(1, score + 0.25);
  return score;
}

// Élément le plus ressemblant à un nom, s'il ressemble assez (score >= seuil)
export function bestMatch<T>(name: string, candidates: T[], nameOf: (c: T) => string, threshold = 0.5) {
  let best: { item: T; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(name, nameOf(c));
    if (score >= threshold && (!best || score > best.score)) best = { item: c, score };
  }
  return best;
}

// « TOMATES CERISES » -> « Tomates cerises »
export function sentenceCase(s: string) {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Prix écrit à la française (« 2,49 », « 2.49 », « 2€49 ») -> nombre
export function parsePrice(s: string) {
  return Number(s.replace(/\s/g, '').replace('€', '.').replace(',', '.'));
}
