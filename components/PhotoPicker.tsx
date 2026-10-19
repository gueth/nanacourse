'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { toJpeg } from '@/lib/image';
import CameraCapture, { canUseInPageCamera } from '@/components/CameraCapture';

export type Photo = { file: File; url: string };

// Photos choisies (avec leur aperçu), limitées à "max".
// Les adresses des aperçus sont libérées quand le composant disparaît.
export function usePhotos(max: number) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState('');
  const previewUrls = useRef<string[]>([]);
  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function add(files: FileList | File[] | null) {
    if (!files) return;
    const room = max - photos.length;
    const added = Array.from(files)
      .slice(0, room)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    previewUrls.current.push(...added.map((p) => p.url));
    setError(files.length > room ? `${max} photos au maximum.` : '');
    setPhotos((p) => [...p, ...added]);
  }

  function remove(index: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[index].url);
      return p.filter((_, i) => i !== index);
    });
  }

  return { photos, add, remove, error };
}

// Photos réduites et converties en JPEG, prêtes à être envoyées dans un FormData (champ "photos").
// Renvoie null si une photo ne peut pas être lue par le navigateur.
export async function photosFormData(photos: Photo[]) {
  const formData = new FormData();
  for (const [i, p] of photos.entries()) {
    const jpeg = await toJpeg(p.file);
    if (!jpeg) return null;
    formData.append('photos', jpeg, `photo-${i + 1}.jpg`);
  }
  return formData;
}

type Props = {
  photos: Photo[];
  max: number;
  onAdd: (files: FileList | File[] | null) => void;
  onRemove: (index: number) => void;
  // Pendant l'analyse : plus d'ajout ni de retrait
  disabled?: boolean;
};

// Boutons "Prendre une photo" / "Choisir des photos" et aperçus des photos choisies (avec une croix pour en retirer une)
export default function PhotoPicker({ photos, max, onAdd, onRemove, disabled = false }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const full = photos.length >= max;
  // Viseur intégré (caméra arrière imposée) ouvert ou non
  const [cameraOpen, setCameraOpen] = useState(false);

  // Viseur intégré si possible (il impose la caméra arrière) ; sinon l'appareil photo du téléphone,
  // à qui capture="environment" demande la caméra arrière sans pouvoir l'imposer
  function openCamera() {
    if (canUseInPageCamera()) setCameraOpen(true);
    else cameraRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onAdd(e.target.files);
    e.target.value = ''; // permet de reprendre la même photo
  }

  return (
    <>
      {/* Deux champs cachés : appareil photo direct, ou choix de plusieurs photos existantes */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleChange} className="hidden" />
      <input ref={galleryRef} type="file" accept="image/*" multiple onChange={handleChange} className="hidden" />

      <div className="flex flex-wrap gap-3 mb-4">
        <button
          type="button"
          onClick={openCamera}
          disabled={full || disabled}
          className="flex items-center gap-2 px-3 h-10 rounded-full border-2 border-ink bg-paper disabled:opacity-50"
        >
          <Camera size={18} /> <span className="text-sm">Prendre une photo</span>
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={full || disabled}
          className="flex items-center gap-2 px-3 h-10 rounded-full border-2 border-ink bg-paper disabled:opacity-50"
        >
          <ImagePlus size={18} /> <span className="text-sm">Choisir des photos</span>
        </button>
      </div>

      {/* Viseur plein écran : plusieurs photos d'affilée, dans la limite restante */}
      {cameraOpen && (
        <CameraCapture
          multiple
          remaining={max - photos.length}
          onCapture={onAdd}
          onClose={() => setCameraOpen(false)}
          onFallback={() => cameraRef.current?.click()}
        />
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {photos.map((p, i) => (
            <div key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:), pas d'optimisation possible */}
              <img src={p.url} alt={`Photo ${i + 1}`} className="w-full h-24 object-cover rounded border-2 border-ink" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={`Retirer la photo ${i + 1}`}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-paper border-2 border-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
