import { normalizeText } from '@/lib/textMatch';

// Correspondances apprises entre le texte d'un reçu et un ingrédient
// (ex : « LT DEMI ECR PRES 1L » -> Lait demi-écrémé), pour reconnaître directement le produit la fois suivante.
// Gardées dans ce navigateur (stockage local) : rien à configurer dans Supabase.
const KEY = 'nanacourses.receiptAliases';

export function loadAliases(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

// Mémorise les correspondances validées (texte du reçu -> id de l'ingrédient)
export function rememberAliases(pairs: { raw: string; ingredientId: string }[]) {
  try {
    const aliases = loadAliases();
    for (const { raw, ingredientId } of pairs) if (raw && ingredientId) aliases[normalizeText(raw)] = ingredientId;
    localStorage.setItem(KEY, JSON.stringify(aliases));
  } catch {
    // Stockage local indisponible (navigation privée...) : on s'en passe
  }
}
