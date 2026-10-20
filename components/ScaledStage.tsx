'use client';

import { useEffect, useState } from 'react';

// Dimensions de référence : celles sur lesquelles la mise en page de l'accueil
// (ArcNav, DoodleNav, MissionRow...) a été calée en pixels absolus (Pixel 9 Pro Fold).
const DESIGN_WIDTH = 412;
const DESIGN_HEIGHT = 922;

// "height" : hauteur de la scène en px de référence, plus grande que l'écran si la page doit défiler
export function ScaledStage({ children, height = DESIGN_HEIGHT }: { children: React.ReactNode; height?: number }) {
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
    // overflow-x-clip : au premier rendu (échelle 1) la scène fait 412 px ; sans ce clip, elle élargirait la page sur un
    // petit téléphone, et le navigateur agrandirait sa fenêtre de mise en page (et décalerait les éléments fixes)
    <div className="w-full flex justify-center overflow-x-clip bg-white">
      <div style={{ width: DESIGN_WIDTH * scale, height: height * scale, position: 'relative' }}>
        <div
          style={{
            width: DESIGN_WIDTH,
            height,
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
