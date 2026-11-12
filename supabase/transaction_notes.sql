-- Notes des transactions : un petit texte libre ajouté à la main (Finances > liste des transactions, popin « Modifier
-- une transaction »), affiché sous le libellé.
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
alter table bank_transactions add column if not exists note text;
