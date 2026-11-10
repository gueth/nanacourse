import { Bath, Bike, BookOpen, ChefHat, Dumbbell, Flower2, Footprints, Lightbulb, ListChecks, Mic, Moon, PartyPopper, Soup, Sparkles, Sprout, Users, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCached } from '@/lib/cache';

// Cycle menstruel (Profil > Mon cycle) : chaque début de règles est noté dans la table "cycle_periods" ;
// la durée du cycle est la moyenne des derniers écarts entre deux débuts de règles. Tant qu'il n'y a pas
// deux dates, on prend la durée de départ saisie, enregistrée sur la ligne de "profile" avec la durée des règles
// (tables et colonnes créées par supabase/cycle.sql).
// La phase du jour colore la page de titre et propose quelques activités adaptées.
// C'est une estimation à partir d'un cycle régulier : ni un avis médical, ni une contraception.

export type PeriodEntry = { id: string; start_date: string }; // AAAA-MM-JJ, premier jour des règles

export type CycleSettings = {
  id?: string; // ligne de la table "profile"
  periods: PeriodEntry[]; // débuts de règles notés, du plus ancien au plus récent
  cycle_start: string | null; // début des dernières règles (le plus récent de "periods")
  base_length: number; // durée de départ du cycle, saisie, utilisée tant qu'aucune moyenne n'est possible
  cycle_length: number; // durée du cycle retenue : la moyenne si elle existe, sinon la durée de départ
  averaged_over: number; // nombre de cycles de la moyenne (0 = durée de départ)
  period_length: number; // durée des règles, en jours
};

export const DEFAULT_CYCLE: CycleSettings = { periods: [], cycle_start: null, base_length: 28, cycle_length: 28, averaged_over: 0, period_length: 5 };
export const CYCLE_LIMITS = { cycle: [21, 40], period: [2, 10] } as const;
// Moyenne sur les 6 derniers cycles ; un écart hors de 15 à 60 jours (règles oubliées, double saisie) est ignoré
const AVERAGE_OF = 6;
const PLAUSIBLE_GAP = [15, 60] as const;

export type PhaseId = 'regles' | 'folliculaire' | 'ovulation' | 'luteale';

type PhaseInfo = {
  label: string;
  // Couleurs de la page de titre : fond (haut, milieu, bas), halos, lettres du titre, carte de la liste de courses
  colors: { bg: [string, string, string]; glow: [string, string, string]; title: [string, string]; card: [string, string]; accent: string };
  activities: { label: string; icon: LucideIcon }[];
};

export const PHASES: Record<PhaseId, PhaseInfo> = {
  regles: {
    label: 'Règles',
    colors: {
      bg: ['#f3e1e1', '#eccaca', '#efdcdc'],
      glow: ['rgba(214, 70, 80, 0.5)', 'rgba(255, 196, 170, 0.55)', 'rgba(232, 150, 160, 0.55)'],
      title: ['#fff3f3', '#f19aa3'],
      card: ['#d77a80', '#a9444f'],
      accent: '#b8434f'
    },
    activities: [
      { label: 'Repos', icon: Moon },
      { label: 'Bain chaud', icon: Bath },
      { label: 'Soupe réconfortante', icon: Soup },
      { label: 'Marche douce', icon: Footprints }
    ]
  },
  folliculaire: {
    label: 'Phase folliculaire',
    colors: {
      bg: ['#e9e3f3', '#dcd0ee', '#e6def1'],
      glow: ['rgba(146, 100, 214, 0.5)', 'rgba(200, 186, 255, 0.55)', 'rgba(186, 160, 232, 0.55)'],
      title: ['#ffffff', '#c3a6ef'],
      card: ['#a58ad2', '#7258a8'],
      accent: '#7a5bb5'
    },
    activities: [
      { label: 'Nouveau projet', icon: Lightbulb },
      { label: 'Vélo, cardio', icon: Bike },
      { label: 'Apprendre', icon: BookOpen },
      { label: 'Planter des idées', icon: Sprout }
    ]
  },
  ovulation: {
    label: 'Ovulation',
    colors: {
      bg: ['#f6e9de', '#f3d9c3', '#f4e4d6'],
      glow: ['rgba(240, 140, 60, 0.5)', 'rgba(255, 214, 150, 0.6)', 'rgba(246, 170, 120, 0.55)'],
      title: ['#fffaf3', '#f5b37a'],
      card: ['#eb9c5f', '#c46a2f'],
      accent: '#c66a2c'
    },
    activities: [
      { label: 'Voir du monde', icon: Users },
      { label: 'Sport intense', icon: Dumbbell },
      { label: 'Sortir', icon: PartyPopper },
      { label: 'Prendre la parole', icon: Mic }
    ]
  },
  luteale: {
    label: 'Phase lutéale',
    colors: {
      bg: ['#f4e3ec', '#efd0e2', '#f2dee9'],
      glow: ['rgba(226, 120, 180, 0.5)', 'rgba(255, 206, 222, 0.6)', 'rgba(236, 168, 206, 0.55)'],
      title: ['#ffffff', '#f2a9d2'],
      card: ['#de8fbb', '#b25d8d'],
      accent: '#b0568a'
    },
    activities: [
      { label: 'Organiser', icon: ListChecks },
      { label: 'Cuisiner maison', icon: ChefHat },
      { label: 'Pilates, yoga', icon: Flower2 },
      { label: 'Ranger', icon: Sparkles }
    ]
  }
};

