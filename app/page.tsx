import Link from 'next/link';

const steps = [
  { href: '/categories', title: 'Catégories', desc: 'Le budget max par catégorie.' },
  { href: '/stores', title: 'Magasins', desc: 'Les enseignes où tu fais tes courses.' },
  { href: '/ingredients', title: 'Ingrédients', desc: 'Note, photo, prix par magasin.' },
  { href: '/inventory', title: 'Inventaire', desc: "Ce qu'il te reste à la maison." },
  { href: '/shopping-list', title: 'Liste de courses', desc: 'Le meilleur trajet magasins/prix.' }
];

export default function Home() {
  return (
    <div>
      <h1 className="title-hand text-5xl mb-2">Sache où aller,</h1>
      <h1 className="title-hand text-5xl mb-6">sache combien ça coûte.</h1>
      <p className="mb-8 opacity-70">Configure une fois, réutilise à chaque course.</p>

      <div className="grid sm:grid-cols-2 gap-x-6">
        {steps.map((s) => (
          <Link key={s.href} href={s.href} className="card block hover:-translate-y-0.5 transition-transform">
            <span className="tape" />
            <p className="title-hand text-2xl mb-1">{s.title}</p>
            <p className="text-sm opacity-70">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
