import type { OcrLine } from '@/lib/ocr';
import { bestMatch, keywords, normalizeText, parsePrice, sentenceCase } from '@/lib/textMatch';

// Une ligne de produit lue sur un reçu
export type ReceiptItem = {
  raw: string; // texte tel qu'imprimé (ex : « LT DEMI ECR PRES 1L »), sert à mémoriser les correspondances
  ingredient_id: string | null; // ingrédient connu correspondant, ou null
  name: string; // nom proposé pour un nouvel ingrédient
  brand_id: string | null;
  brand_name: string | null;
  category_id: string | null;
  type: string | null; // « kg » pour une pesée, sinon l'unité de l'ingrédient connu
  quantity: number;
  unit_price: number | null; // prix d'une unité, remises comprises
  confidence: 'haute' | 'moyenne' | 'basse';
};

export type ReceiptScanResult = {
  store_id: string | null;
  store_chain: string | null;
  store_name: string | null;
  store_address: string | null;
  items: ReceiptItem[];
};

type Known = {
  ingredients: { id: string; name: string; type: string | null; category_id: string | null }[];
  brands: { id: string; name: string }[];
  stores: { id: string; name: string; chain: string | null; address: string | null }[];
  // Correspondances déjà validées : texte du reçu (normalisé) -> ingrédient
  aliases: Record<string, string>;
};

// Enseignes reconnues dans l'en-tête (en plus de celles des supermarchés enregistrés)
const CHAINS = [
  'Carrefour', 'Leclerc', 'Auchan', 'Intermarché', 'Lidl', 'Aldi', 'Monoprix', 'Franprix', 'Casino', 'Super U',
  'Hyper U', 'U Express', 'Netto', 'Spar', 'Cora', 'Colruyt', 'Grand Frais', 'Picard', 'Biocoop', 'Naturalia', 'Match',
  'Leader Price', 'Géant'
];

// Prix en fin de ligne, suivi éventuellement d'un code TVA (« 1,15 A », « 2,30 1 », « 0,99 € * »)
const ITEM = /^(.*?[a-zà-ÿ].*?)\s+(-?\d{1,4}[.,]\d{2})\s*(?:€|eur)?\s*(?:[a-z0-9]{1,2})?\s*\*?\s*$/i;
// « 2 x 1,25 » : quantité × prix unitaire
const MULTIPLY = /(\d{1,3})\s*[x×*]\s*(\d{1,4}[.,]\d{2})/i;
// « 0,532 kg x 2,99 €/kg » : pesée
const WEIGHT = /(\d+[.,]\d{1,3})\s*kg\s*[x×*@]?\s*(\d{1,4}[.,]\d{2})/i;
// Remises sur le produit juste au-dessus
const DISCOUNT = /remise|promo|r[eé]duc|avantage|coupon|offre|bon\s+d/i;
// Lignes qui ne sont pas des produits
const IGNORE =
  /total|tva|t\.v\.a|a payer|à payer|cb\b|carte|esp[eè]ces|rendu|monnaie|fid[eé]lit|points?\b|\bsacs?\b|consigne|ticket|caisse|merci|articles?\b|montant|\bht\b|ttc|date|heure|siret|t[eé]l\b|bienvenue|horaires/i;
// Fin de la liste des produits
const END = /\btotal\b|a payer|à payer|net a payer/i;

