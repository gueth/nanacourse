"use client";

import { usePathname, useRouter } from "next/navigation";

export function PageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  if (isHome) {
    return <main className="bg-white">{children}</main>;
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <button onClick={() => router.back()} className="btn-ghost mb-4">
        ← Retour
      </button>
      {children}
    </main>
  );
}
