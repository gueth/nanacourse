"use client";

import { usePathname, useRouter } from "next/navigation";
import { PageTransitionProvider } from "@/components/PageTransitionProvider";
import { hasTabBar, TAB_BAR_HEIGHT, TabBar } from "@/components/TabBar";
import { useKeepScreenOn } from "@/lib/wakeLock";
import { useShakeBell } from "@/lib/shakeBell";

export function PageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Pages plein écran (sans le lien "← Retour") : connexion, cartes du jour, accueil (journal), courses et ingrédients
  const isHome = pathname === "/" || pathname === "/cartes" || pathname === "/accueil" || pathname === "/course" || pathname === "/ingredients";
  // Pages plein écran qui ont leur propre en-tête et leur propre fond : finances, messagerie, profil, crédits, paramètres
  const isFullScreen =
    pathname.startsWith("/banque") || pathname === "/messages" || pathname === "/profile" || pathname === "/credits" || pathname === "/settings";

  // Le téléphone ne se met pas en veille tant que l'application est affichée
  useKeepScreenOn();
  // Secouer le téléphone fait tinter une clochette
  useShakeBell();

  // Menu du bas (accueil, journal, finances, courses, paramètres) sur les pages qu'il dessert. Une place de sa hauteur
  // est laissée sous la page, pour que la fin ne passe pas dessous ; les cartes du jour (une seule page sans défilement)
  // la réservent elles-mêmes.
  const tabBar = hasTabBar(pathname) && (
    <>
      {pathname !== "/cartes" && <div aria-hidden style={{ height: TAB_BAR_HEIGHT }} />}
      <TabBar />
    </>
  );

  if (isHome) {
    return (
      <PageTransitionProvider>
        <main className="home-screen bg-white">{children}</main>
        {tabBar}
      </PageTransitionProvider>
    );
  }

  if (isFullScreen) {
    return (
      <PageTransitionProvider>
        <main>{children}</main>
        {tabBar}
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
