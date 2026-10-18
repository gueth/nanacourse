// "use client" indique à Next.js que ce composant s'exécute dans le navigateur
// (côté client). C'est obligatoire ici car on utilise des hooks React
// (useState, useEffect) et des événements (clics, saisie), qui n'existent pas côté serveur.
'use client';

// useState : stocker des valeurs qui, quand elles changent, redessinent la page.
// useEffect : lancer du code après l'affichage du composant (ici : charger les données).
import { useEffect, useState } from 'react';
// Link : le composant de Next.js pour naviguer entre les pages sans recharger tout le site.
import Link from 'next/link';
// Le client Supabase configuré dans lib/supabase.ts, qui permet de lire/écrire dans la base de données.
import { supabase } from '@/lib/supabase';
// Budget de la période : ce qui reste à dépenser, dépassement, enregistrement des courses validées
import { fetchBudget, isOverBudget, recordExpense, shortDate, type BudgetState } from '@/lib/budget';
import { storeLabel } from '@/lib/stores';
// Famille d'un ingrédient (ex : toutes les sortes d'œufs), pour les regrouper sous une bannière
import { familyKey } from '@/lib/ingredients';
import FamilyList from '@/components/FamilyList';
// Cadre affiché au-dessus de la page, et formulaire d'ajout d'un article à la liste
import Modal from '@/components/Modal';
import AddToListForm from '@/components/AddToListForm';
import EditListItemForm from '@/components/EditListItemForm';
// Cadre de confirmation avant suppression
import { useConfirm } from '@/components/ConfirmDialog';
// Total d'une liste et suppression d'une liste avec ses articles (partagés avec les paramètres)
import { saveListTotal } from '@/lib/lists';
import { deleteList as deleteListCascade } from '@/lib/deletions';
// Analyse d'une liste : meilleure boutique + comparaison avec l'inventaire
import { analyzeList, summarizeTotal, type ListAnalysis, type TotalSummary } from '@/lib/optimize';
// Icône poubelle pour supprimer un article de la liste
// (Check / X : boutons ✓ / ✗ pour appliquer ou ignorer l'optimisation d'un article orange)
import { Check, PowerOff, Trash2, X } from 'lucide-react';
// Quantités possibles selon le type d'ingrédient (kg, pièce, paquet...)
import { formatQuantity, normalizeQuantity, quantityRule } from '@/lib/quantity';

// Colonnes d'une ligne d'article : case "acheté" | article | quantité | prix | suppression
const ITEM_COLUMNS = 'grid grid-cols-[1.25rem_minmax(0,1fr)_7.5rem_6.5rem_1.75rem] items-center gap-x-3';

// Le budget (somme à ne pas dépasser, marge si des prix manquent, durée de la période)
// se règle dans Paramètres > Budget : voir lib/budget.ts.

// Liens affichés dans la colonne de droite, sous le bouton "+ Ajouter un ingrédient".
// Chaque élément contient :
//  - href  : l'adresse de la page vers laquelle on va
//  - title : le texte du bouton
//  - desc  : une petite description sous le titre
const actions = [
  { href: '/inventory', title: 'Inventaire', desc: "Ce qu'il te reste à la maison." },
  { href: '/settings', title: 'Paramètres', desc: 'Catégories, marques et ingrédients.' }
];

// ---------------------------------------------------------------------------
// TYPES TypeScript : ils décrivent la "forme" des données reçues de Supabase.
// Ça permet à l'éditeur de prévenir si on se trompe de nom de champ.
// ---------------------------------------------------------------------------

// Un article (une ligne) d'une liste de courses enregistrée.
type SavedItem = {
  id: string; // identifiant unique de la ligne dans "shopping_list_items"
  ingredient_id: string; // identifiant de l'ingrédient concerné
  quantity: number; // quantité à acheter
  expected_price: number | null; // prix estimé de la ligne (0 ou null = prix pas encore connu)
  // L'ingrédient lié (récupéré grâce à la jointure Supabase), avec sa catégorie.
  // "| null" : la valeur peut être absente (ex : ingrédient supprimé entre-temps).
  ingredient: {
    name: string;
    type: string | null; // kg, pièce, paquet... : fixe les quantités possibles
    brand: { name: string } | null;
    category: { id: string; name: string } | null;
  } | null;
};

// Une liste de courses enregistrée, avec tous ses articles.
type SavedList = {
  id: string; // identifiant unique de la liste
  name: string; // nom de la liste (affiché en titre de la carte)
  estimated_price: number; // total estimé calculé à la création de la liste
  items: SavedItem[]; // tous les articles de cette liste
};

