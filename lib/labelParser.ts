import type { OcrLine } from '@/lib/ocr';
import { parsePrice, sentenceCase } from '@/lib/textMatch';

// Ce qu'on retient d'une étiquette de rayon
export type LabelResult = {
  name: string; // nom du produit, ex : « Tomates cerises »
  price: number | null; // prix affiché en euros
  type: string | null; // « kg » quand seul un prix au kilo est affiché (vrac), sinon null
};

// Un prix : « 2,49 », « 2.49 », « 2€49 », « 2 € 49 » (le « 49 » est souvent écrit en petit à côté)
const PRICE = /(\d{1,3})\s?(?:[,.]|€)\s?(\d{2})(?!\d)/g;
// Prix seul sur sa ligne écrit « 2 49 » (gros chiffres + petits centimes séparés par un espace)
const SPLIT_PRICE = /^\s*(\d{1,3})\s+(\d{2})\s*€?\s*$/;
// Prix ramené à une unité (au kilo, au litre...) : ce n'est pas le prix du produit
const UNIT_PRICE = /(\/|\ble\b|\bau\b|\bpar\b)\s?(kg|kilo|l\b|litre|100\s?g|100\s?ml|unit|pi[eè]ce)|prix\s+(au|du|à|a)\s|€\s?\/\s?(kg|l)/i;
// Lignes qui ne sont pas le nom du produit
const NOT_NAME = /prix|€|eur\b|code|ean|r[eé]f|promo|soit|tva|origine|cat[eé]gorie|calibre|lot\b|dlc|ddm|\d{6,}/i;

// Analyse le texte d'une étiquette de prix de supermarché :
//  - prix : le plus gros prix qui n'est pas un prix au kilo / au litre (le prix principal est écrit en grand) ;
//    s'il n'y a qu'un prix au kilo, c'est un produit en vrac : on le garde, avec le type « kg » ;
//  - nom : la ligne de texte la plus grande (hors prix et mentions), avec la suivante si elle la prolonge.
export function parseLabel(lines: OcrLine[]): LabelResult {
  const prices: { value: number; height: number; perKg: boolean }[] = [];
  for (const line of lines) {
    const perUnit = UNIT_PRICE.test(line.text);
    const split = line.text.match(SPLIT_PRICE);
    if (split) prices.push({ value: parsePrice(`${split[1]},${split[2]}`), height: line.height, perKg: perUnit });
    for (const m of line.text.matchAll(PRICE)) {
      prices.push({ value: parsePrice(`${m[1]},${m[2]}`), height: line.height, perKg: perUnit });
    }
  }
  const valid = prices.filter((p) => p.value > 0 && p.value < 1000);
  const main = valid.filter((p) => !p.perKg).sort((a, b) => b.height - a.height)[0];
  const perKg = valid.filter((p) => p.perKg)[0];
  const price = main?.value ?? perKg?.value ?? null;
  const type = !main && perKg ? 'kg' : null;

  // Lignes candidates pour le nom : surtout des lettres, pas de prix ni de mention technique
  const candidates = lines
    .map((line, index) => ({ ...line, index }))
    .filter((l) => {
      const letters = (l.text.match(/[a-zà-ÿ]/gi) ?? []).length;
      return letters >= 3 && letters / l.text.replace(/\s/g, '').length >= 0.6 && !NOT_NAME.test(l.text) && !l.text.match(PRICE);
    });
  const first = [...candidates].sort((a, b) => b.height - a.height)[0];
  let name = first?.text ?? '';
  // La ligne juste en dessous, de taille proche, complète souvent le nom (« TOMATES » / « CERISES »)
  const next = first && candidates.find((c) => c.index === first.index + 1);
  if (first && next && next.height >= first.height * 0.7) name = `${name} ${next.text}`;

  // Nettoyage : poids et contenances retirés du nom (« 500 g », « 1,5 L », « x6 »), espaces en trop
  name = name
    .replace(/\b\d+([.,]\d+)?\s?(kg|g|l|cl|ml)\b/gi, '')
    .replace(/\bx\s?\d+\b/gi, '')
    .replace(/[^a-zà-ÿ0-9'’\- ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { name: name ? sentenceCase(name) : '', price, type };
}
