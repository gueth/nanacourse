import { supabase } from '@/lib/supabase';
import { addLine, fetchOrSeedLines, importMayWrite, SECTIONS, setLineAmount, shiftMonth, updateLine } from '@/lib/finance';
import type { ParsedTransaction, StatementSummary } from '@/lib/bankImport';

// Opérations bancaires importées depuis les relevés, classées par catégorie, et budget par catégorie.
// Tables : voir supabase/finance_coach.sql

export type Transaction = {
  id: string;
  date: string; // AAAA-MM-JJ
  label: string;
  amount: number; // négatif pour une dépense
  category: string;
  account: string;
  import_key: string;
};

export type Kind = 'income' | 'fixed' | 'variable' | 'transfer';

export type Category = {
  id: string;
  label: string;
  kind: Kind;
  essential?: boolean; // dépense indispensable (comptée dans la réserve de sécurité)
  sign?: 1 | -1; // ne s'applique qu'aux entrées (1) ou aux sorties (-1)
  section?: string; // rubrique du compte de résultat où reporter le total
  line?: string; // ligne de cette rubrique
  keywords: string[];
  custom?: boolean; // catégorie créée par l'utilisateur (table custom_categories)
  group?: string | null; // grande catégorie qui la regroupe (table category_groups), null si elle n'est pas regroupée
};

