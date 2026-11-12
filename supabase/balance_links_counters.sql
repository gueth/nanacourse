-- Finances > Gestion > « Créer des connecteurs » : rôle de chaque ligne dans une connexion.
-- Une connexion relie une catégorie à une ligne (la ligne du connecteur), et une ligne de l'autre côté du bilan
-- l'équilibre. "counters" liste les catégories pour lesquelles cette ligne est la ligne d'équilibrage, afin que
-- la carte affiche les lignes dans le bon rôle.
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
alter table balance_links add column if not exists counters text[] not null default '{}';
