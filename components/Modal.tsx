'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Cadre plus large, pour les contenus en tableau (ex : vérification d'un reçu)
  wide?: boolean;
};

// Cadre qui s'affiche au-dessus de la page, avec un fond assombri.
// Se ferme avec la croix, la touche Échap ou un clic en dehors du cadre.
export default function Modal({ title, onClose, children, wide = false }: Props) {
  // Fermeture avec la touche Échap
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/50 p-4 overflow-y-auto" onClick={onClose}>
      {/* stopPropagation : un clic DANS le cadre ne doit pas le fermer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card card-plain modal-solid relative w-full mt-12 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="tape" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="title-hand text-3xl">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="p-1">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
