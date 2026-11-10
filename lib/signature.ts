// Signature du contrat de la page de titre : on signe une fois par jour, à la première visite ;
// la signature reste ensuite affichée toute la journée, puis s'efface à 4 h du matin.
// Gardée dans le navigateur (image du trait + jour de la signature).

export const SIGNATURE_RESET_HOUR = 4;

const KEY = 'titre:signature';
const listeners = new Set<() => void>();

// Jour du contrat : la date d'il y a 4 h (ex : mercredi 3 h 59 -> journée de mardi)
export function contractDay(now = new Date()) {
  return new Date(now.getTime() - SIGNATURE_RESET_HOUR * 3_600_000).toDateString();
}

// Image de la signature du jour, ou null s'il faut signer
export function readSignature(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { day: string; image: string } | null;
    return saved && saved.day === contractDay() ? saved.image : null;
  } catch {
    return null;
  }
}

export function saveSignature(image: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: contractDay(), image }));
  } catch {}
  listeners.forEach((l) => l());
}

export function subscribeSignature(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
