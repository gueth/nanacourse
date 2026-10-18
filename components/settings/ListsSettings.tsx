'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatQuantity, quantityRule } from '@/lib/quantity';
import AddToListForm from '@/components/AddToListForm';
import { useConfirm } from '@/components/ConfirmDialog';
import { deleteList as deleteListCascade } from '@/lib/deletions';
import { listTotal, saveListTotal } from '@/lib/lists';
import Modal from '@/components/Modal';
import NewListForm from '@/components/settings/NewListForm';

// Une liste de courses avec ses articles (seulement ce qu'il faut pour cet onglet)
type ListRow = {
  id: string;
  name: string;
  estimated_price: number;
  is_active: boolean;
  items: {
    id: string;
    quantity: number;
    expected_price: number | null;
    ingredient: { name: string; type: string | null } | null;
  }[];
};

const LISTS_QUERY = '*, items:shopping_list_items(id, quantity, expected_price, ingredient:ingredients(name, type))';

function fetchLists() {
  return supabase.from('shopping_lists').select(LISTS_QUERY).order('created_at', { ascending: false });
}

// Onglet "Listes de courses" des paramètres :
//  - créer des listes : libellé + ingrédients cochés et leurs quantités (désactivées au départ) ;
//  - les compléter ensuite : ajouter un article à la fois, en retirer ;
//  - en activer UNE à la fois : c'est elle qui s'affiche sur la page Course ;
//  - les renommer, les désactiver, les supprimer.
export default function ListsSettings() {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();

  // Cadre de création d'une liste (ingrédients à cocher) ouvert ou non
  const [creating, setCreating] = useState(false);

  // Liste dépliée (articles visibles) et liste en cours de renommage
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function showError(error: { code?: string; message: string }) {
    console.error(error);
    // 42703 = colonne inconnue : la colonne "is_active" n'a pas encore été ajoutée dans Supabase
    setErrorMessage(
      error.code === '42703'
        ? "La colonne « is_active » manque dans la table shopping_lists (voir le SQL à lancer dans Supabase)."
        : error.message
    );
  }

  async function loadLists() {
    const { data, error } = await fetchLists();
    if (error) showError(error);
    setLists((data as unknown as ListRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchLists().then(({ data, error }) => {
      if (error) showError(error);
      setLists((data as unknown as ListRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  // LISTE CRÉÉE (désactivée) depuis le cadre de création : on ferme le cadre,
  // puis on ouvre la nouvelle liste pour pouvoir y ajouter des articles un par un
  function handleCreated(listId: string) {
    setCreating(false);
    setOpenId(listId);
    loadLists();
  }

  // ACTIVATION : une seule liste active à la fois, donc on désactive d'abord les autres
  async function activate(id: string) {
    setErrorMessage('');
    const { error: offError } = await supabase.from('shopping_lists').update({ is_active: false }).eq('is_active', true);
    if (offError) return showError(offError);
    const { error } = await supabase.from('shopping_lists').update({ is_active: true }).eq('id', id);
    if (error) return showError(error);
    loadLists();
  }

  // DÉSACTIVATION
  async function deactivate(id: string) {
    const { error } = await supabase.from('shopping_lists').update({ is_active: false }).eq('id', id);
    if (error) return showError(error);
    loadLists();
  }

  // RENOMMAGE (changement de libellé)
  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    const { error } = await supabase.from('shopping_lists').update({ name: renameValue.trim() }).eq('id', id);
    if (error) return showError(error);
    setRenamingId(null);
    loadLists();
  }

  // SUPPRESSION d'une liste et de ses articles (après confirmation)
  async function deleteList(list: ListRow) {
    if (!(await confirm('Supprimer la liste', `Supprimer la liste « ${list.name} » et ses ${list.items.length} article(s) ?`))) return;
    const error = await deleteListCascade(list.id);
    if (error) return showError(error);
    loadLists();
  }

  // RETRAIT D'UN ARTICLE, puis mise à jour du total de la liste
  async function removeItem(list: ListRow, itemId: string) {
    const { error } = await supabase.from('shopping_list_items').delete().eq('id', itemId);
    if (error) return showError(error);
    await saveListTotal(
      list.id,
      list.items.filter((i) => i.id !== itemId)
    );
    loadLists();
  }

  if (loading) return <p>Chargement...</p>;

  return (
    <div>
      {confirmDialog}
      <p className="opacity-70 mb-4">
        Prépare tes listes à l&apos;avance, puis active celle du jour : c&apos;est elle qui s&apos;affiche sur la page Course.
      </p>

      {/* Ouvre le cadre de création : libellé + ingrédients à cocher, rangés par catégorie */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <button onClick={() => setCreating(true)} className="btn-hand">
          + Créer une liste
        </button>
        {errorMessage && <p className="text-sm text-brick">{errorMessage}</p>}
      </div>

      {creating && (
        <Modal title="Nouvelle liste de courses" onClose={() => setCreating(false)}>
          <NewListForm onCreated={handleCreated} />
        </Modal>
      )}

      <ul className="space-y-3">
        {lists.length === 0 && <p className="opacity-60">Aucune liste pour le moment.</p>}
        {lists.map((list) => {
          const open = openId === list.id;
          const total = listTotal(list.items);
          return (
            <li key={list.id} className={`card ${list.is_active ? 'border-herb' : ''}`}>
              <span className="tape" />

              {/* EN-TÊTE : libellé (cliquable pour déplier), état, résumé et actions */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {renamingId === list.id ? (
                  <span className="flex flex-wrap items-center gap-3">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveRename(list.id)}
                      className="input-hand"
                    />
                    <button onClick={() => saveRename(list.id)} className="btn-hand">
                      Enregistrer
                    </button>
                    <button onClick={() => setRenamingId(null)} className="btn-ghost">
                      annuler
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setOpenId(open ? null : list.id)}
                    aria-expanded={open}
                    className="title-hand text-2xl flex items-center gap-1 text-left"
                  >
                    <ChevronRight size={22} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    {list.name}
                    {list.is_active && (
                      <span className="ml-2 text-sm font-[family-name:var(--font-type)] text-herb border-2 border-herb rounded px-1.5">
                        active
                      </span>
                    )}
                  </button>
                )}
                <span className="text-sm opacity-70">
                  {list.items.length} article(s) — {total.toFixed(2)} €
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-3">
                {list.is_active ? (
                  <button onClick={() => deactivate(list.id)} className="btn-hand">
                    Désactiver
                  </button>
                ) : (
                  <button onClick={() => activate(list.id)} className="btn-hand">
                    Activer
                  </button>
                )}
                <button
                  onClick={() => {
                    setRenamingId(list.id);
                    setRenameValue(list.name);
                  }}
                  className="btn-ghost"
                >
                  renommer
                </button>
                <button onClick={() => deleteList(list)} className="btn-ghost">
                  supprimer
                </button>
              </div>

              {/* ARTICLES DE LA LISTE, visibles quand elle est dépliée */}
              {open && (
                <div className="mt-4 pt-3 border-t-2 border-dashed border-line">
                  {list.items.length === 0 ? (
                    <p className="text-sm opacity-60 mb-3">Aucun article dans cette liste.</p>
                  ) : (
                    <ul className="mb-4 divide-y-2 divide-dashed divide-line text-sm">
                      {list.items.map((item) => (
                        <li key={item.id} className="flex items-center gap-3 py-1.5">
                          <span className="flex-1 min-w-0 truncate">{item.ingredient?.name ?? 'Ingrédient supprimé'}</span>
                          <span className="opacity-70">
                            {formatQuantity(item.quantity)} {quantityRule(item.ingredient?.type).unit}
                          </span>
                          <span className="w-20 text-right">
                            {item.expected_price ? `${item.expected_price.toFixed(2)} €` : 'prix ?'}
                          </span>
                          <button
                            onClick={() => removeItem(list, item.id)}
                            aria-label="Retirer cet article"
                            title="Retirer"
                            className="p-1 opacity-60 hover:opacity-100 hover:text-brick"
                          >
                            <Trash2 size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Ajout d'articles : même formulaire que sur la page Course, ciblé sur cette liste */}
                  <p className="field-label mb-2">Ajouter un article</p>
                  <AddToListForm key={`${list.id}-${list.items.length}`} lists={[list]} onAdded={loadLists} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
