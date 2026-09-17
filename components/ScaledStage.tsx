'use client';

import { useEffect, useState } from 'react';

// Dimensions de référence : celles sur lesquelles la mise en page de l'accueil
// (ArcNav, DoodleNav, MissionRow...) a été calée en pixels absolus (Pixel 9 Pro Fold).
const DESIGN_WIDTH = 412;
const DESIGN_HEIGHT = 922;

export function ScaledStage({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      setScale(Math.min(1, window.innerWidth / DESIGN_WIDTH));
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <div className="w-full flex justify-center bg-white">
      <div style={{ width: DESIGN_WIDTH * scale, height: DESIGN_HEIGHT * scale, position: 'relative' }}>
        <div
          style={{
            width: DESIGN_WIDTH,
            height: DESIGN_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
