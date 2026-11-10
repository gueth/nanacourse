// Son de la page Crédits : sur téléphone, le son ne peut démarrer qu'après un geste de l'utilisateur.
// Le contexte audio est donc déverrouillé au toucher (lien « Crédits » du sommaire, ou bouton « Lancer »),
// puis repris par la page.

let ctx: AudioContext | null = null;

// Contexte audio partagé (créé au besoin : il reste muet tant qu'un toucher ne l'a pas déverrouillé)
export function getCreditsAudio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

// À appeler pendant un toucher
export function unlockCreditsAudio(): AudioContext {
  const audio = getCreditsAudio();
  if (audio.state === 'suspended') void audio.resume();
  // Un son muet joué pendant le geste finit de déverrouiller le son sur les anciens iPhone
  const silent = audio.createBufferSource();
  silent.buffer = audio.createBuffer(1, 1, 22050);
  silent.connect(audio.destination);
  silent.start();
  return audio;
}

// Vrai si le son a déjà été déverrouillé par un toucher (la musique peut alors démarrer seule)
export function creditsAudioReady(): boolean {
  return ctx?.state === 'running';
}
