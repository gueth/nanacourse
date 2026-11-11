import type { MetadataRoute } from 'next';

// L'application installable : ajoutée à l'écran d'accueil du téléphone (« Installer l'application » ou
// « Ajouter à l'écran d'accueil »), elle s'ouvre en plein écran comme une vraie application,
// sans la barre du navigateur qui affiche l'adresse du site.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'nana',
    short_name: 'nana',
    description: 'Courses, finances et défis du jour.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#8494c6',
    theme_color: '#8494c6',
    icons: [
      // Napperon blanc et monogramme « N&Co » sur le bleu de fond (dessin : app/icon.svg)
      { src: '/app-icon/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Version réduite au centre : le téléphone peut la découper en rond ou en goutte sans rogner le dessin
      { src: '/app-icon/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
