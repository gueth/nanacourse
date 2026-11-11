'use client';

import { playSfx } from '@/lib/sfx';
import { useCallback, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { PaperModal, PF, serif } from '@/components/profile/ProfileParts';
import {
  closeChallenge,
  createChallenge,
  describeChallengeError,
  type Challenge,
  type ChallengeValues
} from '@/lib/challenges';

// Fenêtres des défis, au style de la page Profil (variant "profile") ou de l'application (Paramètres) :
//  - la question « réussi ou échoué ? » posée avant de terminer le défi en cours ;
//  - le formulaire d'un nouveau défi (intitulé, durée, points).

type Variant = 'profile' | 'default';
type Outcome = 'success' | 'failed';

function Frame({ variant, title, onClose, children }: { variant: Variant; title: string; onClose: () => void; children: React.ReactNode }) {
  return variant === 'profile' ? (
    <PaperModal title={title} onClose={onClose}>
      <div style={serif}>{children}</div>
    </PaperModal>
  ) : (
    <Modal title={title} onClose={onClose}>
      {children}
    </Modal>
  );
}

const buttons = (variant: Variant) =>
  variant === 'profile'
    ? { main: 'rounded px-4 py-2 text-sm text-white disabled:opacity-50', mainStyle: { backgroundColor: PF.blue }, ghost: 'rounded px-3 py-2 text-sm', danger: 'rounded bg-brick px-4 py-2 text-sm text-white' }
    : { main: 'btn-hand', mainStyle: undefined, ghost: 'btn-ghost', danger: 'btn-hand bg-brick' };

// Gestion du défi en cours : commencer un défi (après avoir dit si le précédent est réussi) ou terminer celui en cours.
// Renvoie les actions et la fenêtre de question, à afficher dans la page ({dialog}).
export function useChallengeActions(variant: Variant, onChanged: () => void) {
  const [request, setRequest] = useState<{ challenge: Challenge; intro: string } | null>(null);
  const resolveRef = useRef<(o: Outcome | null) => void>(() => {});
  const [error, setError] = useState('');

  const askOutcome = useCallback((challenge: Challenge, intro: string) => {
    setRequest({ challenge, intro });
    return new Promise<Outcome | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);
  const answer = (o: Outcome | null) => {
    setRequest(null);
    resolveRef.current(o);
  };

  // Termine le défi en cours (réussi ou échoué) ; false si on a annulé ou en cas d'erreur
  async function finish(current: Challenge, intro: string) {
    const outcome = await askOutcome(current, intro);
    if (!outcome) return false;
    const err = await closeChallenge(current.id, outcome);
    if (err) {
      setError(describeChallengeError(err));
      return false;
    }
    playSfx(outcome === 'success' ? 'success' : 'close');
    return true;
  }

  // Commence un défi ; s'il y en a déjà un en cours, on dit d'abord s'il a été réussi. Renvoie true si c'est fait.
  async function start(values: ChallengeValues, current: Challenge | null) {
    setError('');
    if (current && !(await finish(current, 'Avant de commencer un nouveau défi, dis comment s’est passé le précédent.'))) {
      onChanged();
      return false;
    }
    const err = await createChallenge(values);
    onChanged();
    if (err) {
      setError(describeChallengeError(err));
      return false;
    }
    return true;
  }

  // Supprime le défi en cours : il passe dans l'historique, réussi ou échoué
  async function remove(current: Challenge) {
    setError('');
    if (await finish(current, 'Avant de retirer ce défi, dis s’il a été réussi : ses points ne comptent que s’il l’est.')) onChanged();
  }

  const b = buttons(variant);
  const dialog = request && (
    <Frame variant={variant} title="Défi réussi ?" onClose={() => answer(null)}>
      <p className="text-sm opacity-80">{request.intro}</p>
      <p className="mt-3 text-lg font-bold">« {request.challenge.title} »</p>
      <p className="text-sm opacity-70">{request.challenge.points} points en jeu</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => answer('success')} className={b.main} style={b.mainStyle}>
          Réussi (+{request.challenge.points} pts)
        </button>
        <button type="button" onClick={() => answer('failed')} className={b.danger}>
          Échoué
        </button>
        <button type="button" autoFocus onClick={() => answer(null)} className={b.ghost}>
          Annuler
        </button>
      </div>
    </Frame>
  );

  return { start, remove, error, dialog };
}

// Formulaire d'un nouveau défi (pré-rempli pour rejouer un ancien défi)
export function ChallengeForm({
  variant,
  initial,
  onSubmit,
  onClose
}: {
  variant: Variant;
  initial?: ChallengeValues;
  onSubmit: (values: ChallengeValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [days, setDays] = useState(String(initial?.duration_days ?? 7));
  const [points, setPoints] = useState(String(initial?.points ?? 10));
  const [saving, setSaving] = useState(false);
  const b = buttons(variant);
  const input = variant === 'profile' ? 'w-full rounded border bg-white/80 px-2 py-1.5 text-sm' : 'input-hand w-full';
  const valid = title.trim() && Number(days) >= 1 && Number(points) >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    const done = await onSubmit({ title, duration_days: Number(days), points: Number(points) });
    setSaving(false);
    if (done) onClose();
  }

  return (
    <Frame variant={variant} title={initial ? 'Rejouer le défi' : 'Nouveau défi'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <label className="block">
          <span className="field-label block">Défi</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Zéro dépense pendant 3 jours" className={input} style={{ borderColor: PF.pale }} autoFocus />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="field-label block">Durée (jours)</span>
            <input value={days} onChange={(e) => setDays(e.target.value)} type="number" min={1} step={1} className={input} style={{ borderColor: PF.pale }} />
          </label>
          <label className="block flex-1">
            <span className="field-label block">Points</span>
            <input value={points} onChange={(e) => setPoints(e.target.value)} type="number" min={0} step={1} className={input} style={{ borderColor: PF.pale }} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={b.ghost}>
            Annuler
          </button>
          <button type="submit" disabled={!valid || saving} className={b.main} style={b.mainStyle}>
            {saving ? 'Enregistrement…' : initial ? 'Rejouer' : 'Commencer le défi'}
          </button>
        </div>
      </form>
    </Frame>
  );
}
