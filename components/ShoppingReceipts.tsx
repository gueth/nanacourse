'use client';

// Liste de courses active, présentée comme un ticket de caisse, avec toutes ses fonctionnalités
// (cocher, modifier quantités et prix, optimiser, choisir le magasin, valider, ajouter, supprimer...).
// Imprimée depuis l'accueil (ReceiptPrinter) ; "blue" teinte son encre en bleu (le ticket reste blanc)
// et donne aux cadres (popins) le style de la gazette.

// useState : stocker des valeurs qui, quand elles changent, redessinent la page.
// useEffect : lancer du code après l'affichage du composant (ici : charger les données).
import { useEffect, useRef, useState } from 'react';
// Link : le composant de Next.js pour naviguer entre les pages sans recharger tout le site.
import Link from 'next/link';
// Le client Supabase configuré dans lib/supabase.ts, qui permet de lire/écrire dans la base de données.
import { supabase } from '@/lib/supabase';
// Budget de la période : ce qui reste à dépenser, dépassement, enregistrement des courses validées
import { isOverBudget, recordExpense, shortDate, type BudgetState } from '@/lib/budget';
import { storeLabel, STORE_SELECT } from '@/lib/stores';
// Mémoire des données entre deux visites : affichées tout de suite, puis rechargées en arrière-plan
import { useActiveLists, type SavedItem, type SavedList } from '@/lib/activeLists';
import { useShoppingBudget, useStores } from '@/lib/coursesQueries';
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
import { applyStoreToList, saveListTotal } from '@/lib/lists';
// Ajout des articles achetés au stock (partagé avec le scan de reçu)
import { addToInventory } from '@/lib/inventory';
// Modifications faites depuis la liste, appliquées aux ingrédients à la validation
import { applyPendingChanges } from '@/lib/pending';
import { deleteList as deleteListCascade } from '@/lib/deletions';
// Analyse d'une liste : meilleure boutique + comparaison avec l'inventaire
import { analyzeList, summarizeTotal, type ListAnalysis } from '@/lib/optimize';
// Icône poubelle pour supprimer un article de la liste
// (Check / X : boutons ✓ / ✗ pour appliquer ou ignorer l'optimisation d'un article grisé)
import { Check, ChevronRight, Pencil, Plus, PowerOff, Trash2, X } from 'lucide-react';
// Quantités possibles selon le type d'ingrédient (kg, pièce, paquet...)
import { formatQuantity, normalizeQuantity, quantityRule } from '@/lib/quantity';
// Ta position et la distance des magasins, pour conseiller un magasin proche
import { chooseNearbyOption } from '@/lib/geo';
// Position de départ enregistrée dans le profil
import { fetchProfile, profileCoords } from '@/lib/profile';
// Cadre de choix du magasin d'une liste (prix appliqués automatiquement)
import StoreChooser from '@/components/StoreChooser';
import type { Store } from '@/lib/types';

// Colonnes d'une ligne d'article : case "acheté" | article | quantité | prix | suppression.
// Police réduite et colonnes Qté / Prix resserrées (encore plus sur téléphone, ex : Galaxy A14),
// pour laisser un maximum de place au nom de l'article.
const ITEM_COLUMNS =
  'grid grid-cols-[1rem_minmax(0,1fr)_4.5rem_3.5rem_1.5rem] sm:grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_4.5rem_1.75rem] items-center gap-x-1.5 sm:gap-x-2';

// Articles au prix incertain (appui long sur le libellé) : clé du stockage local, et durée de l'appui long
const DOUBTFUL_KEY = 'nanacourses.doubtfulItems';
const LONG_PRESS_MS = 500;


