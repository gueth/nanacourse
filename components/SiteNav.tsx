"use client";

import { Home, BookOpen, Sparkles, ShoppingCart, User } from "lucide-react";
import { ArcNav } from "@/components/ArcNav";


export function SiteNav() {
  return (
     <ArcNav
      items={[
        { label: "Accueil", href: "/", icon: <Home size={20} /> },
        { label: "Course", href: "/course", icon: <BookOpen size={20} />},
        { label: "Banque", href: "/banque", icon: <Sparkles size={20} />},
        { label: "Dressing", href: "/dressing", icon: <ShoppingCart size={20} /> },
        { label: "Parametre", href: "/parametre", icon: <User size={20} /> },
      ]}
    />
  );
}