// Le mot-clé le plus long (donc le plus précis) l'emporte : "GRAND FRAIS" (courses) passe avant "FRAIS" (frais bancaires) ;
// à égalité, la première catégorie de la liste. Un mot-clé terminé par * est un début de mot ("PIZZ*" : PIZZERIA, PIZZA HUT...).
export const CATEGORIES: Category[] = [
  { id: 'virement_interne', label: 'Virements entre mes comptes', kind: 'transfer', keywords: ['VIREMENT INTERNE', 'VIR INTERNE', 'VERS LIVRET', 'VERS LDDS', 'VERS LEP', 'VERS PEL', 'LIVRET A', 'LDDS'] },
  { id: 'salaire', label: 'Salaire', kind: 'income', sign: 1, section: 'revenus', line: 'Salaire net', keywords: ['SALAIRE', 'SALAIRES', 'PAIE', 'REMUNERATION', 'TRAITEMENT'] },
  { id: 'aides', label: 'Aides et allocations', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Aides et allocations', keywords: ['CAF', 'C.A.F', 'POLE EMPLOI', 'FRANCE TRAVAIL', 'ALLOCATION', 'PRIME ACTIVITE', 'APL', 'PAIERIE', 'BOURSE*'] },
  { id: 'remboursements', label: 'Remboursements', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Remboursements', keywords: ['CPAM', 'AMELI', 'REMBOURSEMENT', 'REMB', 'MUTUELLE'] },
  { id: 'interets', label: 'Intérêts et dividendes', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Intérêts et dividendes', keywords: ['INTERETS', 'DIVIDENDE', 'COUPON'] },
  { id: 'ventes', label: 'Ventes (Vinted, Leboncoin…)', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Ventes', keywords: ['MANGOPAY', 'VINTED', 'LEBONCOIN', 'EBAY'] },
  { id: 'frais_bancaires', label: 'Frais bancaires', kind: 'fixed', sign: -1, section: 'engagements', line: 'Frais bancaires', keywords: ['FRAIS', 'COTISATION MENSUELLE CARTE', 'COTISATION CARTE', 'COTIS CARTE', 'COMMISSION', 'AGIOS', 'INTERETS DEBITEURS', 'ASSURANCE MOYEN DE PAIEMENT', 'COM CHANGE'] },
  { id: 'logement', label: 'Loyer', kind: 'fixed', essential: true, sign: -1, section: 'logement', line: 'Loyer ou mensualité', keywords: ['LOYER', 'FONCIA', 'NEXITY', 'CITYA', 'ORPI', 'HABITAT', 'SYNDIC', 'BAILLEUR', 'IMMOCONSEIL', 'AGENCE IMMOBILIERE', 'RENT', 'HOUSING'] },
  { id: 'energie', label: 'Énergie', kind: 'fixed', essential: true, sign: -1, section: 'logement', line: 'Énergie', keywords: ['EDF', 'ENGIE', 'TOTALENERGIES ELECTRICITE', 'TOTALENERGIES GAZ', 'ENI', 'GAZ', 'ELECTRICITE', 'EKWATEUR', 'OHM ENERGIE', 'MINT ENERGIE'] },
  { id: 'eau', label: 'Eau', kind: 'fixed', essential: true, sign: -1, section: 'logement', line: 'Eau', keywords: ['VEOLIA', 'SAUR', 'SUEZ', 'EAU DE'] },
  { id: 'telecom', label: 'Internet et téléphone', kind: 'fixed', essential: true, sign: -1, section: 'logement', line: 'Internet et téléphone', keywords: ['ORANGE', 'SFR', 'BOUYGUES', 'FREE MOBILE', 'FREE TELECOM', 'FREEBOX', 'SOSH', 'RED BY SFR', 'B AND YOU', 'PRIXTEL', 'LA POSTE MOBILE'] },
  { id: 'restaurants', label: 'Restaurants', kind: 'variable', sign: -1, section: 'vie_courante', line: 'Restaurants', keywords: ['RESTAURANT', 'RESTO', 'MCDONALD', 'MC DONALD', 'MCDO', 'BURGER KING', 'KFC', 'QUICK', 'UBER EATS', 'UBER *EATS', 'DELIVEROO', 'JUST EAT', 'GLOVO', 'STARBUCKS', 'BRASSERIE', 'PIZZ*', 'SUSHI', 'KEBAB', 'PAUL', 'COLUMBUS', 'BISTROT', 'BISTRO', 'GRILL*', 'SAVEURS', 'TRATTORIA', 'CREPERIE', 'BURGER', 'OTACOS', 'O TACOS', 'MAMACITA', 'SAN MARCO'] },
  { id: 'courses', label: 'Courses', kind: 'variable', essential: true, sign: -1, section: 'vie_courante', line: 'Courses', keywords: ['CARREFOUR', 'LECLERC', 'AUCHAN', 'LIDL', 'ALDI', 'INTERMARCHE', 'MONOPRIX', 'FRANPRIX', 'CASINO', 'SUPER U', 'HYPER U', 'U EXPRESS', 'SYSTEME U', 'PICARD', 'NETTO', 'GRAND FRAIS', 'BIOCOOP', 'NATURALIA', 'LA VIE CLAIRE', 'LEADER PRICE', 'COCCINELLE', 'SPAR', 'PROXI', 'G20', 'CORA', 'MATCH'] },
  // Nourriture hors courses et restaurants : distributeurs, boulangeries, snacks, commerces de bouche
  { id: 'nourriture', label: 'Nourriture', kind: 'variable', essential: true, sign: -1, section: 'vie_courante', line: 'Nourriture', keywords: ['DISTRI', 'DISTRIBUTEUR', 'SELECTA', 'CAFE', 'SNACK', 'BOULANGERIE', 'MIE CALINE', 'PATISSERIE', 'CHOCOLATIER', 'TRAITEUR', 'EPICERIE', 'BOUCHERIE', 'PRIMEUR', 'FROMAGERIE', 'TACOS', 'BUBBLE TEA', 'CROUS', 'FOOD', 'PAI PAI', "P'TIT CREUX", 'PATAPAIN', 'MARIE BLACHERE', 'PAIN'] },
  { id: 'sante', label: 'Santé', kind: 'variable', essential: true, sign: -1, section: 'vie_courante', line: 'Hygiène et santé', keywords: ['PHARMACIE', 'PHARMA', 'MEDECIN', 'DOCTEUR', 'DR ', 'DOCTOLIB', 'LEMEDECIN', 'DENTISTE', 'LABO', 'LABORATOIRE', 'OPTIC', 'OPTICIEN', 'KINE', 'HOPITAL', 'CLINIQUE'] },
  // Entretien du logement, du linge et des affaires : laverie, pressing, bricolage, réparations
  { id: 'entretien', label: 'Entretien', kind: 'variable', essential: true, sign: -1, section: 'vie_courante', line: 'Entretien', keywords: ['LAVERIE', 'LAVOMATIC', 'PRESSING', 'CORDONNERIE', 'CORDONNIER', 'SERRURIER', 'PLOMBIER', 'REPARATION', 'INFORMATI*', 'LEROY MERLIN', 'CASTORAMA', 'BRICO*', 'MR BRICOLAGE', 'LAVAGE', 'NETTOYAGE', 'RETOUCHE', 'COUTURE', 'TOUCHATOU', 'DROGUERIE', 'QUINCAILLERIE'] },
  // Plaisirs que l'on s'offre : beauté, coiffeur, bijoux, objets coup de cœur
  { id: 'cadeau_moi', label: 'Cadeaux à moi-même', kind: 'variable', sign: -1, section: 'loisirs', line: 'Cadeaux à moi-même', keywords: ['SEPHORA', 'NOCIBE', 'MARIONNAUD', 'YVES ROCHER', 'KIKO', 'RITUALS', 'LUSH', 'COIFF*', 'BARBIER', 'ONGLES', 'NAIL*', 'MANUCURE', 'ESTHETI*', 'SPA', 'MASSAGE', 'BIJOU*', 'PANDORA', 'KICKSTARTER', 'MICROMANIA', 'PARFUM*'] },
  { id: 'habillement', label: 'Habillement', kind: 'variable', sign: -1, section: 'vie_courante', line: 'Habillement', keywords: ['ZARA', 'H&M', 'H M', 'KIABI', 'DECATHLON', 'PRIMARK', 'UNIQLO', 'VINTED', 'SHEIN', 'CELIO', 'JULES', 'BERSHKA', 'PULL&BEAR', 'MANGO', 'JACK JONES', 'BRICE', 'GEMO', 'CHAUSS*', 'NEW YORKER'] },
  { id: 'carburant', label: 'Carburant', kind: 'variable', essential: true, sign: -1, section: 'transport', line: 'Carburant', keywords: ['ESSO', 'BP', 'SHELL', 'AVIA', 'STATION', 'CARBURANT', 'TOTAL ACCESS', 'TOTALENERGIES', 'TOTAL', 'DYNEFF'] },
  { id: 'transports', label: 'Transports', kind: 'variable', essential: true, sign: -1, section: 'transport', line: 'Transports en commun', keywords: ['SNCF', 'OUIGO', 'RATP', 'NAVIGO', 'TCL', 'TISSEO', 'RTM', 'TAN', 'UBER', 'BOLT', 'HEETCH', 'BLABLACAR', 'PEAGE', 'VINCI AUTOROUTES', 'SANEF', 'APRR', 'PARKING', 'INDIGO', 'LIME', 'VELIB', 'METROREX', 'MOBI', 'STCL', 'TRANSDEV', 'KEOLIS'] },
  { id: 'assurances', label: 'Assurances', kind: 'fixed', essential: true, sign: -1, section: 'engagements', line: 'Assurances', keywords: ['ASSURANCE', 'ASSU', 'MAIF', 'MACIF', 'MATMUT', 'AXA', 'ALLIANZ', 'GROUPAMA', 'MMA', 'GMF', 'MAAF', 'GENERALI', 'HARMONIE', 'ALAN', 'PREDICA', 'PACIFICA'] },
  { id: 'abonnements', label: 'Abonnements', kind: 'fixed', sign: -1, section: 'engagements', line: 'Abonnements', keywords: ['NETFLIX', 'SPOTIFY', 'DEEZER', 'DISNEY', 'AMAZON PRIME', 'PRIME VIDEO', 'CANAL', 'ITUNES', 'YOUTUBE', 'BASIC FIT', 'BASIC-FIT', 'FITNESS PARK', 'KEEP COOL', 'ON AIR', 'AUDIBLE', 'CRUNCHYRO*', 'PLAYSTATION PLUS', 'XBOX', 'MOLOTOV', 'PARAMOUNT', 'SCRIBD', 'SHOWMAX'] },
  // Applications et dépenses nécessaires pour que la vie tourne : outils en ligne, stockage, démarches, courrier, examens
  { id: 'fonctionnel', label: 'Fonctionnel (applis, démarches)', kind: 'fixed', essential: true, sign: -1, section: 'engagements', line: 'Fonctionnel', keywords: ['CANVA', 'GOOGLE', 'APPLE.COM', 'ICLOUD', 'MICROSOFT', 'ADOBE', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE.AI', 'NOTION', 'DROPBOX', 'ACADEMIA', 'LA POSTE', 'LAPOSTE', 'ANTS', 'TIMBRE*', 'PHOTOMATON', 'IMPRESSION', 'PREFECTURE', 'MAIRIE', 'TOEIC', 'SCOLARITE', 'INSCRIPTION', 'CONCOURS'] },
  // Remboursement d'une dette envers une personne (prêt d'un proche, avance...) : les crédits bancaires vont dans « Crédits »
  { id: 'dette', label: 'Dettes', kind: 'fixed', sign: -1, section: 'engagements', line: 'Remboursements de dettes', keywords: ['DETTE', 'DETTES'] },
  { id: 'credit', label: 'Crédits', kind: 'fixed', essential: true, sign: -1, section: 'engagements', line: 'Remboursements de crédit', keywords: ['ECHEANCE', 'ECH PRET', 'PRET', 'CREDIT', 'COFIDIS', 'CETELEM', 'SOFINCO', 'FLOA', 'ONEY', 'FRANFINANCE', 'YOUNITED'] },
  { id: 'impots', label: 'Impôts', kind: 'fixed', essential: true, sign: -1, section: 'engagements', line: 'Impôts', keywords: ['DGFIP', 'IMPOT', 'TRESOR PUBLIC', 'FINANCES PUBLIQUES', 'TAXE'] },
  { id: 'voyages', label: 'Voyages', kind: 'variable', sign: -1, section: 'loisirs', line: 'Voyages', keywords: ['AIRBNB', 'BOOKING', 'HOTEL', 'AIR FRANCE', 'EASYJET', 'RYANAIR', 'TRANSAVIA', 'VOLOTEA', 'VUELING', 'EXPEDIA', 'FLIXBUS'] },
  { id: 'sorties', label: 'Sorties et loisirs', kind: 'variable', sign: -1, section: 'loisirs', line: 'Sorties', keywords: ['CINEMA', 'UGC', 'PATHE', 'GAUMONT', 'MK2', 'FNAC', 'CULTURA', 'STEAM', 'NINTENDO', 'BAR', 'PUB', 'CONCERT', 'TICKETMASTER', 'BOWLING', 'MUSEE', 'THEATRE', 'SPECTACLE*', 'ZOO*', 'FUTUROSCOPE', 'PATINOIRE*', 'ENEBA', 'ESCAPE'] },
  { id: 'achats', label: 'Achats divers', kind: 'variable', sign: -1, section: 'vie_courante', line: 'Achats divers', keywords: ['AMAZON', 'AMZN', 'CDISCOUNT', 'IKEA', 'ACTION', 'GIFI', 'MAISONS DU MONDE', 'DARTY', 'BOULANGER', 'ALIEXPRESS', 'TEMU', 'ETSY', 'PAYPAL', 'LEBONCOIN'] },
  // Argent envoyé à la famille ou à des amis (virements, services de transfert vers l'étranger), et argent reçu d'eux
  { id: 'proches_envoi', label: 'Envois à des proches', kind: 'variable', sign: -1, section: 'engagements', line: 'Aide à des proches', keywords: ['TAPTAP SEND', 'TAPTAP', 'LEMFI', 'WESTERN UNION', 'MONEYGRAM', 'WORLDREMIT', 'REMITLY', 'RIA'] },
  { id: 'proches_recu', label: 'Argent reçu de proches', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Argent reçu de proches', keywords: [] },
  { id: 'especes', label: "Retraits d'espèces", kind: 'variable', sign: -1, section: 'vie_courante', line: "Retraits d'espèces", keywords: ['RETRAIT', 'DAB', 'GAB'] },
  { id: 'autre_revenu', label: 'Autres entrées', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Autres entrées', keywords: [] },
  { id: 'autre_depense', label: 'Autres dépenses', kind: 'variable', sign: -1, section: 'vie_courante', line: 'Autres dépenses', keywords: [] }
];

export const categoryById = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === 'autre_depense')!;

// Pour les listes déroulantes : par ordre alphabétique, sans tenir compte des accents ni des majuscules
export const byLabel = (a: Category, b: Category) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' });

// --- Gestion des catégories ---
// Toute catégorie peut être supprimée, sauf les deux « Autres » : les opérations d'une catégorie supprimée y retournent.
// - catégories personnelles (table custom_categories) : ajoutées à la fin de CATEGORIES, sans mots-clés
//   (ce sont les choix « retenus », table category_rules, qui y classent les opérations suivantes)
// - catégories de base supprimées (table removed_categories) : retirées de CATEGORIES et ignorées par le classement automatique

export const DEFAULT_CATEGORY_IDS = ['autre_depense', 'autre_revenu'];

export type CustomCategory = { id: string; label: string; kind: 'income' | 'variable'; section: string };

// --- Grandes catégories ---
// Une grande catégorie regroupe des sous-catégories du même sens (sorties ou entrées) et peut avoir une limite
// mensuelle (somme des dépenses de ses sous-catégories). Les opérations ne vont jamais dans une grande catégorie,
// seulement dans ses sous-catégories. Tables : category_groups (les grandes catégories) et category_settings
// (pour chaque catégorie : sa grande catégorie, et un nom choisi par l'utilisateur).
export type GroupKind = 'expense' | 'income';
export type CategoryGroup = { id: string; label: string; kind: GroupKind; monthly_limit: number | null };
type CategorySetting = { category: string; group_id: string | null; label: string | null };

// Sens d'une catégorie, pour la ranger dans une grande catégorie (les virements entre comptes n'en ont pas)
export const groupKindOf = (c: Category): GroupKind | null => (c.kind === 'transfer' ? null : c.kind === 'income' ? 'income' : 'expense');

const BASE_CATEGORIES = [...CATEGORIES];
let customCategories: CustomCategory[] = [];
let removedBase: string[] = [];
let groups: CategoryGroup[] = [];
let settings: CategorySetting[] = [];

export const categoryGroups = () => groups;
// Sous-catégories d'une grande catégorie, par ordre alphabétique
export const groupMembers = (groupId: string) => CATEGORIES.filter((c) => c.group === groupId).sort(byLabel);

const toCategory = (c: CustomCategory): Category => ({
  id: c.id,
  label: c.label,
  kind: c.kind,
  sign: c.kind === 'income' ? 1 : -1,
  section: c.section,
  line: c.label,
  keywords: [],
  custom: true
});

// Reconstruit la liste (même tableau, pour que tout le code qui lit CATEGORIES voie le changement),
// avec le nom choisi et la grande catégorie de chacune
function rebuildCategories() {
  const all = [...BASE_CATEGORIES.filter((c) => !removedBase.includes(c.id)), ...customCategories.map(toCategory)];
  CATEGORIES.splice(
    0,
    CATEGORIES.length,
    ...all.map((c) => {
      const s = settings.find((x) => x.category === c.id);
      const group = s?.group_id && groups.some((g) => g.id === s.group_id) ? s.group_id : null;
      return { ...c, label: s?.label || c.label, group };
    })
  );
}

export const removedBaseCategories = () => BASE_CATEGORIES.filter((c) => removedBase.includes(c.id));

export async function loadCategories() {
  const [custom, removed, groupRows, settingRows] = await Promise.all([
    supabase.from('custom_categories').select('id, label, kind, section').order('created_at'),
    supabase.from('removed_categories').select('id'),
    supabase.from('category_groups').select('id, label, kind, monthly_limit').order('created_at'),
    supabase.from('category_settings').select('category, group_id, label')
  ]);
  if (!custom.error) customCategories = (custom.data as CustomCategory[]) ?? [];
  if (!removed.error) removedBase = ((removed.data as { id: string }[]) ?? []).map((r) => r.id);
  // Tables des grandes catégories absentes (script SQL pas encore lancé) : tout s'affiche sans regroupement
  if (!groupRows.error)
    groups = ((groupRows.data as CategoryGroup[]) ?? []).map((g) => ({ ...g, monthly_limit: g.monthly_limit === null ? null : Number(g.monthly_limit) }));
  if (!settingRows.error) settings = (settingRows.data as CategorySetting[]) ?? [];
  rebuildCategories();
  return custom.error ?? removed.error;
}

// Nouvelle grande catégorie (vide : on y range ensuite des sous-catégories)
export async function addCategoryGroup(label: string, kind: GroupKind) {
  const row: CategoryGroup = { id: `groupe_${Date.now().toString(36)}`, label: label.trim(), kind, monthly_limit: null };
  const { error } = await supabase.from('category_groups').insert(row);
  if (!error) groups = [...groups, row];
  return { group: error ? null : row, error };
}

// Nom ou limite mensuelle d'une grande catégorie (limite null = pas de limite)
export async function updateCategoryGroup(id: string, changes: Partial<Pick<CategoryGroup, 'label' | 'monthly_limit'>>) {
  const { error } = await supabase.from('category_groups').update(changes).eq('id', id);
  if (!error) {
    groups = groups.map((g) => (g.id === id ? { ...g, ...changes } : g));
    rebuildCategories();
  }
  return error;
}

// Range une catégorie dans une grande catégorie (null : la sort de sa grande catégorie)
export async function setCategoryGroup(category: string, groupId: string | null) {
  const { error } = await supabase.from('category_settings').upsert({ category, group_id: groupId }, { onConflict: 'category' });
  if (!error) {
    const current = settings.find((s) => s.category === category);
    settings = [...settings.filter((s) => s.category !== category), { category, label: current?.label ?? null, group_id: groupId }];
    rebuildCategories();
  }
  return error;
}

// Renomme une catégorie (de base ou personnelle) ; ses opérations et sa limite ne changent pas
export async function renameCategory(category: string, label: string) {
  const { error } = await supabase.from('category_settings').upsert({ category, label: label.trim() }, { onConflict: 'category' });
  if (!error) {
    const current = settings.find((s) => s.category === category);
    settings = [...settings.filter((s) => s.category !== category), { category, group_id: current?.group_id ?? null, label: label.trim() }];
    rebuildCategories();
  }
  return error;
}

// Dissout une grande catégorie : elle disparaît, ses sous-catégories restent (sans regroupement)
export async function dissolveCategoryGroup(id: string) {
  const { error } = await supabase.from('category_settings').update({ group_id: null }).eq('group_id', id);
  if (error) return error;
  const { error: err } = await supabase.from('category_groups').delete().eq('id', id);
  if (err) return err;
  groups = groups.filter((g) => g.id !== id);
  settings = settings.map((s) => (s.group_id === id ? { ...s, group_id: null } : s));
  rebuildCategories();
  return null;
}

// Supprime une grande catégorie ET ses sous-catégories : leurs opérations vont dans « Autres »
// (les deux « Autres », qui ne se suppriment pas, sont seulement sorties du regroupement)
export async function deleteCategoryGroup(id: string) {
  for (const c of groupMembers(id)) {
    const error = DEFAULT_CATEGORY_IDS.includes(c.id) ? await setCategoryGroup(c.id, null) : await deleteCategory(c);
    if (error) return error;
  }
  return dissolveCategoryGroup(id);
}

export async function addCustomCategory(label: string, kind: CustomCategory['kind'], section: string) {
  const row: CustomCategory = { id: `perso_${Date.now().toString(36)}`, label: label.trim(), kind, section };
  const { error } = await supabase.from('custom_categories').insert(row);
  if (!error) {
    customCategories = [...customCategories, row];
    rebuildCategories();
  }
  return { category: error ? null : row, error };
}

// Supprime une catégorie : ses opérations retournent dans « Autres dépenses » ou « Autres entrées » selon leur sens,
// ses choix retenus et sa limite de budget sont retirés
export async function deleteCategory(category: Category) {
  if (DEFAULT_CATEGORY_IDS.includes(category.id)) return null;
  for (const query of [
    supabase.from('bank_transactions').update({ category: 'autre_revenu' }).eq('category', category.id).gt('amount', 0),
    supabase.from('bank_transactions').update({ category: 'autre_depense' }).eq('category', category.id).lte('amount', 0),
    supabase.from('category_rules').delete().eq('category', category.id),
    supabase.from('budgets').delete().eq('category', category.id),
    supabase.from('category_settings').delete().eq('category', category.id),
    category.custom
      ? supabase.from('custom_categories').delete().eq('id', category.id)
      : supabase.from('removed_categories').upsert({ id: category.id }, { onConflict: 'id' })
  ]) {
    const { error } = await query;
    if (error) return error;
  }
  if (category.custom) customCategories = customCategories.filter((c) => c.id !== category.id);
  else removedBase = [...removedBase, category.id];
  settings = settings.filter((s) => s.category !== category.id);
  rebuildCategories();
  return null;
}

// Rétablit les catégories de base supprimées, puis reclasse les opérations restées dans « Autres »
export async function restoreBaseCategories() {
  const { error } = await supabase.from('removed_categories').delete().in('id', removedBase);
  if (error) return error;
  removedBase = [];
  rebuildCategories();
  return (await reclassifyOthers()).error;
}

// "Carte X1234 CARREFOUR City 12/10" -> "CARTE X1234 CARREFOUR CITY 12/10" (majuscules, sans accents)
export function normalizeLabel(label: string) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&*.'/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Mot-clé reconnu seulement comme mot entier ("BP" ne doit pas correspondre à "BPCE"), sauf s'il finit par * (début de mot)
const MATCHERS = CATEGORIES.flatMap((category) =>
  category.keywords.map((k) => {
    const prefix = k.endsWith('*');
    const word = k.replace(/\*$/, '').trim();
    return { category, length: word.length, regex: new RegExp(`(^|[^A-Z0-9])${escapeRegex(word)}${prefix ? '' : '([^A-Z0-9]|$)'}`) };
  })
);

// Catégorie du mot-clé le plus long trouvé dans le texte (null si aucun)
function bestMatch(norm: string, sign: number) {
  let best: (typeof MATCHERS)[number] | null = null;
  for (const m of MATCHERS) {
    if ((m.category.sign && m.category.sign !== sign) || removedBase.includes(m.category.id)) continue;
    if ((!best || m.length > best.length) && m.regex.test(norm)) best = m;
  }
  return best?.category.id ?? null;
}

// Nom du commerçant : le libellé sans les mentions de la banque (CB, PRLV, VIR...) ni les dates, numéros et références
const PREFIX = /^(VIREMENT EN VOTRE FAVEUR|EN VOTRE FAVEUR|VIREMENT RECU DE|PAIEMENT PAR CARTE|PAIEMENT CB|PAIEMENT|ACHAT CB|ACHAT|CARTE|CB|PRLV SEPA|PRLV|PRELEVEMENT SEPA|PRELEVEMENT|PRELEVMT|VIR SEPA RECU|VIR SEPA EMIS|VIR SEPA|VIREMENT SEPA RECU|VIREMENT SEPA EMIS|VIREMENT SEPA|VIREMENT RECU|VIREMENT EMIS|VIREMENT|VIR INST|VIR|DE|A|FACTURE)\s+/;
export function merchantKey(label: string) {
  let t = normalizeLabel(label);
  for (let i = 0; i < 4; i++) t = t.replace(PREFIX, '');
  const words = t.split(' ').filter((w) => w && !/\d/.test(w) && w.length > 1);
  return words.slice(0, 3).join(' ') || normalizeLabel(label).slice(0, 20);
}

export type Rule = { pattern: string; category: string };

export function categorize(label: string, amount: number, rules: Rule[]) {
  const key = merchantKey(label);
  const norm = normalizeLabel(label);
  // Les corrections faites à la main passent avant les règles automatiques
  const rule = rules.find((r) => key.startsWith(r.pattern) || norm.includes(r.pattern));
  if (rule) return rule.category;
  const sign = amount > 0 ? 1 : -1;
  // Le libellé principal d'abord, puis les lignes de détail ajoutées après " · " (relevés PDF)
  const found = bestMatch(normalizeLabel(label.split(' · ')[0]), sign) ?? bestMatch(norm, sign);
  if (found) return found;
  // Argent reçu sur la carte : c'est un commerçant qui rembourse un achat
  if (amount > 0 && /^(CB|CARTE)\s/.test(norm)) return 'remboursements';
  return amount > 0 ? 'autre_revenu' : 'autre_depense';
}

// Opérations classées en « Autres » : on retente de les classer (après l'ajout de catégories ou de mots-clés)
export async function reclassifyOthers() {
  const { data, error } = await supabase.from('bank_transactions').select('id, label, amount').in('category', ['autre_depense', 'autre_revenu']);
  if (error) return { changed: 0, error };
  const { data: ruleRows } = await supabase.from('category_rules').select('pattern, category');
  const rules = (ruleRows as Rule[]) ?? [];
  const byCategory = new Map<string, string[]>();
  for (const t of (data as { id: string; label: string; amount: number }[]) ?? []) {
    const category = categorize(t.label, Number(t.amount), rules);
    if (category !== 'autre_depense' && category !== 'autre_revenu') byCategory.set(category, [...(byCategory.get(category) ?? []), t.id]);
  }
  let changed = 0;
  for (const [category, ids] of byCategory) {
    const err = await updateCategory(ids, category);
    if (err) return { changed, error: err };
    changed += ids.length;
  }
  return { changed, error: null };
}

// --- Base de données ---

const toTransaction = (t: Transaction) => ({ ...t, amount: Number(t.amount) });

export async function fetchTransactions(fromDate: string, toDate: string) {
  const { data, error } = await supabase
    .from('bank_transactions')
    .select('*')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: false });
  return { transactions: ((data as Transaction[]) ?? []).map(toTransaction), error };
}

// Repère les virements entre deux de mes comptes : même montant en sens inverse, à 3 jours près, sur deux comptes différents
type TransferCandidate = { id?: string; date: string; amount: number; account: string; category: string };
function markTransfers(rows: TransferCandidate[], existing: TransferCandidate[]) {
  const all = [...rows, ...existing];
  const days = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
  for (const t of rows) {
    if (t.category === 'virement_interne') continue;
    const twin = all.find(
      (o) => o !== t && o.account !== t.account && o.amount === -t.amount && days(o.date, t.date) <= 3
    );
    if (twin) {
      t.category = 'virement_interne';
      twin.category = 'virement_interne';
    }
  }
  return existing.filter((e) => e.category === 'virement_interne');
}

// Enregistre les opérations d'un relevé (les doublons sont ignorés) ; renvoie le nombre de nouvelles opérations
// Livrets et comptes d'épargne réglementée : un virement ne peut aller que vers (ou venir de) un compte du titulaire
export const isSavingsAccount = (account: string) => /livret|\blep\b|ldds|\bpel\b|\bcel\b|epargne|épargne/i.test(account);
const TRANSFER_LABEL = /^(VIR|VIREMENT|VIRT)\b/;

export async function importTransactions(parsed: ParsedTransaction[], account: string) {
  if (parsed.length === 0) return { inserted: 0, error: null };
  const { data: ruleRows } = await supabase.from('category_rules').select('pattern, category');
  const rules = (ruleRows as Rule[]) ?? [];
  const rows = parsed.map((t) => ({
    date: t.date,
    label: t.label,
    amount: t.amount,
    account,
    import_key: `${account}|${t.importKey}`,
    category: t.category ?? (isSavingsAccount(account) && TRANSFER_LABEL.test(normalizeLabel(t.label)) ? 'virement_interne' : categorize(t.label, t.amount, rules))
  }));

  // Virements entre comptes : comparés aussi aux opérations déjà importées sur la même période
  const dates = rows.map((r) => r.date).sort();
  const { transactions: existing } = await fetchTransactions(dates[0], dates[dates.length - 1]);
  const existingRows = existing.map((e) => ({ ...e }));
  const changed = markTransfers(rows, existingRows).filter((e) => existing.find((o) => o.id === e.id)?.category !== 'virement_interne');
  if (changed.length) await updateCategory(changed.map((e) => e.id!), 'virement_interne');

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from('bank_transactions')
      .upsert(rows.slice(i, i + 500), { onConflict: 'import_key', ignoreDuplicates: true })
      .select('id');
    if (error) return { inserted, error };
    inserted += data?.length ?? 0;
  }
  return { inserted, error: null };
}

// Relevé comparé aux opérations déjà enregistrées sur le même compte et la même période :
// - new : rien d'enregistré sur cette période, le relevé est nouveau
// - same : toutes ses opérations sont déjà là, et rien d'autre : relevé déjà importé, rien à retraiter
// - different : la période est déjà importée mais des opérations divergent (en plus, en moins ou modifiées)
export type StatementCheck = {
  status: 'new' | 'same' | 'different';
  present: number; // opérations du relevé déjà enregistrées
  added: ParsedTransaction[]; // opérations du relevé absentes de la base
  removed: Transaction[]; // opérations enregistrées sur la période, absentes du relevé (remplacées si on confirme)
};

export async function checkStatement(parsed: ParsedTransaction[], account: string, summary?: StatementSummary) {
  const dates = parsed.map((t) => t.date).sort();
  const from = [summary?.from, dates[0]].filter(Boolean).sort()[0]!;
  const to = [summary?.to, dates[dates.length - 1]].filter(Boolean).sort().reverse()[0]!;
  const { data, error } = await supabase.from('bank_transactions').select('*').eq('account', account).gte('date', from).lte('date', to);
  if (error) return { check: null, error };
  const existing = ((data as Transaction[]) ?? []).map(toTransaction);
  const keys = new Set(parsed.map((t) => `${account}|${t.importKey}`));
  const existingKeys = new Set(existing.map((e) => e.import_key));
  const added = parsed.filter((t) => !existingKeys.has(`${account}|${t.importKey}`));
  const removed = existing.filter((e) => !keys.has(e.import_key));
  const status: StatementCheck['status'] =
    existing.length === 0 ? 'new' : added.length === 0 && removed.length === 0 ? 'same' : 'different';
  return { check: { status, present: parsed.length - added.length, added, removed } as StatementCheck, error: null };
}

// Efface les anciennes opérations remplacées par un relevé réimporté
export async function deleteTransactions(ids: string[]) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from('bank_transactions').delete().in('id', ids.slice(i, i + 200));
    if (error) return error;
  }
  return null;
}

export async function updateCategory(ids: string[], category: string) {
  const { error } = await supabase.from('bank_transactions').update({ category }).in('id', ids);
  return error;
}

export async function deleteTransaction(id: string) {
  const { error } = await supabase.from('bank_transactions').delete().eq('id', id);
  return error;
}

// Mémorise une correction : les prochaines opérations de ce commerçant iront dans cette catégorie
export async function saveRule(pattern: string, category: string) {
  const { error } = await supabase.from('category_rules').upsert({ pattern, category }, { onConflict: 'pattern' });
  return error;
}

export type Budget = { category: string; monthly_limit: number };

export async function fetchBudgets() {
  const { data, error } = await supabase.from('budgets').select('*');
  return { budgets: ((data as Budget[]) ?? []).map((b) => ({ ...b, monthly_limit: Number(b.monthly_limit) })), error };
}

export async function saveBudget(category: string, limit: number | null) {
  const { error } = limit
    ? await supabase.from('budgets').upsert({ category, monthly_limit: limit }, { onConflict: 'category' })
    : await supabase.from('budgets').delete().eq('category', category);
  return error;
}

// Dépenses annuelles à anticiper (assurance, impôts, vacances...) : mises de côté chaque mois
export type PlannedExpense = { id: string; label: string; amount: number; due_month: number };

export async function fetchPlanned() {
  const { data, error } = await supabase.from('planned_expenses').select('*').order('due_month');
  return { planned: ((data as PlannedExpense[]) ?? []).map((p) => ({ ...p, amount: Number(p.amount) })), error };
}

export async function addPlanned(label: string, amount: number, dueMonth: number) {
  const { data, error } = await supabase.from('planned_expenses').insert({ label, amount, due_month: dueMonth }).select().single();
  return { planned: data ? ({ ...data, amount: Number(data.amount) } as PlannedExpense) : null, error };
}

export async function deletePlanned(id: string) {
  const { error } = await supabase.from('planned_expenses').delete().eq('id', id);
  return error;
}

// --- Analyses ---

export const monthOf = (date: string) => date.slice(0, 7);
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round = (n: number) => Math.round(n * 100) / 100;

const isTransfer = (t: Transaction) => categoryById(t.category).kind === 'transfer';

// Entrées, sorties et dépenses par catégorie d'un ensemble d'opérations (virements internes exclus)
export function summarize(transactions: Transaction[]) {
  const byCategory = new Map<string, number>();
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (isTransfer(t)) continue;
    if (t.amount > 0) income += t.amount;
    else expenses -= t.amount;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) - t.amount);
  }
  return { income: round(income), expenses: round(expenses), byCategory };
}

