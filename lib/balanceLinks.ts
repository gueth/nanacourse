import { supabase } from '@/lib/supabase';
import { fetchAllLines, monthKey, SECTIONS, shiftMonth } from '@/lib/finance';
import { categoryById, connectedFrom, groupKindOf, lastDayOf, monthOf, refreshStatements, targetCategories, type Transaction } from '@/lib/transactions';

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
  // catégories pour lesquelles cette ligne est la ligne d'équilibrage d'une connexion (l'autre côté du bilan), et non
  // la ligne du connecteur ; vide tant que supabase/balance_links_counters.sql n'a pas été lancé
  counters: string[];
  // libellés des connexions dont cette ligne est la ligne du connecteur, par catégorie (facultatifs) ; vide tant que
  // supabase/balance_links_names.sql n'a pas été lancé
  names: Record<string, string>;
  opening: number; // montant au dernier jour du mois de départ (0 par défaut)
  opening_month: string | null; // AAAA-MM, facultatif : sans lui, tout l'historique des catégories compte
};

// Rubriques du bilan qu'on peut relier : celles des dettes et des créances
export const LINKABLE_SECTIONS = SECTIONS.filter((s) => ['creances', 'emprunts', 'dettes'].includes(s.id));
export const isLinkableSection = (section: string) => LINKABLE_SECTIONS.some((s) => s.id === section);

export const groupTarget = (groupId: string) => `groupe:${groupId}`;

// Lignes des prêts entre proches : la créance (ce qu'ils te doivent) et la dette (ce que tu leur dois)
const PROCHES = {
  creance: { section: 'creances', label: 'Créance' },
  dette: { section: 'dettes', label: 'Dette' }
} as const;
// Anciens noms de ces lignes, renommés au prochain recalcul du bilan (renameProchesLines)
const OLD_PROCHES = { creance: 'Créances envers des proches', dette: 'Dettes envers des proches' } as const;

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
// (même règle que le compte de résultat : lib/transactions, targetCategories)
export const linkCategories = targetCategories;

const round = (n: number) => Math.round(n * 100) / 100;
// Côté du bilan d'une rubrique
export const sideOf = (section: string) => SECTIONS.find((s) => s.id === section)?.side ?? 'passif';

// Montant d'une opération pour sa catégorie : une entrée reçue ou une sortie payée compte en positif (un avoir, en négatif)
const moveOf = (t: Pick<Transaction, 'amount' | 'category'>) => (groupKindOf(categoryById(t.category)) === 'income' ? t.amount : -t.amount);

// Catégories reliées (et date à partir de laquelle elles vont au bilan) retenues dans ce navigateur lors du dernier
// recalcul (null : jamais recalculé ici avec le mois de départ pris en compte)
const CONNECTED_KEY = 'finances:categories-reliees-depuis';
function readConnected(): Map<string, string> | null {
  try {
    const raw = window.localStorage.getItem(CONNECTED_KEY);
    return raw ? new Map(JSON.parse(raw) as [string, string][]) : null;
  } catch {
    return null;
  }
}

// Une catégorie reliée à un connecteur ne compte plus dans le compte de résultat (comme un virement) à partir du mois de
// départ du connecteur, et y revient quand on la détache : les mois où les catégories reliées, détachées ou dont le mois
// de départ a changé depuis le dernier recalcul ont des opérations sont recalculés (au premier passage dans ce
// navigateur, tous ceux des catégories reliées).
async function syncConnectedStatements(links: BalanceLink[]) {
  const now = connectedFrom(links);
  const before = readConnected();
  const changed = before ? [...new Set([...now.keys(), ...before.keys()])].filter((id) => now.get(id) !== before.get(id)) : [...now.keys()];
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
    window.localStorage.setItem(CONNECTED_KEY, JSON.stringify([...now.entries()]));
  } catch {
    // pas de stockage : le prochain recalcul repartira de zéro
  }
  return null;
}

