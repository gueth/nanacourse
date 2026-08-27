"use client";

import Link from "next/link";

type NavItem = {
  label: string;
  href : string;
  icon: React.ReactNode;
  onClick?: () => void;
};

const RADIUS = 260;   // rayon du cercle imaginaire (px)
const TOTAL_ARC = 46; // étalement total (degrés)

export function ArcNav({ items }: { items: NavItem[] }) {
  const step = TOTAL_ARC / (items.length - 1);

  return (
    <div className="absolute top-[20%] right-[0%] -translate-x-1/2 -translate-y-1/2">
     {/* la disposition du nav */}

      {items.map((item, i) => {
        const angle = -TOTAL_ARC / 2 + i * step;
        return (
          <div
            key={item.label}
            className="absolute left-0 top-0 origin-[0_0]"
            style={{ transform: `rotate(${angle}deg) translateX(-${RADIUS}px)` }}
          >
            <Link
              href={item.href}
              onClick={item.onClick}
              className={`flex flex-row items-center gap-2.5 rounded-full border-[1.5px] shadow-[0_2px_4px_rgba(0,0,0,0.18),0_6px_10px_rgba(0,0,0,0.12),0_12px_20px_rgba(0,0,0,0.06)] transition-all px-5 py-2.5 whitespace-nowrap bg-sky border-navy`}
              style={{ transform: `translate(-100%, -50%)` }}
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
  );
}