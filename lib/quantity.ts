// Règles de quantité selon le type d'un ingrédient (kg, pièce, paquet...).
// Exemple : on peut acheter 0,5 kg de pommes, mais pas 0,5 pièce ni 0,5 paquet.

export type QuantityRule = {
  step: number; // pas entre deux quantités possibles (1 = nombres entiers)
  min: number; // plus petite quantité possible
  unit: string; // unité affichée à côté de la quantité
};

// Mise en forme du type pour la comparaison : minuscules, sans accents ni espaces autour
function normalizeType(type?: string | null) {
  return (type ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function quantityRule(type?: string | null): QuantityRule {
  const t = normalizeType(type);
  // Poids et volumes : décimales autorisées
  if (['kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'].includes(t)) return { step: 0.1, min: 0.1, unit: 'kg' };
  if (['l', 'litre', 'litres'].includes(t)) return { step: 0.1, min: 0.1, unit: 'L' };
  if (['g', 'gramme', 'grammes'].includes(t)) return { step: 10, min: 10, unit: 'g' };
  if (['cl', 'centilitre', 'centilitres'].includes(t)) return { step: 1, min: 1, unit: 'cl' };
  if (['ml', 'millilitre', 'millilitres'].includes(t)) return { step: 10, min: 10, unit: 'ml' };
  // Tout le reste (pièce, paquet, conserve, bouteille, type inconnu...) : nombres entiers uniquement
  return { step: 1, min: 1, unit: type?.trim() || 'pce' };
}

// Supprime les erreurs d'arrondi des nombres à virgule (ex : 0.30000000000000004 -> 0.3)
function clean(value: number) {
  return Math.round(value * 1000) / 1000;
}

// Ramène une quantité saisie sur une valeur possible : arrondie au pas le plus proche, au moins le minimum
export function normalizeQuantity(value: number, rule: QuantityRule) {
  if (!Number.isFinite(value)) return rule.min;
  return clean(Math.max(rule.min, Math.round(value / rule.step) * rule.step));
}

// Moitié d'une quantité, arrondie au pas supérieur ; null si on ne peut pas descendre plus bas
export function halveQuantity(value: number, rule: QuantityRule) {
  const half = clean(Math.max(rule.min, Math.ceil(value / 2 / rule.step) * rule.step));
  return half < value ? half : null;
}

// Affichage d'une quantité à la française (virgule décimale)
export function formatQuantity(value: number) {
  return String(clean(value)).replace('.', ',');
}

// Types proposés pendant la saisie d'un ingrédient (on peut aussi en taper un autre)
export const TYPE_SUGGESTIONS = ['pièce', 'kg', 'g', 'litre', 'paquet', 'conserve', 'bouteille'];
