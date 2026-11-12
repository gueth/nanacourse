-- Finances > Gestion > « Créer des connecteurs » : libellé de chaque connexion, pour mieux la reconnaître.
-- Rangé sur la ligne du connecteur : "names" associe une catégorie (ou « groupe:<id> ») à son libellé.
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
alter table balance_links add column if not exists names jsonb not null default '{}'::jsonb;
