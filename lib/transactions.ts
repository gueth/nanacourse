import { supabase } from '@/lib/supabase';
import { addLine, fetchAllLines, fetchOrSeedLines, formatEuros, importMayWrite, monthKey, SECTIONS, setLineAmount, shiftMonth, updateLine } from '@/lib/finance';
import type { ParsedTransaction, StatementSummary } from '@/lib/bankImport';
import type { Coverage, ManualNote, SavingsEstimate, TrackedAccount, TransferCheck, TransferMismatch, TransferQuestion } from '@/lib/coverage';

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
  // Virement entre mes comptes : l'autre compte, précisé à la main quand le libellé ne le dit pas
  // ('' : un compte qui n'est pas suivi ici ; absent : pas précisé). Colonne ajoutée par supabase/transfer_accounts.sql
  transfer_account?: string | null;
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
  annual?: string; // dépense annuelle (table planned_expenses) dont c'est la sous-catégorie, dans « Dépenses annuelles »
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
  // Ce que l'on se doit à soi-même (lib/selfDebt) : une opération classée ici (ex. virement vers un livret) la rembourse.
  // Ne se supprime pas.
  { id: 'dette_moi', label: 'Dette à moi-même', kind: 'fixed', sign: -1, section: 'engagements', line: 'Dette à moi-même', keywords: [] },
  { id: 'credit', label: 'Crédits', kind: 'fixed', essential: true, sign: -1, section: 'engagements', line: 'Remboursements de crédit', keywords: ['ECHEANCE', 'ECH PRET', 'PRET', 'CREDIT', 'COFIDIS', 'CETELEM', 'SOFINCO', 'FLOA', 'ONEY', 'FRANFINANCE', 'YOUNITED'] },
  { id: 'impots', label: 'Impôts', kind: 'fixed', essential: true, sign: -1, section: 'engagements', line: 'Impôts', keywords: ['DGFIP', 'IMPOT', 'TRESOR PUBLIC', 'FINANCES PUBLIQUES', 'TAXE'] },
  { id: 'voyages', label: 'Voyages', kind: 'variable', sign: -1, section: 'loisirs', line: 'Voyages', keywords: ['AIRBNB', 'BOOKING', 'HOTEL', 'AIR FRANCE', 'EASYJET', 'RYANAIR', 'TRANSAVIA', 'VOLOTEA', 'VUELING', 'EXPEDIA', 'FLIXBUS'] },
  { id: 'sorties', label: 'Sorties et loisirs', kind: 'variable', sign: -1, section: 'loisirs', line: 'Sorties', keywords: ['CINEMA', 'UGC', 'PATHE', 'GAUMONT', 'MK2', 'FNAC', 'CULTURA', 'STEAM', 'NINTENDO', 'BAR', 'PUB', 'CONCERT', 'TICKETMASTER', 'BOWLING', 'MUSEE', 'THEATRE', 'SPECTACLE*', 'ZOO*', 'FUTUROSCOPE', 'PATINOIRE*', 'ENEBA', 'ESCAPE'] },
  { id: 'achats', label: 'Achats divers', kind: 'variable', sign: -1, section: 'vie_courante', line: 'Achats divers', keywords: ['AMAZON', 'AMZN', 'CDISCOUNT', 'IKEA', 'ACTION', 'GIFI', 'MAISONS DU MONDE', 'DARTY', 'BOULANGER', 'ALIEXPRESS', 'TEMU', 'ETSY', 'PAYPAL', 'LEBONCOIN'] },
  // Argent envoyé à la famille ou à des amis (virements, services de transfert vers l'étranger), et argent reçu d'eux
  { id: 'proches_envoi', label: 'Envois à des proches', kind: 'variable', sign: -1, section: 'engagements', line: 'Aide à des proches', keywords: ['TAPTAP SEND', 'TAPTAP', 'LEMFI', 'WESTERN UNION', 'MONEYGRAM', 'WORLDREMIT', 'REMITLY', 'RIA'] },
  { id: 'proches_recu', label: 'Argent reçu de proches', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Argent reçu de proches', keywords: [] },  { id: 'especes', label: "Retraits d'espèces", kind: 'variable', sign: -1, section: 'vie_courante', line: "Retraits d'espèces", keywords: ['RETRAIT', 'DAB', 'GAB'] },
  { id: 'autre_revenu', label: 'Autres entrées', kind: 'income', sign: 1, section: 'autres_revenus', line: 'Autres entrées', keywords: [] },
  { id: 'autre_depense', label: 'Autres dépenses', kind: 'variable', sign: -1, section: 'vie_courante', line: 'Autres dépenses', keywords: [] }
];

export const categoryById = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === 'autre_depense')!;

// Pour les listes déroulantes : par ordre alphabétique, sans tenir compte des accents ni des majuscules
export const byLabel = (a: Category, b: Category) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' });

// --- Gestion des catégories ---
// Toute catégorie peut être supprimée, sauf les deux « Autres » (les opérations d'une catégorie supprimée y retournent),
// « Dette à moi-même » et les sous-catégories des dépenses annuelles (elles suivent la liste des dépenses annuelles).
// - catégories personnelles (table custom_categories) : ajoutées à la fin de CATEGORIES, sans mots-clés
//   (ce sont les choix « retenus », table category_rules, qui y classent les opérations suivantes)
// - catégories de base supprimées (table removed_categories) : retirées de CATEGORIES et ignorées par le classement automatique

export const DEFAULT_CATEGORY_IDS = ['autre_depense', 'autre_revenu'];
export const SELF_DEBT_ID = 'dette_moi';
// Catégories qui ne se suppriment pas (ni ne se renomment ou se déplacent, pour les dépenses annuelles)
export const isLockedCategory = (c: Category) => DEFAULT_CATEGORY_IDS.includes(c.id) || c.id === SELF_DEBT_ID || !!c.annual;

export type CustomCategory = { id: string; label: string; kind: 'income' | 'variable'; section: string };

