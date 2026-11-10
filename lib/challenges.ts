'use client';

import { must, useCached } from '@/lib/cache';
import { supabase } from '@/lib/supabase';

// Défis et bons d'achat (voir supabase/challenges.sql).
//  - Un défi : un intitulé, une durée (en jours) et les points qu'il rapporte. Un seul défi est en cours à la fois
//    (le défi de la semaine, choisi dans Profil > Défis). Avant d'en commencer un autre, ou pour le supprimer, on dit
//    s'il a été réussi (ses points comptent) ou échoué : il passe alors dans l'historique (Paramètres > Défis),
//    d'où on peut le rejouer.
//  - Les points des défis réussis permettent de gagner des coupons (accueil, page 2) : aller au cinéma,
//    commander une pizza... Points disponibles = points des défis réussis − coût des coupons gagnés.
//  - Le stock de coupons à gagner est tiré au sort chaque semaine (du lundi au dimanche), parmi les bons d'achat,
//    avec des doublons possibles ; chaque coupon du stock ne se gagne qu'une fois dans sa semaine.
//  - Un coupon gagné reste dans Profil > Mes coupons jusqu'au jour où on l'utilise, puis disparaît.
//    On peut en accumuler autant qu'on veut, y compris plusieurs identiques.

export type ChallengeStatus = 'active' | 'success' | 'failed';
export type Challenge = {
  id: string;
  title: string;
  duration_days: number;
  points: number;
  status: ChallengeStatus;
  started_at: string;
  ended_at: string | null;
};
export type ChallengeValues = Pick<Challenge, 'title' | 'duration_days' | 'points'>;
export type Reward = { id: string; label: string; cost: number; position: number };
// Un coupon gagné : slot = sa place dans le stock de la semaine (une seule fois), used_at = date d'utilisation
export type RewardClaim = {
  id: string;
  reward_id: string | null;
  label: string;
  cost: number;
  claimed_at: string;
  slot: string | null;
  used_at: string | null;
};

type DbError = { code?: string; message: string } | null;

// Message lisible pour une erreur Supabase (tables absentes : script à lancer)
export function describeChallengeError(error: { code?: string; message: string }) {
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || /challenges|rewards|reward_claims|slot|used_at/.test(error.message)
    ? 'Les défis et les coupons ne sont pas encore à jour dans Supabase : lance le script supabase/challenges.sql dans l’éditeur SQL.'
    : error.message;
}

// Tous les défis, du plus récent au plus ancien
export function useChallenges() {
  return useCached('defis:liste', async () =>
    must<Challenge[]>(await supabase.from('challenges').select('*').order('started_at', { ascending: false }))
  );
}

// Bons d'achat proposés, et ceux déjà récupérés (du plus récent au plus ancien)
export function useRewards() {
  return useCached('defis:bons', async () => {
    const [rewards, claims] = await Promise.all([
      supabase.from('rewards').select('*').order('position').order('cost'),
      supabase.from('reward_claims').select('*').order('claimed_at', { ascending: false })
    ]);
    return { rewards: must<Reward[]>(rewards), claims: must<RewardClaim[]>(claims) };
  });
}

export const activeChallenge = (challenges: Challenge[] | undefined) => challenges?.find((c) => c.status === 'active') ?? null;

// Points gagnés (défis réussis), dépensés (bons récupérés) et disponibles
export function pointsSummary(challenges: Challenge[] | undefined, claims: RewardClaim[] | undefined) {
  const earned = (challenges ?? []).filter((c) => c.status === 'success').reduce((s, c) => s + c.points, 0);
  const spent = (claims ?? []).reduce((s, c) => s + c.cost, 0);
  return { earned, spent, available: earned - spent };
}

// Fin prévue d'un défi : début + sa durée
export function challengeEnd(c: Pick<Challenge, 'started_at' | 'duration_days'>) {
  const end = new Date(c.started_at);
  end.setDate(end.getDate() + c.duration_days);
  return end;
}

export const shortDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
export const durationLabel = (days: number) => (days % 7 === 0 ? `${days / 7} semaine${days > 7 ? 's' : ''}` : `${days} jour${days > 1 ? 's' : ''}`);

// Commence un défi
export async function createChallenge(values: ChallengeValues): Promise<DbError> {
  const { error } = await supabase.from('challenges').insert({
    title: values.title.trim(),
    duration_days: Math.max(1, Math.round(values.duration_days) || 1),
    points: Math.max(0, Math.round(values.points) || 0),
    status: 'active'
  });
  return error;
}

// Termine un défi : réussi (ses points comptent) ou échoué ; il passe dans l'historique
export async function closeChallenge(id: string, status: 'success' | 'failed'): Promise<DbError> {
  const { error } = await supabase.from('challenges').update({ status, ended_at: new Date().toISOString() }).eq('id', id);
  return error;
}

// Retire un défi de l'historique (ses points ne comptent plus)
export async function deleteChallenge(id: string): Promise<DbError> {
  const { error } = await supabase.from('challenges').delete().eq('id', id);
  return error;
}

// Gagne un coupon du stock de la semaine : son coût est retiré des points disponibles, et il rejoint « Mes coupons »
export async function claimReward(reward: Reward, slot: string): Promise<DbError> {
  const { error } = await supabase.from('reward_claims').insert({ reward_id: reward.id, label: reward.label, cost: reward.cost, slot });
  return error;
}

// Utilise un coupon gagné : il disparaît de « Mes coupons » (ses points restent dépensés)
export async function spendCoupon(id: string): Promise<DbError> {
  const { error } = await supabase.from('reward_claims').update({ used_at: new Date().toISOString() }).eq('id', id);
  return error;
}

// Coupons gagnés pas encore utilisés, regroupés par intitulé (le plus ancien en premier dans chaque groupe)
export function ownedCoupons(claims: RewardClaim[] | undefined) {
  const groups = new Map<string, RewardClaim[]>();
  for (const c of [...(claims ?? [])].reverse()) {
    if (c.used_at) continue;
    groups.set(c.label, [...(groups.get(c.label) ?? []), c]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

// --- Stock de la semaine ---
const STOCK_SIZE = 6;

// Lundi de la semaine en cours (AAAA-MM-JJ, heure locale) : le stock change chaque lundi
export function weekKey(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Tirage au sort reproductible : même semaine -> même stock, sur tous les appareils
function seededRandom(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Stock de coupons à gagner cette semaine : STOCK_SIZE bons tirés au sort (doublons possibles), du moins cher au plus cher.
// Chaque coupon a sa place (slot) « semaine:numéro », qui ne se gagne qu'une fois.
export function weeklyStock(rewards: Reward[], week = weekKey()) {
  if (!rewards.length) return [];
  const random = seededRandom(`${week}:${rewards.map((r) => r.id).join(',')}`);
  const picks = Array.from({ length: STOCK_SIZE }, () => rewards[Math.floor(random() * rewards.length)]);
  return picks.sort((a, b) => a.cost - b.cost).map((reward, i) => ({ slot: `${week}:${i}`, reward }));
}
