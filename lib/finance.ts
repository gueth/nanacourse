import { supabase } from '@/lib/supabase';

// Finances personnelles : un bilan (ce que l'on possède et ce que l'on doit, en fin de mois)
// et un compte de résultat (ce qui est entré et sorti pendant le mois), mois par mois.
//
// Table à créer dans Supabase (éditeur SQL) :
//
//   create table finance_lines (
//     id uuid primary key default gen_random_uuid(),
//     period text not null,          -- mois concerné, AAAA-MM
//     statement text not null,       -- 'bilan' ou 'resultat'
//     section text not null,         -- identifiant de la rubrique (voir SECTIONS)
//     label text not null,
//     amount numeric not null default 0,
//     position int not null default 0,
//     created_at timestamptz not null default now()
//   );
//   create index finance_lines_period on finance_lines (period);

export type Statement = 'bilan' | 'resultat';

// Côté de chaque document : actif / passif pour le bilan, produits / charges pour le résultat
export type Side = 'actif' | 'passif' | 'produits' | 'charges';

export type FinanceLine = {
  id: string;
  period: string;
  statement: Statement;
  section: string;
  label: string;
  amount: number;
  position: number;
  auto?: boolean; // montant calculé par l'import des relevés (recalculé aux imports suivants) ; sinon saisi à la main, jamais modifié par l'import
};

export type Section = { id: string; statement: Statement; side: Side; title: string; template: string[] };

// Rubriques et lignes proposées par défaut (modèle de départ d'un mois vide)
export const SECTIONS: Section[] = [
  // Bilan — actif
  { id: 'liquidites', statement: 'bilan', side: 'actif', title: 'Liquidités', template: ['Compte courant', 'Livret A', 'LDDS', 'Espèces'] },
  { id: 'placements', statement: 'bilan', side: 'actif', title: 'Placements', template: ['Assurance-vie', 'PEA', 'Épargne retraite (PER)', 'Compte-titres'] },
  { id: 'biens', statement: 'bilan', side: 'actif', title: 'Biens', template: ['Résidence principale', 'Véhicule', 'Autres biens de valeur'] },
  { id: 'creances', statement: 'bilan', side: 'actif', title: 'Sommes à recevoir', template: ['Prêts accordés à des proches', 'Remboursements attendus'] },
  // Bilan — passif (dettes ; le patrimoine net est calculé)
  { id: 'emprunts', statement: 'bilan', side: 'passif', title: 'Emprunts', template: ['Crédit immobilier', 'Crédit auto', 'Crédit à la consommation'] },
  { id: 'dettes', statement: 'bilan', side: 'passif', title: 'Autres dettes', template: ['Découvert', 'Impôts à payer', 'Dettes envers des proches'] },
  // Compte de résultat — produits
  { id: 'revenus', statement: 'resultat', side: 'produits', title: "Revenus d'activité", template: ['Salaire net', 'Primes', 'Revenus complémentaires'] },
  { id: 'autres_revenus', statement: 'resultat', side: 'produits', title: 'Autres revenus', template: ['Aides et allocations', 'Revenus locatifs', 'Intérêts et dividendes'] },
  // Compte de résultat — charges
  { id: 'logement', statement: 'resultat', side: 'charges', title: 'Logement', template: ['Loyer ou mensualité', 'Charges', 'Énergie', 'Eau', 'Internet et téléphone'] },
  { id: 'vie_courante', statement: 'resultat', side: 'charges', title: 'Vie courante', template: ['Courses', 'Restaurants', 'Hygiène et santé', 'Habillement'] },
  { id: 'transport', statement: 'resultat', side: 'charges', title: 'Transport', template: ['Carburant', 'Transports en commun', 'Entretien du véhicule'] },
  { id: 'engagements', statement: 'resultat', side: 'charges', title: 'Engagements', template: ['Assurances', 'Abonnements', 'Remboursements de crédit', 'Impôts'] },
  { id: 'loisirs', statement: 'resultat', side: 'charges', title: 'Loisirs', template: ['Sorties', 'Voyages', 'Cadeaux'] }
];

// Ligne "Courses" du compte de résultat : on peut y reporter les courses enregistrées dans l'appli
export const GROCERIES = { section: 'vie_courante', label: 'Courses' };

