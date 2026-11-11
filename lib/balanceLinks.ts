import { supabase } from '@/lib/supabase';
import { addLine, deleteLine, monthKey, SECTIONS, setLineAmount, shiftMonth, updateLine } from '@/lib/finance';
import { CATEGORIES, categoryById, groupKindOf, lastDayOf, monthOf, refreshStatements, type Transaction } from '@/lib/transactions';

// Lignes du bilan complétées par des catégories du Budget (Finances > Gestion, « Créer des connecteurs ») :
// chaque ligne (sommes à recevoir, emprunts, autres dettes) a des catégories qui l'augmentent et d'autres qui la diminuent
// (un remboursement). Une catégorie compte pour le montant de ses opérations : entrée reçue ou sortie payée.
// Le montant inscrit chaque fin de mois est le cumul de ces mouvements (plus un montant de départ facultatif), depuis le mois
// de départ s'il est donné, sinon depuis la première opération. Le bilan reste non modifiable : c'est ici qu'on décide d'où viennent ses montants.
// Table "balance_links" (voir supabase/finances_coherence.sql et supabase/balance_links_decreases.sql).

export type BalanceLink = {
  id: string;
  section: string; // rubrique du bilan : creances, emprunts ou dettes
  label: string; // ligne de cette rubrique
  targets: string[]; // catégories qui augmentent la ligne, ou grandes catégories ("groupe:<id>") ; précédées de « = » (EQUAL),
  // la ligne vaut leur montant du mois (sans cumul), gardé tant qu'un autre mois ne le change pas
  decreases: string[]; // catégories qui la diminuent (remboursements), même forme
  opening: number; // montant au dernier jour du mois de départ (0 par défaut)
  opening_month: string | null; // AAAA-MM, facultatif : sans lui, tout l'historique des catégories compte
};

// Rubriques du bilan qu'on peut relier : celles des dettes et des créances
export const LINKABLE_SECTIONS = SECTIONS.filter((s) => ['creances', 'emprunts', 'dettes'].includes(s.id));
export const isLinkableSection = (section: string) => LINKABLE_SECTIONS.some((s) => s.id === section);

export const groupTarget = (groupId: string) => `groupe:${groupId}`;

// Prêts entre proches : une créance (ce qu'ils te doivent) et une dette (ce que tu leur dois), réglées ensemble.
// La créance monte quand tu prêtes et baisse quand on te rembourse ; la dette monte quand on te prête et baisse quand tu rembourses.
// Le montant de la dette est aussi reporté sur la créance (refreshBalanceLinks).
export const PROCHES = {
  creance: { section: 'creances', label: 'Créance' },
  dette: { section: 'dettes', label: 'Dette' }
} as const;
// Anciens noms de ces lignes, renommés au prochain recalcul du bilan (renameProchesLines)
const OLD_PROCHES = { creance: 'Créances envers des proches', dette: 'Dettes envers des proches' } as const;
export type ProchesPart = keyof typeof PROCHES;
const sameLine = (link: Pick<BalanceLink, 'section' | 'label'>, line: { section: string; label: string }) =>
  link.section === line.section && link.label.trim().toLowerCase() === line.label.toLowerCase();
export const isProches = (link: Pick<BalanceLink, 'section' | 'label'>) => sameLine(link, PROCHES.creance) || sameLine(link, PROCHES.dette);
export const prochesPart = (links: BalanceLink[], part: ProchesPart) => links.find((l) => sameLine(l, PROCHES[part]));

// Nature d'une liaison entre une catégorie et une ligne du bilan :
//  « + » la ligne augmente du montant de la catégorie, mois après mois (targets) ;
//  « − » elle en diminue (decreases) ;
//  « = » elle vaut le montant de la catégorie dans le mois, sans cumul, et le garde les mois
//      suivants tant que la catégorie n'a pas de nouvelle opération (dans targets, précédée de « = »).
export type LinkNature = '=' | '+' | '-';
export const EQUAL = '=';
export const isEqualTarget = (target: string) => target.startsWith(EQUAL);
export const plainTarget = (target: string) => (isEqualTarget(target) ? target.slice(EQUAL.length) : target);