// --- Grandes catégories ---
// Une grande catégorie regroupe des sous-catégories du même sens (sorties ou entrées) et peut avoir une limite
// mensuelle (somme des dépenses de ses sous-catégories). Les opérations ne vont jamais dans une grande catégorie,
// seulement dans ses sous-catégories. Tables : category_groups (les grandes catégories) et category_settings
// (pour chaque catégorie : sa grande catégorie, et un nom choisi par l'utilisateur).
export type GroupKind = 'expense' | 'income';
// virtual : la grande catégorie « Dépenses annuelles », construite par l'appli (ni modifiable ni supprimable)
// icon : icône qui la représente (clé de GROUP_ICONS, components/finance/GroupIcon), à gauche des transactions de ses
// sous-catégories ; null : devinée d'après son nom
export type CategoryGroup = { id: string; label: string; kind: GroupKind; monthly_limit: number | null; icon?: string | null; virtual?: boolean };
type CategorySetting = { category: string; group_id: string | null; label: string | null };

// Sens d'une catégorie, pour la ranger dans une grande catégorie (les virements entre comptes n'en ont pas)
export const groupKindOf = (c: Category): GroupKind | null => (c.kind === 'transfer' ? null : c.kind === 'income' ? 'income' : 'expense');

const BASE_CATEGORIES = [...CATEGORIES];
let customCategories: CustomCategory[] = [];
let removedBase: string[] = [];
let groups: CategoryGroup[] = [];
let settings: CategorySetting[] = [];
let planned: PlannedExpense[] = [];

// Dépenses annuelles : chacune est une sous-catégorie de la grande catégorie « Dépenses annuelles »,
// avec pour limite mensuelle un douzième de son montant, à partir du mois de sa création
export const ANNUAL_GROUP_ID = 'depenses_annuelles';
export const annualCategoryId = (plannedId: string) => `annuel_${plannedId}`;
export const annualPlans = () => planned;
const annualGroup = (): CategoryGroup => ({
  id: ANNUAL_GROUP_ID,
  label: 'Dépenses annuelles',
  kind: 'expense',
  monthly_limit: planned.filter(isOwnAnnual).reduce((s, p) => s + p.amount / 12, 0),
  virtual: true
});

export const categoryGroups = () => (planned.length ? [...groups, annualGroup()] : groups);
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
  const annual: Category[] = planned.map((p) => ({
    id: annualCategoryId(p.id),
    label: p.label,
    kind: 'fixed',
    sign: -1,
    section: 'engagements',
    line: 'Dépenses annuelles',
    keywords: [],
    annual: p.id,
    group: ANNUAL_GROUP_ID
  }));
  CATEGORIES.splice(
    0,
    CATEGORIES.length,
    ...all.map((c) => {
      const s = settings.find((x) => x.category === c.id);
      const group = s?.group_id && groups.some((g) => g.id === s.group_id) ? s.group_id : null;
      return { ...c, label: s?.label || c.label, group };
    }),
    ...annual
  );
}

