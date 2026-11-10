-- Finances : « Compléter les tableaux » (lignes du bilan qui prennent la somme de catégories du Budget).
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

-- Le mois de départ devient facultatif : sans lui, tout l'historique des catégories choisies compte
alter table balance_links alter column opening_month drop not null;
