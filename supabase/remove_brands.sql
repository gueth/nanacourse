-- Suppression complète des marques (table "brands" et tout ce qui s'y rattache).
-- À lancer une fois dans Supabase > SQL Editor.

begin;

-- 1. Modifications en attente sur les listes de courses : on retire la marque qui y était notée
update shopping_list_items
set pending = nullif(pending - 'brand_id', '{}'::jsonb)
where pending ? 'brand_id';

-- 2. Colonne "brand_id" des ingrédients (sa clé étrangère vers "brands" part avec elle)
alter table ingredients drop column if exists brand_id cascade;

-- 3. Table des marques (ses règles de sécurité RLS partent avec elle)
drop table if exists brands cascade;

commit;
