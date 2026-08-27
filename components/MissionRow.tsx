"use client";

import { useEffect, useRef, useState } from "react";
import { MissionCard } from "@/components/MissionCard";

export function MissionRow() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number>();

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      setCardHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex items-start gap-3">
      <div ref={cardRef} className="w-[320px] sm:w-[420px]">
        <MissionCard />
      </div>
      <span
        style={{ height: cardHeight }}
        className="[writing-mode:vertical-rl] rotate-180 font-hand text-navy text-[1.8rem] tracking-widest"
      >
        MESSAGE X
      </span>
    </div>
  );
}
