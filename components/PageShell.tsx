"use client";

import { usePathname, useRouter } from "next/navigation";
import { PageTransitionProvider } from "@/components/PageTransitionProvider";
import { useKeepScreenOn } from "@/lib/wakeLock";
import { useShakeBell } from "@/lib/shakeBell";

export function PageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Pages plein écran (sans le lien "← Retour") : page de titre et accueil
  const isHome = pathname === "/" || pathname === "/accueil";
  // Pages plein écran qui ont leur propre en-tête et leur propre fond : finances, messagerie, profil, crédits, paramètres (classeur)
  const isFullScreen =
    pathname.startsWith("/banque") || pathname === "/messages" || pathname === "/profile" || pathname === "/credits" || pathname === "/settings";

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
        {/* Lien de retour */}
        <div className="mb-4">
          <button onClick={() => router.back()} className="btn-ghost">
            ← Retour
          </button>
        </div>
        {children}
      </main>
    </PageTransitionProvider>
  );
}
