import Link from 'next/link';
import { Caveat, Courier_Prime } from 'next/font/google';
import './globals.css';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', weight: ['600', '700'] });
const courierPrime = Courier_Prime({ subsets: ['latin'], variable: '--font-courier', weight: ['400', '700'] });

export const metadata = {
  title: 'Courses',
  description: 'Gère tes ingrédients, leurs prix par magasin, et ta liste de courses.'
};

const links = [
  { href: '/categories', label: 'Catégories' },
  { href: '/stores', label: 'Magasins' },
  { href: '/ingredients', label: 'Ingrédients' },
  { href: '/inventory', label: 'Inventaire' },
  { href: '/shopping-list', label: 'Liste de courses' }
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${caveat.variable} ${courierPrime.variable}`}>
      <body>
        <header className="max-w-3xl mx-auto px-6 pt-8">
          <Link href="/" className="title-hand text-4xl">
            Courses <span className="text-mustard">.</span>
          </Link>
          <nav className="flex gap-2 mt-5 flex-wrap">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="nav-tab">
                {l.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
