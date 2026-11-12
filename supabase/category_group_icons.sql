-- Icône des grandes catégories : affichée dans un rond bleu à gauche des transactions de ses sous-catégories
-- (Budget > Liste de transactions) et à côté de son nom (Gestion > Catégories).
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

-- Nom de l'icône choisie (liste dans components/finance/GroupIcon.tsx) ; null : devinée d'après le nom de la grande catégorie
alter table category_groups add column if not exists icon text;

-- Ancienne version de ce script (image envoyée au lieu d'une icône) : sa colonne ne sert plus
alter table category_groups drop column if exists icon_url;
