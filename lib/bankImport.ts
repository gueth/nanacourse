// Lecture des relevés bancaires exportés depuis l'espace client de la banque (CSV, OFX ; PDF dans bankPdf.ts).
// Tout se passe dans le navigateur : le fichier n'est envoyé à aucun service extérieur,
// seules les opérations reconnues sont ensuite enregistrées dans Supabase.

export type ParsedTransaction = {
  date: string; // AAAA-MM-JJ
  label: string;
  amount: number; // négatif pour une dépense
  importKey: string; // identifiant stable, pour ne jamais importer deux fois la même opération
  category?: string; // catégorie déjà connue à la lecture (ex. virement vers un compte au nom du titulaire)
};

export type ParseResult = {
  format: 'csv' | 'ofx' | 'pdf';
  transactions: ParsedTransaction[];
  skipped: number; // lignes ignorées (sans date ou sans montant lisible)
  summary?: StatementSummary; // soldes et totaux, quand le relevé les donne (PDF)
};

// Ce que le relevé dit en plus des opérations : période, soldes et totaux (pour vérifier qu'il ne manque rien)
export type StatementSummary = {
  from: string | null; // AAAA-MM-JJ
  to: string | null;
  opening: number | null; // ancien solde
  closing: number | null; // nouveau solde
  totalDebit: number | null;
  totalCredit: number | null;
  account: string | null; // numéro de compte
  holder: string | null; // titulaire du compte
  accountName: string | null; // nom du compte d'après le titre du relevé : « Compte courant », « Livret A », « LEP »...
  savings: boolean; // compte d'épargne (livret) plutôt que compte courant
  monthEnds: { month: string; balance: number }[]; // soldes de fin de mois donnés par le relevé (AAAA-MM), relevés de livret
  verified: boolean | null; // opérations lues = totaux et soldes du relevé (null : le relevé ne les donne pas)
};

