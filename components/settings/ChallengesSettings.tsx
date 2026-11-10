'use client';

import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import { ChallengeForm, useChallengeActions } from '@/components/challenges/ChallengeDialogs';
import { IconButton, RowList } from '@/components/settings/ui';
import {
  activeChallenge,
  challengeEnd,
  deleteChallenge,
  describeChallengeError,
  durationLabel,
  pointsSummary,
  shortDate,
  useChallenges,
  useRewards,
  type Challenge
} from '@/lib/challenges';

// Dossier « Défis » des paramètres : le total des points, le défi en cours, l'historique des défis
// (réussis ou échoués) qu'on peut rejouer en défi de la semaine, et les coupons gagnés pas encore utilisés.
export default function ChallengesSettings() {
  const challengesQuery = useChallenges();
  const rewardsQuery = useRewards();
  const challenges = challengesQuery.data;
  const claims = rewardsQuery.data?.claims;
  const unused = (claims ?? []).filter((c) => !c.used_at);
  const current = activeChallenge(challenges);
  const history = (challenges ?? []).filter((c) => c.status !== 'active');
  const points = pointsSummary(challenges, claims);
  const [confirm, confirmDialog] = useConfirm();
  const [replaying, setReplaying] = useState<Challenge | null>(null);
  const [error, setError] = useState('');
  const actions = useChallengeActions('default', () => challengesQuery.reload());

  // Retrait d'un défi de l'historique : ses points ne comptent plus
  async function remove(c: Challenge) {
    const detail = c.status === 'success' ? ` Ses ${c.points} points ne compteront plus.` : '';
    if (!(await confirm('Supprimer le défi', `Retirer « ${c.title} » de l'historique ?${detail}`))) return;
    const err = await deleteChallenge(c.id);
    if (err) return setError(describeChallengeError(err));
    challengesQuery.reload();
  }

  const loadError = challengesQuery.error ?? rewardsQuery.error;
  if (!challenges && !loadError) return <p>Chargement...</p>;

  return (
    <div>
      {confirmDialog}
      {(loadError || error || actions.error) && (
        <p className="mb-3 text-sm text-brick">{error || actions.error || describeChallengeError({ message: loadError! })}</p>
      )}

      {/* TOTAL DES POINTS */}
      <div className="card card-plain mb-6">
        <span className="tape" />
        <h3 className="title-hand text-2xl">Mes points</h3>
        <p className="mt-1 text-4xl font-bold">{points.available}</p>
        <p className="text-sm opacity-70">
          {points.earned} gagnés avec les défis réussis · {points.spent} échangés contre des coupons
        </p>
      </div>

      {/* DÉFI EN COURS */}
      <h3 className="title-hand mb-2 text-2xl">Défi de la semaine</h3>
      <RowList empty={current ? undefined : 'Aucun défi en cours : choisis-en un dans ton profil, ou rejoue un défi ci-dessous.'}>
        {current && (
          <li className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{current.title}</span>
              <span className="block text-xs opacity-70">
                {current.points} pts · {durationLabel(current.duration_days)} · jusqu&apos;au {shortDate(challengeEnd(current))}
              </span>
            </span>
            <IconButton label="Terminer ce défi" onClick={() => actions.remove(current)} danger>
              <Trash2 size={18} />
            </IconButton>
          </li>
        )}
      </RowList>

      {/* HISTORIQUE */}
      <h3 className="title-hand mb-2 mt-6 text-2xl">Défis terminés</h3>
      <RowList empty={history.length ? undefined : 'Aucun défi terminé pour l’instant.'}>
        {history.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{c.title}</span>
              <span className="block text-xs opacity-70">
                <span className={c.status === 'success' ? 'font-bold text-herb' : 'text-brick'}>{c.status === 'success' ? `Réussi · +${c.points} pts` : 'Échoué'}</span>
                {c.ended_at && ` · le ${shortDate(new Date(c.ended_at))}`} · {durationLabel(c.duration_days)}
              </span>
            </span>
            <IconButton label={`Rejouer « ${c.title} »`} onClick={() => setReplaying(c)}>
              <RotateCcw size={18} />
            </IconButton>
            <IconButton label="Supprimer" onClick={() => remove(c)} danger>
              <Trash2 size={18} />
            </IconButton>
          </li>
        ))}
      </RowList>

      {/* COUPONS GAGNÉS, PAS ENCORE UTILISÉS (ils s'utilisent depuis le profil) */}
      <h3 className="title-hand mb-2 mt-6 text-2xl">Coupons à utiliser</h3>
      <RowList empty={unused.length ? undefined : 'Aucun coupon : ils se gagnent sur l’accueil, sous la liste de courses, et s’utilisent depuis ton profil.'}>
        {unused.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            <span className="text-xs opacity-70">{shortDate(new Date(c.claimed_at))}</span>
            <span className="font-bold">−{c.cost} pts</span>
          </li>
        ))}
      </RowList>

      {/* Rejouer : formulaire pré-rempli, puis la question sur le défi en cours s'il y en a un */}
      {replaying && (
        <ChallengeForm
          variant="default"
          initial={{ title: replaying.title, duration_days: replaying.duration_days, points: replaying.points }}
          onSubmit={(values) => actions.start(values, current)}
          onClose={() => setReplaying(null)}
        />
      )}
      {actions.dialog}
    </div>
  );
}
