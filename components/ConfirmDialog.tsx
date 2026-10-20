'use client';

import { useCallback, useRef, useState } from 'react';
import Modal from '@/components/Modal';

// Libellés des deux boutons (par défaut : "Supprimer" / "annuler")
type Labels = { confirm?: string; cancel?: string };
type Request = { title: string; message: string; labels?: Labels };

// Cadre de confirmation (au-dessus de la page), à utiliser avant une suppression.
// Usage :
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm('Supprimer ?', 'Cette action est définitive.'))) return;
//   ... puis afficher {confirmDialog} dans le JSX du composant.
// Avec des libellés personnalisés, c'est le bouton de refus (le choix prudent) qui a le focus.
export function useConfirm() {
  const [request, setRequest] = useState<Request | null>(null);
  // Fonction qui débloque la promesse renvoyée par confirm() avec la réponse
  const resolveRef = useRef<(ok: boolean) => void>(() => {});

  const confirm = useCallback((title: string, message: string, labels?: Labels) => {
    setRequest({ title, message, labels });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function answer(ok: boolean) {
    setRequest(null);
    resolveRef.current(ok);
  }

  const custom = !!request?.labels;
  const dialog = request && (
    <Modal title={request.title} onClose={() => answer(false)}>
      <p className="mb-6">{request.message}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button autoFocus={!custom} onClick={() => answer(true)} className="btn-hand bg-brick">
          {request.labels?.confirm ?? 'Supprimer'}
        </button>
        <button autoFocus={custom} onClick={() => answer(false)} className={custom ? 'btn-hand' : 'btn-ghost'}>
          {request.labels?.cancel ?? 'annuler'}
        </button>
      </div>
    </Modal>
  );

  return [confirm, dialog] as const;
}