// Dépenses par type : fixes (loyer, abonnements...), variables (courses, sorties...), occasionnelles (dépenses inhabituelles)
export function splitByKind(monthTx: Transaction[], unusualIds: Set<string>) {
  const split = { fixed: 0, variable: 0, occasional: 0 };
  for (const t of monthTx) {
    if (t.amount >= 0 || isTransfer(t)) continue;
    if (unusualIds.has(t.id)) split.occasional -= t.amount;
    else if (categoryById(t.category).kind === 'fixed') split.fixed -= t.amount;
    else split.variable -= t.amount;
  }
  return { fixed: round(split.fixed), variable: round(split.variable), occasional: round(split.occasional) };
}

export type Subscription = { key: string; label: string; amount: number; months: number; lastDate: string; yearly: number; category: string; stopped: boolean };

// Dépenses récurrentes : même commerçant, montant à peu près constant, au moins 2 mois différents d'affilée
export function detectSubscriptions(transactions: Transaction[]): Subscription[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || isTransfer(t)) continue;
    const key = merchantKey(t.label);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const latest = transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
  const result: Subscription[] = [];
  for (const [key, list] of groups) {
    const months = [...new Set(list.map((t) => monthOf(t.date)))].sort();
    if (months.length < 2) continue;
    // Une opération par mois au plus (sinon c'est une dépense fréquente, pas un abonnement)
    if (list.length > months.length + 1) continue;
    const amounts = list.map((t) => -t.amount);
    const m = median(amounts);
    if (amounts.filter((a) => Math.abs(a - m) <= m * 0.15).length < amounts.length * 0.7) continue;
    const gaps = months.slice(1).map((mo, i) => {
      const [y1, m1] = months[i].split('-').map(Number);
      const [y2, m2] = mo.split('-').map(Number);
      return (y2 - y1) * 12 + (m2 - m1);
    });
    if (gaps.some((g) => g > 2)) continue;
    const last = list.reduce((a, b) => (a.date > b.date ? a : b));
    const daysSince = (new Date(latest).getTime() - new Date(last.date).getTime()) / 86400000;
    result.push({
      key,
      label: last.label,
      amount: round(m),
      months: months.length,
      lastDate: last.date,
      yearly: round(m * 12),
      category: last.category,
      stopped: daysSince > 45
    });
  }
  return result.sort((a, b) => b.yearly - a.yearly);
}