// Ligne du connecteur d'une catégorie (celle où elle n'est pas en équilibrage), pour une ligne d'équilibrage
function connectorOf(links: BalanceLink[], counterLink: BalanceLink, target: string) {
  return links.find((l) => l.id !== counterLink.id && natureOf(l, target) !== null && !l.counters.includes(target));
}

// Montant de la ligne à la fin de chaque mois, jusqu'à "lastMonth" : cumul de ce qui l'augmente, moins ce qui la diminue,
// plus le montant du mois des catégories reliées par « = ».
// Ligne d'équilibrage (« Créance == Dette ») : pour une catégorie en « = » dont elle est l'équilibrage, elle ne vaut pas le
// montant du mois de la catégorie mais ce que cette catégorie donne à la ligne du connecteur (cumul s'il est en « += »),
// pour que les deux lignes restent égales. "links" : toutes les liaisons, pour retrouver la ligne du connecteur.
export function linkBalances(link: BalanceLink, transactions: Pick<Transaction, 'date' | 'amount' | 'category'>[], lastMonth: string, links: BalanceLink[] = []) {
  // Catégories (« = ») recopiées depuis la ligne de leur connecteur : catégorie → nature et début de cette ligne-là
  const mirrored = new Map<string, { nature: LinkNature; start: string }>();
  for (const target of link.targets.filter(isEqualTarget).map(plainTarget)) {
    if (!link.counters.includes(target)) continue;
    const connector = connectorOf(links, link, target);
    const nature = connector && natureOf(connector, target);
    if (!connector || !nature) continue;
    const start = connector.opening_month ? lastDayOf(connector.opening_month) : '';
    for (const c of linkCategories([target])) mirrored.set(c, { nature, start });
  }
  const up = new Set(linkCategories(link.targets.filter((t) => !isEqualTarget(t))));
  const equal = new Set(linkCategories(link.targets.filter(isEqualTarget)).filter((c) => !mirrored.has(c)));
  const down = new Set(linkCategories(link.decreases));
  // Valeur recopiée de la ligne du connecteur : cumul (+ / −) ou montant du mois gardé (=), comme sur cette ligne
  let mirror = 0;
  const start = link.opening_month ? lastDayOf(link.opening_month) : '';
  const moves = transactions.filter((t) => (up.has(t.category) || down.has(t.category) || equal.has(t.category) || mirrored.has(t.category)) && t.date > start);
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
    let mirrorOfMonth = 0;
    let mirrorMoved = false;
    for (const t of moves.filter((m) => monthOf(m.date) === month)) {
      if (up.has(t.category)) balance += moveOf(t);
      if (down.has(t.category)) balance -= moveOf(t);
      if (equal.has(t.category)) {
        ofMonth += moveOf(t);
        equalMoved = true;
      }
      const m = mirrored.get(t.category);
      if (m && t.date > m.start) {
        if (m.nature === '+') mirror += moveOf(t);
        else if (m.nature === '-') mirror -= moveOf(t);
        else {
          mirrorOfMonth += moveOf(t);
          mirrorMoved = true;
        }
      }
    }
    if (equalMoved) equalValue = ofMonth;
    if (mirrorMoved) mirror = mirrorOfMonth;
    result.push({ month, balance: round(balance + equalValue + mirror) });
  }
  return result;
}

