'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
// Réduction + conversion JPEG de la photo avant envoi (partagée avec le scan du frigo)
import { toJpeg } from '@/lib/image';

export type ScanResult = { name: string; price: number | null };

type Props = {
  // Appelée avec le nom et le prix lus sur l'étiquette
  onResult: (result: ScanResult) => void;
};

// Bouton appareil photo : prend (ou choisit) une photo d'étiquette de prix,
// l'envoie à /api/scan-price et renvoie le nom et le prix du produit lus dessus.
export default function ScanLabelButton({ onResult }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  async function handleScan(file: File) {
    setScanning(true);
    setError('');
    try {
      const jpeg = await toJpeg(file);
      if (!jpeg) {
        setError('Format de photo non pris en charge : essaie avec une photo JPEG ou PNG.');
        return;
      }
      const formData = new FormData();
      formData.append('photo', jpeg, 'etiquette.jpg');
      const res = await fetch('/api/scan-price', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Échec de l'analyse de la photo.");
        return;
      }
      onResult({ name: data.name ?? '', price: data.price ?? null });
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
        onClick={() => fileInputRef.current?.click()}
        disabled={scanning}
        title="Prendre une photo de l'étiquette"
        className="flex items-center gap-2 px-3 h-10 rounded-full border-2 border-ink bg-paper shrink-0 disabled:opacity-50"
      >
        <Camera size={18} />
        <span className="text-sm">{scanning ? 'Lecture...' : "Scanner l'étiquette"}</span>
      </button>
      {error && <p className="text-sm text-brick">{error}</p>}
    </div>
  );
}
