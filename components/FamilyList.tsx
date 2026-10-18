'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { groupByFamily } from '@/lib/ingredients';

type Props<T> = {
  items: T[];
  // Nom servant à trouver la famille (ex : « Œufs bio » -> famille « Œufs »)
  nameOf: (item: T) => string;
  // Affichage d'un élément (un <li> avec sa propre key).
  // nested = true quand l'élément est dans une bannière de groupe : il s'affiche alors en ligne légère,
  // la bannière jouant le rôle de carte.
  renderItem: (item: T, nested: boolean) => ReactNode;
  // Version resserrée, pour les listes en lignes simples (page Course)
  compact?: boolean;
  // Regroupement personnalisé (ex : par enseigne) à la place de la famille déduite du nom.
  // Clé vide = élément seul, sans bannière.
  groupOf?: (item: T) => { key: string; label: string };
  // Bannières cliquables pour replier / déplier chaque groupe (repliés au départ)
  collapsible?: boolean;
  // Force l'ouverture de tous les groupes (ex : pendant une recherche)
  forceOpen?: boolean;
};

// Regroupe selon groupOf, dans l'ordre d'apparition (un élément sans clé reste seul)
function groupWith<T>(items: T[], groupOf: (item: T) => { key: string; label: string }) {
  const groups = new Map<string, { label: string; items: T[] }>();
  items.forEach((item, index) => {
    const { key, label } = groupOf(item);
    const k = key || `__${index}`;
    if (!groups.has(k)) groups.set(k, { label, items: [] });
    groups.get(k)!.items.push(item);
  });
  return Array.from(groups.entries()).map(([key, g]) => ({ key, ...g }));
}

// Affiche des éléments regroupés, à placer dans un <ul> :
// les éléments d'un même groupe sont rangés sous une bannière (ex : Œufs (3), Carrefour (2)),
// un élément seul dans son groupe s'affiche normalement.
export default function FamilyList<T>({
  items,
  nameOf,
  renderItem,
  compact = false,
  groupOf,
  collapsible = false,
  forceOpen = false
}: Props<T>) {
  // Groupes dépliés (seulement utile si collapsible)
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

  function toggle(key: string) {
    setOpenKeys((o) => ({ ...o, [key]: !o[key] }));
  }

  const groups = groupOf ? groupWith(items, groupOf) : groupByFamily(items, nameOf);

  return (
    <>
      {groups.map((f) => {
        // Seul dans son groupe : affiché directement, sans bannière
        if (f.items.length === 1) return renderItem(f.items[0], false);

        const open = !collapsible || forceOpen || !!openKeys[f.key];
        const title = (
          <>
            {f.label} <span className={`opacity-60 ${compact ? 'text-sm' : 'text-base'}`}>({f.items.length})</span>
          </>
        );
        // Titre de la bannière, cliquable si les groupes sont repliables (la flèche tourne à l'ouverture)
        const header = collapsible ? (
          <button
            type="button"
            onClick={() => toggle(f.key)}
            aria-expanded={open}
            className={`title-hand flex items-center gap-1 w-full text-left ${compact ? 'text-lg' : 'text-2xl'}`}
          >
            <ChevronRight size={compact ? 16 : 22} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
            {title}
          </button>
        ) : (
          <p className={`title-hand ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</p>
        );

        // Version resserrée (page Course) : bannière discrète, articles en lignes simples
        if (compact) {
          return (
            <li key={f.key}>
              {header}
              {/* Retrait minimal, pour garder les colonnes alignées avec les articles hors groupe */}
              {open && <ul className="space-y-1 pl-1 border-l-2 border-line">{f.items.map((i) => renderItem(i, false))}</ul>}
            </li>
          );
        }

        // Version normale : la bannière est une carte (avec scotch), aussi visible qu'un élément,
        // et les éléments du groupe s'y rangent en lignes séparées par un pointillé
        return (
          <li key={f.key} className="card card-plain">
            <span className="tape" />
            {header}
            {open && (
              <ul className="mt-3 border-t-2 border-dashed border-line divide-y-2 divide-dashed divide-line">
                {f.items.map((i) => renderItem(i, true))}
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}
