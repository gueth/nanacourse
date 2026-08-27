"use client";

import { usePathname } from "next/navigation";

export function PageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return <main className="bg-white">{children}</main>;
  }

  return <main className="max-w-3xl mx-auto px-6 py-10">{children}</main>;
}
