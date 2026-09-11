'use client';

import { useRef, useState } from 'react';

type Props = {
  pages: React.ReactNode[];
  labels: string[];
};

export function SwipePages({ pages, labels }: Props) {
  const [page, setPage] = useState(0);
  const touchStartX = useRef<number | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta < -50) setPage((p) => Math.min(p + 1, pages.length - 1));
    else if (delta > 50) setPage((p) => Math.max(p - 1, 0));
  }

  return (
    <div>
      <div className="overflow-hidden pb-16" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${page * 100}%)` }}
        >
          {pages.map((content, i) => (
            <div key={i} className="w-full shrink-0">
              {content}
            </div>
          ))}
        </div>
      </div>

      {/* INDICATEUR DE PAGE, FIXÉ EN BAS DE L'ÉCRAN */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex justify-center gap-2 z-20">
        {pages.map((_, i) => (
          <button
            key={i}
            aria-label={labels[i]}
            onClick={() => setPage(i)}
            className={`w-2.5 h-2.5 rounded-full border-2 border-ink ${page === i ? 'bg-ink' : 'bg-transparent'}`}
          />
        ))}
      </div>
    </div>
  );
}
