-- Virements entre mes comptes : l'autre compte, précisé à la main quand le libellé ne le dit pas
-- (sert à estimer le solde d'un livret dont le relevé n'est pas encore arrivé ; '' = un compte qui n'est pas suivi).
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
alter table bank_transactions add column if not exists transfer_account text;
