'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCached } from '@/lib/cache';
import type { Ingredient, InventoryRow } from '@/lib/types';
import { SwipePages } from '@/components/SwipePages';
import FamilyList from '@/components/FamilyList';
import { useConfirm } from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';
import PantryScan from '@/components/PantryScan';
import ReceiptScan from '@/components/ReceiptScan';
import { Camera, ReceiptText, Trash2, TriangleAlert } from 'lucide-react';
import { IconButton, RowList, SearchBar } from '@/components/settings/ui';
import { formatQuantity, quantityRule } from '@/lib/quantity';

type Row = InventoryRow & { ingredient: Ingredient };

// Inventaire (le plus récemment mis à jour en premier) et liste des ingrédients pour le formulaire
function fetchAll() {
  return Promise.all([
    supabase.from('inventory').select('*, ingredient:ingredients(*)').order('updated_at', { ascending: false }),
    supabase.from('ingredients').select('*').order('name')
  ]);
}

export default function InventoryPage() {
  // Inventaire et ingrédients gardés en mémoire entre deux visites (lib/cache) : affichés tout de suite, puis rechargés
  const query = useCached('courses:inventaire', async () => {
    const [{ data: inv }, { data: ings }] = await fetchAll();
    return { rows: (inv as unknown as Row[]) ?? [], ingredients: (ings as Ingredient[]) ?? [] };
  });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const ingredients = query.data?.ingredients ?? [];
  const loading = query.data === undefined;
  const loadAll = query.reload;
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [search, setSearch] = useState('');
  // Cadre de confirmation avant suppression
  const [confirm, confirmDialog] = useConfirm();
  // Cadre du scan de frigo / placards ouvert ou non
  const [scanOpen, setScanOpen] = useState(false);
  // Cadre du scan de reçu ouvert ou non
  const [receiptOpen, setReceiptOpen] = useState(false);

  const filtered = useMemo(
    () =>
      rows.filter((r) => r.quantity > 0 && r.ingredient.name.toLowerCase().includes(search.trim().toLowerCase())),
    [rows, search]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) return;
    const { error } = await supabase
      .from('inventory')
      .upsert({ ingredient_id: ingredientId, quantity: Number(quantity), updated_at: new Date().toISOString() }, { onConflict: 'ingredient_id' });
    if (error) return console.error(error);
    setIngredientId('');
    setQuantity('1');
    loadAll();
  }

  async function toggleLowStock(id: string, current: boolean) {
    const { error } = await supabase.from('inventory').update({ low_stock: !current }).eq('id', id);
    if (error) console.error(error);
    else loadAll();
  }

  // SUPPRESSION d'un ingrédient de l'inventaire, après confirmation
  async function handleDelete(r: Row) {
    if (!(await confirm("Retirer de l'inventaire", `Retirer « ${r.ingredient.name} » de l'inventaire ?`))) return;
    const { error } = await supabase.from('inventory').delete().eq('id', r.id);
    if (error) console.error(error);
    else loadAll();
  }

  if (loading) return <p>Chargement...</p>;

  const formPage = (
    <div>
      <h1 className="title-hand text-3xl sm:text-4xl mb-1">Inventaire</h1>
      <p className="opacity-70 mb-4">Ce qu&apos;il te reste à la maison.</p>

      {/* SCAN DU FRIGO ET DES PLACARDS : désactivé pour l'instant.
          Il demande une IA capable de reconnaître les produits (service payant) ; le code reste en place
          (PantryScan + /api/scan-pantry) pour le réactiver : retirer "disabled" et remettre onClick={() => setScanOpen(true)}. */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          disabled
          title="Bientôt disponible : la reconnaissance du frigo demande une IA payante"
          className="btn-hand flex items-center gap-2 cursor-not-allowed"
        >
          <Camera size={18} /> Scanner mon frigo / mes placards
          <span className="text-xs font-[family-name:var(--font-type)] border border-current rounded px-1">indisponible</span>
        </button>
        {/* SCAN D'UN REÇU : produits achetés -> stock, nouveaux ingrédients, infos complétées, prix du magasin */}
        <button onClick={() => setReceiptOpen(true)} className="btn-hand flex items-center gap-2">
          <ReceiptText size={18} /> Scanner un reçu
        </button>
      </div>

      <h2 className="title-hand text-2xl mb-3">Mettre à jour un stock</h2>

      <form onSubmit={handleSubmit} className="card form-grid">
        <span className="tape" />
        <div>
          <label className="field-label">Ingrédient</label>
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="input-hand">
            <option value="">—</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Quantité</label>
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min={0} className="input-hand w-20" />
        </div>
        <button type="submit" className="btn-hand">
          Mettre à jour
        </button>
      </form>
    </div>
  );

  const listPage = (
    <div>
      <h2 className="title-hand text-3xl sm:text-4xl mb-1">Ton inventaire</h2>
      <p className="text-sm opacity-70 mb-4">
        Un ingrédient épuisé (quantité 0 ou stock faible) réapparaît automatiquement dans la liste de courses, et n&apos;est
        plus affiché ici une fois à 0.
      </p>

      <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un ingrédient..." />

      {/* LISTE : une ligne par ingrédient en stock (nom, quantité), avec "stock faible" (⚠) et supprimer.
          Les variantes d'un même produit sont regroupées sous une ligne (ex : Œufs (3)). */}
      <RowList empty={filtered.length === 0 ? 'Aucun ingrédient ne correspond à ta recherche.' : undefined}>
        <FamilyList
          rows
          items={filtered}
          nameOf={(r) => r.ingredient.name}
          renderItem={(r, nested) => {
            const low = r.low_stock;
            return (
              // Stock faible : ligne teintée et icône ⚠ allumée
              <li key={r.id} className={`py-2 pr-4 ${nested ? 'pl-10' : 'pl-4'} ${low ? 'bg-brick/10' : ''}`}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{r.ingredient.name}</p>
                    <p className={`text-xs ${low ? 'text-brick font-bold' : 'opacity-60'}`}>
                      {formatQuantity(r.quantity)} {quantityRule(r.ingredient.type).unit}
                      {low ? ' · stock faible' : ''}
                    </p>
                  </div>
                  <span className="flex items-center shrink-0 -mr-2">
                    <IconButton
                      label={low ? 'Marquer comme suffisant' : 'Marquer en stock faible'}
                      onClick={() => toggleLowStock(r.id, r.low_stock)}
                      active={low}
                    >
                      <TriangleAlert size={18} />
                    </IconButton>
                    <IconButton label="Supprimer" onClick={() => handleDelete(r)} danger>
                      <Trash2 size={18} />
                    </IconButton>
                  </span>
                </div>
              </li>
            );
          }}
        />
      </RowList>
    </div>
  );

  return (
    <>
      {confirmDialog}
      {/* Cadre du scan, au-dessus de la page ; l'inventaire est rechargé une fois la mise à jour faite */}
      {scanOpen && (
        <Modal title="Scanner frigo et placards" onClose={() => setScanOpen(false)}>
          <PantryScan
            ingredients={ingredients}
            stockByIngredient={Object.fromEntries(rows.map((r) => [r.ingredient_id, r.quantity]))}
            onDone={() => {
              setScanOpen(false);
              loadAll();
            }}
          />
        </Modal>
      )}
      {/* Cadre du scan de reçu ; l'inventaire et les ingrédients sont rechargés une fois l'enregistrement fait */}
      {receiptOpen && (
        <Modal title="Scanner un reçu" wide onClose={() => setReceiptOpen(false)}>
          <ReceiptScan
            ingredients={ingredients}
            onDone={() => {
              setReceiptOpen(false);
              loadAll();
            }}
          />
        </Modal>
      )}
      <SwipePages pages={[formPage, listPage]} labels={['Mettre à jour un stock', "Liste de l'inventaire"]} />
    </>
  );
}
