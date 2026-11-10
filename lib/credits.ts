// Crédits de l'application, affichés sur la page /credits. Les noms sont provisoires : il suffit de les remplacer ici.

export type CreditsSection = { role: string; names: string[] };

export const CREDITS: CreditsSection[] = [
  { role: 'Direction artistique', names: ['Prénom Nom'] },
  { role: 'Conception du jeu', names: ['Camille Lambert', 'Jules Moreau'] },
  { role: 'Modélisation 3D', names: ['Léa Fontaine'] },
  { role: 'Animation de la danseuse', names: ['Hugo Marchand'] },
  { role: 'Musique', names: ['Clara Duval'] },
  { role: 'Son', names: ['Théo Garnier'] },
  { role: 'Développement', names: ['Inès Roussel', 'Lucas Perrin'] },
  { role: 'Illustrations de la gazette', names: ['Manon Lefèvre'] },
  { role: 'Textes', names: ['Antoine Mercier'] },
  { role: 'Tests sur téléphone', names: ['Sarah Benoît', 'Nathan Caron'] },
  { role: 'Accessibilité', names: ['Emma Girard'] },
  { role: 'Remerciements', names: ['La famille', 'Les amis', 'Et toi, qui as joué'] }
];

// Durées. Le tout (danse + arrêt progressif) fait 1 minute.
// La mélodie de la boîte à musique compte 24 notes jouées toutes les 0,33 s, soit ≈ 7,9 s ; elle tourne en boucle.
export const TOTAL_SECONDS = 60;
// Décélération finale de la danseuse, pendant que la musique s'éteint en fondu
export const DECEL_SECONDS = 4;
// Une « chanson » : la danseuse tourne pendant deux chansons, et les crédits défilent pendant toute cette durée
export const SONG_SECONDS = (TOTAL_SECONDS - DECEL_SECONDS) / 2;
export const CREDITS_SECONDS = 2 * SONG_SECONDS;
