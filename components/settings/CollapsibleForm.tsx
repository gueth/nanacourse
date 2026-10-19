'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

type Props = {
  // Titre toujours visible, ex : « + Ajouter une marque »
  title: string;
  // Clé pour se souvenir (sur cet appareil) si le formulaire était ouvert ou fermé
  storageKey: string;
  // Ouverture pilotée par le parent (ex : ouvrir le formulaire depuis une recherche sans résultat)
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

// Lit / écrit l'état mémorisé ; le navigateur peut refuser l'accès (navigation privée...) : on ignore alors
function readOpen(key: string) {
  try {
    return window.localStorage.getItem(`collapsible:${key}`) === 'open';
  } catch {
    return false;
  }
}
function writeOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(`collapsible:${key}`, open ? 'open' : 'closed');
  } catch {
    // rien : l'état ne sera simplement pas mémorisé
  }
}

// Cadre d'un formulaire d'ajout, qu'on peut replier pour laisser de la place à la liste en dessous.
// Fermé par défaut ; un clic sur le titre l'ouvre ou le referme, et ce choix est mémorisé.
export default function CollapsibleForm({ title, storageKey, open, onOpenChange, children }: Props) {
  const [ownOpen, setOwnOpen] = useState(() => (typeof window !== 'undefined' ? readOpen(storageKey) : false));
  const isOpen = open ?? ownOpen;

  function toggle() {
    const next = !isOpen;
    setOwnOpen(next);
    writeOpen(storageKey, next);
    onOpenChange?.(next);
  }

  return (
    <div className="card">
      <span className="tape" />
      <button type="button" onClick={toggle} aria-expanded={isOpen} className="w-full flex items-center gap-2 text-left">
        <ChevronRight size={22} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        <span className="title-hand text-2xl">{title}</span>
      </button>
      {isOpen && <div className="mt-4">{children}</div>}
    </div>
  );
}
