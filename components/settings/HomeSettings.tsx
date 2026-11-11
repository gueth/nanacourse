'use client';

import { NOTICE_HOURS_CHOICES, setNoticeHours, useNoticeHours } from '@/lib/noticeRotation';

// Dossier « Accueil » des paramètres : réglages de la page de titre
export default function HomeSettings() {
  const hours = useNoticeHours();
  return (
    <div className="card card-plain">
      <span className="tape" />
      <h3 className="title-hand text-2xl">Notifications</h3>
      <p className="mt-1 text-sm opacity-70">
        La carte des notifications de la page de titre n&apos;en montre qu&apos;une à la fois, puis passe à la suivante.
      </p>
      <label className="mt-4 flex items-center justify-between gap-3">
        <span className="font-bold">Changer toutes les</span>
        <select
          value={hours}
          onChange={(e) => setNoticeHours(Number(e.target.value))}
          className="input-hand w-auto"
        >
          {NOTICE_HOURS_CHOICES.map((h) => (
            <option key={h} value={h}>
              {h} heure{h > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
