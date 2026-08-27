import { Caveat, Courier_Prime } from 'next/font/google';
import './globals.css';
import { PageShell } from '@/components/PageShell';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', weight: ['600', '700'] });
const courierPrime = Courier_Prime({ subsets: ['latin'], variable: '--font-courier', weight: ['400', '700'] });

export const metadata = {
  title: 'Courses',
  description: 'Gère tes ingrédients, leurs prix par magasin, et ta liste de courses.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${caveat.variable} ${courierPrime.variable}`}>
      <body>
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}