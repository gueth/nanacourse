'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Ingredient } from '@/lib/types';
import PhotoPicker, { photosFormData, usePhotos } from '@/components/PhotoPicker';
import { createIngredient } from '@/lib/ingredients';
import { formatQuantity, normalizeQuantity, quantityRule } from '@/lib/quantity';
// "import type" : seul le type est repris, le code serveur de la route n'est pas envoyé au navigateur
import type { PantryItem } from '@/app/api/scan-pantry/route';

const MAX_PHOTOS = 6;

type Props = {
  ingredients: Ingredient[];
  // Stock actuel par ingrédient, pour comparer avec ce qui a été vu
  stockByIngredient: Record<string, number>;
  // Appelée une fois l'inventaire mis à jour
  onDone: () => void;
};

// Une ligne du résultat, modifiable avant d'être appliquée
type ResultRow = {
  key: number;
  apply: boolean; // ligne cochée = sera enregistrée dans l'inventaire
  ingredientId: string; // '' = nouvel ingrédient, créé avec le nom ci-dessous
  name: string;
  quantity: string;
  type: string;
  confidence: PantryItem['confidence'];
};

// Scan du frigo et des placards :
//  1. on prend ou choisit jusqu'à 6 photos ;
//  2. Claude repère les produits visibles et estime leurs quantités ;
//  3. on vérifie / corrige chaque ligne (ingrédient rattaché, quantité, case à cocher) ;
//  4. les lignes cochées remplacent le stock dans l'inventaire (un nouvel ingrédient est créé si besoin).
export default function PantryScan({ ingredients, stockByIngredient, onDone }: Props) {
  // Photos choisies (appareil photo ou galerie), avec leur aperçu
  const { photos, add: addPhotos, remove: removePhoto, error: photoError } = usePhotos(MAX_PHOTOS);
  const [step, setStep] = useState<'pick' | 'analyzing' | 'review' | 'saving'>('pick');
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [error, setError] = useState('');
  // Option "mettre à zéro ce qui n'a pas été vu", et produits non vus que l'on garde malgré tout
  const [zeroUnseen, setZeroUnseen] = useState(false);
  const [keepIds, setKeepIds] = useState<Record<string, boolean>>({});

  // Produits en stock qui n'apparaissent dans aucune ligne du résultat (cochée ou non) :
  // ce sont eux qui passent à 0 si l'option est activée. Recalculé à chaque modification des lignes.
  const seenIds = new Set(rows.map((r) => r.ingredientId).filter(Boolean));
  const unseen = ingredients.filter((i) => (stockByIngredient[i.id] ?? 0) > 0 && !seenIds.has(i.id));
  const toZero = zeroUnseen ? unseen.filter((i) => !keepIds[i.id]) : [];

  // ANALYSE : envoi des photos (réduites en JPEG) à la route /api/scan-pantry
  async function analyze() {
    setError('');
    setStep('analyzing');
    try {
      const formData = await photosFormData(photos);
      if (!formData) {
        setStep('pick');
        return setError('Format de photo non pris en charge : essaie avec des photos JPEG ou PNG.');
      }
      const res = await fetch('/api/scan-pantry', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setStep('pick');
        return setError(data.error ?? "Échec de l'analyse des photos.");
      }
      const items = (data.items as PantryItem[]) ?? [];
      setRows(
        items.map((it, key) => ({
          key,
          // Les lignes peu sûres sont décochées : à vérifier avant de les appliquer
          apply: it.confidence !== 'basse',
          ingredientId: it.ingredient_id ?? '',
          name: it.name,
          quantity: String(it.quantity),
          type: it.type ?? '',
          confidence: it.confidence
        }))
      );
      setStep('review');
    } catch (err) {
      console.error(err);
      setStep('pick');
      setError("Échec de l'analyse des photos.");
    }
  }

  function updateRow(key: number, changes: Partial<ResultRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  // MISE À JOUR DE L'INVENTAIRE avec les lignes cochées,
  // puis mise à zéro des produits non vus si l'option est activée
  async function apply() {
    setError('');
    setStep('saving');
    const updatedAt = new Date().toISOString();
    // Plusieurs lignes peuvent viser le même ingrédient : on additionne leurs quantités
    const totals = new Map<string, number>();

    for (const row of rows.filter((r) => r.apply)) {
      let id = row.ingredientId;
      const known = ingredients.find((i) => i.id === id);
      const type = known?.type ?? row.type;
      if (!id) {
        // Produit inconnu : on crée l'ingrédient (nom + unité) avant de le mettre en stock
        const created = await createIngredient({ name: row.name, type });
        if (!created) continue;
        id = created;
      }
      const qty = normalizeQuantity(Number(row.quantity.replace(',', '.')), quantityRule(type));
      totals.set(id, Math.round(((totals.get(id) ?? 0) + qty) * 1000) / 1000);
    }

    if (totals.size > 0) {
      const { error: upsertError } = await supabase.from('inventory').upsert(
        Array.from(totals, ([ingredient_id, quantity]) => ({ ingredient_id, quantity, low_stock: false, updated_at: updatedAt })),
        { onConflict: 'ingredient_id' }
      );
      if (upsertError) {
        console.error(upsertError);
        setStep('review');
        return setError(upsertError.message);
      }
    }

    // Produits non vus sur les photos (et non gardés) : stock remis à 0
    if (toZero.length > 0) {
      const { error: zeroError } = await supabase
        .from('inventory')
        .update({ quantity: 0, updated_at: updatedAt })
        .in(
          'ingredient_id',
          toZero.map((i) => i.id)
        );
      if (zeroError) {
        console.error(zeroError);
        setStep('review');
        return setError(zeroError.message);
      }
    }
    onDone();
  }

  // ----- ÉTAPE 1 : CHOIX DES PHOTOS -----
  if (step === 'pick' || step === 'analyzing') {
    return (
      <div>
        <p className="opacity-70 mb-4">
          Prends ton frigo et tes placards en photo (jusqu&apos;à {MAX_PHOTOS}). Les produits reconnus te seront proposés
          avant de mettre à jour l&apos;inventaire.
        </p>

        <PhotoPicker
          photos={photos}
          max={MAX_PHOTOS}
          onAdd={addPhotos}
          onRemove={removePhoto}
          disabled={step === 'analyzing'}
        />

        {(error || photoError) && <p className="text-sm text-brick mb-3">{error || photoError}</p>}

        <button onClick={analyze} disabled={photos.length === 0 || step === 'analyzing'} className="btn-hand">
          {step === 'analyzing' ? 'Analyse en cours...' : `Analyser ${photos.length || ''} photo${photos.length > 1 ? 's' : ''}`}
        </button>
        {step === 'analyzing' && <p className="text-sm opacity-70 mt-2">Ça peut prendre une ou deux minutes.</p>}
      </div>
    );
  }

  // ----- ÉTAPE 2 : VÉRIFICATION DES PRODUITS RECONNUS -----
  return (
    <div>
      {rows.length === 0 ? (
        <p className="opacity-70 mb-4">Aucun produit reconnu sur ces photos.</p>
      ) : (
        <>
          <p className="opacity-70 mb-3 text-sm">
            Vérifie chaque ligne : la quantité vue <strong>remplace</strong> le stock actuel. Les lignes peu sûres (en orange)
            sont décochées.
          </p>
          <ul className="divide-y-2 divide-dashed divide-line text-sm mb-4">
            {rows.map((row) => {
              const known = ingredients.find((i) => i.id === row.ingredientId);
              const rule = quantityRule(known?.type ?? row.type);
              const current = row.ingredientId ? stockByIngredient[row.ingredientId] : undefined;
              return (
                <li key={row.key} className={`py-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${row.confidence === 'basse' ? 'text-orange-500' : ''}`}>
                  <input
                    type="checkbox"
                    checked={row.apply}
                    onChange={(e) => updateRow(row.key, { apply: e.target.checked })}
                    className="w-4 h-4 accent-brick"
                    aria-label={`Appliquer ${row.name}`}
                  />
                  {/* Ingrédient rattaché : un ingrédient connu, ou un nouveau créé avec le nom reconnu */}
                  <select
                    value={row.ingredientId}
                    onChange={(e) => updateRow(row.key, { ingredientId: e.target.value })}
                    className="input-hand flex-1 min-w-40"
                  >
                    <option value="">+ Nouveau : {row.name}</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      step={rule.step}
                      min={0}
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      className="input-hand w-16 text-right"
                      aria-label={`Quantité de ${row.name}`}
                    />
                    <span className="opacity-60">{rule.unit}</span>
                  </span>
                  <span className="opacity-60 w-24 text-right">
                    {current != null ? `avant : ${formatQuantity(current)}` : 'pas en stock'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* MISE À ZÉRO DES PRODUITS NON VUS : en stock mais absents de toutes les lignes ci-dessus.
          La liste suit les corrections faites sur les lignes (rattacher une ligne à un ingrédient le retire d'ici).
          On peut décocher un produit pour le garder (ex : rangé ailleurs, pas photographié). */}
      {unseen.length > 0 && (
        <div className="mb-4 pt-3 border-t-2 border-dashed border-line">
          <label className="flex items-center gap-2 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={zeroUnseen}
              onChange={(e) => setZeroUnseen(e.target.checked)}
              className="w-4 h-4 accent-brick"
            />
            Mettre à zéro ce qui n&apos;a pas été vu ({unseen.length})
          </label>
          {zeroUnseen && (
            <ul className="mt-2 pl-6 text-sm space-y-1">
              {unseen.map((i) => (
                <li key={i.id}>
                  <label className={`flex items-center gap-2 cursor-pointer ${keepIds[i.id] ? 'opacity-50' : 'text-brick'}`}>
                    <input
                      type="checkbox"
                      checked={!keepIds[i.id]}
                      onChange={(e) => setKeepIds((k) => ({ ...k, [i.id]: !e.target.checked }))}
                      className="w-4 h-4 accent-brick"
                      aria-label={`Mettre ${i.name} à zéro`}
                    />
                    <span className="flex-1 min-w-0 truncate">{i.name}</span>
                    <span className="opacity-70">
                      {formatQuantity(stockByIngredient[i.id])} → {keepIds[i.id] ? 'gardé' : '0'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-brick mb-3">{error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={apply}
          disabled={step === 'saving' || (!rows.some((r) => r.apply) && toZero.length === 0)}
          className="btn-hand"
        >
          {step === 'saving' ? 'Mise à jour...' : "Mettre à jour l'inventaire"}
        </button>
        <button onClick={() => setStep('pick')} disabled={step === 'saving'} className="btn-ghost">
          reprendre les photos
        </button>
      </div>
    </div>
  );
}
