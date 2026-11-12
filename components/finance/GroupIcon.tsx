'use client';

import {
  Baby,
  Banknote,
  Briefcase,
  Bus,
  Car,
  Coffee,
  CreditCard,
  Droplet,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Minus,
  Music,
  Palette,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Scissors,
  Settings,
  Shield,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  TrendingUp,
  Tv,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { FIN } from '@/components/finance/FinanceParts';
import { categoryGroups, type CategoryGroup } from '@/lib/transactions';

// Icônes proposées pour les grandes catégories (clé enregistrée en base : category_groups.icon), avec des mots de
// leur nom qui les font choisir d'office tant qu'aucune icône n'a été choisie (sans accents, en minuscules)
export const GROUP_ICONS: { id: string; label: string; Icon: LucideIcon; words: string[] }[] = [
  { id: 'panier', label: 'Courses', Icon: ShoppingCart, words: ['course', 'supermarche', 'marche'] },
  { id: 'nourriture', label: 'Nourriture', Icon: Utensils, words: ['nourriture', 'alimentation', 'repas', 'restaurant', 'manger', 'cantine'] },
  { id: 'cafe', label: 'Café, sorties', Icon: Coffee, words: ['cafe', 'bar', 'sortie'] },
  { id: 'fonctionnement', label: 'Fonctionnement', Icon: Settings, words: ['fonction', 'fonctionnement', 'frais', 'gestion'] },
  { id: 'maison', label: 'Maison', Icon: House, words: ['maison', 'logement', 'loyer', 'habitation', 'foyer'] },
  { id: 'energie', label: 'Énergie', Icon: Zap, words: ['energie', 'electricite', 'gaz'] },
  { id: 'eau', label: 'Eau', Icon: Droplet, words: ['eau'] },
  { id: 'internet', label: 'Internet', Icon: Wifi, words: ['internet', 'box'] },
  { id: 'telephone', label: 'Téléphone', Icon: Smartphone, words: ['telephone', 'mobile', 'forfait'] },
  { id: 'voiture', label: 'Voiture', Icon: Car, words: ['voiture', 'auto', 'vehicule'] },
  { id: 'carburant', label: 'Carburant', Icon: Fuel, words: ['carburant', 'essence', 'gasoil'] },
  { id: 'transport', label: 'Transport', Icon: Bus, words: ['transport', 'bus', 'metro', 'train', 'deplacement'] },
  { id: 'voyage', label: 'Voyages', Icon: Plane, words: ['voyage', 'vacance', 'avion'] },
  { id: 'sante', label: 'Santé', Icon: HeartPulse, words: ['sante', 'medecin', 'mutuelle'] },
  { id: 'pharmacie', label: 'Pharmacie', Icon: Pill, words: ['pharmacie', 'medicament'] },
  { id: 'beaute', label: 'Beauté', Icon: Scissors, words: ['beaute', 'coiffeur', 'soin'] },
  { id: 'vetements', label: 'Vêtements', Icon: Shirt, words: ['vetement', 'habit', 'mode'] },
  { id: 'loisirs', label: 'Loisirs', Icon: Gamepad2, words: ['loisir', 'jeu', 'divertissement'] },
  { id: 'cinema', label: 'Cinéma', Icon: Film, words: ['cinema', 'film'] },
  { id: 'abonnements', label: 'Abonnements', Icon: Tv, words: ['abonnement', 'streaming'] },
  { id: 'musique', label: 'Musique', Icon: Music, words: ['musique', 'concert'] },
  { id: 'sport', label: 'Sport', Icon: Dumbbell, words: ['sport', 'salle', 'fitness'] },
  { id: 'creativite', label: 'Créativité', Icon: Palette, words: ['art', 'creati'] },
  { id: 'cadeaux', label: 'Cadeaux', Icon: Gift, words: ['cadeau', 'don', 'fete'] },
  { id: 'enfants', label: 'Enfants', Icon: Baby, words: ['enfant', 'bebe', 'creche'] },
  { id: 'animaux', label: 'Animaux', Icon: PawPrint, words: ['animal', 'animaux', 'chat', 'chien', 'veterinaire'] },
  { id: 'etudes', label: 'Études', Icon: GraduationCap, words: ['etude', 'ecole', 'formation', 'education'] },
  { id: 'entretien', label: 'Entretien', Icon: Wrench, words: ['entretien', 'reparation', 'bricolage', 'travaux'] },
  { id: 'menage', label: 'Ménage', Icon: Sparkles, words: ['menage', 'nettoyage', 'hygiene'] },
  { id: 'travail', label: 'Travail', Icon: Briefcase, words: ['travail', 'salaire', 'activite', 'emploi', 'professionnel'] },
  { id: 'revenus', label: 'Revenus', Icon: Banknote, words: ['revenu', 'entree', 'paie', 'prime'] },
  { id: 'aides', label: 'Aides', Icon: HandCoins, words: ['aide', 'allocation', 'caf', 'remboursement'] },
  { id: 'epargne', label: 'Épargne', Icon: PiggyBank, words: ['epargne', 'economie', 'livret'] },
  { id: 'placements', label: 'Placements', Icon: TrendingUp, words: ['placement', 'investissement', 'bourse'] },
  { id: 'banque', label: 'Banque', Icon: Landmark, words: ['banque', 'bancaire', 'impot', 'taxe', 'credit', 'emprunt'] },
  { id: 'carte', label: 'Paiements', Icon: CreditCard, words: ['carte', 'paiement'] },
  { id: 'assurance', label: 'Assurances', Icon: Shield, words: ['assurance'] },
  { id: 'factures', label: 'Factures', Icon: Receipt, words: ['facture', 'annuel', 'charge', 'fixe'] },
  { id: 'argent', label: 'Argent', Icon: Wallet, words: ['argent', 'poche', 'divers'] },
  { id: 'panier-bio', label: 'Marché', Icon: ShoppingBasket, words: [] },
  { id: 'autre', label: 'Autre', Icon: Tag, words: [] }
];

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

type GroupIconDef = (typeof GROUP_ICONS)[number];
type IconGroup = Pick<CategoryGroup, 'id' | 'label' | 'kind' | 'icon'>;
const FALLBACK = GROUP_ICONS[GROUP_ICONS.length - 1];

// Icônes qui vont avec un nom, de la plus probable à la moins probable : un mot du nom qui commence par l'un des mots
// de l'icône (« Courses » → course ; « eau » ne trouve pas « beauté »)
function guessedIcons(label: string) {
  const words = plain(label).split(/[^a-z0-9]+/).filter(Boolean);
  return GROUP_ICONS.filter((i) => i.words.some((w) => words.some((n) => n.startsWith(w))));
}

// Icône de chaque grande catégorie. Deux grandes catégories de sorties (ou deux d'entrées) n'ont jamais la même icône ;
// une sortie et une entrée peuvent avoir la même. Les icônes choisies passent d'abord (dans l'ordre de création),
// puis les autres prennent la première icône libre qui va avec leur nom, sinon la première icône libre.
export function resolveGroupIcons(groups: IconGroup[]) {
  const result = new Map<string, GroupIconDef>();
  for (const kind of ['expense', 'income'] as const) {
    const list = groups.filter((g) => g.kind === kind);
    const used = new Set<string>();
    const take = (g: IconGroup, icon: GroupIconDef) => {
      result.set(g.id, icon);
      used.add(icon.id);
    };
    for (const g of list) {
      const chosen = g.icon ? GROUP_ICONS.find((i) => i.id === g.icon) : undefined;
      if (chosen && !used.has(chosen.id)) take(g, chosen);
    }
    for (const g of list) {
      if (result.has(g.id)) continue;
      take(g, guessedIcons(g.label).find((i) => !used.has(i.id)) ?? GROUP_ICONS.find((i) => !used.has(i.id)) ?? FALLBACK);
    }
  }
  return result;
}

// Grandes catégories avec celle-ci à jour (à sa place, ou à la fin si elle n'est pas encore créée)
const withGroup = (group: IconGroup, groups: IconGroup[]) =>
  groups.some((g) => g.id === group.id) ? groups.map((g) => (g.id === group.id ? group : g)) : [...groups, group];

// Icône d'une grande catégorie, parmi toutes les autres
export function groupIconOf(group: IconGroup, groups: IconGroup[] = categoryGroups()) {
  return resolveGroupIcons(withGroup(group, groups)).get(group.id) ?? FALLBACK;
}

// Icônes déjà prises par les autres grandes catégories du même sens (on ne peut pas les choisir pour celle-ci)
export function iconsTakenBesides(group: IconGroup, groups: IconGroup[] = categoryGroups()) {
  const icons = resolveGroupIcons(withGroup(group, groups));
  return new Set(groups.filter((g) => g.id !== group.id && g.kind === group.kind).map((g) => icons.get(g.id)!.id));
}

// Teinte d'une icône : légèrement rouge pour une sortie, légèrement verte pour une entrée
export const iconTone = (kind: CategoryGroup['kind']) =>
  kind === 'income' ? { backgroundColor: '#e2ebe5', color: FIN.sage } : { backgroundColor: '#f3e2e4', color: FIN.rose };

// Virement entre mes comptes (ni sortie ni entrée) : une barre, dans un rond bleu
export function TransferIcon({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, backgroundColor: FIN.navy, color: FIN.paper }}>
      <Minus size={Math.round(size * 0.55)} strokeWidth={2.4} />
    </span>
  );
}

// Icône ronde d'une grande catégorie, teintée selon son sens.
// Sans grande catégorie (catégorie sans regroupement) : un rond vide en pointillés, à la même place.
export function GroupIcon({ group, size = 32 }: { group: IconGroup | null; size?: number }) {
  const box = { width: size, height: size };
  if (!group)
    return <span aria-hidden className="block shrink-0 rounded-full border border-dashed" style={{ ...box, borderColor: FIN.slate, opacity: 0.4 }} />;
  const { Icon } = groupIconOf(group);
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full" style={{ ...box, ...iconTone(group.kind) }}>
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.9} />
    </span>
  );
}
