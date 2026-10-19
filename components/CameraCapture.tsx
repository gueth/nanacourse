'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

type Props = {
  // Photos prises (au moins une), transmises à la fermeture
  onCapture: (files: File[]) => void;
  onClose: () => void;
  // Si la caméra ne peut pas s'ouvrir ici : on bascule sur l'appareil photo du téléphone
  onFallback: () => void;
  // Plusieurs photos d'affilée (frigo, placards...) ou une seule (étiquette)
  multiple?: boolean;
  // Nombre de photos encore possibles
  remaining?: number;
};

// La caméra de l'appareil peut-elle être ouverte dans la page ?
// (navigateur compatible, et page en HTTPS ou sur localhost)
export function canUseInPageCamera() {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

// Ouvre la caméra ARRIÈRE (pas le mode selfie) : "exact" l'impose ; si l'appareil ne sait pas
// la choisir ainsi, on la demande seulement de préférence ("ideal").
async function openBackCamera() {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' }, ...size } });
  } catch {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, ...size } });
  }
}

// Viseur plein écran sur la caméra arrière, avec un déclencheur.
export default function CameraCapture({ onCapture, onClose, onFallback, multiple = false, remaining = Infinity }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [shots, setShots] = useState<File[]>([]);
  const [flash, setFlash] = useState(false);

  // Ouverture de la caméra à l'affichage, arrêt à la fermeture (sinon le voyant caméra reste allumé)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    openBackCamera()
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch((err) => {
        console.error(err);
        setError(
          err?.name === 'NotAllowedError'
            ? "Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, ou utilise l'appareil photo du téléphone."
            : "Impossible d'ouvrir la caméra ici."
        );
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Prise de vue : l'image courante de la vidéo est copiée dans un JPEG
  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        if (!multiple) {
          onCapture([file]);
          return onClose();
        }
        // Petit éclair blanc pour confirmer la prise de vue
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        setShots((s) => [...s, file]);
      },
      'image/jpeg',
      0.9
    );
  }

  function finish() {
    if (shots.length > 0) onCapture(shots);
    onClose();
  }

  const full = shots.length >= remaining;

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="Appareil photo">
      <video ref={videoRef} playsInline muted className="flex-1 min-h-0 w-full object-cover" />
      {flash && <div className="absolute inset-0 bg-white/70 pointer-events-none" />}

      {/* Caméra indisponible : message et bascule vers l'appareil photo du téléphone */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
          <p>{error}</p>
          <button
            onClick={() => {
              onClose();
              onFallback();
            }}
            className="btn-hand"
          >
            Utiliser l&apos;appareil photo du téléphone
          </button>
        </div>
      )}

      {/* Barre du bas : fermer | déclencheur | terminer */}
      <div className="flex items-center justify-between gap-4 px-6 py-5 bg-black text-white">
        <button onClick={multiple ? finish : onClose} aria-label="Fermer" className="p-2">
          <X size={28} />
        </button>
        <button
          onClick={takePhoto}
          disabled={!ready || full}
          aria-label="Prendre la photo"
          className="w-16 h-16 rounded-full border-4 border-white bg-white/30 active:bg-white disabled:opacity-40"
        />
        {multiple ? (
          <button onClick={finish} className="text-sm font-bold min-w-16 text-right">
            {shots.length > 0 ? `OK (${shots.length})` : ''}
          </button>
        ) : (
          <span className="min-w-16" />
        )}
      </div>
    </div>
  );
}
