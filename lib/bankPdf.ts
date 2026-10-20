// Lecture des relevés de compte en PDF (testé sur les relevés LCL ; les relevés à colonnes Date / Libellé / Valeur / Débit / Crédit
// des autres banques françaises suivent le même principe). Le PDF est lu dans le navigateur avec pdf.js : rien n'est envoyé ailleurs.
// On repère la ligne d'en-tête du tableau des opérations, puis chaque mot est rangé dans sa colonne d'après sa position sur la page.

import { parseAmount, withImportKeys, type ParseResult, type ParsedTransaction, type StatementSummary } from '@/lib/bankImport';

export type PdfItem = { str: string; x: number; y: number; w: number };

type Row = { y: number; items: PdfItem[]; text: string };
type Raw = { date: string; amount: number; first: string; extra: string[] };

const DAY_MONTH = /^(\d{2})[./](\d{2})$/;
const FULL_DATE = /^(\d{2})[./](\d{2})[./](\d{2}|\d{4})$/;
const ROW_GAP = 16; // au-delà de cet écart vertical, une ligne sans date n'est plus la suite de l'opération précédente

// Mots d'une même ligne (à 2 points près), de haut en bas puis de gauche à droite
function toRows(items: PdfItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= 2);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item], text: '' });
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map((i) => i.str).join(' ');
  }
  return rows.sort((a, b) => b.y - a.y);
}

