// Signature du contrat de la page de titre : on signe une fois par jour, à la première visite ;
// la signature reste ensuite affichée toute la journée, puis s'efface à 4 h du matin.
// Jour du contrat, qui change à 4 h du matin (la page de titre, components/TitleContract, s'en sert).

export const SIGNATURE_RESET_HOUR = 4;

// Jour du contrat : la date d'il y a 4 h (ex : mercredi 3 h 59 -> journée de mardi)
export function contractDay(now = new Date()) {
  return new Date(now.getTime() - SIGNATURE_RESET_HOUR * 3_600_000).toDateString();
}