// Dépenses inhabituelles du mois : bien plus élevées que d'habitude dans leur catégorie, ou grosse dépense chez un nouveau commerçant
export function detectUnusual(monthTx: Transaction[], history: Transaction[]) {
  const unusual: Transaction[] = [];
  const known = new Set(history.map((t) => merchantKey(t.label)));
  for (const t of monthTx) {
    if (t.amount >= 0 || isTransfer(t)) continue;
    const same = history.filter((h) => h.category === t.category && h.amount < 0).map((h) => -h.amount);
    const spent = -t.amount;
    if (same.length >= 4) {
      const m = median(same);
      if (spent > Math.max(2.5 * m, m + 40)) unusual.push(t);
    } else if (spent >= 150 && !known.has(merchantKey(t.label))) {
      unusual.push(t);
    }
  }
  return unusual;
}

// Phrases simples sur l'évolution des dépenses : ce mois-ci comparé à la moyenne des 3 mois précédents
export function spendingInsights(month: string, transactions: Transaction[]) {
  const months = [...new Set(transactions.map((t) => monthOf(t.date)))].filter((m) => m < month).sort().slice(-3);
  if (months.length === 0) return [];
  const current = summarize(transactions.filter((t) => monthOf(t.date) === month)).byCategory;
  const previous = months.map((m) => summarize(transactions.filter((t) => monthOf(t.date) === m)).byCategory);
  const ids = new Set([...current.keys(), ...previous.flatMap((p) => [...p.keys()])]);
  const changes: { category: string; diff: number; avg: number }[] = [];
  for (const id of ids) {
    const cat = categoryById(id);
    if (cat.kind === 'income' || cat.kind === 'transfer') continue;
    const avg = previous.reduce((s, p) => s + (p.get(id) ?? 0), 0) / previous.length;
    const diff = (current.get(id) ?? 0) - avg;
    if (Math.abs(diff) >= Math.max(30, avg * 0.25)) changes.push({ category: id, diff, avg });
  }
  const span = months.length === 1 ? 'le mois précédent' : `ta moyenne des ${months.length} mois précédents`;
  return changes
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 4)
    .map(({ category, diff }) => {
      const label = categoryById(category).label;
      const euros = Math.round(Math.abs(diff)).toLocaleString('fr-FR');
      return diff > 0
        ? {
            tone: 'warn' as const,
            text: `Tes dépenses « ${label} » ont augmenté de ${euros} € par rapport à ${span}. Si tu gardes ce rythme, ton épargne sera inférieure de ${Math.round(Math.abs(diff) * 3).toLocaleString('fr-FR')} € sur un trimestre.`
          }
        : {
            tone: 'good' as const,
            text: `Bien joué : tes dépenses « ${label} » ont baissé de ${euros} € par rapport à ${span}, soit ${Math.round(Math.abs(diff) * 12).toLocaleString('fr-FR')} € sur un an à ce rythme.`
          };
    });
}