const fullDate = (s: string) => {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// "02.11" + période du relevé -> "2023-11-02" (l'année est celle qui tombe dans la période, utile à cheval sur deux années)
function resolveDate(dayMonth: string, valueDate: string | undefined, from: string | null, to: string | null) {
  const [, d, m] = dayMonth.match(DAY_MONTH)!;
  const years = new Set<number>();
  if (to) years.add(Number(to.slice(0, 4)));
  if (from) years.add(Number(from.slice(0, 4)));
  const v = valueDate?.match(FULL_DATE);
  if (v) years.add(v[3].length === 2 ? 2000 + Number(v[3]) : Number(v[3]));
  const candidates = [...years].map((y) => `${y}-${m}-${d}`);
  if (from && to) {
    const lo = new Date(new Date(from).getTime() - 10 * 86400000).toISOString().slice(0, 10);
    const hi = new Date(new Date(to).getTime() + 10 * 86400000).toISOString().slice(0, 10);
    const inside = candidates.find((c) => c >= lo && c <= hi);
    if (inside) return inside;
  }
  return candidates[0] ?? null;
}

// Type de compte d'après le titre du relevé (en haut de la première page) : nom proposé pour le compte, et s'il s'agit d'épargne
const ACCOUNT_TYPES: [RegExp, string, boolean][] = [
  [/LIVRET\s+(D['’]\s*)?[ÉE]PARGNE\s+POPULAIRE|\bLEP\b/i, 'LEP', true],
  [/LIVRET\s+(DE\s+)?D[ÉE]VELOPPEMENT\s+DURABLE|\bLDDS?\b/i, 'LDDS', true],
  [/LIVRET\s+JEUNE/i, 'Livret Jeune', true],
  [/COMPTE\s+[ÉE]PARGNE\s+LOGEMENT|\bCEL\b/i, 'CEL', true],
  [/LIVRET\s+A\b/i, 'Livret A', true],
  [/LIVRET/i, 'Livret', true],
  [/RELEV[ÉE]\s+DE\s+COMPTE|COMPTE\s+DE\s+D[ÉE]P[ÔO]TS|COMPTE\s+COURANT/i, 'Compte courant', false]
];

function accountType(title: string) {
  const found = ACCOUNT_TYPES.find(([re]) => re.test(title));
  return { accountName: found?.[1] ?? null, savings: found?.[2] ?? false };
}

const MONTHS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

// "SOLDE INTERMEDIAIRE A FIN JUIN" + période du relevé -> "2026-06"
function monthEndOf(text: string, from: string | null, to: string | null) {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const m = MONTHS.findIndex((name) => new RegExp(`FIN\\s+(DE\\s+)?${name}\\b`).test(plain)) + 1;
  if (!m) return null;
  const years = [...new Set([to, from].filter(Boolean).map((d) => Number(d!.slice(0, 4))))];
  const candidates = years.map((y) => `${y}-${String(m).padStart(2, '0')}`);
  return candidates.find((c) => (!from || c >= from.slice(0, 7)) && (!to || c <= to.slice(0, 7))) ?? candidates[0] ?? null;
}

// Lignes de détail sans intérêt pour comprendre l'opération
const NOISE = /^(REF\.?\s*CLIENT|ID\.?\s*CREANCIER|REF\.?\s*MANDAT|CREANCIER INITIAL|NATURE DU PAIEMENT|LIBELLE\s*:\s*NOTPROVIDED)/i;

// Construit les opérations : libellé enrichi des lignes de détail utiles, commission de change isolée en frais bancaires
function finalize(raws: Raw[], holder: string | null): Omit<ParsedTransaction, 'importKey'>[] {
  const result: Omit<ParsedTransaction, 'importKey'>[] = [];
  for (const raw of raws) {
    let fee = 0;
    let foreign = '';
    const details: string[] = [];
    for (const line of raw.extra) {
      const commission = line.match(/^COM(?:MISSION)?\s+CHANGE\s+([\d\s]*\d,\d{2})\s*E/i);
      const currency = line.match(/\b([A-Z]{3})\s+([\d\s]*\d,\d{2})$/);
      if (commission) fee = parseAmount(commission[1]) ?? 0;
      else if (currency) {
        if (currency[1] !== 'EUR') foreign = `${currency[2]} ${currency[1]}`;
      } else if (!NOISE.test(line)) details.push(line.replace(/^LIBELLE\s*:\s*/i, ''));
    }
    const label = [raw.first, ...details].join(' · ').slice(0, 160) + (foreign ? ` (${foreign})` : '');
    if (fee > 0 && raw.amount < 0 && fee < -raw.amount) {
      // Paiement en devise : la banque ajoute sa commission au montant, on la sépare pour la voir dans les frais
      result.push({ date: raw.date, amount: Math.round((raw.amount + fee) * 100) / 100, label });
      result.push({ date: raw.date, amount: -fee, label: `COM CHANGE · ${raw.first}` });
    } else result.push({ date: raw.date, amount: raw.amount, label, ...(isOwnTransfer(raw.first, holder) && { category: 'virement_interne' }) });
  }
  return result;
}

export function parsePdfStatement(pages: PdfItem[][]): ParseResult {
  const allRows = pages.map(toRows);
  const allText = allRows.flat().map((r) => r.text).join('\n');
  const period = allText.match(/du\s+(\d{2}\.\d{2}\.\d{4})\s+au\s+(\d{2}\.\d{2}\.\d{4})/i);
  const summary: StatementSummary = {
    from: period ? fullDate(period[1]) : null,
    to: period ? fullDate(period[2]) : null,
    opening: null,
    closing: null,
    totalDebit: null,
    totalCredit: null,
    account: allText.match(/Compte\s*:\s*([0-9A-Z][0-9A-Z ]{3,20}[0-9A-Z])/)?.[1].trim() ?? null,
    holder: allText.match(/^(?:MME|MLLE|MR|M\.?|MADAME|MONSIEUR)\s+([A-Z][A-Z' -]{4,})$/im)?.[1].trim() ?? null,
    ...accountType(allRows[0]?.slice(0, 6).map((r) => r.text).join(' ') ?? ''),
    monthEnds: [],
    verified: null
  };

  const raws: Raw[] = [];
  let skipped = 0;
  let finished = false;

  for (const rows of allRows) {
    if (finished) break;
    // En-tête du tableau des opérations : DATE ... DEBIT ... CREDIT sur la même ligne
    const headerIndex = rows.findIndex(
      (r) => r.items.some((i) => /^date$/i.test(i.str.trim())) && r.items.some((i) => /^d[ée]bit$/i.test(i.str.trim())) && r.items.some((i) => /^cr[ée]dit$/i.test(i.str.trim()))
    );
    if (headerIndex < 0) continue;
    const header = rows[headerIndex].items;
    const col = (re: RegExp) => header.find((i) => re.test(i.str.trim()));
    const dateCol = col(/^date$/i)!;
    const debitCol = col(/^d[ée]bit$/i)!;
    const creditCol = col(/^cr[ée]dit$/i)!;
    const valueCol = col(/^valeur$/i);
    const debitCenter = debitCol.x + debitCol.w / 2;
    const creditCenter = creditCol.x + creditCol.w / 2;
    const labelEnd = (valueCol?.x ?? debitCol.x) - 2;
    const labelStart = dateCol.x + dateCol.w + 4;

    let current: Raw | null = null;
    let lastY = rows[headerIndex].y;

    for (const row of rows.slice(headerIndex + 1)) {
      // Montants : à droite du libellé, rangés dans la colonne Débit ou Crédit la plus proche
      let debit = 0;
      let credit = 0;
      let hasAmount = false;
      for (const item of row.items) {
        const center = item.x + item.w / 2;
        if (center <= labelEnd || FULL_DATE.test(item.str.trim())) continue;
        const n = parseAmount(item.str);
        if (n === null) continue;
        hasAmount = true;
        if (Math.abs(center - debitCenter) < Math.abs(center - creditCenter)) debit += Math.abs(n);
        else credit += Math.abs(n);
      }
      const labelItems = row.items.filter((i) => i.x >= labelStart - 8 && i.x + i.w / 2 < labelEnd);
      const labelText = labelItems.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const first = row.items[0];
      const dateItem = first && first.x < labelStart && DAY_MONTH.test(first.str.trim()) ? first : null;

      if (/ANCIEN\s+SOLDE/i.test(row.text)) {
        if (hasAmount) summary.opening = Math.round((credit - debit) * 100) / 100;
      } else if (/^TOTAUX\b/i.test(labelText) || /\bTOTAUX\b/.test(row.text)) {
        summary.totalDebit = debit;
        summary.totalCredit = credit;
      } else if (/SOLDE\s+INTERM[ÉE]DIAIRE/i.test(row.text)) {
        // Relevés de livret : solde à chaque fin de mois ("SOLDE INTERMEDIAIRE A FIN JUIN")
        const month = monthEndOf(row.text, summary.from, summary.to);
        if (month && hasAmount) summary.monthEnds.push({ month, balance: Math.round((credit - debit) * 100) / 100 });
        current = null;
      } else if (/SOLDE\s+EN\s+EUROS|NOUVEAU\s+SOLDE|SOLDE\s+AU\b/i.test(row.text)) {
        if (hasAmount) summary.closing = Math.round((credit - debit) * 100) / 100;
        finished = true;
        break;
      } else if (dateItem && hasAmount) {
        const valueDate = row.items.find((i) => i !== dateItem && FULL_DATE.test(i.str.trim()))?.str.trim();
        const date = resolveDate(dateItem.str.trim(), valueDate, summary.from, summary.to);
        if (!date || debit === credit) skipped++;
        else {
          current = { date, amount: Math.round((credit - debit) * 100) / 100, first: labelText || 'Opération', extra: [] };
          raws.push(current);
        }
      } else if (current && !dateItem && !hasAmount && labelText && lastY - row.y <= ROW_GAP && labelItems.length === row.items.length) {
        current.extra.push(labelText);
      } else {
        current = null;
      }
      lastY = row.y;
    }
  }

  summary.verified = verify(raws, summary);
  return { format: 'pdf', transactions: withImportKeys(finalize(raws, summary.holder), 'pdf'), skipped, summary };
}

// Virement envoyé à soi-même (ou reçu de soi-même) : au moins deux mots du nom du titulaire dans le libellé d'un virement.
// C'est un mouvement entre deux de tes comptes, ni une dépense ni un revenu.
function isOwnTransfer(label: string, holder: string | null) {
  if (!holder || !/^VIR/i.test(label)) return false;
  const words = label.toUpperCase().split(/[^A-Z]+/);
  return holder.toUpperCase().split(/[\s'-]+/).filter((w) => w.length >= 3 && words.includes(w)).length >= 2;
}

// Vérifie qu'aucune opération n'a été oubliée : ancien solde + crédits - débits = nouveau solde, et totaux identiques
// (certaines banques, dont LCL, comptent l'ancien solde dans la ligne des totaux)
function verify(raws: Raw[], s: StatementSummary) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const debit = raws.filter((r) => r.amount < 0).reduce((t, r) => t - r.amount, 0);
  const credit = raws.filter((r) => r.amount > 0).reduce((t, r) => t + r.amount, 0);
  const checks: boolean[] = [];
  if (s.opening !== null && s.closing !== null) checks.push(near(s.opening + credit - debit, s.closing));
  if (s.totalDebit !== null && s.totalCredit !== null) {
    const o = s.opening ?? 0;
    checks.push(
      (near(s.totalDebit, debit) && near(s.totalCredit, credit)) || (near(s.totalDebit, debit + Math.max(0, -o)) && near(s.totalCredit, credit + Math.max(0, o)))
    );
  }
  return checks.length ? checks.every(Boolean) : null;
}

// Ouvre le PDF avec pdf.js (chargé seulement quand on importe un PDF) et récupère les mots avec leur position
export async function readPdfStatement(file: File): Promise<ParseResult> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(
      content.items
        // Texte horizontal seulement (les mentions écrites à la verticale dans la marge sont ignorées)
        .filter((i) => 'str' in i && i.str.trim() && i.transform[1] === 0 && i.transform[2] === 0)
        .map((i) => {
          const t = i as { str: string; transform: number[]; width: number };
          return { str: t.str, x: t.transform[4], y: t.transform[5], w: t.width };
        })
    );
  }
  await doc.destroy();
  return parsePdfStatement(pages);
}