// Nature de la liaison d'une catégorie (ou grande catégorie) avec une ligne, null si elle n'y est pas reliée
export function natureOf(link: Pick<BalanceLink, 'targets' | 'decreases'>, target: string): LinkNature | null {
  if (link.targets.includes(EQUAL + target)) return '=';
  if (link.targets.includes(target)) return '+';
  return link.decreases.includes(target) ? '-' : null;
}

// Relie une catégorie à une ligne avec la nature choisie (elle quitte sa place précédente dans cette ligne)
export function withNature(link: Pick<BalanceLink, 'targets' | 'decreases'>, target: string, nature: LinkNature) {
  const keep = (list: string[]) => list.filter((t) => plainTarget(t) !== target);
  const targets = keep(link.targets);
  const decreases = keep(link.decreases);
  if (nature === '+') targets.push(target);
  else if (nature === '=') targets.push(EQUAL + target);
  else decreases.push(target);
  return { targets, decreases };
}

// Catégories désignées par une liste (les sous-catégories des grandes catégories choisies), quelle que soit leur nature
export function linkCategories(targets: string[]) {
  const ids = new Set<string>();
  for (const raw of targets) {
    const target = plainTarget(raw);
    if (target.startsWith('groupe:')) CATEGORIES.filter((c) => c.group === target.slice(7)).forEach((c) => ids.add(c.id));
    else ids.add(target);
  }
  return [...ids];
}

const round = (n: number) => Math.round(n * 100) / 100;
// Côté du bilan d'une rubrique
export const sideOf = (section: string) => SECTIONS.find((s) => s.id === section)?.side ?? 'passif';

// Montant d'une opération pour sa catégorie : une entrée reçue ou une sortie payée compte en positif (un avoir, en négatif)
const moveOf = (t: Pick<Transaction, 'amount' | 'category'>) => (groupKindOf(categoryById(t.category)) === 'income' ? t.amount : -t.amount);

