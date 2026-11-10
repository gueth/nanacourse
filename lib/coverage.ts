import { isSavingsAccount } from '@/lib/transactions';
import type { FinanceLine } from '@/lib/finance';

// Relevés présents ou manquants, mois par mois (données chargées par fetchCoverage, lib/transactions).
// Règles, partagées par le Bilan, l'accueil et l'état de santé :
//  - un compte est suivi par relevés à partir du premier mois qu'un relevé importé renseigne ;
//  - pour un mois donné, son relevé est présent si un relevé importé renseigne ce compte pour ce mois
//    (table statement_months, ou opérations importées), ou si une opération y a été ajoutée à la main sur ce compte
//    (une note le signale alors sur le Bilan) ;
//  - sinon il manque : son solde n'est pas connu, ni le patrimoine du mois ; si c'est un compte courant,
//    le compte de résultat du mois (revenus, dépenses, épargne) ne l'est pas non plus. Un livret manquant ne touche
//    pas au résultat : seuls les comptes courants le font.
//  - exception : le relevé d'un livret (Livret A, LEP...) arrive souvent bien après la fin du mois. Son solde est alors
//    estimé (voir estimateSavings, lib/transactions) : dernier solde connu, plus les virements entre mes comptes vus
//    depuis sur les autres comptes. Le relevé reste signalé comme manquant, et le solde comme estimé.
export type TrackedAccount = { account: string; first: string };
export type ManualNote = { account: string; month: string; count: number };
// Solde estimé d'un livret à la fin d'un mois sans relevé ; balance null : des virements sont à préciser (questions)
export type SavingsEstimate = { account: string; month: string; base: string; balance: number | null };
// Virement entre mes comptes dont on ne sait pas vers quel compte (ou de quel compte) va l'argent : à préciser.
// choices : mes autres comptes, et les comptes courants ; '' = un compte qui n'est pas suivi ici
export type TransferQuestion = { id: string; date: string; label: string; amount: number; account: string; choices: string[] };
// Virement entre mes comptes dont une seule moitié est enregistrée, avec l'autre compte retenu
// (précisé à la main ou lu dans le libellé ; '' : un compte non suivi ; null : pas encore connu)
export type TransferCheck = TransferQuestion & { target: string | null };
// Mois sans relevé d'un livret dont les opérations estimées, modifiées à la main, ne correspondent plus aux virements
// vus sur les autres comptes
// (reasons : la raison de chaque écart, opération par opération, et ce qu'il faut faire)
export type TransferMismatch = { account: string; month: string; estimated: number; seen: number; reasons: string[] };
export type Coverage = {
  tracked: TrackedAccount[];
  covered: string[]; // "compte en minuscules|AAAA-MM"
  manual: ManualNote[]; // opérations ajoutées à la main, par compte et par mois
  estimates: SavingsEstimate[];
  questions: TransferQuestion[];
  transfers: TransferCheck[];
  mismatches: TransferMismatch[];
};

// Mois dont les virements entre mes comptes sont à revérifier sur le Bilan, après un changement dans la liste des
// opérations (gardés dans ce navigateur ; la demande s'efface quand on confirme sur le Bilan)
const VERIFY_KEY = 'finances:virements-a-verifier';
const verifyListeners = new Set<() => void>();
export function readTransfersToVerify() {
  try {
    return localStorage.getItem(VERIFY_KEY) ?? '';
  } catch {
    return '';
  }
}
export const monthsToVerify = (snapshot: string) => snapshot.split(',').filter(Boolean);
function writeTransfersToVerify(months: string[]) {
  try {
    localStorage.setItem(VERIFY_KEY, [...new Set(months)].sort().join(','));
  } catch {
    // stockage indisponible : la demande ne sera simplement pas gardée
  }
  verifyListeners.forEach((l) => l());
}
export function subscribeTransfersToVerify(onChange: () => void) {
  verifyListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    verifyListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}
export const flagTransfersToVerify = (months: string[]) => writeTransfersToVerify([...monthsToVerify(readTransfersToVerify()), ...months]);
export const clearTransfersToVerify = (month: string) => writeTransfersToVerify(monthsToVerify(readTransfersToVerify()).filter((m) => m !== month));

const keyOf = (account: string, month: string) => `${account.toLowerCase()}|${month}`;