const DAY_MS = 86_400_000;
// Jour à minuit UTC, pour compter des jours entiers sans être gêné par les changements d'heure
const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
};

// Phase du jour : jour du cycle (1 = premier jour des règles), en supposant des cycles réguliers depuis la date donnée.
// L'ovulation est estimée 14 jours avant les règles suivantes (± 1 jour). null si le cycle n'est pas renseigné.
export function cyclePhase(settings: CycleSettings | undefined, today: Date) {
  if (!settings?.cycle_start) return null;
  const since = dayIndex(today) - parseDay(settings.cycle_start);
  if (since < 0) return null;
  const length = settings.cycle_length;
  const day = (since % length) + 1;
  const ovulation = length - 14;
  const phase: PhaseId =
    day <= settings.period_length ? 'regles' : day < ovulation - 1 ? 'folliculaire' : day <= ovulation + 1 ? 'ovulation' : 'luteale';
  return { phase, day, nextPeriodIn: length - day + 1 };
}

// Écart en jours entre deux débuts de règles
export const daysBetween = (from: string, to: string) => parseDay(to) - parseDay(from);
const isPlausibleGap = (gap: number) => gap >= PLAUSIBLE_GAP[0] && gap <= PLAUSIBLE_GAP[1];

// Durée moyenne du cycle d'après les débuts de règles notés (triés du plus ancien au plus récent),
// ou null s'il n'y a pas encore d'écart utilisable
export function averageCycle(periods: PeriodEntry[]) {
  const gaps = periods
    .slice(1)
    .map((p, i) => daysBetween(periods[i].start_date, p.start_date))
    .filter(isPlausibleGap)
    .slice(-AVERAGE_OF);
  if (gaps.length === 0) return null;
  // Gardée dans les limites d'un cycle pour le calcul des phases
  const mean = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  return { length: Math.min(CYCLE_LIMITS.cycle[1], Math.max(CYCLE_LIMITS.cycle[0], mean)), count: gaps.length };
}

// Assemble le cycle à partir des réglages du profil et des débuts de règles notés
export function buildCycle(base: { id?: string; base_length: number; period_length: number }, periods: PeriodEntry[]): CycleSettings {
  const sorted = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const average = averageCycle(sorted);
  return {
    ...base,
    periods: sorted,
    cycle_start: sorted.at(-1)?.start_date ?? null,
    cycle_length: average?.length ?? base.base_length,
    averaged_over: average?.count ?? 0
  };
}

const MISSING = 'Les tables du cycle manquent : lance supabase/cycle.sql dans Supabase.';
const describe = (error: { code?: string; message: string }) =>
  ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ? MISSING : error.message;

// Lecture du cycle (valeurs par défaut si rien n'est enregistré). Erreur explicite si les tables manquent.
export async function fetchCycle(): Promise<CycleSettings> {
  const [profile, periods] = await Promise.all([
    supabase.from('profile').select('id, cycle_length, period_length').limit(1),
    supabase.from('cycle_periods').select('id, start_date').order('start_date')
  ]);
  const error = profile.error ?? periods.error;
  if (error) {
    console.error(error);
    throw new Error(describe(error));
  }
  const row = profile.data?.[0];
  return buildCycle(
    { id: row?.id, base_length: row?.cycle_length ?? DEFAULT_CYCLE.base_length, period_length: row?.period_length ?? DEFAULT_CYCLE.period_length },
    (periods.data as PeriodEntry[]) ?? []
  );
}

// Enregistre la durée de départ du cycle et la durée des règles sur la ligne de profil existante, ou crée la première.
// Renvoie le message d'erreur, ou null.
export async function saveCycle(current: CycleSettings, values: { base_length: number; period_length: number }) {
  const row = { cycle_length: values.base_length, period_length: values.period_length };
  const { error } = current.id ? await supabase.from('profile').update(row).eq('id', current.id) : await supabase.from('profile').insert(row);
  if (!error) return null;
  console.error(error);
  return describe(error);
}

// Note le début de règles d'une date (AAAA-MM-JJ). Renvoie le message d'erreur, ou null.
export async function addPeriod(startDate: string) {
  const { error } = await supabase.from('cycle_periods').insert({ start_date: startDate });
  if (!error) return null;
  console.error(error);
  return error.code === '23505' ? 'Cette date est déjà notée.' : describe(error);
}

// Retire un début de règles noté par erreur. Renvoie le message d'erreur, ou null.
export async function deletePeriod(id: string) {
  const { error } = await supabase.from('cycle_periods').delete().eq('id', id);
  if (!error) return null;
  console.error(error);
  return describe(error);
}

// Cycle gardé en mémoire entre les pages (affiché tout de suite, rechargé en arrière-plan)
export function useCycle() {
  return useCached('profil:cycle', fetchCycle);
}