// Reporte les totaux du mois dans le compte de résultat (une ligne par catégorie, créée si besoin), à partir de toutes
// les opérations connues du mois. Les lignes écrites sont marquées « calculées par l'import ».
// - mode 'replace' (bouton « Reporter dans le compte de résultat ») : toutes les lignes des catégories sont remplacées
// - mode 'import' : une ligne saisie à la main est gardée ; une ligne vide, absente ou déjà calculée par un import est
//   (re)calculée, ce qui complète correctement un mois réparti sur plusieurs relevés
// Renvoie le nombre de lignes écrites et de lignes saisies à la main laissées telles quelles.
export async function reportToStatement(period: string, monthTx: Transaction[], mode: 'replace' | 'import' = 'replace') {
  const totals = new Map<string, { section: string; line: string; amount: number }>();
  for (const t of monthTx) {
    const cat = categoryById(t.category);
    if (!cat.section || !cat.line || cat.kind === 'transfer') continue;
    const key = `${cat.section}|${cat.line.toLowerCase()}`;
    const entry = totals.get(key) ?? { section: cat.section, line: cat.line, amount: 0 };
    // Produits : on additionne les entrées ; charges : les sorties (en positif), remboursements déduits
    entry.amount += cat.kind === 'income' ? t.amount : -t.amount;
    totals.set(key, entry);
  }
  const result = { filled: 0, kept: 0, error: null as { message: string } | null };
  const { lines, error } = await fetchOrSeedLines(period);
  if (error) return { ...result, error };
  const find = (sectionId: string, label: string) => lines.find((l) => l.section === sectionId && l.label.toLowerCase() === label.toLowerCase());

  for (const { section: sectionId, line: label, amount } of totals.values()) {
    const value = round(Math.max(0, amount));
    const existing = find(sectionId, label);
    if (mode === 'import' && !importMayWrite(existing)) {
      if (existing!.amount !== value) result.kept++;
      continue;
    }
    if (existing) {
      if (existing.amount === value && existing.auto) continue;
      const err = await updateLine(existing.id, { amount: value, auto: true });
      if (err) return { ...result, error: err };
    } else {
      if (value === 0) continue;
      const { line, error: err } = await addLine(period, SECTIONS.find((s) => s.id === sectionId)!, label, 100);
      if (err) return { ...result, error: err };
      if (line) await updateLine(line.id, { amount: value, auto: true });
    }
    result.filled++;
  }
  // Lignes calculées par un import dont la catégorie n'a plus d'opération ce mois-ci (opération reclassée ou supprimée) : remises à zéro
  for (const l of lines) {
    if (!l.auto || l.statement !== 'resultat' || l.amount === 0 || totals.has(`${l.section}|${l.label.toLowerCase()}`)) continue;
    const err = await updateLine(l.id, { amount: 0 });
    if (err) return { ...result, error: err };
    result.filled++;
  }
  return result;
}

