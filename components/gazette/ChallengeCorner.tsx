'use client';

import { playSfx } from '@/lib/sfx';
import { useMemo, useState } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import { DefiCoupons, type CouponPalette } from '@/components/gazette/DefiCoupons';
import type { ModalVariant } from '@/components/Modal';
import {
  claimReward,
  describeChallengeError,
  pointsSummary,
  useChallenges,
  useRewards,
  weekKey,
  weeklyStock,
  type Reward
} from '@/lib/challenges';

// Page 2 de l'accueil, sous la liste de courses : le stock de coupons à gagner cette semaine, en coupons détachables
// (arracher un coupon, après confirmation, retire son coût des points et le range dans Profil > Mes coupons ;
// son trou reste jusqu'au nouveau stock, le lundi). Les défis en cours n'y figurent pas. La rubrique est titrée par la page (Ribbon) : "ribbon".

// variant / palette : style des popins et couleurs des coupons (gazette par défaut)
export function RewardsCorner({
  ribbon,
  variant = 'gazette',
  palette
}: {
  ribbon: (title: string) => React.ReactNode;
  variant?: ModalVariant;
  palette?: CouponPalette;
}) {
  const challengesQuery = useChallenges();
  const rewardsQuery = useRewards();
  const { available } = pointsSummary(challengesQuery.data, rewardsQuery.data?.claims);
  const [confirm, confirmDialog] = useConfirm(variant);
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
    playSfx('success');
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
        palette={palette}
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
