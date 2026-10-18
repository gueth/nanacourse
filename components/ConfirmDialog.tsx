'use client';

import { useCallback, useRef, useState } from 'react';
import Modal from '@/components/Modal';

type Request = { title: string; message: string };

// Cadre de confirmation (au-dessus de la page), à utiliser avant une suppression.
// Usage :
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm('Supprimer ?', 'Cette action est définitive.'))) return;
//   ... puis afficher {confirmDialog} dans le JSX du composant.
export function useConfirm() {
  const [request, setRequest] = useState<Request | null>(null);
  // Fonction qui débloque la promesse renvoyée par confirm() avec la réponse
  const resolveRef = useRef<(ok: boolean) => void>(() => {});

  const confirm = useCallback((title: string, message: string) => {
    setRequest({ title, message });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function answer(ok: boolean) {
    setRequest(null);
    resolveRef.current(ok);
  }

  const dialog = request && (
    <Modal title={request.title} onClose={() => answer(false)}>
      <p className="mb-6">{request.message}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button autoFocus onClick={() => answer(true)} className="btn-hand bg-brick">
          Supprimer
        </button>
        <button onClick={() => answer(false)} className="btn-ghost">
          annuler
        </button>
      </div>
    </Modal>
  );

  return [confirm, dialog] as const;
}
