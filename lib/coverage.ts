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
export type TrackedAccount = { account: string; first: string };
export type ManualNote = { account: string; month: string; count: number };
export type Coverage = {
  tracked: TrackedAccount[];
  covered: string[]; // "compte en minuscules|AAAA-MM"
  manual: ManualNote[]; // opérations ajoutées à la main, par compte et par mois
};

const keyOf = (account: string, month: string) => `${account.toLowerCase()}|${month}`;

// Comptes dont le relevé manque pour le mois
export function missingAccounts(coverage: Coverage, month: string) {
  const covered = new Set(coverage.covered);
  return coverage.tracked.filter((a) => a.first <= month && !covered.has(keyOf(a.account, month))).map((a) => a.account);
}

// Opérations ajoutées à la main dans le mois, compte par compte
export const manualNotes = (coverage: Coverage, month: string) => coverage.manual.filter((m) => m.month === month);

// Ce qui est connu d'un mois : bilan complet (aucun relevé manquant), compte de résultat complet (aucun compte courant manquant)
export function monthStatus(coverage: Coverage, month: string) {
  const missing = missingAccounts(coverage, month);
  return { missing, bilanKnown: missing.length === 0, resultKnown: !missing.some((a) => !isSavingsAccount(a)) };
}

// Lignes d'un compte dont le relevé manque pour leur mois : leur solde n'est pas connu
export const isMissingLine = (line: Pick<FinanceLine, 'section' | 'label'>, missing: string[]) =>
  line.section === 'liquidites' && missing.some((a) => a.toLowerCase() === line.label.toLowerCase());

// Lignes de plusieurs mois sans les soldes inconnus, et les mois dont le bilan ou le résultat n'est pas connu
// (un vieux solde recopié d'un mois sur l'autre n'est ainsi jamais pris pour un vrai)
export function knownLines(lines: FinanceLine[], coverage: Coverage | undefined) {
  const unknownBilan = new Set<string>();
  const unknownResult = new Set<string>();
  if (!coverage) return { lines, unknownBilan, unknownResult };
  const status = new Map<string, ReturnType<typeof monthStatus>>();
  const statusOf = (month: string) => {
    if (!status.has(month)) status.set(month, monthStatus(coverage, month));
    return status.get(month)!;
  };
  for (const month of new Set(lines.map((l) => l.period))) {
    const s = statusOf(month);
    if (!s.bilanKnown) unknownBilan.add(month);
    if (!s.resultKnown) unknownResult.add(month);
  }
  return { lines: lines.filter((l) => !isMissingLine(l, statusOf(l.period).missing)), unknownBilan, unknownResult };
}