// Requête de la liste de courses ACTIVE (on l'active dans Paramètres > Listes de courses), avec :
//   items      -> les lignes de "shopping_list_items" liées à la liste
//   ingredient -> pour chaque ligne, l'ingrédient (nom, type, marque)
//   category   -> pour chaque ingrédient, sa catégorie (id + nom)
// Tri par id décroissant : les listes les plus récentes en premier.
function fetchActiveLists() {
  return supabase
    .from('shopping_lists')
    .select('*, items:shopping_list_items(*, ingredient:ingredients(name, type, brand:brands(name), category:categories(id, name)))')
    .eq('is_active', true)
    .order('id', { ascending: false });
}

// ---------------------------------------------------------------------------
// COMPOSANT PRINCIPAL : la page /course
// "export default" rend ce composant utilisable par Next.js comme page.
// ---------------------------------------------------------------------------
export default function CoursePage() {
  // ----- ÉTATS (STATE) -----
  // Chaque useState renvoie [valeurActuelle, fonctionPourLaModifier].

  // Toutes les listes de courses en attente, chargées depuis Supabase.
  const [lists, setLists] = useState<SavedList[]>([]);
  // true tant que les données ne sont pas encore arrivées.
  const [loading, setLoading] = useState(true);
  // Prix réels saisis par l'utilisateur, rangés par id d'article.
  // Exemple : { "abc123": "2.49" }. On garde du texte (string) car c'est ce que renvoie un <input>.
  const [realPrices, setRealPrices] = useState<Record<string, string>>({});
  // Quantités en cours de saisie, rangées par id d'article (enregistrées quand on quitte le champ).
  const [draftQty, setDraftQty] = useState<Record<string, string>>({});
  // Articles cochés comme "achetés", rangés par id d'article.
  // Exemple : { "abc123": true, "def456": false }
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  // id de la liste en cours de validation (pour désactiver son bouton pendant le traitement),
  // ou null si aucune validation n'est en cours.
  const [validating, setValidating] = useState<string | null>(null);
  // true quand le cadre "ajouter un ingrédient à la liste" est ouvert.
  const [addOpen, setAddOpen] = useState(false);
  // Article dont le cadre de modification est ouvert (clic sur son nom), avec sa liste ; null = fermé.
  const [editing, setEditing] = useState<{ list: SavedList; item: SavedItem } | null>(null);
  // Résultat du bouton "Optimiser", rangé par id de liste (absent = pas encore optimisée).
  const [analyses, setAnalyses] = useState<Record<string, ListAnalysis>>({});
  // Budget de la période en cours (réglages + ce qui reste), null tant qu'il n'est pas chargé.
  const [budget, setBudget] = useState<BudgetState | null>(null);
  // id de la liste en cours d'optimisation (pour désactiver son bouton pendant le calcul).
  const [optimizing, setOptimizing] = useState<string | null>(null);
  // Articles dont l'optimisation a été refusée (✗), par liste : ils ne sont plus réoptimisés.
  const [rejected, setRejected] = useState<Record<string, Record<string, boolean>>>({});
  // Listes déjà optimisées et non modifiées depuis : leur bouton "Optimiser" est désactivé
  // (il se réactive dès qu'on change un article de la liste).
  const [optimized, setOptimized] = useState<Record<string, boolean>>({});
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Un article de la liste a changé (ou la liste elle-même) :
  //  - on autorise une nouvelle optimisation ;
  //  - on efface le résultat d'optimisation de cet article, devenu faux (couleur, quantité proposée).
  function markModified(listId: string, itemId?: string) {
    setOptimized((o) => ({ ...o, [listId]: false }));
    if (itemId) clearSuggestion(listId, itemId);
  }

  // Coche / décoche un article.
  // On crée un NOUVEL objet (avec ...c) au lieu de modifier l'ancien :
  // React ne détecte un changement que si la référence de l'objet change.
  // [itemId]: !c[itemId] inverse la valeur actuelle (true -> false, false/undefined -> true).
  function toggleChecked(itemId: string) {
    setCheckedItems((c) => ({ ...c, [itemId]: !c[itemId] }));
  }

  // Charge (ou recharge) la liste de courses active depuis Supabase (une seule liste active à la fois).
  // Utilisée après une validation pour rafraîchir l'affichage.
  async function loadLists() {
    const { data, error } = await fetchActiveLists();
    // En cas d'erreur on l'affiche dans la console du navigateur (F12).
    if (error) console.error(error);
    // On enregistre les données reçues (ou un tableau vide si rien n'est revenu).
    // "as unknown as SavedList[]" force TypeScript à considérer les données comme nos types.
    setLists((data as unknown as SavedList[]) ?? []);
    // Le chargement est terminé.
    setLoading(false);
  }

  // Premier chargement des listes, exécuté UNE seule fois à l'ouverture de la page
  // (grâce au tableau de dépendances vide [] à la fin).
  // C'est la même requête que loadLists(), écrite avec .then() au lieu de async/await,
  // car la fonction passée à useEffect ne peut pas être directement "async".
  useEffect(() => {
    fetchActiveLists().then(({ data, error }) => {
      if (error) console.error(error);
      setLists((data as unknown as SavedList[]) ?? []);
      setLoading(false);
    });
    // Budget de la période en cours (réglé dans Paramètres > Budget)
    fetchBudget().then(setBudget);
  }, []);

  // Regroupe les articles d'une liste par catégorie, pour les afficher par rayon.
  // Retourne un tableau de groupes : [{ name: 'Fruits', items: [...] }, ...]
  function groupByCategory(items: SavedItem[]) {
    // Une Map associe une clé (id de catégorie) à un groupe { name, items }.
    // Elle conserve l'ordre d'insertion, donc l'ordre d'apparition des catégories.
    const groups = new Map<string, { name: string; items: SavedItem[] }>();
    for (const item of items) {
      // "?." évite une erreur si ingredient ou category est null ;
      // "??" fournit une valeur par défaut dans ce cas.
      const key = item.ingredient?.category?.id ?? 'none';
      const name = item.ingredient?.category?.name ?? 'Sans catégorie';
      // Si le groupe n'existe pas encore, on le crée vide.
      if (!groups.has(key)) groups.set(key, { name, items: [] });
      // On ajoute l'article dans son groupe ("!" dit à TypeScript que le groupe existe forcément).
      groups.get(key)!.items.push(item);
    }
    // On transforme la Map en simple tableau pour pouvoir faire .map() dans le JSX.
    return Array.from(groups.values());
  }

  // Prix estimé d'un article, ou null s'il n'est pas encore connu (0 = pas de prix).
  function expectedPriceFor(item: SavedItem) {
    return item.expected_price ? item.expected_price : null;
  }

  // Donne le prix d'un article :
  // le prix en cours de saisie s'il y en a un, sinon le prix enregistré (ou null si inconnu).
  function realPriceFor(item: SavedItem) {
    const raw = realPrices[item.id];
    // Number(raw) convertit le texte saisi ("2.49") en nombre (2.49).
    if (raw) return Number(raw);
    // Quantité en cours de saisie : le prix suit au prorata (prix unitaire × nouvelle quantité)
    const qty = Number((draftQty[item.id] ?? '').replace(',', '.'));
    if (draftQty[item.id] && qty > 0 && item.expected_price) return (item.expected_price / item.quantity) * qty;
    return expectedPriceFor(item);
  }

  // ENREGISTREMENT DE LA QUANTITÉ d'un article quand on quitte le champ.
  // La quantité est ramenée sur une valeur possible pour son type (ex : entier pour une pièce),
  // et le prix de la ligne est recalculé au prorata (prix unitaire × nouvelle quantité).
  async function saveQuantity(list: SavedList, item: SavedItem) {
    const raw = draftQty[item.id];
    if (raw === undefined) return; // rien n'a été tapé
    const rule = quantityRule(item.ingredient?.type);
    const qty = normalizeQuantity(Number(raw.replace(',', '.')), rule);
    if (qty !== item.quantity) {
      const newPrice = item.expected_price ? (item.expected_price / item.quantity) * qty : item.expected_price;
      const { error } = await supabase
        .from('shopping_list_items')
        .update({ quantity: qty, expected_price: newPrice })
        .eq('id', item.id);
      if (error) return console.error(error);
      await saveListTotal(
        list.id,
        list.items.map((i) => (i.id === item.id ? { ...i, expected_price: newPrice } : i))
      );
      markModified(list.id, item.id);
      await loadLists();
    }
    // La quantité saisie est maintenant celle enregistrée : on vide la saisie en cours
    setDraftQty((d) => {
      const next = { ...d };
      delete next[item.id];
      return next;
    });
  }

  // Texte d'un total, selon le nombre de prix connus (voir summarizeTotal dans lib/optimize.ts)
  function totalText(label: string, summary: TotalSummary) {
    if (summary.kind === 'full') return `${label} : ${summary.total.toFixed(2)} €`;
    if (summary.kind === 'min') return `${label} supérieur à ${summary.total.toFixed(2)} €`;
    return `${label} : prix indisponibles`;
  }

  // ENREGISTREMENT DU PRIX d'un article quand on quitte le champ (champ vide = prix inconnu)
  async function savePrice(list: SavedList, item: SavedItem) {
    const raw = realPrices[item.id];
    if (raw === undefined) return; // rien n'a été tapé
    const price = raw ? Number(raw) : 0;
    if (price !== (item.expected_price ?? 0)) {
      const { error } = await supabase.from('shopping_list_items').update({ expected_price: price }).eq('id', item.id);
      if (error) return console.error(error);
      await saveListTotal(
        list.id,
        list.items.map((i) => (i.id === item.id ? { ...i, expected_price: price } : i))
      );
      // Le prix change l'économie calculée, mais pas la couleur de l'article
      markModified(list.id);
      await loadLists();
    }
    // Le prix saisi est maintenant celui enregistré : on vide la saisie en cours
    setRealPrices((r) => {
      const next = { ...r };
      delete next[item.id];
      return next;
    });
  }

  // Retire la suggestion "orange" d'un article (après ✓ ou ✗)
  function clearSuggestion(listId: string, itemId: string) {
    setAnalyses((a) => {
      const current = a[listId];
      if (!current) return a;
      const status = { ...current.status };
      const newQuantities = { ...current.newQuantities };
      delete status[itemId];
      delete newQuantities[itemId];
      return { ...a, [listId]: { ...current, status, newQuantities } };
    });
  }

  // ✗ : refuse l'optimisation d'un article orange (il ne sera plus réoptimisé)
  function rejectSuggestion(listId: string, itemId: string) {
    setRejected((r) => ({ ...r, [listId]: { ...r[listId], [itemId]: true } }));
    clearSuggestion(listId, itemId);
  }

  // ✓ : applique l'optimisation sur un article orange (quantité divisée par deux, prix au prorata)
  async function applySuggestion(list: SavedList, item: SavedItem, newQty: number) {
    const newPrice = item.expected_price ? (item.expected_price / item.quantity) * newQty : item.expected_price;
    const { error } = await supabase
      .from('shopping_list_items')
      .update({ quantity: newQty, expected_price: newPrice })
      .eq('id', item.id);
    if (error) return console.error(error);
    await saveListTotal(
      list.id,
      list.items.map((i) => (i.id === item.id ? { ...i, expected_price: newPrice } : i))
    );
    markModified(list.id, item.id);
    loadLists();
  }

  // SUPPRESSION D'UN ARTICLE de la liste, puis mise à jour du total
  async function deleteItem(list: SavedList, item: SavedItem) {
    const { error } = await supabase.from('shopping_list_items').delete().eq('id', item.id);
    if (error) return console.error(error);
    await saveListTotal(
      list.id,
      list.items.filter((i) => i.id !== item.id)
    );
    markModified(list.id, item.id);
    loadLists();
  }

  // OPTIMISATION :
  //  - indique la meilleure boutique et l'économie totale possible ;
  //  - colore en rouge les articles déjà assez en stock (l'utilisateur les supprime s'il veut) ;
  //  - colore aussi en rouge les autres articles d'une même famille : seul le premier est gardé ;
  //  - colore en orange ceux en partie en stock, avec ✓ / ✗ pour diviser ou non leur quantité par deux.
  // Lors d'une nouvelle optimisation, seuls les articles validés (✓) ou jamais modifiés sont réanalysés :
  //  - les articles orange encore en attente d'un choix gardent leur statut tel quel ;
  //  - les articles refusés (✗) ne sont plus optimisés.
  async function optimizeList(list: SavedList) {
    setOptimizing(list.id);
    const ingredientIds = list.items.map((i) => i.ingredient_id);

    // On charge en parallèle : les prix des ingrédients de la liste, les magasins et l'inventaire
    const [{ data: prices }, { data: stores }, { data: inv }] = await Promise.all([
      supabase.from('ingredient_prices').select('ingredient_id, store_id, price, available').in('ingredient_id', ingredientIds),
      supabase.from('stores').select('*'),
      supabase.from('inventory').select('ingredient_id, quantity')
    ]);

    // Dictionnaire ingredient_id -> quantité en stock à la maison
    const stock: Record<string, number> = {};
    for (const row of inv ?? []) stock[row.ingredient_id] = row.quantity;

    // Articles figés : en attente d'un choix (on garde leur statut) ou refusés (aucun statut)
    const previous = analyses[list.id];
    const overrides: Record<string, { status?: 'remove' | 'reduce'; newQty?: number }> = {};
    for (const item of list.items) {
      if (rejected[list.id]?.[item.id]) overrides[item.id] = {};
      else if (previous?.status[item.id] === 'reduce' && previous.newQuantities[item.id] != null) {
        overrides[item.id] = { status: 'reduce', newQty: previous.newQuantities[item.id] };
      }
    }

    const analysis = analyzeList(
      list.items.map((i) => ({
        id: i.id,
        ingredientId: i.ingredient_id,
        quantity: i.quantity,
        expectedPrice: expectedPriceFor(i),
        type: i.ingredient?.type,
        family: i.ingredient ? familyKey(i.ingredient.name) || undefined : undefined
      })),
      prices ?? [],
      stores ?? [],
      stock,
      overrides
    );

    setAnalyses((a) => ({ ...a, [list.id]: analysis }));
    setOptimized((o) => ({ ...o, [list.id]: true }));
    setOptimizing(null);
  }

  // DÉSACTIVATION : la liste est conservée (on peut la réactiver dans les paramètres) mais quitte la page
  async function deactivateList(list: SavedList) {
    const { error } = await supabase.from('shopping_lists').update({ is_active: false }).eq('id', list.id);
    if (error) return console.error(error);
    loadLists();
  }

  // SUPPRESSION de la liste et de ses articles, après confirmation
  async function deleteList(list: SavedList) {
    if (!(await confirm('Supprimer la liste', `Supprimer la liste « ${list.name} » et ses ${list.items.length} article(s) ?`))) return;
    const error = await deleteListCascade(list.id);
    if (error) return console.error(error);
    loadLists();
  }

  // VALIDATION : les ingrédients rejoignent l'inventaire, la liste disparaît
  // Étapes :
  //  1. on garde uniquement les articles cochés (achetés)
  //  2. on lit l'inventaire actuel pour connaître les quantités déjà présentes
  //  3. on ajoute les quantités achetées dans l'inventaire
  //  4. on déduit le prix de la course du budget de la période (Paramètres > Budget)
  //  5. on supprime la liste et ses articles
  //  6. on recharge l'affichage et le budget restant
  async function validateList(list: SavedList) {
    // On mémorise quelle liste est en cours de validation (désactive son bouton).
    setValidating(list.id);

    // 1. Seuls les articles cochés sont considérés comme achetés.
    const boughtItems = list.items.filter((item) => checkedItems[item.id]);

    // 2. Lecture du stock actuel des ingrédients achetés (id de l'ingrédient + quantité en stock).
    const boughtIds = Array.from(new Set(boughtItems.map((item) => item.ingredient_id)));
    const { data: inv, error: invError } = await supabase
      .from('inventory')
      .select('ingredient_id, quantity')
      .in('ingredient_id', boughtIds);
    if (invError) {
      console.error(invError);
      return setValidating(null);
    }

    // 3. Nouveau stock de chaque ingrédient : stock actuel + toutes les quantités achetées.
    // Un même ingrédient peut être sur plusieurs lignes : on additionne toutes ses lignes.
    const newStock = new Map<string, number>();
    for (const row of inv ?? []) newStock.set(row.ingredient_id, row.quantity);
    for (const item of boughtItems) {
      const total = (newStock.get(item.ingredient_id) ?? 0) + item.quantity;
      newStock.set(item.ingredient_id, Math.round(total * 1000) / 1000); // évite 0.30000000000000004
    }

    // Une seule requête pour tout l'inventaire. "upsert" = update + insert :
    //  - si une ligne existe déjà pour cet ingrédient, elle est mise à jour
    //  - sinon, une nouvelle ligne est créée
    if (boughtIds.length > 0) {
      const updatedAt = new Date().toISOString();
      const { error } = await supabase.from('inventory').upsert(
        boughtIds.map((ingredientId) => ({
          ingredient_id: ingredientId,
          quantity: newStock.get(ingredientId)!,
          low_stock: false, // on vient d'en acheter, donc plus en stock faible
          updated_at: updatedAt
        })),
        // La colonne qui sert à savoir si la ligne existe déjà.
        { onConflict: 'ingredient_id' }
      );
      // En cas d'échec, on garde la liste pour ne rien perdre
      if (error) {
        console.error(error);
        return setValidating(null);
      }
    }

    // 4. Le prix de la course (articles achetés) est déduit du budget de la période en cours
    const spent = boughtItems.reduce((sum, item) => sum + (realPriceFor(item) ?? 0), 0);
    if (spent > 0) await recordExpense(spent, list.name);

    // 5. Suppression : d'abord les articles de la liste, puis la liste elle-même
    // (dans cet ordre, pour ne pas laisser d'articles "orphelins" rattachés à une liste inexistante).
    await supabase.from('shopping_list_items').delete().eq('shopping_list_id', list.id);
    const { error: deleteError } = await supabase.from('shopping_lists').delete().eq('id', list.id);
    if (deleteError) console.error(deleteError);

    // 6. Fin de la validation : on réactive les boutons, on recharge les listes et le budget restant.
    setValidating(null);
    loadLists();
    fetchBudget().then(setBudget);
  }

  // Une ligne d'article de la liste (case "acheté", nom, optimisation, prix, suppression)
  function renderItem(list: SavedList, item: SavedItem) {
    // Couleur donnée par l'optimisation : rouge = déjà en stock ou doublon de sa famille, orange = quantité à réduire
    const status = analyses[list.id]?.status[item.id];
    // Quantité proposée pour un article orange (absente si on ne peut pas diviser par deux)
    const suggestedQty = analyses[list.id]?.newQuantities[item.id];
    const statusColor =
      status === 'remove' ? 'text-red-600' : status === 'reduce' ? 'text-orange-500' : '';
    // Quantités possibles pour ce type d'ingrédient (ex : 0,1 kg en 0,1 kg, ou pièces entières)
    const rule = quantityRule(item.ingredient?.type);
    const checked = !!checkedItems[item.id];
    return (
      <li key={item.id} className={`${ITEM_COLUMNS} py-1 text-sm ${statusColor}`}>
        {/* Colonne 1 — case à cocher "acheté".
            "!!" transforme undefined en false pour avoir toujours un booléen. */}
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleChecked(item.id)}
          className="w-4 h-4 accent-brick"
          title="Acheté"
        />
        {/* Colonne 2 — article : nom, marque, et ✓ / ✗ pour un article orange.
            Si l'article est coché, le texte est barré et grisé. */}
        <span className="min-w-0 flex flex-wrap items-center gap-x-2">
          {/* Clic sur le nom : ouvre le cadre de modification de l'article */}
          <button
            type="button"
            onClick={() => item.ingredient && setEditing({ list, item })}
            disabled={!item.ingredient}
            title="Modifier cet article"
            className={`truncate text-left hover:underline decoration-dotted underline-offset-2 ${checked ? 'line-through opacity-50' : ''}`}
          >
            {item.ingredient?.name ?? 'Ingrédient supprimé'}
            {/* Marque de l'ingrédient, si elle est renseignée */}
            {item.ingredient?.brand && <span className="opacity-60"> — {item.ingredient.brand.name}</span>}
          </button>
        {/* ✓ / ✗ pour un article orange : diviser sa quantité par deux, ou non */}
        {status === 'reduce' && suggestedQty != null && (
          <span className="flex items-center gap-1">
            <span className="font-bold">
              → {formatQuantity(suggestedQty)} {rule.unit}
            </span>
            <button
              onClick={() => applySuggestion(list, item, suggestedQty)}
              aria-label="Appliquer l'optimisation"
              title="Appliquer"
              className="p-1 rounded border-2 border-current hover:bg-orange-100"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => rejectSuggestion(list.id, item.id)}
              aria-label="Ignorer l'optimisation"
              title="Ignorer"
              className="p-1 rounded border-2 border-current hover:bg-orange-100"
            >
              <X size={14} />
            </button>
          </span>
        )}
        </span>
        {/* Colonne 3 — quantité, modifiable. Le pas et le minimum dépendent du type
            (0,1 kg pour le vrac, 1 pour une pièce ou un paquet). Le prix suit au prorata
            pendant la saisie ; la quantité est arrondie et enregistrée quand on quitte le champ. */}
        <span className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            step={rule.step}
            min={rule.min}
            value={draftQty[item.id] ?? String(item.quantity)}
            onChange={(e) => setDraftQty((d) => ({ ...d, [item.id]: e.target.value }))}
            onBlur={() => saveQuantity(list, item)}
            className="input-hand w-16 text-right"
            title={`Quantité (${rule.unit})`}
          />
          <span className="opacity-60 truncate">{rule.unit}</span>
        </span>
        {/* Colonne 4 — prix de la ligne, directement modifiable pour mettre le prix réel.
            Le total se met à jour pendant la saisie, et le prix est enregistré
            quand on quitte le champ. Vide = prix inconnu. */}
        <span className="flex items-center gap-1">
          <input
            type="number"
            step="0.01"
            placeholder="prix ?"
            value={
              realPrices[item.id] ??
              (draftQty[item.id] ? (realPriceFor(item)?.toFixed(2) ?? '') : item.expected_price ? item.expected_price.toFixed(2) : '')
            }
            onChange={(e) => setRealPrices((r) => ({ ...r, [item.id]: e.target.value }))}
            onBlur={() => savePrice(list, item)}
            className="input-hand w-20 text-right"
            title="Prix (modifiable)"
          />
          <span>€</span>
        </span>
        {/* Colonne 5 — suppression de l'article (le total est mis à jour) */}
        <button
          onClick={() => deleteItem(list, item)}
          aria-label="Supprimer cet article"
          title="Supprimer"
          className="p-1 opacity-60 hover:opacity-100 hover:text-brick"
        >
          <Trash2 size={16} />
        </button>
      </li>
    );
  }

  // ---------------------------------------------------------------------------
  // AFFICHAGE (JSX) : ce qui est réellement dessiné à l'écran.
  // Les classes (title-hand, card, tape, btn-hand...) sont des styles Tailwind / CSS du projet.
  // ---------------------------------------------------------------------------
  return (
    <div>
      {/* Cadre de confirmation des suppressions */}
      {confirmDialog}
      {/* En-tête de la page */}
      <h1 className="title-hand text-3xl mb-1">Mieux gérer son budget,</h1>
      <h1 className="title-hand text-3xl mb-2">et tout sela en une course.</h1>
      <p className="mb-5 opacity-70">Proposition de course.</p>

      {/* Mise en page en deux colonnes sur écran large (lg:) :
          à gauche la proposition de liste (2/3), à droite les boutons (1/3).
          Sur mobile, les deux blocs s'empilent l'un sous l'autre. */}
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* ----- COLONNE DE GAUCHE : proposition de liste de courses ----- */}
        {/* Un seul cadre simple ("card-plain" = sans le zigzag du bas), avec le scotch en haut */}
        <div className="lg:col-span-2 card card-plain">
          {/* Petit morceau de "scotch" décoratif en haut du cadre */}
          <span className="tape" />

          {/* Pendant le chargement */}
          {loading && <p className="opacity-70">Chargement...</p>}

          {/* Aucune liste active : on le précise et on renvoie vers la gestion des listes */}
          {!loading && lists.length === 0 && (
            <div>
              <p className="title-hand text-2xl mb-1">Aucune liste active</p>
              <p className="mb-3 opacity-70">Active une de tes listes, ou crées-en une, dans les paramètres.</p>
              <Link href="/settings?tab=lists" className="btn-hand inline-block">
                Gérer mes listes
              </Link>
            </div>
          )}

          {/* Une section par liste de courses, séparées par un trait pointillé.
              "key" aide React à identifier chaque élément. */}
          {lists.map((list, i) => {
            // Total de la liste (somme des prix connus) et dépassement de budget :
            // plus que ce qui reste sur la période, ou plus que (reste - marge) si des articles n'ont pas de prix.
            // Dans ce cas, "Optimiser" passe en rouge et "Valider cette liste" est désactivé.
            const prices = list.items.map(realPriceFor);
            const summary = summarizeTotal(prices);
            const hasMissingPrice = prices.some((p) => p == null);
            const overBudget = budget ? isOverBudget(summary.total, hasMissingPrice, budget) : false;
            return (
            <div key={list.id} className={i > 0 ? 'mt-6 pt-6 border-t-2 border-dashed border-line' : ''}>
              {/* Libellé de la liste, avec les icônes d'action en haut à droite, sur la même ligne */}
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="title-hand text-2xl">{list.name}</p>
                <span className="flex items-center gap-1 shrink-0">
                  {/* Désactiver : la liste est gardée (dans Paramètres > Listes de courses) mais quitte cette page */}
                  <button
                    onClick={() => deactivateList(list)}
                    aria-label="Désactiver la liste"
                    title="Désactiver la liste"
                    className="p-1.5 opacity-60 hover:opacity-100"
                  >
                    <PowerOff size={18} />
                  </button>
                  {/* Supprimer : la liste et tous ses articles, après confirmation */}
                  <button
                    onClick={() => deleteList(list)}
                    aria-label="Supprimer la liste"
                    title="Supprimer la liste"
                    className="p-1.5 opacity-60 hover:opacity-100 hover:text-brick"
                  >
                    <Trash2 size={18} />
                  </button>
                </span>
              </div>

              {/* En-tête des colonnes, aligné sur les lignes d'articles */}
              {list.items.length > 0 && (
                <div className={`${ITEM_COLUMNS} field-label pb-1 mb-2 border-b-2 border-dashed border-line`}>
                  <span />
                  <span>Article</span>
                  <span>Quantité</span>
                  <span>Prix</span>
                  <span />
                </div>
              )}

              {/* Les articles, regroupés par catégorie */}
              {groupByCategory(list.items).map((g) => (
                <div key={g.name} className="mb-3">
                  {/* Nom de la catégorie */}
                  <p className="field-label">{g.name}</p>
                  <ul className="space-y-1">
                    {/* Les variantes d'un même produit sont regroupées sous une bannière (ex : Œufs) ;
                        le premier article d'une famille est celui que l'optimisation garde */}
                    <FamilyList
                      compact
                      items={g.items}
                      nameOf={(item) => item.ingredient?.name ?? ''}
                      renderItem={(item) => renderItem(list, item)}
                    />
                  </ul>
                </div>
              ))}

              {/* Total de la liste, recalculé en direct depuis les prix des articles :
                  exact si tous les prix sont connus, "supérieur à" si au moins la moitié, sinon indisponible */}
              <div className="border-t-2 border-dashed border-line pt-2 flex flex-wrap items-baseline justify-between gap-2">
                {/* Budget encore disponible sur la période en cours, et date de sa réactivation */}
                {budget ? (
                  <span className="text-sm opacity-70">
                    Budget restant : <strong>{budget.remaining.toFixed(2)} €</strong> jusqu&apos;au{' '}
                    {shortDate(new Date(budget.period.end.getTime() - 86_400_000))}
                  </span>
                ) : (
                  <span />
                )}
                <span className={`font-bold ${overBudget ? 'text-brick' : 'text-mustard'}`}>{totalText('Total', summary)}</span>
              </div>

              {/* Boutons : "Optimiser" à gauche, avant "Valider cette liste" */}
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {/* En rouge quand le budget est dépassé, pour inviter à optimiser */}
                <button
                  onClick={() => optimizeList(list)}
                  disabled={optimizing === list.id || !!optimized[list.id]}
                  title={optimized[list.id] ? 'Déjà optimisée : modifie un article pour pouvoir réoptimiser' : undefined}
                  className={`btn-hand disabled:cursor-not-allowed ${overBudget ? 'bg-brick' : ''}`}
                >
                  {/* Après une première optimisation, le bouton propose d'aller plus loin */}
                  {optimizing === list.id ? 'Optimisation...' : analyses[list.id] ? "Plus d'optimisation" : 'Optimiser'}
                </button>
                {/* Bouton de validation : désactivé pendant le traitement, ou tant que le budget est dépassé */}
                <button
                  onClick={() => validateList(list)}
                  disabled={validating === list.id || overBudget}
                  title={overBudget ? 'Budget dépassé : optimise la liste avant de la valider' : undefined}
                  className="btn-hand disabled:cursor-not-allowed"
                >
                  {validating === list.id ? 'Validation...' : 'Valider cette liste'}
                </button>
              </div>

              {/* Résultat de l'optimisation : meilleure boutique et économie totale */}
              {analyses[list.id] && (
                <div className="mt-3 text-sm space-y-1">
                  {analyses[list.id].bestStore ? (
                    <>
                      <p>
                        Meilleure boutique : <strong>{storeLabel(analyses[list.id].bestStore!)}</strong>
                      </p>
                      <p>
                        Économie : <span className="text-herb font-bold">{analyses[list.id].savings.toFixed(2)} €</span>
                      </p>
                    </>
                  ) : (
                    <p>Aucun prix en magasin pour ces ingrédients.</p>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>

        {/* ----- COLONNE DE DROITE : boutons d'action ----- */}
        {/* "lg:sticky lg:top-6" : sur grand écran, la colonne reste visible quand on fait défiler. */}
        <div className="flex flex-col lg:sticky lg:top-6">
          {/* Ce bouton n'ouvre pas une autre page : il affiche le cadre d'ajout au-dessus de l'écran */}
          <button
            onClick={() => setAddOpen(true)}
            className="card block text-left hover:-translate-y-0.5 transition-transform"
          >
            <span className="tape" />
            <p className="title-hand text-2xl mb-1">+ Ajouter un ingrédient</p>
            <p className="text-sm opacity-70">À ta liste de courses en cours.</p>
          </button>
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className="card block hover:-translate-y-0.5 transition-transform">
              <span className="tape" />
              <p className="title-hand text-2xl mb-1">{a.title}</p>
              <p className="text-sm opacity-70">{a.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* CADRE D'AJOUT : affiché au-dessus de la page quand addOpen vaut true.
          Après l'ajout, on ferme le cadre et on recharge les listes pour voir le nouvel article. */}
      {addOpen && (
        <Modal title="Ajouter à la liste" onClose={() => setAddOpen(false)}>
          <AddToListForm
            lists={lists}
            onAdded={() => {
              setAddOpen(false);
              // Un article a été ajouté : les listes peuvent être réoptimisées
              setOptimized({});
              loadLists();
            }}
          />
        </Modal>
      )}

      {/* CADRE DE MODIFICATION d'un article : ouvert par un clic sur son nom.
          Après l'enregistrement, on recalcule le total de la liste et on recharge l'affichage. */}
      {editing && (
        <Modal title="Modifier l'article" onClose={() => setEditing(null)}>
          <EditListItemForm
            item={editing.item}
            onSaved={async (lineTotal) => {
              const { list, item } = editing;
              setEditing(null);
              await saveListTotal(
                list.id,
                list.items.map((i) => (i.id === item.id ? { ...i, expected_price: lineTotal } : i))
              );
              markModified(list.id, item.id);
              loadLists();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
