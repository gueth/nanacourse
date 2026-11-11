'use client';

import { useEffect } from 'react';

// Barres du téléphone (heure/batterie en haut, barre de navigation en bas) teintées de la couleur de la page affichée,
// pour qu'elles se fondent dans le décor. La couleur est lue directement à l'écran (bord gauche, tout en haut et tout en bas),
// donc chaque page est suivie sans rien déclarer, y compris ses changements de teinte (phase du cycle, ton des finances…).

const COLOR_RE = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;

// Opacité d'une couleur calculée par le navigateur (« rgba(0, 0, 0, 0) », « oklch(… / 0.5) »…)
function alpha(color: string) {
  if (!color || color === 'transparent') return 0;
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
  if (color.startsWith('rgba(') || color.startsWith('hsla(')) {
    const parts = color.slice(5, -1).split(',');
    if (parts.length === 4) return Number(parts[3]);
  }
  return 1;
}

// Première couleur pleine sous le point (x, y) : fond uni, ou couleur de début/fin d'un dégradé vertical
function colorAt(x: number, y: number, edge: 'top' | 'bottom') {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-bars-ignore]')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || Number(style.opacity) < 0.9) continue;
    const image = style.backgroundImage;
    if (image && image !== 'none' && image.includes('gradient')) {
      const stops = image.match(COLOR_RE)?.filter((c) => alpha(c) >= 0.9);
      if (stops?.length) return edge === 'top' ? stops[0] : stops[stops.length - 1];
    }
    if (alpha(style.backgroundColor) >= 0.9) return style.backgroundColor;
  }
  return null;
}

function setThemeColor(color: string) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (meta.content !== color) meta.content = color;
}

export function SystemBarsColor() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      // Pendant qu'on lit l'écran, le fond de la page elle-même ne doit pas répondre à sa place
      const prevHtml = root.style.backgroundColor;
      const prevBody = document.body.style.backgroundColor;
      root.style.backgroundColor = 'transparent';
      document.body.style.backgroundColor = 'transparent';
      const top = colorAt(2, 2, 'top');
      const bottom = colorAt(2, window.innerHeight - 2, 'bottom');
      root.style.backgroundColor = prevHtml;
      document.body.style.backgroundColor = prevBody;

      const fallback = getComputedStyle(root).getPropertyValue('--color-backdrop').trim() || '#8494c6';
      // Barre du haut (et interface du navigateur)
      setThemeColor(top ?? bottom ?? fallback);
      // Fond derrière la page : visible sous la barre du bas, et quand on tire la page au-delà de ses bords
      const under = bottom ?? top ?? fallback;
      if (root.style.backgroundColor !== under) root.style.backgroundColor = under;
      if (document.body.style.backgroundColor !== under) document.body.style.backgroundColor = under;
    };

    update();
    // Relecture régulière et légère : changement de page, transitions, teintes qui évoluent
    const timer = window.setInterval(update, 700);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, []);

  return null;
}
