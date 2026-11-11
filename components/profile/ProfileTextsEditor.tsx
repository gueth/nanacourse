'use client';

import { useState } from 'react';
import { DEFAULT_PROFILE_TEXTS, saveProfileTexts, type ProfileTexts } from '@/lib/profileTexts';
import { PaperModal, PF, serif } from '@/components/profile/ProfileParts';

type Field = { key: keyof ProfileTexts; label: string; multiline?: boolean; hint?: string };

// Champs modifiables, rubrique par rubrique
const GROUPS = {
  // Carte « À propos » : un seul crayon pour le texte et le prénom signé en bas
  about: {
    title: 'À propos',
    fields: [
      { key: 'about', label: 'Texte', multiline: true, hint: 'Une ligne vide pour changer de paragraphe' },
      { key: 'name', label: 'Prénom affiché' }
    ]
  },
  position: {
    title: 'Ma position',
    fields: [
      { key: 'positionAddress', label: 'Adresse' },
      { key: 'positionNote', label: 'Précision' }
    ]
  },
  goals: {
    title: 'Objectifs',
    fields: [
      { key: 'goalsLabel', label: 'Intitulé' },
      { key: 'goals', label: 'Objectifs', multiline: true, hint: 'Un objectif par ligne' }
    ]
  },
  identity: {
    title: 'Carte de visite',
    fields: [
      { key: 'phone', label: 'Téléphone' },
      { key: 'email', label: 'Email' },
      { key: 'website', label: 'Site web' },
      { key: 'quote', label: 'Phrase du bas' }
    ]
  }
} satisfies Record<string, { title: string; fields: Field[] }>;

export type ProfileSection = keyof typeof GROUPS;

// Fenêtre de modification d'une rubrique du profil : un brouillon qu'on enregistre (dans Supabase) ou qu'on abandonne
export default function ProfileTextsEditor({ section, texts, onClose }: { section: ProfileSection; texts: ProfileTexts; onClose: () => void }) {
  const group: { title: string; fields: Field[] } = GROUPS[section];
  const [draft, setDraft] = useState(texts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Textes d'origine de cette rubrique seulement
  const resetSection = () => setDraft((d) => ({ ...d, ...Object.fromEntries(group.fields.map((f) => [f.key, DEFAULT_PROFILE_TEXTS[f.key]])) }));
  const set = (key: keyof ProfileTexts, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const inputClass = 'w-full rounded border bg-white/80 px-2 py-1.5 text-sm';

  async function save() {
    setSaving(true);
    setError('');
    const message = await saveProfileTexts(draft);
    setSaving(false);
    if (message) return setError(message);
    onClose();
  }

  return (
    <PaperModal
      title={group.title}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mb-2 text-xs text-brick">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={resetSection} className="text-xs underline opacity-70">
              Textes d&apos;origine
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm">
                Annuler
              </button>
              <button type="button" onClick={save} disabled={saving} className="rounded px-4 py-2 text-sm text-white disabled:opacity-60" style={{ backgroundColor: PF.blue }}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </>
      }
    >
      <div style={serif}>
        {group.fields.map((f) => (
          <label key={f.key} className="mt-2 block text-xs">
            <span style={{ color: PF.blue }}>{f.label}</span>
            {f.multiline ? (
              <textarea value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={f.key === 'about' ? 8 : 3} className={inputClass} style={{ borderColor: PF.pale }} />
            ) : (
              <input value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} className={inputClass} style={{ borderColor: PF.pale }} />
            )}
            {f.hint && <span className="text-[10px] opacity-60">{f.hint}</span>}
          </label>
        ))}
      </div>
    </PaperModal>
  );
}
