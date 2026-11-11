'use client';

import { createContext, useContext, useEffect } from 'react';
import { X } from 'lucide-react';
import Portal from '@/components/Portal';

export type ModalVariant = 'default' | 'gazette' | 'cuisine' | 'm3';

// Style des popins par défaut d'une partie de la page (ex : « cuisine » pour la gestion ouverte depuis la page des courses) :
// une popin sans variant explicite prend celui-ci
export const ModalVariantContext = createContext<ModalVariant>('default');

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Cadre plus large, pour les contenus en tableau (ex : vérification d'un reçu)
  wide?: boolean;
  // "gazette" : au style de l'accueil (papier gris, bleu nuit, double filet, caractères à empattements)
  // "cuisine" : au style de la page des courses de l'accueil (crème, vert olive, grands arrondis, sans empattements)
  // "m3" : au style des Paramètres (lavande, violet, grands arrondis, façon Material expressif)
  variant?: ModalVariant;
  // Contenu du titre à la place du texte (ex : un champ pour renommer) ; "title" reste le nom lu par les lecteurs d'écran
  heading?: React.ReactNode;
};

// Cadre qui s'affiche au-dessus de la page, avec un fond assombri.
// Se ferme avec la croix, la touche Échap ou un clic en dehors du cadre.
export default function Modal({ title, onClose, children, wide = false, variant: asked, heading }: Props) {
  const inherited = useContext(ModalVariantContext);
  const variant = asked ?? inherited;
  // Fermeture avec la touche Échap
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cuisine (page des courses) et Material expressif (Paramètres) : feuille aux grands arrondis, croix dans un rond
  if (variant === 'cuisine' || variant === 'm3') {
    const m3 = variant === 'm3';
    return (
      <Portal>
        <div
          className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:p-4 ${m3 ? 'bg-[#2b1f4f]/40' : 'bg-[#2e3a24]/45'}`}
          onClick={onClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`${m3 ? 'm3 modal-m3' : 'cuisine modal-cuisine'} modal-solid relative mt-8 w-full sm:mt-12 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className={`min-w-0 flex-1 text-[22px] leading-tight tracking-tight ${m3 ? 'font-medium' : 'font-bold'}`}>{heading ?? title}</h2>
              <button
                onClick={onClose}
                aria-label="Fermer"
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${m3 ? 'bg-[#e0dcf5] text-[#2b1f4f]' : 'bg-[#ebe3d5]'}`}
              >
                <X size={18} />
              </button>
            </div>
            {children}
          </div>
        </div>
      </Portal>
    );
  }

  if (variant === 'gazette') {
    return (
      <Portal>
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
              <h2 className="min-w-0 flex-1 text-[19px] font-bold leading-tight">{heading ?? title}</h2>
              <button onClick={onClose} aria-label="Fermer" className="p-1 shrink-0">
                <X size={20} />
              </button>
            </div>
            {children}
          </div>
        </div>
      </div>
      </Portal>
    );
  }

  return (
    <Portal>
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
          <h2 className="title-hand min-w-0 flex-1 text-3xl">{heading ?? title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="p-1">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
    </Portal>
  );
}
