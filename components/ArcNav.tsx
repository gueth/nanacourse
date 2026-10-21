"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

type NavItem = {
  label: string;
  href : string;
  icon: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

const RADIUS = 150;   // rayon du cercle imaginaire, centré sur le bouton menu (px)
const TOTAL_ARC = 90; // étalement total (degrés) : de la gauche du bouton jusque sous lui

type MenuState = "closed" | "open" | "closing";

// Bouton menu (placé par le parent) : au clic, les entrées se déploient en arc de cercle
// autour de lui en tournoyant comme une toupie
// "buttonClassName" : couleur du bouton menu (blanc par défaut, pour un fond sombre)
export function ArcNav({
  items,
  className = "",
  buttonClassName = "text-white drop-shadow-[0_1px_2px_rgba(27,42,74,0.55)]"
}: {
  items: NavItem[];
  className?: string;
  buttonClassName?: string;
}) {
  const [state, setState] = useState<MenuState>("closed");
  const step = TOTAL_ARC / (items.length - 1);

  function toggle() {
    setState((s) => (s === "open" ? "closing" : "open"));
  }

  return (
    <>
      {/* Clic en dehors du menu : le referme */}
      {state === "open" && <div className="fixed inset-0 z-20" onClick={() => setState("closing")} />}

      <div className={`absolute z-30 ${className}`}>
        <button
          type="button"
          onClick={toggle}
          aria-label={state === "open" ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={state === "open"}
          className={`relative z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${buttonClassName}`}
        >
          <span className={`transition-transform duration-500 ${state === "open" ? "rotate-180" : ""}`}>
            {state === "open" ? <X size={28} strokeWidth={2.4} /> : <Menu size={28} strokeWidth={2.4} />}
          </span>
        </button>

        {state !== "closed" && (
          // Pivot de la toupie : le centre du bouton
          <div
            className={`absolute left-0 top-0 ${state === "open" ? "arc-spin-in" : "arc-spin-out"}`}
            onAnimationEnd={() => state === "closing" && setState("closed")}
          >
            {items.map((item, i) => {
              const angle = -i * step;
              return (
                <div
                  key={item.label}
                  className="absolute left-0 top-0 origin-[0_0]"
                  style={{ transform: `rotate(${angle}deg) translateX(-${RADIUS}px)` }}
                >
                  <Link
                    href={item.href}
                    onClick={(e) => {
                      setState("closed");
                      item.onClick?.(e);
                    }}
                    className="flex flex-row items-center gap-2.5 rounded-full border-[1.5px] border-navy bg-sky px-5 py-2.5 whitespace-nowrap shadow-[0_2px_4px_rgba(0,0,0,0.18),0_6px_10px_rgba(0,0,0,0.12),0_12px_20px_rgba(0,0,0,0.06)]"
                    // L'entrée est redressée pour rester horizontale quel que soit son angle sur l'arc
                    style={{ transform: `translate(-100%, -50%) rotate(${-angle}deg)`, transformOrigin: "100% 50%" }}
                  >
                    <span className="flex items-center justify-center shrink-0 scale-110">
                      {item.icon}
                    </span>
                    <span className="text-[13px] font-semibold text-navy">
                      {item.label}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