// Comptes dont le relevé manque pour le mois
export function missingAccounts(coverage: Coverage, month: string) {
  const covered = new Set(coverage.covered);
  return coverage.tracked.filter((a) => a.first <= month && !covered.has(keyOf(a.account, month))).map((a) => a.account);
}

// Opérations ajoutées à la main dans le mois, compte par compte
export const manualNotes = (coverage: Coverage, month: string) => coverage.manual.filter((m) => m.month === month);

// Solde estimé d'un compte pour le mois (undefined : pas d'estimation possible)
export const estimateOf = (coverage: Coverage, account: string, month: string) =>
  coverage.estimates.find((e) => e.month === month && e.account.toLowerCase() === account.toLowerCase());

// Ce qui est connu d'un mois :
//  - missing : comptes dont le relevé manque (toujours signalés) ; estimated : ceux dont le solde est estimé ;
//    unknown : ceux dont le solde n'est pas connu du tout
//  - bilan complet (aucun solde inconnu, estimé ou non), compte de résultat complet (aucun compte courant manquant)
export function monthStatus(coverage: Coverage, month: string) {
  const missing = missingAccounts(coverage, month);
  const estimated = missing.filter((a) => typeof estimateOf(coverage, a, month)?.balance === 'number');
  const unknown = missing.filter((a) => !estimated.includes(a));
  return { missing, estimated, unknown, bilanKnown: unknown.length === 0, resultKnown: !missing.some((a) => !isSavingsAccount(a)) };
}

// Lignes d'un compte dont le solde n'est pas connu pour leur mois (relevé manquant, sans estimation)
export const isMissingLine = (line: Pick<FinanceLine, 'section' | 'label'>, unknown: string[]) =>
  line.section === 'liquidites' && unknown.some((a) => a.toLowerCase() === line.label.toLowerCase());

// Lignes d'un mois avec les soldes estimés à la place des soldes inscrits (une ligne est ajoutée au besoin)
export function withEstimates(lines: FinanceLine[], coverage: Coverage, month: string) {
  const estimated = monthStatus(coverage, month).estimated;
  if (estimated.length === 0) return lines;
  const balanceOf = (account: string) => estimateOf(coverage, account, month)!.balance!;
  const isEstimated = (l: FinanceLine) => l.period === month && l.section === 'liquidites' && estimated.some((a) => a.toLowerCase() === l.label.toLowerCase());
  const added = estimated
    .filter((a) => !lines.some((l) => isEstimated(l) && l.label.toLowerCase() === a.toLowerCase()))
    .map((a): FinanceLine => ({ id: `estime-${a}-${month}`, period: month, statement: 'bilan', section: 'liquidites', label: a, amount: 0, position: 1000 }));
  return [...lines, ...added].map((l) => (isEstimated(l) ? { ...l, amount: balanceOf(l.label) } : l));
}

// Lignes de plusieurs mois sans les soldes inconnus (les soldes estimés y remplacent ceux inscrits), et les mois dont
// le bilan ou le résultat n'est pas connu, ou dont le bilan n'est qu'estimé
// (un vieux solde recopié d'un mois sur l'autre n'est ainsi jamais pris pour un vrai)
export function knownLines(lines: FinanceLine[], coverage: Coverage | undefined) {
  const unknownBilan = new Set<string>();
  const unknownResult = new Set<string>();
  const estimatedBilan = new Set<string>();
  if (!coverage) return { lines, unknownBilan, unknownResult, estimatedBilan };
  const status = new Map<string, ReturnType<typeof monthStatus>>();
  const statusOf = (month: string) => {
    if (!status.has(month)) status.set(month, monthStatus(coverage, month));
    return status.get(month)!;
  };
  const months = [...new Set(lines.map((l) => l.period))];
  let all = lines;
  for (const month of months) {
    const s = statusOf(month);
    if (!s.bilanKnown) unknownBilan.add(month);
    if (!s.resultKnown) unknownResult.add(month);
    if (s.estimated.length) {
      estimatedBilan.add(month);
      all = withEstimates(all, coverage, month);
    }
  }
  return { lines: all.filter((l) => !isMissingLine(l, statusOf(l.period).unknown)), unknownBilan, unknownResult, estimatedBilan };
}
