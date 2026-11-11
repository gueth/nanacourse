import { Archivo_Narrow, Caveat, Courier_Prime, DM_Sans, Great_Vibes, Grenze_Gotisch, Playfair_Display, Reenie_Beanie, UnifrakturMaguntia } from 'next/font/google';
import './globals.css';
import { PageShell } from '@/components/PageShell';
import { MobileSelectPicker } from '@/components/MobileSelectPicker';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', weight: ['600', '700'] });
const courierPrime = Courier_Prime({ subsets: ['latin'], variable: '--font-courier', weight: ['400', '700'] });
// Calligraphie fine du jour de la semaine, sur la vignette de l'accueil
const greatVibes = Great_Vibes({ subsets: ['latin'], variable: '--font-script', weight: '400' });
// Gazette de l'accueil : lettres gothiques du titre du journal, et caractères à empattements des articles
const blackletter = UnifrakturMaguntia({ subsets: ['latin'], variable: '--font-blackletter', weight: '400' });
// Gothique plus lisible, pour les petits titres (ex : « Sommaire » du menu de l'accueil)
const gothic = Grenze_Gotisch({ subsets: ['latin'], variable: '--font-gothic', weight: '600' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-serif', style: ['normal', 'italic'] });
// Carte-contrat de la page de titre : capitales étroites du nom de la maison, et écriture fine au stylo des champs remplis
const archivoNarrow = Archivo_Narrow({ subsets: ['latin'], variable: '--font-narrow', weight: '700' });
const reenie = Reenie_Beanie({ subsets: ['latin'], variable: '--font-pen', weight: '400' });
// Page des courses de l'accueil, façon application de cuisine : caractères sans empattements, ronds et modernes
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-cuisine', style: ['normal', 'italic'] });

export const metadata = {
  title: 'Courses',
  description: 'Gère tes ingrédients, leurs prix par magasin, et ta liste de courses.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${caveat.variable} ${courierPrime.variable} ${greatVibes.variable} ${blackletter.variable} ${gothic.variable} ${playfair.variable} ${archivoNarrow.variable} ${reenie.variable} ${dmSans.variable}`}>
      <body>
        <PageShell>{children}</PageShell>
        {/* Sur téléphone : listes déroulantes ouvertes dans un menu au style de l'application */}
        <MobileSelectPicker />
      </body>
    </html>
  );
}