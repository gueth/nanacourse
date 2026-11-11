'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, Bookmark, BookmarkCheck, Check, Pencil, Search } from 'lucide-react';
import Modal, { type ModalVariant } from '@/components/Modal';
import { supabase } from '@/lib/supabase';
import { STORE_SELECT } from '@/lib/stores';
import { budgetFor } from '@/lib/budget';
import { formatEuros } from '@/lib/finance';
import { useShoppingBudgets } from '@/lib/coursesQueries';
import { toEntries, useIngredientGroups, type IngredientEntry } from '@/lib/ingredientGroups';
import { dateListName } from '@/lib/lists';
import { quantityRule } from '@/lib/quantity';
import type { IngredientWithRelations } from '@/lib/types';

// Prix le moins cher connu pour un ingrédient (parmi les magasins où il est disponible)
function cheapest(ing: IngredientWithRelations) {
  return ing.prices.filter((p) => p.available).sort((a, b) => a.price - b.price)[0] ?? null;
}

// Dégradés des cartes, aux couleurs des fruits et des légumes (pêche, pamplemousse, fraise, framboise, matcha, miel)
const TONES = [
  ['#f9b08c', '#ef7d57'],
  ['#fcd6bd', '#f4b18c'],
  ['#ef8a72', '#e0584a'],
  ['#e0525e', '#a8121d'],
  ['#c9d6a8', '#8fa868'],
  ['#f6dc96', '#e5b14c']
] as const;
// Encre lisible sur chaque teinte (les teintes claires gardent l'encre olive)
const LIGHT_TONES = new Set([1, 4, 5]);

// Sac de courses en papier, qui se remplit selon la part du budget restant utilisée par la liste.
// fill : 0 = vide, 1 = tout le budget restant ; au-delà, le sac déborde (couleur tomate).
function ShoppingBag({ fill }: { fill: number }) {
  const level = Math.min(Math.max(fill, 0), 1);
  const over = fill > 1;
  const top = 52;
  const height = 116;
  const fillY = top + height * (1 - level);
  const body = 'M22 52 H138 L146 160 Q147 168 139 168 H21 Q13 168 14 160 Z';
  return (
    <svg viewBox="0 0 160 175" className="h-32 w-auto" aria-hidden>
      <defs>
        <clipPath id="bag-body">
          <path d={body} />
        </clipPath>
        <linearGradient id="bag-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={over ? '#ef8a72' : '#a9bf80'} />
          <stop offset="1" stopColor={over ? '#d0533f' : '#6f8a47'} />
        </linearGradient>
      </defs>
      {/* Anses */}
      <path d="M52 60 V36 Q52 14 80 14 Q108 14 108 36 V60" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {/* Papier kraft du sac */}
      <path d={body} fill="#f3ead8" />
      {/* Contenu : monte du fond du sac à mesure que la liste se remplit */}
      <g clipPath="url(#bag-body)">
        <rect
          x="0"
          y={fillY}
          width="160"
          height={175 - fillY}
          fill="url(#bag-fill)"
          style={{ transition: 'y 0.5s cubic-bezier(0.3, 0.75, 0.2, 1), height 0.5s cubic-bezier(0.3, 0.75, 0.2, 1)' }}
        />
      </g>
      <path d={body} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 66 H136" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />
      <circle cx="52" cy="60" r="4" fill="currentColor" />
      <circle cx="108" cy="60" r="4" fill="currentColor" />
    </svg>
  );
}

