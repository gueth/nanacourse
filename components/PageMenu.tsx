'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

type Props = {
  items: { href: string; title: string; desc: string; icon: ReactNode }[];
};

// Icône de menu : un clic fait apparaître les options sous l'icône.
// Le menu se ferme au second clic, avec Échap, en cliquant ailleurs ou en choisissant une option.
export default function PageMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fermeture en cliquant en dehors du menu ou avec la touche Échap (seulement quand il est ouvert)
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center justify-center w-11 h-11 rounded-full border-2 border-ink bg-card shadow-[2px_2px_0_0_rgba(43,33,24,0.18)] hover:-translate-y-0.5 transition-transform"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {open && (
        <div role="menu" className="card card-plain absolute right-0 top-full mt-3 w-64 z-40 p-2 mb-0">
          <span className="tape" />
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 rounded px-3 py-2 hover:bg-paper"
            >
              <span className="mt-1 shrink-0">{item.icon}</span>
              <span>
                <span className="title-hand text-xl block">{item.title}</span>
                <span className="text-sm opacity-70">{item.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
