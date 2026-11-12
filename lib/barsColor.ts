// Couleur des barres du téléphone (heure/batterie en haut, boutons en bas) et du fond derrière la page,
// lue directement à l'écran : bord gauche, tout en haut et tout en bas.
// Fonction autonome (rien d'extérieur) : elle est aussi recopiée telle quelle dans un petit script en fin de page
// (app/layout.tsx), qui l'exécute avant le premier affichage, pour ne jamais montrer le bleu par défaut un instant.
export function applySystemBarsColor() {
  const COLOR_RE = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;

  // Opacité d'une couleur calculée par le navigateur (« rgba(0, 0, 0, 0) », « oklch(… / 0.5) »…)
  const alpha = (color: string) => {
    if (!color || color === 'transparent') return 0;
    const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
    if (color.startsWith('rgba(') || color.startsWith('hsla(')) {
      const parts = color.slice(5, -1).split(',');
      if (parts.length === 4) return Number(parts[3]);
    }
    return 1;
  };

  // Première couleur pleine sous le point (x, y) : fond uni, ou couleur de début/fin d'un dégradé vertical
  const colorAt = (x: number, y: number, edge: 'top' | 'bottom') => {
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
  };

  const root = document.documentElement;
  const body = document.body;
  if (!body) return;
  // Pendant qu'on lit l'écran, le fond de la page elle-même ne doit pas répondre à sa place
  const prevHtml = root.style.backgroundColor;
  const prevBody = body.style.backgroundColor;
  root.style.backgroundColor = 'transparent';
  body.style.backgroundColor = 'transparent';
  const top = colorAt(2, 2, 'top');
  const bottom = colorAt(2, window.innerHeight - 2, 'bottom');
  root.style.backgroundColor = prevHtml;
  body.style.backgroundColor = prevBody;

  const fallback = getComputedStyle(root).getPropertyValue('--color-backdrop').trim() || '#8494c6';
  // Barre du haut (et interface du navigateur)
  const barColor = top ?? bottom ?? fallback;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (meta.content !== barColor) meta.content = barColor;
  // Fond derrière la page : visible sous la barre du bas, et quand on tire la page au-delà de ses bords
  const under = bottom ?? top ?? fallback;
  if (root.style.backgroundColor !== under) root.style.backgroundColor = under;
  if (body.style.backgroundColor !== under) body.style.backgroundColor = under;
}
