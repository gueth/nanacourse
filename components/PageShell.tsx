"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { PageTransitionProvider } from "@/components/PageTransitionProvider";
import { useKeepScreenOn } from "@/lib/wakeLock";
import { useShakeBell } from "@/lib/shakeBell";

// Emplacement à droite du lien "← Retour", sur la même ligne, où une page peut placer ses actions (ex : un menu)
const HeaderActionsSlot = createContext<HTMLElement | null>(null);

// À utiliser dans une page : son contenu s'affiche à droite du lien "← Retour"
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

export function PageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Pages plein écran (sans le lien "← Retour") : page de titre et accueil
  const isHome = pathname === "/" || pathname === "/accueil";
  // Pages plein écran qui ont leur propre en-tête et leur propre fond : finances, messagerie, profil
  const isFullScreen = pathname.startsWith("/banque") || pathname === "/messages" || pathname === "/profile";
  // Élément de l'emplacement des actions (connu une fois affiché, via "ref")
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Le téléphone ne se met pas en veille tant que l'application est affichée
  useKeepScreenOn();
  // Secouer le téléphone fait tinter une clochette
  useShakeBell();

  if (isHome) {
    return (
      <PageTransitionProvider>
        <main className="home-screen bg-white">{children}</main>
      </PageTransitionProvider>
    );
  }

  if (isFullScreen) {
    return (
      <PageTransitionProvider>
        <main>{children}</main>
      </PageTransitionProvider>
    );
  }

  return (
    <PageTransitionProvider>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Ligne du haut : lien de retour à gauche, actions de la page à droite */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <button onClick={() => router.back()} className="btn-ghost">
            ← Retour
          </button>
          <div ref={setSlot} />
        </div>
        <HeaderActionsSlot.Provider value={slot}>{children}</HeaderActionsSlot.Provider>
      </main>
    </PageTransitionProvider>
  );
}