// Catégories reliées retenues dans ce navigateur lors du dernier recalcul (null : jamais recalculé ici)
const CONNECTED_KEY = 'finances:categories-reliees';
function readConnected(): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(CONNECTED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

// Une catégorie reliée à un connecteur ne compte plus dans le compte de résultat (comme un virement), et y revient quand
// on la détache : les mois où les catégories reliées ou détachées depuis le dernier recalcul ont des opérations sont
// recalculés (au premier passage dans ce navigateur, tous ceux des catégories reliées).
async function syncConnectedStatements(links: BalanceLink[]) {
  const now = new Set(links.flatMap((l) => [...linkCategories(l.targets), ...linkCategories(l.decreases)]));
  const before = readConnected();
  const changed = before ? [...new Set([...now, ...before])].filter((id) => now.has(id) !== before.has(id)) : [...now];
  if (changed.length) {
    const { data, error } = await supabase.from('bank_transactions').select('date').in('category', changed);
    if (error) return error;
    const months = [...new Set(((data as { date: string }[]) ?? []).map((t) => monthOf(t.date)))];
    if (months.length) {
      const { error: refreshError } = await refreshStatements(months);
      if (refreshError) return refreshError;
    }
  }
  try {
    window.localStorage.setItem(CONNECTED_KEY, JSON.stringify([...now]));
  } catch {
    // pas de stockage : le prochain recalcul repartira de zéro
  }
  return null;
}

// Montant de la ligne à la fin de chaque mois, jusqu'à "lastMonth" : cumul de ce qui l'augmente, moins ce qui la diminue,
// plus le montant du mois des catégories reliées par « = »
export function linkBalances(link: BalanceLink, transactions: Pick<Transaction, 'date' | 'amount' | 'category'>[], lastMonth: string) {
  const up = new Set(linkCategories(link.targets.filter((t) => !isEqualTarget(t))));
  const equal = new Set(linkCategories(link.targets.filter(isEqualTarget)));
  const down = new Set(linkCategories(link.decreases));
  const start = link.opening_month ? lastDayOf(link.opening_month) : '';
  const moves = transactions.filter((t) => (up.has(t.category) || down.has(t.category) || equal.has(t.category)) && t.date > start);
  const result: { month: string; balance: number }[] = [];
  let balance = link.opening;
  let month = link.opening_month ?? moves.map((t) => monthOf(t.date)).sort()[0] ?? lastMonth;
  if (link.opening_month) {
    result.push({ month, balance: round(balance) });
    month = shiftMonth(month, 1);
  }
  // Montant des catégories reliées par « = » : il reste le même, mois après mois, jusqu'à un mois où elles ont des
  // opérations (« + » et « − » se cumulent, et gardent donc aussi leur valeur les mois sans opération)
  let equalValue = 0;
  for (; month <= lastMonth; month = shiftMonth(month, 1)) {
    let ofMonth = 0;
    let equalMoved = false;
    for (const t of moves.filter((m) => monthOf(m.date) === month)) {
      if (up.has(t.category)) balance += moveOf(t);
      if (down.has(t.category)) balance -= moveOf(t);
      if (equal.has(t.category)) {
        ofMonth += moveOf(t);
        equalMoved = true;
      }
    }
    if (equalMoved) equalValue = ofMonth;
    result.push({ month, balance: round(balance + equalValue) });
  }
  return result;
}

// La colonne "decreases" peut manquer tant que supabase/balance_links_decreases.sql n'a pas été lancé :
// les liaisons se lisent quand même, sans catégories qui diminuent
const missingDecreases = (message: string) => /decreases/.test(message);

export async function fetchBalanceLinks() {
  const columns = 'id, section, label, targets, opening, opening_month';
  let { data, error }: { data: unknown; error: { message: string } | null } = await supabase.from('balance_links').select(`${columns}, decreases`).order('created_at');
  if (error && missingDecreases(error.message)) ({ data, error } = await supabase.from('balance_links').select(columns).order('created_at'));
  return {
    links: ((data as Partial<BalanceLink>[]) ?? []).map((l) => ({ ...l, opening: Number(l.opening), targets: l.targets ?? [], decreases: l.decreases ?? [] }) as BalanceLink),
    error
  };
}

// Enregistre une liaison (sans recalculer le bilan : refreshBalanceLinks s'en charge)
export async function saveBalanceLink(link: Omit<BalanceLink, 'id'> & { id?: string }) {
  const { id, decreases, ...rest } = link;
  const base = { ...rest, label: link.label.trim(), opening_month: link.opening_month || null };
  const write = (row: object) => (id ? supabase.from('balance_links').update(row).eq('id', id) : supabase.from('balance_links').insert(row));
  const { error } = await write({ ...base, decreases });
  // Sans la colonne, une liaison sans catégories qui diminuent s'enregistre quand même
  if (error && missingDecreases(error.message) && decreases.length === 0) return (await write(base)).error;
  return error;
}

// Retire une liaison sans recalculer le bilan
export async function removeBalanceLink(id: string) {
  return (await supabase.from('balance_links').delete().eq('id', id)).error;
}

// Recalcul lancé une seule fois par ouverture de l'appli (à l'affichage du bilan) : true s'il a abouti
let refreshedOnce: Promise<boolean> | null = null;
export function refreshBalanceLinksOnce() {
  refreshedOnce ??= refreshBalanceLinks().then((err) => {
    if (err) console.error(err);
    return !err;
  });
  return refreshedOnce;
}

// Retire les liaisons, puis recalcule le bilan : les montants qu'elles avaient inscrits sont remis à zéro
export async function deleteBalanceLinks(links: BalanceLink[]) {
  for (const link of links) {
    const error = await removeBalanceLink(link.id);
    if (error) return error;
  }
  return refreshBalanceLinks();
}

// « Créances envers des proches » devient « Créance », « Dettes envers des proches » devient « Dette » : liaisons et lignes
// déjà inscrites au bilan, tous mois confondus (sans effet une fois fait)
async function renameProchesLines() {
  for (const part of ['creance', 'dette'] as const) {
    const { section, label } = PROCHES[part];
    await supabase.from('balance_links').update({ label }).eq('section', section).ilike('label', OLD_PROCHES[part]);
    await supabase.from('finance_lines').update({ label }).eq('section', section).ilike('label', OLD_PROCHES[part]);
  }
}

// Inscrit au bilan le solde de chaque ligne reliée, pour chaque mois déjà ouvert (qui a des lignes) depuis son mois de départ.
// À relancer après un import, un reclassement, une opération ajoutée à la main, ou une liaison créée, modifiée ou retirée :
// tout est recalculé depuis le départ. Les montants calculés qui ne correspondent plus à aucune liaison (ligne renommée ou
// déliée, mois avant le nouveau mois de départ…) sont remis à zéro ; deux liaisons sur la même ligne s'additionnent.
export async function refreshBalanceLinks() {
  await renameProchesLines();
  const { links, error } = await fetchBalanceLinks();
  if (error) return /balance_links/.test(error.message) ? null : error; // table pas encore créée : rien à faire
  const statementError = await syncConnectedStatements(links);
  if (statementError) return statementError;
  const currentMonth = monthKey(new Date());
  const { data: lineRows, error: lineError } = await supabase.from('finance_lines').select('id, period, statement, section, label, amount').lte('period', currentMonth);
  if (lineError) return lineError;
  const lines = (lineRows as { id: string; period: string; statement: string; section: string; label: string; amount: number }[]) ?? [];
  const opened = new Set(lines.map((r) => r.period));
  const keyOf = (period: string, section: string, label: string) => `${period}|${section}|${label.trim().toLowerCase()}`;

  // Montant voulu pour chaque ligne reliée, mois par mois
  const wanted = new Map<string, { period: string; section: string; label: string; amount: number }>();
  for (const link of links) {
    const categories = [...new Set([...linkCategories(link.targets), ...linkCategories(link.decreases)])];
    const query = supabase.from('bank_transactions').select('date, amount, category').in('category', categories);
    const { data, error: txError } = categories.length
      ? await (link.opening_month ? query.gt('date', lastDayOf(link.opening_month)) : query)
      : { data: [], error: null };
    if (txError) return txError;
    const transactions = ((data as Transaction[]) ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
    for (const { month, balance } of linkBalances(link, transactions, currentMonth)) {
      if (!opened.has(month)) continue;
      const key = keyOf(month, link.section, link.label);
      const prev = wanted.get(key);
      wanted.set(key, { period: month, section: link.section, label: link.label, amount: round((prev?.amount ?? 0) + balance) });
    }
  }

  // La dette envers des proches est reportée, chaque mois, sur la créance envers des proches (qui y ajoute sa propre liaison s'il y en a une)
  for (const debt of [...wanted.values()].filter((w) => sameLine(w, PROCHES.dette))) {
    const key = keyOf(debt.period, PROCHES.creance.section, PROCHES.creance.label);
    const own = wanted.get(key)?.amount ?? 0;
    wanted.set(key, { period: debt.period, ...PROCHES.creance, amount: round(own + debt.amount) });
  }

  // Lignes de ces rubriques qui ne viennent plus d'aucune liaison (déliée, renommée, mois avant le nouveau mois de départ…) :
  // le bilan ne se modifie pas à la main, leurs montants ne peuvent venir que d'une liaison. Les lignes du modèle
  // (Crédit immobilier, Découvert…) restent, remises à zéro, pour garder la forme du tableau ; les autres sont retirées.
  const isTemplate = (section: string, label: string) =>
    !!LINKABLE_SECTIONS.find((s) => s.id === section)?.template.some((t) => t.toLowerCase() === label.trim().toLowerCase());
  for (const line of lines) {
    if (!isLinkableSection(line.section) || wanted.has(keyOf(line.period, line.section, line.label))) continue;
    if (!isTemplate(line.section, line.label)) {
      const err = await deleteLine(line.id);
      if (err) return err;
    } else if (Number(line.amount) !== 0) {
      const err = await updateLine(line.id, { amount: 0, auto: false });
      if (err) return err;
    }
  }
  // Lignes du modèle absentes d'un mois déjà ouvert (retirées, ou renommées dans le modèle) : remises, à zéro
  for (const period of opened) {
    for (const section of LINKABLE_SECTIONS) {
      for (const [position, label] of section.template.entries()) {
        if (lines.some((l) => l.period === period && l.section === section.id && l.label.trim().toLowerCase() === label.toLowerCase())) continue;
        const { error: addError } = await addLine(period, section, label, position);
        if (addError) return addError;
      }
    }
  }
  for (const { period, section, label, amount } of wanted.values()) {
    const err = await setLineAmount(period, section, label, amount, true, true);
    if (err) return err;
  }
  return null;
}