// Analyse le texte d'un reçu et rattache ses lignes aux données connues
export function parseReceipt(lines: OcrLine[], known: Known): ReceiptScanResult {
  const texts = lines.map((l) => l.text.trim()).filter(Boolean);

  // ----- EN-TÊTE : enseigne, ville et adresse (premières lignes du ticket) -----
  const header = texts.slice(0, 12);
  const headerText = normalizeText(header.join(' '));
  const chainNames = [...new Set([...CHAINS, ...known.stores.map((s) => s.chain).filter((c): c is string => !!c)])];
  const chain = chainNames.find((c) => headerText.includes(normalizeText(c))) ?? null;
  const postalIndex = header.findIndex((t) => /\b\d{5}\b/.test(t));
  const postalLine = postalIndex >= 0 ? header[postalIndex] : null;
  const city = postalLine?.replace(/.*\b\d{5}\b/, '').replace(/[^a-zà-ÿ' -]/gi, ' ').trim() || null;
  const streetLine =
    postalIndex > 0 && /^\d|rue|av|bd|boulevard|route|place|chemin|all[eé]e|quai|zac|zi\b|centre/i.test(header[postalIndex - 1])
      ? header[postalIndex - 1]
      : null;
  const address = [streetLine, postalLine].filter(Boolean).join(', ') || null;

  // Magasin connu : même enseigne, et même ville ou adresse si plusieurs magasins de l'enseigne
  const sameChain = chain ? known.stores.filter((s) => s.chain && normalizeText(s.chain) === normalizeText(chain)) : [];
  const byPlace = sameChain.find((s) => {
    const place = normalizeText(`${s.name} ${s.address ?? ''}`);
    return (city && place.includes(normalizeText(city))) || (postalLine && place.includes(postalLine.match(/\d{5}/)![0]));
  });
  const store = byPlace ?? (sameChain.length === 1 ? sameChain[0] : undefined);

  // ----- LIGNES DE PRODUITS -----
  type Draft = { raw: string; total: number; quantity: number; perKg: boolean; confidence: number };
  const drafts: Draft[] = [];
  let pending: { quantity: number; unit: number; perKg: boolean } | null = null;
  // Nom de produit imprimé seul sur sa ligne, sans prix (ex : « BANANES » au-dessus de la ligne de pesée)
  let nameOnly: { raw: string; confidence: number } | null = null;
  const lettersIn = (s: string) => (s.match(/[a-zà-ÿ]/gi) ?? []).length;

  for (const [i, text] of texts.entries()) {
    const confidence = lines[i]?.confidence ?? 0;

    // Ligne de quantité ou de pesée (pas de nom devant) : elle précise le produit voisin
    const qtyMatch = text.match(WEIGHT) ?? text.match(MULTIPLY);
    if (qtyMatch && lettersIn(text.slice(0, qtyMatch.index)) < 3) {
      const isWeight = WEIGHT.test(qtyMatch[0]);
      const quantity = parsePrice(qtyMatch[1]);
      const unit = parsePrice(qtyMatch[2]);
      // Montant de la ligne en fin de ligne s'il est imprimé, sinon quantité × prix unitaire
      const after = text.slice((qtyMatch.index ?? 0) + qtyMatch[0].length);
      const totalMatch = after.match(/(\d{1,4}[.,]\d{2})\s*(?:€|eur)?\s*(?:[a-z0-9]{1,2})?\s*\*?\s*$/i);
      const total = totalMatch ? parsePrice(totalMatch[1]) : Math.round(quantity * unit * 100) / 100;
      const last = drafts[drafts.length - 1];
      if (last && last.quantity === 1 && !nameOnly && Math.abs(last.total - total) <= 0.05) {
        // Précise le produit juste au-dessus (« YAOURT 1,78 » puis « 2 x 0,89 »)
        last.quantity = quantity;
        last.perKg = isWeight;
      } else if (nameOnly) {
        // Complète le nom imprimé seul juste au-dessus (« BANANES » puis « 0,532 kg x 1,99 €/kg 1,06 »)
        drafts.push({ raw: nameOnly.raw, total, quantity, perKg: isWeight, confidence: nameOnly.confidence });
      } else {
        // Sinon, précise le produit suivant
        pending = { quantity, unit, perKg: isWeight };
      }
      nameOnly = null;
      continue;
    }

    const m = text.match(ITEM);
    if (!m) {
      // Ligne de texte sans prix : peut-être un nom de produit dont le prix est sur la ligne suivante
      const raw = text.replace(/[^a-zà-ÿ0-9%.,'’/ -]/gi, ' ').replace(/\s+/g, ' ').trim();
      nameOnly = lettersIn(raw) >= 3 && !IGNORE.test(raw) ? { raw, confidence } : null;
      continue;
    }
    nameOnly = null;
    const label = m[1].trim();
    const amount = parsePrice(m[2]);

    // Remise : déduite du produit juste au-dessus
    if (DISCOUNT.test(label) || amount < 0) {
      const last = drafts[drafts.length - 1];
      if (last) last.total = Math.max(0, last.total - Math.abs(amount));
      continue;
    }
    if (END.test(label) && drafts.length > 0) break;
    if (IGNORE.test(label)) continue;

    // Nom nettoyé : codes article en tête et symboles retirés
    const raw = label.replace(/^\d{3,}\s+/, '').replace(/[^a-zà-ÿ0-9%.,'’/ -]/gi, ' ').replace(/\s+/g, ' ').trim();
    if ((raw.match(/[a-zà-ÿ]/gi) ?? []).length < 2) continue;

    const draft: Draft = { raw, total: amount, quantity: 1, perKg: false, confidence };
    if (pending && Math.abs(pending.quantity * pending.unit - amount) <= 0.05) {
      draft.quantity = pending.quantity;
      draft.perKg = pending.perKg;
    }
    pending = null;
    drafts.push(draft);
  }

  // Même produit sur plusieurs lignes : une seule ligne, quantités et montants additionnés
  const merged = new Map<string, Draft>();
  for (const d of drafts) {
    const key = normalizeText(d.raw);
    const existing = merged.get(key);
    if (existing && existing.perKg === d.perKg) {
      existing.quantity = Math.round((existing.quantity + d.quantity) * 1000) / 1000;
      existing.total += d.total;
      existing.confidence = Math.min(existing.confidence, d.confidence);
    } else merged.set(key, { ...d });
  }

  // ----- RATTACHEMENT AUX DONNÉES CONNUES -----
  const items: ReceiptItem[] = Array.from(merged.values()).map((d) => {
    const key = normalizeText(d.raw);
    const aliasId = known.aliases[key];
    const alias = aliasId ? known.ingredients.find((i) => i.id === aliasId) : undefined;
    const match = alias ? { item: alias, score: 1 } : bestMatch(d.raw, known.ingredients, (i) => i.name);
    const ingredient = match?.item;

    // Marque : une marque connue dont tous les mots apparaissent dans la ligne
    const rawWords = keywords(d.raw);
    const brand = known.brands.find((b) => {
      const bw = keywords(b.name);
      return bw.length > 0 && bw.every((w) => rawWords.includes(w));
    });

    // Nom proposé : la ligne sans la marque, ni poids ou contenance
    const brandWords = brand ? new Set(keywords(brand.name)) : new Set<string>();
    const name = sentenceCase(
      d.raw
        .split(' ')
        .filter((w) => !brandWords.has(normalizeText(w)))
        .join(' ')
        .replace(/\b\d+([.,]\d+)?\s?(kg|g|l|cl|ml)\b/gi, '')
        .replace(/\bx\s?\d+\b/gi, '')
        .replace(/\s+/g, ' ')
    );

    const confidence: ReceiptItem['confidence'] =
      match && match.score >= 0.8 ? 'haute' : match || d.confidence >= 75 ? 'moyenne' : 'basse';

    return {
      raw: d.raw,
      ingredient_id: ingredient?.id ?? null,
      name: name || d.raw,
      brand_id: brand?.id ?? null,
      brand_name: null,
      category_id: ingredient?.category_id ?? null,
      type: d.perKg ? 'kg' : (ingredient?.type ?? null),
      quantity: d.quantity,
      unit_price: d.quantity > 0 ? Math.round((d.total / d.quantity) * 100) / 100 : null,
      confidence
    };
  });

  return {
    store_id: store?.id ?? null,
    store_chain: chain,
    store_name: store ? store.name : city,
    store_address: address,
    items
  };
}
