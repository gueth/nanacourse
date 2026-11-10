import type { OcrBox, OcrLine } from '@/lib/ocr';
import { bestMatch, normalizeText, parsePrice, sentenceCase } from '@/lib/textMatch';

// Endroit du ticket d'où vient une information : numéro de la photo et rectangle de la ligne lue
export type ReceiptSource = { image: number; box: OcrBox };

// Une ligne de produit lue sur un reçu
export type ReceiptItem = {
  raw: string; // texte tel qu'imprimé (ex : « LT DEMI ECR PRES 1L »), sert à mémoriser les correspondances
  ingredient_id: string | null; // ingrédient connu correspondant, ou null
  name: string; // nom proposé pour un nouvel ingrédient
  category_id: string | null;
  type: string | null; // « kg » pour une pesée, sinon l'unité de l'ingrédient connu
  quantity: number;
  unit_price: number | null; // prix d'une unité, remises comprises
  confidence: 'haute' | 'moyenne' | 'basse';
  sources: ReceiptSource[]; // lignes du ticket d'où vient le produit (nom, quantité, prix), dans l'ordre
};

export type ReceiptScanResult = {
  store_id: string | null;
  store_chain: string | null;
  store_name: string | null;
  store_address: string | null;
  items: ReceiptItem[]; // dans l'ordre du ticket
  article_count: number | null; // nombre d'articles imprimé sur le ticket (« 25 ARTICLES »), s'il y est
  totals: { amount: number; source: ReceiptSource; toPay: boolean }[]; // totaux imprimés (parfois deux fois)
};

