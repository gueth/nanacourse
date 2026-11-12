'use client';

import { useEffect, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applySystemBarsColor } from '@/lib/barsColor';

// Barres du téléphone (heure/batterie en haut, barre de navigation en bas) teintées de la couleur de la page affichée,
// pour qu'elles se fondent dans le décor. La couleur est lue directement à l'écran (lib/barsColor), donc chaque page
// est suivie sans rien déclarer, y compris ses changements de teinte (phase du cycle, ton des finances…).
// Au chargement, un script en fin de page l'a déjà appliquée avant le premier affichage (app/layout.tsx) ; ensuite,
// elle est relue dès que l'écran change (changement de page, contenu chargé, transition), à l'image suivante.

export function SystemBarsColor() {
  const pathname = usePathname();

  // Changement de page : avant que la nouvelle page ne s'affiche, puis aux deux images suivantes (fin du rendu)
  useLayoutEffect(() => {
    applySystemBarsColor();
    let second = 0;
    const first = requestAnimationFrame(() => {
      applySystemBarsColor();
      second = requestAnimationFrame(applySystemBarsColor);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pathname]);

  useEffect(() => {
    // Une seule relecture par image, quel que soit le nombre de changements
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          applySystemBarsColor();
        });
    };
    // L'écran change (éléments ajoutés ou retirés, classes et styles modifiés)…
    // (sauf le fond de html et body, que la relecture modifie elle-même : sinon elle se relancerait sans fin)
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.type !== 'attributes' || (m.target !== document.body && m.target !== document.documentElement))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    // …ou une animation se termine (fondu, glissement de page)
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
    window.addEventListener('resize', schedule);
    // Filet de sécurité, peu fréquent : teintes qui évoluent sans changement de classe ni de style
    const timer = window.setInterval(schedule, 2000);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('animationend', schedule, true);
      window.removeEventListener('resize', schedule);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
