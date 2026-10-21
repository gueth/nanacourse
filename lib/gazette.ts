// Numéro de la gazette de l'accueil : le n° 001 est sorti le 21 octobre 2026,
// et un nouveau numéro sort chaque jour à 8 h (avant 8 h, c'est encore le numéro de la veille).

const FIRST_ISSUE = { year: 2026, month: 10, day: 21 };
export const RELEASE_HOUR = 8;

export function gazetteIssue(now: Date) {
  // Jour de l'édition en cours : la date d'il y a 8 h (ex : mardi 7 h 59 -> édition de lundi)
  const edition = new Date(now.getTime() - RELEASE_HOUR * 3_600_000);
  const days = Math.round(
    (Date.UTC(edition.getFullYear(), edition.getMonth(), edition.getDate()) - Date.UTC(FIRST_ISSUE.year, FIRST_ISSUE.month - 1, FIRST_ISSUE.day)) / 86_400_000
  );
  return Math.max(1, days + 1);
}

// Numéro sur trois chiffres : 1 -> « 001 »
export const formatIssue = (issue: number) => String(issue).padStart(3, '0');
