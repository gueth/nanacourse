'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
// Lecture gratuite dans le navigateur (Tesseract.js) et analyse du texte de l'étiquette
import { readLines } from '@/lib/ocr';
import { parseLabel, type LabelResult } from '@/lib/labelParser';
import CameraCapture, { canUseInPageCamera } from '@/components/CameraCapture';

// Nom, prix et, pour le vrac vendu au kilo, le type « kg »
export type ScanResult = LabelResult;

type Props = {
  // Appelée avec le nom et le prix lus sur l'étiquette
  onResult: (result: ScanResult) => void;
};

// Bouton appareil photo : prend (ou choisit) une photo d'étiquette de prix,
// lit son texte sur l'appareil (gratuit) et renvoie le nom et le prix du produit.
export default function ScanLabelButton({ onResult }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  // Viseur intégré (caméra arrière imposée) ouvert ou non
  const [cameraOpen, setCameraOpen] = useState(false);

  // Viseur intégré si possible ; sinon l'appareil photo du téléphone (capture="environment")
  function openCamera() {
    if (canUseInPageCamera()) setCameraOpen(true);
    else fileInputRef.current?.click();
  }

  async function handleScan(file: File) {
    setScanning(true);
    setError('');
    try {
      // Lecture du texte de l'étiquette dans le navigateur (gratuit), puis recherche du nom et du prix
      const result = parseLabel(await readLines([file]));
      if (!result.name && result.price == null) {
        setError("Rien de lisible : reprends l'étiquette de face, nette et bien cadrée.");
        return;
      }
      onResult(result);
    } catch (err) {
      console.error(err);
      setError("Échec de l'analyse de la photo.");
    } finally {
      setScanning(false);
      // Permet de rescanner la même photo
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={scanning}
        onChange={(e) => e.target.files?.[0] && handleScan(e.target.files[0])}
        className="hidden"
      />
      <button
        type="button"
        onClick={openCamera}
        disabled={scanning}
        title="Prendre une photo de l'étiquette"
        className="flex items-center gap-2 px-3 h-10 rounded-full border-2 border-ink bg-paper shrink-0 disabled:opacity-50"
      >
        <Camera size={18} />
        <span className="text-sm">{scanning ? 'Lecture...' : "Scanner l'étiquette"}</span>
      </button>
      {error && <p className="text-sm text-brick">{error}</p>}
      {/* Viseur plein écran : une seule photo, analysée dès qu'elle est prise */}
      {cameraOpen && (
        <CameraCapture
          onCapture={(files) => handleScan(files[0])}
          onClose={() => setCameraOpen(false)}
          onFallback={() => fileInputRef.current?.click()}
        />
      )}
    </div>
  );
}
