import { Caveat, Courier_Prime, Great_Vibes } from 'next/font/google';
import './globals.css';
import { PageShell } from '@/components/PageShell';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', weight: ['600', '700'] });
const courierPrime = Courier_Prime({ subsets: ['latin'], variable: '--font-courier', weight: ['400', '700'] });
// Calligraphie fine du jour de la semaine, sur la vignette de l'accueil
const greatVibes = Great_Vibes({ subsets: ['latin'], variable: '--font-script', weight: '400' });

export const metadata = {
  title: 'Courses',
  description: 'Gère tes ingrédients, leurs prix par magasin, et ta liste de courses.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${caveat.variable} ${courierPrime.variable} ${greatVibes.variable}`}>
      <body>
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}