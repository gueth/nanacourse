import { Archivo_Narrow, Caveat, Courier_Prime, DM_Sans, Great_Vibes, Grenze_Gotisch, Playfair_Display, Reenie_Beanie, UnifrakturMaguntia } from 'next/font/google';
import './globals.css';
import { PageShell } from '@/components/PageShell';
import { MobileSelectPicker } from '@/components/MobileSelectPicker';
import { SystemBarsColor } from '@/components/SystemBarsColor';
import { applySystemBarsColor } from '@/lib/barsColor';
import { SoundEffects } from '@/components/SoundEffects';

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
  description: 'Gère tes ingrédients, leurs prix par magasin, et ta liste de courses.',
  // iPhone : ajoutée à l'écran d'accueil depuis Safari, l'application s'ouvre sans la barre d'adresse
  // (icônes : app/icon.svg pour l'onglet, app/apple-icon.png pour l'écran d'accueil de l'iPhone)
  appleWebApp: { capable: true, title: 'nana', statusBarStyle: 'default' }
};

// Couleur de départ de la barre du téléphone (heure, batterie) : le bleu de fond,
// ensuite remplacée par la couleur de la page affichée (components/SystemBarsColor.tsx)
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // La page s'étend sous la barre du bas du téléphone (boutons retour, accueil...) : sur Android, la barre devient
  // transparente et laisse voir le fond de la page, qui suit sa couleur (components/SystemBarsColor.tsx).
  // Le contenu garde une marge de la hauteur de cette barre (env(safe-area-inset-bottom), voir globals.css).
  viewportFit: 'cover',
  // Même couleur que le menu du bas et la barre du téléphone de l'appli installée (app/manifest.ts)
  themeColor: '#ecdde8'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className={`${caveat.variable} ${courierPrime.variable} ${greatVibes.variable} ${blackletter.variable} ${gothic.variable} ${playfair.variable} ${archivoNarrow.variable} ${reenie.variable} ${dmSans.variable}`}>
      {/* Le fond et la barre du haut sont colorés par un script avant l'arrivée de React : on ne les compare pas */}
      <body suppressHydrationWarning>
        {/* Teinte des Finances : la dernière connue (gardée par lib/health, clé FINANCE_TONE_KEY) est posée avant le premier
            affichage, pour ne jamais voir une couleur par défaut le temps que l'état de santé soit recalculé */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=JSON.parse(localStorage.getItem('nanacourses.finance-tone')||'null');if(t&&t.dark&&t.pale){var s=document.documentElement.style;s.setProperty('--fin-accent',t.dark);s.setProperty('--fin-bg',t.pale);s.setProperty('--fin-page-bg',t.pale)}}catch(e){}`
          }}
        />
        <PageShell>{children}</PageShell>
        {/* Couleur des barres du téléphone et du fond appliquée dès que la page est lue, avant le premier affichage :
            pas d'éclair bleu avant la bonne teinte (ensuite, components/SystemBarsColor prend le relais) */}
        <script dangerouslySetInnerHTML={{ __html: `try{(${applySystemBarsColor.toString()})()}catch(e){}` }} />
        {/* Sur téléphone : listes déroulantes ouvertes dans un menu au style de l'application */}
        <MobileSelectPicker />
        {/* Barres du téléphone (haut et bas) à la couleur de la page affichée */}
        <SystemBarsColor />
        {/* Bruitages doux des boutons, popins et pages (volume dans Paramètres > Sons) */}
        <SoundEffects />
      </body>
    </html>
  );
}