export async function loadCategories() {
  const [custom, removed, groupRows, settingRows, plannedRows] = await Promise.all([
    supabase.from('custom_categories').select('id, label, kind, section').order('created_at'),
    supabase.from('removed_categories').select('id'),
    // Colonne de l'icône absente (supabase/category_group_icons.sql pas encore lancé) : relue sans elle
    supabase
      .from('category_groups')
      .select('id, label, kind, monthly_limit, icon')
      .order('created_at')
      .then((r) => (r.error && /icon/.test(r.error.message) ? supabase.from('category_groups').select('id, label, kind, monthly_limit').order('created_at') : r)),
    supabase.from('category_settings').select('category, group_id, label'),
    fetchPlanned()
  ]);
  if (!plannedRows.error) planned = plannedRows.planned;
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
export async function updateCategoryGroup(id: string, changes: Partial<Pick<CategoryGroup, 'label' | 'monthly_limit' | 'icon'>>) {
  const previous = groups.find((g) => g.id === id);
  if (previous && changes.monthly_limit !== undefined && changes.monthly_limit !== previous.monthly_limit)
    await keepPastLimit(groupTarget(id), previous.monthly_limit);
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
    const error = isLockedCategory(c) ? await setCategoryGroup(c.id, null) : await deleteCategory(c);
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
  if (isLockedCategory(category)) return null;
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

// Virements entre deux de mes comptes : même montant en sens inverse, à quelques jours près (week-end, date de valeur), sur deux comptes différents
type TransferCandidate = { date: string; amount: number; account: string };
const TRANSFER_DAYS = 4;
const dayGap = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
const shiftDay = (date: string, days: number) => new Date(new Date(date).getTime() + days * 86400000).toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

// Associe chaque opération de "rows" à son double sur un autre compte (pris dans "rows" ou "others"), le plus proche en date.
// Chaque opération ne sert qu'une fois : deux virements de 100 € le même jour vont avec deux opérations distinctes.
// Les opérations déjà classées en virement (libellé d'un livret, virement à son nom) cherchent aussi leur double :
// c'est ce qui permet de reconnaître, sur le compte courant, l'opération qui correspond à un versement sur le livret.
function pairTransfers<T extends TransferCandidate>(rows: T[], others: T[] = []) {
  const pairs = new Map<T, T>();
  const all = [...rows, ...others];
  for (const t of rows) {
    if (pairs.has(t)) continue;
    let best: T | null = null;
    let bestGap = Infinity;
    for (const o of all) {
      if (o === t || pairs.has(o) || o.account === t.account || cents(o.amount) !== -cents(t.amount)) continue;
      const gap = dayGap(o.date, t.date);
      if (gap <= TRANSFER_DAYS && gap < bestGap) {
        best = o;
        bestGap = gap;
      }
    }
    if (best) {
      pairs.set(t, best);
      pairs.set(best, t);
    }
  }
  return pairs;
}

// Toutes les opérations enregistrées entre deux dates (par paquets de 1000, la limite d'une requête)
async function fetchAllTransactions(fromDate?: string, toDate?: string) {
  const list: Transaction[] = [];
  for (let start = 0; ; start += 1000) {
    let query = supabase.from('bank_transactions').select('*').order('date').range(start, start + 999);
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate) query = query.lte('date', toDate);
    const { data, error } = await query;
    if (error) return { transactions: list, error };
    list.push(...((data as Transaction[]) ?? []).map(toTransaction));
    if (!data || data.length < 1000) return { transactions: list, error: null };
  }
}

// Reconnaît les virements entre mes comptes déjà enregistrés (sur toute la période, ou entre deux dates)
// et classe les deux opérations de chaque paire en « Virements entre mes comptes ».
// Renvoie les opérations reclassées.
export async function linkTransfers(fromDate?: string, toDate?: string) {
  const { transactions, error } = await fetchAllTransactions(fromDate, toDate);
  if (error) return { changed: [] as Transaction[], error };
  const pairs = pairTransfers(transactions);
  const changed = [...pairs.keys()].filter((t) => t.category !== 'virement_interne');
  if (changed.length) {
    for (let i = 0; i < changed.length; i += 200) {
      const err = await updateCategory(changed.slice(i, i + 200).map((t) => t.id), 'virement_interne');
      if (err) return { changed: [], error: err };
    }
  }
  return { changed, error: null };
}

// Remet à jour le compte de résultat des mois donnés avec toutes leurs opérations
export async function refreshStatements(months: string[]) {
  const filled: string[] = [];
  for (const month of [...new Set(months)].sort()) {
    const { transactions, error } = await fetchTransactions(`${month}-01`, lastDayOf(month));
    if (error) return { filled, error };
    const r = await reportToStatement(month, transactions, 'replace');
    if (r.error) return { filled, error: r.error };
    if (r.filled) filled.push(month);
  }
  return { filled, error: null };
}

// Livrets et comptes d'épargne réglementée : un virement ne peut aller que vers (ou venir de) un compte du titulaire
export const isSavingsAccount = (account: string) => /livret|\blep\b|ldds|\bpel\b|\bcel\b|epargne|épargne/i.test(account);
const TRANSFER_LABEL = /^(VIR|VIREMENT|VIRT)\b/;
// Opération qui sera classée en virement entre mes comptes d'après le relevé seul (avant de chercher son double)
const isStatedTransfer = (t: ParsedTransaction, account: string) =>
  t.category === 'virement_interne' || (isSavingsAccount(account) && TRANSFER_LABEL.test(normalizeLabel(t.label)));

// Enregistre les opérations d'un relevé (les doublons sont ignorés) ; renvoie le nombre de nouvelles opérations,
// et les opérations d'autres comptes reconnues comme l'autre moitié d'un virement de ce relevé (reclassées)

export async function importTransactions(parsed: ParsedTransaction[], account: string) {
  const linked = [] as Transaction[];
  if (parsed.length === 0) return { inserted: 0, linked, error: null };
  const { data: ruleRows } = await supabase.from('category_rules').select('pattern, category');
  const rules = (ruleRows as Rule[]) ?? [];
  const rows = parsed.map((t) => ({
    date: t.date,
    label: t.label,
    amount: t.amount,
    account,
    import_key: `${account}|${t.importKey}`,
    category: isStatedTransfer(t, account) ? 'virement_interne' : (t.category ?? categorize(t.label, t.amount, rules))
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from('bank_transactions')
      .upsert(rows.slice(i, i + 500), { onConflict: 'import_key', ignoreDuplicates: true })
      .select('id');
    if (error) return { inserted, linked, error };
    inserted += data?.length ?? 0;
  }

  // Virements entre comptes : une fois le relevé enregistré, chaque opération cherche son double sur les autres comptes
  // (quel que soit l'ordre d'import des relevés), quelques jours avant et après la période du relevé
  const dates = rows.map((r) => r.date).sort();
  const { changed, error } = await linkTransfers(shiftDay(dates[0], -TRANSFER_DAYS), shiftDay(dates[dates.length - 1], TRANSFER_DAYS));
  if (error) return { inserted, linked, error };
  return { inserted, linked: changed.filter((t) => t.account !== account), error: null };
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
  linked: number; // opérations du relevé retrouvées en sens inverse sur un autre compte : virements entre mes comptes
  linkedAccounts: string[]; // comptes où ces doubles ont été retrouvés
  unlinked: ParsedTransaction[]; // virements annoncés par le relevé (livret, virement à son nom) sans double sur un autre compte
};

export async function checkStatement(parsed: ParsedTransaction[], account: string, summary?: StatementSummary) {
  const dates = parsed.map((t) => t.date).sort();
  const from = [summary?.from, dates[0]].filter(Boolean).sort()[0]!;
  const to = [summary?.to, dates[dates.length - 1]].filter(Boolean).sort().reverse()[0]!;
  const { data, error } = await supabase.from('bank_transactions').select('*').eq('account', account).gte('date', from).lte('date', to);
  if (error) return { check: null, error };
  // Les opérations ajoutées à la main ne viennent d'aucun relevé : elles ne sont ni comparées ni remplacées
  const existing = ((data as Transaction[]) ?? []).map(toTransaction).filter((e) => !isManual(e));
  const keys = new Set(parsed.map((t) => `${account}|${t.importKey}`));
  const existingKeys = new Set(existing.map((e) => e.import_key));
  const added = parsed.filter((t) => !existingKeys.has(`${account}|${t.importKey}`));
  const removed = existing.filter((e) => !keys.has(e.import_key));
  const status: StatementCheck['status'] =
    existing.length === 0 ? 'new' : added.length === 0 && removed.length === 0 ? 'same' : 'different';

  // Virements : les opérations du relevé sont comparées à celles des autres comptes, quelques jours autour de la période
  const { data: otherData, error: otherError } = await supabase
    .from('bank_transactions')
    .select('*')
    .neq('account', account)
    .gte('date', shiftDay(from, -TRANSFER_DAYS))
    .lte('date', shiftDay(to, TRANSFER_DAYS));
  if (otherError) return { check: null, error: otherError };
  const others = ((otherData as Transaction[]) ?? []).map(toTransaction);
  const candidates = parsed.map((t): TransferCandidate & { parsed: ParsedTransaction | null } => ({ date: t.date, amount: t.amount, account, parsed: t }));
  const pairs = pairTransfers(
    candidates,
    others.map((o) => ({ date: o.date, amount: o.amount, account: o.account, parsed: null }))
  );
  const linked = candidates.filter((c) => pairs.has(c));
  const linkedAccounts = [...new Set(linked.map((c) => pairs.get(c)!.account))];
  const unlinked = candidates.filter((c) => !pairs.has(c) && isStatedTransfer(c.parsed!, account)).map((c) => c.parsed!);
  return {
    check: { status, present: parsed.length - added.length, added, removed, linked: linked.length, linkedAccounts, unlinked } as StatementCheck,
    error: null
  };
}

// Opérations ajoutées à la main (hors relevé) : clé d'import « manuel|… ». Ce sont les seules qu'on peut supprimer,
// et un relevé réimporté ne les remplace jamais.
const MANUAL_PREFIX = 'manuel|';
export const isManual = (t: Pick<Transaction, 'import_key'>) => t.import_key.startsWith(MANUAL_PREFIX);

export async function addManualTransaction(fields: Pick<Transaction, 'date' | 'label' | 'amount' | 'account' | 'category'>) {
  const { data, error } = await supabase
    .from('bank_transactions')
    .insert({ ...fields, import_key: `${MANUAL_PREFIX}${crypto.randomUUID()}` })
    .select()
    .single();
  return { transaction: data ? toTransaction(data as Transaction) : null, error };
}

// Supprime une opération ajoutée à la main (une opération venue d'un relevé n'est jamais supprimée ici)
export async function deleteManualTransaction(id: string) {
  const { error } = await supabase.from('bank_transactions').delete().eq('id', id).like('import_key', `${MANUAL_PREFIX}%`);
  return error;
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
  const { data: previous } = await supabase.from('budgets').select('monthly_limit').eq('category', category).maybeSingle();
  const before = previous ? Number((previous as { monthly_limit: number }).monthly_limit) : null;
  if ((limit || null) !== before) await keepPastLimit(category, before);
  const { error } = limit
    ? await supabase.from('budgets').upsert({ category, monthly_limit: limit }, { onConflict: 'category' })
    : await supabase.from('budgets').delete().eq('category', category);
  return error;
}

// Budget propre à un mois passé (table month_budgets, supabase/month_budgets.sql), pour une catégorie ou une grande
// catégorie (« groupe:<id> ») : sa limite ce mois-là si custom_limit (null : pas de limite), et si son dépassement
// (ou son économie) compte dans la dette à moi-même. Sans ligne, le mois suit la limite générale et compte.
export type MonthBudget = { month: string; target: string; custom_limit: boolean; monthly_limit: number | null; counted: boolean };
export const groupTarget = (id: string) => `groupe:${id}`;

export async function fetchMonthBudgets() {
  const { data, error } = await supabase.from('month_budgets').select('month, target, custom_limit, monthly_limit, counted');
  // Table absente (script pas encore lancé) : chaque mois suit les limites générales
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { monthBudgets: [] as MonthBudget[], error: null };
  const monthBudgets = ((data as MonthBudget[]) ?? []).map((b) => ({ ...b, monthly_limit: b.monthly_limit === null ? null : Number(b.monthly_limit) }));
  return { monthBudgets, error };
}

export async function saveMonthBudget(month: string, target: string, changes: Partial<Pick<MonthBudget, 'custom_limit' | 'monthly_limit' | 'counted'>>) {
  const { error } = await supabase
    .from('month_budgets')
    .upsert({ month, target, ...changes, updated_at: new Date().toISOString() }, { onConflict: 'month,target' });
  return error;
}

// Avant de changer une limite générale : les mois passés (depuis la première opération) gardent celle qu'ils avaient,
// sauf ceux qui ont déjà leur propre limite. Sans la table month_budgets, rien n'est retenu et le passé suit le changement.
async function keepPastLimit(target: string, previous: number | null) {
  const current = monthKey(new Date());
  const { data } = await supabase.from('bank_transactions').select('date').order('date').limit(1);
  const first = (data as { date: string }[] | null)?.[0]?.date.slice(0, 7);
  if (!first || first >= current) return;
  // Mois où seul le choix de compter (ou non) dans la dette était retenu
  await supabase.from('month_budgets').update({ custom_limit: true, monthly_limit: previous }).eq('target', target).eq('custom_limit', false).lt('month', current);
  const rows = [];
  for (let month = first; month < current; month = shiftMonth(month, 1)) rows.push({ month, target, custom_limit: true, monthly_limit: previous });
  await supabase.from('month_budgets').upsert(rows, { onConflict: 'month,target', ignoreDuplicates: true });
}

// Limite d'une catégorie ou grande catégorie pour un mois : la sienne si ce mois en a une, sinon la limite générale
export function limitIn(month: string, target: string, general: number | null, monthBudgets: MonthBudget[]) {
  const own = monthBudgets.find((b) => b.month === month && b.target === target);
  return own?.custom_limit ? own.monthly_limit : general;
}

// Son dépassement (ou son économie) compte-t-il dans la dette à moi-même ce mois-là ?
export const countedIn = (month: string, target: string, monthBudgets: MonthBudget[]) =>
  monthBudgets.find((b) => b.month === month && b.target === target)?.counted ?? true;

// Dépenses annuelles à anticiper (assurance, impôts, vacances...) : mises de côté chaque mois.
// Chacune devient une sous-catégorie de « Dépenses annuelles » (voir annualCategoryId).
// category : catégorie du Budget à laquelle elle est reliée (Gestion > Créer des connecteurs, supabase/annual_links.sql) :
// la limite mensuelle de cette catégorie devient la somme de ses dépenses annuelles divisée par douze, et la dépense
// ne compte plus dans « Dépenses annuelles » (sa part du mois est alors tenue par la limite de la catégorie).
export type PlannedExpense = { id: string; label: string; amount: number; due_month: number; created_at: string; category?: string | null };

// Dépense annuelle tenue par la grande catégorie « Dépenses annuelles » (non reliée à une catégorie)
export const isOwnAnnual = (p: PlannedExpense) => !p.category;

export async function fetchPlanned() {
  const { data, error } = await supabase.from('planned_expenses').select('*').order('due_month');
  return { planned: ((data as PlannedExpense[]) ?? []).map((p) => ({ ...p, amount: Number(p.amount) })), error };
}

export async function addPlanned(label: string, amount: number, dueMonth: number) {
  const { data, error } = await supabase.from('planned_expenses').insert({ label, amount, due_month: dueMonth }).select().single();
  const row = data ? ({ ...data, amount: Number(data.amount) } as PlannedExpense) : null;
  if (row) {
    planned = [...planned, row].sort((a, b) => a.due_month - b.due_month);
    rebuildCategories();
  }
  return { planned: row, error };
}

// Supprime une dépense annuelle : les opérations classées dans sa sous-catégorie retournent dans « Autres dépenses »
export async function deletePlanned(id: string) {
  const moved = await supabase.from('bank_transactions').update({ category: 'autre_depense' }).eq('category', annualCategoryId(id));
  if (moved.error) return moved.error;
  const linked = planned.find((p) => p.id === id)?.category ?? null;
  const { error } = await supabase.from('planned_expenses').delete().eq('id', id);
  if (!error) {
    planned = planned.filter((p) => p.id !== id);
    rebuildCategories();
    // Reliée à une catégorie : sa limite suit
    if (linked) return syncAnnualLimit(linked);
  }
  return error;
}

// Relie une dépense annuelle à une catégorie du Budget (null : la délie) ; la limite des catégories concernées est recalculée
export async function linkPlannedToCategory(id: string, category: string | null) {
  const before = planned.find((p) => p.id === id)?.category ?? null;
  const { error } = await supabase.from('planned_expenses').update({ category }).eq('id', id);
  if (error) return error;
  planned = planned.map((p) => (p.id === id ? { ...p, category } : p));
  rebuildCategories();
  for (const c of new Set([before, category].filter((c): c is string => !!c))) {
    const err = await syncAnnualLimit(c);
    if (err) return err;
  }
  return null;
}

// Limite mensuelle d'une catégorie reliée à des dépenses annuelles : leur somme divisée par douze (aucune : plus de limite)
export const annualLimitOf = (category: string) => {
  const sum = planned.filter((p) => p.category === category).reduce((s, p) => s + p.amount, 0);
  return sum ? Math.round((sum / 12) * 100) / 100 : null;
};
async function syncAnnualLimit(category: string) {
  return saveBudget(category, annualLimitOf(category));
}

// Mois de la première opération importée (AAAA-MM), ou null s'il n'y en a aucune
export async function fetchFirstTransactionMonth() {
  const { data, error } = await supabase.from('bank_transactions').select('date').order('date').limit(1);
  return { month: (data as { date: string }[] | null)?.[0]?.date.slice(0, 7) ?? null, error };
}

// --- Analyses ---

export const monthOf = (date: string) => date.slice(0, 7);
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round = (n: number) => Math.round(n * 100) / 100;

export const isTransfer = (t: Transaction) => categoryById(t.category).kind === 'transfer';

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

// Catégories désignées par des cibles de connecteur : une catégorie, ou une grande catégorie ("groupe:<id>", toutes ses
// sous-catégories), précédée de « = » pour une liaison par égalité (lib/balanceLinks : linkCategories)
export function targetCategories(targets: string[]) {
  const ids = new Set<string>();
  for (const raw of targets) {
    const target = raw.startsWith('=') ? raw.slice(1) : raw;
    if (target.startsWith('groupe:')) CATEGORIES.filter((c) => c.group === target.slice(7)).forEach((c) => ids.add(c.id));
    else ids.add(target);
  }
  return [...ids];
}

// Catégories reliées à un connecteur (Gestion > Créer des connecteurs, table balance_links), quelle que soit la rubrique
// (créances, emprunts, dettes) : leurs opérations vont au bilan, elles ne comptent donc plus dans les produits et les
// charges ni dans les dépenses du budget, comme les virements entre mes comptes. Seulement à partir du mois de départ du
// connecteur : avant, il ne les compte pas au bilan, elles restent donc des produits et des charges.
// Pour chaque catégorie : date après laquelle ses opérations vont au bilan ('' : toutes).
export type ConnectedCategories = Map<string, string>;
type ConnectorRow = { targets: string[] | null; decreases?: string[] | null; opening_month?: string | null };
export function connectedFrom(links: ConnectorRow[]): ConnectedCategories {
  const from: ConnectedCategories = new Map();
  for (const link of links) {
    const start = link.opening_month ? lastDayOf(link.opening_month) : '';
    for (const id of targetCategories([...(link.targets ?? []), ...(link.decreases ?? [])])) {
      const prev = from.get(id);
      // Reliée à plusieurs connecteurs : dès le plus tôt d'entre eux
      if (prev === undefined || start < prev) from.set(id, start);
    }
  }
  return from;
}
// L'opération va-t-elle au bilan (et non au compte de résultat ni aux dépenses) ?
export const isConnectedTx = (connected: ConnectedCategories, t: Pick<Transaction, 'category' | 'date'>) => {
  const start = connected.get(t.category);
  return start !== undefined && t.date > start;
};
// Table absente ou illisible : aucune (colonne "decreases" absente : sans elle)
export async function connectedCategories() {
  let { data, error }: { data: unknown; error: { message: string } | null } = await supabase.from('balance_links').select('targets, decreases, opening_month');
  if (error && /decreases/.test(error.message)) ({ data, error } = await supabase.from('balance_links').select('targets, opening_month'));
  return error ? (new Map() as ConnectedCategories) : connectedFrom((data as ConnectorRow[]) ?? []);
}

// Reporte les totaux du mois dans le compte de résultat (une ligne par catégorie, créée si besoin), à partir de toutes
// les opérations connues du mois. Les lignes écrites sont marquées « calculées par l'import ».
// - mode 'replace' (bouton « Reporter dans le compte de résultat ») : toutes les lignes des catégories sont remplacées
// - mode 'import' : une ligne saisie à la main est gardée ; une ligne vide, absente ou déjà calculée par un import est
//   (re)calculée, ce qui complète correctement un mois réparti sur plusieurs relevés
// Renvoie le nombre de lignes écrites et de lignes saisies à la main laissées telles quelles.
export async function reportToStatement(period: string, monthTx: Transaction[], mode: 'replace' | 'import' = 'replace') {
  const totals = new Map<string, { section: string; line: string; amount: number }>();
  // Catégories reliées à un connecteur : au bilan seulement, comme les virements
  const connected = await connectedCategories();
  // Seuls les comptes courants font le résultat du mois : les opérations des livrets (intérêts compris) n'y entrent pas
  for (const t of monthTx.filter((x) => !isSavingsAccount(x.account))) {
    const cat = categoryById(t.category);
    if (!cat.section || !cat.line || cat.kind === 'transfer' || isConnectedTx(connected, t)) continue;
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

// Dernier jour d'un mois (AAAA-MM) : "2026-11" -> "2026-11-30"
export const lastDayOf = (month: string) => {
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

// Veille d'une date (AAAA-MM-JJ)
const dayBefore = (date: string) => new Date(new Date(date).getTime() - 86400000).toISOString().slice(0, 10);

// Mois pour lesquels un relevé apporte des informations sur son compte : mois de ses opérations, mois de sa période,
// soldes de fin de mois qu'il imprime, et mois d'avant quand il commence le 1er (son ancien solde en est le solde de fin)
export function statementMonths(transactions: { date: string }[], summary?: StatementSummary) {
  const months = new Set(transactions.map((t) => monthOf(t.date)));
  for (const m of summary?.monthEnds ?? []) months.add(m.month);
  if (summary?.from && summary.to) {
    for (let m = monthOf(summary.from); m <= monthOf(summary.to); m = shiftMonth(m, 1)) months.add(m);
    if (summary.from.endsWith('-01')) months.add(monthOf(dayBefore(summary.from)));
  }
  return [...months].sort();
}

// Inscrit les mois couverts par un relevé pour un compte (table "statement_months", voir supabase/finances_coherence.sql) :
// un mois déjà couvert par un autre relevé est simplement mis à jour. Sans la table, l'import continue :
// les relevés manquants sont alors repérés par les opérations seules.
export async function recordStatementMonths(account: string, months: string[]) {
  if (months.length === 0) return;
  const updated_at = new Date().toISOString();
  const { error } = await supabase.from('statement_months').upsert(
    months.map((month) => ({ account, month, updated_at })),
    { onConflict: 'account,month' }
  );
  if (error) console.error(error);
}

// Relevés présents, mois par mois (règles dans lib/coverage) : comptes suivis par relevés avec leur premier mois,
// couples compte et mois renseignés par un relevé (table "statement_months", ou opérations importées) ou par une
// opération ajoutée à la main, et le nombre d'opérations ajoutées à la main par compte et par mois.
export async function fetchCoverage(): Promise<{ coverage: Coverage; error: { message: string } | null }> {
  const firsts = new Map<string, TrackedAccount>();
  const covered = new Set<string>();
  const manual = new Map<string, ManualNote>();
  const track = (account: string, month: string) => {
    const key = account.toLowerCase();
    const known = firsts.get(key);
    if (!known || month < known.first) firsts.set(key, { account: known?.account ?? account, first: month });
    covered.add(`${key}|${month}`);
  };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('bank_transactions').select('account, date, import_key').order('date').range(from, from + 999);
    if (error) return { coverage: { tracked: [], covered: [], manual: [], estimates: [], questions: [], transfers: [], mismatches: [] }, error };
    for (const r of (data as { account: string; date: string; import_key: string }[]) ?? []) {
      const month = monthOf(r.date);
      if (!isManual(r)) {
        track(r.account, month);
        continue;
      }
      // Opération ajoutée à la main : elle compte pour le mois de son compte (et le signale), sans rendre le compte
      // « suivi par relevés » à elle seule
      covered.add(`${r.account.toLowerCase()}|${month}`);
      const key = `${r.account.toLowerCase()}|${month}`;
      const note = manual.get(key) ?? { account: r.account, month, count: 0 };
      manual.set(key, { ...note, count: note.count + 1 });
    }
    if (!data || data.length < 1000) break;
  }
  // Mois renseignés par les relevés (la table peut ne pas exister encore : on s'en passe)
  const months = await supabase.from('statement_months').select('account, month');
  for (const r of (months.data as { account: string; month: string }[]) ?? []) track(r.account, r.month);
  const tracked = [...firsts.values()];
  const { estimates, questions, transfers, mismatches, error } = await estimateSavings(tracked, covered);
  return { coverage: { tracked, covered: [...covered], manual: [...manual.values()], estimates, questions, transfers, mismatches }, error };
}

// --- Soldes estimés des livrets ---
// Le relevé d'un livret arrive souvent longtemps après la fin du mois. En l'attendant, son solde de fin de mois est
// estimé : dernier solde connu (le bilan du dernier mois couvert par un relevé), plus les virements entre mes comptes
// vus depuis sur les autres comptes, vers ce livret ou depuis ce livret (hors intérêts, versés en fin d'année).
// Il faut pour cela que les relevés des comptes courants soient là pour chacun de ces mois.
// L'autre compte d'un virement se lit dans son libellé (« VERS LIVRET A », « LEP »...) ; s'il n'est pas clair,
// l'utilisateur le précise (questions) et le solde attend sa réponse.

// Types de livrets reconnus dans un nom de compte ou un libellé
const SAVINGS_KINDS: [string, RegExp][] = [
  ['lep', /\bLEP\b|EPARGNE POPULAIRE/],
  ['ldds', /\bLDDS?\b|DEVELOPPEMENT DURABLE/],
  ['jeune', /LIVRET JEUNE/],
  ['livret a', /\bLIVRET A\b|\bLIV A\b/],
  ['pel', /\bPEL\b|PLAN EPARGNE LOGEMENT/],
  ['cel', /\bCEL\b|COMPTE EPARGNE LOGEMENT/]
];
const savingsKind = (text: string) => SAVINGS_KINDS.find(([, re]) => re.test(normalizeLabel(text)))?.[0] ?? null;

// Autre compte d'un virement : précisé à la main, ou seul de mes comptes que le libellé désigne, ou seul compte possible
// (undefined : on ne sait pas)
function transferTarget(t: Transaction, accounts: string[]) {
  if (typeof t.transfer_account === 'string') return t.transfer_account;
  const others = accounts.filter((a) => a.toLowerCase() !== t.account.toLowerCase());
  if (others.length === 1) return others[0];
  const label = normalizeLabel(t.label);
  const kind = savingsKind(t.label);
  const named = others.filter((a) => {
    const name = normalizeLabel(a);
    return (!!name && new RegExp(`(^|[^A-Z0-9])${escapeRegex(name)}([^A-Z0-9]|$)`).test(label)) || (!!kind && savingsKind(a) === kind);
  });
  if (named.length === 1) return named[0];
  // Un livret ne peut échanger qu'avec un compte courant du titulaire : s'il n'y en a qu'un, c'est lui
  const current = others.filter((a) => !isSavingsAccount(a));
  if (isSavingsAccount(t.account) && current.length === 1) return current[0];
  return undefined;
}

async function estimateSavings(tracked: TrackedAccount[], covered: Set<string>) {
  const estimates: SavingsEstimate[] = [];
  const questions = new Map<string, TransferQuestion>();
  const transfers: TransferCheck[] = [];
  const mismatches: TransferMismatch[] = [];
  const done = (error: { message: string } | null = null) => ({ estimates, questions: [...questions.values()], transfers, mismatches, error });
  const savings = tracked.filter((a) => isSavingsAccount(a.account));
  if (savings.length === 0) return done();
  const isCovered = (account: string, month: string) => covered.has(`${account.toLowerCase()}|${month}`);
  const thisMonth = monthKey(new Date());

  // Soldes inscrits au bilan, et virements entre mes comptes
  const { rows: balances, error: balanceError } = await fetchAllLines<{ period: string; label: string; amount: number }>('period, label, amount', (q) =>
    q.eq('section', 'liquidites')
  );
  if (balanceError) return done(balanceError);
  const balanceOf = (account: string, month: string) => {
    const row = balances.find((r) => r.period === month && r.label.toLowerCase() === account.toLowerCase());
    return row ? Number(row.amount) : null;
  };
  const { loose, error: looseError } = await fetchLooseTransfers();
  if (looseError) return done(looseError);
  // Opérations estimées modifiées à la main : elles remplacent les virements vus ailleurs pour leur compte et leur mois
  const edited = await fetchEditedEstimates();
  const editedOf = (account: string, month: string) => edited.filter((o) => o.account.toLowerCase() === account.toLowerCase() && o.month === month);
  const accounts = tracked.map((a) => a.account);
  const currents = tracked.filter((a) => !isSavingsAccount(a.account));
  // Mes autres comptes, et toujours les comptes courants (même celui du virement)
  const choicesFor = (t: Transaction) => accounts.filter((a) => a.toLowerCase() !== t.account.toLowerCase() || !isSavingsAccount(a));

  // Tous les virements dont une seule moitié est enregistrée, avec l'autre compte retenu : à revérifier sur le Bilan
  for (const t of loose)
    transfers.push({ id: t.id, date: t.date, label: t.label, amount: t.amount, account: t.account, choices: choicesFor(t), target: transferTarget(t, accounts) ?? null });
  // Opérations estimées modifiées à la main qui ne collent plus aux virements vus sur les autres comptes,
  // avec la raison de chaque écart (opération par opération)
  for (const key of new Set(edited.map((o) => `${o.account.toLowerCase()}|${o.month}`))) {
    const all = edited.filter((o) => `${o.account.toLowerCase()}|${o.month}` === key);
    const { account, month } = all[0];
    if (isCovered(account, month)) continue;
    const ops = all.filter((o) => o.amount !== 0);
    const isThis = (a: string | null) => a?.toLowerCase() === account.toLowerCase();
    // Virements vus sur les autres comptes ce mois-ci, dont l'autre compte est ce livret
    const seenTransfers = transfers.filter((t) => monthOf(t.date) === month && !isThis(t.account) && isThis(t.target));
    const estimated = round(ops.reduce((s, o) => s + o.amount, 0));
    const seen = round(-seenTransfers.reduce((s, t) => s + t.amount, 0));
    if (cents(estimated) === cents(seen)) continue;

    // Chaque opération estimée cherche son double (montant inverse, à quelques jours près) parmi ces virements
    const unmatched = [...seenTransfers];
    const missing: EstimatedOperation[] = [];
    for (const o of ops) {
      const i = unmatched.findIndex((t) => cents(t.amount) === -cents(o.amount) && dayGap(t.date, o.date) <= TRANSFER_DAYS);
      if (i >= 0) unmatched.splice(i, 1);
      else missing.push(o);
    }
    const reasons: string[] = [];
    if (missing.length) {
      // Opérations des autres comptes autour du mois : le double peut être là, mais pas classé en virement
      const { data } = await supabase
        .from('bank_transactions')
        .select('*')
        .gte('date', shiftDay(`${month}-01`, -TRANSFER_DAYS))
        .lte('date', shiftDay(lastDayOf(month), TRANSFER_DAYS));
      const nearby = ((data as Transaction[]) ?? []).map(toTransaction);
      for (const o of missing) {
        const what = `« ${o.label} » (${signedEuros(o.amount)} sur ${account} le ${dayLabel(o.date)})`;
        const twin = (x: { account: string; amount: number; date: string }) =>
          !isThis(x.account) && cents(x.amount) === -cents(o.amount) && dayGap(x.date, o.date) <= TRANSFER_DAYS;
        const transfer = transfers.find((t) => twin(t) && !seenTransfers.includes(t));
        const other = !transfer && nearby.find((x) => twin(x) && x.category !== 'virement_interne');
        if (transfer)
          reasons.push(
            `${what} correspond au virement « ${transfer.label} » sur ${transfer.account}, mais ce virement est indiqué ${
              transfer.target === null
                ? 'sans autre compte'
                : transfer.target === ''
                  ? 'avec un compte non suivi'
                  : `${transfer.amount < 0 ? 'vers' : 'depuis'} ${transfer.target}`
            } : choisis ${account} ci-dessous.`
          );
        else if (other)
          reasons.push(
            `${what} correspond sans doute à « ${other.label} » (${signedEuros(other.amount)} sur ${other.account}), classée en ${categoryById(other.category).label} : classe-la en Virements entre mes comptes dans la liste des opérations.`
          );
        else
          reasons.push(
            `${what} : aucune opération de ${signedEuros(-o.amount)} n'apparaît sur tes autres comptes autour de cette date. Si l'argent ${
              o.amount < 0 ? 'est simplement allé sur' : 'vient simplement de'
            } ton compte courant, son relevé doit la montrer : vérifie le montant et la date, ou importe ce relevé.`
          );
      }
    }
    for (const t of unmatched)
      reasons.push(
        `Le virement « ${t.label} » (${signedEuros(t.amount)} sur ${t.account} le ${dayLabel(t.date)}, ${t.amount < 0 ? 'vers' : 'depuis'} ${account}) n'a pas d'opération estimée de ${signedEuros(-t.amount)} sur ${account} : ajoute-la dans la liste des opérations, ou choisis un autre compte ci-dessous.`
      );
    mismatches.push({ account, month, estimated, seen, reasons });
  }

  for (const s of savings) {
    // Mois terminés seulement : le mois en cours n'a encore de relevé sur aucun compte
    for (let month = s.first; month < thisMonth; month = shiftMonth(month, 1)) {
      if (isCovered(s.account, month)) continue;
      // Dernier mois couvert par un relevé du livret, avec un solde inscrit au bilan
      let base = shiftMonth(month, -1);
      while (base >= s.first && !isCovered(s.account, base)) base = shiftMonth(base, -1);
      const start = base < s.first ? null : balanceOf(s.account, base);
      if (start === null) continue;
      // Les relevés des comptes courants doivent être là pour chaque mois écoulé depuis
      let complete = true;
      for (let m = shiftMonth(base, 1); m <= month; m = shiftMonth(m, 1))
        if (currents.some((c) => c.first <= m && !isCovered(c.account, m))) complete = false;
      if (!complete) continue;
      let balance = start;
      let unclear = false;
      for (let m = shiftMonth(base, 1); m <= month; m = shiftMonth(m, 1)) for (const o of editedOf(s.account, m)) balance += o.amount;
      for (const t of loose) {
        if (t.date <= lastDayOf(base) || t.date > lastDayOf(month) || t.account.toLowerCase() === s.account.toLowerCase()) continue;
        if (editedOf(s.account, monthOf(t.date)).length > 0) continue;
        const target = transferTarget(t, accounts);
        if (target === undefined) {
          // Ce virement pourrait concerner le livret : on le fait préciser, et le solde attend la réponse
          unclear = true;
          questions.set(t.id, {
            id: t.id,
            date: t.date,
            label: t.label,
            amount: t.amount,
            account: t.account,
            choices: choicesFor(t)
          });
        } else if (target.toLowerCase() === s.account.toLowerCase()) balance -= t.amount; // sortie du compte courant = entrée sur le livret
      }
      estimates.push({ account: s.account, month, base, balance: unclear ? null : round(balance) });
    }
  }
  return done();
}

const signedEuros = (n: number) => `${n > 0 ? '+' : ''}${formatEuros(n)}`;
const dayLabel = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Virements entre mes comptes dont une seule moitié est enregistrée (celles dont les deux moitiés le sont
// sont déjà comptées dans les relevés des deux comptes)
async function fetchLooseTransfers() {
  const transfers: Transaction[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('bank_transactions').select('*').eq('category', 'virement_interne').order('date').range(start, start + 999);
    if (error) return { loose: [] as Transaction[], error };
    transfers.push(...((data as Transaction[]) ?? []).map(toTransaction));
    if (!data || data.length < 1000) break;
  }
  const pairs = pairTransfers(transfers);
  return { loose: transfers.filter((t) => !pairs.has(t)), error: null };
}

// --- Opérations estimées d'un livret sans relevé ---
// Pour un mois sans relevé du livret, ses opérations sont estimées d'après les virements vus sur les autres comptes
// (une sortie du compte courant vers le livret est une entrée sur le livret). L'utilisateur peut les modifier :
// la version modifiée est alors gardée (table estimated_operations, supabase/estimated_operations.sql) et remplace
// l'estimation automatique, pour la liste comme pour le solde estimé du Bilan.

export type EstimatedOperation = { id?: string; account: string; month: string; date: string; label: string; amount: number };

// Opérations estimées modifiées à la main (table absente : aucune)
async function fetchEditedEstimates(account?: string, month?: string) {
  let query = supabase.from('estimated_operations').select('id, account, month, date, label, amount').order('date');
  if (account) query = query.ilike('account', account);
  if (month) query = query.eq('month', month);
  const { data, error } = await query;
  if (error) return [];
  return ((data as EstimatedOperation[]) ?? []).map((o) => ({ ...o, amount: Number(o.amount) }));
}

// Opérations du livret pour le mois : celles modifiées à la main s'il y en a, sinon l'estimation automatique.
// unclear : virements de ce mois dont l'autre compte reste à préciser (sur le Bilan), qui pourraient le concerner
export async function fetchEstimatedOperations(account: string, month: string, accounts: string[]) {
  const edited = await fetchEditedEstimates(account, month);
  if (edited.length > 0) return { operations: edited, edited: true, unclear: 0, error: null };
  const { loose, error } = await fetchLooseTransfers();
  if (error) return { operations: [] as EstimatedOperation[], edited: false, unclear: 0, error };
  const operations: EstimatedOperation[] = [];
  let unclear = 0;
  for (const t of loose) {
    if (monthOf(t.date) !== month || t.account.toLowerCase() === account.toLowerCase()) continue;
    const target = transferTarget(t, accounts);
    if (target === undefined) unclear++;
    else if (target.toLowerCase() === account.toLowerCase())
      operations.push({ account, month, date: t.date, label: `Virement ${t.amount < 0 ? 'depuis' : 'vers'} ${t.account}`, amount: -t.amount });
  }
  return { operations, edited: false, unclear, error: null };
}

// Garde la version modifiée des opérations estimées du livret pour ce mois (remplace la précédente)
export async function saveEstimatedOperations(account: string, month: string, operations: Omit<EstimatedOperation, 'id'>[]) {
  const err = await resetEstimatedOperations(account, month);
  if (err) return err;
  // Liste vidée à la main : une opération à 0 € la garde « modifiée » (sinon l'estimation automatique reviendrait)
  const rows = (operations.length ? operations : [{ account, month, date: `${month}-01`, label: 'Aucune opération', amount: 0 }]).map((o) => ({
    account,
    month,
    date: o.date,
    label: o.label,
    amount: o.amount
  }));
  const { error } = await supabase.from('estimated_operations').insert(rows);
  return error;
}

// Revient à l'estimation automatique
export async function resetEstimatedOperations(account: string, month: string) {
  const { error } = await supabase.from('estimated_operations').delete().ilike('account', account).eq('month', month);
  return error;
}

// Précise l'autre compte d'un virement entre mes comptes ('' : un compte qui n'est pas suivi ici)
export async function setTransferAccount(id: string, account: string) {
  const { error } = await supabase.from('bank_transactions').update({ transfer_account: account }).eq('id', id);
  return error;
}
