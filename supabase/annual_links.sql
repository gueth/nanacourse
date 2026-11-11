-- Dépenses annuelles reliées à une catégorie du Budget (Finances > Gestion > Compléter les tableaux).
-- La limite mensuelle de la catégorie devient la somme de ses dépenses annuelles divisée par douze (lib/transactions).
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
alter table planned_expenses add column if not exists category text;