// Contrôle de l'équilibre du bilan d'un mois. L'actif et le passif sont égaux par construction (les capitaux propres
// sont ce qui reste), ce qui peut le déséquilibrer vient donc des connecteurs :
//  - une ligne d'équilibrage qui ne vaut pas ce que la catégorie donne à la ligne de son connecteur (« Créance == Dette ») ;
//  - une ligne reliée dont le montant inscrit au bilan n'est plus celui que calculent ses connecteurs (recalcul pas fait
//    ou interrompu après un import, un reclassement ou un connecteur modifié).
// Renvoie la liste des problèmes (vide : tout est juste).
export async function checkBalance(period: string): Promise<string[]> {
  const { links, error } = await fetchBalanceLinks();
  if (error || !links.length) return [];
  const categories = [...new Set(links.flatMap((l) => [...linkCategories(l.targets), ...linkCategories(l.decreases)]))];
  const [txRes, lineRes] = await Promise.all([
    categories.length ? supabase.from('bank_transactions').select('date, amount, category').in('category', categories).lte('date', lastDayOf(period)) : { data: [], error: null },
    supabase.from('finance_lines').select('section, label, amount').eq('period', period)
  ]);
  if (txRes.error || lineRes.error) return [];
  const transactions = ((txRes.data as Transaction[]) ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
  const valueAt = (link: BalanceLink) => linkBalances(link, transactions, period, links).find((r) => r.month === period)?.balance ?? 0;
  // Part d'une seule catégorie dans une ligne (sans le montant de départ de la ligne)
  const only = (link: BalanceLink, target: string): BalanceLink => ({
    ...link,
    targets: link.targets.filter((t) => plainTarget(t) === target),
    decreases: link.decreases.filter((t) => t === target),
    opening: 0
  });
  const problems: string[] = [];
  for (const link of links) {
    for (const target of link.counters) {
      const connector = connectorOf(links, link, target);
      if (!connector) continue;
      const counterValue = valueAt(only(link, target));
      const connectorValue = valueAt({ ...only(connector, target), counters: [] });
      if (Math.abs(counterValue - connectorValue) > 0.01)
        problems.push(`« ${link.label} » (${counterValue.toFixed(2).replace('.', ',')} €) ne vaut pas « ${connector.label} » (${connectorValue.toFixed(2).replace('.', ',')} €)`);
    }
  }
  // Lignes du bilan face à ce que calculent leurs connecteurs (seulement si le mois est ouvert)
  const lines = (lineRes.data as { section: string; label: string; amount: number }[]) ?? [];
  if (lines.length) {
    const wanted = new Map<string, { label: string; amount: number }>();
    for (const link of links) {
      const key = `${link.section}|${link.label.trim().toLowerCase()}`;
      if (link.opening_month && link.opening_month > period) continue;
      wanted.set(key, { label: link.label, amount: round((wanted.get(key)?.amount ?? 0) + valueAt(link)) });
    }
    for (const [key, { label, amount }] of wanted) {
      const shown = lines.filter((l) => `${l.section}|${l.label.trim().toLowerCase()}` === key).reduce((s, l) => s + Number(l.amount), 0);
      if (Math.abs(shown - amount) > 0.01) problems.push(`« ${label} » n'est pas à jour au bilan`);
    }
  }
  return problems;
}

// La colonne "decreases" peut manquer tant que supabase/balance_links_decreases.sql n'a pas été lancé :
// les liaisons se lisent quand même, sans catégories qui diminuent
const missingDecreases = (message: string) => /decreases/.test(message);
// Même chose pour la colonne "names" (supabase/balance_links_names.sql) : sans elle, les connexions n'ont pas de libellé
const missingNames = (message: string) => /names/.test(message);
// Même chose pour la colonne "counters" (supabase/balance_links_counters.sql) : sans elle, les rôles sont devinés à l'affichage
const missingCounters = (message: string) => /counters/.test(message);

export async function fetchBalanceLinks() {
  const columns = 'id, section, label, targets, opening, opening_month';
  const read = (cols: string) => supabase.from('balance_links').select(cols).order('created_at');
  let { data, error }: { data: unknown; error: { message: string } | null } = await read(`${columns}, decreases, counters, names`);
  if (error && missingNames(error.message)) ({ data, error } = await read(`${columns}, decreases, counters`));
  if (error && missingCounters(error.message)) ({ data, error } = await read(`${columns}, decreases`));
  if (error && missingDecreases(error.message)) ({ data, error } = await read(columns));
  return {
    links: ((data as Partial<BalanceLink>[]) ?? []).map(
      (l) => ({ ...l, opening: Number(l.opening), targets: l.targets ?? [], decreases: l.decreases ?? [], counters: l.counters ?? [], names: l.names ?? {} }) as BalanceLink
    ),
    error
  };
}

// Enregistre une liaison (sans recalculer le bilan : refreshBalanceLinks s'en charge)
// Sans la colonne des libellés, la liaison s'enregistre sans eux, et l'erreur « names » le signale si un libellé était donné
export async function saveBalanceLink(link: Omit<BalanceLink, 'id' | 'counters' | 'names'> & { id?: string; counters?: string[]; names?: Record<string, string> }) {
  const { id, decreases, counters, names, ...rest } = link;
  const base = { ...rest, label: link.label.trim(), opening_month: link.opening_month || null };
  const write = (row: object) => (id ? supabase.from('balance_links').update(row).eq('id', id) : supabase.from('balance_links').insert(row));
  let row: Record<string, unknown> = { ...base, decreases, ...(counters ? { counters } : {}), ...(names ? { names } : {}) };
  let { error } = await write(row);
  let namesLost = false;
  if (error && missingNames(error.message) && 'names' in row) {
    const { names: _skip, ...without } = row;
    void _skip;
    namesLost = Object.values(names ?? {}).some(Boolean);
    row = without;
    ({ error } = await write(row));
  }
  // Sans la colonne des rôles, la liaison s'enregistre quand même (les rôles sont alors devinés à l'affichage)
  if (error && missingCounters(error.message) && 'counters' in row) {
    const { counters: _skip, ...without } = row;
    void _skip;
    row = without;
    ({ error } = await write(row));
  }
  // Sans la colonne, une liaison sans catégories qui diminuent s'enregistre quand même
  if (error && missingDecreases(error.message) && decreases.length === 0) return (await write(base)).error;
  return error ?? (namesLost ? { message: 'names' } : null);
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

// « Créances envers des proches » devient « Créance », « Dettes envers des proches » devient « Dette » : liaisons et lignes
// déjà inscrites au bilan, tous mois confondus (sans effet une fois fait)
// Une fois par ouverture de l'appli suffit
let renamed = false;
async function renameProchesLines() {
  if (renamed) return;
  renamed = true;
  await Promise.all(
    (['creance', 'dette'] as const).flatMap((part) => {
      const { section, label } = PROCHES[part];
      return ['balance_links', 'finance_lines'].map((table) => supabase.from(table).update({ label }).eq('section', section).ilike('label', OLD_PROCHES[part]));
    })
  );
}

// Inscrit au bilan le solde de chaque ligne reliée, pour chaque mois déjà ouvert (qui a des lignes) depuis son mois de départ.
// À relancer après un import, un reclassement, une opération ajoutée à la main, ou une liaison créée, modifiée ou retirée :
// tout est recalculé depuis le départ. Les montants calculés qui ne correspondent plus à aucune liaison (ligne renommée ou
// déliée, mois avant le nouveau mois de départ…) sont remis à zéro ; deux liaisons sur la même ligne s'additionnent.
// Un seul recalcul à la fois : deux recalculs en même temps (ouverture de la page et import, par exemple) verraient tous
// deux une ligne manquante et l'ajouteraient chacun, d'où des lignes en double
let running: ReturnType<typeof runRefresh> = Promise.resolve(null);
// Attend la fin du recalcul en cours (s'il y en a un) : un contrôle du bilan fait pendant un recalcul le croirait faux
export const balanceLinksSettled = () => running.then(() => undefined, () => undefined);
export function refreshBalanceLinks(): ReturnType<typeof runRefresh> {
  const next = running.then(runRefresh, runRefresh);
  running = next;
  return next;
}

type LineRow = { id: string; period: string; statement: string; section: string; label: string; amount: number; auto?: boolean | null };
const keyOf = (period: string, section: string, label: string) => `${period}|${section}|${label.trim().toLowerCase()}`;

// Retire les lignes en double (même mois, même rubrique, même intitulé) des rubriques reliées : leurs montants sont
// recalculés juste après, on garde la ligne qui a un montant (sinon la première). Renvoie les lignes restantes.
async function removeDuplicateLines(lines: LineRow[]) {
  const kept = new Map<string, LineRow>();
  const extra: string[] = [];
  for (const line of lines) {
    if (!isLinkableSection(line.section)) continue;
    const key = keyOf(line.period, line.section, line.label);
    const other = kept.get(key);
    if (!other) kept.set(key, line);
    else if (Number(other.amount) === 0 && Number(line.amount) !== 0) {
      extra.push(other.id);
      kept.set(key, line);
    } else extra.push(line.id);
  }
  for (let i = 0; i < extra.length; i += 100) {
    const { error } = await supabase.from('finance_lines').delete().in('id', extra.slice(i, i + 100));
    if (error) return { lines, error };
  }
  const removed = new Set(extra);
  return { lines: lines.filter((l) => !removed.has(l.id)), error: null };
}

async function runRefresh() {
  await renameProchesLines();
  const { links, error } = await fetchBalanceLinks();
  if (error) return /balance_links/.test(error.message) ? null : error; // table pas encore créée : rien à faire
  const statementError = await syncConnectedStatements(links);
  if (statementError) return statementError;
  const currentMonth = monthKey(new Date());
  // Toutes les lignes (plus de 1 000 : lues page par page, sinon des lignes existantes passaient pour absentes et étaient recréées)
  const columns = 'id, period, statement, section, label, amount';
  const upToNow = (q: { lte: (c: string, v: string) => unknown }) => q.lte('period', currentMonth);
  let { rows, error: lineError } = await fetchAllLines<LineRow>(`${columns}, auto`, upToNow);
  // Sans la colonne "auto" (script SQL pas encore lancé) : lues sans elle
  if (lineError && /auto/i.test(lineError.message)) ({ rows, error: lineError } = await fetchAllLines<LineRow>(columns, upToNow));
  if (lineError) return lineError;
  const deduped = await removeDuplicateLines(rows);
  if (deduped.error) return deduped.error;
  const lines = deduped.lines;
  const opened = new Set(lines.map((r) => r.period));

  // Montant voulu pour chaque ligne reliée, mois par mois
  const wanted = new Map<string, { period: string; section: string; label: string; amount: number }>();
  // Opérations de chaque liaison, lues toutes en même temps
  const fetched = await Promise.all(
    links.map(async (link) => {
      const categories = [...new Set([...linkCategories(link.targets), ...linkCategories(link.decreases)])];
      if (!categories.length) return { data: [], error: null };
      const query = supabase.from('bank_transactions').select('date, amount, category').in('category', categories);
      return link.opening_month ? query.gt('date', lastDayOf(link.opening_month)) : query;
    })
  );
  for (const [i, link] of links.entries()) {
    const { data, error: txError } = fetched[i];
    if (txError) return txError;
    const transactions = ((data as Transaction[]) ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
    for (const { month, balance } of linkBalances(link, transactions, currentMonth, links)) {
      if (!opened.has(month)) continue;
      const key = keyOf(month, link.section, link.label);
      const prev = wanted.get(key);
      wanted.set(key, { period: month, section: link.section, label: link.label, amount: round((prev?.amount ?? 0) + balance) });
    }
  }

  // Plus de report automatique de « Dette » sur « Créance » : l'équilibre du bilan passe uniquement par les
  // rééquilibrages choisis dans les connecteurs (sinon le montant était compté deux fois à l'actif)

  // Lignes de ces rubriques qui ne viennent plus d'aucune liaison (déliée, renommée, mois avant le nouveau mois de départ…) :
  // le bilan ne se modifie pas à la main, leurs montants ne peuvent venir que d'une liaison. Les lignes du modèle
  // (Crédit immobilier, Découvert…) restent, remises à zéro, pour garder la forme du tableau ; les autres sont retirées.
  const isTemplate = (section: string, label: string) =>
    !!LINKABLE_SECTIONS.find((s) => s.id === section)?.template.some((t) => t.toLowerCase() === label.trim().toLowerCase());
  // Tout est comparé en mémoire aux lignes déjà lues : seules les lignes qui changent vraiment sont écrites, et en
  // quelques requêtes groupées (avant : une lecture du mois et une écriture par ligne et par mois, l'une après l'autre)
  const existing = new Map(lines.map((l) => [keyOf(l.period, l.section, l.label), l]));
  const toDelete: string[] = [];
  const toZero: string[] = [];
  for (const line of lines) {
    if (!isLinkableSection(line.section) || wanted.has(keyOf(line.period, line.section, line.label))) continue;
    if (!isTemplate(line.section, line.label)) toDelete.push(line.id);
    else if (Number(line.amount) !== 0) toZero.push(line.id);
  }
  // Lignes à ajouter : celles du modèle absentes d'un mois déjà ouvert (retirées, ou renommées dans le modèle), à zéro,
  // et les lignes reliées pas encore inscrites ce mois-là, avec leur montant
  type NewLine = { period: string; statement: string; section: string; label: string; amount: number; position: number; auto?: boolean };
  const toInsert = new Map<string, NewLine>();
  for (const period of opened) {
    for (const section of LINKABLE_SECTIONS) {
      for (const [position, label] of section.template.entries()) {
        const key = keyOf(period, section.id, label);
        if (!existing.has(key)) toInsert.set(key, { period, statement: section.statement, section: section.id, label, amount: 0, position });
      }
    }
  }
  // Montants à changer, regroupés par montant (une seule requête pour toutes les lignes qui prennent le même montant)
  const toUpdate = new Map<number, string[]>();
  for (const [key, { period, section, label, amount }] of wanted) {
    const line = existing.get(key);
    if (line) {
      // (auto indéfini : colonne absente, on ne peut pas le savoir, seul le montant compte)
      if (Number(line.amount) === amount && line.auto !== false && line.auto !== null) continue;
      toUpdate.set(amount, [...(toUpdate.get(amount) ?? []), line.id]);
    } else {
      const statement = SECTIONS.find((s) => s.id === section)!.statement;
      toInsert.set(key, { ...(toInsert.get(key) ?? { period, statement, section, label, position: 100 }), amount, auto: true });
    }
  }

  const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100));
  const firstError = (results: { error: { message: string } | null }[]) => results.find((r) => r.error)?.error ?? null;
  let err = firstError(await Promise.all(chunks(toDelete).map((ids) => supabase.from('finance_lines').delete().in('id', ids))));
  if (err) return err;
  err = await writeAmounts([[0, toZero], ...toUpdate], toZero);
  if (err) return err;
  if (toInsert.size) {
    const rowsToAdd = [...toInsert.values()];
    let { error } = await supabase.from('finance_lines').insert(rowsToAdd);
    // Sans la colonne "auto" : ajoutées sans elle
    if (error && /auto/i.test(error.message)) ({ error } = await supabase.from('finance_lines').insert(rowsToAdd.map(({ auto: _a, ...r }) => (void _a, r))));
    if (error) return error;
  }
  return null;
}

// Écrit des montants sur des lignes, groupées par montant ("zeroed" : lignes remises à zéro, qui ne sont plus
// « calculées » ; les autres le sont), plusieurs requêtes à la fois
async function writeAmounts(groups: [number, string[]][], zeroed: string[]) {
  const zero = new Set(zeroed);
  const jobs: (() => PromiseLike<{ error: { message: string } | null }>)[] = [];
  for (const [amount, ids] of groups) {
    for (const auto of [true, false]) {
      const part = ids.filter((id) => zero.has(id) !== auto);
      for (let i = 0; i < part.length; i += 100) {
        const slice = part.slice(i, i + 100);
        jobs.push(async () => {
          const res = await supabase.from('finance_lines').update({ amount, auto }).in('id', slice);
          // Sans la colonne "auto" : le montant seul
          return res.error && /auto/i.test(res.error.message) ? supabase.from('finance_lines').update({ amount }).in('id', slice) : res;
        });
      }
    }
  }
  for (let i = 0; i < jobs.length; i += 8) {
    const results = await Promise.all(jobs.slice(i, i + 8).map((job) => job()));
    const err = results.find((r) => r.error)?.error;
    if (err) return err;
  }
  return null;
}
