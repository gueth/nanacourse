'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useConfirm } from '@/components/ConfirmDialog';
import { DefiCoupons } from '@/components/gazette/DefiCoupons';
import {
  activeChallenge,
  challengeEnd,
  claimReward,
  describeChallengeError,
  pointsSummary,
  shortDate,
  useChallenges,
  useRewards,
  weekKey,
  weeklyStock,
  type Reward
} from '@/lib/challenges';

// Page 2 de l'accueil, sous la liste de courses : le stock de coupons à gagner cette semaine, en coupons détachables
// (arracher un coupon, après confirmation, retire son coût des points et le range dans Profil > Mes coupons ;
// son trou reste jusqu'au nouveau stock, le lundi), puis le défi de la semaine, lui aussi en coupon. Les rubriques sont titrées par la page (Ribbon) : "ribbon".

export function RewardsCorner({ ribbon }: { ribbon: (title: string) => React.ReactNode }) {
  const challengesQuery = useChallenges();
  const rewardsQuery = useRewards();
  const { available } = pointsSummary(challengesQuery.data, rewardsQuery.data?.claims);
  const [confirm, confirmDialog] = useConfirm('gazette');
  const [message, setMessage] = useState('');

  // Arrachage d'un coupon : refusé s'il manque des points, sinon confirmation puis gain (son coût est retiré)
  async function claim(r: Reward, slot: string) {
    setMessage('');
    if (available < r.cost) {
      setMessage(`Il te manque ${r.cost - available} points pour « ${r.label} ».`);
      return false;
    }
    if (
      !(await confirm('Gagner le coupon', `Échanger ${r.cost} points contre le coupon « ${r.label} » ? Il te restera ${available - r.cost} points, et le coupon t'attendra dans ton profil.`, {
        confirm: 'Gagner',
        cancel: 'Annuler'
      }))
    )
      return false;
    const err = await claimReward(r, slot);
    if (err) {
      setMessage(describeChallengeError(err));
      return false;
    }
    setMessage(`Coupon gagné : ${r.label}. Il est rangé dans ton profil.`);
    rewardsQuery.reload();
    return true;
  }

  const error = rewardsQuery.error ?? challengesQuery.error;
  const rewards = rewardsQuery.data?.rewards;
  const claims = rewardsQuery.data?.claims;
  const week = weekKey();
  const stock = useMemo(() => weeklyStock(rewards ?? [], week), [rewards, week]);
  // Coupons du stock déjà gagnés cette semaine : leur trou reste jusqu'à lundi
  const won = useMemo(() => new Set((claims ?? []).map((c) => c.slot).filter((s): s is string => !!s)), [claims]);

  return (
    <>
      {confirmDialog}
      {ribbon('Les coupons de la semaine')}
      <p className="mt-2 text-center text-[13px] italic">
        Tu as <b className="not-italic">{available}</b> point{Math.abs(available) > 1 ? 's' : ''} à dépenser
      </p>
      {error && <p className="mt-2 text-center text-[12px]">{describeChallengeError({ message: error })}</p>}
      {message && <p className="mt-2 text-center text-[12px] font-bold">{message}</p>}
      {!rewardsQuery.data && !error && <p className="mt-2 text-center text-[12px] italic">Impression…</p>}
      <DefiCoupons
        torn={won}
        onTear={(item) => {
          const pick = stock.find((s) => s.slot === item.id);
          return pick ? claim(pick.reward, pick.slot) : false;
        }}
        defis={stock.map(({ slot, reward }, i) => ({
          id: slot,
          kicker: `Coupon n° ${String(i + 1).padStart(2, '0')}`,
          title: reward.label,
          stamp: ['Coûte', String(reward.cost), 'points'],
          footer: ['Stock de la semaine', available >= reward.cost ? '*Arrache-le pour le gagner' : `*Encore ${reward.cost - available} pts`],
          muted: available < reward.cost
        }))}
      />
      <p className="mt-2 text-center text-[11px] italic">Nouveau stock chaque lundi</p>
    </>
  );
}

export function WeeklyChallenge({ ribbon }: { ribbon: (title: string) => React.ReactNode }) {
  const challengesQuery = useChallenges();
  const current = activeChallenge(challengesQuery.data);
  return (
    <>
      {ribbon('Les brèves · défi de la semaine')}
      {current ? (
        <DefiCoupons
          defis={[
            {
              id: current.id,
              kicker: 'Défi de la semaine',
              title: current.title,
              stamp: ['Bon pour', String(current.points), 'points'],
              footer: ['À relever', `*Valable jusqu'au ${shortDate(challengeEnd(current))}`]
            }
          ]}
        />
      ) : (
        <p className="mt-3 text-center text-[13px] italic">
          {challengesQuery.data ? (
            <>
              Aucun défi en cours.{' '}
              <Link href="/profile" className="underline underline-offset-2">
                Choisis-en un dans ton profil
              </Link>
              .
            </>
          ) : (
            'Impression…'
          )}
        </p>
      )}
    </>
  );
}
