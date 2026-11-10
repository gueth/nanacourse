-- Finances : budgets propres à un mois passé, et ce qui compte (ou non) dans la dette à moi-même.
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

-- Une ligne par mois et par catégorie (ou grande catégorie, « groupe:<id> ») dont le budget diffère du budget général :
--  - custom_limit : la limite de ce mois remplace la limite générale (monthly_limit null : pas de limite ce mois-là)
--  - counted : le dépassement (ou l'économie) de ce mois compte dans la dette à moi-même
create table if not exists month_budgets (
  month text not null, -- AAAA-MM
  target text not null, -- catégorie, ou grande catégorie (« groupe:<id> »)
  custom_limit boolean not null default false,
  monthly_limit numeric,
  counted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (month, target)
);

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
alter table month_budgets enable row level security;
drop policy if exists "acces appli" on month_budgets;
create policy "acces appli" on month_budgets for all to anon, authenticated using (true) with check (true);