type Known = {
  ingredients: { id: string; name: string; type: string | null; category_id: string | null }[];
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
// « 1,2x3 » : prix unitaire × quantité (le prix de la ligne est alors le prix unitaire fois la quantité)
const UNIT_TIMES_QTY = /(\d{1,4}[.,]\d{1,2})\s*[x×*]\s*(\d{1,3})(?![\d.,])/i;
// Ligne d'en-tête des colonnes, juste avant les articles : « DÉSIGNATION ... PRIX », « LIBELLÉ  MONTANT »...
const COLUMN_NAMES = /d[ée]signation|libell[ée]|description|produits?|articles?|d[ée]tail/i;
const COLUMN_PRICES = /prix|montant|\bp\.?\s?u\b|\btotal\b|qt[ée]|quantit/i;
// Ligne qui contient un total : jamais un article
const ANY_TOTAL = /\btotal\b/i;

// Quantité imprimée sur une ligne, dans l'un des formats du ticket : pesée (« 0,532 kg x 2,99 »),
// quantité × prix unitaire (« 2 x 1,25 ») ou prix unitaire × quantité (« 1,2x3 »).
// "index" et "length" situent le texte trouvé, pour le retirer du nom du produit.
function quantityIn(text: string) {
  const weight = text.match(WEIGHT);
  if (weight) return { quantity: parsePrice(weight[1]), unit: parsePrice(weight[2]), perKg: true, index: weight.index ?? 0, length: weight[0].length };
  const multiply = text.match(MULTIPLY);
  if (multiply) return { quantity: Number(multiply[1]), unit: parsePrice(multiply[2]), perKg: false, index: multiply.index ?? 0, length: multiply[0].length };
  const unitFirst = text.match(UNIT_TIMES_QTY);
  if (unitFirst) return { quantity: Number(unitFirst[2]), unit: parsePrice(unitFirst[1]), perKg: false, index: unitFirst.index ?? 0, length: unitFirst[0].length };
  return null;
}
// « 0,532 kg x 2,99 €/kg » : pesée
const WEIGHT = /(\d+[.,]\d{1,3})\s*kg\s*[x×*@]?\s*(\d{1,4}[.,]\d{2})/i;
// Remises sur le produit juste au-dessus
const DISCOUNT = /remise|promo|r[eé]duc|avantage|coupon|offre|bon\s+d/i;
// Lignes qui ne sont pas des produits
const IGNORE =
  /total|tva|t\.v\.a|a payer|à payer|cb\b|carte|esp[eè]ces|rendu|monnaie|fid[eé]lit|points?\b|\bsacs?\b|consigne|ticket|caisse|merci|articles?\b|montant|\bht\b|ttc|date|heure|siret|t[eé]l\b|bienvenue|horaires/i;
// Fin de la liste des produits
const END = /\btotal\b|a payer|à payer|net a payer/i;
// Ligne du total à payer (« TOTAL », « TOTAL TTC », « NET A PAYER », « MONTANT A PAYER »), sans les sous-totaux ni la TVA
const TOTAL_LINE = /\btotal\b|a\s+payer|à\s+payer/i;
const NOT_TOTAL = /sous[- ]?total|\btva\b|t\.v\.a|\bht\b|remise|[eé]conomi|fid[eé]lit|avantage|points?\b/i;
// Dernier montant d'une ligne
const LAST_AMOUNT = /(\d{1,5}[.,]\d{2})(?!.*\d[.,]\d{2})/;
// Nombre d'articles imprimé : « 25 ARTICLES », « NB ARTICLES : 25 », « NOMBRE D'ARTICLES 25 », « ARTICLES VENDUS 25 »
const ARTICLES_BEFORE = /\b(\d{1,3})\s*(?:articles?|art\.?)\b/i;
const ARTICLES_AFTER = /\b(?:nb|nbre|nombre)?\s*(?:d['’]\s*)?articles?(?:\s+vendus)?\s*:?\s*(\d{1,3})\b/i;

const lettersIn = (s: string) => (s.match(/[a-zà-ÿ]/gi) ?? []).length;
const sourceOf = (line: OcrLine): ReceiptSource => ({ image: line.image, box: line.box });

// Analyse le texte d'un reçu et rattache ses lignes aux données connues
export function parseReceipt(lines: OcrLine[], known: Known): ReceiptScanResult {
  const all = lines.filter((l) => l.text.trim());
  const texts = all.map((l) => l.text.trim());

  // ----- EN-TÊTE : enseigne, ville et adresse (premières lignes du ticket) -----
  const header = texts.slice(0, 12);
  const headerText = normalizeText(header.join(' '));
  const chainNames = [...new Set([...CHAINS, ...known.stores.map((s) => s.chain).filter((c): c is string => !!c)])];
  // L'enseigne est imprimée en gros (en gras) tout en haut : la ligne la plus haute des premières lignes
  const top = all.slice(0, 6).filter((l) => lettersIn(l.text) >= 3);
  const boldLine = top.length ? top.reduce((a, b) => (b.height > a.height ? b : a)) : null;
  const boldText = boldLine ? normalizeText(boldLine.text) : '';
  const chain =
    // Enseigne connue écrite sur la ligne en gros, sinon ailleurs dans l'en-tête, sinon le texte de la ligne en gros
    chainNames.find((c) => boldText.includes(normalizeText(c))) ??
    chainNames.find((c) => headerText.includes(normalizeText(c))) ??
    (boldLine ? sentenceCase(boldLine.text.replace(/[^a-zà-ÿ0-9'’ &-]/gi, ' ').replace(/\s+/g, ' ').trim()) || null : null);
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

  // ----- PIED : nombre d'articles et totaux imprimés -----
  let articleCount: number | null = null;
  const totals: ReceiptScanResult['totals'] = [];
  for (const line of all) {
    const text = line.text.trim();
    if (articleCount === null && /articles?|\bart\b/i.test(text)) {
      const m = text.match(ARTICLES_AFTER) ?? text.match(ARTICLES_BEFORE);
      if (m) articleCount = Number(m[1]);
    }
    if (TOTAL_LINE.test(text) && !NOT_TOTAL.test(text)) {
      const amount = text.match(LAST_AMOUNT);
      if (amount) totals.push({ amount: parsePrice(amount[1]), source: sourceOf(line), toPay: /payer/i.test(text) });
    }
  }

  // ----- LIGNES DE PRODUITS, dans l'ordre du ticket -----
  type Draft = { raw: string; total: number; quantity: number; perKg: boolean; confidence: number; sources: ReceiptSource[] };
  const drafts: Draft[] = [];
  let pending: { quantity: number; unit: number; perKg: boolean; source: ReceiptSource } | null = null;
  // Nom de produit imprimé seul sur sa ligne, sans prix (ex : « BANANES » au-dessus de la ligne de pesée)
  let nameOnly: { raw: string; confidence: number; source: ReceiptSource } | null = null;

  // Les articles commencent après la ligne d'en-tête des colonnes (« DÉSIGNATION ... PRIX », « LIBELLÉ  MONTANT »),
  // si le ticket en a une : l'en-tête du magasin, au-dessus, n'est pas lu comme des articles
  const columnsIndex = all.findIndex((l) => COLUMN_NAMES.test(l.text) && COLUMN_PRICES.test(l.text) && !/\d[.,]\d{2}/.test(l.text));
  const zone = columnsIndex >= 0 ? all.slice(columnsIndex + 1) : all;
  // Les lignes d'articles sont serrées les unes sous les autres : un grand espace vertical (plus de 1,8 fois la hauteur
  // d'une ligne) marque la fin de la liste des articles. Hauteur de référence : la médiane des lignes lues.
  const heights = zone.map((l) => l.box.y1 - l.box.y0).filter((h) => h > 0).sort((a, b) => a - b);
  const lineHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  let previous: OcrLine | null = null;

  for (const line of zone) {
    const text = line.text.trim();
    const confidence = line.confidence;
    const source = sourceOf(line);

    // Grand espace depuis la ligne précédente (sur la même photo) une fois des articles lus : fin des articles
    const gap = previous && previous.image === line.image ? line.box.y0 - previous.box.y1 : 0;
    if (drafts.length > 0 && lineHeight > 0 && gap > lineHeight * 1.8) break;
    previous = line;

    // Ligne qui contient un total : jamais un article ; après les articles, elle marque la fin de la liste
    if (ANY_TOTAL.test(text)) {
      if (drafts.length > 0) break;
      nameOnly = null;
      continue;
    }

    // Ligne de quantité ou de pesée (pas de nom devant) : elle précise le produit voisin
    const qtyMatch = quantityIn(text);
    if (qtyMatch && lettersIn(text.slice(0, qtyMatch.index).replace(/[x×]/gi, '')) < 3) {
      const isWeight = qtyMatch.perKg;
      const quantity = qtyMatch.quantity;
      const unit = qtyMatch.unit;
      // Montant de la ligne en fin de ligne s'il est imprimé, sinon quantité × prix unitaire
      const after = text.slice(qtyMatch.index + qtyMatch.length);
      const totalMatch = after.match(/(\d{1,4}[.,]\d{2})\s*(?:€|eur)?\s*(?:[a-z0-9]{1,2})?\s*\*?\s*$/i);
      const total = totalMatch ? parsePrice(totalMatch[1]) : Math.round(quantity * unit * 100) / 100;
      const last = drafts[drafts.length - 1];
      if (last && last.quantity === 1 && !nameOnly && Math.abs(last.total - total) <= 0.05) {
        // Précise le produit juste au-dessus (« YAOURT 1,78 » puis « 2 x 0,89 »)
        last.quantity = quantity;
        last.perKg = isWeight;
        last.sources.push(source);
      } else if (nameOnly) {
        // Complète le nom imprimé seul juste au-dessus (« BANANES » puis « 0,532 kg x 1,99 €/kg 1,06 »)
        drafts.push({ raw: nameOnly.raw, total, quantity, perKg: isWeight, confidence: nameOnly.confidence, sources: [nameOnly.source, source] });
      } else {
        // Sinon, précise le produit suivant
        pending = { quantity, unit, perKg: isWeight, source };
      }
      nameOnly = null;
      continue;
    }

    const m = text.match(ITEM);
    if (!m) {
      // Ligne de texte sans prix : peut-être un nom de produit dont le prix est sur la ligne suivante
      const raw = text.replace(/[^a-zà-ÿ0-9%.,'’/ -]/gi, ' ').replace(/\s+/g, ' ').trim();
      nameOnly = lettersIn(raw) >= 3 && !IGNORE.test(raw) ? { raw, confidence, source } : null;
      continue;
    }
    nameOnly = null;
    const label = m[1].trim();
    const amount = parsePrice(m[2]);

    // Remise : déduite du produit juste au-dessus
    if (DISCOUNT.test(label) || amount < 0) {
      const last = drafts[drafts.length - 1];
      if (last) {
        last.total = Math.max(0, last.total - Math.abs(amount));
        last.sources.push(source);
      }
      continue;
    }
    if (END.test(label) && drafts.length > 0) break;
    if (IGNORE.test(label)) continue;

    // Quantité imprimée sur la ligne du produit (« YAOURT 1,2x3 3,60 », « COCA 2 x 1,25 2,50 ») : le prix en fin
    // de ligne est celui de la ligne (prix unitaire × quantité) ; s'il n'est que le prix unitaire, on le multiplie
    const inline = quantityIn(label);
    let quantity = 1;
    let perKg = false;
    let total = amount;
    let nameText = label;
    if (inline) {
      quantity = inline.quantity;
      perKg = inline.perKg;
      nameText = `${label.slice(0, inline.index)} ${label.slice(inline.index + inline.length)}`;
      if (quantity > 1 && Math.abs(amount - inline.unit) <= 0.01) total = Math.round(inline.unit * quantity * 100) / 100;
    }

    // Nom nettoyé : codes article en tête et symboles retirés
    const raw = nameText.trim().replace(/^\d{3,}\s+/, '').replace(/[^a-zà-ÿ0-9%.,'’/ -]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (lettersIn(raw) < 2) continue;

    const draft: Draft = { raw, total, quantity, perKg, confidence, sources: [source] };
    if (!inline && pending && Math.abs(pending.quantity * pending.unit - amount) <= 0.05) {
      draft.quantity = pending.quantity;
      draft.perKg = pending.perKg;
      draft.sources.unshift(pending.source);
    }
    pending = null;
    drafts.push(draft);
  }

  // ----- RATTACHEMENT AUX DONNÉES CONNUES -----
  // Une ligne par produit imprimé, dans l'ordre du ticket (un même produit acheté deux fois garde ses deux lignes,
  // pour pouvoir comparer avec le ticket ligne à ligne)
  const items: ReceiptItem[] = drafts.map((d) => {
    const key = normalizeText(d.raw);
    const aliasId = known.aliases[key];
    const alias = aliasId ? known.ingredients.find((i) => i.id === aliasId) : undefined;
    const match = alias ? { item: alias, score: 1 } : bestMatch(d.raw, known.ingredients, (i) => i.name);
    const ingredient = match?.item;

    // Nom proposé : la ligne sans poids ni contenance
    const name = sentenceCase(
      d.raw
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
      category_id: ingredient?.category_id ?? null,
      type: d.perKg ? 'kg' : (ingredient?.type ?? null),
      quantity: d.quantity,
      unit_price: d.quantity > 0 ? Math.round((d.total / d.quantity) * 100) / 100 : null,
      confidence,
      sources: d.sources
    };
  });

  return {
    store_id: store?.id ?? null,
    store_chain: chain,
    store_name: store ? store.name : city,
    store_address: address,
    items,
    article_count: articleCount,
    totals
  };
}

// Nombre d'articles d'une liste de produits, compté comme sur un ticket : une pesée compte pour un article,
// sinon chaque unité compte (« 2 x 0,89 » = 2 articles)
export function countArticles(items: { quantity: number; type: string | null }[]) {
  return items.reduce((n, it) => n + (it.type === 'kg' ? 1 : Math.max(1, Math.round(it.quantity))), 0);
}

// Total à payer : quand le ticket imprime plusieurs totaux, c'est le plus grand (les autres sont des sous-totaux,
// des totaux de remises...)
export function toPayTotal(totals: ReceiptScanResult['totals']) {
  if (totals.length === 0) return null;
  return totals.reduce((best, t) => (t.amount > best.amount ? t : best));
}

// Total à comparer à la somme des produits
export function printedTotal(totals: ReceiptScanResult['totals']) {
  return toPayTotal(totals)?.amount ?? null;
}