const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

// Solde du compte à la fin de chaque mois couvert par le relevé : ancien solde + opérations jusqu'au dernier jour du mois.
// Seuls les mois qui se terminent pendant la période du relevé ont un solde exact.
function monthEndBalances(transactions: { date: string; amount: number }[], summary: StatementSummary) {
  if (summary.opening === null || !summary.from || !summary.to || summary.verified === false) return [];
  const result: { month: string; balance: number }[] = [];
  for (let month = monthOf(summary.from); month <= monthOf(summary.to); month = shiftMonth(month, 1)) {
    const end = lastDayOf(month);
    if (end < summary.from || end > summary.to) continue;
    const moved = transactions.filter((t) => t.date <= end).reduce((s, t) => s + t.amount, 0);
    result.push({ month, balance: round(summary.opening + moved) });
  }
  // Soldes de fin de mois imprimés sur le relevé (livrets) : ils font foi
  for (const printed of summary.monthEnds) {
    const i = result.findIndex((r) => r.month === printed.month);
    if (i >= 0) result[i] = printed;
    else result.push(printed);
  }
  return result;
}

// Après l'import d'un relevé, complète le reste de l'appli pour chaque mois où tombent ses opérations
// (même s'il n'est pas celui affiché). Sur la période du relevé, ses données font foi et remplacent ce qui était inscrit,
// même à la main :
// - compte de résultat de chaque mois : totaux par catégorie, avec toutes les opérations connues du mois (tous comptes, tous relevés)
// - bilan : solde du compte à la fin de chaque mois du relevé
// Hors de la période, rien de saisi à la main n'est modifié : ancien solde inscrit au mois d'avant (s'il est vide ou calculé).
// Aucun solde n'est reporté sur les mois suivants : le bilan reproduit les relevés, et signale ceux qui manquent.
export async function completeFromStatement(account: string, transactions: { date: string; amount: number }[], summary?: StatementSummary) {
  const months = [...new Set(transactions.map((t) => monthOf(t.date)))].sort();
  const done = { filled: [] as string[], kept: 0, balances: 0, error: null as { message: string } | null };
  const fail = (error: { message: string }) => ({ ...done, error });
  for (const month of months) {
    const { transactions: monthTx, error } = await fetchTransactions(`${month}-01`, lastDayOf(month));
    if (error) return fail(error);
    const r = await reportToStatement(month, monthTx, 'replace');
    if (r.error) return fail(r.error);
    if (r.filled) done.filled.push(month);
    done.kept += r.kept;
  }
  if (!summary) return done;

  // Soldes exacts de fin de mois, donnés par le relevé : ils remplacent ce qui était inscrit (même à la main)
  const exact = monthEndBalances(transactions, summary);
  for (const { month, balance } of exact) {
    const err = await setLineAmount(month, 'liquidites', account, balance, true, true);
    if (err) return fail(err);
    done.balances++;
  }
  // Solde de fin de relevé quand le relevé ne s'arrête pas en fin de mois : c'est le dernier solde connu du mois, il le remplace aussi
  if (summary.closing !== null && summary.to && !exact.some((e) => e.month === monthOf(summary.to!))) {
    const err = await setLineAmount(monthOf(summary.to), 'liquidites', account, summary.closing, true, true);
    if (err) return fail(err);
    done.balances++;
  }
  // Ancien solde : solde de la veille du relevé, exact si le relevé commence un 1er du mois
  if (summary.opening !== null && summary.from) {
    const dayBefore = new Date(new Date(summary.from).getTime() - 86400000).toISOString().slice(0, 10);
    const err = await setLineAmount(monthOf(dayBefore), 'liquidites', account, summary.opening, dayBefore === lastDayOf(monthOf(dayBefore)));
    if (err) return fail(err);
    done.balances++;
  }
  return done;
}