// Date seule, à la française (ex : « 19 octobre 2026 »).
// Une date sans heure (« 2026-10-19 ») est lue en heure locale, pour ne pas glisser à la veille.
function formatDate(value: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Numéro du code-barres : jour, mois, année, heure, minute, seconde d'activation (ex : 19102026143205)
function barcodeNumber(iso: string) {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}${two(d.getMonth() + 1)}${d.getFullYear()}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

export default function ShoppingReceipts({ blue = false }: { blue?: boolean }) {
  // ----- ÉTATS (STATE) -----
  // Chaque useState renvoie [valeurActuelle, fonctionPourLaModifier].

  // Toutes les listes de courses en attente, chargées depuis Supabase.
  // Elles sont gardées en mémoire entre deux visites (lib/cache) : au retour sur la page elles s'affichent
  // tout de suite, puis sont rechargées en arrière-plan.
  const listsQuery = useActiveLists();
  const lists = listsQuery.data ?? [];
  // true tant que les données ne sont pas encore arrivées (seulement à la toute première visite).
  const loading = listsQuery.data === undefined;
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
  // Liste dont la fenêtre de validation est ouverte (clic sur le total ou sur "Valider cette liste"), null = fermée.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Dans la fenêtre de validation : créer une liste "Reste ..." avec les articles non barrés (proposé par défaut)
  const [keepRest, setKeepRest] = useState(true);
  // Liste dans laquelle le cadre "ajouter un ingrédient" ajoute (ouvert par le "+" de son ticket) ; null = fermé.
  const [addTo, setAddTo] = useState<SavedList | null>(null);
  // Article dont le cadre de modification est ouvert (clic sur son nom), avec sa liste ; null = fermé.
  const [editing, setEditing] = useState<{ list: SavedList; item: SavedItem } | null>(null);
  // Résultat du bouton "Optimiser", rangé par id de liste (absent = pas encore optimisée).
  const [analyses, setAnalyses] = useState<Record<string, ListAnalysis>>({});
  // Budget de la période en cours (réglages + ce qui reste), null tant qu'il n'est pas chargé.
  const budgetQuery = useShoppingBudget();
  const budget: BudgetState | null = budgetQuery.data ?? null;
  // id de la liste en cours d'optimisation (pour désactiver son bouton pendant le calcul).
  const [optimizing, setOptimizing] = useState<string | null>(null);
  // Articles dont l'optimisation a été refusée (✗), par liste : ils ne sont plus réoptimisés.
  const [rejected, setRejected] = useState<Record<string, Record<string, boolean>>>({});
  // Listes déjà optimisées et non modifiées depuis : leur bouton "Optimiser" est désactivé
  // (il se réactive dès qu'on change un article de la liste).
  const [optimized, setOptimized] = useState<Record<string, boolean>>({});
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm(blue ? 'gazette' : 'default');
  // Style des cadres (popins) : celui de la gazette de l'accueil quand le ticket est bleu
  const modalVariant = blue ? 'gazette' : 'default';
  // Supermarchés, pour afficher le magasin choisi sur chaque liste
  const stores: Store[] = useStores().data ?? [];
  // Liste dont le cadre de choix du magasin est ouvert (clic sur la ligne "Magasin") ; null = fermé
  const [choosingStoreFor, setChoosingStoreFor] = useState<SavedList | null>(null);

  // Un article de la liste a changé (ou la liste elle-même) :
  //  - on autorise une nouvelle optimisation ;
  //  - on efface le résultat d'optimisation de cet article, devenu faux (couleur, quantité proposée).
  function markModified(listId: string, itemId?: string) {
    setOptimized((o) => ({ ...o, [listId]: false }));
    if (itemId) clearSuggestion(listId, itemId);
  }

  // Articles au prix incertain, marqués par un appui long sur leur libellé (ligne surlignée en gris).
  // Gardés dans ce navigateur, pour rester marqués après un rechargement de la page.
  const [doubtful, setDoubtful] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(DOUBTFUL_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  // Appui long en cours (minuteur) et appui long qui vient d'avoir lieu (pour ignorer le clic qui suit)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  // Marque / démarque un article comme "prix incertain"
  function toggleDoubtful(itemId: string) {
    setDoubtful((d) => {
      const next = { ...d };
      if (next[itemId]) delete next[itemId];
      else next[itemId] = true;
      try {
        localStorage.setItem(DOUBTFUL_KEY, JSON.stringify(next));
      } catch {
        // Stockage local indisponible (navigation privée...) : le marquage dure jusqu'au rechargement
      }
      return next;
    });
  }

  // Début d'appui sur un libellé : au bout de LONG_PRESS_MS, la ligne est marquée (ou démarquée)
  function startPress(itemId: string) {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      toggleDoubtful(itemId);
    }, LONG_PRESS_MS);
  }

  // Fin d'appui (doigt levé, glissé hors du libellé...) : on annule l'appui long s'il n'a pas abouti
  function endPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
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
    // Le budget restant est recalculé en même temps que les listes
    budgetQuery.reload();
    await listsQuery.reload();
  }

  // Retour sur la page (autre onglet, Paramètres, bouton Précédent) : une liste a pu être activée
  // ou le budget modifié ailleurs, on recharge donc les listes et le budget.
  const { reload: reloadLists } = listsQuery;
  const { reload: reloadBudget } = budgetQuery;
  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      reloadLists();
      reloadBudget();
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [reloadLists, reloadBudget]);

  // Réactivation du budget : à la fin de la période en cours, le budget repart à zéro dépense,
  // on le recharge donc à ce moment-là (le minuteur est relancé pour la période suivante).
  useEffect(() => {
    if (!budget) return;
    // setTimeout n'accepte pas plus de ~24 jours : au-delà, on recharge plus tôt et on reprogramme
    const delay = Math.min(Math.max(0, budget.period.end.getTime() - Date.now()) + 1000, 2_000_000_000);
    const timer = setTimeout(reloadBudget, delay);
    return () => clearTimeout(timer);
  }, [budget, reloadBudget]);

  // Regroupe les articles d'une liste par catégorie, pour les afficher par rayon.
  // Retourne un tableau de groupes : [{ name: 'Fruits', items: [...] }, ...]
  function groupByCategory(items: SavedItem[]) {
    // Une Map associe une clé (id de catégorie) à un groupe { name, budget, items } (budget = budget max de la catégorie).
    // Elle conserve l'ordre d'insertion, donc l'ordre d'apparition des catégories.
    const groups = new Map<string, { name: string; budget: number | null; items: SavedItem[] }>();
    for (const item of items) {
      // "?." évite une erreur si ingredient ou category est null ;
      // "??" fournit une valeur par défaut dans ce cas.
      const key = item.ingredient?.category?.id ?? 'none';
      const name = item.ingredient?.category?.name ?? 'Sans catégorie';
      // Si le groupe n'existe pas encore, on le crée vide.
      if (!groups.has(key)) groups.set(key, { name, budget: item.ingredient?.category?.budget_limit ?? null, items: [] });
      // On ajoute l'article dans son groupe ("!" dit à TypeScript que le groupe existe forcément).
      groups.get(key)!.items.push(item);
    }
    // Ordre stable et alphabétique (Supabase ne garantit pas l'ordre des articles renvoyés, qui pouvait donc
    // changer après un ajout ou une modification) : catégories de A à Z ("Sans catégorie" à la fin),
    // et dans chaque catégorie, articles de A à Z (à nom égal, toujours le même ordre grâce à l'identifiant).
    const byName = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' });
    return Array.from(groups.entries())
      .sort(([keyA, a], [keyB, b]) => Number(keyA === 'none') - Number(keyB === 'none') || byName(a.name, b.name))
      .map(([, g]) => ({
        ...g,
        items: g.items
          .slice()
          .sort((a, b) => byName(a.ingredient?.name ?? '', b.ingredient?.name ?? '') || a.id.localeCompare(b.id))
      }));
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

  // ENREGISTREMENT DU PRIX d'un article quand on quitte le champ (champ vide = prix inconnu)
  async function savePrice(list: SavedList, item: SavedItem) {
    const raw = realPrices[item.id];
    if (raw === undefined) return; // rien n'a été tapé
    const price = raw ? Number(raw) : 0;
    if (price !== (item.expected_price ?? 0)) {
      // Le prix de l'ingrédient (dans le magasin de la liste) ne sera mis à jour qu'à la validation
      const { error } = await supabase
        .from('shopping_list_items')
        .update({ expected_price: price, pending: { ...(item.pending ?? {}), price_changed: true } })
        .eq('id', item.id);
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

  // Retire la suggestion "grisée" d'un article (après ✓ ou ✗)
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

  // ✗ : refuse l'optimisation d'un article grisé (il ne sera plus réoptimisé)
  function rejectSuggestion(listId: string, itemId: string) {
    setRejected((r) => ({ ...r, [listId]: { ...r[listId], [itemId]: true } }));
    clearSuggestion(listId, itemId);
  }

  // ✓ : applique l'optimisation sur un article grisé (quantité divisée par deux, prix au prorata)
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
    if (!(await confirm("Supprimer l'article", `Retirer « ${item.ingredient?.name ?? 'cet article'} » de la liste « ${list.name} » ?`))) return;
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
  //  - colore en rouge les articles déjà assez en stock, sans "stock faible" (l'utilisateur les supprime s'il veut) ;
  //  - colore aussi en rouge les autres articles d'une même famille : seul le moins cher est gardé ;
  //  - affiche en gris ceux en "stock faible" ou en partie en stock, avec ✓ / ✗ pour diviser ou non leur quantité par deux.
  // Lors d'une nouvelle optimisation, seuls les articles validés (✓) ou jamais modifiés sont réanalysés :
  //  - les articles grisés encore en attente d'un choix gardent leur statut tel quel ;
  //  - les articles refusés (✗) ne sont plus optimisés.
  async function optimizeList(list: SavedList) {
    setOptimizing(list.id);
    const ingredientIds = list.items.map((i) => i.ingredient_id);

    // On charge en parallèle : les prix des ingrédients de la liste, les magasins et l'inventaire
    const [{ data: prices }, { data: stores }, { data: inv }] = await Promise.all([
      supabase.from('ingredient_prices').select('ingredient_id, store_id, price, available').in('ingredient_id', ingredientIds),
      supabase.from('stores').select(STORE_SELECT),
      supabase.from('inventory').select('ingredient_id, quantity, low_stock')
    ]);

    // Dictionnaire ingredient_id -> stock à la maison (quantité, et "stock faible" coché ou non)
    const stock: Record<string, { quantity: number; low: boolean }> = {};
    for (const row of inv ?? []) stock[row.ingredient_id] = { quantity: row.quantity, low: !!row.low_stock };

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

    // Magasin conseillé parmi les 3 meilleurs : le plus avantageux depuis la position du profil (prix + trajet),
    // ou le moins cher si la position n'est pas renseignée ou que ces magasins sont trop loin
    const chosen = await chooseNearbyOption(analysis.options, profileCoords(await fetchProfile()));
    const result = chosen ? { ...analysis, options: [chosen], bestStore: chosen.store, savings: chosen.savings } : analysis;

    // Le magasin trouvé devient celui de la liste (ligne "Magasin"), et ses prix connus sont appliqués,
    // comme un choix fait avec le crayon. On peut ensuite en choisir un autre avec ce crayon.
    if (chosen && chosen.store.id !== list.store_id) {
      const error = await applyStoreToList(list.id, list.items, chosen.store.id);
      if (error) console.error(error);
      else await loadLists();
    }

    setAnalyses((a) => ({ ...a, [list.id]: result }));
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

  // VALIDATION (après confirmation dans la fenêtre de validation) : les articles achetés rejoignent l'inventaire,
  // leur prix est déduit du budget, et la liste est désactivée
  // Étapes :
  //  1. on garde uniquement les articles cochés (achetés)
  //  2. on lit l'inventaire actuel pour connaître les quantités déjà présentes
  //  3. on ajoute les quantités achetées dans l'inventaire
  //  4. on déduit le prix de la course du budget de la période (Profil > Budget)
  //  5. on désactive la liste (elle reste dans les paramètres)
  //  6. on recharge l'affichage et le budget restant
  async function validateList(list: SavedList, createRest = false) {
    // On mémorise quelle liste est en cours de validation (désactive son bouton).
    setValidating(list.id);

    // 1. Seuls les articles cochés sont considérés comme achetés.
    const boughtItems = list.items.filter((item) => checkedItems[item.id]);

    // 2-3. Les quantités achetées s'ajoutent au stock, en une seule requête
    // (un même ingrédient sur plusieurs lignes : toutes ses quantités sont additionnées).
    const error = await addToInventory(boughtItems.map((item) => ({ ingredientId: item.ingredient_id, quantity: item.quantity })));
    // En cas d'échec, on garde la liste pour ne rien perdre
    if (error) {
      console.error(error);
      return setValidating(null);
    }

    // 3 bis. Les modifications faites depuis la liste (informations et prix) s'appliquent maintenant aux ingrédients,
    // mais seulement pour les articles barrés (achetés) : informations modifiées, et prix mémorisé dans le magasin de la liste.
    // Celles des articles non barrés restent en attente (reprises dans la liste "Reste ..." si on la crée).
    const failures = await applyPendingChanges(boughtItems, list.store_id ?? null);
    if (failures.length > 0) console.error('Non enregistré :', failures.join(', '));

    // 4. Le prix de la course (articles achetés) est déduit du budget de la période en cours
    const spent = boughtItems.reduce((sum, item) => sum + (realPriceFor(item) ?? 0), 0);
    if (spent > 0) await recordExpense(spent, list.name);

    // 5. La liste validée est désactivée (elle reste dans Paramètres > Listes de courses)
    const { error: deactivateError } = await supabase.from('shopping_lists').update({ is_active: false }).eq('id', list.id);
    if (deactivateError) console.error(deactivateError);

    // 6. Articles non barrés (pas pris pendant la course) : s'il le veut, une nouvelle liste "Reste <nom>"
    // les reprend (mêmes quantités, prix et magasin), et devient la liste active
    const rest = list.items.filter((item) => !checkedItems[item.id]);
    if (createRest && rest.length > 0) {
      const { data: created, error: createError } = await supabase
        .from('shopping_lists')
        .insert({
          name: `Reste ${list.name}`,
          estimated_price: rest.reduce((sum, item) => sum + (item.expected_price ?? 0), 0),
          is_active: true,
          activated_at: new Date().toISOString(),
          store_id: list.store_id ?? null
        })
        .select()
        .single();
      if (createError || !created) console.error(createError);
      else {
        const { error: itemsError } = await supabase.from('shopping_list_items').insert(
          rest.map((item) => ({
            shopping_list_id: created.id,
            ingredient_id: item.ingredient_id,
            quantity: item.quantity,
            expected_price: item.expected_price,
            store_id: list.store_id ?? null,
            // Les modifications en attente suivent l'article : elles s'appliqueront s'il est barré puis validé dans cette liste
            pending: item.pending ?? null
          }))
        );
        if (itemsError) console.error(itemsError);
      }
    }

    // 7. Fin de la validation : on réactive les boutons, on recharge les listes et le budget restant.
    setValidating(null);
    await loadLists();

    // 8. Tous les articles étaient barrés : la liste est terminée. On demande s'il faut la garder
    // (désactivée, dans Paramètres > Listes) ou la supprimer avec ses articles.
    if (list.items.length > 0 && list.items.every((item) => checkedItems[item.id])) {
      const remove = await confirm(
        'Liste terminée',
        `Tous les articles de « ${list.name} » ont été achetés. Veux-tu garder la liste (désactivée, dans Paramètres › Listes) ou la supprimer ?`,
        { confirm: 'Supprimer la liste', cancel: 'Garder la liste' }
      );
      if (remove) {
        const error = await deleteListCascade(list.id);
        if (error) console.error(error);
      }
    }
  }

  // Une ligne d'article de la liste (case "acheté", nom, optimisation, prix, suppression)
  function renderItem(list: SavedList, item: SavedItem) {
    // Couleur donnée par l'optimisation : rouge = déjà en stock ou doublon plus cher de sa famille, gris = quantité à réduire (déjà en partie en stock : moins mis en avant)
    const status = analyses[list.id]?.status[item.id];
    // Quantité proposée pour un article grisé (absente si on ne peut pas diviser par deux)
    const suggestedQty = analyses[list.id]?.newQuantities[item.id];
    const statusColor =
      status === 'remove' ? 'text-red-600' : status === 'reduce' ? 'text-ink/60' : '';
    // Quantités possibles pour ce type d'ingrédient (ex : 0,1 kg en 0,1 kg, ou pièces entières)
    const rule = quantityRule(item.ingredient?.type);
    const checked = !!checkedItems[item.id];
    return (
      // Article coché ("acheté") : toute la ligne est barrée et grisée, et plus rien n'est modifiable
      // (nom, quantité, prix, optimisation, suppression) tant qu'on ne la décoche pas
      // Prix incertain (appui long sur le libellé) : ligne légèrement surlignée en gris
      <li
        key={item.id}
        className={`${ITEM_COLUMNS} py-1 text-[0.7rem] sm:text-xs ${statusColor} ${checked ? 'item-struck' : ''} ${doubtful[item.id] ? 'bg-ink/10 rounded-sm' : ''}`}
      >
        {/* Colonne 1 — case à cocher "acheté", la seule chose qui reste active sur une ligne cochée.
            "!!" transforme undefined en false pour avoir toujours un booléen. */}
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleChecked(item.id)}
          className="w-4 h-4 accent-brick"
          title="Acheté"
        />
        {/* Colonne 2 — article : nom, marque, et ✓ / ✗ pour un article grisé */}
        <span className="min-w-0 flex flex-wrap items-center gap-x-2">
          {/* Clic sur le nom : ouvre le cadre de modification de l'article.
              Appui long : marque / démarque l'article comme "prix incertain" (le clic qui suit est ignoré).
              select-none + pas de menu contextuel : l'appui long ne sélectionne pas le texte sur téléphone. */}
          <button
            type="button"
            onPointerDown={() => startPress(item.id)}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitTouchCallout: 'none' }}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false;
                return;
              }
              if (item.ingredient) setEditing({ list, item });
            }}
            disabled={!item.ingredient || checked}
            title={checked ? undefined : 'Modifier cet article'}
            className="truncate text-left select-none enabled:hover:underline decoration-dotted underline-offset-2"
          >
            {item.ingredient?.name ?? 'Ingrédient supprimé'}
            {/* Marque : seulement sur ordinateur (sm et plus), pour laisser la place au nom sur téléphone */}
            {item.ingredient?.brand && <span className="hidden sm:inline opacity-60"> — {item.ingredient.brand.name}</span>}
          </button>
        {/* ✓ / ✗ pour un article grisé : diviser sa quantité par deux, ou non */}
        {status === 'reduce' && suggestedQty != null && (
          <span className="flex items-center gap-1">
            <span className="font-bold">
              → {formatQuantity(suggestedQty)} {rule.unit}
            </span>
            <button
              onClick={() => applySuggestion(list, item, suggestedQty)}
              disabled={checked}
              aria-label="Appliquer l'optimisation"
              title="Appliquer"
              className="p-1 rounded border-2 border-current hover:bg-line/40"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => rejectSuggestion(list.id, item.id)}
              disabled={checked}
              aria-label="Ignorer l'optimisation"
              title="Ignorer"
              className="p-1 rounded border-2 border-current hover:bg-line/40"
            >
              <X size={14} />
            </button>
          </span>
        )}
        </span>
        {/* Colonne 3 — quantité, modifiable. Le pas et le minimum dépendent du type
            (0,1 kg pour le vrac, 1 pour une pièce ou un paquet). Le prix suit au prorata
            pendant la saisie ; la quantité est arrondie et enregistrée quand on quitte le champ. */}
        <span className="flex items-center justify-end gap-1 min-w-0">
          <input
            type="number"
            inputMode="decimal"
            step={rule.step}
            min={rule.min}
            value={draftQty[item.id] ?? String(item.quantity)}
            onChange={(e) => setDraftQty((d) => ({ ...d, [item.id]: e.target.value }))}
            onBlur={() => saveQuantity(list, item)}
            disabled={checked}
            className="input-hand w-8 sm:w-12 text-right"
            title={`Quantité (${rule.unit})`}
          />
          {/* Unité en entier (jusqu'à 4 lettres : pce, paq, bout...), jamais coupée */}
          <span className="opacity-60 shrink-0 whitespace-nowrap">{rule.unit}</span>
        </span>
        {/* Colonne 4 — prix de la ligne, directement modifiable pour mettre le prix réel.
            Le total se met à jour pendant la saisie, et le prix est enregistré
            quand on quitte le champ. Vide = prix inconnu. */}
        <span className="flex items-center justify-end gap-1">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="?"
            value={
              realPrices[item.id] ??
              (draftQty[item.id] ? (realPriceFor(item)?.toFixed(2) ?? '') : item.expected_price ? item.expected_price.toFixed(2) : '')
            }
            onChange={(e) => setRealPrices((r) => ({ ...r, [item.id]: e.target.value }))}
            onBlur={() => savePrice(list, item)}
            disabled={checked}
            className="input-hand w-12 sm:w-16 text-right"
            title="Prix (modifiable)"
          />
          <span>€</span>
        </span>
        {/* Colonne 5 — suppression de l'article (le total est mis à jour) */}
        <button
          onClick={() => deleteItem(list, item)}
          disabled={checked}
          aria-label="Supprimer cet article"
          title={checked ? undefined : 'Supprimer'}
          className="p-1 opacity-60 enabled:hover:opacity-100 enabled:hover:text-brick"
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
    <div className={blue ? 'tint-blue' : undefined}>
      {/* Cadre de confirmation des suppressions */}
      {confirmDialog}

      {/* ----- LA LISTE DE COURSES, présentée comme un ticket de caisse, centrée sur la page ----- */}
      <div className="max-w-xl mx-auto">
          {/* Pendant le chargement de la liste active : « Impression » et trois points qui font la vague */}
          {loading && (
            <div className="flex items-end justify-center gap-1.5 py-10" role="status" aria-label="Impression de ta liste">
              <span className="title-hand text-2xl leading-none">Impression</span>
              <span className="flex gap-1 pb-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="typing-dot block h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          )}

          {/* Aucune liste active : un ticket vide avec le message */}
          {!loading && lists.length === 0 && (
            <div className="receipt text-center">
              <p className="title-hand text-3xl mb-1">Aucune liste active</p>
              <p className="mb-4 opacity-70 text-sm">Active une de tes listes, ou crées-en une, dans les paramètres.</p>
              <Link href="/settings?tab=lists" className="btn-hand inline-block">
                Gérer mes listes
              </Link>
            </div>
          )}

          {/* Un ticket par liste de courses. "key" aide React à identifier chaque élément. */}
          {lists.map((list) => {
            // Total de la liste (somme des prix connus) et dépassement de budget :
            // plus que ce qui reste sur la période, ou plus que (reste - marge) si des articles n'ont pas de prix.
            // Dans ce cas, "Optimiser" passe en rouge et "Valider cette liste" est désactivé.
            const prices = list.items.map(realPriceFor);
            const summary = summarizeTotal(prices);
            const hasMissingPrice = prices.some((p) => p == null);
            const overBudget = budget ? isOverBudget(summary.total, hasMissingPrice, budget) : false;
            const analysis = analyses[list.id];
            // Magasin choisi pour la liste (via la ligne "Magasin" du ticket)
            const chosenStore = stores.find((s) => s.id === list.store_id);
            return (
            <div key={list.id}>
              <div className="receipt">
                {/* Icônes d'action, discrètes, dans le coin du ticket */}
                <span className="absolute top-2 right-2 flex items-center gap-1">
                  {/* Désactiver : la liste est gardée (dans Paramètres > Listes de courses) mais quitte cette page */}
                  <button
                    onClick={() => deactivateList(list)}
                    aria-label="Désactiver la liste"
                    title="Désactiver la liste"
                    className="p-1.5 opacity-40 hover:opacity-100"
                  >
                    <PowerOff size={16} />
                  </button>
                  {/* Supprimer : la liste et tous ses articles, après confirmation */}
                  <button
                    onClick={() => deleteList(list)}
                    aria-label="Supprimer la liste"
                    title="Supprimer la liste"
                    className="p-1.5 opacity-40 hover:opacity-100 hover:text-brick"
                  >
                    <Trash2 size={16} />
                  </button>
                </span>

                {/* EN-TÊTE : nom de la liste, comme le nom du magasin sur un ticket */}
                <div className="text-center px-8">
                  <p className="title-hand text-3xl sm:text-4xl text-ink">{list.name}</p>
                  <p className="text-xs tracking-[0.3em] opacity-60 mt-1">✦ LISTE DE COURSES ✦</p>
                </div>

                <div className="receipt-rule" />

                {/* INFORMATIONS : date, magasin conseillé, budget restant */}
                <div className="text-xs sm:text-sm space-y-0.5">
                  {/* Date de la liste (sans l'heure), ou à défaut sa date de création */}
                  <p className="receipt-row">
                    <span>Date :</span>
                    <span className="text-right">{formatDate(list.date ?? list.created_at ?? new Date().toISOString())}</span>
                  </p>
                  {/* MAGASIN : celui choisi pour la liste, sinon celui conseillé par l'optimisation.
                      Un clic ouvre le choix du magasin (les prix connus y sont appliqués automatiquement). */}
                  <p className="receipt-row">
                    <span>Lieux :</span>
                    {/* Nom du magasin (un trait si aucun), puis l'icône crayon à droite qui ouvre le choix du magasin */}
                    <span className="flex items-center justify-end gap-2 min-w-0">
                      <span className="text-right">
                        {chosenStore ? storeLabel(chosenStore) : analysis?.bestStore ? storeLabel(analysis.bestStore) : '—'}
                      </span>
                      <button
                        onClick={() => setChoosingStoreFor(list)}
                        aria-label="Modifier le magasin"
                        title="Modifier le magasin"
                        className="shrink-0 p-1 -m-1 opacity-70 hover:opacity-100 hover:text-brick"
                      >
                        <Pencil size={18} />
                      </button>
                    </span>
                  </p>
                  {/* Budget encore disponible sur la période en cours, et date de sa réactivation */}
                  {budget && (
                    <p className="receipt-row">
                      <span>Budget :</span>
                      <span className="text-right">
                        {budget.remaining.toFixed(2)} € jusqu&apos;au {shortDate(new Date(budget.period.end.getTime() - 86_400_000))}
                      </span>
                    </p>
                  )}
                </div>

                <div className="receipt-rule-double" />

                {/* En-tête des colonnes, aligné sur les lignes d'articles : Qté et Prix à droite, comme leurs valeurs.
                    Dans la colonne des poubelles, le "+" ajoute un ingrédient directement à cette liste. */}
                <div className={`${ITEM_COLUMNS} text-xs sm:text-sm uppercase pb-1 mb-2`}>
                  <span />
                  <span>Article</span>
                  <span className="text-right">Qté</span>
                  <span className="text-right">Prix</span>
                  <button
                    onClick={() => setAddTo(list)}
                    aria-label="Ajouter un ingrédient à cette liste"
                    title="Ajouter un ingrédient"
                    className="flex items-center justify-center p-0.5 rounded border-2 border-ink hover:bg-ink hover:text-paper"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {list.items.length === 0 && <p className="text-center text-sm opacity-60 py-2">AUCUN ARTICLE</p>}

                {/* Les articles, regroupés par catégorie */}
                {groupByCategory(list.items).map((g) => (
                  <div key={g.name} className="mb-3">
                    {/* Nom de la catégorie */}
                    {/* Nom de la catégorie, en rouge si le total de ses articles dépasse son budget */}
                    {(() => {
                      const groupTotal = g.items.reduce((sum, item) => sum + (realPriceFor(item) ?? 0), 0);
                      const over = g.budget != null && groupTotal > Number(g.budget);
                      return (
                        <p className={`text-xs uppercase tracking-widest mb-0.5 ${over ? 'text-brick font-bold' : 'opacity-50'}`}>
                          — {g.name} —
                        </p>
                      );
                    })()}
                    <ul className="space-y-1">
                      {/* Les variantes d'un même produit sont regroupées sous une bannière (ex : Œufs) ;
                          l'optimisation garde le moins cher d'une famille */}
                      <FamilyList
                        compact
                        items={g.items}
                        nameOf={(item) => item.ingredient?.name ?? ''}
                        renderItem={(item) => renderItem(list, item)}
                      />
                    </ul>
                  </div>
                ))}

                <div className="receipt-rule-double" />

                {/* TOTAL, recalculé en direct depuis les prix des articles :
                    exact si tous les prix sont connus, "supérieur à" si au moins la moitié, sinon indisponible */}
                <div className="space-y-0.5">
                  {/* RÉCAPITULATIF, en "réel / prévu" :
                      - prévu = toute la liste ; réel = les articles barrés (pris pendant la course),
                        car on ne prend pas forcément tout ce qui était prévu ;
                      - "> " devant un montant quand au moins un prix est inconnu (le vrai montant est plus élevé). */}
                  {(() => {
                    const taken = list.items.filter((item) => checkedItems[item.id]);
                    const takenPrices = taken.map(realPriceFor);
                    const takenTotal = takenPrices.reduce<number>((sum, p) => sum + (p ?? 0), 0);
                    const takenMissing = takenPrices.some((p) => p == null);
                    const plannedTotal = summary.kind === 'none' ? 'prix ?' : `${hasMissingPrice ? '> ' : ''}${summary.total.toFixed(2)} €`;
                    return (
                      <>
                        {/* Économie possible trouvée par l'optimisation */}
                        {analysis?.bestStore && (
                          <p className="receipt-row text-sm sm:text-base font-bold text-green-700">
                            <span>Économie</span>
                            <span>
                              {hasMissingPrice ? '> ' : ''}{analysis.savings.toFixed(2)} €
                            </span>
                          </p>
                        )}
                        <p className="receipt-row text-xs sm:text-sm">
                          <span>
                            Articles 
                          </span>
                          <span>
                            {taken.length} / {list.items.length}
                          </span>
                        </p>
                        {/* Deux totaux : celui prévu (toute la liste), puis le réel (articles barrés) */}
                        <p className={`receipt-row text-sm sm:text-base ${overBudget ? 'text-brick' : ''}`}>
                          <span>Total prévu</span>
                          <span className="text-right">{plannedTotal}</span>
                        </p>
                        <p className="receipt-row text-base sm:text-lg font-bold">
                          <span>Total réel</span>
                          <span className="text-right">
                            {takenMissing ? '> ' : ''}
                            {takenTotal.toFixed(2)} €
                          </span>
                        </p>
                        {/* Validation des articles barrés, écrite clairement */}
                        <button
                          onClick={() => setConfirmingId(list.id)}
                          title="Les articles barrés rejoignent l'inventaire et leur prix est déduit du budget"
                          className="flex items-center gap-0.5 ml-auto text-[10px] sm:text-xs uppercase underline decoration-dotted underline-offset-4 opacity-70 hover:opacity-100"
                        >
                          Valider mes achats <ChevronRight size={14} />
                        </button>
                      </>
                    );
                  })()}
                  {overBudget && <p className="text-xs text-brick text-right uppercase">Budget dépassé</p>}
                  {analysis && !analysis.bestStore && (
                    <p className="text-xs opacity-60 text-right uppercase">Aucun prix en magasin pour ces ingrédients</p>
                  )}
                </div>

                <div className="receipt-rule" />

                {/* Code-barres décoratif ; son numéro = jour, mois, année, heure, minute, seconde d'activation de la liste */}
                <div className="receipt-barcode mt-4" aria-hidden="true" />
                <p className="text-center text-xs tracking-[0.25em] sm:tracking-[0.35em] mt-1 opacity-70" title="Date et heure d'activation">
                  {barcodeNumber(list.activated_at ?? list.created_at ?? new Date().toISOString())}
                </p>
                {/* Pied du ticket : "Optimiser votre visite !" tant que la liste peut être optimisée
                    (un clic lance l'optimisation), puis "Merci de votre visite !" */}
                {optimizing === list.id ? (
                  <p className="text-center text-xs uppercase mt-3 opacity-60">Optimisation...</p>
                ) : list.items.length > 0 && !optimized[list.id] ? (
                  <button
                    onClick={() => optimizeList(list)}
                    title="Optimiser la liste"
                    className={`block mx-auto text-xs uppercase mt-3 underline decoration-dotted underline-offset-4 hover:opacity-100 ${overBudget ? 'text-brick' : 'opacity-80'}`}
                  >
                    Optimiser votre visite !
                  </button>
                ) : (
                  <p className="text-center text-xs uppercase mt-3 opacity-60">Merci de votre visite !</p>
                )}
              </div>

              {/* Boutons sous le ticket : "Optimiser" à gauche, avant "Valider cette liste" */}
              <div className="flex flex-wrap items-center justify-center gap-3 mt-6 mb-8">
                {/* En rouge quand le budget est dépassé, pour inviter à optimiser */}
                <button
                  onClick={() => optimizeList(list)}
                  disabled={optimizing === list.id || !!optimized[list.id]}
                  title={optimized[list.id] ? 'Déjà optimisée : modifie un article pour pouvoir réoptimiser' : undefined}
                  className={`btn-hand disabled:cursor-not-allowed ${overBudget ? 'bg-brick' : ''}`}
                >
                  {optimizing === list.id ? 'Optimisation...' : 'Optimiser'}
                </button>
                {/* Bouton de validation : désactivé pendant le traitement, ou tant que le budget est dépassé */}
                <button
                  onClick={() => setConfirmingId(list.id)}
                  disabled={validating === list.id || overBudget}
                  title={overBudget ? 'Budget dépassé : optimise la liste avant de la valider' : undefined}
                  className="btn-hand disabled:cursor-not-allowed"
                >
                  {validating === list.id ? 'Validation...' : 'Valider cette liste'}
                </button>
              </div>
            </div>
            );
          })}
      </div>

      {/* FENÊTRE DE VALIDATION : ouverte par un clic sur le total (ou sur "Valider cette liste").
          La validation n'est possible que si tous les prix sont renseignés et le magasin choisi ;
          on montre alors un récapitulatif et on demande à l'utilisateur s'il est sûr de ces informations. */}
      {(() => {
        const list = lists.find((l) => l.id === confirmingId);
        if (!list) return null;
        const missingPrices = list.items.filter((item) => realPriceFor(item) == null);
        const chosenStore = stores.find((s) => s.id === list.store_id);
        const prices = list.items.map(realPriceFor);
        const total = prices.reduce<number>((sum, p) => sum + (p ?? 0), 0);
        const overBudget = budget ? isOverBudget(total, missingPrices.length > 0, budget) : false;
        const bought = list.items.filter((item) => checkedItems[item.id]);
        // Articles marqués "prix incertain" (appui long) : simple note dans la fenêtre
        const doubtfulItems = list.items.filter((item) => doubtful[item.id]);
        const ready = list.items.length > 0 && missingPrices.length === 0 && !!chosenStore && !overBudget;
        return (
          <Modal title="Valider mes achats" onClose={() => setConfirmingId(null)} variant={modalVariant}>
            {ready ? (
              <>
                {bought.length === 0 && (
                  <p className="text-sm text-brick mb-3">
                    Aucun article n&apos;est coché : rien ne sera ajouté à l&apos;inventaire ni déduit du budget.
                  </p>
                )}
                {/* Simple note (n'empêche pas la validation) : articles marqués "prix incertain" par un appui long */}
                {doubtfulItems.length > 0 && (
                  <p className="text-sm mb-3 px-2 py-1 bg-ink/10 rounded-sm">
                    {doubtfulItems.length === 1
                      ? "1 article surligné en gris : tu n'es pas sûr de son prix"
                      : `${doubtfulItems.length} articles surlignés en gris : tu n'es pas sûr de leur prix`}{' '}
                    ({doubtfulItems.map((item) => item.ingredient?.name ?? 'Ingrédient supprimé').join(', ')}).
                  </p>
                )}
                {/* Articles non barrés : proposition de les garder dans une nouvelle liste, activée automatiquement */}
                {list.items.length > bought.length && (
                  <label className="flex items-start gap-2 text-sm mb-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={keepRest}
                      onChange={(e) => setKeepRest(e.target.checked)}
                      className="w-4 h-4 mt-0.5 accent-brick shrink-0"
                    />
                    <span>
                      Créer la liste <strong>« Reste {list.name} »</strong> avec{' '}
                      {list.items.length - bought.length === 1
                        ? "l'article non barré"
                        : `les ${list.items.length - bought.length} articles non barrés`}{' '}
                      (elle deviendra la liste active)
                    </span>
                  </label>
                )}
                <div className="mb-5" />
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    autoFocus
                    onClick={() => {
                      setConfirmingId(null);
                      validateList(list, keepRest);
                      setKeepRest(true);
                    }}
                    className="btn-hand"
                  >
                    Oui, valider
                  </button>
                  {/* Même forme que "Oui, valider", couleur plus discrète */}
                  <button onClick={() => setConfirmingId(null)} className="btn-hand bg-line text-ink">
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Validation impossible : on dit précisément ce qui manque */}
                <p className="mb-3">La liste ne peut pas encore être validée :</p>
                <ul className="text-sm list-disc pl-5 space-y-1 mb-5 text-brick">
                  {list.items.length === 0 && <li>la liste ne contient aucun article ;</li>}
                  {!chosenStore && <li>aucun magasin n&apos;est choisi (ligne « Magasin » du ticket) ;</li>}
                  {missingPrices.length > 0 && (
                    <li>
                      {missingPrices.length === 1 ? 'un prix manque' : `${missingPrices.length} prix manquent`} :{' '}
                      {missingPrices.map((item) => item.ingredient?.name ?? 'Ingrédient supprimé').join(', ')} ;
                    </li>
                  )}
                  {overBudget && <li>le budget de la période est dépassé (optimise la liste).</li>}
                </ul>
                <button autoFocus onClick={() => setConfirmingId(null)} className="btn-hand">
                  Compléter la liste
                </button>
              </>
            )}
          </Modal>
        );
      })()}

      {/* CADRE D'AJOUT : affiché au-dessus de la page, pour la liste dont on a cliqué le "+".
          Après l'ajout, on ferme le cadre et on recharge les listes pour voir le nouvel article. */}
      {addTo && (
        <Modal title={`Ajouter à la liste en cours`} onClose={() => setAddTo(null)} variant={modalVariant}>
          <AddToListForm
            lists={[addTo]}
            onAdded={() => {
              setAddTo(null);
              // Un article a été ajouté : les listes peuvent être réoptimisées
              setOptimized({});
              loadLists();
            }}
          />
        </Modal>
      )}

      {/* CADRE DE CHOIX DU MAGASIN : ouvert par un clic sur la ligne "Magasin" du ticket.
          Une fois le magasin choisi, les prix connus sont appliqués : on recharge la liste. */}
      {choosingStoreFor && (
        <Modal title="Où fais-tu tes courses ?" onClose={() => setChoosingStoreFor(null)} variant={modalVariant}>
          <StoreChooser
            listId={choosingStoreFor.id}
            items={choosingStoreFor.items}
            currentStoreId={choosingStoreFor.store_id ?? null}
            onChosen={() => {
              markModified(choosingStoreFor.id);
              setChoosingStoreFor(null);
              loadLists();
            }}
          />
        </Modal>
      )}

      {/* CADRE DE MODIFICATION d'un article : ouvert par un clic sur son nom.
          Après l'enregistrement, on recalcule le total de la liste et on recharge l'affichage. */}
      {editing && (
        <Modal title="Modifier l'article" onClose={() => setEditing(null)} variant={modalVariant}>
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
