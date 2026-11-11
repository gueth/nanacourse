'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// Vrai seulement dans le navigateur (document.body n'existe pas pendant le rendu côté serveur)
const subscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribe, () => true, () => false);

// Affiche son contenu directement dans <body>, hors de l'arbre de la page.
// Une popin rendue ici couvre tout l'écran, même si elle est ouverte depuis un bloc
// qui la cloisonnerait sinon (overflow caché, z-index, animation...).
export default function Portal({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(children, document.body);
}