// Nombre d'opérations importées pour un mois (AAAA-MM)
export async function countTransactions(month: string) {
  const { count, error } = await supabase
    .from('bank_transactions')
    .select('id', { count: 'exact', head: true })
    .gte('date', `${month}-01`)
    .lte('date', lastDayOf(month));
  return { count: count ?? 0, error };
}

// Comptes suivis par relevés : chacun avec le premier mois où il a des opérations importées (il est attendu dans le bilan
// à partir de ce mois-là), et les comptes qui ont des opérations dans le mois demandé (noms en minuscules dans "present").
// Un compte attendu sans opération ni solde inscrit par un relevé ce mois-ci a un relevé manquant.
export type TrackedAccount = { account: string; first: string };
export async function fetchStatementCoverage(month: string) {
  const firsts = new Map<string, TrackedAccount>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('bank_transactions').select('account, date').order('date').range(from, from + 999);
    if (error) return { tracked: [] as TrackedAccount[], present: [] as string[], error };
    for (const r of (data as { account: string; date: string }[]) ?? []) {
      const key = r.account.toLowerCase();
      if (!firsts.has(key)) firsts.set(key, { account: r.account, first: monthOf(r.date) });
    }
    if (!data || data.length < 1000) break;
  }
  const { data, error } = await supabase.from('bank_transactions').select('account').gte('date', `${month}-01`).lte('date', lastDayOf(month));
  const present = [...new Set(((data as { account: string }[]) ?? []).map((r) => r.account.toLowerCase()))];
  return { tracked: [...firsts.values()], present, error };
}
