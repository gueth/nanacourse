-- Finances : relevés présents mois par mois, lignes du bilan reliées à des catégories, budgets de courses reliés
-- aux catégories des Finances. À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

-- 1. Colonne « auto » des lignes du bilan et du compte de résultat : montant inscrit par l'appli (relevés, budgets)
alter table finance_lines add column if not exists auto boolean not null default false;

-- 2. Mois renseignés par les relevés importés, compte par compte (relevés manquants du Bilan) ;
--    un relevé importé plus tard pour le même compte et le même mois met simplement la ligne à jour
create table if not exists statement_months (
  account text not null,
  month text not null, -- AAAA-MM
  updated_at timestamptz not null default now(),
  primary key (account, month)
);
-- Relevés déjà importés : chaque mois où un compte a des opérations venues d'un relevé (pas celles ajoutées à la main)
insert into statement_months (account, month)
select distinct account, to_char(date, 'YYYY-MM') from bank_transactions
where import_key not like 'manuel|%'
on conflict (account, month) do nothing;
-- Table d'un essai précédent (périodes de relevés) : ses mois sont repris avant de la supprimer
do $$
begin
  if to_regclass('public.bank_statements') is not null then
    insert into statement_months (account, month)
    select distinct s.account, to_char(m, 'YYYY-MM')
    from bank_statements s,
      generate_series(date_trunc('month', s.date_from - 1), date_trunc('month', s.date_to), interval '1 month') m
    where m >= date_trunc('month', s.date_from) or extract(day from s.date_from) = 1
    on conflict (account, month) do nothing;
    drop table bank_statements;
  end if;
end $$;

-- 3. Lignes du bilan reliées à des catégories (Gestion > Dettes et créances)
create table if not exists balance_links (
  id uuid primary key default gen_random_uuid(),
  section text not null,          -- creances, emprunts ou dettes
  label text not null,            -- ligne de la rubrique
  targets text[] not null default '{}', -- catégories, ou grandes catégories ("groupe:<id>")
  opening numeric not null default 0,   -- solde de départ
  opening_month text not null,    -- AAAA-MM : solde au dernier jour de ce mois
  created_at timestamptz not null default now()
);

-- 4. Catégorie des Finances de chaque budget de courses (« Courses » par défaut)
alter table budget_settings add column if not exists category text not null default 'courses';

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
alter table statement_months enable row level security;
drop policy if exists "acces appli" on statement_months;
create policy "acces appli" on statement_months for all to anon, authenticated using (true) with check (true);
alter table balance_links enable row level security;
drop policy if exists "acces appli" on balance_links;
create policy "acces appli" on balance_links for all to anon, authenticated using (true) with check (true);