// Carte d'une bannière (ou d'un ingrédient seul) : dégradé de couleur, photo qui dépasse en haut, catégorie en
// italique (et le nombre de variantes) et nom en gras (sans prix), signet en haut à droite (plein quand la bannière
// est dans le sac), et pastille numérotée logée dans le coin bas-droit creusé.
function IngredientCard({
  entry,
  index,
  taken,
  onToggle
}: {
  entry: IngredientEntry<IngredientWithRelations>;
  index: number;
  taken: boolean;
  onToggle: () => void;
}) {
  const ing = { name: entry.name, photo_url: entry.photo_url, category: entry.category };
  const choices = entry.variants.length;
  const tone = index % TONES.length;
  const [from, to] = TONES[tone];
  const ink = LIGHT_TONES.has(tone) ? '#2e3a24' : '#fffaf2';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={taken}
      aria-label={taken ? `Retirer ${ing.name}` : `Ajouter ${ing.name}`}
      className="relative block w-[46%] shrink-0 snap-start pt-5 text-left transition-transform active:scale-[0.97] sm:w-[31%]"
    >
      {/* Fond coloré, coin bas-droit creusé */}
      <span
        className={`cu-notch absolute inset-x-0 bottom-0 top-5 rounded-[22px] transition-shadow ${taken ? 'shadow-[inset_0_0_0_3px_#3a4a2b]' : ''}`}
        style={{ background: `linear-gradient(110deg, ${from}, ${to})` }}
        aria-hidden
      />
      {/* Photo qui dépasse du haut de la carte (ou initiale) */}
      <span className="relative mx-2.5 -mt-5 block aspect-[4/3] overflow-hidden rounded-[18px] bg-white/35 shadow-[0_10px_18px_-10px_rgba(46,58,36,0.6)]">
        {ing.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- photos venant de Supabase Storage
          <img src={ing.photo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-5xl font-bold" style={{ color: ink, opacity: 0.55 }}>
            {ing.name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      {/* Signet : plein quand l'ingrédient est dans le sac */}
      <span className="absolute right-2 top-7 flex size-7 items-center justify-center rounded-full bg-[#2e3a24] text-[#fffaf2] shadow" aria-hidden>
        {taken ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
      </span>
      {/* Catégorie et nom */}
      <span className="relative block px-3 pb-3.5 pr-12 pt-2" style={{ color: ink }}>
        <span className="block truncate text-[12px] italic opacity-85">
          {ing.category?.name ?? 'Ingrédient'}
          {choices > 1 && ` · ${choices} choix`}
        </span>
        <span className="line-clamp-2 block text-[16px] font-bold leading-tight">{ing.name}</span>
      </span>
      {/* Pastille numérotée (une coche quand l'ingrédient est pris) */}
      <span
        className={`absolute bottom-0 right-0 flex size-11 items-center justify-center rounded-full text-[17px] font-medium transition-colors ${taken ? 'bg-[#3a4a2b] text-[#f6f3e8]' : 'bg-[#ebe3d5] text-[#2e3a24]'}`}
        aria-hidden
      >
        {taken ? <Check size={18} strokeWidth={3} /> : index + 1}
      </span>
    </button>
  );
}

// CRÉATION D'UNE LISTE DEPUIS L'ACCUEIL, dans une popin au style « application de cuisine » :
//  - titre = nom de la liste, la date du jour par défaut (modifiable ; s'il ne l'est jamais,
//    il deviendra la date de réalisation des courses à la validation) ;
//  - une barre de recherche en pilule, une ligne de catégories, puis une ligne de cartes (photo + libellé, sans prix) :
//    toucher une carte la sélectionne, la retoucher la désélectionne (quantité minimale) ;
//  - en bas, une carte vert olive avec le sac qui se remplit selon le prix des articles par rapport au budget restant,
//    et le bouton Créer.
export default function NewListComposer({
  onClose,
  onCreated,
  variant
}: {
  onClose: () => void;
  // Appelée avec l'id de la liste créée
  onCreated: (listId: string) => void;
  variant: ModalVariant;
}) {
  const [name, setName] = useState(() => dateListName());
  const [ingredients, setIngredients] = useState<IngredientWithRelations[] | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Articles ajoutés : id de l'ingrédient -> quantité
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Budget restant (premier budget de courses, celui pris par défaut par une nouvelle liste)
  const budget = budgetFor(useShoppingBudgets().data, null);

  useEffect(() => {
    supabase
      .from('ingredients')
      .select(`*, category:categories(*), prices:ingredient_prices(*, store:stores(${STORE_SELECT}))`)
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setIngredients((data as unknown as IngredientWithRelations[]) ?? []);
      });
  }, []);

  // Bannières (Œufs, Lait...) qui regroupent les variantes d'un même produit : ce sont elles qui s'affichent en cartes,
  // un ingrédient sans bannière s'affichant seul
  const groups = useIngredientGroups().data;
  const entries = useMemo(() => toEntries(ingredients ?? [], groups ?? []), [ingredients, groups]);
  // Bannière touchée en dernier : on y choisit la variante (sous les cartes)
  const [choosing, setChoosing] = useState<string | null>(null);

  // Catégories qui ont au moins une bannière, par ordre alphabétique (une bannière a sa propre catégorie)
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; items: IngredientEntry<IngredientWithRelations>[] }>();
    for (const entry of entries) {
      const category = entry.category;
      const id = category?.id ?? 'none';
      if (!map.has(id)) map.set(id, { id, name: category?.name ?? 'Sans catégorie', items: [] });
      map.get(id)!.items.push(entry);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);
  // Catégorie affichée : celle choisie, sinon la première
  const current = categories.find((c) => c.id === categoryId) ?? categories[0];
  // Cartes affichées : la recherche (dans toutes les catégories, sur le nom de la bannière ou de ses variantes)
  // passe avant la catégorie choisie
  const query = search.trim().toLowerCase();
  const shown = query
    ? entries.filter((e) => e.name.toLowerCase().includes(query) || e.variants.some((v) => v.name.toLowerCase().includes(query)))
    : (current?.items ?? []);
  const isTaken = (entry: IngredientEntry<IngredientWithRelations>) => entry.variants.some((v) => v.id in selected);
  const choosingEntry = shown.find((e) => e.key === choosing && e.variants.length > 1 && isTaken(e));

  const byId = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id, i])), [ingredients]);
  const ids = Object.keys(selected);
  // Prix estimé de la liste : prix le moins cher connu × quantité
  const total = ids.reduce((sum, id) => {
    const ing = byId.get(id);
    const best = ing && cheapest(ing);
    return sum + (best ? best.price * selected[id] : 0);
  }, 0);
  const fill = budget && budget.remaining > 0 ? total / budget.remaining : total > 0 ? 2 : 0;
  const over = fill > 1;

  // Toucher une carte la sélectionne, la retoucher la désélectionne.
  // Une bannière prend d'abord sa variante la moins chère connue (sinon la première) ; les autres variantes
  // s'affichent alors sous les cartes pour en changer.
  // Pas de quantité à régler ici : chaque article est pris en quantité minimale (1 pièce, 1 kg...)
  function toggle(entry: IngredientEntry<IngredientWithRelations>) {
    const taken = isTaken(entry);
    const byPrice = entry.variants
      .map((v) => ({ v, price: cheapest(v)?.price ?? Infinity }))
      .sort((a, b) => a.price - b.price);
    const first = byPrice[0].v;
    setSelected((s) => {
      const next = { ...s };
      for (const v of entry.variants) delete next[v.id];
      if (!taken) next[first.id] = quantityRule(first.type).min;
      return next;
    });
    setChoosing(taken ? null : entry.key);
  }

  // Changement de variante dans une bannière déjà prise
  function pickVariant(entry: IngredientEntry<IngredientWithRelations>, ing: IngredientWithRelations) {
    setSelected((s) => {
      const next = { ...s };
      for (const v of entry.variants) delete next[v.id];
      next[ing.id] = quantityRule(ing.type).min;
      return next;
    });
  }

  async function create() {
    setError('');
    const label = name.trim() || dateListName();
    if (ids.length === 0) return setError('Ajoute au moins un article dans le sac.');
    setSaving(true);
    const rows = ids.map((id) => {
      const best = cheapest(byId.get(id)!);
      return {
        ingredient_id: id,
        quantity: selected[id],
        expected_price: best ? best.price * selected[id] : 0,
        store_id: best?.store_id ?? null
      };
    });
    const { data: list, error: listError } = await supabase
      .from('shopping_lists')
      .insert({ name: label, estimated_price: total, is_active: false })
      .select()
      .single();
    if (listError || !list) {
      setSaving(false);
      return setError(listError?.message ?? 'Création impossible.');
    }
    const { error: itemsError } = await supabase.from('shopping_list_items').insert(rows.map((r) => ({ ...r, shopping_list_id: list.id })));
    setSaving(false);
    if (itemsError) return setError(itemsError.message);
    onCreated(list.id);
  }

  // Titre de la popin : le nom de la liste, modifiable sur place
  const heading = (
    <label className="flex min-w-0 items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nom de la liste"
        className="min-w-0 flex-1 border-b border-dashed border-current/30 bg-transparent font-[inherit] outline-none focus:border-current"
      />
      <Pencil size={15} className="shrink-0 opacity-50" aria-hidden />
    </label>
  );

  // Ingrédients pris, pour les petites étiquettes de la carte du bas (les trois premiers, puis « +n »)
  const takenNames = ids.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);

  return (
    <Modal title={`Nouvelle liste : ${name}`} heading={heading} onClose={onClose} variant={variant}>
      {ingredients === null ? (
        <p className="py-6 text-center opacity-60">Chargement des ingrédients…</p>
      ) : categories.length === 0 ? (
        <p className="opacity-70">Aucun ingrédient enregistré pour le moment.</p>
      ) : (
        <>
          {/* BARRE DE RECHERCHE en pilule */}
          <label className="flex items-center gap-3 rounded-full bg-[#ebe3d5] py-2 pl-4 pr-2">
            <Search size={18} className="shrink-0 opacity-40" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="choisis un ingrédient"
              aria-label="Rechercher un ingrédient"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-current placeholder:opacity-60"
            />
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current" aria-hidden>
              <ArrowRight size={15} />
            </span>
          </label>

          {/* LIGNE DES CATÉGORIES (défile de côté) ; le chiffre = articles déjà pris dans la catégorie */}
          {!query && (
            <div className="no-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Catégories">
              {categories.map((c) => {
                const active = c.id === current?.id;
                const count = c.items.filter(isTaken).length;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setCategoryId(c.id)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${active ? 'bg-[#3a4a2b] text-[#f6f3e8]' : 'bg-[#ebe3d5]'}`}
                  >
                    {c.name}
                    {count > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${active ? 'bg-white/20' : 'bg-[#3a4a2b] text-[#f6f3e8]'}`}>{count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* LIGNE DES CARTES : photo et libellé, sans prix */}
          {shown.length === 0 ? (
            <p className="py-8 text-center text-[14px] opacity-60">Aucun ingrédient ne correspond.</p>
          ) : (
            <div className="no-scrollbar -mx-1 mt-3 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
              {shown.map((entry, i) => (
                <IngredientCard key={entry.key} entry={entry} index={i} taken={isTaken(entry)} onToggle={() => toggle(entry)} />
              ))}
            </div>
          )}

          {/* VARIANTES de la bannière touchée en dernier : celle qui part dans le sac est en vert olive */}
          {choosingEntry && (
            <div className="mt-2 rounded-[18px] bg-[#ebe3d5] p-3">
              <p className="text-[13px] font-medium">{choosingEntry.name} : quelle variante ?</p>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={`Variantes de ${choosingEntry.name}`}>
                {choosingEntry.variants.map((v) => {
                  const on = v.id in selected;
                  const best = cheapest(v);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pickVariant(choosingEntry, v)}
                      className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${on ? 'bg-[#3a4a2b] text-[#f6f3e8]' : 'bg-white/70'}`}
                    >
                      {v.name}
                      {best && <span className="ml-1.5 opacity-70">{formatEuros(best.price)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* LE SAC : carte vert olive, le sac qui se remplit sur un fond sauge, puis le récapitulatif et Créer */}
          <div className="mt-5 rounded-[26px] bg-[#3a4a2b] p-2.5 text-[#f6f3e8]">
            <div className="overflow-hidden rounded-[20px] bg-[#dfe6cf] text-[#3a4a2b]">
              <div className="flex justify-center pt-4">
                <ShoppingBag fill={fill} />
              </div>
              <p className={`mt-2 py-1.5 text-center text-[12px] font-medium text-white ${over ? 'bg-[#d0533f]' : 'bg-[#8fa868]'}`} aria-live="polite">
                {budget
                  ? over
                    ? `Budget dépassé : il reste ${formatEuros(budget.remaining)}`
                    : `${formatEuros(budget.remaining)} restants dans ton budget`
                  : 'Aucun budget de courses'}
              </p>
            </div>
            <div className="flex items-stretch gap-3 px-2 pb-1.5 pt-3">
              <div className="min-w-0 flex-1">
                <p className="text-[20px] font-medium leading-tight">
                  {ids.length} article{ids.length > 1 ? 's' : ''}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {takenNames.length === 0 && <span className="text-[12px] opacity-60">Le sac est vide</span>}
                  {takenNames.slice(0, 3).map((n) => (
                    <span key={n} className="max-w-[7rem] truncate rounded-full bg-white/12 px-2.5 py-0.5 text-[11px]">
                      {n}
                    </span>
                  ))}
                  {takenNames.length > 3 && <span className="rounded-full bg-white/12 px-2.5 py-0.5 text-[11px]">+{takenNames.length - 3}</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end justify-between border-l border-white/20 pl-3">
                {budget && <p className="text-[26px] font-bold leading-none">{Math.round(Math.min(fill, 9.99) * 100)}%</p>}
                <button type="button" onClick={create} disabled={saving} className="mt-2 inline-flex items-center gap-1 text-[15px] font-medium disabled:opacity-50">
                  {saving ? 'Création…' : 'Créer'} <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
          </div>
          {error && <p className="mt-3 text-center text-sm text-brick">{error}</p>}
        </>
      )}
    </Modal>
  );
}
