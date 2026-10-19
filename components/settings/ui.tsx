'use client';

import type { ReactNode } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';

// Petits éléments communs aux onglets des paramètres, pensés pour un écran de téléphone :
// boutons d'action en icônes (assez grands pour le doigt), barre de recherche, liste en lignes.

// Barre de recherche avec une loupe ; "children" = filtre complémentaire affiché dessous (ex : catégorie)
export function SearchBar({
  value,
  onChange,
  placeholder,
  children
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 space-y-2">
      <label className="flex items-center gap-2 border-b-2 border-dashed border-line focus-within:border-ink focus-within:border-solid">
        <Search size={18} className="shrink-0 opacity-50" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent py-2 outline-none"
        />
      </label>
      {children}
    </div>
  );
}

// Bouton rond avec une icône (modifier, supprimer...) : zone de 40 px pour le doigt
export function IconButton({
  label,
  onClick,
  children,
  danger = false,
  active = false
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
        active ? 'bg-ink text-paper' : 'opacity-70 hover:opacity-100 hover:bg-paper'
      } ${danger ? 'hover:text-brick' : ''}`}
    >
      {children}
    </button>
  );
}

// Les deux actions habituelles d'une ligne : modifier (ou fermer la modification) et supprimer
export function RowActions({ editing, onEdit, onDelete }: { editing: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="flex items-center shrink-0 -mr-2">
      <IconButton label={editing ? 'Fermer la modification' : 'Modifier'} onClick={onEdit} active={editing}>
        <Pencil size={18} />
      </IconButton>
      <IconButton label="Supprimer" onClick={onDelete} danger>
        <Trash2 size={18} />
      </IconButton>
    </span>
  );
}

// Liste en lignes dans une seule carte (au lieu d'une carte par élément) : plus compacte sur téléphone
export function RowList({ children, empty }: { children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="card card-plain card-rows">
      <span className="tape" />
      <ul className="divide-y-2 divide-dashed divide-line">
        {empty && <li className="px-4 py-4 opacity-60">{empty}</li>}
        {children}
      </ul>
    </div>
  );
}

// Boutons d'un formulaire de modification dans une ligne
export function EditActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-4 pt-1">
      <button type="button" onClick={onSave} className="btn-hand">
        Enregistrer
      </button>
      <button type="button" onClick={onCancel} className="btn-ghost">
        annuler
      </button>
    </div>
  );
}

// Champs d'un formulaire de modification : une colonne sur téléphone, deux sur écran plus large
export function EditFields({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
