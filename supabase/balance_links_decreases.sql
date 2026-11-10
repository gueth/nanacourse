-- Finances : « Compléter les tableaux » (lignes du bilan reliées à des catégories du Budget).
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

-- Catégories qui diminuent une ligne (remboursements), en plus de celles qui l'augmentent ("targets")
alter table balance_links add column if not exists decreases text[] not null default '{}';
