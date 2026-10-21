'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Cadre plus large, pour les contenus en tableau (ex : vérification d'un reçu)
  wide?: boolean;
  // "gazette" : au style de l'accueil (papier gris, bleu nuit, double filet, caractères à empattements)
  variant?: 'default' | 'gazette';
};

// Cadre qui s'affiche au-dessus de la page, avec un fond assombri.
// Se ferme avec la croix, la touche Échap ou un clic en dehors du cadre.
export default function Modal({ title, onClose, children, wide = false, variant = 'default' }: Props) {
  // Fermeture avec la touche Échap
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (variant === 'gazette') {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#1d2b4a]/50 p-4 overflow-y-auto" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`modal-gazette modal-solid tint-blue relative w-full mt-12 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-gazette-inner">
            <div className="flex items-center justify-between gap-3 mb-4 border-b pb-2" style={{ borderColor: '#1d2b4a' }}>
              <h2 className="text-[19px] font-bold leading-tight">{title}</h2>
              <button onClick={onClose} aria-label="Fermer" className="p-1 shrink-0">
                <X size={20} />
              </button>
            </div>
            {children}
          </div>
        </div>
      </div>
    );
  }

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