// --- Mois (AAAA-MM) ---

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(period: string, delta: number) {
  const [y, m] = period.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

// "octobre 2026"
export function monthLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// "31 octobre 2026" : date du bilan (dernier jour du mois)
export function monthEndLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// --- Montants ---

export function formatEuros(n: number) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

export function sum(lines: FinanceLine[]) {
  return lines.reduce((s, l) => s + Number(l.amount), 0);
}

// Totaux d'un mois : bilan (actif, dettes, patrimoine net) et résultat (produits, charges, épargne)
export function totals(lines: FinanceLine[]) {
  const bySide = (side: Side) => sum(lines.filter((l) => SECTIONS.find((s) => s.id === l.section)?.side === side));
  const actif = bySide('actif');
  const dettes = bySide('passif');
  const produits = bySide('produits');
  const charges = bySide('charges');
  const resultat = produits - charges;
  return {
    actif,
    dettes,
    patrimoine: actif - dettes,
    produits,
    charges,
    resultat,
    tauxEpargne: produits > 0 ? resultat / produits : null
  };
}

// --- Base de données ---

export async function fetchLines(period: string) {
  const { data, error } = await supabase
    .from('finance_lines')
    .select('*')
    .eq('period', period)
    .order('position')
    .order('created_at');
  return { lines: ((data as FinanceLine[]) ?? []).map((l) => ({ ...l, amount: Number(l.amount) })), error };
}

// Remplit un mois vide : avec le modèle (montants à zéro), ou en reprenant les lignes d'un autre mois
export async function seedMonth(period: string, from: FinanceLine[] | null) {
  const rows = from
    ? from.map(({ statement, section, label, amount, position, auto }) => ({ period, statement, section, label, amount, position, ...(auto && { auto }) }))
    : SECTIONS.flatMap((s) =>
        s.template.map((label, position) => ({ period, statement: s.statement, section: s.id, label, amount: 0, position }))
      );
  const { error } = await supabase.from('finance_lines').insert(rows);
  return error;
}

// Lignes d'un mois, après l'avoir rempli s'il était vide : avec les lignes du mois précédent, à zéro pour le compte de résultat
// et pour les montants venus des relevés (un solde de compte n'est inscrit que par le relevé du mois), ou à défaut avec le modèle
export async function fetchOrSeedLines(period: string) {
  const first = await fetchLines(period);
  if (first.error || first.lines.length > 0) return first;
  const before = await fetchLines(shiftMonth(period, -1));
  const error = await seedMonth(
    period,
    before.lines.length > 0 ? before.lines.map((l) => (l.statement === 'resultat' || l.auto ? { ...l, amount: 0, auto: false } : l)) : null
  );
  return error ? { lines: [] as FinanceLine[], error } : fetchLines(period);
}

// Ce que l'import peut faire d'une ligne : la remplir si elle est vide ou absente, la recalculer si elle vient déjà
// d'un import, mais jamais toucher un montant saisi à la main
export const importMayWrite = (line: FinanceLine | undefined) => !line || line.amount === 0 || line.auto === true;

// Inscrit un montant calculé par l'import sur une ligne d'une rubrique (créée si besoin), sans toucher aux saisies à la main.
// Sans "replaceAuto", une ligne déjà calculée par un import est gardée aussi (pour une valeur moins sûre, ex. solde en milieu de mois).
// "force" : le montant vient d'un relevé pour un mois qu'il couvre, il remplace tout ce qui était inscrit (même à la main).
export async function setLineAmount(period: string, sectionId: string, label: string, amount: number, replaceAuto = true, force = false) {
  const { lines, error } = await fetchOrSeedLines(period);
  if (error) return error;
  const existing = lines.find((l) => l.section === sectionId && l.label.toLowerCase() === label.toLowerCase());
  if (existing) {
    if (force) return existing.amount === amount && existing.auto ? null : updateLine(existing.id, { amount, auto: true });
    if (!importMayWrite(existing) || (!replaceAuto && existing.amount !== 0)) return null;
    return updateLine(existing.id, { amount, auto: true });
  }
  const { line, error: err } = await addLine(period, SECTIONS.find((s) => s.id === sectionId)!, label, 100);
  return err ?? (line ? updateLine(line.id, { amount, auto: true }) : null);
}

export async function addLine(period: string, section: Section, label: string, position: number) {
  const { data, error } = await supabase
    .from('finance_lines')
    .insert({ period, statement: section.statement, section: section.id, label, amount: 0, position })
    .select()
    .single();
  return { line: data ? ({ ...data, amount: Number(data.amount) } as FinanceLine) : null, error };
}

// La colonne "auto" peut manquer si le script SQL n'a pas encore été exécuté
const missingAutoColumn = (message: string) => /auto/i.test(message) && /(column|schema cache)/i.test(message);
let autoColumnMissing = false;

export async function updateLine(id: string, changes: Partial<Pick<FinanceLine, 'label' | 'amount' | 'auto'>>) {
  const { auto, ...rest } = changes;
  const withAuto = auto !== undefined && !autoColumnMissing;
  const { error } = await supabase.from('finance_lines').update(withAuto ? changes : rest).eq('id', id);
  if (error && withAuto && missingAutoColumn(error.message)) {
    // Sans la colonne, on enregistre quand même le montant : seule la distinction saisie à la main / calculée par l'import est perdue
    autoColumnMissing = true;
    if (Object.keys(rest).length === 0) return null;
    return (await supabase.from('finance_lines').update(rest).eq('id', id)).error;
  }
  return error;
}

export async function deleteLine(id: string) {
  const { error } = await supabase.from('finance_lines').delete().eq('id', id);
  return error;
}

// Total des courses enregistrées dans l'appli pendant le mois (table "expenses")
export async function groceriesTotal(period: string) {
  const [y, m] = period.split('-').map(Number);
  const { data, error } = await supabase
    .from('expenses')
    .select('amount')
    .gte('spent_at', new Date(y, m - 1, 1).toISOString())
    .lt('spent_at', new Date(y, m, 1).toISOString());
  if (error) console.error(error);
  return Math.round(((data ?? []) as { amount: number }[]).reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
}

// Lignes de plusieurs mois d'un coup (de "from" à "to" inclus, au format AAAA-MM)
export async function fetchLinesRange(from: string, to: string) {
  const { data, error } = await supabase
    .from('finance_lines')
    .select('*')
    .gte('period', from)
    .lte('period', to)
    .order('position');
  return { lines: ((data as FinanceLine[]) ?? []).map((l) => ({ ...l, amount: Number(l.amount) })), error };
}

// --- Indicateurs du tableau de bord ---

const inSections = (lines: FinanceLine[], ids: string[]) => sum(lines.filter((l) => ids.includes(l.section)));

// Dépenses indispensables du mois : logement, vie courante, transport, engagements (tout sauf les loisirs)
export const essentialCharges = (lines: FinanceLine[]) => inSections(lines, ['logement', 'vie_courante', 'transport', 'engagements']);

// Argent disponible rapidement : la rubrique Liquidités du bilan
export const liquidAssets = (lines: FinanceLine[]) => inSections(lines, ['liquidites']);

// Revenus qui ne viennent pas du travail : loyers perçus, intérêts, dividendes
export const passiveIncome = (lines: FinanceLine[]) =>
  sum(lines.filter((l) => l.section === 'autres_revenus' && /locati|loyer|int[ée]r[êe]t|dividende|rente|coupon/i.test(l.label)));

// Mensualités de crédit inscrites dans les charges
export const creditPayments = (lines: FinanceLine[]) =>
  sum(lines.filter((l) => l.section === 'engagements' && /cr[ée]dit|emprunt|pr[êe]t/i.test(l.label)));

// Répartition du patrimoine (côté actif du bilan) par rubrique
export function assetSplit(lines: FinanceLine[]) {
  return SECTIONS.filter((s) => s.side === 'actif')
    .map((s) => ({ id: s.id, title: s.title, amount: inSections(lines, [s.id]) }))
    .filter((s) => s.amount > 0);
}

// Regroupe des lignes par mois
export function byPeriod(lines: FinanceLine[]) {
  const map = new Map<string, FinanceLine[]>();
  for (const l of lines) map.set(l.period, [...(map.get(l.period) ?? []), l]);
  return map;
}

// Médiane : la valeur du milieu une fois les nombres rangés (moyenne des deux du milieu s'ils sont en nombre pair).
// Contrairement à la moyenne, un mois exceptionnel (vacances, grosse réparation) ne la fausse pas.
export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Les chiffres clés d'un mois terminé (cartes de l'accueil) : patrimoine net, réserve de sécurité (liquidités divisées
// par la médiane des dépenses des 6 mois jusqu'à ce mois), taux d'épargne du mois, et dividendes et intérêts perçus
export function monthIndicators(lines: FinanceLine[], month: string) {
  const periods = byPeriod(lines.filter((l) => l.amount !== 0));
  const L = periods.get(month) ?? [];
  const t = totals(L);
  const six = Array.from({ length: 6 }, (_, i) => shiftMonth(month, -i))
    .map((p) => (periods.has(p) ? totals(periods.get(p)!).charges : 0))
    .filter((c) => c > 0);
  const medianSpent = six.length ? median(six) : t.charges;
  return {
    patrimoine: t.patrimoine,
    reserve: medianSpent > 0 ? liquidAssets(L) / medianSpent : null,
    savings: t.resultat,
    savingsRate: t.tauxEpargne,
    dividends: sum(L.filter((l) => l.section === 'autres_revenus' && /dividende|int[ée]r[êe]t|coupon/i.test(l.label)))
  };
}

// Photo de la situation : moyennes des 4 derniers mois terminés (le mois en cours, incomplet, est exclu)
// et bilan du dernier mois terminé rempli ; à défaut, le mois en cours
export function snapshot(lines: FinanceLine[], currentMonth: string) {
  const periods = byPeriod(lines.filter((l) => l.amount !== 0 && l.period <= currentMonth));
  const filled = [...periods.keys()].sort();
  const done = filled.filter((p) => p < currentMonth && p >= shiftMonth(currentMonth, -4));
  const ref = filled.filter((p) => p < currentMonth).pop() ?? (periods.has(currentMonth) ? currentMonth : null);
  const last = ref ? periods.get(ref)! : [];
  const recent = (done.length ? done : ref ? [ref] : []).map((p) => periods.get(p)!).filter((ls) => totals(ls).produits > 0);
  const avg = (f: (ls: FinanceLine[]) => number, fallback: number) =>
    recent.length ? recent.reduce((s, ls) => s + f(ls), 0) / recent.length : fallback;
  const t = totals(last);
  return {
    ref,
    income: avg((ls) => totals(ls).produits, t.produits),
    charges: avg((ls) => totals(ls).charges, t.charges),
    essentials: avg(essentialCharges, essentialCharges(last)),
    savings: avg((ls) => totals(ls).resultat, t.resultat),
    credit: creditPayments(last),
    liquid: liquidAssets(last),
    patrimoine: t.patrimoine
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