// Les banques françaises exportent souvent en Windows-1252 : on tente l'UTF-8, sinon on bascule
export async function readStatementFile(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// "1 234,56" / "-12.30" / "1.234,56 €" / "(12,00)" -> nombre ; null si illisible
export function parseAmount(text: string | undefined) {
  if (!text) return null;
  let t = text.replace(/[\s  €]|EUR/gi, '');
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith('-')) {
    negative = true;
    t = t.slice(0, -1);
  }
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  if (comma > -1 && dot > -1) {
    // Le dernier séparateur est celui des décimales, l'autre sépare les milliers
    t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (comma > -1) {
    t = t.replace(',', '.');
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t) * (negative ? -1 : 1);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// "31/10/2026", "31-10-26", "2026-10-31", "20261031" -> "2026-10-31" ; null si ce n'est pas une date
export function parseDate(text: string | undefined) {
  if (!text) return null;
  const t = text.trim();
  let y: number, m: number, d: number;
  let match = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (match) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = t.match(/^(\d{4})(\d{2})(\d{2})/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizeHeader(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Découpe un CSV en lignes et cellules, en respectant les guillemets
function splitCsv(text: string, sep: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

// Séparateur le plus fréquent dans les premières lignes (le point-virgule l'emporte : les montants contiennent des virgules)
function detectSeparator(text: string) {
  const head = text.split(/\r?\n/).slice(0, 20).join('\n');
  const count = (s: string) => head.split(s).length - 1;
  const semicolons = count(';');
  const tabs = count('\t');
  if (semicolons >= tabs && semicolons > 0) return ';';
  if (tabs > 0) return '\t';
  return ',';
}

type Columns = { date: number; labels: number[]; amount: number; debit: number; credit: number };

// Repère la ligne d'en-tête (après d'éventuelles lignes d'informations sur le compte) et ses colonnes
function findHeader(rows: string[][]): { index: number; cols: Columns } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map(normalizeHeader);
    const dates = cells.map((c, i) => (/date/.test(c) ? i : -1)).filter((i) => i >= 0);
    const isAmount = (c: string) => /montant|amount|somme/.test(c) && !/solde|balance/.test(c);
    const amount = cells.findIndex(isAmount);
    const debit = cells.findIndex((c) => /debit/.test(c) && !/date/.test(c));
    const credit = cells.findIndex((c) => /credit/.test(c) && !/date/.test(c));
    if (dates.length === 0 || (amount < 0 && debit < 0 && credit < 0)) continue;
    const date = dates.find((i) => /op|compta/.test(cells[i])) ?? dates[0];
    const labels = cells
      .map((c, i) => (/libelle|label|description|intitule|detail|nature|beneficiaire|motif|operation/.test(c) && !dates.includes(i) ? i : -1))
      .filter((i) => i >= 0 && i !== amount && i !== debit && i !== credit);
    return { index: r, cols: { date, labels, amount, debit, credit } };
  }
  return null;
}

function cleanLabel(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

// Clé d'import : date, montant, libellé, et rang parmi les opérations identiques du fichier
// (deux cafés identiques le même jour restent deux opérations, mais un même relevé importé deux fois ne double rien)
export function withImportKeys(rows: Omit<ParsedTransaction, 'importKey'>[], prefix = 'csv') {
  const seen = new Map<string, number>();
  return rows.map((t) => {
    const base = `${t.date}|${t.amount.toFixed(2)}|${t.label.toUpperCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...t, importKey: `${prefix}:${base}|${n}` };
  });
}

function parseCsv(text: string): ParseResult {
  const rows = splitCsv(text, detectSeparator(text));
  const header = findHeader(rows);
  const parsed: Omit<ParsedTransaction, 'importKey'>[] = [];
  let skipped = 0;

  if (header) {
    const { date: dc, labels, amount: ac, debit, credit } = header.cols;
    for (const row of rows.slice(header.index + 1)) {
      const date = parseDate(row[dc]);
      let amount: number | null = null;
      if (ac >= 0) amount = parseAmount(row[ac]);
      if (amount === null && (debit >= 0 || credit >= 0)) {
        const d = parseAmount(row[debit]);
        const c = parseAmount(row[credit]);
        if (d !== null || c !== null) amount = Math.round(((c ?? 0) - Math.abs(d ?? 0)) * 100) / 100;
      }
      const label = cleanLabel(labels.map((i) => row[i]).find((v) => v) ?? '');
      if (!date || amount === null || amount === 0) {
        skipped++;
        continue;
      }
      parsed.push({ date, amount, label: label || 'Opération' });
    }
  } else {
    // Pas d'en-tête reconnu : date = première cellule datée, montant = dernière cellule chiffrée, libellé = texte le plus long
    for (const row of rows) {
      const dateIndex = row.findIndex((c) => parseDate(c));
      const amounts = row.map((c, i) => (i !== dateIndex && !parseDate(c) && /\d/.test(c) ? parseAmount(c) : null));
      const amountIndex = amounts.map((a, i) => (a !== null ? i : -1)).filter((i) => i >= 0).pop();
      if (dateIndex < 0 || amountIndex === undefined || !amounts[amountIndex]) {
        skipped++;
        continue;
      }
      const label = row
        .filter((c, i) => i !== dateIndex && i !== amountIndex && !/^[\d\s.,+-]*$/.test(c))
        .sort((a, b) => b.length - a.length)[0];
      parsed.push({ date: parseDate(row[dateIndex])!, amount: amounts[amountIndex]!, label: cleanLabel(label ?? 'Opération') });
    }
  }
  return { format: 'csv', transactions: withImportKeys(parsed), skipped };
}

// OFX (format "Money" proposé par la plupart des banques) : un bloc <STMTTRN> par opération
function parseOfx(text: string): ParseResult {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const transactions: ParsedTransaction[] = [];
  let skipped = 0;
  const fallback: Omit<ParsedTransaction, 'importKey'>[] = [];
  for (const block of blocks) {
    const tag = (name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'))?.[1].trim();
    const date = parseDate(tag('DTPOSTED'));
    const amount = parseAmount(tag('TRNAMT'));
    const name = tag('NAME') ?? '';
    const memo = tag('MEMO') ?? '';
    const label = cleanLabel(memo && !name.includes(memo) ? `${name} ${memo}` : name || memo) || 'Opération';
    if (!date || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    const fitid = tag('FITID');
    if (fitid) transactions.push({ date, amount, label, importKey: `ofx:${fitid}|${date}|${amount.toFixed(2)}` });
    else fallback.push({ date, amount, label });
  }
  return { format: 'ofx', transactions: [...transactions, ...withImportKeys(fallback)], skipped };
}

export function parseStatement(text: string): ParseResult {
  return /<OFX>|OFXHEADER/i.test(text) ? parseOfx(text) : parseCsv(text);
}
